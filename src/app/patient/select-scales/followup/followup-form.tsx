/**
 * INPUT:  上次评估摘要（标签/干预）、建议复评项目（重点复评 + 按需补充）、各量表作答题目数
 * OUTPUT: 患者端「随访对比评估」表单（客户端交互组件）
 * POS:    2026-08-08 设计图·随访对比评估：重点复评默认全选上次量表，按需补充默认不选；
 *         底部统计条实时对比"上次项目/预计时间 → 本次复评/预计时间"；提交 name="scaleIds"。
 */
"use client";

import { useMemo, useState } from "react";
import { CircleAlert } from "lucide-react";
import { AssessmentBulkActions, AssessmentSubmitBar, ScaleDetailsToggle, ScaleGroup, ScaleOption, updateAssessmentSelection } from "@/components/assessment-selection";
import { minutesFromAskable } from "@/lib/assessment/patient-scale-packages";

export interface FollowupScaleItem {
  id: string;
  label: string;
  subtitle: string;
}

interface Props {
  /** 上次已出报告会话的量表（重点复评，默认全选） */
  focusScales: readonly FollowupScaleItem[];
  /** 按需补充（上次未做过的量表，默认不选） */
  extraScales: readonly FollowupScaleItem[];
  /** 各量表"正式问题"条目数（预计时长增量复算用） */
  askableCounts: Record<string, number>;
  /** 上次项目数与预计分钟数（统计条左侧） */
  previousCount: number;
  previousMinutes: number;
  error: string | null;
  action: (formData: FormData) => Promise<void>;
}

export default function FollowupForm({
  focusScales,
  extraScales,
  askableCounts,
  previousCount,
  previousMinutes,
  error,
  action,
}: Props) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set(focusScales.map((s) => s.id)));
  const [showDetails, setShowDetails] = useState(false);

  const toggle = (ids: readonly string[], on: boolean) =>
    setChecked((prev) => updateAssessmentSelection(prev, ids, on));

  const currentMinutes = useMemo(() => {
    let askable = 0;
    for (const id of checked) askable += askableCounts[id] ?? 0;
    return minutesFromAskable(askable);
  }, [checked, askableCounts]);

  const renderCheck = (scale: FollowupScaleItem) => (
    <ScaleOption key={scale.id} title={scale.label} description={scale.subtitle}
      name="scaleIds" value={scale.id} checked={checked.has(scale.id)} showDetails={showDetails}
      onChange={(e) => toggle([scale.id], e.target.checked)} />
  );
  const focusIds = focusScales.map((scale) => scale.id);
  const extraIds = extraScales.map((scale) => scale.id);

  return (
    <form action={action} className="space-y-7">
      <input type="hidden" name="mode" value="followup" />
      {error === "scales" && (
        <div className="ui-alert ui-alert-danger text-base sm:text-lg" role="alert">
          <CircleAlert size={23} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>请至少保留一项复评内容。</span>
        </div>
      )}

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-[var(--care-ink)]">本次复评</h2>
          <div className="assessment-toolbar-actions">
            <AssessmentBulkActions ids={[...focusIds, ...extraIds]} selected={checked} onChange={toggle} />
            <ScaleDetailsToggle checked={showDetails} onChange={(e) => setShowDetails(e.target.checked)} />
          </div>
        </div>
        <ScaleGroup title="建议复评" count={focusScales.length}>
          {focusScales.map(renderCheck)}
        </ScaleGroup>
        {extraScales.length > 0 && (
          <ScaleGroup title="按需补充" count={extraScales.length}>
            {extraScales.map(renderCheck)}
          </ScaleGroup>
        )}
      </section>

      <AssessmentSubmitBar count={checked.size} label="确认并进入复评"
        supporting={`· 本次约 ${currentMinutes} 分钟 · 上次 ${previousCount} 项，约 ${previousMinutes} 分钟`} />
    </form>
  );
}
