/**
 * INPUT:  无（流程定义来自 V2/Demo_v2更新说明.docx 总体流程）
 * OUTPUT: 患者入口的六步流程卡片（采集 / 决策两阶段，各三步）
 * POS:    流程概览只作展示，建档从页面主操作进入。2026-11-11 改为两阶段各三步的对称分组（.care-flow-*）。
 */
import { Fragment } from "react";
import {
  ChevronRight, ClipboardCheck, ClipboardList, FileText, HeartHandshake, MessageCircle, UserRoundPlus,
} from "lucide-react";

// 六步按"采集 / 决策"两个阶段各三步分组，左右对称（参考用户提供的工作台样稿，去掉其多余说明文字）
const phases = [
  {
    label: "采集阶段",
    steps: [
      { title: "基础信息填写", icon: UserRoundPlus },
      { title: "量表工具选择", icon: ClipboardList },
      { title: "数据采集", icon: MessageCircle },
    ],
  },
  {
    label: "决策阶段",
    steps: [
      { title: "结果判断", icon: ClipboardCheck },
      { title: "干预匹配与决策", icon: HeartHandshake },
      { title: "干预内容展示", icon: FileText },
    ],
  },
] as const;

export function V2DemoPipeline() {
  return (
    <div className="care-flow-phases">
      {phases.map((phase, phaseIndex) => {
        const offset = phaseIndex * 3;
        return (
          <Fragment key={phase.label}>
            {phaseIndex > 0 && (
              <span className="care-flow-bridge" aria-hidden="true">
                <ChevronRight />
              </span>
            )}
            <section className="care-band care-flow-phase" aria-label={phase.label}>
              <p className="care-flow-phase-label">
                {phase.label}
                <span>{offset + 1}–{offset + 3}</span>
              </p>
              <ol className="care-flow-steps" start={offset + 1}>
                {phase.steps.map(({ title, icon: Icon }, index) => (
                  <li key={title} className="care-card care-flow-step">
                    <span className="care-flow-step-index" aria-hidden="true">{offset + index + 1}</span>
                    <span className="care-icon-chip" aria-hidden="true">
                      <Icon />
                    </span>
                    <strong className="care-card-title">{title}</strong>
                  </li>
                ))}
              </ol>
            </section>
          </Fragment>
        );
      })}
    </div>
  );
}
