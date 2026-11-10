/**
 * INPUT: 折叠区标题、可选摘要和正文
 * OUTPUT: 可用键盘展开的内容区
 * POS: 建档与报告共用，收起时保留已填写的表单值。
 */
"use client";

import { useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export function SectionDisclosure({
  title,
  summary,
  children,
  defaultOpen = false,
}: {
  title: string;
  summary?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      onInvalidCapture={() => {
        // 校验失败时先展开，浏览器才能将焦点移到无效字段。
        if (!open) flushSync(() => setOpen(true));
      }}
      className="rounded-xl border border-border bg-card"
    >
      <CollapsibleTrigger className="group flex min-h-14 w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left font-semibold text-foreground hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:px-5">
        <span>{title}</span>
        <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
          {summary && <span className="text-sm font-medium">{summary}</span>}
          <ChevronDown className="size-5 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
        </span>
      </CollapsibleTrigger>
      {/* 不卸载字段，收起后仍能随表单提交，也保留再次展开时的输入。 */}
      <CollapsibleContent forceMount className="border-t border-border px-4 py-5 data-[state=closed]:hidden sm:px-5">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
