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
 *         身份条、基本情况与概览、既存问题、四列结果使用清晰的适老字号；
 *         同一信息顺序的 A4「下载报告」在 ./report 子路由。
 *         评估概览使用本次量表与需关注结论的实际数量。
 *         2026-11-11 报告末尾加品牌页脚（logo + 岐颐智护 · 中文全称）；页眉不再重复品牌，因为紧邻的患者端顶栏已显示。
 *         2026-11-11 视觉精修：去掉自带的 72rem 宽度，与顶栏同一内容框（左右缘对齐品牌标与返回入口）；
 *         「与上次评估对比」「个性化干预方案」由卡片面板改为与其他分区同款的平铺分区（标题 + 细分割线），
 *         整页只有一种分区语言；对比卡片在宽屏两列等高排布。
 */
import Link from "next/link";
import { TriangleAlert, CalendarClock, Check, ClipboardCheck, Download } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { SectionDisclosure } from "@/components/section-disclosure";
import { BRAND } from "@/lib/brand";
import type { ReportField } from "@/lib/assessment/report-profile";
import { buildReportRows, listExistingProblems, type ReportRow } from "@/lib/assessment/report-rows";
import type { AssessmentTag } from "@/lib/assessment/report-types";
import type { PlanCandidateItemV2 } from "@/lib/recommend-v2";
import type { ScaleComparison, ScaleScope, TagChange } from "@/lib/assessment/supplementary";
import { scales, scoringCategories } from "@/lib/rules";
import { InterventionVideo, InterventionImage, InterventionText } from "@/components/intervention-media";
import { SectionHead } from "./section-head";
import { SupplementarySection } from "./supplementary-section";
import { ReportResultsTable } from "./report-results-table";
import { ReportOverview } from "./report-overview";

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
  const scaleIds = reportScales.map((scale) => scale.id);
  const rows = buildReportRows(scaleIds, tags, deferredScales);
  const problems = listExistingProblems(tags);

  return (
    <main className="patient-main care-report flex-1">
      <header className="care-report-header">
        <div className="care-report-title flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="hidden size-11 shrink-0 place-items-center rounded-xl bg-[var(--care-band)] text-primary sm:grid" aria-hidden="true">
              <ClipboardCheck className="size-6" />
            </span>
            <h1 className="text-2xl font-bold text-foreground sm:text-3xl">老年综合评估报告</h1>
          </div>
          <Button asChild className="min-h-11 gap-2 px-4">
            <Link href={`/patient/sessions/${sessionId}/report`}>
              <Download className="size-5" aria-hidden="true" />
              下载报告
            </Link>
          </Button>
        </div>
        {/* 身份条（参考图页头）：姓名已脱敏；V2.0 §3 要求的报告生成时间即「测试时间」项 */}
        {/* 各项按内容自适应宽度换行（编号、测试时间较长，等宽栅格会把它们折成两行） */}
        <dl className="care-report-identity">
          {identityItems.map((item) => (
            <div key={item.label} className="min-w-0">
              <dt className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                {item.label === "测试时间" && (
                  <CalendarClock size={17} strokeWidth={1.8} aria-hidden="true" />
                )}
                {item.label}
              </dt>
              <dd className="mt-0.5 break-words font-semibold text-foreground tabular-nums">{item.value}</dd>
            </div>
          ))}
        </dl>
      </header>

      <div className="care-report-overview">
        <BasicInfoSection rows={basicInfoRows} />
        <ReportOverview scaleCount={new Set(scaleIds).size} problemCount={problems.length} />
      </div>
      <ExistingProblemsSection problems={problems} />
      <ResultsSection rows={rows} deferredScales={deferredScales} />
      <SectionDisclosure title="本次评估项目" summary={`${reportScales.length} 项`}>
        <ul className="flex flex-wrap items-center gap-2" aria-label="本次评估内容">
          {reportScales.map((scale) => (
            <li
              key={scale.id}
              className="inline-flex flex-wrap items-center gap-2 rounded-xl bg-muted px-3 py-2 font-semibold"
            >
              {scale.name}
              <span className={`ui-badge ${scale.scope === "repeat" ? "ui-badge-warning" : "ui-badge-success"}`}>
                {scale.scope === "repeat" ? "复评" : "新增"}
              </span>
              {deferredScales.some((d) => d.scaleId === scale.id) && (
                <span className="ui-badge ui-badge-warning">部分计分</span>
              )}
            </li>
          ))}
        </ul>
      </SectionDisclosure>

      {error === "scales" && (
        <div className="ui-alert ui-alert-danger text-lg" role="alert">
          <TriangleAlert size={23} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>请至少勾选一项要补充评估的内容。</span>
        </div>
      )}
      {error === "repeat" && (
        <div className="ui-alert ui-alert-danger text-lg" role="alert">
          <TriangleAlert size={23} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>勾选的项目已经评估过了；如需重新评估，请医生在工作台为您发起。</span>
        </div>
      )}
      {error === "not_reported" && (
        <div className="ui-alert ui-alert-danger text-lg" role="alert">
          <TriangleAlert size={23} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>上次评估尚未出报告，暂不能发起补充评估，请稍后再试或请联系医生。</span>
        </div>
      )}

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
      <footer className="care-report-brand">
        <BrandLogo size={28} />
        <span>{BRAND.name} · {BRAND.fullNameZh}</span>
      </footer>
    </main>
  );
}

/** 基本情况（参考图左上区块）：档案里的病史/用药/照护信息，标签列浅底、内容列正文 */
function BasicInfoSection({ rows }: { rows: readonly ReportField[] }) {
  return (
    <section className="care-report-section">
      <h2>基本情况</h2>
      <dl className="care-report-facts">
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * 既存问题（参考图彩色标签区）：本次评估全部异常标签平铺成一行行胶囊，先让人一眼看到问题清单。
 * 没有异常标签时指向各项结论。全豁免的量表也可能没有异常标签。
 */
function ExistingProblemsSection({ problems }: { problems: readonly string[] }) {
  return (
    <section className="care-report-section">
      <h2>既存问题</h2>
      {problems.length === 0 ? (
        <p className="text-muted-foreground">本次评估未标出需重点关注的问题，各项结论见下表。</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {problems.map((problem) => (
            <li
              key={problem}
              className="inline-flex min-h-9 items-center gap-2 rounded-full bg-warning-soft px-3 py-1 font-semibold text-[#7e4800]"
            >
              <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />
              {problem}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 历史报告入口（V2.0 §3）：同患者历次已出报告的评估，按时间分别展示、可进入查看 */
function HistorySection({ historyReports }: { historyReports: HistoryReportEntry[] }) {
  return (
    <SectionDisclosure title="历史评估报告" summary={`${historyReports.length} 份`}>
      <ul className="space-y-3">
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
    </SectionDisclosure>
  );
}

/**
 * 随访对比（Demo_v2 步骤 2）：复评量表与同患者上次已出报告会话的对比——
 * 标签集合变化（新增/消失/保留）与总分升降。总分箭头只表方向不定好坏
 * （不同量表高分含义相反，如 FRAIL 高=差、MNA-SF 高=好），避免误导。
 */
function ComparisonSection({ comparisons }: { comparisons: readonly ScaleComparison[] }) {
  return (
    <section className="care-report-section">
      <SectionHead
        title="与上次评估对比"
        aside="复评项目与上次报告相比的标签与总分变化，箭头只表示变化方向。"
      />
      {/* 内容框加宽后两列排布、同行等高；奇数个时末项占满整行，避免右侧留空 */}
      <div className="grid gap-3 lg:grid-cols-2">
        {comparisons.map((comparison, index) => (
          <ComparisonCard
            key={comparison.scaleId}
            comparison={comparison}
            className={index === comparisons.length - 1 && comparisons.length % 2 === 1 ? "lg:col-span-2" : undefined}
          />
        ))}
      </div>
    </section>
  );
}

/** 单个复评量表的对比卡片 */
function ComparisonCard({ comparison, className }: { comparison: ScaleComparison; className?: string }) {
  const scaleName = scales.find((s) => s.id === comparison.scaleId)?.name ?? comparison.scaleId;
  const { previousScore, currentScore } = comparison;
  const delta = previousScore !== null && currentScore !== null ? currentScore - previousScore : null;
  const tagLabel = (change: TagChange) => `${change.tag}${LEVEL_LABEL[change.level] ?? ""}`;
  return (
    <article className={["ui-panel-subtle h-full px-5 py-4", className ?? ""].join(" ")}>
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

function ResultsSection({ rows, deferredScales }: {
  rows: readonly ReportRow[];
  deferredScales: readonly DeferredScale[];
}) {
  return (
    <section className="care-report-section">
      <h2>综合评估结果</h2>
      {deferredScales.length > 0 && (
        <div className="ui-alert ui-alert-warning mb-4" role="note">
          <TriangleAlert size={21} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            {deferredScales
              .map((d) => `「${d.scaleName}」有 ${d.questionIds.length} 道需医生查看的题暂未计分`)
              .join("；")}
            ，以上结果为部分计分，仅供参考；医生补录后结论可能更新。
          </p>
        </div>
      )}
      <div className="care-report-results overflow-x-auto rounded-xl focus-visible:outline-2 focus-visible:outline-ring"
        role="region" aria-label="评估结果" tabIndex={0}>
        <ReportResultsTable rows={rows} screen />
      </div>
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
    <section className="care-report-section">
      <SectionHead
        title="个性化干预方案"
        aside={
          // 2026-08-11 口径：患者端不再呈现"初步方案·医生确认中"中间态，仅在医生确认后标注
          planStatus === "confirmed" ? (
            <span className="ui-badge ui-badge-success">
              <Check size={16} strokeWidth={2} aria-hidden="true" />
              <span>医生已确认</span>
              {confirmedAt && <span>· {confirmedAt.toLocaleDateString("zh-CN")}</span>}
            </span>
          ) : undefined
        }
      />

      {plan.length === 0 ? (
        <div className="ui-alert">
          <Check size={21} strokeWidth={2} aria-hidden="true" />
          <p>本次评估暂无需要执行的干预项目。</p>
        </div>
      ) : (
        <div className="space-y-5">
          {CATEGORY_ORDER.map((category) => {
            const items = plan.filter((item) => item.categoryLabel === category);
            if (items.length === 0) return null;
            return (
              <div key={category} className="overflow-hidden rounded-2xl border border-border">
                <div className="flex items-center justify-between gap-3 border-b border-border bg-accent/45 px-4 py-2.5">
                  <h3 className="font-bold text-foreground">{category}</h3>
                  <span className="ui-badge">{items.length} 项</span>
                </div>
                <div className="grid gap-3 p-3 xl:grid-cols-2">
                  {items.map((item) => (
                    <PlanCard key={item.code} item={item} className={items.length === 1 ? "xl:col-span-2" : undefined} />
                  ))}
                </div>
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
              <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />
              强制优先推荐
            </span>
          )}
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
