/**
 * INPUT:  患者端会话 cookie（PATIENT_SESSION_COOKIE）、Prisma（cookie 会话的 patientId）
 * OUTPUT: ensureSamePatientAccess —— 患者端会话页/下载报告页共用的数据隔离校验
 * POS:    demo 级数据隔离的唯一实现：本机建过档就只能看自己（同患者）的会话，手打别人的 URL 会被挡回首页。
 *         V2.0 §3 补充评估会产生同患者的多个会话，历史报告互访按 patientId 放行；
 *         无 cookie 时不拦（可能是刚建档跳转/新设备），避免误伤演示流程；真正的鉴权是 V2。
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { PATIENT_SESSION_COOKIE } from "@/lib/assessment/patient-intake";

/** 访问的会话不属于 cookie 所指患者时重定向回患者首页 */
export async function ensureSamePatientAccess(sessionId: string, patientId: string): Promise<void> {
  const myId = (await cookies()).get(PATIENT_SESSION_COOKIE)?.value;
  if (!myId || myId === sessionId) return;
  const mine = await prisma.assessmentSession.findUnique({
    where: { id: myId },
    select: { patientId: true },
  });
  if (!mine || mine.patientId !== patientId) redirect("/patient");
}
