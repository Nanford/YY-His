/**
 * INPUT:  医生端表单提交（FormData）、Prisma 数据库、评分/推荐引擎
 * OUTPUT: 患者/评估会话/答案/评估结果/干预方案的全部写操作（Server Actions）
 * POS:    医生端业务流的唯一写入口。评分与推荐一律调用 src/lib/scoring、src/lib/recommend，
 *         本层只做参数解析、持久化与页面跳转，不实现任何医学规则。
 */
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { optionsOf, scaleById, scaleByQuestionId, questionById } from "@/lib/rules";
import { scoreAll, type AnswersByQuestionId } from "@/lib/scoring";
import { recommend, type RecommendedIntervention } from "@/lib/recommend";
import { appendAnswerEditHistory, type AnswerSnapshot } from "@/lib/assessment/audit";
import { applyPlanReview, type PlanReviewInput } from "@/lib/assessment/plan-review";
import {
  resolveMeasurementAnswers,
  type PatientMeasurements,
} from "@/lib/assessment/measurements";

// ---------- 患者 ----------

/** 生成可读的患者唯一编号，如 P20260714-X3F9。出网调用只允许携带此编号（PII 红线） */
async function generatePatientCode(): Promise<string> {
  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉易混淆的 I/O/0/1
  for (let attempt = 0; attempt < 5; attempt++) {
    let suffix = "";
    for (let i = 0; i < 4; i++) {
      suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    const code = `P${ymd}-${suffix}`;
    const exists = await prisma.patient.findUnique({ where: { code } });
    if (!exists) return code;
  }
  throw new Error("患者编号生成失败，请重试");
}

function textOrNull(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "" ? null : trimmed;
}

function numberOrNull(formData: FormData, key: string): number | null {
  const raw = textOrNull(formData, key);
  if (raw === null) return null;
  return Number(raw);
}

const patientSchema = z.object({
  name: z.string().trim().min(1).max(50),
  gender: z.enum(["男", "女"]),
  age: z.number().int().min(1).max(130),
});

const measurementsSchema = z.object({
  heightCm: z.number().positive().max(300).nullable(),
  weightKg: z.number().positive().max(500).nullable(),
  waistCm: z.number().positive().max(300).nullable(),
  calfCm: z.number().positive().max(200).nullable(),
});

type Measurements = z.infer<typeof measurementsSchema>;

function parseMeasurements(formData: FormData): Measurements | null {
  const parsed = measurementsSchema.safeParse({
    heightCm: numberOrNull(formData, "heightCm"),
    weightKg: numberOrNull(formData, "weightKg"),
    waistCm: numberOrNull(formData, "waistCm"),
    calfCm: numberOrNull(formData, "calfCm"),
  });
  return parsed.success ? parsed.data : null;
}

function assertRecordId(value: string, label: string): void {
  if (typeof value !== "string" || value.length < 5 || value.length > 128) {
    throw new Error(`${label}无效`);
  }
}

export async function createPatient(formData: FormData): Promise<void> {
  const identity = patientSchema.safeParse({
    name: textOrNull(formData, "name"),
    gender: textOrNull(formData, "gender"),
    age: Number(textOrNull(formData, "age")),
  });
  // 姓名/性别/年龄为必填项（需求文档"第一步：基础信息录入"）
  if (!identity.success) {
    redirect("/doctor/patients/new?error=required");
  }
  const measurements = parseMeasurements(formData);
  if (!measurements) redirect("/doctor/patients/new?error=measurements");

  const patient = await prisma.patient.create({
    data: {
      code: await generatePatientCode(),
      ...identity.data,
      phone: textOrNull(formData, "phone"),
      idCard: textOrNull(formData, "idCard"),
      address: textOrNull(formData, "address"),
      admissionNo: textOrNull(formData, "admissionNo"),
      outpatientNo: textOrNull(formData, "outpatientNo"),
      ...measurements,
    },
  });
  revalidatePath("/doctor");
  redirect(`/doctor/patients/${patient.id}`);
}

export async function updateMeasurements(patientId: string, formData: FormData): Promise<void> {
  assertRecordId(patientId, "患者编号");
  const measurements = parseMeasurements(formData);
  if (!measurements) redirect(`/doctor/patients/${patientId}?error=measurements`);

  await prisma.$transaction(async (tx) => {
    const patient = await tx.patient.update({ where: { id: patientId }, data: measurements });
    const sessions = await tx.assessmentSession.findMany({
      where: { patientId, status: "in_progress" },
      select: { id: true, scaleIds: true },
    });
    for (const session of sessions) {
      await syncMeasurementAnswers(tx, session.id, session.scaleIds as string[], patient);
    }
  });
  revalidatePath(`/doctor/patients/${patientId}`);
  redirect(`/doctor/patients/${patientId}?saved=measurements`);
}

// ---------- 评估会话 ----------

const ALL_SCALE_IDS = ["frail", "mnasf", "fall", "tcm"] as const;

export async function createSession(patientId: string, formData: FormData): Promise<void> {
  assertRecordId(patientId, "患者编号");
  const patient = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!patient) throw new Error("患者不存在");

  const scaleIds = ALL_SCALE_IDS.filter((id) => formData.get(`scale.${id}`) === "on");
  if (scaleIds.length === 0) {
    redirect(`/doctor/patients/${patientId}?error=no-scale`);
  }
  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.assessmentSession.create({
      data: { patientId, scaleIds, status: "in_progress" },
    });
    await syncMeasurementAnswers(tx, created.id, scaleIds, patient);
    return created;
  });
  redirect(`/doctor/sessions/${session.id}`);
}

function allowedQuestionIds(scaleIds: readonly string[]): Set<string> {
  const ids = new Set<string>();
  for (const scaleId of scaleIds) {
    const scale = scaleById.get(scaleId);
    if (!scale) throw new Error(`会话包含未知量表：${scaleId}`);
    for (const question of scale.questions) ids.add(question.id);
  }
  return ids;
}

/** 测量题只读取本地患者测量数据，按纯函数换算并写入；任何客户端提交值都会被忽略。 */
async function syncMeasurementAnswers(
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

/**
 * 解析表单中的 answer.<questionId> 字段并逐题落库（医生代填 → confirmed）。
 * Server Action 是不可信入口：题目必须属于本会话，分值必须命中规则选项；测量题拒绝采用客户端分值。
 */
async function persistAnswersFromForm(
  tx: Prisma.TransactionClient,
  sessionId: string,
  formData: FormData,
  expectedStatus: "in_progress" | "finalizing"
): Promise<void> {
  assertRecordId(sessionId, "会话编号");
  const session = await tx.assessmentSession.findUnique({
    where: { id: sessionId },
    include: { answers: true },
  });
  if (!session) throw new Error("评估会话不存在");
  if (session.status !== expectedStatus) throw new Error("当前会话状态不允许修改答案");

  const allowed = allowedQuestionIds(session.scaleIds as string[]);
  const submitted = new Map<string, { optionLabel: string; score: number }>();
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("answer.") || typeof value !== "string" || value === "") continue;
    const questionId = key.slice("answer.".length);
    if (!allowed.has(questionId)) throw new Error(`题目不属于本次评估：${questionId}`);
    if (submitted.has(questionId)) throw new Error(`题目重复提交：${questionId}`);
    const question = questionById.get(questionId);
    const scale = scaleByQuestionId.get(questionId);
    if (!question || !scale) throw new Error(`未知题目：${questionId}`);
    if (question.measurement) continue; // 测量题只能由服务端依据本地测量数据换算
    const score = Number(value);
    const option = optionsOf(scale, question).find((o) => o.score === score);
    if (!option) throw new Error(`题目分值无效：${questionId}`);
    submitted.set(questionId, { optionLabel: option.label, score });
  }

  const existingByQuestionId = new Map(session.answers.map((answer) => [answer.questionId, answer]));
  const now = new Date().toISOString();
  for (const [questionId, answer] of submitted) {
    const existing = existingByQuestionId.get(questionId);
    const next: AnswerSnapshot = {
      optionLabel: answer.optionLabel,
      score: answer.score,
      rawText: existing?.rawText ?? null,
      source: "doctor",
      status: "confirmed",
    };
    if (!existing) {
      await tx.answer.create({ data: { sessionId, questionId, ...next } });
      continue;
    }

    const previous: AnswerSnapshot = {
      optionLabel: existing.optionLabel,
      score: existing.score,
      rawText: existing.rawText,
      source: existing.source,
      status: existing.status,
    };
    const editHistory = appendAnswerEditHistory(existing.editHistory, previous, next, {
      at: now,
      operator: "doctor",
      reason: "医生代填或修改标准答案",
    });
    await tx.answer.update({
      where: { id: existing.id },
      data: {
        ...next,
        editHistory: editHistory as unknown as Prisma.InputJsonValue,
      },
    });
  }
}

export async function saveAnswers(sessionId: string, formData: FormData): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await persistAnswersFromForm(tx, sessionId, formData, "in_progress");
    const session = await tx.assessmentSession.findUnique({
      where: { id: sessionId },
      include: { patient: true },
    });
    if (!session || session.status !== "in_progress") throw new Error("当前会话状态不允许更新测量题");
    await syncMeasurementAnswers(tx, session.id, session.scaleIds as string[], session.patient);
  });
  revalidatePath(`/doctor/sessions/${sessionId}`);
  redirect(`/doctor/sessions/${sessionId}?saved=1`);
}

/** 保存答案 → 确定性评分 → 生成评估标签与候选干预方案（核心数据流的落库点） */
export async function finalizeSession(sessionId: string, formData: FormData): Promise<void> {
  assertRecordId(sessionId, "会话编号");
  const outcome = await prisma.$transaction(async (tx) => {
    // 先以 CAS 抢占会话，再在同一事务内写答案、评分和落快照，避免并发保存造成答卷与结论错位。
    const transitioned = await tx.assessmentSession.updateMany({
      where: { id: sessionId, status: "in_progress" },
      data: { status: "finalizing" },
    });
    if (transitioned.count !== 1) throw new Error("会话状态已变化，请刷新后重试");

    await persistAnswersFromForm(tx, sessionId, formData, "finalizing");
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
    const scored = scoreAll(session.scaleIds as string[], answersMap as AnswersByQuestionId);
    if (scored.incompleteScaleIds.length > 0) {
      const missing = scored.results.flatMap((result) => result.missing);
      await tx.assessmentSession.update({
        where: { id: sessionId },
        data: { status: "in_progress" },
      });
      return { kind: "incomplete" as const, missing };
    }

    const plan = recommend(scored.tags);
    const now = new Date();
    // 结果与方案只保留一个“当前版本”；旧版本仅改状态，证据链和医生决策仍完整保留。
    await tx.assessmentResult.updateMany({
      where: { sessionId, status: "current" },
      data: { status: "superseded" },
    });
    await tx.interventionPlan.updateMany({
      where: { sessionId, status: { in: ["draft", "confirmed"] } },
      data: { status: "superseded" },
    });
    await tx.assessmentResult.create({
      data: { sessionId, tags: scored.tags as unknown as Prisma.InputJsonValue, status: "current", createdAt: now },
    });
    await tx.interventionPlan.create({
      data: { sessionId, candidates: plan.flat as unknown as Prisma.InputJsonValue, status: "draft", createdAt: now },
    });
    const completed = await tx.assessmentSession.updateMany({
      where: { id: sessionId, status: "finalizing" },
      data: { status: "collected", completedAt: now },
    });
    if (completed.count !== 1) throw new Error("会话状态已变化，请刷新后重试");
    return { kind: "completed" as const };
  });

  if (outcome.kind === "incomplete") {
    redirect(`/doctor/sessions/${sessionId}?error=incomplete&missing=${outcome.missing.join(",")}`);
  }
  revalidatePath(`/doctor/sessions/${sessionId}`);
  redirect(`/doctor/sessions/${sessionId}`);
}

/** 返回修改答案：答案与历史快照全部保留，并关闭旧结果/方案的“当前版本”状态。 */
export async function reopenSession(sessionId: string): Promise<void> {
  assertRecordId(sessionId, "会话编号");
  await prisma.$transaction(async (tx) => {
    const transitioned = await tx.assessmentSession.updateMany({
      where: { id: sessionId, status: { in: ["collected", "confirmed"] } },
      data: { status: "in_progress", completedAt: null },
    });
    if (transitioned.count !== 1) throw new Error("当前会话状态不允许返回修改");
    await tx.assessmentResult.updateMany({ where: { sessionId, status: "current" }, data: { status: "superseded" } });
    await tx.interventionPlan.updateMany({
      where: { sessionId, status: { in: ["draft", "confirmed"] } },
      data: { status: "superseded" },
    });
    const session = await tx.assessmentSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: { patient: true },
    });
    await syncMeasurementAnswers(tx, session.id, session.scaleIds as string[], session.patient);
  });
  revalidatePath(`/doctor/sessions/${sessionId}`);
  redirect(`/doctor/sessions/${sessionId}`);
}

/** 医生审核候选方案：勾选保留项 → 形成最终干预方案（需求文档"第四步"医生确认环节） */
export async function confirmPlan(sessionId: string, formData: FormData): Promise<void> {
  assertRecordId(sessionId, "会话编号");
  const session = await prisma.assessmentSession.findUnique({ where: { id: sessionId }, select: { status: true } });
  if (!session) throw new Error("评估会话不存在");
  if (session.status !== "collected") throw new Error("当前会话状态不允许确认方案");

  const plan = await prisma.interventionPlan.findFirstOrThrow({
    where: { sessionId, status: "draft" },
    orderBy: { createdAt: "desc" },
  });
  const candidates = plan.candidates as unknown as RecommendedIntervention[];
  const inputs: Record<string, PlanReviewInput> = {};
  for (const candidate of candidates) {
    const adjustedPlan = textOrNull(formData, `plan.${candidate.tag}`);
    const note = textOrNull(formData, `note.${candidate.tag}`);
    if (adjustedPlan && adjustedPlan.length > 20_000) throw new Error(`方案正文过长：${candidate.tag}`);
    if (note && note.length > 500) throw new Error(`审核说明过长：${candidate.tag}`);
    inputs[candidate.tag] = {
      keep: formData.get(`keep.${candidate.tag}`) === "on",
      plan: adjustedPlan ?? candidate.plan,
      note: note ?? undefined,
    };
  }
  const now = new Date();
  const reviewed = applyPlanReview(candidates, inputs, now);
  // 允许空候选或医生删除全部候选；“暂无推荐”也是需要留痕确认的正式结论。
  await prisma.$transaction(async (tx) => {
    const planUpdated = await tx.interventionPlan.updateMany({
      where: { id: plan.id, status: "draft" },
      data: {
        decisions: reviewed.decisions as unknown as Prisma.InputJsonValue,
        finalPlan: reviewed.finalPlan as unknown as Prisma.InputJsonValue,
        status: "confirmed",
        confirmedAt: now,
      },
    });
    if (planUpdated.count !== 1) throw new Error("候选方案已被处理，请刷新后重试");
    const sessionUpdated = await tx.assessmentSession.updateMany({
      where: { id: sessionId, status: "collected" },
      data: { status: "confirmed" },
    });
    if (sessionUpdated.count !== 1) throw new Error("会话状态已变化，请刷新后重试");
  });
  revalidatePath(`/doctor/sessions/${sessionId}`);
  redirect(`/doctor/sessions/${sessionId}`);
}
