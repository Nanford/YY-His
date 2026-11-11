/**
 * INPUT:  分区标题、可选的右侧辅助说明
 * OUTPUT: 患者报告的统一分区标题
 * POS:    报告页排版统一（2026-08-12）：ComparisonSection / PlanSection / SupplementarySection
 *         共用同一标题节奏，避免各分区自成样式。
 *         2026-11-11 视觉精修：改为与「基本情况/既存问题/综合评估结果」同款的平铺标题
 *         （标题 + 细分割线，样式 .care-report-section-head 在 assessment-design.css），
 *         去掉图标方块与大一号字，整页只有一种分区标题。
 *         独立成文件而非放在 patient-report.tsx：supplementary-section 是客户端组件，
 *         若从 patient-report 反向引用会形成循环依赖并把服务端数据模块带进客户端包。
 */
import type { ReactNode } from "react";

export function SectionHead({
  title,
  aside,
}: {
  /** 分区标题 */
  title: string;
  /** 右侧辅助说明（可选；文字说明、状态徽章或按钮均可），位于分割线右端 */
  aside?: ReactNode;
}) {
  return (
    <div className="care-report-section-head">
      <h2>{title}</h2>
      {aside && <div className="care-report-section-aside">{aside}</div>}
    </div>
  );
}
