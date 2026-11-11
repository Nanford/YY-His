/**
 * INPUT:  无（静态展示页）
 * OUTPUT: 患者入口第二层：Demo V2 六步主流程展示
 * POS:    v2.1 两层展示（来源：v2.1修改思路.pptx 第1~3页）：首页（第一层）只保留服务入口，
 *         六步流程说明独立为本页；流程导航来源：V2/Demo_v2更新说明.docx 总体流程。
 *         2026-08-09 用户拍板：六步横向统一排版、无解锁/锁定之分、不可点击、仅展示。
 *         2026-09-15（修改.docx ②）：本页删除除六步名称以外的全部文字（页头标题/说明/
 *         共 6 步徽标/步骤描述/返回链接），「开始第一步：填写基础信息」按钮改为「开始」。
 *         2026-11-11 参考用户提供的工作台样稿：六步分两阶段对称排布，下方蓝色启动区（仅一行标题 + 按钮）。
 */
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { V2DemoPipeline } from "@/components/v2-pipeline";

export default function PatientFlowPage() {
  return (
    <main className="patient-main flex flex-1 flex-col justify-center">
      <section className="care-flow" aria-label="评估流程">
        <V2DemoPipeline />
        {/* 启动区：整页唯一的视觉重点，一行标题 + 主按钮 */}
        <div className="care-flow-start">
          <h1>开始健康评估</h1>
          <Link href="/patient/register" className="care-flow-start-button">
            开始
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </section>
    </main>
  );
}
