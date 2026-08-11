/**
 * INPUT:  路由查询参数 patientId、错误提示；Prisma 患者档案与历史会话（含报告快照/干预方案）
 * OUTPUT: 患者端「随访对比评估」方式页（2026-08-08 设计图·方式三）
 * POS:    患者自助建档第二步·方式三：调取既往评估与干预结果，只复评需要更新的内容。
 *         口径说明：设计图指定患者端可自助复评既有量表（与 V2.0 §3「复评属医生授权」不同）——
 *         本页走 startAssessment 新建独立会话，报告页 scaleScopes 会自动标「复评」并出随访对比；
 *         报告页补充评估的 guard（createSupplementarySession）不受影响。
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  IconArrowLeft,
  IconArrowRight,
  IconHistory,
  IconWalk,
  IconSalad,
  IconLeaf,
  IconStethoscope,
  IconClipboardText,
} from "@tabler/icons-react";
import { startAssessment } from "@/lib/actions/patient";
import { prisma } from "@/lib/db";
import { firstQueryValue } from "@/lib/query";
import { SCORABLE_SCALE_IDS } from "@/lib/assessment/scale-packages";
import {
  askableQuestionCount,
  estimateMinutes,
} from "@/lib/assessment/patient-scale-packages";
import { completedScaleIds } from "@/lib/assessment/supplementary";
import { SCALE_LABELS, SCALE_SUBTITLES } from "@/lib/assessment/scale-selection";
import FollowupForm, { type FollowupScaleItem } from "./followup-form";

export const dynamic = "force-dynamic";

/** 报告快照标签的最小形状（AssessmentResult.tags Json，见 report-types AssessmentTag） */
interface SnapshotTag {
  code?: string;
  tag: string;
  level: string;
  scaleId: string;
}

/** 干预方案候选快照的最小形状（InterventionPlan.candidates Json，见 recommend-v2 toPlanCandidates） */
interface SnapshotCandidates {
  items?: { code: string; name: string; category: string }[];
}

/** 干预大类图标（上次干预方案行展示用） */
const CATEGORY_ICONS: Record<string, typeof IconWalk> = {
  运动: IconWalk,
  膳食营养: IconSalad,
  中医食养: IconLeaf,
  就诊建议: IconStethoscope,
};

/** 按需补充候选的优先顺序（设计图：居家环境筛查表等上次未做项目） */
const EXTRA_PREFERENCE = ["home_env", "lubben", "ais"];

export default async function PatientFollowupScalesPage({
  searchParams,
}: PageProps<"/patient/select-scales/followup">) {
  const params = await searchParams;
  const { patientId } = params;
  const error = firstQueryValue(params.error) ?? null;
  if (!patientId || typeof patientId !== "string") {
    redirect("/patient/register");
  }

  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { id: true },
  });
  if (!patient) notFound();

  // 已出报告（collected/confirmed）的既往会话，最新在前；最近一次作为复评基准
  const reportedSessions = await prisma.assessmentSession.findMany({
    where: { patientId, status: { in: ["collected", "confirmed"] } },
    orderBy: { startedAt: "desc" },
    take: 5,
    include: {
      results: { where: { status: "current" }, take: 1 },
      plans: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  return (
    <main className="patient-main flex-1">
      <Link
        href={`/patient/select-scales?patientId=${patientId}`}
        className="ui-button ui-button-quiet -ml-2 mb-6"
      >
        <IconArrowLeft size={19} stroke={2} aria-hidden="true" />
        返回方式选择
      </Link>

      <section className="patient-panel overflow-hidden">
        <div className="border-b border-blue-100 bg-[#f8fbff] px-6 py-7 sm:px-9 sm:py-9">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white text-blue-600 shadow-[0_6px_16px_rgba(33,87,160,0.08)]">
              <IconHistory size={26} stroke={1.9} aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-extrabold tracking-[0.1em] text-blue-700">第二步 · 随访对比评估</p>
              <h1 className="patient-display-title mt-2">随访对比评估</h1>
              <p className="patient-display-copy max-w-2xl">
                调取上次评估结果，只复评需要更新的项目。
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-7 sm:px-9 sm:py-9">
          {reportedSessions.length === 0 ? (
            <div className="rounded-2xl border border-blue-100 bg-[#f8fbff] px-6 py-12 text-center">
              <p className="text-lg font-extrabold text-[#173766]">还没有已完成的评估记录</p>
              <p className="mt-2 text-base leading-7 text-[#62779a]">
                随访对比需要以上一次评估结果为基准。请先完成一次常规综合评估。
              </p>
              <Link
                href={`/patient/select-scales/routine?patientId=${patientId}`}
                className="patient-primary-action mx-auto mt-6 w-full sm:w-auto"
              >
                前往常规综合评估
                <IconArrowRight size={25} stroke={2.1} aria-hidden="true" />
              </Link>
            </div>
          ) : (
            <FollowupContent
              patientId={patientId}
              error={error}
              sessions={reportedSessions.map((s) => ({
                id: s.id,
                startedAt: s.startedAt,
                scaleIds: s.scaleIds as string[],
                tags: (s.results[0]?.tags as unknown as SnapshotTag[] | undefined) ?? [],
                interventions:
                  (s.plans[0]?.candidates as unknown as SnapshotCandidates | undefined)?.items ?? [],
              }))}
            />
          )}
        </div>
      </section>
    </main>
  );
}

interface FollowupSessionInfo {
  id: string;
  startedAt: Date;
  scaleIds: string[];
  tags: SnapshotTag[];
  interventions: { code: string; name: string; category: string }[];
}

/** 有既往报告时的三栏内容（既往记录 / 上次结果摘要 / 建议复评项目 + 统计条） */
function FollowupContent({
  patientId,
  error,
  sessions,
}: {
  patientId: string;
  error: string | null;
  sessions: FollowupSessionInfo[];
}) {
  const latest = sessions[0];
  const latestScaleIds = latest.scaleIds;

  const toItem = (scaleId: string): FollowupScaleItem => ({
    id: scaleId,
    label: SCALE_LABELS[scaleId] ?? scaleId,
    subtitle: SCALE_SUBTITLES[scaleId] ?? "",
  });

  // 按需补充：上次（及历史）未做过的量表，按优先顺序取至多 3 项
  const done = completedScaleIds(
    sessions.map((s) => ({ status: "collected", scaleIds: s.scaleIds, startedAt: s.startedAt }))
  );
  const extraIds = [
    ...EXTRA_PREFERENCE.filter((id) => !done.has(id)),
    ...SCORABLE_SCALE_IDS.filter((id) => !done.has(id) && !EXTRA_PREFERENCE.includes(id)),
  ].slice(0, 3);

  const askableCounts: Record<string, number> = {};
  for (const id of [...latestScaleIds, ...extraIds]) {
    askableCounts[id] = askableQuestionCount(id);
  }

  return (
    <div className="space-y-7">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.1fr)_minmax(0,1.1fr)]">
        {/* 左栏：既往评估记录 */}
        <section className="space-y-3">
          <h2 className="text-lg font-extrabold text-[#173766]">既往评估记录</h2>
          {sessions.map((session, index) => (
            <div
              key={session.id}
              className={[
                "rounded-2xl border p-4",
                index === 0 ? "border-blue-300 bg-blue-50/60" : "border-blue-100 bg-white",
              ].join(" ")}
            >
              <p className="flex flex-wrap items-center gap-2 text-base font-extrabold text-[#173766]">
                {session.startedAt.toLocaleDateString("zh-CN")}
                {index === 0 && <span className="ui-badge ui-badge-success">当前记录</span>}
              </p>
              <p className="mt-1 text-sm text-[#7f94b3]">{session.scaleIds.length} 个量表</p>
            </div>
          ))}
        </section>

        {/* 中栏：上次评估结果摘要 */}
        <section className="space-y-4 rounded-2xl border border-blue-100 bg-white p-5">
          <h2 className="text-lg font-extrabold text-[#173766]">上次评估结果摘要</h2>
          {latest.tags.length === 0 ? (
            <p className="text-sm leading-6 text-[#7f94b3]">上次评估未产生异常标签。</p>
          ) : (
            <ul className="space-y-2">
              {latest.tags.slice(0, 8).map((tag) => (
                <li
                  key={`${tag.scaleId}-${tag.code ?? tag.tag}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-blue-100 bg-[#f8fbff] px-3 py-2"
                >
                  <span className="text-sm font-bold text-[#405a81]">
                    {SCALE_LABELS[tag.scaleId] ?? tag.scaleId}
                  </span>
                  <span className="ui-badge ui-badge-warning">{tag.tag}</span>
                </li>
              ))}
            </ul>
          )}
          {latest.interventions.length > 0 && (
            <div>
              <p className="text-sm font-extrabold tracking-wide text-[#62779a]">上次干预方案</p>
              <div className="mt-2 flex flex-wrap gap-3">
                {latest.interventions.slice(0, 4).map((item) => {
                  const Icon = CATEGORY_ICONS[item.category] ?? IconClipboardText;
                  return (
                    <span
                      key={item.code}
                      className="inline-flex flex-col items-center gap-1 rounded-2xl border border-blue-100 bg-[#f8fbff] px-3 py-2 text-center"
                    >
                      <Icon size={22} stroke={1.9} className="text-blue-600" aria-hidden="true" />
                      <span className="max-w-24 text-xs font-bold leading-4 text-[#405a81]">{item.name}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* 右栏：建议复评项目 + 提交（客户端表单） */}
        <div>
          <FollowupForm
            focusScales={latestScaleIds.map(toItem)}
            extraScales={extraIds.map(toItem)}
            askableCounts={askableCounts}
            previousCount={latestScaleIds.length}
            previousMinutes={estimateMinutes(latestScaleIds)}
            error={error}
            action={startAssessment.bind(null, patientId)}
          />
        </div>
      </div>
    </div>
  );
}
