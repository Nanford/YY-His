/**
 * INPUT:  评估标签快照、题目标准答案文本索引
 * OUTPUT: 评估标签摘要与可展开的逐题确定性评分明细
 * POS:    评估结果下钻组件（M11.2 对齐患者报告：按量表分组 + 异常标签置顶）
 */
import { IconChevronDown, IconClipboardData } from "@tabler/icons-react";
import { isAttentionTag, type AssessmentTag, type TagLevel } from "@/lib/assessment/report-types";
import { scaleById } from "@/lib/rules";

const LEVEL_CLS: Record<TagLevel, string> = {
  是: "ui-badge ui-badge-success",
  否: "ui-badge",
  倾向是: "ui-badge ui-badge-warning",
  基本是: "ui-badge ui-badge-warning",
};

export interface ResultViewProps {
  tags: readonly AssessmentTag[];
  /** 题目 id → 医生确认后的标准选项文本。 */
  answerLabels?: Readonly<Record<string, string>>;
}

export function ResultView({ tags, answerLabels = {} }: ResultViewProps) {
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
      scaleName: scaleById.get(scaleId)?.name ?? scaleId,
      tags: ordered,
      hasAbnormal: ordered.some(isAttentionTag),
    };
  });
  groups.sort((a, b) => Number(b.hasAbnormal) - Number(a.hasAbnormal));

  return (
    <section className="ui-panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#dbe7f6] bg-[#f8fbff] px-6 py-5">
        <div>
          <p className="page-eyebrow">评估结果</p>
          <h2 className="mt-1 inline-flex items-center gap-2 text-lg font-extrabold text-[#173766]">
            <IconClipboardData size={21} className="text-blue-600" aria-hidden="true" />
            评估标签
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#6b82a4]">
            按量表分组展示，可展开查看每道题的计分依据。
          </p>
        </div>
        <span className="ui-badge">{tags.length} 个标签</span>
      </div>

      <div className="p-6">
        {tags.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#bcd4f5] bg-[#f8fbff] px-6 py-8 text-center">
            <p className="font-extrabold text-[#2b4a75]">当前没有触发评估标签</p>
            <p className="mt-2 text-sm leading-6 text-[#6b82a4]">评估结果已生成，未形成需要展示的标签结论。</p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <div key={group.scaleId}>
                <p className="mb-2 text-xs font-extrabold tracking-wide text-[#62779a]">
                  {group.scaleName}
                  {group.hasAbnormal && (
                    <span className="ml-2 ui-badge ui-badge-warning">含需关注项</span>
                  )}
                </p>
                <div className="grid gap-3 lg:grid-cols-2">
                  {group.tags.map((tag) => {
                    const abnormal = isAttentionTag(tag);
                    return (
                      <details
                        key={`${tag.scaleId}-${tag.code}`}
                        className={[
                          "group overflow-hidden rounded-2xl border bg-white transition open:shadow-[0_12px_24px_rgba(33,87,160,0.08)]",
                          abnormal ? "border-amber-200" : "border-[#dbe7f6]",
                        ].join(" ")}
                      >
                        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-4 transition hover:bg-[#f8fbff]">
                          <span className="font-extrabold text-[#29496f]">{tag.tag}</span>
                          <span className={LEVEL_CLS[tag.level] ?? "ui-badge"}>{tag.level}</span>
                          {abnormal && <span className="ui-badge ui-badge-warning">关注</span>}
                          <span className="ml-auto inline-flex items-center gap-2 text-right text-xs leading-5 text-[#6b82a4]">
                            {tag.score} 分
                            <IconChevronDown
                              size={16}
                              className="text-blue-600 transition group-open:rotate-180"
                              aria-hidden="true"
                            />
                          </span>
                        </summary>

                        <div className="border-t border-[#dbe7f6] bg-[#f8fbff] px-4 py-3">
                          <div className="overflow-x-auto">
                            <table className="min-w-[680px] w-full text-xs">
                              <thead className="text-left text-[#637da4]">
                                <tr>
                                  <th scope="col" className="py-2 pr-3 font-bold">
                                    题号
                                  </th>
                                  <th scope="col" className="py-2 pr-3 font-bold">
                                    题目
                                  </th>
                                  <th scope="col" className="py-2 pr-3 font-bold">
                                    标准答案
                                  </th>
                                  <th scope="col" className="py-2 pr-3 text-right font-bold">
                                    原始分
                                  </th>
                                  <th scope="col" className="py-2 text-right font-bold">
                                    有效分
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {tag.detail.length > 0 ? (
                                  tag.detail.map((detail) => (
                                    <tr
                                      key={detail.questionId}
                                      className="border-t border-[#dbe7f6] align-top"
                                    >
                                      <td className="py-3 pr-3 font-mono text-[#6b82a4]">
                                        {detail.no}
                                      </td>
                                      <td className="py-3 pr-3 leading-5 text-[#3f5c83]">
                                        {detail.title}
                                        {detail.reversed && (
                                          <span className="ui-badge ml-1.5 whitespace-nowrap">
                                            反向计分
                                          </span>
                                        )}
                                      </td>
                                      <td className="py-3 pr-3 font-bold text-[#29496f]">
                                        {answerLabels[detail.questionId] || "—"}
                                      </td>
                                      <td className="py-3 pr-3 text-right tabular-nums text-[#5b7398]">
                                        {detail.rawScore}
                                      </td>
                                      <td className="py-3 text-right font-extrabold tabular-nums text-[#173766]">
                                        {detail.effectiveScore}
                                      </td>
                                    </tr>
                                  ))
                                ) : (
                                  <tr>
                                    <td
                                      colSpan={5}
                                      className="border-t border-[#dbe7f6] py-6 text-center text-[#7890b1]"
                                    >
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
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
