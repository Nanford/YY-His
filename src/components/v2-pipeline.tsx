/**
 * INPUT:  无（流程定义来自 V2/Demo_v2更新说明.docx 总体流程）
 * OUTPUT: 患者入口的六步流程卡片
 * POS:    流程概览只作展示，建档从页面主操作进入。2026-11-11 宽屏改一行六步横排。
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
    // 宽屏一行六步，步骤间以细连线串联（.care-steps，见 assessment-design.css）
    <ol className="care-steps">
      {steps.map(({ title, icon: Icon }, index) => (
        <li key={title} className="care-card care-step">
          <span className="flex items-center justify-between gap-2" aria-hidden="true">
            <span className="care-icon-chip">
              <Icon />
            </span>
            <span className="care-step-index">{String(index + 1).padStart(2, "0")}</span>
          </span>
          <strong className="care-card-title">{title}</strong>
        </li>
      ))}
    </ol>
  );
}
