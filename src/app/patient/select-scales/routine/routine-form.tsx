/**
 * INPUT:  预设套餐（含按一级分类分组的量表）、患者 id、startAssessment action
 * OUTPUT: 患者端「常规综合评估」配置表单（客户端交互组件）
 * POS:    先选预设套餐，再按分类调整量表；提交 name="scaleIds" 多选。
 */
"use client";

import { useState } from "react";
import { CircleAlert, Clock3, ListTodo } from "lucide-react";
import { AssessmentSubmitBar, ScaleDetailsToggle, ScaleGroup, ScaleOption } from "@/components/assessment-selection";

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
  // 默认选中推荐套餐（recommended，2026-09-14 起为门诊简版），无推荐标记时回退第一个
  const [selectedKey, setSelectedKey] = useState(
    packages.find((pkg) => pkg.recommended)?.key ?? packages[0]?.key ?? ""
  );
  const selected = packages.find((pkg) => pkg.key === selectedKey) ?? packages[0];
  // 勾选状态：切换套餐时重置为该套餐全选（checked 集合以量表 id 计）
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set(selected?.scaleIds ?? []));
  const [showDetails, setShowDetails] = useState(false);

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

  if (!selected) return null;

  return (
    <form action={action} className="space-y-7">
      <input type="hidden" name="mode" value="routine" />
      {error === "scales" && (
        <div className="ui-alert ui-alert-danger text-base sm:text-lg" role="alert">
          <CircleAlert size={23} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>请至少保留一项评估内容。</span>
        </div>
      )}

      <fieldset>
        <legend className="mb-3 font-bold text-foreground">选择套餐</legend>
        <div className="grid gap-3 lg:grid-cols-3">
          {packages.map((pkg) => (
            <label key={pkg.key} className="flex min-h-24 cursor-pointer items-start gap-3 rounded-2xl border border-border bg-card p-4 hover:border-primary/50 has-checked:border-primary has-checked:bg-accent/55 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring">
              <input
                type="radio"
                name="routinePackage"
                value={pkg.key}
                checked={selectedKey === pkg.key}
                onChange={() => choosePackage(pkg)}
                className="mt-1 size-5 shrink-0 accent-primary"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-foreground">{pkg.name}</span>
                  {pkg.recommended && <span className="ui-badge ui-badge-success">推荐</span>}
                </span>
                <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><ListTodo className="size-4" aria-hidden="true" /> {pkg.scaleIds.length} 项</span>
                  <span className="inline-flex items-center gap-1"><Clock3 className="size-4" aria-hidden="true" /> 约 {pkg.minutes} 分钟</span>
                </span>
                {showDetails && <span className="mt-2 block text-sm text-muted-foreground">{pkg.description} 适用场景：{pkg.scene}</span>}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">本次评估项目</h2>
          <ScaleDetailsToggle checked={showDetails} onChange={(e) => setShowDetails(e.target.checked)} />
        </div>
        {selected.groups.map((group) => (
          <ScaleGroup key={group.category} title={group.category} count={group.scales.length}>
            {group.scales.map((scale) => (
              <ScaleOption key={scale.id} title={scale.label} description={scale.subtitle} needsAssist={scale.needsAssist}
                name="scaleIds" value={scale.id} checked={checked.has(scale.id)} showDetails={showDetails}
                onChange={(e) => toggleScale(scale.id, e.target.checked)} />
            ))}
          </ScaleGroup>
        ))}
      </section>
      <AssessmentSubmitBar count={checked.size} label="确认并开始评估" />
    </form>
  );
}
