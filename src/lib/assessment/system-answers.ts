/**
 * INPUT:  Prisma 事务、会话 id、系统推导答案（系统读取 / 复用回填）
 * OUTPUT: upsertSystemAnswers / syncReuseAnswers —— 系统来源答案的落库共用层
 * POS:    M9.5 系统读取（system-read.ts）与 M9.3/M9.4 复用回填（reuse.ts）共用的 Answer 落库编排：
 *         source=system、status=confirmed；人工 confirmed 答案优先不覆盖；已有 system 答案
 *         内容一致幂等跳过、内容漂移就地更新并 appendAnswerEditHistory 留痕（operator=system）。
 *         本层不做任何医学推导，推导纯函数分别在 system-read.ts / reuse.ts。
 */
import type { Prisma } from "@/generated/prisma/client";
import { appendAnswerEditHistory, type AnswerSnapshot } from "./audit";
import { deriveReuseAnswers, reuseTargetQuestionIds, type ReuseAnswer } from "./reuse";

type Tx = Prisma.TransactionClient;

/** 系统推导答案的最小形状（system-read 的 SystemReadAnswer 与 reuse 的 ReuseAnswer 均满足） */
export interface SystemAnswerInput {
  questionId: string;
  optionLabel: string;
  score: number;
  rawText: string;
}

/**
 * 系统推导答案 upsert（M9.5 finalize 内联循环抽取，供系统读取与复用回填共用）：
 * - 无记录 → 新建 source=system、status=confirmed；
 * - 已有 confirmed 人工答案 → 跳过（系统答案不覆盖人工）；
 * - 已有 system 答案且内容一致 → 幂等跳过；
 * - 其余（pending/manual 占位行、内容漂移的旧 system 行、被撤回的 superseded 行）
 *   → 就地更新为最新系统值，editHistory 追加 operator=system 留痕。
 */
export async function upsertSystemAnswers(
  tx: Tx,
  sessionId: string,
  answers: readonly SystemAnswerInput[],
  reason: string
): Promise<void> {
  for (const answer of answers) {
    // 同题可能已有 pending/manual 占位行或旧 system 行（@@unique(sessionId, questionId)），有则就地更新
    const current = await tx.answer.findUnique({
      where: { sessionId_questionId: { sessionId, questionId: answer.questionId } },
    });
    if (!current) {
      await tx.answer.create({
        data: {
          sessionId,
          questionId: answer.questionId,
          rawText: answer.rawText,
          optionLabel: answer.optionLabel,
          score: answer.score,
          source: "system",
          status: "confirmed",
        },
      });
      continue;
    }
    if (current.status === "confirmed" && current.source !== "system") continue; // 双保险：人工答案优先
    if (
      current.optionLabel === answer.optionLabel &&
      current.score === answer.score &&
      current.rawText === answer.rawText &&
      current.source === "system" &&
      current.status === "confirmed"
    ) {
      continue; // 内容一致，幂等跳过
    }
    await tx.answer.update({
      where: { id: current.id },
      data: {
        optionLabel: answer.optionLabel,
        score: answer.score,
        rawText: answer.rawText,
        source: "system",
        status: "confirmed",
        editHistory: appendAnswerEditHistory(
          current.editHistory,
          {
            optionLabel: current.optionLabel,
            score: current.score,
            rawText: current.rawText,
            source: current.source,
            status: current.status,
          },
          {
            optionLabel: answer.optionLabel,
            score: answer.score,
            rawText: answer.rawText,
            source: "system",
            status: "confirmed",
          },
          { at: new Date().toISOString(), operator: "system", reason }
        ) as unknown as Prisma.InputJsonValue,
      },
    });
  }
}

export interface ReuseSyncResult {
  /** 本次回填（新建/更新/恢复）为 confirmed 的题目 id */
  filled: string[];
  /** 本次因复用条件不再成立而撤回（置 superseded）的题目 id */
  retracted: string[];
}

/**
 * M9.3/M9.4 复用回填同步（01 表复用规则，当前为焦虑两问 ↔ GAD-7 一组）：
 * 按当前 confirmed 答案重算应回填集合并落库；此前系统回填过、但本次复用条件不再成立
 * （如医生在 CollectForm 把源题由「否」改答「是」）的目标题，撤回为 superseded 并留痕——
 * 撤回的题恢复待问/待补录，strict 路径下照常参与缺失阻断。
 * 返回落库结果供对话层同步快照（filled → 状态机跳过该题；retracted → 恢复待问）。
 */
export async function syncReuseAnswers(
  tx: Tx,
  sessionId: string,
  scaleIds: readonly string[]
): Promise<ReuseSyncResult> {
  const existing = await tx.answer.findMany({ where: { sessionId } });
  const confirmed = new Map<string, string>();
  for (const answer of existing) {
    if (answer.status === "confirmed" && answer.optionLabel !== null) {
      confirmed.set(answer.questionId, answer.optionLabel);
    }
  }
  const fills: ReuseAnswer[] = deriveReuseAnswers(scaleIds, confirmed);
  await upsertSystemAnswers(tx, sessionId, fills, "复用规则按源题答案自动回填");

  const fillIds = new Set(fills.map((fill) => fill.questionId));
  const targets = reuseTargetQuestionIds(scaleIds);
  const retracted: string[] = [];
  for (const answer of existing) {
    if (!targets.has(answer.questionId) || fillIds.has(answer.questionId)) continue;
    // 只撤回系统回填行：人工答案（含医生代填）任何情况下不动
    if (answer.source !== "system" || answer.status !== "confirmed") continue;
    const previous: AnswerSnapshot = {
      optionLabel: answer.optionLabel,
      score: answer.score,
      rawText: answer.rawText,
      source: answer.source,
      status: answer.status,
    };
    const next: AnswerSnapshot = { ...previous, status: "superseded" };
    await tx.answer.update({
      where: { id: answer.id },
      data: {
        status: "superseded",
        editHistory: appendAnswerEditHistory(answer.editHistory, previous, next, {
          at: new Date().toISOString(),
          operator: "system",
          reason: "复用条件不再成立，撤回系统回填",
        }) as unknown as Prisma.InputJsonValue,
      },
    });
    retracted.push(answer.questionId);
  }
  return { filled: fills.map((fill) => fill.questionId), retracted };
}
