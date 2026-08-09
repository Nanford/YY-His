/**
 * INPUT:  预设套餐（含按一级分类分组的量表）、患者 id、startAssessment action
 * OUTPUT: 患者端「常规综合评估」配置表单（客户端交互组件）
 * POS:    2026-08-08 设计图·常规综合评估：左栏预设套餐单选，右栏按一级分类分组的
 *         本次量表与工具配置（可增减勾选）+ 已选项数；提交 name="scaleIds" 多选。
 */
"use client";

import { useMemo, useState } from "react";
import {
  IconAlertCircle,
  IconArrowRight,
  IconChecklist,
  IconCircleCheck,
} from "@tabler/icons-react";

export interface RoutineScaleItem {
  id: string;
  label: string;
  subtitle: string;
  /** 含需医生评估/系统读取条目（患者自助路径豁免计分，报告标注"部分计分"） */
  needsAssist: boolean;
}

export interface RoutinePackageGroup {
  category: string;
  scales: RoutineScaleItem[];
}

export interface RoutinePackageOption {
  key: string;
  name: string;
  description: string;
  scene: string;
  recommended: boolean;
  scaleIds: readonly string[];
  minutes: number;
  groups: readonly RoutinePackageGroup[];
}

interface Props {
  packages: readonly RoutinePackageOption[];
  error: string | null;
  action: (formData: FormData) => Promise<void>;
}

export default function RoutineForm({ packages, error, action }: Props) {
  const [selectedKey, setSelectedKey] = useState(packages[0]?.key ?? "");
  const selected = packages.find((pkg) => pkg.key === selectedKey) ?? packages[0];
  // 勾选状态：切换套餐时重置为该套餐全选（checked 集合以量表 id 计）
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set(selected?.scaleIds ?? []));

  const choosePackage = (pkg: RoutinePackageOption) => {
    setSelectedKey(pkg.key);
    setChecked(new Set(pkg.scaleIds));
  };
  const toggleScale = (scaleId: string, on: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(scaleId);
      else next.delete(scaleId);
      return next;
    });
  };

  const checkedCount = useMemo(() => checked.size, [checked]);

  if (!selected) return null;

  return (
    <form action={action} className="space-y-7">
      <input type="hidden" name="mode" value="routine" />
      {error === "scales" && (
        <div className="ui-alert ui-alert-danger text-base sm:text-lg" role="alert">
          <IconAlertCircle size={23} stroke={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>请至少保留一项评估内容。</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        {/* 左栏：预设评估套餐 */}
        <fieldset className="space-y-3">
          <legend className="text-lg font-extrabold text-[#173766]">预设评估套餐</legend>
          {packages.map((pkg) => (
            <label key={pkg.key} className="patient-choice">
              <input
                type="radio"
                name="routinePackage"
                value={pkg.key}
                checked={selectedKey === pkg.key}
                onChange={() => choosePackage(pkg)}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-extrabold text-[#173766]">{pkg.name}</span>
                  {pkg.recommended && <span className="ui-badge ui-badge-success">推荐</span>}
                </span>
                <span className="mt-1 block text-sm leading-6 text-[#62779a]">{pkg.description}</span>
                <span className="mt-1 block text-sm text-[#7f94b3]">
                  量表 {pkg.scaleIds.length} 项 · 预计 {pkg.minutes} 分钟 · 适用：{pkg.scene}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        {/* 右栏：本次量表与工具配置（按一级分类分组，可增减） */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-extrabold text-[#173766]">本次量表与工具配置</h2>
            <span className="inline-flex items-center gap-2 rounded-2xl border border-blue-100 bg-[#f0f7ff] px-4 py-2 text-base font-extrabold text-blue-700">
              已选
              <span className="text-2xl leading-none">{checkedCount}</span>
              项
            </span>
          </div>
          {selected.groups.map((group) => (
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
                      name="scaleIds"
                      value={scale.id}
                      checked={checked.has(scale.id)}
                      onChange={(e) => toggleScale(scale.id, e.target.checked)}
                    />
                    <span className="min-w-0">
                      <span className="block text-lg font-extrabold leading-tight text-[#173766]">
                        {scale.label}
                      </span>
                      <span className="mt-1 block text-sm leading-6 text-[#62779a]">
                        {scale.subtitle}
                      </span>
                      {scale.needsAssist && (
                        <span className="mt-1 block text-xs font-bold text-[#b45309]">
                          部分项目需医护协助，报告按已答内容计分
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <p className="flex items-start gap-2 rounded-2xl border border-blue-100 bg-[#f8fbff] px-5 py-4 text-sm leading-7 text-[#62779a]">
        <IconCircleCheck size={20} stroke={2} className="mt-1 shrink-0 text-blue-600" aria-hidden="true" />
        系统按顺序逐项问询，相同信息自动复用，不会重复提问。
      </p>

      <div className="space-y-3">
        <button type="submit" className="patient-primary-action w-full" disabled={checkedCount === 0}>
          <IconChecklist size={24} stroke={2.1} aria-hidden="true" />
          确认并开始评估（{checkedCount} 项）
          <IconArrowRight size={25} stroke={2.1} aria-hidden="true" />
        </button>
        <p className="text-center text-sm leading-6 text-[#62779a]">提交后将直接进入健康问询。</p>
      </div>
    </form>
  );
}
