/**
 * INPUT:  量表/套餐选项与勾选状态（由页面表单组件持有）；样式见 src/app/ios-design.css
 * OUTPUT: iOS 风格的选择类组件：单选列表（对勾）、分组列表、开关行、全选按钮、已选数量与开始按钮
 * POS:    2026-11-11 UI 改版样板（目前仅「常规综合评估」页使用）；只负责呈现，
 *         提交仍靠原生表单控件（radio / checkbox 的 name、value 原样随表单提交）。
 *         配色为蓝白单色系（图标统一品牌蓝，不按量表上色）。
 *         与旧版 assessment-selection.tsx 并存，样板确认后再迁移其余三个方式页。
 */
"use client";

import type { ChangeEventHandler, ReactNode } from "react";
import {
  Activity, Apple, Bandage, Brain, BrainCircuit, Check, ClipboardList, Ear, Eye, Footprints, Hand,
  HeartPulse, House, Moon, Pill, ShoppingBasket, Smile, Soup, Users, Wind, Zap, type LucideIcon,
} from "lucide-react";

/** 量表图标只作识别辅助，颜色统一由样式层决定 */
const SCALE_ICONS: Record<string, LucideIcon> = {
  frail: HeartPulse,
  mnasf: Soup,
  nrs2002: Apple,
  fall_3q: Footprints,
  morse: Footprints,
  motor_screen: Activity,
  ais: Moon,
  sleep_1q: Moon,
  minicog: Brain,
  mmse: BrainCircuit,
  cam: BrainCircuit,
  depression_2q: Smile,
  anxiety_2q: Wind,
  adl: Hand,
  iadl: ShoppingBasket,
  vision: Eye,
  hearing: Ear,
  lubben: Users,
  home_env: House,
  braden: Bandage,
  polypharmacy: Pill,
  pain_1q: Zap,
};

/** 一级标题行（「评估套餐」「本次评估项目」），右侧可放全选按钮。 */
export function IosPrimaryHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="ios-section-header ios-section-header-primary">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

/** iOS 原生单选列表：选中行右侧出现对勾，标题变蓝。 */
export function IosChoiceList({ name, legend, options, value, onChange }: {
  name: string;
  legend: string;
  options: readonly { value: string; title: string; meta: string; badge?: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="sr-only">{legend}</legend>
      <div className="ios-list">
        {options.map((option) => (
          <label key={option.value} className="ios-row ios-choice">
            <input type="radio" name={name} value={option.value} checked={option.value === value}
              onChange={() => onChange(option.value)} />
            <span className="min-w-0">
              <span className="ios-row-title">
                {option.title}
                {option.badge && <span className="ios-choice-badge">{option.badge}</span>}
              </span>
              <span className="ios-row-subtitle">{option.meta}</span>
            </span>
            <Check className="ios-choice-check" strokeWidth={2.6} aria-hidden="true" />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** 圆角分组列表：组标题 + 计数在列表上方，aria-label 供读屏与 E2E 按组定位。 */
export function IosListSection({ title, count, action, children }: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title}>
      <div className="ios-section-header">
        <h3>
          {title}
          {count !== undefined && <span className="ios-section-count">{count} 项</span>}
        </h3>
        {action}
      </div>
      <div className="ios-list">{children}</div>
    </section>
  );
}

/** 整行可点的开关行：点击行任意位置即切换（label 包裹原生 checkbox）。 */
export function IosToggleRow({ scaleId, title, subtitle, note, name, value, checked, onChange }: {
  scaleId: string;
  title: string;
  subtitle?: string;
  note?: string;
  name: string;
  value: string;
  checked: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
}) {
  const Icon = SCALE_ICONS[scaleId] ?? ClipboardList;
  return (
    <label className="ios-row">
      <span className="ios-icon" aria-hidden="true">
        <Icon strokeWidth={2} />
      </span>
      <span className="min-w-0">
        <span className="ios-row-title">{title}</span>
        {subtitle && <span className="ios-row-subtitle">{subtitle}</span>}
        {note && <span className="ios-row-note">{note}</span>}
      </span>
      <input type="checkbox" role="switch" className="ios-switch"
        name={name} value={value} checked={checked} onChange={onChange} />
    </label>
  );
}

/**
 * 全选 / 清除合一的文字按钮：已全选时显示「清除」，否则显示「全选」，一个位置只放一个动作。
 * 组内按钮的可访问名带组名（如「清除本组（老年综合征）」），避免读屏时多个同名按钮无法区分。
 */
export function IosSelectAllButton({ ids, selected, onChange, group }: {
  ids: readonly string[];
  selected: Pick<ReadonlySet<string>, "has">;
  onChange: (ids: readonly string[], checked: boolean) => void;
  group?: string;
}) {
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const visible = allSelected ? (group ? "清除" : "清除已选") : "全选";
  const accessible = group ? `${allSelected ? "清除本组" : "全选本组"}（${group}）` : visible;
  return (
    <button type="button" className="ios-text-button" aria-label={accessible}
      onClick={() => onChange(ids, !allSelected)}>
      {visible}
    </button>
  );
}

/** 已选数量 + 开始按钮（放在左栏底部，16:9 下始终可见，无需滚动到页尾）。 */
export function IosSubmitSummary({ count, label }: { count: number; label: string }) {
  return (
    <>
      <p className="ios-summary" aria-live="polite">
        <span>本次评估</span>
        <span>已选<strong>{count}</strong>项</span>
      </p>
      <button type="submit" className="ios-pill-button" disabled={count === 0}>
        {label}
      </button>
    </>
  );
}
