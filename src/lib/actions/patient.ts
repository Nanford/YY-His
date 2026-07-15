/**
 * INPUT:  患者端表单提交（FormData）、Prisma 数据库
 * OUTPUT: registerPatient —— 患者自助建档 + 直接创建评估会话（Server Action）
 * POS:    患者端业务流的写入口，与 src/lib/actions/doctor.ts（医生端写入口）分开维护。
 *         产品口径（2026-07-14 建档自助确认；2026-07-15 定型）：患者可以自己建档并开始
 *         评估，不需要医生先录入。自助建档只收姓名/性别/年龄（必填）+ 测量数据（选填）；
 *         身份证/手机/住址/住院号/门诊号等医疗管理信息留给医生后续在患者详情页补充。
 *         量表由患者在建档页自选（2026-07-15 修订，覆盖当日早先"固定 FRAIL+跌倒"的锁定口径）：
 *         FRAIL/跌倒不含观察题，能纯自助跑完直接出报告；MNA-SF/中医体质含舌象等需临床观察的题，
 *         患者答完能答的题后落"需要医生协助"（awaiting_doctor），由医生在患者详情页 CollectForm
 *         补录观察/测量题并确认方案后报告才出现——优雅降级，观察题仍由医护判断，医学口径不变。
 *         建档后用 cookie 记住"本次会话"，患者首页据此只显示自己的、看不到别人的
 *         （数据隔离，demo 级；正式版用真实登录）。自助建档产生的患者/会话与医生录入的完全
 *         同构，照样进入医生端"待审核"队列——干预方案仍必须经医生审核确认（硬约束不变）。
 */
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  PATIENT_SESSION_COOKIE,
  generatePatientCode,
  parseMeasurements,
  parseScaleSelection,
  patientIdentitySchema,
  textOrNull,
} from "@/lib/assessment/patient-intake";
import { syncMeasurementAnswers } from "@/lib/assessment/measurement-sync";

export async function registerPatient(formData: FormData): Promise<void> {
  const identity = patientIdentitySchema.safeParse({
    name: textOrNull(formData, "name"),
    gender: textOrNull(formData, "gender"),
    age: Number(textOrNull(formData, "age")),
  });
  if (!identity.success) {
    redirect("/patient/register?error=required");
  }
  // 患者自选量表（见文件头 POS）：含观察题的量表走 awaiting_doctor 优雅降级，不在此阻塞。
  const scaleIds = parseScaleSelection(formData);
  if (!scaleIds) {
    redirect("/patient/register?error=scales");
  }
  const measurements = parseMeasurements(formData);
  if (!measurements) {
    redirect("/patient/register?error=measurements");
  }

  const session = await prisma.$transaction(async (tx) => {
    const patient = await tx.patient.create({
      data: {
        code: await generatePatientCode(),
        ...identity.data,
        ...measurements,
      },
    });
    const created = await tx.assessmentSession.create({
      data: { patientId: patient.id, scaleIds, status: "in_progress" },
    });
    await syncMeasurementAnswers(tx, created.id, scaleIds, patient);
    return created;
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
