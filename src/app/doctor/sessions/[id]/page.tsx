/**
 * INPUT:  Prisma（会话、答案、评估结果、干预方案）、路由参数 id、查询提示参数
 * OUTPUT: 评估会话工作台：采集表单 → 结果与方案审核 → 最终方案
 * POS:    医生端核心页面，承载“采集 → 评估 → 推荐 → 审核确认”完整闭环
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  IconArrowLeft,
  IconClipboardText,
  IconDeviceDesktopAnalytics,
  IconExternalLink,
  IconInfoCircle,
  IconUser,
} from "@tabler/icons-react";
import { prisma } from "@/lib/db";
import { scaleById } from "@/lib/rules";
import type { AssessmentTag } from "@/lib/assessment/report-types";
import type { PlanCandidateItemV2, PlanCandidatesV2 } from "@/lib/recommend-v2";
import type { PlanDecision } from "@/lib/assessment/plan-review";
import { firstQueryValue } from "@/lib/query";
import { reopenSession } from "@/lib/actions/doctor";
import { readAnswerEditHistory } from "@/lib/assessment/audit";
import { V2DemoPipeline } from "@/components/v2-pipeline";
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
  const traceTurns: TraceDialogueTurnDto[] = session.turns
    .filter((turn) => turn.role === "doctor" || turn.role === "patient" || turn.role === "system")
    .map((turn) => ({
      id: turn.id,
      questionId: turn.questionId,
      role: turn.role as TraceDialogueTurnDto["role"],
      audioPath: turn.audioPath,
      createdAt: turn.createdAt,
    }));
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

  return (
    <div className="app-page space-y-6">
      <div className="page-heading">
        <div className="page-heading-copy">
          <p className="page-eyebrow">DEMO V2 · 采集 / 判定 / 匹配</p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="page-title inline-flex items-center gap-2">
              <IconClipboardText size={27} className="text-blue-600" aria-hidden="true" />
              评估会话
            </h1>
            <span className={meta.cls}>{meta.label}</span>
          </div>
          <p className="page-description inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <IconUser size={17} className="text-blue-500" aria-hidden="true" />
            患者：{session.patient.name}（{session.patient.gender}，{session.patient.age} 岁）
            <span className="font-mono text-xs">{session.patient.code}</span>
            <span>量表：{scaleIds.map((scaleId) => scaleById.get(scaleId)?.name ?? scaleId).join("、")}</span>
          </p>
        </div>
        <Link href={`/doctor/patients/${session.patientId}`} className="ui-button ui-button-secondary">
          <IconArrowLeft size={17} aria-hidden="true" />
          返回患者
        </Link>
      </div>

      <V2DemoPipeline
        current={
          session.status === "in_progress" ? 3 : session.status === "collected" ? 5 : 6
        }
        compact
      />

      {saved === "1" && (
        <div className="ui-alert">
          <IconInfoCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          草稿已保存（已保存 {savedLabels.size} 题）。
        </div>
      )}
      {error === "incomplete" && (
        <div className="ui-alert ui-alert-danger">
          <IconInfoCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            以下题目尚未确认，无法生成评估：{missingNames || "请检查未作答题目"}。请补齐后再提交。
            {blockedReasons && <span className="mt-1 block">{blockedReasons}</span>}
          </span>
        </div>
      )}

      {session.status === "in_progress" && (
        <div className="ui-alert flex-wrap justify-between gap-3">
          <span className="inline-flex items-start gap-2">
            <IconDeviceDesktopAnalytics size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            患者可在大屏上由数字医生语音问询；语音不可用时会自动降级为按钮或文字作答。
          </span>
          <Link href={`/patient/sessions/${session.id}`} target="_blank" className="ui-button ui-button-primary min-h-9 px-3 py-1.5 text-xs">
            打开患者端采集大屏
            <IconExternalLink size={15} aria-hidden="true" />
          </Link>
        </div>
      )}
      {session.status === "in_progress" && (
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
            <IconInfoCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            评估报告与以下候选方案，患者已可在大屏上直接看到（含禁忌提示原文）。请尽快核实并确认最终方案。
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

      {traceAnswers.length > 0 && <TraceView answers={traceAnswers} dialogueTurns={traceTurns} />}
    </div>
  );
}
