/**
 * INPUT:  患者端表单提交（FormData）、Prisma 数据库
 * OUTPUT: registerPatient —— 患者自助建档 + 直接创建评估会话（Server Action）
 * POS:    患者端业务流的写入口，与 src/lib/actions/doctor.ts（医生端写入口）分开维护。
 *         产品口径（2026-07-14 与用户确认）：患者可以自己建档并开始评估，不需要医生
 *         先录入。自助建档只收姓名/性别/年龄（必填）+ 测量数据（选填）；身份证/手机/
 *         住址/住院号/门诊号等医疗管理信息留给医生后续在患者详情页补充，不在此阻塞流程。
 *         量表固定为 FRAIL+跌倒 预设——这两个量表都不含测量/观察题，是唯一能保证患者
 *         全程独立跑完、不会中途卡在"需要医生协助"的组合；更全面的评估（营养/中医体质）
 *         由医生在患者详情页另行创建会话勾选。自助建档产生的患者/会话与医生录入的完全
 *         同构，照样进入医生端"待审核"队列——干预方案仍必须经医生审核确认（硬约束不变）。
 */
"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  generatePatientCode,
  parseMeasurements,
  patientIdentitySchema,
  textOrNull,
} from "@/lib/assessment/patient-intake";
import { syncMeasurementAnswers } from "@/lib/assessment/measurement-sync";

/** 患者自助建档固定评估预设：唯一不含测量/观察题缺口的量表组合（见文件头 POS 说明）。 */
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

  redirect(`/patient/sessions/${session.id}`);
}
