/**
 * INPUT:  分区图标、徽章文案、大标题、可选的右侧辅助说明
 * OUTPUT: SectionHead —— 患者报告页各分区统一的卡头结构（徽章 + 标题 + 右侧辅助说明）
 * POS:    报告页排版统一（2026-08-12）：TagsSection / ComparisonSection / PlanSection /
 *         HistorySection / SupplementarySection 共用同一卡头节奏，避免各分区自成样式。
 *         独立成文件而非放在 patient-report.tsx：supplementary-section 是客户端组件，
 *         若从 patient-report 反向引用会形成循环依赖并把服务端数据模块带进客户端包。
 */
import type { ReactNode } from "react";

export function SectionHead({
  icon,
  eyebrow,
  title,
  aside,
}: {
  /** 徽章内图标（16px 左右，与各分区既有徽章一致） */
  icon: ReactNode;
  /** 徽章文案（分区名，如「评估结论」） */
  eyebrow: string;
  /** 分区大标题 */
  title: string;
  /** 右侧辅助说明（可选；文字说明或状态徽章均可） */
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <span className="ui-badge">
          {icon}
          {eyebrow}
        </span>
        <h2 className="mt-3 text-2xl font-bold text-[var(--ink)]">{title}</h2>
      </div>
      {aside && <div className="max-w-md text-sm leading-6 text-[var(--ink-muted)]">{aside}</div>}
    </div>
  );
}
