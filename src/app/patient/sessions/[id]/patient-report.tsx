/**
 * INPUT:  评估标签快照（AssessmentResult）、候选/最终干预方案（InterventionPlan）、
 *         评估范围标识与历史报告/补充评估派生信息（V2.0 §3）、复评量表随访对比（Demo_v2 步骤 2）
 * OUTPUT: PatientReport —— 患者端大屏的评估报告与干预方案展示（问答完成后立即可见）
 * POS:    产品口径（2026-07-14 已与用户确认）：评估内容是确定性计算，问答完成即生成报告，
 *         不需要医生先审核评估结果；干预方案候选医生仍会另行审核调整（保留 InterventionPlan
 *         的 draft→confirmed 流程与禁忌提示硬约束），本组件与医生端审核互不阻塞、并行展示。
 *         方案状态（初步 / 医生已确认）必须醒目区分，让患者知道自己看到的是哪个阶段的内容。
 *         V2.0 §3：报告必须可识别评估范围（新增/复评量表）与生成时间，保留历史报告入口，
 *         并可对尚未完成的量表直接发起补充评估（复评属医生授权，不在患者自助入口出现）。
 */
import Link from "next/link";
import {
  IconAlertTriangle,
  IconCalendarClock,
  IconCheck,
  IconClipboardCheck,
  IconClipboardPlus,
  IconFileDescription,
  IconHeartHandshake,
  IconHistory,
  IconPlus,
  IconShieldCheck,
  IconStethoscope,
} from "@tabler/icons-react";
import { isAttentionTag, type AssessmentTag } from "@/lib/assessment/report-types";
import type { PlanCandidateItemV2 } from "@/lib/recommend-v2";
import type { ScaleComparison, ScaleScope, TagChange } from "@/lib/assessment/supplementary";
import { scales, scoringCategories } from "@/lib/rules";
import { InterventionVideo, InterventionImage, InterventionText } from "@/components/intervention-media";
import { createSupplementarySession } from "@/lib/actions/patient";

/** 5 大类固定展示顺序：运动干预 → 膳食营养 → 中医食养 → 就诊建议 → 其他（来源：积分数据 categories 顺序） */
const CATEGORY_ORDER = scoringCategories.map((c) => c.label);

const LEVEL_LABEL: Record<string, string> = {
  是: "",
  否: "（否）",
  倾向是: "（倾向）",
  基本是: "（基本符合）",
};

/** 报告量表范围项（新增/复评标识由服务端按同患者历史会话派生） */
export interface ReportScale {
  id: string;
  name: string;
  scope: ScaleScope;
}

/** 历史报告入口项（同患者其他已出报告的会话） */
export interface HistoryReportEntry {
  id: string;
  assessedAt: Date;
  scaleNames: string[];
}

/** 补充评估可选量表项 */
export interface RemainingScale {
  id: string;
  name: string;
  needsClinician: boolean;
}

/**
 * 部分计分量表（Demo 口径 deferClinical）：这些量表含医生检查题（舌象/测量等）暂未计分，
 * 报告页须如实标注"结果仅供参考"，医生补录重评后结论可能更新。
 */
export interface DeferredScale {
  scaleId: string;
  scaleName: string;
  questionIds: string[];
}

interface PatientReportProps {
  sessionId: string;
  patientLabel: string;
  /** 报告生成时间（采集完成时间，缺失时退化为会话发起时间） */
  assessedAt: Date;
  reportScales: ReportScale[];
  tags: readonly AssessmentTag[];
  /** 部分计分的量表（快照 AssessmentResult.deferred；老快照无此字段时页面传 []） */
  deferredScales: readonly DeferredScale[];
  /** 复评量表与上次报告的对比（服务端按同患者历史快照派生；纯新增评估传 []） */
  comparisons: readonly ScaleComparison[];
  planStatus: "draft" | "confirmed";
  plan: readonly PlanCandidateItemV2[];
  confirmedAt: Date | null;
  historyReports: HistoryReportEntry[];
  remainingScales: RemainingScale[];
  error?: string;
}

export function PatientReport({
  sessionId,
  patientLabel,
  assessedAt,
  reportScales,
  tags,
  deferredScales,
  comparisons,
  planStatus,
  plan,
  confirmedAt,
  historyReports,
  remainingScales,
  error,
}: PatientReportProps) {
  return (
    <main className="patient-shell flex-1">
      <PatientReportTopbar />

      <div className="patient-main space-y-6">
        <header className="patient-panel px-6 py-8 text-center md:px-10 md:py-10">
          <span className="ui-badge mx-auto">
            <IconClipboardCheck size={17} stroke={1.9} aria-hidden="true" />
            评估已生成
          </span>
          <h1 className="patient-display-title mt-4">您的评估报告</h1>
          <p className="patient-display-copy">{patientLabel}</p>
          {/* V2.0 §3：报告必须可识别评估范围与生成时间 */}
          <p className="mt-2 flex flex-wrap items-center justify-center gap-2 text-lg text-[var(--ink-muted)]">
            <IconCalendarClock size={21} stroke={1.8} aria-hidden="true" />
            评估时间：{assessedAt.toLocaleString("zh-CN")}
          </p>
          <ul className="mt-4 flex flex-wrap items-center justify-center gap-2" aria-label="本次评估内容">
            {reportScales.map((scale) => (
              <li
                key={scale.id}
                className="inline-flex items-center gap-2 rounded-2xl border border-[var(--line-strong)] bg-[var(--brand-soft)] px-4 py-2 text-lg font-bold text-[var(--brand-strong)]"
              >
                {scale.name}
                <span
                  className={`ui-badge ${scale.scope === "repeat" ? "ui-badge-warning" : "ui-badge-success"}`}
                >
                  {scale.scope === "repeat" ? "复评" : "新增"}
                </span>
                {deferredScales.some((d) => d.scaleId === scale.id) && (
                  <span className="ui-badge ui-badge-warning">部分计分</span>
                )}
              </li>
            ))}
          </ul>
        </header>

        {error === "scales" && (
          <div className="ui-alert ui-alert-danger text-lg" role="alert">
            <IconAlertTriangle size={23} stroke={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>请至少勾选一项要补充评估的内容。</span>
          </div>
        )}
        {error === "repeat" && (
          <div className="ui-alert ui-alert-danger text-lg" role="alert">
            <IconAlertTriangle size={23} stroke={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>勾选的项目已经评估过了；如需重新评估，请医生在工作台为您发起。</span>
          </div>
        )}
        {error === "not_reported" && (
          <div className="ui-alert ui-alert-danger text-lg" role="alert">
            <IconAlertTriangle size={23} stroke={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>上次评估尚未出报告，暂不能发起补充评估，请稍后再试或请联系医生。</span>
          </div>
        )}

        <TagsSection tags={tags} deferredScales={deferredScales} />
        {comparisons.length > 0 && <ComparisonSection comparisons={comparisons} />}
        <PlanSection planStatus={planStatus} plan={plan} confirmedAt={confirmedAt} />

        {remainingScales.length > 0 && (
          <SupplementarySection sessionId={sessionId} remainingScales={remainingScales} />
        )}
        {historyReports.length > 0 && <HistorySection historyReports={historyReports} />}

        <p className="mx-auto max-w-2xl pb-4 text-center text-base leading-7 text-[var(--ink-muted)]">
          如果您对报告内容有任何疑问，请随时与医生沟通。
        </p>
      </div>
    </main>
  );
}

/**
 * 补充评估入口（V2.0 §3）：只列"尚未完成的量表"（复评需医生在工作台发起）；
 * 提交即创建独立新会话并进入问询，复用既有档案与测量数据，不影响本次报告。
 */
function SupplementarySection({
  sessionId,
  remainingScales,
}: {
  sessionId: string;
  remainingScales: RemainingScale[];
}) {
  return (
    <section className="patient-panel px-6 py-7 md:px-8">
      <span className="ui-badge">
        <IconClipboardPlus size={16} stroke={1.8} aria-hidden="true" />
        补充评估
      </span>
      <h2 className="mt-3 text-2xl font-bold text-[var(--ink)]">还想评估更多项目？</h2>
      <p className="mt-2 max-w-2xl text-base leading-7 text-[var(--ink-muted)]">
        勾选后点下方大按钮即可开始新一轮问答；本次报告和历史记录都会保留，互不影响。
        如需重新评估已完成的项目，请医生在工作台为您发起。
      </p>
      <form action={createSupplementarySession.bind(null, sessionId)} className="mt-5 space-y-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {remainingScales.map((scale) => (
            <label key={scale.id} className="patient-check">
              <input type="checkbox" name="scaleIds" value={scale.id} />
              <span className="min-w-0">
                <span className="block text-lg font-extrabold leading-tight text-[var(--ink)]">{scale.name}</span>
                <span
                  className={`mt-2 flex items-start gap-1.5 text-sm font-semibold leading-6 ${
                    scale.needsClinician ? "text-[var(--warning)]" : "text-[var(--success)]"
                  }`}
                >
                  {scale.needsClinician ? (
                    <IconStethoscope size={17} stroke={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <IconCheck size={17} stroke={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                  )}
                  <span>
                    {scale.needsClinician
                      ? "含舌象、测量等需医生查看的项，这些题暂不计分，答完先出部分计分报告"
                      : "可当场生成评估报告"}
                  </span>
                </span>
              </span>
            </label>
          ))}
        </div>
        <button type="submit" className="patient-primary-action w-full sm:w-auto">
          <IconPlus size={26} stroke={2} aria-hidden="true" />
          <span>开始补充评估</span>
        </button>
      </form>
    </section>
  );
}

/** 历史报告入口（V2.0 §3）：同患者历次已出报告的评估，按时间分别展示、可进入查看 */
function HistorySection({ historyReports }: { historyReports: HistoryReportEntry[] }) {
  return (
    <section className="patient-panel px-6 py-7 md:px-8">
      <span className="ui-badge">
        <IconHistory size={16} stroke={1.8} aria-hidden="true" />
        历史记录
      </span>
      <h2 className="mt-3 text-2xl font-bold text-[var(--ink)]">历史评估报告</h2>
      <ul className="mt-4 space-y-3">
        {historyReports.map((report) => (
          <li key={report.id}>
            <Link
              href={`/patient/sessions/${report.id}`}
              className="patient-choice min-h-[72px] justify-between gap-4 px-5 py-4"
            >
              <span className="min-w-0">
                <span className="block text-lg font-bold text-[var(--ink)]">
                  {report.scaleNames.join("、")}
                </span>
                <span className="mt-1 block text-base text-[var(--ink-muted)]">
                  评估时间：{report.assessedAt.toLocaleString("zh-CN")}
                </span>
              </span>
              <span className="shrink-0 text-base font-bold text-[var(--brand)]">查看报告</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * 随访对比（Demo_v2 步骤 2）：复评量表与同患者上次已出报告会话的对比——
 * 标签集合变化（新增/消失/保留）与总分升降。总分箭头只表方向不定好坏
 * （不同量表高分含义相反，如 FRAIL 高=差、MNA-SF 高=好），避免误导。
 */
function ComparisonSection({ comparisons }: { comparisons: readonly ScaleComparison[] }) {
  return (
    <section className="patient-panel px-6 py-7 md:px-8">
      <span className="ui-badge">
        <IconHistory size={16} stroke={1.8} aria-hidden="true" />
        随访对比
      </span>
      <h2 className="mt-3 text-2xl font-bold text-[var(--ink)]">与上次评估对比</h2>
      <div className="mt-5 space-y-4">
        {comparisons.map((comparison) => (
          <ComparisonCard key={comparison.scaleId} comparison={comparison} />
        ))}
      </div>
    </section>
  );
}

/** 单个复评量表的对比卡片 */
function ComparisonCard({ comparison }: { comparison: ScaleComparison }) {
  const scaleName = scales.find((s) => s.id === comparison.scaleId)?.name ?? comparison.scaleId;
  const { previousScore, currentScore } = comparison;
  const delta = previousScore !== null && currentScore !== null ? currentScore - previousScore : null;
  const tagLabel = (change: TagChange) => `${change.tag}${LEVEL_LABEL[change.level] ?? ""}`;
  return (
    <article className="ui-panel-subtle px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xl font-bold text-[var(--ink)]">{scaleName}</h3>
        <span className="text-base text-[var(--ink-muted)]">
          上次评估：{comparison.previousStartedAt.toLocaleDateString("zh-CN")}
        </span>
      </div>
      {delta !== null && (
        <p className="mt-2 text-lg font-bold text-[var(--ink)]">
          总分 {previousScore} → {currentScore}
          <span className="ml-2 text-base font-semibold text-[var(--ink-muted)]">
            {delta > 0 ? "▲ 升高" : delta < 0 ? "▼ 下降" : "— 持平"}
          </span>
        </p>
      )}
      {comparison.added.length === 0 && comparison.removed.length === 0 && comparison.kept.length === 0 ? (
        <p className="mt-2 text-base text-[var(--ink-muted)]">两次评估均未产生需要标注的结论。</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {comparison.added.map((change) => (
            <span key={`add-${change.code}`} className="ui-badge ui-badge-warning">
              新增 · {tagLabel(change)}
            </span>
          ))}
          {comparison.removed.map((change) => (
            <span key={`rm-${change.code}`} className="ui-badge">
              消失 · {tagLabel(change)}
            </span>
          ))}
          {comparison.kept.map((change) => (
            <span key={`keep-${change.code}`} className="ui-badge ui-badge-success">
              仍有 · {tagLabel(change)}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

function PatientReportTopbar() {
  return (
    <header className="patient-topbar border-b border-[var(--line)]">
      <div className="patient-brand">
        <span className="grid size-10 place-items-center rounded-xl bg-[var(--brand)] text-white shadow-[0_8px_16px_rgb(23_105_232_/_20%)]">
          <IconHeartHandshake size={24} stroke={1.8} aria-hidden="true" />
        </span>
        <span>
          <span className="block">精准照护工作台</span>
          <span className="mt-0.5 block text-xs font-semibold text-[var(--ink-faint)]">老年健康评估与干预系统</span>
        </span>
      </div>
      <span className="ui-badge hidden sm:inline-flex">
        <IconShieldCheck size={16} stroke={1.8} aria-hidden="true" />
        信息仅用于本次健康服务
      </span>
    </header>
  );
}

function TagsSection({
  tags,
  deferredScales,
}: {
  tags: readonly AssessmentTag[];
  deferredScales: readonly DeferredScale[];
}) {
  // 按量表分组；组内异常标签置顶；量表顺序按首个标签出现顺序
  const byScale = new Map<string, AssessmentTag[]>();
  for (const tag of tags) {
    const list = byScale.get(tag.scaleId) ?? [];
    list.push(tag);
    byScale.set(tag.scaleId, list);
  }
  const groups = [...byScale.entries()].map(([scaleId, scaleTags]) => {
    const ordered = [...scaleTags].sort((a, b) => {
      const aa = isAttentionTag(a) ? 0 : 1;
      const bb = isAttentionTag(b) ? 0 : 1;
      if (aa !== bb) return aa - bb;
      return a.tag.localeCompare(b.tag, "zh-CN");
    });
    return {
      scaleId,
      scaleName: scales.find((s) => s.id === scaleId)?.name ?? scaleId,
      tags: ordered,
      hasAbnormal: ordered.some(isAttentionTag),
    };
  });
  // 有异常的量表组置顶
  groups.sort((a, b) => Number(b.hasAbnormal) - Number(a.hasAbnormal));

  // 全豁免量表（计分项目全为医生检查题、deferClinical 下零标签）：没有标签组可展示，
  // 若按"没有发现问题"口径呈现属于误导，须如实说明这些量表本次暂无结论。
  const taggedScaleIds = new Set(tags.map((tag) => tag.scaleId));
  const silentDeferred = deferredScales.filter((d) => !taggedScaleIds.has(d.scaleId));
  const silentNote = silentDeferred.length > 0 && (
    <div className="ui-alert ui-alert-warning mt-6" role="note">
      <IconAlertTriangle size={21} stroke={2} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p>
        {silentDeferred.map((d) => `「${d.scaleName}」`).join("、")}
        的计分项目均需医护测量/查看后评定，本次暂无结论，不计入上面的「无异常」范围。
      </p>
    </div>
  );

  return (
    <section className="patient-panel px-6 py-7 md:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="ui-badge">
            <IconClipboardCheck size={16} stroke={1.8} aria-hidden="true" />
            评估结论
          </span>
          <h2 className="mt-3 text-2xl font-bold text-[var(--ink)]">评估结果</h2>
        </div>
        <p className="max-w-md text-sm leading-6 text-[var(--ink-muted)]">
          按量表分组展示，需要关注的结果会优先标出。
        </p>
      </div>

      {/* Demo 口径：医生检查题（舌象/测量等）暂未计分的量表如实标注，医生补录重评后结论可能更新 */}
      {deferredScales.length > 0 && (
        <div className="ui-alert ui-alert-warning mt-6" role="note">
          <IconAlertTriangle size={21} stroke={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            {deferredScales
              .map((d) => `「${d.scaleName}」有 ${d.questionIds.length} 道需医生查看的题暂未计分`)
              .join("；")}
            ，以上结果为部分计分，仅供参考；医生补录后结论可能更新。
          </p>
        </div>
      )}

      {tags.length === 0 ? (
        silentNote ? (
          silentNote
        ) : (
          <div className="ui-alert mt-6">
            <IconCheck size={21} stroke={2} aria-hidden="true" />
            <p>本次评估没有发现需要关注的问题，请继续保持良好的生活习惯。</p>
          </div>
        )
      ) : (
        <div className="mt-6 space-y-5">
          {groups.map((group) => (
            <div key={group.scaleId}>
              <p className="mb-2 text-sm font-extrabold tracking-wide text-[var(--ink-muted)]">
                {group.scaleName}
              </p>
              <div className="flex flex-wrap gap-3">
                {group.tags.map((tag) => {
                  const abnormal = isAttentionTag(tag);
                  return (
                    <span
                      key={`${tag.scaleId}-${tag.tag}-${tag.code}`}
                      className={[
                        "inline-flex min-h-12 items-center rounded-2xl border px-4 py-2 text-lg font-bold",
                        abnormal
                          ? "border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--warning)]"
                          : "border-[var(--line-strong)] bg-[var(--brand-soft)] text-[var(--brand-strong)]",
                      ].join(" ")}
                    >
                      {tag.tag}
                      {LEVEL_LABEL[tag.level] ?? ""}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
          {silentNote}
        </div>
      )}
    </section>
  );
}

function PlanSection({
  planStatus,
  plan,
  confirmedAt,
}: {
  planStatus: "draft" | "confirmed";
  plan: readonly PlanCandidateItemV2[];
  confirmedAt: Date | null;
}) {
  return (
    <section className="patient-panel px-6 py-7 md:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="ui-badge">
            <IconHeartHandshake size={16} stroke={1.8} aria-hidden="true" />
            干预建议
          </span>
          <h2 className="mt-3 text-2xl font-bold text-[var(--ink)]">个性化干预方案</h2>
        </div>
        {planStatus === "confirmed" ? (
          <span className="ui-badge ui-badge-success">
            <IconCheck size={16} stroke={2} aria-hidden="true" />
            <span>医生已确认</span>
            {confirmedAt && <span>· {confirmedAt.toLocaleDateString("zh-CN")}</span>}
          </span>
        ) : (
          <span className="ui-badge ui-badge-warning">
            <IconFileDescription size={16} stroke={1.8} aria-hidden="true" />
            初步方案 · 医生确认中
          </span>
        )}
      </div>

      {planStatus === "draft" && (
        <div className="ui-alert ui-alert-warning mt-6">
          <IconAlertTriangle size={22} stroke={1.8} aria-hidden="true" />
          <p>以下是根据评估结果生成的初步建议，医生会尽快为您核实并确认，请以医生最终确认的方案为准。</p>
        </div>
      )}

      {plan.length === 0 ? (
        <div className="ui-alert mt-6">
          <IconCheck size={21} stroke={2} aria-hidden="true" />
          <p>本次评估暂无需要执行的干预项目。</p>
        </div>
      ) : (
        <div className="mt-7 space-y-7">
          {CATEGORY_ORDER.map((category) => {
            const items = plan.filter((item) => item.categoryLabel === category);
            return (
              <div key={category} className="space-y-3">
                <h3 className="border-l-4 border-[var(--brand)] pl-3 text-lg font-bold text-[var(--brand-strong)]">
                  {category}
                </h3>
                {items.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-[var(--line-strong)] bg-[var(--brand-soft)] px-4 py-3 text-base text-[var(--ink-muted)]">
                    本类暂无匹配干预
                  </p>
                ) : (
                  items.map((item) => <PlanCard key={item.code} item={item} />)
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PlanCard({ item }: { item: PlanCandidateItemV2 }) {
  // 素材状态随候选快照落库（mediaAvailable），缺失如实标注"素材待补齐"；文本类正文即 content 全文
  // 100 分强制项（如 CAM 谵妄 → JZ01）醒目标注（Demo_v2 §5 + 03 表 100 语义）
  return (
    <article
      className={[
        "ui-panel-subtle px-5 py-5 md:px-6",
        item.forced ? "border-2 border-[var(--danger)] bg-[var(--danger-soft)]" : "",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xl font-bold text-[var(--ink)]">{item.name}</h3>
        <span className="inline-flex flex-wrap items-center gap-2">
          {item.forced && (
            <span className="ui-badge ui-badge-danger">
              <IconAlertTriangle size={14} stroke={2} aria-hidden="true" />
              强制优先推荐
            </span>
          )}
          <span className="ui-badge font-mono text-xs">{item.code}</span>
          <span className="ui-badge">匹配分 {item.total}</span>
        </span>
      </div>
      {item.forced && (
        <p className="mt-2 text-sm font-semibold leading-6 text-[var(--danger)]">
          此项为优先关注建议，请务必遵从医生安排。
        </p>
      )}
      <div className="mt-4">
        {item.mediaType === "text" ? (
          <InterventionText name={item.name} content={item.content} />
        ) : item.mediaType === "video" ? (
          <InterventionVideo src={item.mediaSrc ?? ""} available={item.mediaAvailable} text={item.content} />
        ) : (
          <InterventionImage src={item.mediaSrc ?? ""} available={item.mediaAvailable} name={item.name} sourceFile={null} />
        )}
      </div>
    </article>
  );
}
