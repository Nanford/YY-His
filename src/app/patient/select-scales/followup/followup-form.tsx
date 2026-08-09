/**
 * INPUT:  上次评估摘要（标签/干预）、建议复评项目（重点复评 + 按需补充）、各量表作答题目数
 * OUTPUT: 患者端「随访对比评估」表单（客户端交互组件）
 * POS:    2026-08-08 设计图·随访对比评估：重点复评默认全选上次量表，按需补充默认不选；
 *         底部统计条实时对比"上次项目/预计时间 → 本次复评/预计时间"；提交 name="scaleIds"。
 */
"use client";

import { useMemo, useState } from "react";
import {
  IconAlertCircle,
  IconArrowRight,
  IconBulb,
  IconHistory,
} from "@tabler/icons-react";
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

  const toggle = (scaleId: string, on: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(scaleId);
      else next.delete(scaleId);
      return next;
    });
  };

  const currentMinutes = useMemo(() => {
    let askable = 0;
    for (const id of checked) askable += askableCounts[id] ?? 0;
    return minutesFromAskable(askable);
  }, [checked, askableCounts]);

  const renderCheck = (scale: FollowupScaleItem) => (
    <label key={scale.id} className="patient-check">
      <input
        type="checkbox"
        name="scaleIds"
        value={scale.id}
        checked={checked.has(scale.id)}
        onChange={(e) => toggle(scale.id, e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-lg font-extrabold leading-tight text-[#173766]">{scale.label}</span>
        <span className="mt-0.5 block text-sm leading-6 text-[#62779a]">{scale.subtitle}</span>
      </span>
    </label>
  );

  return (
    <form action={action} className="space-y-7">
      <input type="hidden" name="mode" value="followup" />
      {error === "scales" && (
        <div className="ui-alert ui-alert-danger text-base sm:text-lg" role="alert">
          <IconAlertCircle size={23} stroke={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>请至少保留一项复评内容。</span>
        </div>
      )}

      <section className="space-y-4 rounded-2xl border border-blue-100 bg-white p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-lg font-extrabold text-[#173766]">
          <IconHistory size={22} stroke={1.9} className="text-blue-600" aria-hidden="true" />
          本次建议复评项目
        </h2>
        <div>
          <p className="text-sm font-extrabold tracking-wide text-[#62779a]">重点复评（建议复评）</p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">{focusScales.map(renderCheck)}</div>
        </div>
        {extraScales.length > 0 && (
          <div>
            <p className="text-sm font-extrabold tracking-wide text-[#62779a]">按需补充（可按需选择）</p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">{extraScales.map(renderCheck)}</div>
          </div>
        )}
        <p className="flex items-start gap-2 rounded-2xl border border-blue-100 bg-[#f8fbff] px-4 py-3 text-sm leading-7 text-[#405a81]">
          <IconBulb size={19} stroke={2} className="mt-1 shrink-0 text-blue-600" aria-hidden="true" />
          <span>
            <span className="font-extrabold">系统建议：</span>
            以上次存在异常或需要观察变化的项目为主，减少重复采集。
          </span>
        </p>
      </section>

      {/* 底部统计条：上次 → 本次（实时随勾选变化） */}
      <div className="grid grid-cols-2 gap-4 rounded-2xl border border-blue-100 bg-[#f8fbff] px-6 py-5 text-center sm:grid-cols-2">
        <p className="text-base text-[#62779a]">
          上次项目 <span className="text-2xl font-extrabold text-[#173766]">{previousCount}</span> 项
          <span className="mx-2 text-[#8ba0bd]">→</span>
          本次复评 <span className="text-2xl font-extrabold text-blue-700">{checked.size}</span> 项
        </p>
        <p className="text-base text-[#62779a]">
          预计时间 <span className="text-2xl font-extrabold text-[#173766]">{previousMinutes}</span> 分钟
          <span className="mx-2 text-[#8ba0bd]">→</span>
          <span className="text-2xl font-extrabold text-blue-700">{currentMinutes}</span> 分钟
        </p>
      </div>

      <div className="space-y-3">
        <button type="submit" className="patient-primary-action w-full" disabled={checked.size === 0}>
          确认并进入复评（{checked.size} 项）
          <IconArrowRight size={25} stroke={2.1} aria-hidden="true" />
        </button>
        <p className="text-center text-sm leading-6 text-[#62779a]">提交后将直接进入健康问询。</p>
      </div>
    </form>
  );
}
