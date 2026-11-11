/**
 * INPUT:  量表分组、选择状态和提交操作
 * OUTPUT: 量表目录卡片、说明开关与提交栏
 * POS:    患者端四种评估方式共用，原生表单控件负责提交。
 *         2026-11-11 用户拍板：各分组不再提供「全选本组 / 清除本组」，只保留页面级「全选 / 清除已选」。
 */
import type { ChangeEventHandler, ReactNode } from "react";
import {
  Accessibility, ArrowRight, Brain, ClipboardList, Footprints, Frown, HeartPulse, House,
  LayoutGrid, Leaf, Moon, Smile, Soup, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const categoryIcons: Record<string, LucideIcon> = {
  躯体功能: Accessibility,
  精神心理: Brain,
  社会环境: House,
  老年综合征: Accessibility,
  中医: Leaf,
};

const scaleIcons: Record<string, LucideIcon> = {
  frail: HeartPulse,
  mnasf: Soup,
  fall_3q: Footprints,
  morse: Footprints,
  ais: Moon,
  sleep_1q: Moon,
  minicog: Brain,
  mmse: Brain,
  depression_2q: Smile,
  anxiety_2q: Frown,
};

/** 只改动当前操作范围，保留其他组的勾选。 */
export function updateAssessmentSelection(current: ReadonlySet<string>, ids: readonly string[], checked: boolean) {
  const next = new Set(current);
  for (const id of ids) {
    if (checked) next.add(id);
    else next.delete(id);
  }
  return next;
}

export function AssessmentBulkActions({ ids, selected, onChange, selectLabel, clearLabel }: {
  ids: readonly string[];
  selected: Pick<ReadonlySet<string>, "has">;
  onChange: (ids: readonly string[], checked: boolean) => void;
  selectLabel?: string;
  clearLabel?: string;
}) {
  const select = selectLabel ?? "全选";
  const clear = clearLabel ?? "清除已选";
  return (
    <div className="assessment-bulk">
      <button type="button" className="assessment-bulk-button"
        disabled={ids.every((id) => selected.has(id))}
        onClick={() => onChange(ids, true)}>{select}</button>
      <button type="button" className="assessment-bulk-button"
        disabled={!ids.some((id) => selected.has(id))}
        onClick={() => onChange(ids, false)}>{clear}</button>
    </div>
  );
}

export function ScaleGroup({ title, count, children }: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  const Icon = categoryIcons[title] ?? LayoutGrid;
  return (
    <section className="assessment-band" aria-label={title}>
      <div className="assessment-band-body">
        <div className="assessment-band-label">
          <Icon className="assessment-band-icon" aria-hidden="true" />
          <h3>{title}</h3>
          <span className="assessment-band-count">{count} 项</span>
        </div>
        <div className="assessment-tiles">{children}</div>
      </div>
    </section>
  );
}

export function ScaleOption({ title, description, needsAssist, showDetails, checked, onChange, name, value, scaleId }: {
  title: string;
  description?: string;
  needsAssist?: boolean;
  showDetails: boolean;
  checked: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
  name?: string;
  value?: string;
  scaleId?: string;
}) {
  const Icon = scaleIcons[scaleId ?? value ?? ""] ?? ClipboardList;
  return (
    <label className="assessment-tile">
      <span className="assessment-tile-top">
        <Icon className="assessment-tile-icon" aria-hidden="true" />
        <input type="checkbox" name={name} value={value} checked={checked} onChange={onChange}
          className="size-5 shrink-0 accent-primary" />
      </span>
      <span className="assessment-tile-copy">
        <span className="assessment-tile-title">{title}</span>
        {description && (
          <span className={showDetails ? "mt-1 block text-sm text-muted-foreground" : "sr-only"}>
            {description}
          </span>
        )}
        {needsAssist && (
          <span className="assessment-assist">
            需医护协助{showDetails && "，报告按已答内容计分"}
          </span>
        )}
      </span>
    </label>
  );
}

export function ScaleDetailsToggle({ checked, onChange }: {
  checked: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
}) {
  return (
    <label className="assessment-details-toggle">
      <input type="checkbox" checked={checked} onChange={onChange} className="size-5 accent-primary" />
      显示项目说明
    </label>
  );
}

export function AssessmentSubmitBar({ count, label, supporting, disabled }: {
  count: number;
  label: string;
  supporting?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="assessment-submit">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-foreground" aria-live="polite">
        <ClipboardList className="size-5 text-primary" aria-hidden="true" />
        已选 <span className="text-primary tabular-nums">{count}</span> 项
        {supporting && <span className="text-sm font-normal text-muted-foreground">{supporting}</span>}
      </p>
      <Button type="submit" disabled={disabled || count === 0} className="min-h-12 w-full gap-2 px-5 text-base font-bold sm:w-auto">
        {label}
        <ArrowRight aria-hidden="true" />
      </Button>
    </div>
  );
}
