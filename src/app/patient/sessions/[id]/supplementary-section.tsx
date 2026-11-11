/**
 * INPUT: 当前会话、尚未完成的量表、是否在提交出错时展开
 * OUTPUT: 患者报告的补充评估入口与量表卡片
 * POS: 只提交尚未完成的项目，既往报告与复评权限由服务端校验。
 *      2026-11-11 视觉精修：收起态与「本次评估项目」「历史评估报告」折叠条同款（白底细边、同高同内边距），
 *      展开态改为与报告其他分区同款的平铺分区（SectionHead 标题 + 细分割线），不再自成卡片面板。
 */
"use client";

import { useState } from "react";
import { ChevronUp, ClipboardPlus } from "lucide-react";
import { AssessmentBulkActions, AssessmentSubmitBar, ScaleOption, updateAssessmentSelection } from "@/components/assessment-selection";
import { Button } from "@/components/ui/button";
import { createSupplementarySession } from "@/lib/actions/patient";
import type { RemainingScale } from "./patient-report";
import { SectionHead } from "./section-head";

export function SupplementarySection({ sessionId, remainingScales, defaultOpen = false }: {
  sessionId: string;
  remainingScales: RemainingScale[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const toggle = (ids: readonly string[], on: boolean) =>
    setSelected((prev) => updateAssessmentSelection(prev, ids, on));

  if (!open) {
    return (
      // 与 SectionDisclosure 收起条同一外形：min-h-14、px-4/sm:px-5，左标题右操作，三条折叠入口等高对齐
      <section className="flex min-h-14 flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-2 sm:px-5">
        <span className="font-semibold text-foreground">{remainingScales.length} 个项目可补充</span>
        <Button type="button" onClick={() => setOpen(true)} className="min-h-10 gap-2 px-4 font-bold">
          <ClipboardPlus aria-hidden="true" /> 补充评估
        </Button>
      </section>
    );
  }

  return (
    <section className="care-report-section space-y-4">
      <SectionHead
        title="选择补充评估项目"
        aside={
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} className="min-h-10 gap-1 px-2">
            <ChevronUp aria-hidden="true" /> 收起
          </Button>
        }
      />
      <p className="text-sm text-muted-foreground">如需复评已完成的项目，请联系医生。</p>
      <form action={createSupplementarySession.bind(null, sessionId)} className="space-y-4">
        <AssessmentBulkActions ids={remainingScales.map((scale) => scale.id)} selected={selected} onChange={toggle} />
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {remainingScales.map((scale) => (
            <ScaleOption
              key={scale.id}
              name="scaleIds"
              value={scale.id}
              title={scale.name}
              needsAssist={scale.needsClinician}
              showDetails
              checked={selected.has(scale.id)}
              onChange={(event) => toggle([scale.id], event.target.checked)}
            />
          ))}
        </div>
        <AssessmentSubmitBar count={selected.size} label="开始补充评估" />
      </form>
    </section>
  );
}
