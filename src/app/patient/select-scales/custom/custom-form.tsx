/**
 * INPUT:  系统预设套餐（含量表标签）、按一级分类分组的自定义量表树、各量表作答题目数
 * OUTPUT: 患者端「自选组合评估」表单（客户端交互组件）
 * POS:    系统预设套餐与临时自定义两种入口；右栏「已选评估项目」按来源分组、
 *         单项可移除、可清空；提交 name="scaleIds" 建会话。
 */
"use client";

import { useMemo, useState } from "react";
import { Brain, Check, CircleAlert, ClipboardList, CookingPot, Dumbbell, Moon, X } from "lucide-react";
import { AssessmentSubmitBar, ScaleDetailsToggle, ScaleGroup, ScaleOption } from "@/components/assessment-selection";
import { minutesFromAskable } from "@/lib/assessment/patient-scale-packages";

export interface CustomScaleItem {
  id: string;
  label: string;
  subtitle: string;
}

export interface CustomPackageOption {
  key: string;
  name: string;
  description: string;
  scales: readonly CustomScaleItem[];
}

export interface CustomGroup {
  category: string;
  scales: readonly CustomScaleItem[];
}

interface Props {
  packages: readonly CustomPackageOption[];
  customGroups: readonly CustomGroup[];
  askableCounts: Record<string, number>;
  error: string | null;
  action: (formData: FormData) => Promise<void>;
}

const PACKAGE_ICONS: Record<string, typeof Brain> = {
  cognition_mood: Brain,
  fall_risk: Dumbbell,
  sarcopenia_nutrition: CookingPot,
  sleep_pain: Moon,
};

type TabKey = "preset" | "custom";

const tabs = [
  { key: "preset", label: "系统预设套餐" },
  { key: "custom", label: "临时自定义选择" },
] as const;

export default function CustomForm({ packages, customGroups, askableCounts, error, action }: Props) {
  const [tab, setTab] = useState<TabKey>("preset");
  const [showDetails, setShowDetails] = useState(false);
  /** 已选量表 → 来源（套餐 key 或 "custom"），右栏按来源分组展示 */
  const [selected, setSelected] = useState<ReadonlyMap<string, string>>(new Map());

  const toggleScale = (scaleId: string, source: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (on) next.set(scaleId, source);
      else next.delete(scaleId);
      return next;
    });
  };

  const togglePackage = (pkg: CustomPackageOption) => {
    setSelected((prev) => {
      const next = new Map(prev);
      const allIn = pkg.scales.every((s) => next.has(s.id));
      if (allIn) {
        for (const s of pkg.scales) next.delete(s.id);
      } else {
        for (const s of pkg.scales) next.set(s.id, pkg.key);
      }
      return next;
    });
  };

  const clearAll = () => setSelected(new Map());

  const minutes = useMemo(() => {
    let askable = 0;
    for (const id of selected.keys()) askable += askableCounts[id] ?? 0;
    return minutesFromAskable(askable);
  }, [selected, askableCounts]);

  // 右栏分组：按套餐顺序 + 末尾"自定义选择"组
  const selectedGroups = useMemo(() => {
    const groups: { key: string; name: string; items: CustomScaleItem[] }[] = [];
    for (const pkg of packages) {
      const items = pkg.scales.filter((s) => selected.get(s.id) === pkg.key);
      if (items.length > 0) groups.push({ key: pkg.key, name: pkg.name, items: [...items] });
    }
    const customItems: CustomScaleItem[] = [];
    for (const group of customGroups) {
      for (const s of group.scales) {
        if (selected.get(s.id) === "custom") customItems.push(s);
      }
    }
    if (customItems.length > 0) groups.push({ key: "custom", name: "自定义选择", items: customItems });
    return groups;
  }, [selected, packages, customGroups]);

  return (
    <form action={action} className="space-y-7">
      <input type="hidden" name="mode" value="custom" />
      {error === "scales" && (
        <div className="ui-alert ui-alert-danger text-base sm:text-lg" role="alert">
          <CircleAlert size={23} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>请至少选择一项评估内容。</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-h-12 flex-wrap gap-1 rounded-xl bg-muted p-1" role="tablist" aria-label="选择项目来源"
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const next = tab === "preset" ? "custom" : "preset";
            setTab(next);
            event.currentTarget.querySelector<HTMLButtonElement>(`#scale-tab-${next}`)?.focus();
          }}
        >
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`scale-tab-${t.key}`}
              aria-controls="scale-options"
              aria-selected={tab === t.key}
              tabIndex={tab === t.key ? 0 : -1}
              onClick={() => setTab(t.key)}
              className="rounded-lg px-3 py-2 font-bold text-muted-foreground hover:text-primary focus-visible:outline-2 focus-visible:outline-ring aria-selected:bg-card aria-selected:text-primary aria-selected:shadow-sm"
            >
              {t.label}
            </button>
          ))}
        </div>
        <ScaleDetailsToggle checked={showDetails} onChange={(e) => setShowDetails(e.target.checked)} />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.4fr)]">
        <div id="scale-options" role="tabpanel" aria-labelledby={`scale-tab-${tab}`} className="min-w-0 space-y-4">
          {tab === "preset" && (
            <div className="grid gap-3 sm:grid-cols-2">
              {packages.map((pkg) => {
                const Icon = PACKAGE_ICONS[pkg.key] ?? ClipboardList;
                const allIn = pkg.scales.length > 0 && pkg.scales.every((s) => selected.has(s.id));
                return (
                  <button
                    key={pkg.key}
                    type="button"
                    onClick={() => togglePackage(pkg)}
                    aria-pressed={allIn}
                    className={[
                      "group flex min-h-32 flex-col items-start gap-3 rounded-2xl border p-4 text-left transition focus-visible:outline-2 focus-visible:outline-ring",
                      allIn
                        ? "border-blue-500 bg-blue-50/60"
                        : "border-blue-100 bg-white hover:border-blue-300",
                    ].join(" ")}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-primary">
                        <Icon size={22} aria-hidden="true" />
                      </span>
                      <span className="grid size-6 shrink-0 place-items-center rounded-md border border-input text-transparent group-aria-pressed:border-primary group-aria-pressed:bg-primary group-aria-pressed:text-white" aria-hidden="true">
                        <Check className="size-4" />
                      </span>
                    </span>
                    <span className="block min-w-0">
                      <span className="block font-bold text-foreground">{pkg.name}</span>
                      <span className="block text-sm text-muted-foreground">{pkg.scales.length} 项</span>
                      {showDetails && <span className="mt-1 block text-sm text-muted-foreground">{pkg.description}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {tab === "custom" &&
            customGroups.map((group) => (
              <ScaleGroup key={group.category} title={group.category} count={group.scales.length}>
                {group.scales.map((scale) => (
                  <ScaleOption key={scale.id} title={scale.label} description={scale.subtitle}
                    checked={selected.has(scale.id)} showDetails={showDetails}
                    onChange={(e) => toggleScale(scale.id, "custom", e.target.checked)} />
                ))}
              </ScaleGroup>
            ))}
        </div>

        {/* 右栏：已选评估项目（sticky 保持） */}
        <section className="space-y-4 self-start rounded-2xl border border-border bg-muted/45 p-4 lg:sticky lg:top-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-extrabold text-[#173766]">已选评估项目</h2>
            {selected.size > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="text-sm font-bold text-[#7f94b3] underline-offset-2 hover:text-blue-700 hover:underline"
              >
                清空全部
              </button>
            )}
          </div>

          {selectedGroups.length === 0 && (
            <p className="rounded-2xl bg-[#f8fbff] px-5 py-8 text-center text-base leading-7 text-[#7f94b3]">
              暂未选择项目
            </p>
          )}

          <div className="max-h-72 space-y-3 overflow-y-auto">
            {selectedGroups.map((group) => (
              <div key={group.key}>
                <p className="text-sm font-extrabold tracking-wide text-[#62779a]">
                  {group.name}
                  <span className="ml-2 text-[#8ba0bd]">{group.items.length} 项</span>
                </p>
                <ul className="mt-1.5 space-y-1">
                  {group.items.map((scale) => (
                    <li
                      key={scale.id}
                      className="flex items-center gap-2 rounded-xl border border-blue-100 bg-[#f8fbff] px-3 py-2"
                    >
                      {/* 隐藏 checkbox 承载提交值；× 仅做移除交互 */}
                      <input type="checkbox" name="scaleIds" value={scale.id} checked readOnly className="sr-only" tabIndex={-1} aria-hidden="true" />
                      <span className="min-w-0 flex-1 text-base font-bold text-[#29496f]">{scale.label}</span>
                      <button
                        type="button"
                        onClick={() => toggleScale(scale.id, selected.get(scale.id) ?? "custom", false)}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[#8ba0bd] hover:bg-blue-100 hover:text-blue-700"
                        aria-label={`移除${scale.label}`}
                      >
                        <X size={16} strokeWidth={2.2} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

          </div>
        </section>
      </div>

      <AssessmentSubmitBar count={selected.size} label="确认并进入采集"
        supporting={selected.size > 0 ? `· 约 ${minutes} 分钟` : undefined} />
    </form>
  );
}
