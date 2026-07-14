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
import type { PlanDecision } from "@/lib/assessment/plan-review";
import { firstQueryValue } from "@/lib/query";
import { reopenSession } from "@/lib/actions/doctor";
import { readAnswerEditHistory } from "@/lib/assessment/audit";
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
  in_progress: { label: "采集中", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  collected: { label: "待审核", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  confirmed: { label: "已确认", cls: "bg-green-50 text-green-700 border-green-200" },
};

const TRACE_SOURCES = new Set<TraceAnswerSource>(["voice", "text", "button", "doctor", "measurement"]);
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
  const savedScores = new Map(
    session.answers
      .filter((a) => a.status === "confirmed" && a.score !== null)
      .map((a) => [a.questionId, a.score as number])
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
  const meta = STATUS_META[session.status] ?? { label: session.status, cls: "" };
  const latestResult = session.results[0];
  const latestPlan = session.plans.find((plan) =>
    session.status === "confirmed" ? plan.status === "confirmed" : plan.status === "draft"
  );

  const missingNames = (missingQuestionIds ?? "")
    .split(",")
    .filter(Boolean)
    .map((questionId) => {
      const scale = scaleIds.map((sid) => scaleById.get(sid)).find((item) => item?.questions.some((q) => q.id === questionId));
      const question = scale?.questions.find((item) => item.id === questionId);
      return question ? `${scale?.name}第 ${question.no} 题（${question.title}）` : questionId;
    })
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
          以下题目尚未确认，无法生成评估：{missingNames || "请检查未作答题目"}。请补齐后再提交。
        </div>
      )}

      {/* 按状态分发主体视图 */}
      {session.status === "in_progress" && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 flex items-center justify-between flex-wrap gap-2">
          <span>患者可在大屏上由数字医生语音问询（语音不可用时自动降级为按钮/文字作答）。</span>
          <Link
            href={`/patient/sessions/${session.id}`}
            target="_blank"
            className="rounded-md bg-sky-600 text-white px-3 py-1.5 hover:bg-sky-500"
          >
            打开患者端采集大屏 ↗
          </Link>
        </div>
      )}
      {session.status === "in_progress" && (
        <CollectForm
          sessionId={session.id}
          patientId={session.patientId}
          scaleIds={scaleIds}
          savedScores={savedScores}
          patient={session.patient}
        />
      )}

      {session.status === "collected" && latestResult && latestPlan && (
        <>
          <ResultView tags={latestResult.tags as unknown as AssessmentTag[]} answerLabels={answerLabels} />
          <PlanReview
            sessionId={session.id}
            candidates={latestPlan.candidates as unknown as RecommendedIntervention[]}
          />
        </>
      )}

      {session.status === "confirmed" && latestResult && latestPlan && (
        <>
          <ResultView tags={latestResult.tags as unknown as AssessmentTag[]} answerLabels={answerLabels} />
          <FinalPlan
            finalPlan={(latestPlan.finalPlan ?? []) as unknown as RecommendedIntervention[]}
            decisions={(latestPlan.decisions ?? []) as unknown as PlanDecision[]}
            confirmedAt={latestPlan.confirmedAt}
          />
          <form action={reopenSession.bind(null, session.id)} className="flex justify-start">
            <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:border-blue-300 hover:text-blue-700">
              重新打开并修正答案（保留历史版本）
            </button>
          </form>
        </>
      )}

      {traceAnswers.length > 0 && <TraceView answers={traceAnswers} dialogueTurns={traceTurns} />}
    </div>
  );
}
