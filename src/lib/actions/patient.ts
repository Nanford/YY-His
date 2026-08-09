/**
 * INPUT:  患者端表单提交（FormData）、Prisma 数据库
 * OUTPUT: registerPatient（自助建档 + 首次评估会话）、createSupplementarySession（补充评估会话）
 * POS:    患者端业务流的写入口，与 src/lib/actions/doctor.ts（医生端写入口）分开维护。
 *         产品口径（2026-07-14 建档自助确认；2026-07-15 定型；2026-08-08 扩展）：患者可以自己建档并开始
 *         评估，不需要医生先录入。自助建档收姓名/性别/年龄（必填）+ 基础信息全字段选填（基本情况/
 *         疾病与用药/人体测量三块，与医生端完整建档共用 buildV2ProfileExtensions 校验）；
 *         身份证/手机/住址/住院号/门诊号等医疗管理信息留给医生后续在患者详情页补充。
 *         量表由患者在建档页自选（2026-07-15 修订，覆盖当日早先"固定 FRAIL+跌倒"的锁定口径）：
 *         FRAIL/跌倒不含观察题，能纯自助跑完直接出完整报告；MNA-SF/中医体质含舌象等需临床
 *         观察的题——Demo 口径（2026-07-20 用户拍板）：患者自助答完一律先出报告，医生检查题
 *         按 deferClinical 豁免计分（报告标注"部分计分"），不再落 awaiting_doctor；
 *         仅普通问答题"待人工确认"未补录时仍需医生补录后才出报告（硬约束 3 不变）。
 *         建档后用 cookie 记住"本次会话"，患者首页据此只显示自己的、看不到别人的
 *         （数据隔离，demo 级；正式版用真实登录）。自助建档产生的患者/会话与医生录入的完全
 *         同构，照样进入医生端"待审核"队列——干预方案仍必须经医生审核确认（硬约束不变）。
 */
"use server";

import type { Prisma } from "@/generated/prisma/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  PATIENT_SESSION_COOKIE,
  buildV2ProfileExtensions,
  generatePatientCode,
  parseMeasurements,
  parseScaleSelection,
  patientIdentitySchema,
  textOrNull,
} from "@/lib/assessment/patient-intake";
import { completedScaleIds, checkSupplementaryGuard } from "@/lib/assessment/supplementary";

export async function registerPatient(formData: FormData): Promise<void> {
  const identity = patientIdentitySchema.safeParse({
    name: textOrNull(formData, "name"),
    gender: textOrNull(formData, "gender"),
    age: Number(textOrNull(formData, "age")),
  });
  if (!identity.success) {
    redirect("/patient/register?error=required");
  }
  const measurements = parseMeasurements(formData);
  if (!measurements) {
    redirect("/patient/register?error=measurements");
  }
  // V2 基础信息扩展（2026-08-08 用户拍板扩展到患者端）：基本情况/疾病用药/测量补充全选填，
  // 与医生端完整建档共用 buildV2ProfileExtensions 校验；任一非法整体拒绝回 error=profile。
  const profileExtensions = buildV2ProfileExtensions(formData);
  if (!profileExtensions) {
    redirect("/patient/register?error=profile");
  }

  const patient = await prisma.patient.create({
    data: {
      code: await generatePatientCode(),
      ...identity.data,
      ...measurements,
      education: profileExtensions.education,
      maritalStatus: profileExtensions.maritalStatus,
      livingSituation: profileExtensions.livingSituation,
      careSituation: profileExtensions.careSituation,
      calfLeftCm: profileExtensions.calfLeftCm,
      calfRightCm: profileExtensions.calfRightCm,
      gripStrengthKg: profileExtensions.gripStrengthKg,
      gaitSpeed6mSec: profileExtensions.gaitSpeed6mSec,
      // Json 字段缺省时键缺省（Prisma Json? 不接受顶层 null）；与医生端 createPatient 同一写法
      ...(profileExtensions.diagnoses ? { diagnoses: profileExtensions.diagnoses } : {}),
      ...(profileExtensions.pastHistory ? { pastHistory: profileExtensions.pastHistory } : {}),
      ...(profileExtensions.recentAcute ? { recentAcute: profileExtensions.recentAcute } : {}),
      ...(profileExtensions.medications
        ? { medications: profileExtensions.medications as unknown as Prisma.InputJsonValue }
        : {}),
      ...(profileExtensions.weightHistory
        ? { weightHistory: profileExtensions.weightHistory as unknown as Prisma.InputJsonValue }
        : {}),
    },
  });

  // 第一步完成后进入第二步量表选择；患者标识通过 URL 参数传递，量表页再创建会话。
  redirect(`/patient/select-scales?patientId=${patient.id}`);
}

/**
 * 患者自助选择量表并创建首次评估会话。
 * INPUT:  患者 id、量表选择表单（scaleIds）
 * OUTPUT: 创建 AssessmentSession，设置"我的会话"cookie，进入问询。
 */
export async function startAssessment(patientId: string, formData: FormData): Promise<void> {
  const scaleIds = parseScaleSelection(formData);
  if (!scaleIds) {
    // 按提交来源方式页回跳（2026-08-08 四方式页：routine/emr/followup/custom），未知方式回方式选择页
    const mode = formData.get("mode");
    const modePath =
      typeof mode === "string" && ["routine", "emr", "followup", "custom"].includes(mode) ? `/${mode}` : "";
    redirect(`/patient/select-scales${modePath}?patientId=${patientId}&error=scales`);
  }

  const patient = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!patient) {
    redirect("/patient/register?error=required");
  }

  const session = await prisma.assessmentSession.create({
    data: { patientId: patient.id, scaleIds, status: "in_progress" },
  });

  // 数据隔离（demo 级）：cookie 记住"本次会话"，患者首页据此只显示自己的，看不到别人的。
  // 正式版改为真实登录鉴权（AGENTS.md：Demo 阶段不做鉴权，正式版再加）。
  (await cookies()).set(PATIENT_SESSION_COOKIE, session.id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
  });
  redirect(`/patient/sessions/${session.id}`);
}

/**
 * 补充评估（来源：需求更新说明 V2.0 §3）：患者完成一次评估后，从报告页对"尚未完成的量表"
 * 发起新一轮评估。复用既有患者档案与测量数据；每次补充评估创建独立会话，既有会话、评估
 * 快照与已确认方案均不受影响。对既有量表的复评属"医生授权"范畴——患者端只列未完成量表，
 * 服务端同样拒绝已完成的量表（防手改表单绕过）；复评由医生在患者详情页发起。
 */
export async function createSupplementarySession(sessionId: string, formData: FormData): Promise<void> {
  const source = await prisma.assessmentSession.findUnique({
    where: { id: sessionId },
    include: { patient: true },
  });
  if (!source) throw new Error("会话不存在");

  // 归属校验（防越权）：只认本机 cookie 对应会话与源会话同患者，且源会话已出报告
  // （collected/confirmed）才允许发起；拒绝时不创建会话、不切 cookie。
  // 纯判定逻辑在 supplementary.ts checkSupplementaryGuard（有单测）。
  const cookieSessionId = (await cookies()).get(PATIENT_SESSION_COOKIE)?.value ?? null;
  const cookieSession = cookieSessionId
    ? await prisma.assessmentSession.findUnique({
        where: { id: cookieSessionId },
        select: { patientId: true },
      })
    : null;
  const guard = checkSupplementaryGuard(cookieSession?.patientId ?? null, {
    patientId: source.patientId,
    status: source.status,
  });
  if (!guard.ok) {
    if (guard.reason === "forbidden") throw new Error("无权为该患者发起补充评估");
    redirect(`/patient/sessions/${sessionId}?error=not_reported`);
  }

  const scaleIds = parseScaleSelection(formData);
  if (!scaleIds) redirect(`/patient/sessions/${sessionId}?error=scales`);

  const siblings = await prisma.assessmentSession.findMany({
    where: { patientId: source.patientId },
    select: { status: true, scaleIds: true, startedAt: true },
  });
  const done = completedScaleIds(
    siblings.map((s) => ({ status: s.status, scaleIds: s.scaleIds as string[], startedAt: s.startedAt }))
  );
  if (scaleIds.some((id) => done.has(id))) {
    redirect(`/patient/sessions/${sessionId}?error=repeat`);
  }

  const created = await prisma.$transaction(async (tx) => {
    const s = await tx.assessmentSession.create({
      data: { patientId: source.patientId, scaleIds, status: "in_progress" },
    });
    return s;
  });

  // cookie 切换到新会话（同机患者继续自己的补充评估；历史报告经报告页入口互访）
  (await cookies()).set(PATIENT_SESSION_COOKIE, created.id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
  });
  redirect(`/patient/sessions/${created.id}`);
}
