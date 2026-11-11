/**
 * INPUT:  路由查询参数 patientId、错误提示；Prisma 患者档案与历史会话（含报告快照/干预方案）
 * OUTPUT: 患者端「随访对比评估」方式页（2026-08-08 设计图·方式三）
 * POS:    患者自助建档第二步·方式三：调取既往评估与干预结果，只复评需要更新的内容。
 *         口径说明：设计图指定患者端可自助复评既有量表（与 V2.0 §3「复评属医生授权」不同）——
 *         本页走 startAssessment 新建独立会话，报告页 scaleScopes 会自动标「复评」并出随访对比；
 *         报告页补充评估的 guard（createSupplementarySession）不受影响。
 */
import Link from "next/link";
import { PatientPageHeading } from "@/components/patient-page-heading";
import { SectionDisclosure } from "@/components/section-disclosure";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, History, Footprints, Salad, Leaf, Stethoscope, ClipboardList } from "lucide-react";
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
const CATEGORY_ICONS: Record<string, typeof Footprints> = {
  运动: Footprints,
  膳食营养: Salad,
  中医食养: Leaf,
  就诊建议: Stethoscope,
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
    select: { name: true, gender: true, age: true },
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
    <main className="patient-main assessment-page flex-1">
      <Link
        href={`/patient/select-scales?patientId=${patientId}`}
        className="ui-button ui-button-quiet -ml-2 mb-6"
      >
        <ArrowLeft size={19} strokeWidth={2} aria-hidden="true" />
        返回方式选择
      </Link>

      <section>
        <PatientPageHeading
          plain
          icon={<History className="size-6" />}
          title="随访对比评估"
          description="调取上次评估结果，只复评需要更新的项目。"
        />

        <div>
          {reportedSessions.length === 0 ? (
            <div className="care-band px-6 py-12 text-center">
              <p className="text-lg font-extrabold text-[#173766]">还没有已完成的评估记录</p>
              <p className="mt-2 text-base leading-7 text-[#62779a]">
                随访对比需要以上一次评估结果为基准。请先完成一次常规综合评估。
              </p>
              <Link
                href={`/patient/select-scales/routine?patientId=${patientId}`}
                className="patient-primary-action mx-auto mt-6 w-full sm:w-auto"
              >
                前往常规综合评估
                <ArrowRight size={25} strokeWidth={2.1} aria-hidden="true" />
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
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(15rem,0.65fr)_minmax(0,1.35fr)]">
      <aside className="space-y-3">
        <div className="care-band p-5">
          <h2 className="font-bold text-[var(--care-ink)]">上次评估</h2>
          <p className="mt-2 text-2xl font-bold text-primary tabular-nums">{latest.startedAt.toLocaleDateString("zh-CN")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{latestScaleIds.length} 个评估项目</p>
        </div>
        <SectionDisclosure title="查看上次评估摘要">
          {latest.tags.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无结论记录。</p>
          ) : (
            <ul className="space-y-2">
              {latest.tags.map((tag) => (
                <li
                  key={`${tag.scaleId}-${tag.code ?? tag.tag}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-blue-100 bg-[#f8fbff] px-3 py-2"
                >
                  <span className="text-sm font-bold text-[#405a81]">
                    {SCALE_LABELS[tag.scaleId] ?? tag.scaleId}
                  </span>
                  <span className="text-sm font-semibold text-foreground">{tag.tag}</span>
                </li>
              ))}
            </ul>
          )}
          {latest.interventions.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-extrabold tracking-wide text-[#62779a]">上次干预方案</p>
              <div className="mt-2 flex flex-wrap gap-3">
                {latest.interventions.map((item) => {
                  const Icon = CATEGORY_ICONS[item.category] ?? ClipboardList;
                  return (
                    <span
                      key={item.code}
                      className="inline-flex flex-col items-center gap-1 rounded-2xl border border-blue-100 bg-[#f8fbff] px-3 py-2 text-center"
                    >
                      <Icon size={22} strokeWidth={1.9} className="text-blue-600" aria-hidden="true" />
                      <span className="max-w-24 text-xs font-bold leading-4 text-[#405a81]">{item.name}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </SectionDisclosure>
        <SectionDisclosure title="历次评估记录" summary={`${sessions.length} 次`}>
          <ul className="divide-y divide-border">
            {sessions.map((session, index) => (
              <li key={session.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="font-semibold tabular-nums">{session.startedAt.toLocaleDateString("zh-CN")}</span>
                <span className="text-sm text-muted-foreground">{session.scaleIds.length} 项</span>
                {index === 0 && <span className="ui-badge">本次对照</span>}
              </li>
            ))}
          </ul>
        </SectionDisclosure>
      </aside>

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
  );
}
