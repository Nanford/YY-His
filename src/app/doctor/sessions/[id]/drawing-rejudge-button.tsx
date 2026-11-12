/**
 * INPUT:  所属重新评分表单的提交状态
 * OUTPUT: AI 重新评分按钮及处理中提示
 * POS:    追溯页的最小客户端边界；提交期间禁用按钮，避免重复发起看图请求。
 */
"use client";

import { useFormStatus } from "react-dom";
import { LoaderCircle, RefreshCw } from "lucide-react";

export function DrawingRejudgeButton() {
  const { pending } = useFormStatus();
  const Icon = pending ? LoaderCircle : RefreshCw;
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className="ui-button ui-button-primary text-sm">
      <Icon size={16} className={pending ? "animate-spin" : undefined} aria-hidden="true" />
      {pending ? "AI 正在评分…" : "AI 重新评分"}
    </button>
  );
}
