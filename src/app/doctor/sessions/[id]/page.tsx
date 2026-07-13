/**
 * INPUT:  Prisma（会话/答案/评估结果/干预方案）、路由参数 id、查询参数（提示信息）
 * OUTPUT: 评估会话工作台：按状态分发 采集表单 → 结果与方案审核 → 最终方案
 * POS:    医生端核心页面，承载"采集 → 评估 → 推荐 → 审核确认"完整闭环（M2 无语音路径）。
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { scaleById } from "@/lib/rules";
import type { AssessmentTag } from "@/lib/scoring";
import type { RecommendedIntervention } from "@/lib/recommend";
import { CollectForm } from "./collect-form";
import { ResultView } from "./result-view";
import { FinalPlan, PlanReview } from "./plan-review";

export const dynamic = "force-dynamic";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  in_progress: { label: "采集中", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  collected: { label: "待审核", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  confirmed: { label: "已确认", cls: "bg-green-50 text-green-700 border-green-200" },
};

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; scales?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, scales: missingScaleIds, saved } = await searchParams;

  const session = await prisma.assessmentSession.findUnique({
    where: { id },
    include: {
      patient: true,
      answers: true,
      results: { orderBy: { createdAt: "desc" } },
      plans: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!session) notFound();

  const scaleIds = session.scaleIds as string[];
  const savedScores = new Map(
    session.answers.filter((a) => a.score !== null).map((a) => [a.questionId, a.score as number])
  );
  const meta = STATUS_META[session.status] ?? { label: session.status, cls: "" };
  const latestResult = session.results[0];
  const latestPlan = session.plans[0];

  const missingNames = (missingScaleIds ?? "")
    .split(",")
    .filter(Boolean)
    .map((sid) => scaleById.get(sid)?.name ?? sid)
    .join("、");

  return (
    <div className="space-y-6">
      {/* 头部：患者信息 + 状态 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            评估会话
            <span className={`rounded-full border px-3 py-0.5 text-sm font-normal ${meta.cls}`}>{meta.label}</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            患者：{session.patient.name}（{session.patient.gender}，{session.patient.age} 岁）
            <span className="font-mono ml-2">{session.patient.code}</span>
            <span className="ml-2">量表：{scaleIds.map((sid) => scaleById.get(sid)?.name ?? sid).join("、")}</span>
          </p>
        </div>
        <Link href={`/doctor/patients/${session.patientId}`} className="text-sm text-slate-500 hover:text-blue-600">
          ← 返回患者
        </Link>
      </div>

      {/* 提示条 */}
      {saved === "1" && (
        <div className="rounded-lg bg-green-50 border border-green-200 text-green-700 px-4 py-3 text-sm">
          草稿已保存（已保存 {savedScores.size} 题）。
        </div>
      )}
      {error === "incomplete" && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
          以下量表尚未答完，无法生成评估：{missingNames}。请补齐后再提交。
        </div>
      )}
      {error === "empty-plan" && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
          最终方案不能为空，请至少保留一项干预。
        </div>
      )}

      {/* 按状态分发主体视图 */}
      {session.status === "in_progress" && (
        <CollectForm
          sessionId={session.id}
          scaleIds={scaleIds}
          savedScores={savedScores}
          patient={session.patient}
        />
      )}

      {session.status === "collected" && latestResult && latestPlan && (
        <>
          <ResultView tags={latestResult.tags as unknown as AssessmentTag[]} />
          <PlanReview
            sessionId={session.id}
            candidates={latestPlan.candidates as unknown as RecommendedIntervention[]}
          />
        </>
      )}

      {session.status === "confirmed" && latestResult && latestPlan && (
        <>
          <ResultView tags={latestResult.tags as unknown as AssessmentTag[]} />
          <FinalPlan
            finalPlan={(latestPlan.finalPlan ?? []) as unknown as RecommendedIntervention[]}
            removedTags={((latestPlan.decisions ?? []) as { tag: string; action: string }[])
              .filter((d) => d.action === "remove")
              .map((d) => d.tag)}
            confirmedAt={latestPlan.confirmedAt}
          />
        </>
      )}
    </div>
  );
}
