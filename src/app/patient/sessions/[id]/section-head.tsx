/**
 * INPUT:  分区图标、标题、可选的右侧辅助说明
 * OUTPUT: 患者报告的统一分区标题
 * POS:    报告页排版统一（2026-08-12）：TagsSection / ComparisonSection / PlanSection /
 *         HistorySection / SupplementarySection 共用同一卡头节奏，避免各分区自成样式。
 *         独立成文件而非放在 patient-report.tsx：supplementary-section 是客户端组件，
 *         若从 patient-report 反向引用会形成循环依赖并把服务端数据模块带进客户端包。
 */
import type { ReactNode } from "react";

export function SectionHead({
  icon,
  title,
  aside,
}: {
  icon: ReactNode;
  /** 分区大标题 */
  title: string;
  /** 右侧辅助说明（可选；文字说明或状态徽章均可） */
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-3 text-xl font-bold text-foreground sm:text-2xl">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-primary" aria-hidden="true">
          {icon}
        </span>
        {title}
      </h2>
      {aside && <div className="max-w-md text-sm leading-6 text-[var(--ink-muted)]">{aside}</div>}
    </div>
  );
}
