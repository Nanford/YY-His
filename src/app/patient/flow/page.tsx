/**
 * INPUT:  无（静态展示页）
 * OUTPUT: 患者入口第二层：Demo V2 六步主流程展示
 * POS:    v2.1 两层展示（来源：v2.1修改思路.pptx 第1~3页）：首页（第一层）只保留服务入口，
 *         六步流程说明独立为本页；流程导航来源：V2/Demo_v2更新说明.docx 总体流程。
 *         2026-08-09 用户拍板：六步横向统一排版、无解锁/锁定之分、不可点击、仅展示。
 *         2026-09-15（修改.docx ②）：本页删除除六步名称以外的全部文字（页头标题/说明/
 *         共 6 步徽标/步骤描述/返回链接），「开始第一步：填写基础信息」按钮改为「开始」。
 */
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { V2DemoPipeline } from "@/components/v2-pipeline";

export default function PatientFlowPage() {
  return (
    <main className="patient-main flex flex-1 flex-col justify-center">
      <section className="w-full">
        {/* 六步统一展示：unlockedStep=6 无锁定态、不传 links 不可点击、hideDescriptions 只留编号+步骤名；
            flow-pipeline-lg 适老化放大 */}
        <div className="flow-pipeline-lg">
          <V2DemoPipeline current={0} unlockedStep={6} showHeader={false} hideDescriptions />
        </div>

        <div className="mt-12 flex justify-center">
          <Link href="/patient/register" className="patient-primary-action w-full sm:w-auto">
            开始
            <ArrowRight size={30} strokeWidth={2.2} aria-hidden="true" />
          </Link>
        </div>
      </section>
    </main>
  );
}
