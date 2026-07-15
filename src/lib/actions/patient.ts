/**
 * INPUT:  患者端表单提交（FormData）、Prisma 数据库
 * OUTPUT: registerPatient —— 患者自助建档 + 直接创建评估会话（Server Action）
 * POS:    患者端业务流的写入口，与 src/lib/actions/doctor.ts（医生端写入口）分开维护。
 *         产品口径（2026-07-14 建档自助确认；2026-07-15 定型）：患者可以自己建档并开始
 *         评估，不需要医生先录入。自助建档只收姓名/性别/年龄（必填）+ 测量数据（选填）；
 *         身份证/手机/住址/住院号/门诊号等医疗管理信息留给医生后续在患者详情页补充。
 *         量表固定 FRAIL+跌倒——这两个量表不含观察题，是唯一能保证患者全程独立跑完并
 *         直接出报告、不卡在"需要医生协助"的组合（2026-07-15 实测确认）。更全面的评估
 *         （营养 MNA-SF / 中医体质，含舌象等需临床观察的题）由医生在患者详情页另建会话——
 *         那类需要医护观察/监控，走医护入口。产品模型：自助入口 = 自包含出报告；医护入口 =
 *         需医护介入。建档后用 cookie 记住"本次会话"，患者首页据此只显示自己的、看不到别人的
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
  patientIdentitySchema,
  textOrNull,
} from "@/lib/assessment/patient-intake";
import { syncMeasurementAnswers } from "@/lib/assessment/measurement-sync";

/** 患者自助建档评估预设：FRAIL+跌倒——唯一无观察题缺口、能纯自助出报告的组合（见文件头 POS）。 */
const SELF_REGISTER_SCALE_IDS = ["frail", "fall"] as const;

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

  const session = await prisma.$transaction(async (tx) => {
    const patient = await tx.patient.create({
      data: {
        code: await generatePatientCode(),
        ...identity.data,
        ...measurements,
      },
    });
    const created = await tx.assessmentSession.create({
      data: { patientId: patient.id, scaleIds: [...SELF_REGISTER_SCALE_IDS], status: "in_progress" },
    });
    await syncMeasurementAnswers(tx, created.id, SELF_REGISTER_SCALE_IDS, patient);
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
