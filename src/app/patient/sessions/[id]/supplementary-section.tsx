/**
 * INPUT:  当前会话 ID、尚未完成的量表列表、是否默认展开（提交报错回跳时）
 * OUTPUT: 补充评估两层入口（v2.1）：第一层仅「补充评估」大按钮，点击展开第二层量表勾选清单
 * POS:    患者报告页底部；只列"尚未完成的量表"（复评需医生在工作台发起），勾选提交走
 *         Server Action createSupplementarySession（独立新会话，不影响本次报告）。
 *         来源：V2.0 §3 补充评估；v2.1修改思路.pptx 第10~12页（补充评估分 2 层展示）。
 */
"use client";

import { useState } from "react";
import {
  IconCheck,
  IconChevronUp,
  IconClipboardPlus,
  IconPlus,
  IconStethoscope,
} from "@tabler/icons-react";
import { createSupplementarySession } from "@/lib/actions/patient";
import type { RemainingScale } from "./patient-report";
import { SectionHead } from "./section-head";

export function SupplementarySection({
  sessionId,
  remainingScales,
  defaultOpen = false,
}: {
  sessionId: string;
  remainingScales: RemainingScale[];
  /** 提交报错回跳（?error=…）时默认展开第二层，让患者直接看到勾选清单 */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // 第一层：仅「补充评估」入口按钮，保持报告页简洁（v2.1 第11页）
  if (!open) {
    return (
      <section className="patient-panel px-6 py-7 md:px-8">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="patient-primary-action w-full sm:w-auto"
        >
          <IconClipboardPlus size={26} stroke={2} aria-hidden="true" />
          <span>补充评估</span>
        </button>
      </section>
    );
  }

  // 第二层：量表勾选清单（v2.1 第12页）；卡头与报告页其他分区同一结构（SectionHead）
  return (
    <section className="patient-panel px-6 py-7 md:px-8">
      <SectionHead
        icon={<IconClipboardPlus size={16} stroke={1.8} aria-hidden="true" />}
        eyebrow="补充评估"
        title="还想评估更多项目？"
        aside="勾选后点下方大按钮即可开始新一轮问答；本次报告和历史记录都会保留，互不影响。如需重新评估已完成的项目，请医生在工作台为您发起。"
      />
      <form action={createSupplementarySession.bind(null, sessionId)} className="mt-6 space-y-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {remainingScales.map((scale) => (
            <label key={scale.id} className="patient-check">
              <input type="checkbox" name="scaleIds" value={scale.id} />
              <span className="min-w-0">
                <span className="block text-lg font-extrabold leading-tight text-[var(--ink)]">{scale.name}</span>
                <span
                  className={`mt-2 flex items-start gap-1.5 text-sm font-semibold leading-6 ${
                    scale.needsClinician ? "text-[var(--warning)]" : "text-[var(--success)]"
                  }`}
                >
                  {scale.needsClinician ? (
                    <IconStethoscope size={17} stroke={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <IconCheck size={17} stroke={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                  )}
                  <span>
                    {scale.needsClinician
                      ? "含舌象、测量等需医生查看的项，这些题暂不计分，答完先出部分计分报告"
                      : "可当场生成评估报告"}
                  </span>
                </span>
              </span>
            </label>
          ))}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button type="submit" className="patient-primary-action w-full sm:w-auto">
            <IconPlus size={26} stroke={2} aria-hidden="true" />
            <span>开始补充评估</span>
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ui-button ui-button-quiet self-center"
          >
            <IconChevronUp size={19} stroke={2} aria-hidden="true" />
            收起
          </button>
        </div>
      </form>
    </section>
  );
}
