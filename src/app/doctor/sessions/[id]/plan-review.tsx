/**
 * INPUT:  候选/最终干预方案（RecommendedIntervention[]）、审核模式
 * OUTPUT: 三大类分组的干预方案卡片；审核模式下带保留勾选与确认提交
 * POS:    需求文档"第四步"医生审核环节：删除不适合的方案、保留适合的方案、确认后形成最终方案。
 *         方案必须展示执行全文；自带禁忌提示以警示样式醒目展示。
 */
import { interventionCategories } from "@/lib/rules";
import { extractCautions } from "@/lib/recommend/cautions";
import type { RecommendedIntervention } from "@/lib/recommend";
import { confirmPlan, reopenSession } from "@/lib/actions/doctor";

const CATEGORY_ICON: Record<string, string> = {
  运动干预: "🏃",
  膳食补充: "🥗",
  中医食养: "🌿",
};

function InterventionCard({ item, reviewing }: { item: RecommendedIntervention; reviewing: boolean }) {
  const cautions = extractCautions(item.plan);
  return (
    <div className="rounded-lg border border-slate-200 p-4 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {reviewing && (
          <input type="checkbox" name={`keep.${item.tag}`} defaultChecked className="accent-blue-600 size-4" />
        )}
        <span className="font-medium">{item.tag}</span>
        <span className="text-xs text-slate-400">触发来源：</span>
        {item.triggeredBy.map((s) => (
          <span
            key={`${s.tag}-${s.level}`}
            className={`rounded-full border px-2 py-0.5 text-xs ${
              s.level === "是"
                ? "bg-slate-50 text-slate-600 border-slate-200"
                : "bg-amber-50 text-amber-700 border-amber-200"
            }`}
          >
            {s.tag}
            {s.level !== "是" && `（${s.level}）`}
          </span>
        ))}
      </div>
      <p className="text-sm text-slate-600 leading-relaxed">{item.plan}</p>
      {cautions.length > 0 && (
        <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 space-y-1">
          {cautions.map((c) => (
            <p key={c} className="text-xs text-red-700">
              ⚠️ {c}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function GroupedList({ items, reviewing }: { items: RecommendedIntervention[]; reviewing: boolean }) {
  return (
    <div className="space-y-5">
      {interventionCategories.map((category) => {
        const group = items.filter((i) => i.category === category);
        if (group.length === 0) return null;
        return (
          <div key={category} className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-500">
              {CATEGORY_ICON[category] ?? "•"} {category}（{group.length}）
            </h3>
            {group.map((item) => (
              <InterventionCard key={item.tag} item={item} reviewing={reviewing} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** 审核模式：勾选保留 → 确认；另提供"返回修改答案"回到采集状态 */
export function PlanReview({ sessionId, candidates }: { sessionId: string; candidates: RecommendedIntervention[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">候选干预方案审核（{candidates.length} 项）</h2>
        <p className="text-xs text-slate-400">取消勾选即从最终方案中删除</p>
      </div>
      <form action={confirmPlan.bind(null, sessionId)} className="space-y-5">
        <GroupedList items={candidates} reviewing />
        <div className="flex justify-end">
          <button className="rounded-lg bg-green-600 text-white px-6 py-2 text-sm font-medium hover:bg-green-700">
            确认最终干预方案 ✓
          </button>
        </div>
      </form>
      <form action={reopenSession.bind(null, sessionId)} className="border-t border-slate-100 pt-3 flex justify-start">
        <button className="text-sm text-slate-500 hover:text-blue-600">← 返回修改答案（作废本次评估结果）</button>
      </form>
    </section>
  );
}

/** 已确认的最终方案（只读），并注明医生删除了哪些候选项 */
export function FinalPlan({
  finalPlan,
  removedTags,
  confirmedAt,
}: {
  finalPlan: RecommendedIntervention[];
  removedTags: string[];
  confirmedAt: Date | null;
}) {
  return (
    <section className="rounded-xl border border-green-200 bg-white p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold text-green-700">✓ 最终干预方案（医生已确认）</h2>
        <span className="text-xs text-slate-400">
          确认时间：{confirmedAt ? confirmedAt.toLocaleString("zh-CN") : "—"}
          {removedTags.length > 0 && ` · 已删除候选：${removedTags.join("、")}`}
        </span>
      </div>
      <GroupedList items={finalPlan} reviewing={false} />
    </section>
  );
}
