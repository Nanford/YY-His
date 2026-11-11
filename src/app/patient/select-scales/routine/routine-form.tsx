/**
 * INPUT:  预设套餐（含按一级分类分组的量表）、患者 id、startAssessment action
 * OUTPUT: 患者端「常规综合评估」配置表单（客户端交互组件）
 * POS:    先选预设套餐，再按分类调整量表；提交 name="scaleIds" 多选。
 */
"use client";

import { useState } from "react";
import { CircleAlert } from "lucide-react";
import {
  AssessmentBulkActions, AssessmentSubmitBar, ScaleDetailsToggle, ScaleGroup, ScaleOption, updateAssessmentSelection,
} from "@/components/assessment-selection";

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
  const toggleScales = (ids: readonly string[], on: boolean) =>
    setChecked((prev) => updateAssessmentSelection(prev, ids, on));

  if (!selected) return null;

  return (
    <form action={action} className="assessment-form">
      <input type="hidden" name="mode" value="routine" />
      {error === "scales" && (
        <div className="ui-alert ui-alert-danger text-base sm:text-lg" role="alert">
          <CircleAlert size={23} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>请至少保留一项评估内容。</span>
        </div>
      )}

      <fieldset>
        <legend className="sr-only">选择套餐</legend>
        <div className="assessment-packages">
          {packages.map((pkg) => (
            <label key={pkg.key} className="assessment-package">
              <input
                type="radio"
                name="routinePackage"
                value={pkg.key}
                checked={selectedKey === pkg.key}
                onChange={() => choosePackage(pkg)}
                className="mt-1 size-5 shrink-0 accent-primary"
              />
              <span className="min-w-0 flex-1">
                <span className="assessment-package-title">{pkg.name}</span>
                {pkg.recommended && <span className="sr-only">推荐</span>}
                <span className="mt-1.5 block text-sm text-muted-foreground">{pkg.scaleIds.length} 项 · 约 {pkg.minutes} 分钟</span>
                {showDetails && <span className="mt-2 block text-sm text-muted-foreground">{pkg.description} 适用场景：{pkg.scene}</span>}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <section className="assessment-groups">
        <div className="assessment-toolbar">
          <h2>本次评估项目</h2>
          <div className="assessment-toolbar-actions">
            <AssessmentBulkActions ids={selected.scaleIds} selected={checked} onChange={toggleScales} />
            <ScaleDetailsToggle checked={showDetails} onChange={(e) => setShowDetails(e.target.checked)} />
          </div>
        </div>
        {selected.groups.map((group) => (
          <ScaleGroup key={group.category} title={group.category} count={group.scales.length}>
            {group.scales.map((scale) => (
              <ScaleOption key={scale.id} title={scale.label} description={scale.subtitle} needsAssist={scale.needsAssist}
                name="scaleIds" value={scale.id} checked={checked.has(scale.id)} showDetails={showDetails}
                onChange={(e) => toggleScales([scale.id], e.target.checked)} />
            ))}
          </ScaleGroup>
        ))}
      </section>
      <AssessmentSubmitBar count={checked.size} label="确认并开始评估" />
    </form>
  );
}
