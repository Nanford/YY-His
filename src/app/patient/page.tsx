/**
 * INPUT:  本机患者会话 cookie 与对应的评估会话
 * OUTPUT: 新建档案、继续评估和查看报告的患者入口
 * POS:    只展示 cookie 对应会话。2026-11-11 改为大卡片入口（care-card，见 assessment-design.css）。
 */
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, ClipboardCheck, FileText, UserRoundPlus } from "lucide-react";
import { SectionDisclosure } from "@/components/section-disclosure";
import { PatientPageHeading } from "@/components/patient-page-heading";
import { prisma } from "@/lib/db";
import { scaleById } from "@/lib/rules";
import { PATIENT_SESSION_COOKIE } from "@/lib/assessment/patient-intake";

export const dynamic = "force-dynamic";

export default async function PatientHomePage() {
  const mySessionId = (await cookies()).get(PATIENT_SESSION_COOKIE)?.value;
  const mySession = mySessionId
    ? await prisma.assessmentSession.findUnique({
        where: { id: mySessionId },
        select: {
          id: true,
          status: true,
          scaleIds: true,
          patient: { select: { name: true, gender: true, age: true, code: true } },
        },
      })
    : null;
  const inProgress = mySession?.status === "in_progress";
  const scaleNames = (mySession?.scaleIds as string[] | undefined)?.map((id) => scaleById.get(id)?.name ?? id);

  return (
    <main className="patient-main flex-1">
      <PatientPageHeading plain title="健康评估" description="新建档案开始评估，或继续本机上的评估。" />
      <div className={mySession ? "care-entry-grid" : "grid"}>
        {/* 整张卡片即入口链接；无进行中评估时只有这一个入口，改横向长卡占满整行 */}
        {mySession ? (
          <Link href="/patient/register" className="care-card care-card-link care-entry-card">
            <span className="care-entry-card-top">
              <span className="care-icon-chip" aria-hidden="true">
                <UserRoundPlus />
              </span>
              <ArrowRight aria-hidden="true" />
            </span>
            <span className="care-entry-card-foot">
              <span className="care-card-title">新建健康档案</span>
              <span className="care-card-text">填写基本信息，选择本次评估项目。</span>
            </span>
          </Link>
        ) : (
          <Link href="/patient/register" className="care-card care-card-link care-entry-card" data-wide>
            <span className="care-icon-chip" aria-hidden="true">
              <UserRoundPlus />
            </span>
            <span className="care-entry-card-foot">
              <span className="care-card-title">新建健康档案</span>
              <span className="care-card-text">填写基本信息，选择本次评估项目。</span>
            </span>
            <ArrowRight aria-hidden="true" />
          </Link>
        )}

        {mySession && (
          <section className="care-card care-entry-card flex">
            <div className="flex items-start gap-4">
              <span className="care-icon-chip" aria-hidden="true">
                {inProgress ? <ClipboardCheck /> : <FileText />}
              </span>
              <div className="min-w-0">
                <h2 className="care-card-title">我的评估</h2>
                <p className="care-card-text">
                  {mySession.patient.name} · {mySession.patient.gender} · {mySession.patient.age} 岁
                  <span className="ml-3 font-mono text-sm">{mySession.patient.code}</span>
                </p>
              </div>
            </div>
            <div className="care-entry-card-foot flex flex-wrap items-center gap-3">
              <Link href={`/patient/sessions/${mySession.id}`} className="care-primary-button">
                {inProgress ? "继续评估" : "查看我的报告"} <ArrowRight className="size-5" aria-hidden="true" />
              </Link>
              {scaleNames && scaleNames.length > 0 && (
                <div className="min-w-0 flex-1">
                  <SectionDisclosure title="评估项目" summary={`${scaleNames.length} 项`}>
                    <p className="text-sm text-muted-foreground">{scaleNames.join("、")}</p>
                  </SectionDisclosure>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
