/**
 * INPUT:  量表套餐定义、按一级分类分组的可评分量表树、上次已出报告会话信息、绑定的 createSession action
 * OUTPUT: 医生端「发起新评估」量表工具选择表单（客户端交互组件）
 * POS:    量表工具选择（docx §2）：预设套餐 / 自定义 / 随访复评 / 病历智能评估（M10.2）。
 *         提交字段口径见 parseSessionScaleSelection。
 */
"use client";

import { useState } from "react";
import { IconClipboardText, IconHistory, IconSparkles } from "@tabler/icons-react";
import type { ScalePackage } from "@/lib/assessment/scale-packages";

export interface ScaleGroup {
  category: string;
  scales: { id: string; name: string; questionCount: number }[];
}

export interface FollowupInfo {
  /** 上次已出报告会话的评估日期（YYYY-MM-DD） */
  dateLabel: string;
  scaleCount: number;
}

interface Props {
  packages: readonly ScalePackage[];
  groups: readonly ScaleGroup[];
  followup: FollowupInfo | null;
  action: (formData: FormData) => Promise<void>;
}

const CUSTOM_KEY = "custom";
const EMR_KEY = "emr";

export default function SessionCreateForm({ packages, groups, followup, action }: Props) {
  // 选择模式：套餐 key / "custom" / "emr" / "followup"
  const [mode, setMode] = useState<string>(packages[0]?.key ?? CUSTOM_KEY);
  const [emrText, setEmrText] = useState("");
  const [emrLoading, setEmrLoading] = useState(false);
  const [emrReason, setEmrReason] = useState<string | null>(null);
  const [emrSelected, setEmrSelected] = useState<Set<string>>(new Set());
  const [emrError, setEmrError] = useState<string | null>(null);

  const runEmrSuggest = async () => {
    setEmrLoading(true);
    setEmrError(null);
    setEmrReason(null);
    try {
      const res = await fetch("/api/doctor/emr-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emrText }),
      });
      const data = (await res.json()) as {
        scaleIds?: string[];
        reason?: string;
        error?: string;
      };
      if (!res.ok) {
        setEmrError(data.error ?? "推荐失败");
        return;
      }
      setEmrSelected(new Set(data.scaleIds ?? []));
      setEmrReason(data.reason ?? null);
    } catch {
      setEmrError("网络异常，请稍后重试");
    } finally {
      setEmrLoading(false);
    }
  };

  return (
    <form action={action} className="ui-panel overflow-hidden">
      <div className="ui-panel-heading">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-600">
            <IconClipboardText size={21} stroke={1.9} aria-hidden="true" />
          </span>
          <div>
            <h2 className="ui-panel-title">选择评估内容</h2>
            <p className="mt-1 text-xs text-[#62779a]">
              常规综合评估 · 病历智能评估 · 随访对比评估 · 自选组合评估
            </p>
          </div>
        </div>
        <span className="ui-badge">默认：常规综合评估</span>
      </div>
      <div className="ui-panel-body space-y-5">
        {followup && (
          <label className="ui-choice">
            <input
              type="radio"
              name="followup"
              value="1"
              checked={mode === "followup"}
              onChange={() => setMode("followup")}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 font-bold">
                <IconHistory size={16} stroke={2} aria-hidden="true" />
                随访对比评估
              </span>
              <span className="mt-0.5 block text-xs font-normal text-[#7f94b3]">
                复用 {followup.dateLabel} 上次已用 {followup.scaleCount} 个量表进行复评
              </span>
            </span>
          </label>
        )}

        {mode !== "followup" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {packages.map((pkg) => (
                <label key={pkg.key} className="ui-choice">
                  <input
                    type="radio"
                    name="package"
                    value={pkg.key}
                    checked={mode === pkg.key}
                    onChange={() => setMode(pkg.key)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold">{pkg.name}</span>
                    <span className="mt-0.5 block text-xs font-normal text-[#7f94b3]">{pkg.description}</span>
                    <span className="mt-0.5 block text-xs font-normal text-[#7f94b3]">
                      {pkg.scaleIds.length} 个量表
                    </span>
                  </span>
                </label>
              ))}
              <label className="ui-choice">
                <input
                  type="radio"
                  name="package"
                  value={CUSTOM_KEY}
                  checked={mode === CUSTOM_KEY}
                  onChange={() => setMode(CUSTOM_KEY)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">自选组合 · 临时自定义</span>
                  <span className="mt-0.5 block text-xs font-normal text-[#7f94b3]">
                    按躯体 / 精神心理 / 社会环境 / 老年综合征 / 中医 分类勾选
                  </span>
                </span>
              </label>
              <label className="ui-choice">
                {/* 不写 name=package：提交时由下方 hidden 转成 custom + scale.* */}
                <input
                  type="radio"
                  checked={mode === EMR_KEY}
                  onChange={() => setMode(EMR_KEY)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 font-bold">
                    <IconSparkles size={16} stroke={2} aria-hidden="true" />
                    病历智能评估
                  </span>
                  <span className="mt-0.5 block text-xs font-normal text-[#7f94b3]">
                    粘贴病历与诊断，系统推荐量表（LLM，出网前脱敏）
                  </span>
                </span>
              </label>
            </div>

            {mode === CUSTOM_KEY && (
              <div className="space-y-4 rounded-2xl border border-[#dbe7f6] p-4">
                {groups.map((group) => (
                  <div key={group.category}>
                    <p className="text-xs font-extrabold tracking-wide text-[#62779a]">{group.category}</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {group.scales.map((scale) => (
                        <label key={scale.id} className="ui-choice text-sm">
                          <input type="checkbox" name={`scale.${scale.id}`} />
                          <span className="min-w-0 flex-1">
                            <span className="block font-bold">{scale.name}</span>
                            <span className="mt-0.5 block text-xs font-normal text-[#7f94b3]">
                              {scale.questionCount} 题
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <p className="text-xs text-[#7f94b3]">仅列出已配置判定规则、可直接评分的量表；请至少勾选一项。</p>
              </div>
            )}

            {mode === EMR_KEY && (
              <div className="space-y-4 rounded-2xl border border-[#dbe7f6] p-4">
                {/* 提交时按自定义组合口径：package=custom + scale.* 勾选 */}
                <input type="hidden" name="package" value={CUSTOM_KEY} />
                <label className="block text-sm font-bold text-[#29496f]">
                  粘贴病历摘要
                  <textarea
                    value={emrText}
                    onChange={(e) => setEmrText(e.target.value)}
                    rows={6}
                    className="ui-input mt-2 w-full font-normal"
                    placeholder="粘贴现病史、既往史、诊断等（系统会在出网前脱敏证件号与手机号）"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="ui-button ui-button-secondary"
                    disabled={emrLoading || emrText.trim().length < 8}
                    onClick={() => void runEmrSuggest()}
                  >
                    <IconSparkles size={17} aria-hidden="true" />
                    {emrLoading ? "分析中…" : "智能推荐量表"}
                  </button>
                  {emrReason && <p className="text-xs text-[#62779a]">{emrReason}</p>}
                  {emrError && <p className="text-xs text-red-600">{emrError}</p>}
                </div>
                {emrSelected.size > 0 && (
                  <div className="space-y-3 border-t border-[#dbe7f6] pt-4">
                    <p className="text-xs font-extrabold text-[#62779a]">推荐结果（可再勾选调整）</p>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {groups.flatMap((g) =>
                        g.scales.map((scale) => (
                          <label key={scale.id} className="ui-choice text-sm">
                            <input
                              type="checkbox"
                              name={`scale.${scale.id}`}
                              checked={emrSelected.has(scale.id)}
                              onChange={(e) => {
                                setEmrSelected((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(scale.id);
                                  else next.delete(scale.id);
                                  return next;
                                });
                              }}
                            />
                            <span className="font-bold">{scale.name}</span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div className="flex justify-end">
          <button className="ui-button ui-button-primary ui-button-lg" type="submit">
            <IconClipboardText size={19} stroke={2.1} aria-hidden="true" />
            创建评估会话
          </button>
        </div>
      </div>
    </form>
  );
}
