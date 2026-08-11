/**
 * INPUT:  Prisma（仅本机 cookie 记住的当前会话）、患者会话 cookie
 * OUTPUT: 用户评估二级入口页：六步评估总览、开始评估与继续当前评估
 * POS:    V2.1 患者端流程入口；一级首页只做端口分流，本页只展示评估主流程与关键操作。
 */
import Link from "next/link";
import { cookies } from "next/headers";
import { IconArrowRight, IconClipboardHeart, IconUserPlus } from "@tabler/icons-react";
import { V2DemoPipeline } from "@/components/v2-pipeline";
import { prisma } from "@/lib/db";
import { PATIENT_SESSION_COOKIE } from "@/lib/assessment/patient-intake";

export const dynamic = "force-dynamic";

export default async function PatientHomePage() {
  // 数据隔离：只显示本机 cookie 对应的当前会话，不暴露其他患者信息。
  const mySessionId = (await cookies()).get(PATIENT_SESSION_COOKIE)?.value;
  const mySession = mySessionId
    ? await prisma.assessmentSession.findUnique({
        where: { id: mySessionId },
        select: { id: true, status: true },
      })
    : null;

  return (
    <main className="patient-main flex flex-1 items-center">
      <section className="patient-panel w-full px-5 py-6 sm:px-7 sm:py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="page-eyebrow">服务流程</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-[-0.025em] text-[#102a56] sm:text-3xl">
              按顺序完成六步评估
            </h1>
          </div>
          <span className="ui-badge">共 6 步</span>
        </div>

        <V2DemoPipeline current={0} unlockedStep={6} showHeader={false} />

        <div className="mt-7 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <Link href="/patient/register" className="patient-primary-action justify-center">
            <IconUserPlus size={26} stroke={2} aria-hidden="true" />
            开始第一步：填写基础信息
            <IconArrowRight size={24} stroke={2.1} aria-hidden="true" />
          </Link>
          {mySession && (
            <Link
              href={`/patient/sessions/${mySession.id}`}
              className="ui-button ui-button-secondary ui-button-lg justify-center"
            >
              <IconClipboardHeart size={23} stroke={1.9} aria-hidden="true" />
              {mySession.status === "in_progress" ? "继续当前评估" : "查看当前报告"}
            </Link>
          )}
        </div>
      </section>
    </main>
  );
}
