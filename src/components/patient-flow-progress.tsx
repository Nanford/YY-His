/**
 * INPUT:  当前步骤 current（1～6）
 * OUTPUT: 患者端页面顶部的六步主流程进度条（无标题区、无描述，仅步骤轨）
 * POS:    2026-08-08 设计口径：患者流程每一页顶部都展示六步进度——
 *         基础信息填写 → 量表工具选择 → 数据采集 → 结果判断 → 干预匹配与决策 → 干预内容展示。
 *         建档/量表选择/问询/报告各页统一嵌入，步骤高亮随页面推进。
 */
import { V2DemoPipeline, type V2PipelineStep } from "@/components/v2-pipeline";

export function PatientFlowProgress({ current }: { current: V2PipelineStep }) {
  return (
    <div className="mb-6 rounded-2xl border border-blue-100 bg-white px-5 py-4 shadow-[0_4px_14px_rgba(33,87,160,0.05)]">
      <V2DemoPipeline current={current} showHeader={false} hideDescriptions />
    </div>
  );
}
