/**
 * INPUT:  Prisma 事务、会话 id（答案已落库——医生代填或患者问询均可）
 * OUTPUT: acquireFinalizingLock / scoreAndSnapshot —— 评分快照生成的共享编排
 * POS:    "答案 → 确定性评分 → 落评估结果与候选干预方案快照"的唯一实现。
 *         医生端表单提交（src/lib/actions/doctor.ts）与患者端问询完成自动触发
 *         （src/lib/dialogue/service.ts）两条路径共用，避免评分触发逻辑漂移。
 *         M9-B 装机：评分走 src/lib/scoring-v2、推荐走 src/lib/recommend-v2（纯函数），
 *         本层只做答案投影、快照形状适配（report-types）与落库。
 *         M9.5：评分前由 system-read.ts 按患者档案自动作答「系统读取」条目（source=system）。
 *         M9.3/M9.4：评分前由 reuse.ts 按 01 表复用规则兜底同步跨量表回填（source=system），
 *         医生改答源题后回填在此同步纠正/撤回。
 */
import type { Prisma } from "@/generated/prisma/client";
import { scoreAllV2, type AnswersV2, type ScaleScoreResultV2 } from "@/lib/scoring-v2";
import { recommendV2, toPlanCandidates } from "@/lib/recommend-v2";
import { judgmentsV2, scaleV2ById } from "@/lib/rules/v2";
import type { AssessmentTag, QuestionScoreDetail, TagLevel } from "./report-types";
import { syncReuseAnswers, upsertSystemAnswers } from "./system-answers";
import { resolveSystemReadAnswers } from "./system-read";

export type FinalizeOutcome =
  | { kind: "completed" }
  | { kind: "incomplete"; missing: string[]; reasons: string[] };

/**
 * CAS 抢占会话进入 finalizing 态，防止并发触发评分导致答卷与结论错位。
 * 调用方需确保随后在同一事务内调用 scoreAndSnapshot（或在失败时自行处理）。
 */
export async function acquireFinalizingLock(
  tx: Prisma.TransactionClient,
  sessionId: string
): Promise<void> {
  const transitioned = await tx.assessmentSession.updateMany({
    where: { id: sessionId, status: "in_progress" },
    data: { status: "finalizing" },
  });
  if (transitioned.count !== 1) throw new Error("会话状态已变化，请刷新后重试");
}

/** 中医体质标签名「气虚质：倾向是」拆分为展示名 + 级别徽章；其余量表标签无级别后缀，恒"是" */
function splitTagName(name: string): { tag: string; level: TagLevel } {
  const levels: TagLevel[] = ["倾向是", "基本是", "是"];
  for (const level of levels) {
    if (name.endsWith(`：${level}`)) return { tag: name.slice(0, name.length - level.length - 1), level };
  }
  return { tag: name, level: "是" };
}

/** 中医体质标签编码 → 该体质计分题 id（judgments-v2.json 配置），用于标签下钻只展示本体质题目 */
function tcmQuestionIdsByTagCode(): ReadonlyMap<string, readonly string[]> {
  const entry = judgmentsV2.find((j) => j.scaleId === "tcm_constitution");
  const map = new Map<string, readonly string[]>();
  const tcm = entry?.judgments.find((j) => j.type === "tcmConstitutionV2");
  if (!tcm || tcm.type !== "tcmConstitutionV2") return map;
  const { balanced, biased } = tcm;
  for (const code of Object.values(balanced.tagCodes)) map.set(code, balanced.questionIds);
  for (const group of biased) {
    for (const code of Object.values(group.tagCodes)) map.set(code, group.questionIds);
  }
  return map;
}

/** V2 量表评分结果 → 报告页标签视图（AssessmentResult.tags 的元素） */
function toAssessmentTags(result: ScaleScoreResultV2, tcmQuestionIds: ReadonlyMap<string, readonly string[]>): AssessmentTag[] {
  if (!result.ok) return [];
  const scoredDetails: QuestionScoreDetail[] = result.details
    .filter((d) => !d.excluded && d.score !== null)
    .map((d) => ({
      questionId: d.itemId,
      no: d.no,
      title: d.text,
      rawScore: d.score as number,
      effectiveScore: d.score as number,
      reversed: false,
    }));
  return result.tags.map((tag) => {
    const { tag: displayName, level } = splitTagName(tag.name);
    // 中医体质：score 取该体质转化分，明细只留本体质题目；其余量表取总分与全量明细
    const constitution = result.constitutions?.find((c) => c.tagCode === tag.code);
    const questionIds = tcmQuestionIds.get(tag.code);
    return {
      tag: displayName,
      level,
      code: tag.code,
      scaleId: result.scaleId,
      score: constitution ? constitution.transformedScore : (result.totalScore ?? 0),
      detail: questionIds
        ? scoredDetails.filter((d) => questionIds.includes(d.questionId))
        : scoredDetails,
    };
  });
}

/**
 * 假定调用方已持有 finalizing 锁且本次答案已落库：评分 → 推荐 → 落快照。
 * 评分不完整（存在普通问答题"待人工确认"未补录，或非条目缺失类阻断如 MMSE 缺文化程度）时回退
 * in_progress，交还调用方处理（医生端展示缺失题目列表与阻断原因；患者端提示需要医生协助）。
 * deferClinical（Demo 口径）：系统读取/逻辑计算/操作测试等"医生题"缺失不再阻断评分，
 * 忽略其计分先出报告，被豁免的条目随快照存入 AssessmentResult.deferred，报告页如实标注"部分计分"。
 */
export async function scoreAndSnapshot(
  tx: Prisma.TransactionClient,
  sessionId: string,
  opts?: { deferClinical?: boolean }
): Promise<FinalizeOutcome> {
  const session = await tx.assessmentSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { patient: true },
  });

  // M9.5：「系统读取」条目在组装评分答案前由患者档案自动作答落库（source=system）。
  // 已有 confirmed 人工答案的题目跳过（系统读取不覆盖人工）；已有 system 答案内容一致跳过、
  // 不一致更新并留痕（editHistory 追加 operator=system 记录，落库细节见 system-answers.ts）。
  // 档案缺数据推不出的条目不落库，严格路径仍会阻断评分（医生补档案或代填），deferClinical 路径照旧豁免。
  const confirmedAnswers = await tx.answer.findMany({
    where: { sessionId, status: "confirmed" },
  });
  const manualConfirmed = new Set(
    confirmedAnswers.filter((a) => a.source !== "system").map((a) => a.questionId)
  );
  const systemReads = resolveSystemReadAnswers(session.patient, session.scaleIds as string[], {
    existing: manualConfirmed,
  });
  await upsertSystemAnswers(tx, sessionId, systemReads, "系统读取按档案数据自动重算");

  // M9.3/M9.4：跨量表复用回填兜底（01 表复用规则，当前为焦虑两问 ↔ GAD-7）。
  // 对话层已在患者作答时实时回填，此处兜底保证：医生在 CollectForm 改了焦虑两问答案后，
  // gad7 回填同步纠正（条件不再成立的旧回填撤回为 superseded）；strict 路径下回填到位的
  // gad7 题按 confirmed 参与评分、不再阻断。
  await syncReuseAnswers(tx, sessionId, session.scaleIds as string[]);

  const answers = await tx.answer.findMany({ where: { sessionId } });
  // 评分以归一化后的标准选项 label 为准（确定性红线：label 命中选项才能取分，见 scoring-v2/common）
  const answersV2: AnswersV2 = {};
  for (const answer of answers) {
    if (answer.status === "confirmed" && answer.optionLabel !== null) {
      answersV2[answer.questionId] = { kind: "option", label: answer.optionLabel };
    }
  }
  const scaleIds = session.scaleIds as string[];
  // M10.3a：thresholdByEducation（MMSE）判定需患者文化程度，从档案透传；缺失时引擎按 blockedReason 阻断
  const results = scoreAllV2(scaleIds, answersV2, {
    deferClinical: opts?.deferClinical,
    education: session.patient.education ?? undefined,
  });

  const incomplete = results.filter((result) => !result.ok);
  if (incomplete.length > 0) {
    const missing = incomplete.flatMap((result) => result.missing);
    // 非条目缺失类阻断（如 MMSE 缺文化程度）：随结果透出，医生端据提示补档案
    const reasons = incomplete.flatMap((result) => (result.blockedReason ? [result.blockedReason] : []));
    await tx.assessmentSession.update({
      where: { id: sessionId },
      data: { status: "in_progress" },
    });
    return { kind: "incomplete", missing, reasons };
  }

  const tcmQuestionIds = tcmQuestionIdsByTagCode();
  const tags = results.flatMap((result) => toAssessmentTags(result, tcmQuestionIds));
  const candidates = toPlanCandidates(recommendV2(tags.map((tag) => tag.code)));
  const now = new Date();
  // 被豁免计分的医生题（仅 deferClinical 患者自助路径可能非空），随快照留存供报告页标注
  const deferred = results
    .filter((result) => result.deferred.length > 0)
    .map((result) => ({
      scaleId: result.scaleId,
      scaleName: scaleV2ById.get(result.scaleId)?.name ?? result.scaleId,
      questionIds: result.deferred,
    }));
  // 结果与方案只保留一个"当前版本"；旧版本仅改状态，证据链和医生决策仍完整保留。
  await tx.assessmentResult.updateMany({
    where: { sessionId, status: "current" },
    data: { status: "superseded" },
  });
  await tx.interventionPlan.updateMany({
    where: { sessionId, status: { in: ["draft", "confirmed"] } },
    data: { status: "superseded" },
  });
  await tx.assessmentResult.create({
    data: {
      sessionId,
      tags: tags as unknown as Prisma.InputJsonValue,
      deferred: deferred as unknown as Prisma.InputJsonValue,
      status: "current",
      createdAt: now,
    },
  });
  await tx.interventionPlan.create({
    data: { sessionId, candidates: candidates as unknown as Prisma.InputJsonValue, status: "draft", createdAt: now },
  });
  const completed = await tx.assessmentSession.updateMany({
    where: { id: sessionId, status: "finalizing" },
    data: { status: "collected", completedAt: now },
  });
  if (completed.count !== 1) throw new Error("会话状态已变化，请刷新后重试");
  return { kind: "completed" };
}
