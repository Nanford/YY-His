/**
 * INPUT:  评估标签快照（AssessmentResult）、候选/最终干预方案（InterventionPlan）
 * OUTPUT: PatientReport —— 患者端大屏的评估报告与干预方案展示（问答完成后立即可见）
 * POS:    产品口径（2026-07-14 已与用户确认）：评估内容是确定性计算，问答完成即生成报告，
 *         不需要医生先审核评估结果；干预方案候选医生仍会另行审核调整（保留 InterventionPlan
 *         的 draft→confirmed 流程与禁忌提示硬约束），本组件与医生端审核互不阻塞、并行展示。
 *         方案状态（初步 / 医生已确认）必须醒目区分，让患者知道自己看到的是哪个阶段的内容。
 */
import {
  IconAlertTriangle,
  IconCheck,
  IconClipboardCheck,
  IconFileDescription,
  IconHeartHandshake,
  IconShieldCheck,
} from "@tabler/icons-react";
import type { AssessmentTag } from "@/lib/scoring";
import type { RecommendedIntervention } from "@/lib/recommend";
import { extractCautions } from "@/lib/recommend/cautions";
import { interventionCategories } from "@/lib/rules";

const LEVEL_LABEL: Record<string, string> = {
  是: "",
  倾向是: "（倾向）",
  基本是: "（基本符合）",
};

interface PatientReportProps {
  patientLabel: string;
  scaleNames: string[];
  tags: readonly AssessmentTag[];
  planStatus: "draft" | "confirmed";
  plan: readonly RecommendedIntervention[];
  confirmedAt: Date | null;
}

export function PatientReport({
  patientLabel,
  scaleNames,
  tags,
  planStatus,
  plan,
  confirmedAt,
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
          <p className="patient-display-copy">
            {patientLabel} · {scaleNames.join("、")}
          </p>
        </header>

        <TagsSection tags={tags} />
        <PlanSection planStatus={planStatus} plan={plan} confirmedAt={confirmedAt} />

        <p className="mx-auto max-w-2xl pb-4 text-center text-base leading-7 text-[var(--ink-muted)]">
          如果您对报告内容有任何疑问，请随时与医生沟通。
        </p>
      </div>
    </main>
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

function TagsSection({ tags }: { tags: readonly AssessmentTag[] }) {
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
          结果根据本次问询中的标准答案计算生成，供健康管理与医生沟通参考。
        </p>
      </div>

      {tags.length === 0 ? (
        <div className="ui-alert mt-6">
          <IconCheck size={21} stroke={2} aria-hidden="true" />
          <p>本次评估没有发现需要关注的问题，请继续保持良好的生活习惯。</p>
        </div>
      ) : (
        <div className="mt-6 flex flex-wrap gap-3">
          {tags.map((tag) => (
            <span
              key={`${tag.scaleId}-${tag.tag}`}
              className="inline-flex min-h-12 items-center rounded-2xl border border-[var(--line-strong)] bg-[var(--brand-soft)] px-4 py-2 text-lg font-bold text-[var(--brand-strong)]"
            >
              {tag.tag}
              {LEVEL_LABEL[tag.level] ?? ""}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function categoryOrder(items: readonly RecommendedIntervention[]): string[] {
  const extras = items.map((item) => item.category).filter((category) => !interventionCategories.includes(category));
  return [...interventionCategories, ...new Set(extras)];
}

function PlanSection({
  planStatus,
  plan,
  confirmedAt,
}: {
  planStatus: "draft" | "confirmed";
  plan: readonly RecommendedIntervention[];
  confirmedAt: Date | null;
}) {
  return (
    <section className="patient-panel px-6 py-7 md:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="ui-badge">
            <IconHeartHandshake size={16} stroke={1.8} aria-hidden="true" />
            个体化建议
          </span>
          <h2 className="mt-3 text-2xl font-bold text-[var(--ink)]">推荐干预方案</h2>
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
          {categoryOrder(plan).map((category) => {
            const items = plan.filter((item) => item.category === category);
            if (items.length === 0) return null;
            return (
              <div key={category} className="space-y-3">
                <h3 className="border-l-4 border-[var(--brand)] pl-3 text-lg font-bold text-[var(--brand-strong)]">
                  {category}
                </h3>
                {items.map((item) => (
                  <PlanCard key={item.tag} item={item} />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PlanCard({ item }: { item: RecommendedIntervention }) {
  const cautions = extractCautions(item.plan);
  return (
    <article className="ui-panel-subtle px-5 py-5 md:px-6">
      <h3 className="text-xl font-bold text-[var(--ink)]">{item.tag}</h3>
      <p className="mt-3 whitespace-pre-wrap text-base leading-7 text-[var(--ink-muted)]">{item.plan}</p>
      {cautions.length > 0 && (
        <div className="ui-alert ui-alert-danger mt-5">
          <IconAlertTriangle size={22} stroke={1.8} aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-bold">用前请注意</p>
            <div className="mt-1 space-y-1">
              {cautions.map((caution) => (
                <p key={caution} className="leading-6">
                  {caution}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
