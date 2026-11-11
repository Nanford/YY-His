/**
 * INPUT:  预设套餐（含按一级分类分组的量表）、患者 id、startAssessment action
 * OUTPUT: 患者端「常规综合评估」配置表单（客户端交互组件）
 * POS:    先选预设套餐，再按分类调整量表；提交 name="scaleIds" 多选。
 *         2026-11-11 起为 iOS 风格样板（ios-selection 组件），量表说明常显为副标题，
 *         去掉「显示项目说明」开关；全选/清除按组合并为一个按钮。
 */
"use client";

import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { updateAssessmentSelection } from "@/components/assessment-selection";
import {
  IosBottomBar, IosListSection, IosPrimaryHeader, IosSegmentedControl, IosSelectAllButton, IosToggleRow,
} from "@/components/ios-selection";

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

  const choosePackage = (key: string) => {
    const pkg = packages.find((item) => item.key === key);
    if (!pkg) return;
    setSelectedKey(pkg.key);
    setChecked(new Set(pkg.scaleIds));
  };
  const toggleScales = (ids: readonly string[], on: boolean) =>
    setChecked((prev) => updateAssessmentSelection(prev, ids, on));

  if (!selected) return null;

  return (
    <form action={action}>
      <input type="hidden" name="mode" value="routine" />
      {error === "scales" && (
        <div className="ios-alert" role="alert">
          <CircleAlert size={22} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>请至少保留一项评估内容。</span>
        </div>
      )}

      <IosPrimaryHeader title="评估套餐" />
      <IosSegmentedControl
        name="routinePackage"
        legend="选择套餐"
        value={selectedKey}
        onChange={choosePackage}
        options={packages.map((pkg) => ({
          value: pkg.key,
          title: pkg.name,
          meta: `${pkg.scaleIds.length} 项 · 约 ${pkg.minutes} 分钟`,
          badge: pkg.recommended ? "推荐" : undefined,
        }))}
      />

      <IosPrimaryHeader
        title="本次评估项目"
        action={<IosSelectAllButton ids={selected.scaleIds} selected={checked} onChange={toggleScales} />}
      />
      {selected.groups.map((group) => (
        <IosListSection key={group.category} title={group.category} count={group.scales.length}
          action={<IosSelectAllButton ids={group.scales.map((scale) => scale.id)} selected={checked}
            onChange={toggleScales} group={group.category} />}>
          {group.scales.map((scale) => (
            <IosToggleRow key={scale.id} scaleId={scale.id} title={scale.label} subtitle={scale.subtitle}
              note={scale.needsAssist ? "部分题目需医护协助" : undefined}
              name="scaleIds" value={scale.id} checked={checked.has(scale.id)}
              onChange={(e) => toggleScales([scale.id], e.target.checked)} />
          ))}
        </IosListSection>
      ))}

      <IosBottomBar count={checked.size} label="开始评估" />
    </form>
  );
}
