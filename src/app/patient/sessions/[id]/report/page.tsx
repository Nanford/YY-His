/**
 * INPUT:  路由参数 id、Prisma（会话/患者档案/当前评估结果快照/干预方案）
 * OUTPUT: 患者端「下载报告」页：A4 版式报告预览 + 下载按钮（浏览器另存为 PDF）
 * POS:    2026-11-10 用户拍板：大屏报告页（../page.tsx）是「预览报告」，本页是与
 *         「报告输出的样式.png」同版式的「下载报告」。只读页面：不写库、不出网，
 *         患者档案在本机服务端渲染，姓名脱敏后才进入页面。未出报告的会话跳回会话页。
 *         数据隔离与会话页共用 ensureSamePatientAccess。
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { scoringCategories } from "@/lib/rules";
import { buildBasicInfoRows, buildIdentityItems } from "@/lib/assessment/report-profile";
import { buildReportRows, listExistingProblems, type DeferredScaleRef } from "@/lib/assessment/report-rows";
import type { AssessmentTag } from "@/lib/assessment/report-types";
import type { PlanCandidateItemV2, PlanCandidatesV2 } from "@/lib/recommend-v2";
import { ensureSamePatientAccess } from "../session-access";
import { PrintReportButton } from "./print-button";
import { ReportDocument } from "./report-document";

export const dynamic = "force-dynamic";

/** 多重用药评估量表 id（data/scales-v2.json），其标签进报告「用药评估」行 */
const MEDICATION_SCALE_ID = "polypharmacy";

export default async function PatientReportDownloadPage({
  params,
}: PageProps<"/patient/sessions/[id]/report">) {
  const { id } = await params;
  const session = await prisma.assessmentSession.findUnique({
    where: { id },
    include: {
      patient: {
        select: {
          name: true,
          gender: true,
          age: true,
          code: true,
          heightCm: true,
          weightKg: true,
          diagnoses: true,
          pastHistory: true,
          recentAcute: true,
          medications: true,
          careSituation: true,
          livingSituation: true,
        },
      },
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
  await ensureSamePatientAccess(id, session.patientId);

  // 与会话页同一口径：已出报告 = 会话 collected/confirmed 且有当前结果快照与对应状态的方案
  const reported = session.status === "collected" || session.status === "confirmed";
  const latestResult = session.results[0];
  const latestPlan = session.plans.find((plan) =>
    session.status === "confirmed" ? plan.status === "confirmed" : plan.status === "draft"
  );
  if (!reported || !latestResult || !latestPlan) redirect(`/patient/sessions/${id}`);

  const planConfirmed = latestPlan.status === "confirmed";
  // 候选快照为 PlanCandidatesV2（items+…）；已确认方案是审核后的平铺列表
  const planItems = (
    planConfirmed ? (latestPlan.finalPlan ?? []) : (latestPlan.candidates as unknown as PlanCandidatesV2).items
  ) as unknown as PlanCandidateItemV2[];

  const tags = latestResult.tags as unknown as AssessmentTag[];
  const scaleIds = session.scaleIds as string[];
  const deferredScales = (latestResult.deferred ?? []) as unknown as DeferredScaleRef[];
  const identityItems = buildIdentityItems(
    session.patient,
    (session.completedAt ?? session.startedAt).toLocaleString("zh-CN")
  );
  const basicInfoRows = buildBasicInfoRows(
    session.patient,
    tags.filter((tag) => tag.scaleId === MEDICATION_SCALE_ID).map((tag) => tag.tag)
  );

  return (
    <main className="report-doc-page flex-1">
      <div className="report-doc-toolbar">
        <Link href={`/patient/sessions/${id}`} className="ui-button ui-button-secondary">
          <ArrowLeft size={19} strokeWidth={2} aria-hidden="true" />
          返回报告
        </Link>
        <p>在打印窗口选择「另存为 PDF」。</p>
        {/* 文件名只带患者唯一编号，不带姓名（PII 不进文件名） */}
        <PrintReportButton fileName={`老年综合评估报告_${session.patient.code}`} />
      </div>
      <div className="report-doc-scroll">
        <ReportDocument
          identityItems={identityItems}
          basicInfoRows={basicInfoRows}
          problems={listExistingProblems(tags)}
          scaleCount={new Set(scaleIds).size}
          rows={buildReportRows(scaleIds, tags, deferredScales)}
          categoryOrder={scoringCategories.map((category) => category.label)}
          planEntries={planItems.map((item) => ({
            code: item.code,
            name: item.name,
            categoryLabel: item.categoryLabel,
            forced: Boolean(item.forced),
          }))}
          planConfirmed={planConfirmed}
        />
      </div>
    </main>
  );
}
