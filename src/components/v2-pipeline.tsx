/**
 * INPUT:  无（流程定义来自 V2/Demo_v2更新说明.docx 总体流程）
 * OUTPUT: 患者入口的六步流程卡片
 * POS:    流程概览只作展示，建档从页面主操作进入。2026-11-11 改为序号节点 + 连线 + 居中步骤卡的对称布局。
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
    // 序号节点 + 连线 + 居中步骤卡（.care-stepper，见 assessment-design.css）
    <ol className="care-stepper">
      {steps.map(({ title, icon: Icon }, index) => (
        <li key={title} className="care-stepper-item">
          <span className="care-stepper-node" aria-hidden="true">{index + 1}</span>
          <div className="care-card care-stepper-card">
            <span className="care-icon-chip" aria-hidden="true">
              <Icon />
            </span>
            <strong className="care-card-title">{title}</strong>
          </div>
        </li>
      ))}
    </ol>
  );
}
