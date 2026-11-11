/**
 * INPUT:  Prisma（会话、答案、评估结果、干预方案）、路由参数 id、查询提示参数
 * OUTPUT: 评估会话工作台：采集表单 → 结果与方案审核 → 最终方案
 * POS:    医生端核心页面，承载“采集 → 评估 → 推荐 → 审核确认”完整闭环
 *         2026-11-11 视觉精修：页头改为与其他医生端页面同款的平铺标题（去掉外层卡片与标题图标）。
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight, MonitorCheck, ExternalLink, Info } from "lucide-react";
import { prisma } from "@/lib/db";
import { scaleById, scales } from "@/lib/rules";
import type { AssessmentTag } from "@/lib/assessment/report-types";
import type { PlanCandidateItemV2, PlanCandidatesV2 } from "@/lib/recommend-v2";
import type { PlanDecision } from "@/lib/assessment/plan-review";
import { firstQueryValue } from "@/lib/query";
import { reopenSession } from "@/lib/actions/doctor";
import { readAnswerEditHistory } from "@/lib/assessment/audit";
import { inspectDoctorAudioFile } from "@/app/api/doctor/sessions/[id]/turns/[turnId]/audio/route";
import { CollectForm } from "./collect-form";
import { ResultView } from "./result-view";
import { FinalPlan, PlanReview } from "./plan-review";
import {
  TraceView,
  type TraceAnswerDto,
  type TraceAnswerSource,
  type TraceAnswerStatus,
  type TraceDialogueTurnDto,
} from "./trace-view";

export const dynamic = "force-dynamic";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  in_progress: { label: "采集中", cls: "ui-badge" },
  collected: { label: "待审核", cls: "ui-badge ui-badge-warning" },
  confirmed: { label: "已确认", cls: "ui-badge ui-badge-success" },
};

const TRACE_SOURCES = new Set<TraceAnswerSource>([
  "voice",
  "text",
  "button",
  "doctor",
  "measurement",
  "system",
  "multi",
  "drawing",
]);
const TRACE_STATUSES = new Set<TraceAnswerStatus>(["confirmed", "pending", "manual", "superseded"]);

function traceSource(value: string): TraceAnswerSource {
  return TRACE_SOURCES.has(value as TraceAnswerSource) ? (value as TraceAnswerSource) : "doctor";
}

function traceStatus(value: string): TraceAnswerStatus {
  return TRACE_STATUSES.has(value as TraceAnswerStatus) ? (value as TraceAnswerStatus) : "pending";
}

export default async function SessionPage({
  params,
  searchParams,
}: PageProps<"/doctor/sessions/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const error = firstQueryValue(query.error);
  const missingQuestionIds = firstQueryValue(query.missing);
  const blockedReasons = firstQueryValue(query.reasons);
  const saved = firstQueryValue(query.saved);

  const session = await prisma.assessmentSession.findUnique({
    where: { id },
    include: {
      patient: true,
      answers: true,
      turns: { orderBy: { createdAt: "asc" } },
      results: {
        where: { status: "current" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      },
      plans: {
        where: { status: { in: ["draft", "confirmed"] } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      },
    },
  });
  if (!session) notFound();

  const scaleIds = session.scaleIds as string[];
  // 代填表单的已保存答案：按选项 label 回填（IADL 等存在同分选项，分值无法唯一区分选项）
  const savedLabels = new Map(
    session.answers
      .filter(
        (answer) =>
          (answer.status === "confirmed" || answer.status === "pending") && answer.optionLabel !== null
      )
      .map((answer) => [answer.questionId, answer.optionLabel as string])
  );
  // 画钟等：pending 态仍带 rawText（data URL），代填界面预览用
  const savedRawTexts = new Map(
    session.answers
      .filter((answer) => answer.rawText !== null)
      .map((answer) => [answer.questionId, answer.rawText as string])
  );
  const answerLabels = Object.fromEntries(
    session.answers
      .filter((answer) => answer.status === "confirmed" && answer.optionLabel)
      .map((answer) => [answer.questionId, answer.optionLabel as string])
  );
  const questionOrder = new Map(
    scaleIds
      .flatMap((scaleId) => scaleById.get(scaleId)?.questions ?? [])
      .map((question, index) => [question.id, index])
  );
  const traceAnswers: TraceAnswerDto[] = session.answers
    .map((answer) => ({
      questionId: answer.questionId,
      rawText: answer.rawText,
      optionLabel: answer.optionLabel,
      score: answer.score,
      source: traceSource(answer.source),
      status: traceStatus(answer.status),
      editHistory: readAnswerEditHistory(answer.editHistory),
      updatedAt: answer.updatedAt,
    }))
    .sort((a, b) => (questionOrder.get(a.questionId) ?? 999) - (questionOrder.get(b.questionId) ?? 999));
  const traceTurns: TraceDialogueTurnDto[] = await Promise.all(
    session.turns
      .filter((turn) => turn.role === "doctor" || turn.role === "patient" || turn.role === "system")
      .map(async (turn) => ({
        id: turn.id,
        questionId: turn.questionId,
        role: turn.role as TraceDialogueTurnDto["role"],
        audioPath: turn.audioPath,
        audioStatus: await inspectDoctorAudioFile(session.id, turn.audioPath),
        createdAt: turn.createdAt,
      }))
  );
  const meta = STATUS_META[session.status] ?? { label: session.status, cls: "ui-badge" };
  const latestResult = session.results[0];
  const latestPlan = session.plans.find((plan) =>
    session.status === "confirmed" ? plan.status === "confirmed" : plan.status === "draft"
  );

  const missingNames = (missingQuestionIds ?? "")
    .split(",")
    .filter(Boolean)
    .map((questionId) => {
      const scale = scaleIds.map((scaleId) => scaleById.get(scaleId)).find((item) => item?.questions.some((question) => question.id === questionId));
      const question = scale?.questions.find((item) => item.id === questionId);
      return question ? `${scale?.name}第 ${question.no} 题（${question.title}）` : questionId;
    })
    .join("、");
  const collecting = session.status === "in_progress";
  const selectedScales = scales.filter((scale) => scaleIds.includes(scale.id));
  const directory = collecting
    ? selectedScales.map((scale) => ({ id: `collect-${scale.id}`, label: scale.name }))
    : latestResult && latestPlan
      ? [
          { id: "assessment-results", label: "评估结果" },
          { id: "intervention-plan", label: session.status === "confirmed" ? "最终干预方案" : "干预方案审核" },
        ]
      : [];
  if (traceAnswers.length > 0) directory.push({ id: "answer-trace", label: "答案与采集追溯" });

  return (
    <div className="app-page space-y-6">
      {/* 与患者管理/患者档案/新建档案同一页头：平铺标题 + 右侧返回按钮，不再单独套卡片 */}
      <div className="page-heading">
        <div className="page-heading-copy">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="page-title">评估会话</h1>
            <span className={meta.cls}>{meta.label}</span>
          </div>
          <p className="page-description inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <strong className="font-semibold text-foreground">{session.patient.name}</strong>
            <span>{session.patient.gender} · {session.patient.age} 岁</span>
            <span className="font-mono text-xs">{session.patient.code}</span>
          </p>
        </div>
        <Link href={`/doctor/patients/${session.patientId}`} className="ui-button ui-button-secondary">
          <ArrowLeft size={17} aria-hidden="true" />
          返回患者
        </Link>
      </div>

      {saved === "1" && (
        <div className="ui-alert">
          <Info size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          草稿已保存（已保存 {savedLabels.size} 题）。
        </div>
      )}
      {error === "incomplete" && (
        <div className="ui-alert ui-alert-danger">
          <Info size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            以下题目尚未确认，无法生成评估：{missingNames || "请检查未作答题目"}。请补齐后再提交。
            {blockedReasons && <span className="mt-1 block">{blockedReasons}</span>}
          </span>
        </div>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
        <aside className="space-y-3 xl:sticky xl:top-20">
          {collecting && (
            <Link href={`/patient/sessions/${session.id}`} target="_blank" className="ui-button ui-button-primary w-full justify-between px-3">
              <MonitorCheck size={17} aria-hidden="true" />
              打开患者端采集大屏
              <ExternalLink size={14} aria-hidden="true" />
            </Link>
          )}
          {directory.length > 0 && (
            <nav aria-label="会话目录" className="rounded-2xl border border-border bg-card p-2.5">
              <p className="px-2 py-1.5 text-sm font-bold text-muted-foreground">{collecting ? "量表目录" : "会话目录"}</p>
              <ol className="flex flex-wrap gap-1 xl:block xl:max-h-[62vh] xl:space-y-1 xl:overflow-y-auto">
                {directory.map(({ id, label }) => (
                  <li key={id}>
                    <a href={`#${id}`} className="flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
                      <ChevronRight className="size-3.5 shrink-0 text-primary" aria-hidden="true" /> {label}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}
        </aside>

        <div className="min-w-0 space-y-5">
          {collecting && (
            <CollectForm
              sessionId={session.id}
              patientId={session.patientId}
              scaleIds={scaleIds}
              savedLabels={savedLabels}
              savedRawTexts={savedRawTexts}
            />
          )}

          {session.status === "collected" && latestResult && latestPlan && (
            <>
              <div className="ui-alert ui-alert-warning">
                <Info size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                评估报告与候选方案，患者已可在大屏上直接看到。请核对干预项目与禁忌提示后确认方案。
              </div>
              <ResultView tags={latestResult.tags as unknown as AssessmentTag[]} answerLabels={answerLabels} />
              <PlanReview
                sessionId={session.id}
                candidates={(latestPlan.candidates as unknown as PlanCandidatesV2).items}
                forbidden={(latestPlan.candidates as unknown as PlanCandidatesV2).forbidden ?? []}
              />
            </>
          )}

          {session.status === "confirmed" && latestResult && latestPlan && (
            <>
              <ResultView tags={latestResult.tags as unknown as AssessmentTag[]} answerLabels={answerLabels} />
              <FinalPlan
                finalPlan={(latestPlan.finalPlan ?? []) as unknown as PlanCandidateItemV2[]}
                decisions={(latestPlan.decisions ?? []) as unknown as PlanDecision[]}
                confirmedAt={latestPlan.confirmedAt}
              />
              <form action={reopenSession.bind(null, session.id)} className="flex justify-start">
                <button className="ui-button ui-button-secondary">
                  重新打开并修正答案（保留历史版本）
                </button>
              </form>
            </>
          )}

          {traceAnswers.length > 0 && (
            <TraceView sessionId={session.id} answers={traceAnswers} dialogueTurns={traceTurns} />
          )}
        </div>
      </div>
    </div>
  );
}
