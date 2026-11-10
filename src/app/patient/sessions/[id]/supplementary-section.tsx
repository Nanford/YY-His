/**
 * INPUT: 当前会话、尚未完成的量表、是否在提交出错时展开
 * OUTPUT: 患者报告的补充评估入口与量表卡片
 * POS: 只提交尚未完成的项目，既往报告与复评权限由服务端校验。
 */
"use client";

import { useState } from "react";
import { ChevronUp, ClipboardPlus } from "lucide-react";
import { AssessmentSubmitBar, ScaleOption } from "@/components/assessment-selection";
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

  if (!open) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-accent/45 p-4 sm:p-5">
        <span className="text-sm text-muted-foreground">{remainingScales.length} 个项目可补充</span>
        <Button type="button" onClick={() => setOpen(true)} className="min-h-11 gap-2 px-4 font-bold">
          <ClipboardPlus aria-hidden="true" /> 补充评估
        </Button>
      </section>
    );
  }

  return (
    <section className="patient-panel space-y-4 px-4 py-5 sm:px-6">
      <SectionHead
        icon={<ClipboardPlus size={16} aria-hidden="true" />}
        title="选择补充评估项目"
        aside={
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} className="min-h-10 gap-1 px-2">
            <ChevronUp aria-hidden="true" /> 收起
          </Button>
        }
      />
      <p className="text-sm text-muted-foreground">如需复评已完成的项目，请联系医生。</p>
      <form action={createSupplementarySession.bind(null, sessionId)} className="space-y-4">
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
              onChange={(event) => {
                const checked = event.target.checked;
                setSelected((previous) => {
                  const next = new Set(previous);
                  if (checked) next.add(scale.id);
                  else next.delete(scale.id);
                  return next;
                });
              }}
            />
          ))}
        </div>
        <AssessmentSubmitBar count={selected.size} label="开始补充评估" />
      </form>
    </section>
  );
}
