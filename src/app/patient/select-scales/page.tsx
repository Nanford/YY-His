/**
 * INPUT:  路由查询参数 patientId；Prisma 患者档案
 * OUTPUT: 患者自助量表工具选择方式页（常规综合 / 病历智能 / 随访对比 / 自选组合）
 * POS:    患者自助建档第二步入口：第一步完成建档后跳转至此，先选方式，再配置具体量表。
 *         来源：V2/Demo_v2更新说明.docx §2 量表工具选择。
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  IconArrowLeft,
  IconArrowRight,
  IconChecklist,
  IconClipboardText,
  IconHistory,
  IconListCheck,
} from "@tabler/icons-react";
import { prisma } from "@/lib/db";
import { PipelineProgressUpdater } from "@/components/pipeline-progress-updater";

export const dynamic = "force-dynamic";

const MODES = [
  {
    key: "routine",
    icon: IconChecklist,
    title: "（一）常规综合评估",
    description: "使用系统预设的常规量表包开展综合评估。",
  },
  {
    key: "emr",
    icon: IconClipboardText,
    title: "（二）病历智能评估",
    description: "粘贴病历和诊断信息，由系统推荐适合的评估项目。",
  },
  {
    key: "followup",
    icon: IconHistory,
    title: "（三）随访对比评估",
    description: "调取既往评估内容，只评需要更新的项目。",
  },
  {
    key: "custom",
    icon: IconListCheck,
    title: "（四）自选组合评估",
    description: "按实际需求自由选择量表，或使用系统/机构预设套餐。",
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
        <IconArrowLeft size={19} stroke={2} aria-hidden="true" />
        返回评估首页
      </Link>

      <section className="patient-panel overflow-hidden">
        <div className="border-b border-blue-100 bg-[#f8fbff] px-6 py-7 sm:px-9 sm:py-9">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white text-blue-600 shadow-[0_6px_16px_rgba(33,87,160,0.08)]">
              <IconChecklist size={26} stroke={1.9} aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-extrabold tracking-[0.1em] text-blue-700">第二步 · 选择评估内容</p>
              <h1 className="patient-display-title mt-2">量表工具选择</h1>
              <p className="patient-display-copy max-w-2xl">
                请选择本次评估的进入方式。
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-7 sm:px-9 sm:py-9">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {MODES.map(({ key, icon: Icon, title, description }) => (
              <Link
                key={key}
                href={`/patient/select-scales/${key}?patientId=${patientId}`}
                className="group flex flex-col rounded-2xl border border-blue-100 bg-white p-6 transition duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-[0_12px_24px_rgba(23,105,232,0.10)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200"
              >
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-blue-50 text-blue-600 transition duration-200 group-hover:bg-blue-600 group-hover:text-white">
                  <Icon size={28} stroke={1.9} aria-hidden="true" />
                </span>
                <span className="mt-4 text-lg font-extrabold text-[#173766]">{title}</span>
                <span className="mt-1 text-sm leading-6 text-[#62779a]">{description}</span>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-blue-700">
                  进入该方式
                  <IconArrowRight size={16} className="transition group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
