/**
 * INPUT:  量表套餐定义、按一级分类分组的可评分量表树、上次已出报告会话信息、绑定的 createSession action
 * OUTPUT: 医生端「发起新评估」量表工具选择表单（客户端交互组件）
 * POS:    量表工具选择（来源：V2/Demo_v2更新说明.docx §2）的界面层：预设套餐单选 / 自定义组合分类树 /
 *         随访对比复评。病历智能评估（docx §2 LLM 推荐）属 M10.2，本期仅占位禁用。
 *         提交字段口径见 src/lib/assessment/scale-packages.ts 的 parseSessionScaleSelection。
 */
"use client";

import { useState } from "react";
import { IconClipboardText, IconHistory } from "@tabler/icons-react";
import type { ScalePackage } from "@/lib/assessment/scale-packages";

export interface ScaleGroup {
  category: string;
  scales: { id: string; name: string; questionCount: number }[];
}

export interface FollowupInfo {
  /** 上次已出报告会话的评估日期（YYYY-MM-DD） */
  dateLabel: string;
  scaleCount: number;
}

interface Props {
  packages: readonly ScalePackage[];
  groups: readonly ScaleGroup[];
  followup: FollowupInfo | null;
  action: (formData: FormData) => Promise<void>;
}

const CUSTOM_KEY = "custom";

export default function SessionCreateForm({ packages, groups, followup, action }: Props) {
  // 选择模式：套餐 key / "custom" 自定义组合 / "followup" 随访复评（互斥单选）
  const [mode, setMode] = useState<string>(packages[0]?.key ?? CUSTOM_KEY);

  return (
    <form action={action} className="ui-panel overflow-hidden">
      <div className="ui-panel-heading">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-600">
            <IconClipboardText size={21} stroke={1.9} aria-hidden="true" />
          </span>
          <div>
            <h2 className="ui-panel-title">发起新评估</h2>
            <p className="mt-1 text-xs text-[#62779a]">选择评估方式与本次需要执行的量表</p>
          </div>
        </div>
        <span className="ui-badge">默认常规综合评估包</span>
      </div>
      <div className="ui-panel-body space-y-5">
        {/* 随访对比复评（docx §2(3)）：有已出报告的既往会话才出现；选中即隐藏其他选择 */}
        {followup && (
          <label className="ui-choice">
            <input
              type="radio"
              name="followup"
              value="1"
              checked={mode === "followup"}
              onChange={() => setMode("followup")}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 font-bold">
                <IconHistory size={16} stroke={2} aria-hidden="true" />
                按上次评估内容复评
              </span>
              <span className="mt-0.5 block text-xs font-normal text-[#7f94b3]">
                随访对比评估：复用 {followup.dateLabel} 的 {followup.scaleCount} 个量表
              </span>
            </span>
          </label>
        )}

        {mode !== "followup" && (
          <>
            {/* 预设套餐（docx §2(1) 常规综合评估 + §2(2) 系统预设套餐 A–D） */}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {packages.map((pkg) => (
                <label key={pkg.key} className="ui-choice">
                  <input
                    type="radio"
                    name="package"
                    value={pkg.key}
                    checked={mode === pkg.key}
                    onChange={() => setMode(pkg.key)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold">{pkg.name}</span>
                    <span className="mt-0.5 block text-xs font-normal text-[#7f94b3]">{pkg.description}</span>
                    <span className="mt-0.5 block text-xs font-normal text-[#7f94b3]">
                      {pkg.scaleIds.length} 个量表
                    </span>
                  </span>
                </label>
              ))}
              <label className="ui-choice">
                <input
                  type="radio"
                  name="package"
                  value={CUSTOM_KEY}
                  checked={mode === CUSTOM_KEY}
                  onChange={() => setMode(CUSTOM_KEY)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">自定义组合</span>
                  <span className="mt-0.5 block text-xs font-normal text-[#7f94b3]">
                    临时自定义组合：按分类自由勾选可评分量表
                  </span>
                </span>
              </label>
              {/* 病历智能评估（docx §2）：M10.2 另做，本期入口占位 */}
              <label className="ui-choice opacity-50" title="病历智能评估由 M10.2 接入，本期暂未开放">
                <input type="radio" name="package" value="emr" disabled />
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">病历智能评估</span>
                  <span className="mt-0.5 block text-xs font-normal text-[#7f94b3]">
                    由病历内容智能推荐量表（待接入）
                  </span>
                </span>
              </label>
            </div>

            {/* 临时自定义组合：按 01 表一级分类分组，只列已配判定的可评分量表 */}
            {mode === CUSTOM_KEY && (
              <div className="space-y-4 rounded-2xl border border-[#dbe7f6] p-4">
                {groups.map((group) => (
                  <div key={group.category}>
                    <p className="text-xs font-extrabold tracking-wide text-[#62779a]">{group.category}</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {group.scales.map((scale) => (
                        <label key={scale.id} className="ui-choice text-sm">
                          <input type="checkbox" name={`scale.${scale.id}`} />
                          <span className="min-w-0 flex-1">
                            <span className="block font-bold">{scale.name}</span>
                            <span className="mt-0.5 block text-xs font-normal text-[#7f94b3]">
                              {scale.questionCount} 题
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <p className="text-xs text-[#7f94b3]">仅列出已配置判定规则、可直接评分的量表；请至少勾选一项。</p>
              </div>
            )}
          </>
        )}

        <div className="flex justify-end">
          <button className="ui-button ui-button-primary ui-button-lg" type="submit">
            <IconClipboardText size={19} stroke={2.1} aria-hidden="true" />
            创建评估会话
          </button>
        </div>
      </div>
    </form>
  );
}
