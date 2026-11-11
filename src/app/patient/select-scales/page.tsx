/**
 * INPUT:  路由查询参数 patientId；Prisma 患者档案
 * OUTPUT: 患者自助量表工具选择方式页（常规综合 / 病历智能 / 随访对比 / 自选组合）
 * POS:    患者自助建档第二步入口：第一步完成建档后跳转至此，先选方式，再配置具体量表。
 *         来源：V2/Demo_v2更新说明.docx §2 量表工具选择。2026-11-11 宽屏四卡一行（care-card）。
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, ListTodo, ClipboardList, History, ListChecks } from "lucide-react";
import { prisma } from "@/lib/db";
import { PipelineProgressUpdater } from "@/components/pipeline-progress-updater";
import { PatientPageHeading } from "@/components/patient-page-heading";

export const dynamic = "force-dynamic";

const MODES = [
  {
    key: "routine",
    icon: ListTodo,
    title: "常规综合评估",
    description: "选择门诊、入院或综合评估套餐。",
  },
  {
    key: "emr",
    icon: ClipboardList,
    title: "病历智能评估",
    description: "导入或填写病历，获取评估项目建议。",
  },
  {
    key: "followup",
    icon: History,
    title: "随访对比评估",
    description: "查看上次评估，选择需要复评的项目。",
  },
  {
    key: "custom",
    icon: ListChecks,
    title: "自选组合评估",
    description: "自行勾选量表，或选用已有套餐。",
  },
] as const;

export default async function PatientSelectScalesPage({
  searchParams,
}: PageProps<"/patient/select-scales">) {
  const { patientId } = await searchParams;
  if (!patientId || typeof patientId !== "string") {
    redirect("/patient/register");
  }

  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { id: true },
  });
  if (!patient) notFound();

  return (
    <main className="patient-main flex-1">
      <PipelineProgressUpdater step={2} patientId={patientId} />
      <Link href="/patient" className="ui-button ui-button-quiet -ml-2 mb-6">
        <ArrowLeft size={19} strokeWidth={2} aria-hidden="true" />
        返回评估首页
      </Link>

      <section>
        <PatientPageHeading plain title="选择评估方式" description="选择一种方式，下一步配置本次评估项目。" />
        {/* 宽屏四种方式一行排开，与选择页套餐卡片同一卡片语言 */}
        <div className="care-entry-grid" data-cols="4">
          {MODES.map(({ key, icon: Icon, title, description }) => (
            <Link
              key={key}
              href={`/patient/select-scales/${key}?patientId=${patientId}`}
              className="care-card care-card-link care-entry-card"
            >
              <span className="care-entry-card-top">
                <span className="care-icon-chip" aria-hidden="true">
                  <Icon />
                </span>
                <ArrowRight aria-hidden="true" />
              </span>
              <span className="care-entry-card-foot">
                <span className="care-card-title">{title}</span>
                <span className="care-card-text">{description}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
