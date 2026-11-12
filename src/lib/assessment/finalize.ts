/**
 * INPUT:  Prisma 事务、会话 id（答案已落库——医生代填或患者问询均可）
 * OUTPUT: acquireFinalizingLock / scoreAndSnapshot —— 评分快照生成的共享编排；
 *         rescoreReportedSession —— 已出报告后改了个别答案时重算结论（会话状态不变）
 * POS:    "答案 → 确定性评分 → 落评估结果与候选干预方案快照"的唯一实现。
 *         医生端表单提交（src/lib/actions/doctor.ts）与患者端问询完成自动触发
 *         （src/lib/dialogue/service.ts）两条路径共用，避免评分触发逻辑漂移。
 *         M9-B 装机：评分走 src/lib/scoring-v2、推荐走 src/lib/recommend-v2（纯函数），
 *         本层只做答案投影、快照形状适配（report-types）与落库。
 *         M9.5：评分前由 system-read.ts 按患者档案自动作答「系统读取」条目（source=system）。
 *         M9.3/M9.4：评分前由 reuse.ts 按 01 表复用规则兜底同步跨量表回填（source=system），
 *         医生改答源题后回填在此同步纠正/撤回。
 *         2026-11-12：评分抽成 scoreSession 供出报告与重算共用；重算入口 rescoreReportedSession
 *         服务画图题「AI 重新评分」，已确认的干预方案不重排。
 */
import type { Prisma } from "@/generated/prisma/client";
import { scoreAllV2, type AnswersV2, type ScaleScoreResultV2 } from "@/lib/scoring-v2";
import { recommendV2, toPlanCandidates } from "@/lib/recommend-v2";
import { judgmentsV2, scaleV2ById } from "@/lib/rules/v2";
import { splitTagName, type AssessmentTag, type QuestionScoreDetail } from "./report-types";
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
      rawScore: d.rawScore ?? (d.score as number),
      effectiveScore: d.effectiveScore ?? (d.score as number),
      reversed: d.reversed ?? false,
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

/** 一个量表里被豁免计分的条目（AssessmentResult.deferred 的元素） */
interface DeferredScaleItems {
  scaleId: string;
  scaleName: string;
  questionIds: string[];
}

/** 一次评分的产出：阻断（缺条目/缺档案），或落快照用的标签与豁免条目 */
type SessionScoring =
  | { kind: "incomplete"; missing: string[]; reasons: string[] }
  | { kind: "scored"; tags: AssessmentTag[]; deferred: DeferredScaleItems[] };

/**
 * 系统读取与复用回填兜底后，按已确认答案做确定性评分（不落结果快照、不动会话状态）。
 * scoreAndSnapshot（出报告）与 rescoreReportedSession（已出报告后重算）共用，避免评分口径漂移。
 */
async function scoreSession(
  tx: Prisma.TransactionClient,
  sessionId: string,
  opts?: { deferClinical?: boolean }
): Promise<SessionScoring> {
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
    return { kind: "incomplete", missing, reasons };
  }

  const tcmQuestionIds = tcmQuestionIdsByTagCode();
  const tags = results.flatMap((result) => toAssessmentTags(result, tcmQuestionIds));
  // 被豁免计分的医生题（仅 deferClinical 患者自助路径可能非空），随快照留存供报告页标注
  const deferred = results
    .filter((result) => result.deferred.length > 0)
    .map((result) => ({
      scaleId: result.scaleId,
      scaleName: scaleV2ById.get(result.scaleId)?.name ?? result.scaleId,
      questionIds: result.deferred,
    }));
  return { kind: "scored", tags, deferred };
}

// 结果与方案只保留一个"当前版本"；旧版本仅改状态，证据链和医生决策仍完整保留。

/** 落一份新的当前评估结果，旧的改 superseded */
async function replaceCurrentResult(
  tx: Prisma.TransactionClient,
  sessionId: string,
  scoring: Extract<SessionScoring, { kind: "scored" }>,
  now: Date
): Promise<void> {
  await tx.assessmentResult.updateMany({
    where: { sessionId, status: "current" },
    data: { status: "superseded" },
  });
  await tx.assessmentResult.create({
    data: {
      sessionId,
      tags: scoring.tags as unknown as Prisma.InputJsonValue,
      deferred: scoring.deferred as unknown as Prisma.InputJsonValue,
      status: "current",
      createdAt: now,
    },
  });
}

/** 按评估标签重新生成候选干预方案（draft），旧的（含已确认版本）改 superseded */
async function replaceDraftPlan(
  tx: Prisma.TransactionClient,
  sessionId: string,
  tags: readonly AssessmentTag[],
  now: Date
): Promise<void> {
  const candidates = toPlanCandidates(recommendV2(tags.map((tag) => tag.code)));
  await tx.interventionPlan.updateMany({
    where: { sessionId, status: { in: ["draft", "confirmed"] } },
    data: { status: "superseded" },
  });
  await tx.interventionPlan.create({
    data: { sessionId, candidates: candidates as unknown as Prisma.InputJsonValue, status: "draft", createdAt: now },
  });
}

/**
 * 假定调用方已持有 finalizing 锁且本次答案已落库：评分 → 推荐 → 落快照。
 * strict（医生端）：任何条目缺失都阻断并回退 in_progress，交医生补录。
 * deferClinical（患者自助 Demo 口径）：缺失条目一律豁免计分、按已答题目计分先出报告，
 * 被豁免条目随快照存 AssessmentResult.deferred，报告页如实标注「部分计分」——
 * 2026-08-13 用户拍板「不需要医生确认，直接生成评估报告」，普通问答题答不清
 * （待人工确认）也不再阻断（2026-07-20 的旧口径废止）；零条已答的量表仍不产标签
 * （scoring-v2 全豁免守卫）。非条目缺失类阻断（MMSE 缺文化程度）在 deferClinical
 * 下按四档一致规则降级判定，见 threshold-by-education.ts。
 */
export async function scoreAndSnapshot(
  tx: Prisma.TransactionClient,
  sessionId: string,
  opts?: { deferClinical?: boolean }
): Promise<FinalizeOutcome> {
  const scoring = await scoreSession(tx, sessionId, opts);
  if (scoring.kind === "incomplete") {
    await tx.assessmentSession.update({
      where: { id: sessionId },
      data: { status: "in_progress" },
    });
    return { kind: "incomplete", missing: scoring.missing, reasons: scoring.reasons };
  }

  const now = new Date();
  await replaceCurrentResult(tx, sessionId, scoring, now);
  await replaceDraftPlan(tx, sessionId, scoring.tags, now);
  const completed = await tx.assessmentSession.updateMany({
    where: { id: sessionId, status: "finalizing" },
    data: { status: "collected", completedAt: now },
  });
  if (completed.count !== 1) throw new Error("会话状态已变化，请刷新后重试");
  return { kind: "completed" };
}

/**
 * 已出报告的会话改了个别答案后重算评估结论，会话状态不变（目前只有画图题「AI 重新评分」调用，
 * 见 drawing-rejudge.ts）。方案尚未确认（collected）→ 按新标签重新生成候选方案；
 * 医生已确认（confirmed）→ 只更新评估结果、保留已确认方案（2026-11-12 用户拍板：确认过的方案不自动重排，
 * 需要按新结论调整由医生「重新打开并修正答案」）。
 * 按 deferClinical 评分：能带着「待评分」答案出报告的只有患者自助路径（医生端 strict 路径会阻断），与出报告时同口径。
 * 调用方须在同一事务内已把答案落库，并已确认会话处于 collected / confirmed。
 * @throws 评分阻断（deferClinical 下理论上不会发生）时抛错，由调用方事务整体回滚，答案与结论不会错位
 */
export async function rescoreReportedSession(
  tx: Prisma.TransactionClient,
  sessionId: string,
  status: "collected" | "confirmed"
): Promise<{ planRegenerated: boolean }> {
  const scoring = await scoreSession(tx, sessionId, { deferClinical: true });
  if (scoring.kind === "incomplete") {
    throw new Error(`重算评估结论被阻断：${[...scoring.reasons, ...scoring.missing].join("；")}`);
  }
  const now = new Date();
  await replaceCurrentResult(tx, sessionId, scoring, now);
  if (status === "confirmed") return { planRegenerated: false };
  await replaceDraftPlan(tx, sessionId, scoring.tags, now);
  return { planRegenerated: true };
}
