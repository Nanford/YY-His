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
import { optionsOf, scaleByQuestionId, questionById } from "@/lib/rules";
import { scoreAll, type AnswersByQuestionId } from "@/lib/scoring";
import { recommend, type RecommendedIntervention } from "@/lib/recommend";

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

function floatOrNull(formData: FormData, key: string): number | null {
  const raw = textOrNull(formData, key);
  if (raw === null) return null;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

export async function createPatient(formData: FormData): Promise<void> {
  const name = textOrNull(formData, "name");
  const gender = textOrNull(formData, "gender");
  const age = Number(textOrNull(formData, "age"));
  // 姓名/性别/年龄为必填项（需求文档"第一步：基础信息录入"）
  if (!name || !gender || !Number.isInteger(age) || age <= 0 || age > 130) {
    redirect("/doctor/patients/new?error=required");
  }
  const patient = await prisma.patient.create({
    data: {
      code: await generatePatientCode(),
      name,
      gender,
      age,
      phone: textOrNull(formData, "phone"),
      idCard: textOrNull(formData, "idCard"),
      address: textOrNull(formData, "address"),
      admissionNo: textOrNull(formData, "admissionNo"),
      outpatientNo: textOrNull(formData, "outpatientNo"),
      heightCm: floatOrNull(formData, "heightCm"),
      weightKg: floatOrNull(formData, "weightKg"),
      waistCm: floatOrNull(formData, "waistCm"),
      calfCm: floatOrNull(formData, "calfCm"),
    },
  });
  revalidatePath("/doctor");
  redirect(`/doctor/patients/${patient.id}`);
}

export async function updateMeasurements(patientId: string, formData: FormData): Promise<void> {
  await prisma.patient.update({
    where: { id: patientId },
    data: {
      heightCm: floatOrNull(formData, "heightCm"),
      weightKg: floatOrNull(formData, "weightKg"),
      waistCm: floatOrNull(formData, "waistCm"),
      calfCm: floatOrNull(formData, "calfCm"),
    },
  });
  revalidatePath(`/doctor/patients/${patientId}`);
  redirect(`/doctor/patients/${patientId}?saved=measurements`);
}

// ---------- 评估会话 ----------

const ALL_SCALE_IDS = ["frail", "mnasf", "fall", "tcm"] as const;

export async function createSession(patientId: string, formData: FormData): Promise<void> {
  const scaleIds = ALL_SCALE_IDS.filter((id) => formData.get(`scale.${id}`) === "on");
  if (scaleIds.length === 0) {
    redirect(`/doctor/patients/${patientId}?error=no-scale`);
  }
  const session = await prisma.assessmentSession.create({
    data: { patientId, scaleIds, status: "in_progress" },
  });
  redirect(`/doctor/sessions/${session.id}`);
}

/** 解析表单中的 answer.<questionId> 字段并逐题落库（医生代填 → 直接 confirmed） */
async function persistAnswersFromForm(sessionId: string, formData: FormData): Promise<void> {
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("answer.") || typeof value !== "string" || value === "") continue;
    const questionId = key.slice("answer.".length);
    const question = questionById.get(questionId);
    const scale = scaleByQuestionId.get(questionId);
    if (!question || !scale) continue; // 非法字段直接忽略，不入库
    const score = Number(value);
    const option = optionsOf(scale, question).find((o) => o.score === score);
    if (!option) continue; // 分值不在选项内：radio 表单不会出现，防御性跳过
    await prisma.answer.upsert({
      where: { sessionId_questionId: { sessionId, questionId } },
      create: {
        sessionId,
        questionId,
        optionLabel: option.label,
        score,
        source: "doctor",
        status: "confirmed",
      },
      update: { optionLabel: option.label, score, source: "doctor", status: "confirmed" },
    });
  }
}

export async function saveAnswers(sessionId: string, formData: FormData): Promise<void> {
  await persistAnswersFromForm(sessionId, formData);
  revalidatePath(`/doctor/sessions/${sessionId}`);
  redirect(`/doctor/sessions/${sessionId}?saved=1`);
}

/** 保存答案 → 确定性评分 → 生成评估标签与候选干预方案（核心数据流的落库点） */
export async function finalizeSession(sessionId: string, formData: FormData): Promise<void> {
  await persistAnswersFromForm(sessionId, formData);

  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { answers: true },
  });
  const answersMap: Record<string, number> = {};
  for (const a of session.answers) {
    if (a.status === "confirmed" && a.score !== null) {
      answersMap[a.questionId] = a.score;
    }
  }

  const scored = scoreAll(session.scaleIds as string[], answersMap as AnswersByQuestionId);
  if (scored.incompleteScaleIds.length > 0) {
    // 未答完不出结论（需求：完成全部信息采集后统一分析），带缺失量表回到填答页提示
    redirect(`/doctor/sessions/${sessionId}?error=incomplete&scales=${scored.incompleteScaleIds.join(",")}`);
  }

  const plan = recommend(scored.tags);
  // 重新评估时覆盖旧结果：先清掉本会话的历史结果与未确认方案
  await prisma.$transaction([
    prisma.assessmentResult.deleteMany({ where: { sessionId } }),
    prisma.interventionPlan.deleteMany({ where: { sessionId, status: "draft" } }),
    prisma.assessmentResult.create({
      data: { sessionId, tags: scored.tags as unknown as Prisma.InputJsonValue },
    }),
    prisma.interventionPlan.create({
      data: { sessionId, candidates: plan.flat as unknown as Prisma.InputJsonValue, status: "draft" },
    }),
    prisma.assessmentSession.update({
      where: { id: sessionId },
      data: { status: "collected", completedAt: new Date() },
    }),
  ]);

  revalidatePath(`/doctor/sessions/${sessionId}`);
  redirect(`/doctor/sessions/${sessionId}`);
}

/** 返回修改答案：答案保留，作废已生成的评估结果与草稿方案（避免陈旧结论展示） */
export async function reopenSession(sessionId: string): Promise<void> {
  await prisma.$transaction([
    prisma.assessmentResult.deleteMany({ where: { sessionId } }),
    prisma.interventionPlan.deleteMany({ where: { sessionId, status: "draft" } }),
    prisma.assessmentSession.update({
      where: { id: sessionId },
      data: { status: "in_progress", completedAt: null },
    }),
  ]);
  revalidatePath(`/doctor/sessions/${sessionId}`);
  redirect(`/doctor/sessions/${sessionId}`);
}

/** 医生审核候选方案：勾选保留项 → 形成最终干预方案（需求文档"第四步"医生确认环节） */
export async function confirmPlan(sessionId: string, formData: FormData): Promise<void> {
  const plan = await prisma.interventionPlan.findFirstOrThrow({
    where: { sessionId, status: "draft" },
    orderBy: { createdAt: "desc" },
  });
  const candidates = plan.candidates as unknown as RecommendedIntervention[];
  const kept = candidates.filter((c) => formData.get(`keep.${c.tag}`) === "on");
  if (kept.length === 0) {
    redirect(`/doctor/sessions/${sessionId}?error=empty-plan`);
  }
  const now = new Date();
  const decisions = candidates.map((c) => ({
    tag: c.tag,
    action: formData.get(`keep.${c.tag}`) === "on" ? "keep" : "remove",
    at: now.toISOString(),
  }));
  await prisma.$transaction([
    prisma.interventionPlan.update({
      where: { id: plan.id },
      data: {
        decisions,
        finalPlan: kept as unknown as Prisma.InputJsonValue,
        status: "confirmed",
        confirmedAt: now,
      },
    }),
    prisma.assessmentSession.update({ where: { id: sessionId }, data: { status: "confirmed" } }),
  ]);
  revalidatePath(`/doctor/sessions/${sessionId}`);
  redirect(`/doctor/sessions/${sessionId}`);
}
