/**
 * INPUT:  候选/最终干预方案、医生审核决定、会话标识
 * OUTPUT: 可编辑的候选方案审核表单与只读最终方案
 * POS:    医生端干预方案审核组件；完整展示执行方案、禁忌提示及删改留痕。
 */
import { confirmPlan, reopenSession } from "@/lib/actions/doctor";
import type { PlanDecision as ReviewPlanDecision } from "@/lib/assessment/plan-review";
import type { RecommendedIntervention } from "@/lib/recommend";
import { extractCautions } from "@/lib/recommend/cautions";
import { interventionCategories } from "@/lib/rules";

const CATEGORY_META: Record<string, { index: string; heading: string; border: string }> = {
  运动干预: {
    index: "01",
    heading: "text-blue-800",
    border: "border-l-blue-500",
  },
  膳食补充: {
    index: "02",
    heading: "text-emerald-800",
    border: "border-l-emerald-500",
  },
  中医食养: {
    index: "03",
    heading: "text-amber-800",
    border: "border-l-amber-500",
  },
};

/** 对外复用纯逻辑层的审核决定类型，避免页面与服务端契约漂移。 */
export type PlanDecision = ReviewPlanDecision;

interface InterventionCardProps {
  item: RecommendedIntervention;
  reviewing: boolean;
  decision?: PlanDecision;
}

/** 审核态提交全文和备注，由服务端对比原文后判定 keep / remove / adjust。 */
function InterventionCard({ item, reviewing, decision }: InterventionCardProps) {
  const cautions = extractCautions(item.plan);
  const categoryMeta = CATEGORY_META[item.category];

  return (
    <article
      className={`rounded-xl border border-slate-200 border-l-4 bg-white p-4 shadow-sm ${
        categoryMeta?.border ?? "border-l-slate-400"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold text-slate-900">{item.tag}</h4>
            {decision?.action === "adjust" && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                已调整
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <span>评估触发：</span>
            {item.triggeredBy.length > 0 ? (
              item.triggeredBy.map((source) => (
                <span
                  key={`${source.tag}-${source.level}`}
                  className={`rounded-full border px-2 py-0.5 ${
                    source.level === "是"
                      ? "border-slate-200 bg-slate-50 text-slate-600"
                      : "border-amber-200 bg-amber-50 text-amber-700"
                  }`}
                >
                  {source.tag}
                  {source.level !== "是" && `（${source.level}）`}
                </span>
              ))
            ) : (
              <span className="text-slate-400">规则映射</span>
            )}
          </div>
        </div>

        {reviewing && (
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800 transition-colors hover:bg-blue-100">
            <input
              type="checkbox"
              name={`keep.${item.tag}`}
              defaultChecked
              className="size-4 accent-blue-600"
            />
            纳入最终方案
          </label>
        )}
      </div>

      <div className="mt-4 space-y-3">
        {reviewing ? (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-600">执行方案全文</span>
            <textarea
              name={`plan.${item.tag}`}
              defaultValue={item.plan}
              aria-label={`${item.tag}执行方案全文`}
              className="min-h-32 w-full resize-y rounded-lg border border-slate-300 bg-slate-50/60 px-3 py-2.5 text-sm leading-6 text-slate-700 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
            />
          </label>
        ) : (
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-500">执行方案全文</p>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.plan}</p>
          </div>
        )}

        {reviewing && (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-600">审核备注</span>
            <input
              type="text"
              name={`note.${item.tag}`}
              placeholder="可填写调整依据或删除原因（选填）"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>
        )}

        {!reviewing && decision?.note && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
            审核备注：{decision.note}
          </p>
        )}

        {cautions.length > 0 && (
          <aside className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5" aria-label={`${item.tag}禁忌提示`}>
            <p className="mb-1 text-xs font-semibold text-red-800">用前核对</p>
            {cautions.map((caution) => (
              <p key={caution} className="text-xs leading-5 text-red-700">
                · {caution}
              </p>
            ))}
          </aside>
        )}
      </div>
    </article>
  );
}

function categoryOrder(items: readonly RecommendedIntervention[]): string[] {
  const extras = items.map((item) => item.category).filter((category) => !interventionCategories.includes(category));
  return [...interventionCategories, ...new Set(extras)];
}

function GroupedList({
  items,
  reviewing,
  decisions = [],
}: {
  items: readonly RecommendedIntervention[];
  reviewing: boolean;
  decisions?: readonly PlanDecision[];
}) {
  const decisionsByTag = new Map(decisions.map((decision) => [decision.tag, decision]));

  return (
    <div className="space-y-6">
      {categoryOrder(items).map((category) => {
        const group = items.filter((item) => item.category === category);
        if (group.length === 0) return null;
        const meta = CATEGORY_META[category];

        return (
          <section key={category} className="space-y-2.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs tracking-widest text-slate-400">{meta?.index ?? "--"}</span>
              <h3 className={`text-sm font-semibold ${meta?.heading ?? "text-slate-700"}`}>{category}</h3>
              <span className="text-xs text-slate-400">{group.length} 项</span>
              <span className="h-px flex-1 bg-slate-100" />
            </div>
            <div className="space-y-3">
              {group.map((item) => (
                <InterventionCard
                  key={item.tag}
                  item={item}
                  reviewing={reviewing}
                  decision={decisionsByTag.get(item.tag)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function EmptyPlan({ final }: { final: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-8 text-center">
      <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full border border-slate-200 bg-white text-lg text-slate-500">
        ✓
      </div>
      <p className="font-medium text-slate-700">{final ? "本次评估无最终干预项目" : "暂无候选干预方案"}</p>
      <p className="mx-auto mt-1 max-w-xl text-sm leading-6 text-slate-500">
        {final
          ? "评估结果未形成需执行的干预项目，或候选项目经医生审核后均未纳入；审核记录已保留。"
          : "当前评估标签未映射出候选干预项目。医生确认后，本次评估将以“无需新增干预”完成归档。"}
      </p>
    </div>
  );
}

/** 候选方案审核：允许保留、删除、改写全文并记录审核备注。 */
export function PlanReview({
  sessionId,
  candidates,
}: {
  sessionId: string;
  candidates: readonly RecommendedIntervention[];
}) {
  const hasCandidates = candidates.length > 0;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50/70 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-wider text-slate-500">INTERVENTION REVIEW</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">候选干预方案审核</h2>
          </div>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
            {candidates.length} 项候选
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          {hasCandidates
            ? "逐项核对执行方案与禁忌提示；取消勾选将删除该项，修改正文将记为调整。"
            : "当前没有候选项目，仍需由医生完成确认并形成审核记录。"}
        </p>
      </div>

      <form action={confirmPlan.bind(null, sessionId)} className="space-y-6 p-6">
        {hasCandidates ? <GroupedList items={candidates} reviewing /> : <EmptyPlan final={false} />}
        <div className="flex justify-end border-t border-slate-100 pt-5">
          <button
            type="submit"
            className="rounded-lg bg-emerald-700 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
          >
            {hasCandidates ? "确认最终干预方案" : "确认暂无候选方案"}
          </button>
        </div>
      </form>

      <form action={reopenSession.bind(null, sessionId)} className="border-t border-slate-100 bg-slate-50/40 px-6 py-3">
        <button type="submit" className="text-sm text-slate-500 transition hover:text-blue-700">
          ← 返回修改答案（本次评估结果将重新生成）
        </button>
      </form>
    </section>
  );
}

/** 已确认方案：允许空方案，并集中展示删除与调整决定。 */
export function FinalPlan({
  finalPlan,
  decisions,
  confirmedAt,
}: {
  finalPlan: readonly RecommendedIntervention[];
  decisions: readonly PlanDecision[];
  confirmedAt: Date | null;
}) {
  const removed = decisions.filter((decision) => decision.action === "remove");
  const adjusted = decisions.filter((decision) => decision.action === "adjust");
  const changed = [...adjusted, ...removed];

  return (
    <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
      <div className="border-b border-emerald-100 bg-emerald-50/70 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-wider text-emerald-700">CONFIRMED PLAN</p>
            <h2 className="mt-1 text-lg font-semibold text-emerald-950">最终干预方案</h2>
          </div>
          <div className="text-right text-xs leading-5 text-emerald-800">
            <p className="font-medium">医生已确认</p>
            <p>{confirmedAt ? confirmedAt.toLocaleString("zh-CN") : "确认时间未记录"}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-emerald-800">
            最终保留 {finalPlan.length} 项
          </span>
          <span className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-amber-800">
            调整 {adjusted.length} 项
          </span>
          <span className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-red-700">
            删除 {removed.length} 项
          </span>
        </div>
      </div>

      <div className="space-y-6 p-6">
        {finalPlan.length > 0 ? (
          <GroupedList items={finalPlan} reviewing={false} decisions={decisions} />
        ) : (
          <EmptyPlan final />
        )}

        {changed.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-4" aria-label="方案审核记录">
            <h3 className="text-sm font-semibold text-slate-800">方案审核记录</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {changed.map((decision) => (
                <div key={`${decision.action}-${decision.tag}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        decision.action === "adjust"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-red-50 text-red-700"
                      }`}
                    >
                      {decision.action === "adjust" ? "已调整" : "已删除"}
                    </span>
                    <span className="text-sm font-medium text-slate-800">{decision.tag}</span>
                  </div>
                  {decision.note && <p className="mt-1.5 text-xs leading-5 text-slate-500">{decision.note}</p>}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
