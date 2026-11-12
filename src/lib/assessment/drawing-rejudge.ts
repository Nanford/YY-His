/**
 * INPUT:  Prisma（答案、会话；重算结论经 finalize.ts）、画图题看图判定（src/lib/dialogue/drawing-judge.ts，可注入）、
 *         01 表标准选项（src/lib/rules 的 questionById）
 * OUTPUT: drawingRejudgeEligible —— 某条答案能否「AI 重新评分」（纯函数，追溯页与服务端共用）；
 *         rejudgeDrawingAnswer —— 用存档画作重跑看图判定，落分留痕并重算评估结论；
 *         rejudgeNoticeOf / parseRejudgeNotice —— 回跳追溯页时的结果码（写入与读取）
 * POS:    2026-11-12 用户拍板（选项 A）：画图题一律 AI 评分，不等医生。挂着「待评分」的画作——
 *         修复「交卷从不调用视觉模型」之前落库的，以及视觉通道偶发失败、复核链也没给出结论的——
 *         由医生在追溯页一键重跑同一套视觉判定（judgeDrawing，含临界复核与复核链），不另写判定口径。
 *         判定得出对/错 → 答案转 confirmed、按 01 表选项计分（硬约束 2），修改历史记 operator=system；
 *         会话已出报告时在同一事务内重算评估结论：方案未确认重新生成候选方案，已确认则保留医生确认的方案。
 *         仍未得出结论 → 只更新判定理由，答案保持「待评分」，可稍后再点。
 */
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { questionById } from "@/lib/rules";
import { hasDrawingJudge, judgeDrawing, validateDrawing, type DrawingJudge } from "@/lib/dialogue/drawing-judge";
import { appendAnswerEditHistory, type AnswerSnapshot } from "./audit";
import { rescoreReportedSession } from "./finalize";

/** 判断能否重新评分所需的答案字段 */
export interface RejudgeCandidate {
  questionId: string;
  source: string;
  status: string;
  score: number | null;
  rawText: string | null;
}

/**
 * 画图交卷、尚无分值（待确认/待人工确认）、该题已接入看图判定、且存有合法画作的答案才能重新评分。
 * 医生代填或已有分值的答案不在此列：改判走「重新打开并修正答案」，不让 AI 覆盖医生的结论。
 */
export function drawingRejudgeEligible(answer: RejudgeCandidate): boolean {
  return (
    answer.source === "drawing" &&
    answer.score === null &&
    (answer.status === "pending" || answer.status === "manual") &&
    hasDrawingJudge(answer.questionId) &&
    validateDrawing(answer.rawText ?? undefined) === null
  );
}

/**
 * scored = 已得出分值，rescore 说明评估结论怎么跟进：none = 会话还在采集、出报告时自然计入；
 *          regenerated = 已重算结论并重新生成候选方案；plan_kept = 方案医生已确认，只更新评估结果、未重排方案；
 * unclear = AI 仍未得出结论，答案保持待评分；stale = 答案已被别处评分或改动（页面过期/并发点击）；
 * busy = 会话正在生成评估结论（finalizing），稍后再试
 */
export type RejudgeOutcome =
  | { kind: "scored"; score: number; rescore: "none" | "regenerated" | "plan_kept" }
  | { kind: "unclear"; reason: string }
  | { kind: "stale" }
  | { kind: "busy" };

/** 追溯页回跳提示的结果码（URL 查询参数 rejudge），由医生端 Server Action 写、会话页读 */
export const REJUDGE_NOTICE_KINDS = [
  "scored",
  "scored_rescored",
  "scored_plan_kept",
  "unclear",
  "stale",
  "busy",
] as const;
export type RejudgeNoticeKind = (typeof REJUDGE_NOTICE_KINDS)[number];

export function rejudgeNoticeOf(outcome: RejudgeOutcome): RejudgeNoticeKind {
  if (outcome.kind !== "scored") return outcome.kind;
  if (outcome.rescore === "regenerated") return "scored_rescored";
  return outcome.rescore === "plan_kept" ? "scored_plan_kept" : "scored";
}

/** 查询参数 → 结果码；不认识的值返回 null（不显示提示） */
export function parseRejudgeNotice(value: string | undefined): RejudgeNoticeKind | null {
  return (REJUDGE_NOTICE_KINDS as readonly string[]).includes(value ?? "") ? (value as RejudgeNoticeKind) : null;
}

/** 修改历史里的原因说明（operator 记 system：分值由视觉模型给出，医生只是发起重跑） */
const REJUDGE_REASON = "医生发起 AI 重新评分：视觉模型按存档画作看图判定";

/**
 * 用存档画作重跑看图判定并落库。
 * 看图在事务外完成（判定链最长约 60 秒，不能占着 SQLite 写锁），落库前在事务内重新核对答案未变。
 * @param judge 测试注入的判定器；缺省按题目 id 取已接入的判定器
 */
export async function rejudgeDrawingAnswer(
  sessionId: string,
  questionId: string,
  judge?: DrawingJudge
): Promise<RejudgeOutcome> {
  const answer = await prisma.answer.findUnique({
    where: { sessionId_questionId: { sessionId, questionId } },
    include: { session: { select: { status: true } } },
  });
  if (!answer || !drawingRejudgeEligible(answer) || !answer.rawText) return { kind: "stale" };
  if (answer.session.status === "finalizing") return { kind: "busy" };

  const options = questionById.get(questionId)?.options ?? [];
  const outcome = await judgeDrawing(questionId, options, answer.rawText, judge);

  return prisma.$transaction(async (tx) => {
    const current = await tx.answer.findUnique({ where: { id: answer.id } });
    // 看图期间即使仍是 pending，也可能已重交同一张画或完成另一轮复核；只接纳原版本的结果。
    if (!current || current.updatedAt.getTime() !== answer.updatedAt.getTime() ||
      current.rawText !== answer.rawText || !drawingRejudgeEligible(current)) {
      return { kind: "stale" } as const;
    }
    const session = await tx.assessmentSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { status: true },
    });
    if (session.status === "finalizing") return { kind: "busy" } as const;

    const aiJudgment = {
      method: outcome.method,
      status: outcome.status,
      confidence: outcome.status === "matched" ? outcome.confidence : null,
      reason: outcome.reason,
    } as Prisma.InputJsonValue;
    if (outcome.status !== "matched") {
      // 没判出来也记下这次的原因，追溯页「待评分」备注随之更新
      await tx.answer.update({ where: { id: current.id }, data: { aiJudgment } });
      return { kind: "unclear", reason: outcome.reason } as const;
    }

    const previous: AnswerSnapshot = {
      optionLabel: current.optionLabel,
      score: current.score,
      rawText: current.rawText,
      source: current.source,
      status: current.status,
    };
    const next: AnswerSnapshot = { ...previous, optionLabel: outcome.optionLabel, score: outcome.score, status: "confirmed" };
    const editHistory = appendAnswerEditHistory(current.editHistory, previous, next, {
      at: new Date().toISOString(),
      operator: "system",
      reason: REJUDGE_REASON,
    });
    await tx.answer.update({
      where: { id: current.id },
      data: {
        optionLabel: next.optionLabel,
        score: next.score,
        status: next.status,
        aiJudgment,
        editHistory: editHistory as unknown as Prisma.InputJsonValue,
      },
    });

    // 采集中（in_progress）的会话只改答案，出报告时自然计入；已出报告的在同一事务内重算结论
    const { status } = session;
    if (status !== "collected" && status !== "confirmed") {
      return { kind: "scored", score: outcome.score, rescore: "none" } as const;
    }
    const { planRegenerated } = await rescoreReportedSession(tx, sessionId, status);
    return { kind: "scored", score: outcome.score, rescore: planRegenerated ? "regenerated" : "plan_kept" } as const;
  });
}
