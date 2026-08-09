/**
 * INPUT:  系统预设套餐（含量表标签）、按一级分类分组的自定义量表树、各量表作答题目数
 * OUTPUT: 患者端「自选组合评估」表单（客户端交互组件）
 * POS:    2026-08-08 设计图·自选组合评估：tab = 系统预设套餐 / 机构预设套餐（占位禁用，
 *         任务清单口径：需甲方定义）/ 临时自定义选择；右栏「已选评估项目」按来源分组、
 *         单项可移除、可清空；提交 name="scaleIds" 建会话。
 */
"use client";

import { useMemo, useState } from "react";
import {
  IconAlertCircle,
  IconArrowRight,
  IconBrain,
  IconClipboardList,
  IconMoon,
  IconRun,
  IconSalt,
  IconX,
} from "@tabler/icons-react";
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

const PACKAGE_ICONS: Record<string, typeof IconBrain> = {
  cognition_mood: IconBrain,
  fall_risk: IconRun,
  sarcopenia_nutrition: IconSalt,
  sleep_pain: IconMoon,
};

type TabKey = "preset" | "org" | "custom";

export default function CustomForm({ packages, customGroups, askableCounts, error, action }: Props) {
  const [tab, setTab] = useState<TabKey>("preset");
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

  const tabs: { key: TabKey; label: string; disabled?: boolean }[] = [
    { key: "preset", label: "系统预设套餐" },
    { key: "org", label: "机构预设套餐", disabled: true },
    { key: "custom", label: "临时自定义选择" },
  ];

  return (
    <form action={action} className="space-y-7">
      <input type="hidden" name="mode" value="custom" />
      {error === "scales" && (
        <div className="ui-alert ui-alert-danger text-base sm:text-lg" role="alert">
          <IconAlertCircle size={23} stroke={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>请至少选择一项评估内容。</span>
        </div>
      )}

      {/* tab 切换（机构预设套餐按任务清单口径占位禁用：需甲方定义） */}
      <div className="flex flex-wrap gap-2" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            disabled={t.disabled}
            title={t.disabled ? "机构预设套餐待机构配置后开放" : undefined}
            onClick={() => setTab(t.key)}
            className={[
              "rounded-xl border px-5 py-2.5 text-base font-extrabold transition",
              tab === t.key
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-blue-100 bg-white text-[#405a81] hover:border-blue-300",
              t.disabled ? "cursor-not-allowed opacity-45 hover:border-blue-100" : "",
            ].join(" ")}
          >
            {t.label}
            {t.disabled && <span className="ml-1 text-xs font-bold">（待机构配置）</span>}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        {/* 左栏：可选内容 */}
        <div className="space-y-3">
          {tab === "preset" &&
            packages.map((pkg) => {
              const Icon = PACKAGE_ICONS[pkg.key] ?? IconClipboardList;
              const allIn = pkg.scales.length > 0 && pkg.scales.every((s) => selected.has(s.id));
              return (
                <button
                  key={pkg.key}
                  type="button"
                  onClick={() => togglePackage(pkg)}
                  aria-pressed={allIn}
                  className={[
                    "flex w-full items-center gap-4 rounded-2xl border p-5 text-left transition",
                    allIn
                      ? "border-blue-500 bg-blue-50/60"
                      : "border-blue-100 bg-white hover:border-blue-300",
                  ].join(" ")}
                >
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-600">
                    <Icon size={25} stroke={1.9} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-lg font-extrabold text-[#173766]">{pkg.name}</span>
                    <span className="mt-0.5 block text-sm leading-6 text-[#62779a]">{pkg.description}</span>
                  </span>
                  <span className="shrink-0 text-sm font-bold text-[#7f94b3]">{pkg.scales.length} 项</span>
                  <span
                    className={[
                      "grid h-7 w-7 shrink-0 place-items-center rounded-full border-2",
                      allIn ? "border-blue-600 bg-blue-600 text-white" : "border-[#c3d4ec] bg-white text-transparent",
                    ].join(" ")}
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                </button>
              );
            })}

          {tab === "custom" &&
            customGroups.map((group) => (
              <section key={group.category} className="rounded-2xl border border-blue-100 bg-white p-4 sm:p-5">
                <p className="flex items-center justify-between text-base font-extrabold text-[#173766]">
                  {group.category}
                  <span className="text-sm font-bold text-[#7f94b3]">{group.scales.length} 项</span>
                </p>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {group.scales.map((scale) => (
                    <label key={scale.id} className="patient-check">
                      <input
                        type="checkbox"
                        checked={selected.has(scale.id)}
                        onChange={(e) => toggleScale(scale.id, "custom", e.target.checked)}
                      />
                      <span className="min-w-0">
                        <span className="block text-lg font-extrabold leading-tight text-[#173766]">
                          {scale.label}
                        </span>
                        <span className="mt-1 block text-sm leading-6 text-[#62779a]">{scale.subtitle}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </section>
            ))}
        </div>

        {/* 右栏：已选评估项目 */}
        <section className="space-y-4 self-start rounded-2xl border border-blue-100 bg-white p-5 sm:p-6 lg:sticky lg:top-6">
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
              还没有选择。请从左侧点选套餐，或逐项勾选。
            </p>
          )}

          {selectedGroups.map((group) => (
            <div key={group.key}>
              <p className="text-sm font-extrabold tracking-wide text-[#62779a]">
                {group.name}
                <span className="ml-2 text-[#8ba0bd]">{group.items.length} 项</span>
              </p>
              <ul className="mt-2 space-y-1.5">
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
                      <IconX size={16} stroke={2.2} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="flex items-center justify-around rounded-2xl bg-[#f0f7ff] px-4 py-4 text-center">
            <p className="text-sm font-bold text-[#62779a]">
              已选
              <span className="mx-1 text-2xl font-extrabold text-blue-700">{selected.size}</span>项
            </p>
            <p className="text-sm font-bold text-[#62779a]">
              预计
              <span className="mx-1 text-2xl font-extrabold text-blue-700">{minutes}</span>分钟
            </p>
          </div>
        </section>
      </div>

      <div className="space-y-3">
        <button type="submit" className="patient-primary-action w-full" disabled={selected.size === 0}>
          确认并进入采集（{selected.size} 项）
          <IconArrowRight size={25} stroke={2.1} aria-hidden="true" />
        </button>
        <p className="text-center text-sm leading-6 text-[#62779a]">提交后将直接进入健康问询。</p>
      </div>
    </form>
  );
}
