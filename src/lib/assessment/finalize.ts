/**
 * INPUT:  Prisma 事务、会话 id（答案已落库——医生代填或患者问询均可）
 * OUTPUT: acquireFinalizingLock / scoreAndSnapshot —— 评分快照生成的共享编排
 * POS:    "答案 → 确定性评分 → 落评估结果与候选干预方案快照"的唯一实现。
 *         医生端表单提交（src/lib/actions/doctor.ts）与患者端问询完成自动触发
 *         （src/lib/dialogue/service.ts）两条路径共用，避免评分触发逻辑漂移。
 *         评分与推荐本身仍是 src/lib/scoring、src/lib/recommend 的纯函数，本层只做编排。
 */
import type { Prisma } from "@/generated/prisma/client";
import { scoreAll, type AnswersByQuestionId } from "@/lib/scoring";
import { recommend } from "@/lib/recommend";
import { syncMeasurementAnswers } from "./measurement-sync";

export type FinalizeOutcome = { kind: "completed" } | { kind: "incomplete"; missing: string[] };

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

/**
 * 假定调用方已持有 finalizing 锁且本次答案已落库：同步测量题 → 评分 → 落快照。
 * 评分不完整（存在普通问答题"待人工确认"未补录）时回退 in_progress，
 * 交还调用方处理（医生端展示缺失题目列表；患者端提示需要医生协助）。
 * deferClinical（Demo 口径，2026-07-20 用户拍板，仅患者自助路径传入）：
 * 测量/观察类"医生题"缺失不再阻断评分，忽略其计分先出报告，
 * 被豁免的题目随快照存入 AssessmentResult.deferred，报告页如实标注"部分计分"。
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
  await syncMeasurementAnswers(tx, session.id, session.scaleIds as string[], session.patient);

  const answers = await tx.answer.findMany({ where: { sessionId } });
  const answersMap: Record<string, number> = {};
  for (const answer of answers) {
    if (answer.status === "confirmed" && answer.score !== null) {
      answersMap[answer.questionId] = answer.score;
    }
  }
  const scored = scoreAll(session.scaleIds as string[], answersMap as AnswersByQuestionId, {
    deferClinical: opts?.deferClinical,
  });
  if (scored.incompleteScaleIds.length > 0) {
    const missing = scored.results.flatMap((result) => result.missing);
    await tx.assessmentSession.update({
      where: { id: sessionId },
      data: { status: "in_progress" },
    });
    return { kind: "incomplete", missing };
  }

  const plan = recommend(scored.tags);
  const now = new Date();
  // 被豁免计分的医生题（仅 deferClinical 患者自助路径可能非空），随快照留存供报告页标注
  const deferred = scored.results
    .filter((result) => result.deferred.length > 0)
    .map((result) => ({ scaleId: result.scaleId, scaleName: result.scaleName, questionIds: result.deferred }));
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
      tags: scored.tags as unknown as Prisma.InputJsonValue,
      deferred: deferred as unknown as Prisma.InputJsonValue,
      status: "current",
      createdAt: now,
    },
  });
  await tx.interventionPlan.create({
    data: { sessionId, candidates: plan.flat as unknown as Prisma.InputJsonValue, status: "draft", createdAt: now },
  });
  const completed = await tx.assessmentSession.updateMany({
    where: { id: sessionId, status: "finalizing" },
    data: { status: "collected", completedAt: now },
  });
  if (completed.count !== 1) throw new Error("会话状态已变化，请刷新后重试");
  return { kind: "completed" };
}
