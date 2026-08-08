/**
 * INPUT:  医生端表单提交（FormData）、Prisma 数据库、评分/推荐引擎
 * OUTPUT: 患者/评估会话/答案/评估结果/干预方案的全部写操作（Server Actions）
 * POS:    医生端业务流的唯一写入口。评分与推荐一律调用 src/lib/scoring、src/lib/recommend，
 *         本层只做参数解析、持久化与页面跳转，不实现任何医学规则。
 */
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { MULTI_CHOICE_SEP, optionsOf, scaleById, scaleByQuestionId, questionById } from "@/lib/rules";
import { parseSessionScaleSelection } from "@/lib/assessment/scale-packages";
import { buildInterventionV2, FORBIDDEN_SCORE_V2, type PlanCandidateItemV2, type PlanCandidatesV2 } from "@/lib/recommend-v2";
import type { AssessmentTag } from "@/lib/assessment/report-types";
import { appendAnswerEditHistory, type AnswerSnapshot } from "@/lib/assessment/audit";
import { applyPlanReview, type PlanReviewInput } from "@/lib/assessment/plan-review";
import { acquireFinalizingLock, scoreAndSnapshot } from "@/lib/assessment/finalize";
import {
  buildV2ProfileExtensions,
  generatePatientCode,
  parseMeasurements,
  patientIdentitySchema as patientSchema,
  textOrNull,
} from "@/lib/assessment/patient-intake";

// ---------- 患者 ----------

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
  // V2 基础信息扩展（docx §1，全部选填）：任一项非法则整体拒绝，避免部分入库部分丢失
  const v2 = buildV2ProfileExtensions(formData);
  if (!v2) redirect("/doctor/patients/new?error=profile");

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
      education: v2.education,
      maritalStatus: v2.maritalStatus,
      livingSituation: v2.livingSituation,
      careSituation: v2.careSituation,
      calfLeftCm: v2.calfLeftCm,
      calfRightCm: v2.calfRightCm,
      gripStrengthKg: v2.gripStrengthKg,
      gaitSpeed6mSec: v2.gaitSpeed6mSec,
      // Json 字段缺省时键缺省（Prisma Json? 不接受顶层 null）；接口类型无索引签名，按 InputJsonValue 断言
      ...(v2.diagnoses ? { diagnoses: v2.diagnoses } : {}),
      ...(v2.pastHistory ? { pastHistory: v2.pastHistory } : {}),
      ...(v2.recentAcute ? { recentAcute: v2.recentAcute } : {}),
      ...(v2.medications ? { medications: v2.medications as unknown as Prisma.InputJsonValue } : {}),
      ...(v2.weightHistory ? { weightHistory: v2.weightHistory as unknown as Prisma.InputJsonValue } : {}),
    },
  });
  revalidatePath("/doctor");
  redirect(`/doctor/patients/${patient.id}`);
}

export async function updateMeasurements(patientId: string, formData: FormData): Promise<void> {
  assertRecordId(patientId, "患者编号");
  const measurements = parseMeasurements(formData);
  if (!measurements) redirect(`/doctor/patients/${patientId}?error=measurements`);

  await prisma.patient.update({ where: { id: patientId }, data: measurements });
  revalidatePath(`/doctor/patients/${patientId}`);
  redirect(`/doctor/patients/${patientId}?saved=measurements`);
}

// ---------- 评估会话 ----------

export async function createSession(patientId: string, formData: FormData): Promise<void> {
  assertRecordId(patientId, "患者编号");
  const patient = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!patient) throw new Error("患者不存在");

  // 随访对比复评（docx §2(3)）：上次范围以数据库中最近一次已出报告会话为准，客户端提交值不作数
  const lastReported = await prisma.assessmentSession.findFirst({
    where: { patientId, status: { in: ["collected", "confirmed"] } },
    orderBy: { startedAt: "desc" },
  });
  // 量表工具选择（docx §2）解析口径收敛在 scale-packages：套餐 / 自定义组合 / 随访复评 / 旧表单字段
  const scaleIds = parseSessionScaleSelection(formData, {
    followupScaleIds: lastReported ? (lastReported.scaleIds as string[]) : undefined,
  });
  if (!scaleIds) {
    redirect(`/doctor/patients/${patientId}?error=no-scale`);
  }
  const session = await prisma.assessmentSession.create({
    data: { patientId, scaleIds, status: "in_progress" },
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
  // 先按题目聚合（多选 checkbox 同名多值）
  const byQuestion = new Map<string, string[]>();
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("answer.") || typeof value !== "string" || value === "") continue;
    const questionId = key.slice("answer.".length);
    if (!allowed.has(questionId)) throw new Error(`题目不属于本次评估：${questionId}`);
    const list = byQuestion.get(questionId) ?? [];
    list.push(value);
    byQuestion.set(questionId, list);
  }
  for (const [questionId, values] of byQuestion) {
    const question = questionById.get(questionId);
    const scale = scaleByQuestionId.get(questionId);
    if (!question || !scale) throw new Error(`未知题目：${questionId}`);
    const options = optionsOf(scale, question);
    if (question.answerType === "number") {
      // 数字题：表单提交分值字符串 → 反查 label
      const score = Number(values[0]);
      if (!Number.isInteger(score)) throw new Error(`题目分值无效：${questionId}`);
      const option = options.find((o) => o.score === score);
      if (!option) throw new Error(`题目选项无效：${questionId}`);
      submitted.set(questionId, { optionLabel: option.label, score: option.score });
      continue;
    }
    if (question.answerType === "multiChoice") {
      const labels = [...new Set(values)];
      for (const lab of labels) {
        if (!options.some((o) => o.label === lab)) throw new Error(`题目选项无效：${questionId}`);
      }
      submitted.set(questionId, { optionLabel: labels.join(MULTI_CHOICE_SEP), score: 0 });
      continue;
    }
    // 单选：label
    if (values.length !== 1) throw new Error(`题目重复提交：${questionId}`);
    const option = options.find((o) => o.label === values[0]);
    if (!option) throw new Error(`题目选项无效：${questionId}`);
    submitted.set(questionId, { optionLabel: option.label, score: option.score });
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
  });
  revalidatePath(`/doctor/sessions/${sessionId}`);
  redirect(`/doctor/sessions/${sessionId}?saved=1`);
}

/**
 * 保存答案 → 确定性评分 → 生成评估标签与候选干预方案（核心数据流的落库点）。
 * 评分/推荐/落快照的编排逻辑与患者端问询完成自动触发（src/lib/dialogue/service.ts）共用
 * src/lib/assessment/finalize，本函数只负责解析医生表单并抢占并发锁。
 */
export async function finalizeSession(sessionId: string, formData: FormData): Promise<void> {
  assertRecordId(sessionId, "会话编号");
  const outcome = await prisma.$transaction(async (tx) => {
    // 先以 CAS 抢占会话，再在同一事务内写答案、评分和落快照，避免并发保存造成答卷与结论错位。
    await acquireFinalizingLock(tx, sessionId);
    await persistAnswersFromForm(tx, sessionId, formData, "finalizing");
    return scoreAndSnapshot(tx, sessionId);
  });

  if (outcome.kind === "incomplete") {
    const reasons = outcome.reasons.length > 0 ? `&reasons=${encodeURIComponent(outcome.reasons.join("；"))}` : "";
    redirect(`/doctor/sessions/${sessionId}?error=incomplete&missing=${outcome.missing.join(",")}${reasons}`);
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
  // 取本次当前评估标签编码，用于计算"同类替换"项对本次患者的积分（可追溯）
  const result = await prisma.assessmentResult.findFirst({
    where: { sessionId, status: "current" },
    orderBy: { createdAt: "desc" },
  });
  const tagCodes = ((result?.tags ?? []) as unknown as AssessmentTag[]).map((tag) => tag.code);

  const candidatesSnapshot = plan.candidates as unknown as PlanCandidatesV2;
  const candidates = candidatesSnapshot.items;
  // 本患者被 -100 禁止的干预明细（随候选快照落库）：同类替换命中即硬拦截（禁忌红线）
  const forbiddenList = candidatesSnapshot.forbidden ?? [];
  const inputs: Record<string, PlanReviewInput> = {};
  for (const candidate of candidates) {
    const action = textOrNull(formData, `action.${candidate.code}`) ?? "keep";
    const note = textOrNull(formData, `note.${candidate.code}`);
    if (note && note.length > 500) throw new Error(`审核说明过长：${candidate.code}`);

    if (action === "remove") {
      inputs[candidate.code] = { action: "remove", note: note ?? undefined };
    } else if (action === "replace") {
      const toCode = textOrNull(formData, `replaceWith.${candidate.code}`);
      if (!toCode) throw new Error(`未选择替换项：${candidate.code}`);
      // 禁忌红线（来源：03 表 -100=禁止）：替换目标命中本患者快照 forbidden 即拒绝，禁止原因随错误透出
      const banned = forbiddenList.find((f) => f.code === toCode);
      if (banned) {
        const reasons = banned.reasons
          .filter((r) => r.score === FORBIDDEN_SCORE_V2)
          .map((r) => r.tagName)
          .join("、");
        throw new Error(
          `该干预对本患者为禁忌项（-100），不能替换入方案：${toCode} ${banned.name}（${reasons || "禁止原因未记录"}触发禁止）`
        );
      }
      const built = buildInterventionV2(toCode, tagCodes);
      if (!built) throw new Error(`替换项不存在：${toCode}`);
      if (built.category !== candidate.category) throw new Error(`只能在同类别内替换：${candidate.code}`);
      // 替换项继承被替换项的排位槽与类别展示标签（医生指定项不参与自动排序，仅占位展示）
      const replacement: PlanCandidateItemV2 = {
        ...built,
        rankInCategory: candidate.rankInCategory,
        categoryLabel: candidate.categoryLabel,
      };
      inputs[candidate.code] = { action: "replace", replacement, note: note ?? undefined };
    } else {
      inputs[candidate.code] = { action: "keep", note: note ?? undefined };
    }
  }
  const now = new Date();
  // Demo 阶段无鉴权，操作人固定为 "doctor"（正式版接入登录后替换为真实医生标识）
  const reviewed = applyPlanReview(candidates, inputs, "doctor", now);
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
