/**
 * INPUT:  患者测量数据、会话勾选量表、Prisma 事务
 * OUTPUT: syncMeasurementAnswers —— 按测量值换算并落库测量题答案（含审计留痕）
 * POS:    DB IO 层，包裹 src/lib/assessment/measurements 的纯函数换算结果。
 *         医生代填与患者自助问询流程共用；任何客户端提交的测量题分值一律忽略，
 *         只信任本地 Patient 表的身高/体重/腹围/小腿围。
 */
import type { Prisma } from "@/generated/prisma/client";
import { appendAnswerEditHistory, type AnswerSnapshot } from "./audit";
import { resolveMeasurementAnswers, type PatientMeasurements } from "./measurements";

export async function syncMeasurementAnswers(
  tx: Prisma.TransactionClient,
  sessionId: string,
  scaleIds: readonly string[],
  patient: PatientMeasurements
): Promise<void> {
  const resolutions = resolveMeasurementAnswers(patient, scaleIds);
  if (resolutions.length === 0) return;

  const existing = await tx.answer.findMany({
    where: { sessionId, questionId: { in: resolutions.map((item) => item.questionId) } },
  });
  const existingByQuestionId = new Map(existing.map((answer) => [answer.questionId, answer]));
  const now = new Date().toISOString();

  for (const resolution of resolutions) {
    const previousAnswer = existingByQuestionId.get(resolution.questionId);
    const next: AnswerSnapshot = {
      optionLabel: resolution.optionLabel,
      score: resolution.score,
      rawText: resolution.rawText,
      source: "measurement",
      status: resolution.status,
    };
    const aiJudgment = {
      type: "local_measurement_rule",
      reason: resolution.reason,
    } as Prisma.InputJsonValue;

    if (!previousAnswer) {
      await tx.answer.create({
        data: { sessionId, questionId: resolution.questionId, ...next, aiJudgment },
      });
      continue;
    }

    const previous: AnswerSnapshot = {
      optionLabel: previousAnswer.optionLabel,
      score: previousAnswer.score,
      rawText: previousAnswer.rawText,
      source: previousAnswer.source,
      status: previousAnswer.status,
    };
    const editHistory = appendAnswerEditHistory(previousAnswer.editHistory, previous, next, {
      at: now,
      operator: "system",
      reason: resolution.reason,
    });
    await tx.answer.update({
      where: { id: previousAnswer.id },
      data: {
        ...next,
        aiJudgment,
        editHistory: editHistory as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
