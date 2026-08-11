/**
 * INPUT:  路由参数 id、Prisma（会话/患者展示信息/评估结果/干预方案/同患者历史会话）
 * OUTPUT: 患者端会话页（服务端外壳）：collected/confirmed → 报告视图；in_progress → 问询视图
 * POS:    患者姓名等展示信息在本地服务端渲染注入，不经过任何第三方接口。
 *         状态分流与医生端会话页（src/app/doctor/sessions/[id]/page.tsx）同构：都以
 *         session.status 决定渲染哪个子视图，避免患者端另起一套状态判断逻辑。
 *         V2.0 §3：报告页展示评估范围（新增/复评）与生成时间，保留历史报告入口，
 *         报告页提供补充评估入口，项目选择在独立页面完成；历史报告互访按"同患者"放宽数据隔离。
 */
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { scaleById, scales } from "@/lib/rules";
import { PATIENT_SESSION_COOKIE } from "@/lib/assessment/patient-intake";
import { completedScaleIds, scaleComparisons, scaleNeedsClinician, scaleScopes } from "@/lib/assessment/supplementary";
import type { AssessmentTag } from "@/lib/assessment/report-types";
import type { PlanCandidateItemV2, PlanCandidatesV2 } from "@/lib/recommend-v2";
import type { DeferredScale } from "./patient-report";
import { InterviewScreen } from "./interview-screen";
import { PatientReport } from "./patient-report";
import { PipelineProgressUpdater } from "@/components/pipeline-progress-updater";

export const dynamic = "force-dynamic";

const scaleName = (scaleId: string) => scaleById.get(scaleId)?.name ?? scaleId;

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

  // 数据隔离（demo 级）：本机建过档就只能看自己（同患者）的会话，手打别人的 URL 会被挡回首页。
  // V2.0 §3 补充评估会产生同患者的多个会话，历史报告互访按 patientId 放行；
  // 无 cookie 时不拦（可能是刚建档跳转/新设备），避免误伤演示流程；真正的鉴权是 V2。
  const myId = (await cookies()).get(PATIENT_SESSION_COOKIE)?.value;
  if (myId && myId !== id) {
    const mine = await prisma.assessmentSession.findUnique({
      where: { id: myId },
      select: { patientId: true },
    });
    if (!mine || mine.patientId !== session.patientId) redirect("/patient");
  }

  const honorific = session.patient.gender === "女" ? "奶奶" : "爷爷";
  const patientLabel = `${session.patient.name}${honorific}（${session.patient.age} 岁）`;

  if (session.status === "collected" || session.status === "confirmed") {
    const latestResult = session.results[0];
    const latestPlan = session.plans.find((plan) =>
      session.status === "confirmed" ? plan.status === "confirmed" : plan.status === "draft"
    );
    if (latestResult && latestPlan) {
      const planStatus = latestPlan.status === "confirmed" ? "confirmed" : "draft";
      // 候选快照为 PlanCandidatesV2（items+forcedCodes+forbidden）；已确认方案是审核后的平铺列表
      const plan = (
        planStatus === "confirmed"
          ? (latestPlan.finalPlan ?? [])
          : (latestPlan.candidates as unknown as PlanCandidatesV2).items
      ) as unknown as PlanCandidateItemV2[];

      // 同患者全部会话：报告范围标识（新增/复评）、历史报告入口、补充评估可选量表都由此派生；
      // 复评量表的随访对比（Demo_v2 步骤 2）还需各会话当次报告的标签快照作为对比基准
      const siblings = await prisma.assessmentSession.findMany({
        where: { patientId: session.patientId },
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          status: true,
          scaleIds: true,
          startedAt: true,
          completedAt: true,
          results: {
            where: { status: "current" },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { tags: true },
          },
        },
      });
      const toInfo = (s: (typeof siblings)[number]) => ({
        status: s.status,
        scaleIds: s.scaleIds as string[],
        startedAt: s.startedAt,
      });
      const sessionScaleIds = session.scaleIds as string[];

      // 本次报告各量表的 新增/复评 标识（V2.0 §3：避免把不同时间的评估结论误认为同一次采集）
      const scopeByScaleId = new Map(
        scaleScopes(
          session.startedAt,
          sessionScaleIds,
          siblings.filter((s) => s.id !== session.id).map(toInfo)
        ).map((entry) => [entry.scaleId, entry.scope])
      );
      const reportScales = sessionScaleIds.map((scaleId) => ({
        id: scaleId,
        name: scaleName(scaleId),
        scope: scopeByScaleId.get(scaleId) ?? ("new" as const),
      }));

      // 复评量表的随访对比（Demo_v2 步骤 2）：与同患者上次已出报告会话比标签集合与总分
      const currentTags = latestResult.tags as unknown as AssessmentTag[];
      const comparisons = scaleComparisons(
        session.startedAt,
        { scaleIds: sessionScaleIds, tags: currentTags },
        siblings
          .filter((s) => s.id !== session.id)
          .map((s) => ({
            status: s.status,
            scaleIds: s.scaleIds as string[],
            startedAt: s.startedAt,
            tags: (s.results[0]?.tags ?? []) as unknown as AssessmentTag[],
          }))
      );

      // 历史报告入口：同患者其他已出报告的会话，按评估时间分别展示（不覆盖、可下钻）
      const historyReports = siblings
        .filter((s) => s.id !== session.id && (s.status === "collected" || s.status === "confirmed"))
        .map((s) => ({
          id: s.id,
          assessedAt: s.completedAt ?? s.startedAt,
          scaleNames: (s.scaleIds as string[]).map(scaleName),
        }));

      // 补充评估可选量表 = 全部量表 − 已完成（复评属医生授权，不出现在患者自助入口）
      const done = completedScaleIds(siblings.map(toInfo));
      const remainingScales = scales
        .filter((scale) => !done.has(scale.id))
        .map((scale) => ({ id: scale.id, name: scale.name, needsClinician: scaleNeedsClinician(scale.id) }));

      return (
        <>
          <PipelineProgressUpdater step={6} />
          <PatientReport
            sessionId={session.id}
            patientLabel={patientLabel}
            assessedAt={session.completedAt ?? session.startedAt}
            reportScales={reportScales}
            tags={currentTags}
            deferredScales={(latestResult.deferred ?? []) as unknown as DeferredScale[]}
            comparisons={comparisons}
            planStatus={planStatus}
            plan={plan}
            confirmedAt={latestPlan.confirmedAt}
            historyReports={historyReports}
            remainingScales={remainingScales}
          />
        </>
      );
    }
  }

  return (
    <>
      <PipelineProgressUpdater step={3} />
      <InterviewScreen sessionId={session.id} patientLabel={patientLabel} />
    </>
  );
}
