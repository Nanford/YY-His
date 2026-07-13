/**
 * INPUT:  评估结果快照（AssessmentTag[]，含得分明细）
 * OUTPUT: 评估标签卡片 + 可展开的得分明细（标签下钻追溯）
 * POS:    需求文档"第三步"可追溯性要求：点击标签可查看量表评分与题目回答。
 */
import { scaleById } from "@/lib/rules";
import type { AssessmentTag } from "@/lib/scoring";

const LEVEL_CLS: Record<string, string> = {
  是: "bg-green-50 text-green-700 border-green-200",
  倾向是: "bg-amber-50 text-amber-700 border-amber-200",
  基本是: "bg-amber-50 text-amber-700 border-amber-200",
};

export function ResultView({ tags }: { tags: AssessmentTag[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
      <h2 className="font-semibold">评估标签（{tags.length}）</h2>
      <div className="grid sm:grid-cols-2 gap-3">
        {tags.map((tag) => (
          <details key={`${tag.scaleId}-${tag.tag}`} className="rounded-lg border border-slate-200 open:shadow-sm">
            <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer list-none">
              <span className="font-medium">{tag.tag}</span>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${LEVEL_CLS[tag.level] ?? ""}`}>
                {tag.level}
              </span>
              <span className="ml-auto text-xs text-slate-400">
                {scaleById.get(tag.scaleId)?.name ?? tag.scaleId} · {tag.score} 分 · 点击展开明细
              </span>
            </summary>
            <div className="border-t border-slate-100 px-4 py-3">
              <table className="w-full text-xs">
                <thead className="text-slate-400 text-left">
                  <tr>
                    <th className="py-1 font-medium">题号</th>
                    <th className="py-1 font-medium">题目</th>
                    <th className="py-1 font-medium text-right">原始分</th>
                    <th className="py-1 font-medium text-right">有效分</th>
                  </tr>
                </thead>
                <tbody>
                  {tag.detail.map((d) => (
                    <tr key={d.questionId} className="border-t border-slate-50">
                      <td className="py-1.5 text-slate-500">{d.no}</td>
                      <td className="py-1.5">
                        {d.title}
                        {d.reversed && <span className="ml-1 rounded bg-purple-50 text-purple-600 px-1">反向计分</span>}
                      </td>
                      <td className="py-1.5 text-right">{d.rawScore}</td>
                      <td className="py-1.5 text-right font-medium">{d.effectiveScore}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
