/**
 * INPUT:  本机患者会话 cookie 与对应的评估会话
 * OUTPUT: 新建档案、继续评估和查看报告的患者入口
 * POS:    只展示 cookie 对应会话。
 */
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, ClipboardCheck, FileText, UserRoundPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionDisclosure } from "@/components/section-disclosure";
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
    <main className="patient-main max-w-[66rem] flex-1 space-y-5">
      <h1 className="patient-display-title">健康评估</h1>
      <div className={mySession ? "grid items-start gap-4 lg:grid-cols-2" : "max-w-2xl"}>
        <section className="rounded-2xl border border-border bg-card">
          <div className="flex items-start gap-4 rounded-t-[inherit] bg-accent/55 p-5 sm:p-6">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-card text-primary" aria-hidden="true">
              <UserRoundPlus className="size-6" />
            </span>
            <div>
              <h2 className="text-xl font-bold">开始评估</h2>
              <p className="mt-1 text-sm text-muted-foreground">填写基本信息，选择本次评估项目。</p>
            </div>
          </div>
          <div className="p-5 sm:p-6">
            <Button asChild className="min-h-12 w-full gap-2 px-4 text-base font-bold sm:w-auto">
              <Link href="/patient/register">
                新建健康档案 <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </section>

        {mySession && (
          <section className="rounded-2xl border border-border bg-card">
            <div className="flex items-start gap-4 rounded-t-[inherit] bg-accent/55 p-5 sm:p-6">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-card text-primary" aria-hidden="true">
                {inProgress ? <ClipboardCheck className="size-6" /> : <FileText className="size-6" />}
              </span>
              <div className="min-w-0">
                <h2 className="text-xl font-bold">我的评估</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {mySession.patient.name} · {mySession.patient.gender} · {mySession.patient.age} 岁
                </p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{mySession.patient.code}</p>
              </div>
            </div>
            <div className="space-y-3 p-5 sm:p-6">
              <Button asChild variant="outline" className="min-h-12 w-full gap-2 px-4 text-base font-bold sm:w-auto">
                <Link href={`/patient/sessions/${mySession.id}`}>
                  {inProgress ? "继续评估" : "查看我的报告"} <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
              {scaleNames && scaleNames.length > 0 && (
                <SectionDisclosure title="评估项目" summary={`${scaleNames.length} 项`}>
                  <p className="text-sm text-muted-foreground">{scaleNames.join("、")}</p>
                </SectionDisclosure>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
