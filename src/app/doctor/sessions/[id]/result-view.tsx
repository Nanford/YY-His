/**
 * INPUT:  评估标签快照、题目标准答案文本索引
 * OUTPUT: 评估标签摘要与可展开的逐题确定性评分明细
 * POS:    评估结果下钻组件；标签可追溯到标准答案、原始分和有效分。
 */
import type { AssessmentTag } from "@/lib/scoring";
import { scaleById } from "@/lib/rules";

const LEVEL_CLS: Record<string, string> = {
  是: "border-emerald-200 bg-emerald-50 text-emerald-700",
  倾向是: "border-amber-200 bg-amber-50 text-amber-700",
  基本是: "border-amber-200 bg-amber-50 text-amber-700",
};

export interface ResultViewProps {
  tags: readonly AssessmentTag[];
  /** 题目 id → 医生确认后的标准选项文本。 */
  answerLabels?: Readonly<Record<string, string>>;
}

export function ResultView({ tags, answerLabels = {} }: ResultViewProps) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-6 py-5">
        <div>
          <p className="text-xs font-medium tracking-wider text-slate-500">DETERMINISTIC ASSESSMENT</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">评估标签</h2>
          <p className="mt-1 text-sm text-slate-500">标签由量表规则确定性计算，可展开核对每道题的计分依据。</p>
        </div>
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
          {tags.length} 个标签
        </span>
      </div>

      <div className="p-6">
        {tags.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-8 text-center">
            <p className="font-medium text-slate-700">当前没有触发评估标签</p>
            <p className="mt-1 text-sm leading-6 text-slate-500">评估结果已生成，未形成需要展示的标签结论。</p>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {tags.map((tag) => {
              const scaleName = scaleById.get(tag.scaleId)?.name ?? tag.scaleId;

              return (
                <details
                  key={`${tag.scaleId}-${tag.tag}`}
                  className="group overflow-hidden rounded-xl border border-slate-200 bg-white open:shadow-md"
                >
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3.5 transition hover:bg-slate-50">
                    <span className="font-semibold text-slate-900">{tag.tag}</span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                        LEVEL_CLS[tag.level] ?? "border-slate-200 bg-slate-50 text-slate-600"
                      }`}
                    >
                      {tag.level}
                    </span>
                    <span className="ml-auto text-right text-xs leading-5 text-slate-500">
                      {scaleName} · {tag.score} 分
                      <span className="ml-2 text-blue-700 group-open:hidden">展开明细 ＋</span>
                      <span className="ml-2 hidden text-blue-700 group-open:inline">收起明细 −</span>
                    </span>
                  </summary>

                  <div className="border-t border-slate-100 bg-slate-50/30 px-4 py-3">
                    <div className="overflow-x-auto">
                      <table className="min-w-[680px] w-full text-xs">
                        <thead className="text-left text-slate-500">
                          <tr>
                            <th scope="col" className="py-2 pr-3 font-medium">题号</th>
                            <th scope="col" className="py-2 pr-3 font-medium">题目</th>
                            <th scope="col" className="py-2 pr-3 font-medium">标准答案</th>
                            <th scope="col" className="py-2 pr-3 text-right font-medium">原始分</th>
                            <th scope="col" className="py-2 text-right font-medium">有效分</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tag.detail.length > 0 ? (
                            tag.detail.map((detail) => (
                              <tr key={detail.questionId} className="border-t border-slate-100 align-top">
                                <td className="py-2.5 pr-3 font-mono text-slate-500">{detail.no}</td>
                                <td className="py-2.5 pr-3 leading-5 text-slate-700">
                                  {detail.title}
                                  {detail.reversed && (
                                    <span className="ml-1.5 whitespace-nowrap rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">
                                      反向计分
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 pr-3 font-medium text-slate-800">
                                  {answerLabels[detail.questionId] || "—"}
                                </td>
                                <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">{detail.rawScore}</td>
                                <td className="py-2.5 text-right font-semibold tabular-nums text-slate-900">
                                  {detail.effectiveScore}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={5} className="border-t border-slate-100 py-6 text-center text-slate-400">
                                暂无逐题得分明细
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
