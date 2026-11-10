/**
 * INPUT:  评估标签快照（AssessmentResult）、候选/最终干预方案（InterventionPlan）、
 *         评估范围标识与历史报告/补充评估派生信息（V2.0 §3）、复评量表随访对比（Demo_v2 步骤 2）
 * OUTPUT: PatientReport —— 患者端大屏的评估报告与干预方案展示（问答完成后立即可见）
 * POS:    产品口径（2026-07-14 已与用户确认）：评估内容是确定性计算，问答完成即生成报告，
 *         不需要医生先审核评估结果；干预方案候选医生仍会另行审核调整（保留 InterventionPlan
 *         的 draft→confirmed 流程与禁忌提示硬约束），本组件与医生端审核互不阻塞、并行展示。
 *         2026-08-11 用户拍板：问答完成即出报告与方案，患者端不再呈现等待医生确认的中间态
 *         （医生端 draft→confirmed 审核流程保留）。
 *         V2.0 §3：报告必须可识别评估范围（新增/复评量表）与生成时间，保留历史报告入口，
 *         并可对尚未完成的量表直接发起补充评估（复评属医生授权，不在患者自助入口出现）。
 *         2026-11-10 版式改版（用户拍板，参考「报告输出的样式.png」）：本组件是大屏「预览报告」——
 *         身份条（编号/脱敏姓名/性别/年龄/身高/体重/测试时间）+ 基本情况 + 既存问题，字号保持
 *         适老化大字；与参考图同版式的 A4「下载报告」在 ./report 子路由（页头「下载报告」按钮进入）。
 *         「综合评分」「吸烟饮酒史」本版不做（无计分规则/档案无字段）；X-Age 为第三方品牌，不得使用。
 */
import Link from "next/link";
import {
  IconAlertTriangle,
  IconCalendarClock,
  IconCheck,
  IconClipboardCheck,
  IconDownload,
  IconHeartHandshake,
  IconHistory,
  IconUserHeart,
} from "@tabler/icons-react";
import type { ReportField } from "@/lib/assessment/report-profile";
import type { AssessmentTag } from "@/lib/assessment/report-types";
import type { PlanCandidateItemV2 } from "@/lib/recommend-v2";
import type { ScaleComparison, ScaleScope, TagChange } from "@/lib/assessment/supplementary";
// 异常标签判定（M11.2 异常置顶 / 既存问题）：按 02 表标签编码显式分级，不再用标签名关键词猜测
import { isAbnormalTag } from "@/lib/assessment/tag-severity";
import { scales, scoringCategories } from "@/lib/rules";
import { InterventionVideo, InterventionImage, InterventionText } from "@/components/intervention-media";
import { SectionHead } from "./section-head";
import { SupplementarySection } from "./supplementary-section";

/** 5 大类固定展示顺序：运动干预 → 膳食营养 → 中医食养 → 就诊建议 → 其他（来源：积分数据 categories 顺序） */
const CATEGORY_ORDER = scoringCategories.map((c) => c.label);

const LEVEL_LABEL: Record<string, string> = {
  是: "",
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
  /** 身份条：编号/脱敏姓名/性别/年龄/身高/体重/测试时间（服务端由 report-profile 派生，含报告生成时间） */
  identityItems: readonly ReportField[];
  /** 基本情况：病史记录/用药评估/家庭照护者 */
  basicInfoRows: readonly ReportField[];
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
  identityItems,
  basicInfoRows,
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
  const hasError = error === "scales" || error === "repeat" || error === "not_reported";

  return (
    <main className="patient-shell flex-1">

      <div className="patient-main space-y-6">
        <header className="patient-panel px-6 py-7 md:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* 患者布局顶栏已含品牌与返回入口，报告页不再叠第二条顶栏；页头不使用第三方品牌字样 */}
            <h1 className="text-3xl font-bold text-[var(--ink)]">老年综合评估报告</h1>
            {/* 下载版报告（A4 版式，含综合评估结果表）：进入后可另存为 PDF */}
            <Link href={`/patient/sessions/${sessionId}/report`} className="ui-button ui-button-primary">
              <IconDownload size={20} stroke={2} aria-hidden="true" />
              下载报告
            </Link>
          </div>
          {/* 身份条（参考图页头）：姓名已脱敏；V2.0 §3 要求的报告生成时间即「测试时间」项 */}
          {/* 各项按内容自适应宽度换行（编号、测试时间较长，等宽栅格会把它们折成两行） */}
          <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-4 border-y border-[var(--line)] py-5">
            {identityItems.map((item) => (
              <div key={item.label} className="min-w-0">
                <dt className="flex items-center gap-1.5 text-sm font-bold text-[var(--ink-muted)]">
                  {item.label === "测试时间" && (
                    <IconCalendarClock size={17} stroke={1.8} aria-hidden="true" />
                  )}
                  {item.label}
                </dt>
                <dd className="mt-1 break-words text-lg font-bold text-[var(--ink)]">{item.value}</dd>
              </div>
            ))}
          </dl>
          {/* V2.0 §3：报告必须可识别评估范围（新增/复评） */}
          <ul className="mt-5 flex flex-wrap items-center gap-2" aria-label="本次评估内容">
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

        <BasicInfoSection rows={basicInfoRows} />
        <ExistingProblemsSection tags={tags} />
        <TagsSection tags={tags} deferredScales={deferredScales} />
        {comparisons.length > 0 && <ComparisonSection comparisons={comparisons} />}
        <PlanSection planStatus={planStatus} plan={plan} confirmedAt={confirmedAt} />

        {remainingScales.length > 0 && (
          <SupplementarySection
            sessionId={sessionId}
            remainingScales={remainingScales}
            defaultOpen={hasError}
          />
        )}
        {historyReports.length > 0 && <HistorySection historyReports={historyReports} />}

        <p className="mx-auto max-w-2xl pb-4 text-center text-base leading-7 text-[var(--ink-muted)]">
          如果您对报告内容有任何疑问，请随时与医生沟通。
        </p>
      </div>
    </main>
  );
}

/** 基本情况（参考图左上区块）：档案里的病史/用药/照护信息，标签列浅底、内容列正文 */
function BasicInfoSection({ rows }: { rows: readonly ReportField[] }) {
  return (
    <section className="patient-panel px-6 py-7 md:px-8">
      <SectionHead
        icon={<IconUserHeart size={16} stroke={1.8} aria-hidden="true" />}
        eyebrow="档案信息"
        title="基本情况"
      />
      <dl className="mt-6 overflow-hidden rounded-2xl border border-[var(--line)]">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-1 border-b border-[var(--line)] last:border-b-0 sm:grid-cols-[10rem_1fr]"
          >
            <dt className="bg-[var(--surface-blue)] px-5 py-4 text-base font-bold text-[var(--ink)]">
              {row.label}
            </dt>
            <dd className="break-words px-5 py-4 text-lg leading-8 text-[var(--ink)]">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * 既存问题（参考图彩色标签区）：本次评估全部异常标签平铺成一行行胶囊，先让人一眼看到问题清单。
 * 无异常标签时整块不渲染——是否"没有问题"由下方评估结果区按全豁免量表口径如实说明，
 * 这里不做"无异常"断言（避免零证据误导）。
 */
function ExistingProblemsSection({ tags }: { tags: readonly AssessmentTag[] }) {
  const problems = tags.filter(isAbnormalTag);
  if (problems.length === 0) return null;
  return (
    <section className="patient-panel px-6 py-7 md:px-8">
      <SectionHead
        icon={<IconAlertTriangle size={16} stroke={1.8} aria-hidden="true" />}
        eyebrow="重点关注"
        title="既存问题"
      />
      <ul className="mt-6 flex flex-wrap gap-3">
        {problems.map((tag, index) => (
          <li
            key={`${tag.scaleId}-${tag.code}`}
            className={[
              "inline-flex min-h-12 items-center gap-2 rounded-full px-5 py-2 text-lg font-bold text-[var(--ink)]",
              // 参考图蓝/黄交替的浅色胶囊，仅作视觉区分，不表达严重程度
              index % 2 === 0 ? "bg-[var(--brand-soft)]" : "bg-[var(--warning-soft)]",
            ].join(" ")}
          >
            <span
              className={[
                "size-2.5 shrink-0 rounded-full",
                index % 2 === 0 ? "bg-[var(--brand)]" : "bg-[var(--warning)]",
              ].join(" ")}
              aria-hidden="true"
            />
            {tag.tag}
            {LEVEL_LABEL[tag.level] ?? ""}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 历史报告入口（V2.0 §3）：同患者历次已出报告的评估，按时间分别展示、可进入查看 */
function HistorySection({ historyReports }: { historyReports: HistoryReportEntry[] }) {
  return (
    <section className="patient-panel px-6 py-7 md:px-8">
      <SectionHead
        icon={<IconHistory size={16} stroke={1.8} aria-hidden="true" />}
        eyebrow="历史记录"
        title="历史评估报告"
        aside="同一患者的历次评估报告，点卡片可回看。"
      />
      <ul className="mt-6 space-y-4">
        {historyReports.map((report) => (
          <li key={report.id}>
            {/* 历史条目与对比卡片同为 px-5 py-4 的行内节奏，左文右入口对齐 */}
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
      <SectionHead
        icon={<IconHistory size={16} stroke={1.8} aria-hidden="true" />}
        eyebrow="随访对比"
        title="与上次评估对比"
        aside="复评项目与上次报告相比的标签与总分变化，箭头只表示变化方向。"
      />
      <div className="mt-6 space-y-4">
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
      const aa = isAbnormalTag(a) ? 0 : 1;
      const bb = isAbnormalTag(b) ? 0 : 1;
      if (aa !== bb) return aa - bb;
      return a.tag.localeCompare(b.tag, "zh-CN");
    });
    return {
      scaleId,
      scaleName: scales.find((s) => s.id === scaleId)?.name ?? scaleId,
      tags: ordered,
      hasAbnormal: ordered.some(isAbnormalTag),
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
      <SectionHead
        icon={<IconClipboardCheck size={16} stroke={1.8} aria-hidden="true" />}
        eyebrow="评估结论"
        title="评估结果"
        aside="按量表分组展示，需要关注的结果会优先标出。"
      />

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
        <div className="mt-6 space-y-6">
          {groups.map((group) => (
            <div key={group.scaleId}>
              {/* 组头与 chips 节奏统一：组间距 24px、组头距 chips 12px，chips 保持 min-h-12 大胶囊 */}
              <p className="mb-3 text-sm font-extrabold tracking-wide text-[var(--ink-muted)]">
                {group.scaleName}
              </p>
              <div className="flex flex-wrap gap-3">
                {group.tags.map((tag) => {
                  const abnormal = isAbnormalTag(tag);
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
      <SectionHead
        icon={<IconHeartHandshake size={16} stroke={1.8} aria-hidden="true" />}
        eyebrow="干预建议"
        title="个性化干预方案"
        aside={
          // 2026-08-11 口径：患者端不再呈现"初步方案·医生确认中"中间态，仅在医生确认后标注
          planStatus === "confirmed" ? (
            <span className="ui-badge ui-badge-success">
              <IconCheck size={16} stroke={2} aria-hidden="true" />
              <span>医生已确认</span>
              {confirmedAt && <span>· {confirmedAt.toLocaleDateString("zh-CN")}</span>}
            </span>
          ) : undefined
        }
      />

      {plan.length === 0 ? (
        <div className="ui-alert mt-6">
          <IconCheck size={21} stroke={2} aria-hidden="true" />
          <p>本次评估暂无需要执行的干预项目。</p>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {CATEGORY_ORDER.map((category) => {
            const items = plan.filter((item) => item.categoryLabel === category);
            return (
              <div key={category}>
                <h3 className="border-l-4 border-[var(--brand)] pl-3 text-lg font-bold text-[var(--brand-strong)]">
                  {category}
                </h3>
                {items.length === 0 ? (
                  <p className="mt-3 rounded-xl border border-dashed border-[var(--line-strong)] bg-[var(--brand-soft)] px-4 py-3 text-base text-[var(--ink-muted)]">
                    本类暂无匹配干预
                  </p>
                ) : (
                  // 宽容器下两列等高排布（卡片 h-full 拉齐行高）；单项独占整行，
                  // 媒体仍完整展示（视频卡内播、图片全宽、文本全文），DOM 顺序不变故 forced 红框仍置顶
                  <div className="mt-3 grid grid-cols-1 gap-4 xl:grid-cols-2">
                    {items.map((item) => (
                      <PlanCard
                        key={item.code}
                        item={item}
                        className={items.length === 1 ? "xl:col-span-2" : undefined}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PlanCard({ item, className }: { item: PlanCandidateItemV2; className?: string }) {
  // 素材状态随候选快照落库（mediaAvailable），缺失如实标注"素材待补齐"；文本类正文即 content 全文
  // 100 分强制项（如 CAM 谵妄 → JZ01）醒目标注（Demo_v2 §5 + 03 表 100 语义）
  return (
    <article
      className={[
        "ui-panel-subtle h-full px-5 py-5 md:px-6",
        item.forced ? "border-2 border-[var(--danger)] bg-[var(--danger-soft)]" : "",
        className ?? "",
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
