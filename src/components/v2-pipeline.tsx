/**
 * INPUT:  当前高亮步骤 current（1～6）、可选 compact / 链接
 * OUTPUT: V2DemoPipeline —— Demo_v2 六步主流程导航/进度条
 * POS:    来源：V2/Demo_v2更新说明.docx 总体流程
 *         基础信息填写 → 量表工具选择 → 数据采集 → 结果判断 → 干预匹配 → 干预展示
 *         医患两端共用，统一产品叙事与信息架构。
 */
import Link from "next/link";

export const V2_PIPELINE_STEPS = [
  {
    step: 1,
    key: "intake",
    title: "基础信息填写",
    short: "建档",
    description: "基本情况、疾病用药、人体测量",
  },
  {
    step: 2,
    key: "scales",
    title: "量表工具选择",
    short: "选量表",
    description: "常规 / 病历智能 / 随访 / 自选组合",
  },
  {
    step: 3,
    key: "collect",
    title: "数据采集",
    short: "采集",
    description: "语音、点选、数字、画钟；系统读取不重复问",
  },
  {
    step: 4,
    key: "score",
    title: "结果判断",
    short: "判定",
    description: "确定性计分，生成评估标签与编码",
  },
  {
    step: 5,
    key: "match",
    title: "干预匹配",
    short: "匹配",
    description: "按规则匹配，五大类各取前 1～2 项",
  },
  {
    step: 6,
    key: "show",
    title: "干预展示",
    short: "展示",
    description: "先看结论，再看干预建议与教程",
  },
] as const;

export type V2PipelineStep = (typeof V2_PIPELINE_STEPS)[number]["step"];

interface Props {
  /** 当前所在步骤 1～6；0 表示总览不高亮 */
  current?: number;
  /** 紧凑模式（顶栏/侧栏） */
  compact?: boolean;
  /** 步骤可点击跳转（仅演示入口页） */
  links?: Partial<Record<V2PipelineStep, string>>;
  className?: string;
}

export function V2DemoPipeline({ current = 0, compact = false, links, className = "" }: Props) {
  return (
    <nav
      aria-label="评估与干预主流程"
      className={[
        "v2-pipeline",
        compact ? "v2-pipeline-compact" : "v2-pipeline-full",
        className,
      ].join(" ")}
    >
      {!compact && (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="page-eyebrow">服务流程</p>
            <h2 className="mt-1 text-lg font-extrabold tracking-[-0.02em] text-[#102a56]">
              基础信息 → 量表选择 → 采集 → 判定 → 匹配 → 展示
            </h2>
          </div>
          <span className="ui-badge">共 6 步</span>
        </div>
      )}
      <ol className="v2-pipeline-track">
        {V2_PIPELINE_STEPS.map((item, index) => {
          const state =
            current === 0 ? "idle" : item.step < current ? "done" : item.step === current ? "current" : "todo";
          const href = links?.[item.step];
          const body = (
            <>
              <span className="v2-pipeline-index" aria-hidden="true">
                {state === "done" ? "✓" : item.step}
              </span>
              <span className="v2-pipeline-copy">
                <span className="v2-pipeline-title">{compact ? item.short : item.title}</span>
                {!compact && <span className="v2-pipeline-desc">{item.description}</span>}
              </span>
            </>
          );
          return (
            <li key={item.key} className={`v2-pipeline-item v2-pipeline-${state}`}>
              {href ? (
                <Link href={href} className="v2-pipeline-card">
                  {body}
                </Link>
              ) : (
                <div className="v2-pipeline-card">{body}</div>
              )}
              {index < V2_PIPELINE_STEPS.length - 1 && (
                <span className="v2-pipeline-connector" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
