/**
 * INPUT:  量表/套餐选项与勾选状态（由页面表单组件持有）；样式见 src/app/ios-design.css
 * OUTPUT: iOS 风格的选择类组件：分段控件、分组列表、开关行、全选按钮、毛玻璃提交底栏
 * POS:    2026-11-11 UI 改版样板（目前仅「常规综合评估」页使用）；只负责呈现，
 *         提交仍靠原生表单控件（radio / checkbox 的 name、value 原样随表单提交）。
 *         与旧版 assessment-selection.tsx 并存，样板确认后再迁移其余三个方式页。
 */
"use client";

import type { ChangeEventHandler, ReactNode } from "react";
import { motion } from "motion/react";
import {
  Activity, Apple, Bandage, Brain, BrainCircuit, ClipboardList, Ear, Eye, Footprints, Hand,
  HeartPulse, House, Moon, Pill, ShoppingBasket, Smile, Soup, Users, Wind, Zap, type LucideIcon,
} from "lucide-react";

interface ScaleGlyph {
  icon: LucideIcon;
  /** iOS 设置页式的彩色图标底，按主题区分，仅作视觉识别 */
  tint: string;
}

const SCALE_GLYPHS: Record<string, ScaleGlyph> = {
  frail: { icon: HeartPulse, tint: "#ff3b30" },
  mnasf: { icon: Soup, tint: "#ff9500" },
  nrs2002: { icon: Apple, tint: "#ff9500" },
  fall_3q: { icon: Footprints, tint: "#30b0c7" },
  morse: { icon: Footprints, tint: "#30b0c7" },
  motor_screen: { icon: Activity, tint: "#30b0c7" },
  ais: { icon: Moon, tint: "#5856d6" },
  sleep_1q: { icon: Moon, tint: "#5856d6" },
  minicog: { icon: Brain, tint: "#ff2d55" },
  mmse: { icon: BrainCircuit, tint: "#ff2d55" },
  cam: { icon: BrainCircuit, tint: "#af52de" },
  depression_2q: { icon: Smile, tint: "#ff9f0a" },
  anxiety_2q: { icon: Wind, tint: "#32ade6" },
  adl: { icon: Hand, tint: "#34c759" },
  iadl: { icon: ShoppingBasket, tint: "#34c759" },
  vision: { icon: Eye, tint: "#007aff" },
  hearing: { icon: Ear, tint: "#af52de" },
  lubben: { icon: Users, tint: "#007aff" },
  home_env: { icon: House, tint: "#a2845e" },
  braden: { icon: Bandage, tint: "#ff2d55" },
  polypharmacy: { icon: Pill, tint: "#af52de" },
  pain_1q: { icon: Zap, tint: "#ff3b30" },
};

const FALLBACK_GLYPH: ScaleGlyph = { icon: ClipboardList, tint: "#8e8e93" };

/** 选项卡式单选：选中滑块用 layoutId 在各段之间做临界阻尼弹簧滑动（无回弹）。 */
export function IosSegmentedControl({ name, legend, options, value, onChange }: {
  name: string;
  legend: string;
  options: readonly { value: string; title: string; meta: string; badge?: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="sr-only">{legend}</legend>
      <div className="ios-segmented">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label key={option.value} className="ios-segment">
              {selected && (
                <motion.span
                  layoutId={`ios-segment-thumb-${name}`}
                  className="ios-segment-thumb"
                  transition={{ type: "spring", bounce: 0, duration: 0.35 }}
                  aria-hidden="true"
                />
              )}
              <input type="radio" name={name} value={option.value} checked={selected}
                onChange={() => onChange(option.value)} />
              <span className="ios-segment-title">{option.title}</span>
              <span className="ios-segment-meta">
                {option.meta}
                {option.badge && <span className="ios-segment-badge">{option.badge}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** 一级标题行（「本次评估项目」等），右侧可放全选按钮。 */
export function IosPrimaryHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="ios-section-header ios-section-header-primary">
      <h2>{title}</h2>
      {action}
    </div>
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
        <h3 className="ios-section-title">
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
  const { icon: Icon, tint } = SCALE_GLYPHS[scaleId] ?? FALLBACK_GLYPH;
  return (
    <label className="ios-row">
      <span className="ios-icon" style={{ background: tint }} aria-hidden="true">
        <Icon strokeWidth={2.1} />
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

/** 固定在视口底部的毛玻璃提交栏，页面内容从下方滚过。 */
export function IosBottomBar({ count, label }: { count: number; label: string }) {
  return (
    <div className="ios-bottom-bar">
      <div className="ios-bottom-bar-inner">
        <p className="ios-bottom-count" aria-live="polite">
          已选<strong>{count}</strong>项
        </p>
        <button type="submit" className="ios-pill-button" disabled={count === 0}>
          {label}
        </button>
      </div>
    </div>
  );
}
