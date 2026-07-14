/**
 * INPUT:  路由参数 id、Prisma（会话/患者展示信息/评估结果/干预方案）
 * OUTPUT: 患者端会话页（服务端外壳）：collected/confirmed → 报告视图；in_progress → 问询视图
 * POS:    患者姓名等展示信息在本地服务端渲染注入，不经过任何第三方接口。
 *         状态分流与医生端会话页（src/app/doctor/sessions/[id]/page.tsx）同构：都以
 *         session.status 决定渲染哪个子视图，避免患者端另起一套状态判断逻辑。
 */
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { scaleById } from "@/lib/rules";
import type { AssessmentTag } from "@/lib/scoring";
import type { RecommendedIntervention } from "@/lib/recommend";
import { InterviewScreen } from "./interview-screen";
import { PatientReport } from "./patient-report";

export const dynamic = "force-dynamic";

export default async function PatientSessionPage({
  params,
}: PageProps<"/patient/sessions/[id]">) {
  const { id } = await params;
  const session = await prisma.assessmentSession.findUnique({
    where: { id },
    include: {
      patient: { select: { name: true, gender: true, age: true } },
      results: {
        where: { status: "current" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
      },
      plans: {
        where: { status: { in: ["draft", "confirmed"] } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
      },
    },
  });
  if (!session) notFound();

  const honorific = session.patient.gender === "女" ? "奶奶" : "爷爷";
  const patientLabel = `${session.patient.name}${honorific}（${session.patient.age} 岁）`;
  const scaleNames = (session.scaleIds as string[]).map((scaleId) => scaleById.get(scaleId)?.name ?? scaleId);

  if (session.status === "collected" || session.status === "confirmed") {
    const latestResult = session.results[0];
    const latestPlan = session.plans.find((plan) =>
      session.status === "confirmed" ? plan.status === "confirmed" : plan.status === "draft"
    );
    if (latestResult && latestPlan) {
      const planStatus = latestPlan.status === "confirmed" ? "confirmed" : "draft";
      const plan = (
        planStatus === "confirmed" ? (latestPlan.finalPlan ?? []) : latestPlan.candidates
      ) as unknown as RecommendedIntervention[];
      return (
        <PatientReport
          patientLabel={patientLabel}
          scaleNames={scaleNames}
          tags={latestResult.tags as unknown as AssessmentTag[]}
          planStatus={planStatus}
          plan={plan}
          confirmedAt={latestPlan.confirmedAt}
        />
      );
    }
  }

  return <InterviewScreen sessionId={session.id} patientLabel={patientLabel} />;
}
