/**
 * INPUT:  评估标签快照（AssessmentResult）、候选/最终干预方案（InterventionPlan）
 * OUTPUT: PatientReport —— 患者端大屏的评估报告与干预方案展示（问答完成后立即可见）
 * POS:    产品口径（2026-07-14 已与用户确认）：评估内容是确定性计算，问答完成即生成报告，
 *         不需要医生先审核评估结果；干预方案候选医生仍会另行审核调整（保留 InterventionPlan
 *         的 draft→confirmed 流程与禁忌提示硬约束），本组件与医生端审核互不阻塞、并行展示。
 *         方案状态（初步 / 医生已确认）必须醒目区分，让患者知道自己看到的是哪个阶段的内容。
 */
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
    <div className="flex-1 flex flex-col items-center px-4 py-8 gap-8">
      <header className="w-full max-w-4xl text-center space-y-1">
        <p className="text-slate-400 text-lg">{patientLabel} · {scaleNames.join("、")}</p>
        <h1 className="text-3xl md:text-4xl font-bold text-white">您的评估报告</h1>
      </header>

      <TagsSection tags={tags} />
      <PlanSection planStatus={planStatus} plan={plan} confirmedAt={confirmedAt} />

      <p className="text-slate-500 text-base text-center max-w-2xl leading-relaxed">
        如果您对报告内容有任何疑问，请随时与医生沟通。
      </p>
    </div>
  );
}

function TagsSection({ tags }: { tags: readonly AssessmentTag[] }) {
  return (
    <section className="w-full max-w-4xl rounded-2xl bg-slate-800/70 border border-slate-700 px-6 py-6">
      <h2 className="text-xl font-semibold text-white mb-4">评估结果</h2>
      {tags.length === 0 ? (
        <p className="text-slate-300 text-lg">本次评估没有发现需要关注的问题，请继续保持良好的生活习惯。</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {tags.map((tag) => (
            <span
              key={`${tag.scaleId}-${tag.tag}`}
              className="rounded-xl bg-sky-500/15 border border-sky-400/40 text-sky-100 text-lg px-4 py-2"
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
    <section className="w-full max-w-4xl rounded-2xl bg-slate-800/70 border border-slate-700 px-6 py-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-white">推荐干预方案</h2>
        {planStatus === "confirmed" ? (
          <span className="rounded-full bg-emerald-500/20 border border-emerald-400/50 text-emerald-200 text-sm px-3 py-1">
            ✓ 医生已确认{confirmedAt ? ` · ${confirmedAt.toLocaleDateString("zh-CN")}` : ""}
          </span>
        ) : (
          <span className="rounded-full bg-amber-500/20 border border-amber-400/50 text-amber-200 text-sm px-3 py-1">
            初步方案 · 医生确认中
          </span>
        )}
      </div>

      {planStatus === "draft" && (
        <p className="text-amber-200/90 text-base leading-relaxed">
          以下是根据评估结果生成的初步建议，医生会尽快为您核实并确认，请以医生最终确认的方案为准。
        </p>
      )}

      {plan.length === 0 ? (
        <p className="text-slate-300 text-lg">本次评估暂无需要执行的干预项目。</p>
      ) : (
        <div className="space-y-6">
          {categoryOrder(plan).map((category) => {
            const items = plan.filter((item) => item.category === category);
            if (items.length === 0) return null;
            return (
              <div key={category} className="space-y-3">
                <h3 className="text-sky-300 text-lg font-medium">{category}</h3>
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
    <article className="rounded-xl bg-slate-900/60 border border-slate-700 px-5 py-4 space-y-3">
      <h4 className="text-white text-lg font-semibold">{item.tag}</h4>
      <p className="text-slate-300 text-base leading-7 whitespace-pre-wrap">{item.plan}</p>
      {cautions.length > 0 && (
        <div className="rounded-lg bg-red-500/15 border border-red-400/40 px-4 py-3 space-y-1">
          <p className="text-red-200 text-sm font-semibold">用前请注意</p>
          {cautions.map((caution) => (
            <p key={caution} className="text-red-100/90 text-sm leading-6">
              · {caution}
            </p>
          ))}
        </div>
      )}
    </article>
  );
}
