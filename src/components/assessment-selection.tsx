/**
 * INPUT:  量表分组、选择状态和提交操作
 * OUTPUT: 量表目录卡片、说明开关与提交栏
 * POS:    患者端四种评估方式共用，原生表单控件负责提交。
 */
import type { ChangeEventHandler, ReactNode } from "react";
import {
  Accessibility, Activity, ArrowRight, Brain, ClipboardList, House, LayoutGrid, Leaf, type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const categoryIcons: Record<string, LucideIcon> = {
  躯体功能: Accessibility,
  精神心理: Brain,
  社会环境: House,
  老年综合征: Activity,
  中医: Leaf,
};

export function ScaleGroup({ title, count, children }: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  const Icon = categoryIcons[title] ?? LayoutGrid;
  return (
    <section className="@container overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-3 border-b border-border bg-accent/55 px-4 py-3 sm:px-5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-card text-primary" aria-hidden="true">
          <Icon className="size-4" />
        </span>
        <h3 className="flex-1 font-bold text-foreground">{title}</h3>
        <Badge variant="secondary">{count} 项</Badge>
      </div>
      <div className="grid gap-2.5 p-3 @min-[24rem]:grid-cols-2 @min-[48rem]:grid-cols-3 sm:p-4">{children}</div>
    </section>
  );
}

export function ScaleOption({ title, description, needsAssist, showDetails, checked, onChange, name, value }: {
  title: string;
  description?: string;
  needsAssist?: boolean;
  showDetails: boolean;
  checked: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
  name?: string;
  value?: string;
}) {
  return (
    <label className="flex min-h-16 cursor-pointer items-start gap-3 rounded-xl border border-border p-3 hover:border-primary/50 has-checked:border-primary/50 has-checked:bg-accent/55 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring">
      <input type="checkbox" name={name} value={value} checked={checked} onChange={onChange}
        className="mt-1 size-5 shrink-0 accent-primary" />
      <span className="min-w-0">
        <span className="block leading-snug font-bold text-foreground">{title}</span>
        {description && (
          <span className={showDetails ? "mt-1 block text-sm text-muted-foreground" : "sr-only"}>
            {description}
          </span>
        )}
        {needsAssist && (
          <span className="mt-1 block font-medium text-[#825000]">
            <span className={showDetails ? "text-sm" : "text-xs"}>部分题目需医护协助</span>
            {showDetails && <span className="text-sm">，报告按已答内容计分</span>}
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
    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-border bg-card px-3 font-semibold text-foreground">
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
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-lg shadow-blue-950/10 sm:bottom-3 sm:px-4">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-foreground" aria-live="polite">
        <ClipboardList className="size-5 text-primary" aria-hidden="true" />
        已选 <span className="text-primary tabular-nums">{count}</span> 项
        {supporting && <span className="text-sm font-normal text-muted-foreground">{supporting}</span>}
      </p>
      <Button type="submit" disabled={disabled || count === 0} className="min-h-12 w-full gap-2 px-4 text-base font-bold sm:w-auto">
        {label}
        <ArrowRight aria-hidden="true" />
      </Button>
    </div>
  );
}
