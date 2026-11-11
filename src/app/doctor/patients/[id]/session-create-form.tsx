/**
 * INPUT:  量表套餐定义、按一级分类分组的可评分量表树、上次已出报告会话信息、绑定的 createSession action
 * OUTPUT: 医生端「发起新评估」量表工具选择表单（客户端交互组件）
 * POS:    量表工具选择（docx §2）：预设套餐 / 自定义 / 随访复评 / 病历智能评估（M10.2）。
 *         提交字段口径见 parseSessionScaleSelection。
 *         2026-11-11 视觉精修：评估方式卡片共奇数个时末项占满整行。
 */
"use client";

import { useState } from "react";
import { ClipboardList, History, Sparkles } from "lucide-react";
import { AssessmentBulkActions, ScaleDetailsToggle, ScaleGroup as ScaleGroupCard, ScaleOption, updateAssessmentSelection } from "@/components/assessment-selection";
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
  /** 当前患者 id：病历智能评估时上送，供服务端取档案姓名做脱敏（不出网） */
  patientId: string;
  action: (formData: FormData) => Promise<void>;
}

const CUSTOM_KEY = "custom";
const EMR_KEY = "emr";

export default function SessionCreateForm({ packages, groups, followup, patientId, action }: Props) {
  // 选择模式：套餐 key / "custom" / "emr" / "followup"
  const [mode, setMode] = useState<string>(packages[0]?.key ?? CUSTOM_KEY);
  const [showDetails, setShowDetails] = useState(false);
  const [customSelected, setCustomSelected] = useState<ReadonlySet<string>>(new Set());
  const [emrText, setEmrText] = useState("");
  const [emrLoading, setEmrLoading] = useState(false);
  const [emrReason, setEmrReason] = useState<string | null>(null);
  const [emrSelected, setEmrSelected] = useState<ReadonlySet<string> | null>(null);
  const [emrError, setEmrError] = useState<string | null>(null);
  const allScales = groups.flatMap((group) => group.scales);
  const allIds = allScales.map((scale) => scale.id);
  const toggleCustom = (ids: readonly string[], on: boolean) =>
    setCustomSelected((prev) => updateAssessmentSelection(prev, ids, on));
  const toggleEmr = (ids: readonly string[], on: boolean) =>
    setEmrSelected((prev) => prev && updateAssessmentSelection(prev, ids, on));

  const runEmrSuggest = async () => {
    setEmrLoading(true);
    setEmrError(null);
    setEmrReason(null);
    try {
      const res = await fetch("/api/doctor/emr-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emrText, patientId }),
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
    <form action={action} className="ui-panel">
      <div className="ui-panel-heading flex-wrap rounded-t-[inherit] bg-accent/45">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-600">
            <ClipboardList size={21} strokeWidth={1.9} aria-hidden="true" />
          </span>
          <div>
            <h2 className="ui-panel-title">选择评估内容</h2>
          </div>
        </div>
        <ScaleDetailsToggle checked={showDetails} onChange={(e) => setShowDetails(e.target.checked)} />
      </div>
      <div className="ui-panel-body space-y-5">
        {followup && (
          <div className="flex flex-wrap items-center gap-2">
          <label className="ui-choice min-w-0 flex-1">
            <input
              type="radio"
              name="followup"
              value="1"
              checked={mode === "followup"}
              onChange={() => setMode("followup")}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 font-bold">
                <History size={16} strokeWidth={2} aria-hidden="true" />
                随访对比评估
              </span>
              <span className="mt-0.5 block text-xs font-normal text-[#7f94b3]">
                复用 {followup.dateLabel} 上次已用 {followup.scaleCount} 个量表进行复评
              </span>
            </span>
          </label>
          {mode === "followup" && (
            <button type="button" className="ui-button ui-button-quiet" onClick={() => setMode(packages[0]?.key ?? CUSTOM_KEY)}>
              更换评估方式
            </button>
          )}
          </div>
        )}

        {mode !== "followup" && (
          <>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {packages.map((pkg) => (
                <label key={pkg.key} className="ui-choice min-h-16">
                  <input
                    type="radio"
                    name="package"
                    value={pkg.key}
                    checked={mode === pkg.key}
                    onChange={() => setMode(pkg.key)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold">{pkg.name}</span>
                    {showDetails && <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{pkg.description}</span>}
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
                  {showDetails && <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    按躯体 / 精神心理 / 社会环境 / 老年综合征 / 中医 分类勾选
                  </span>}
                </span>
              </label>
              {/* 套餐 + 自选 + 病历共奇数项时，末项占满整行，与上方整行的「随访对比评估」呼应、右侧不留空 */}
              <label className={["ui-choice", (packages.length + 2) % 2 === 1 ? "sm:col-span-2" : ""].join(" ")}>
                {/* 不写 name=package：提交时由下方 hidden 转成 custom + scale.* */}
                <input
                  type="radio"
                  checked={mode === EMR_KEY}
                  onChange={() => setMode(EMR_KEY)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 font-bold">
                    <Sparkles size={16} strokeWidth={2} aria-hidden="true" />
                    病历智能评估
                  </span>
                  {showDetails && <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    根据脱敏后的病历摘要推荐量表
                  </span>}
                </span>
              </label>
            </div>

            {mode === CUSTOM_KEY && (
              <div className="space-y-3">
                <AssessmentBulkActions ids={allIds} selected={customSelected} onChange={toggleCustom} />
                {groups.map((group) => (
                  <ScaleGroupCard key={group.category} title={group.category} count={group.scales.length}>
                    {group.scales.map((scale) => (
                      <ScaleOption key={scale.id} scaleId={scale.id} name={`scale.${scale.id}`}
                        title={scale.name} description={`${scale.questionCount} 题`} showDetails={showDetails}
                        checked={customSelected.has(scale.id)} onChange={(e) => toggleCustom([scale.id], e.target.checked)} />
                    ))}
                  </ScaleGroupCard>
                ))}
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
                    className="ui-textarea mt-2 w-full font-normal"
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
                    <Sparkles size={17} aria-hidden="true" />
                    {emrLoading ? "分析中…" : "智能推荐量表"}
                  </button>
                  {emrReason && <p className="text-xs text-[#62779a]">{emrReason}</p>}
                  {emrError && <p className="text-xs text-red-600">{emrError}</p>}
                </div>
                {emrSelected !== null && (
                  <div className="space-y-3 border-t border-[#dbe7f6] pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-foreground">已选 {emrSelected.size} 项</p>
                      <AssessmentBulkActions ids={allIds} selected={emrSelected} onChange={toggleEmr} />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {allScales.map((scale) => (
                        <ScaleOption key={scale.id} scaleId={scale.id} name={`scale.${scale.id}`}
                          title={scale.name} description={`${scale.questionCount} 题`} showDetails={showDetails}
                          checked={emrSelected.has(scale.id)} onChange={(e) => toggleEmr([scale.id], e.target.checked)} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div className="sticky bottom-3 z-10 flex justify-end rounded-xl border border-border bg-card p-2.5 shadow-lg shadow-blue-950/10">
          <button className="ui-button ui-button-primary ui-button-lg" type="submit"
            disabled={(mode === CUSTOM_KEY && customSelected.size === 0)
              || (mode === EMR_KEY && (emrLoading || !emrSelected?.size))}>
            <ClipboardList size={19} strokeWidth={2.1} aria-hidden="true" />
            创建评估会话
          </button>
        </div>
      </div>
    </form>
  );
}
