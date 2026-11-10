/**
 * INPUT:  无（流程定义来自 V2/Demo_v2更新说明.docx 总体流程）
 * OUTPUT: 患者入口的六步流程卡片
 * POS:    流程概览只作展示，建档从页面主操作进入。
 */
import { ClipboardCheck, ClipboardList, FileText, HeartHandshake, MessageCircle, UserRoundPlus } from "lucide-react";

const steps = [
  { title: "基础信息填写", icon: UserRoundPlus },
  { title: "量表工具选择", icon: ClipboardList },
  { title: "数据采集", icon: MessageCircle },
  { title: "结果判断", icon: ClipboardCheck },
  { title: "干预匹配与决策", icon: HeartHandshake },
  { title: "干预内容展示", icon: FileText },
];

export function V2DemoPipeline() {
  return (
    <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
      {steps.map(({ title, icon: Icon }, index) => (
        <li key={title} className="flex min-h-32 flex-col justify-between gap-3 rounded-2xl border border-border bg-card p-4 sm:min-h-36 sm:p-5">
          <span className="flex items-center justify-between gap-2" aria-hidden="true">
            <span className="grid size-10 place-items-center rounded-xl bg-accent text-primary">
              <Icon className="size-5" />
            </span>
            <span className="font-mono text-lg font-bold text-primary/70">{String(index + 1).padStart(2, "0")}</span>
          </span>
          <strong className="text-base text-foreground sm:text-xl">{title}</strong>
        </li>
      ))}
    </ol>
  );
}
