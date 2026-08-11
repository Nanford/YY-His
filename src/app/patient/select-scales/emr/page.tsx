/**
 * INPUT:  路由查询参数 patientId、错误提示；Prisma 患者档案
 * OUTPUT: 患者端「病历智能评估」方式页（2026-08-08 设计图·方式二）
 * POS:    患者自助建档第二步·方式二：粘贴病历与诊断，系统推荐评估项目（LLM/规则兜底，出网前脱敏）。
 *         引擎见 src/lib/assessment/emr-scale-suggest.ts，API 见 /api/patient/emr-suggest。
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { IconArrowLeft, IconClipboardText } from "@tabler/icons-react";
import { startAssessment } from "@/lib/actions/patient";
import { prisma } from "@/lib/db";
import { firstQueryValue } from "@/lib/query";
import { SCORABLE_SCALE_IDS } from "@/lib/assessment/scale-packages";
import { EMR_SUPPLEMENT_POOL } from "@/lib/assessment/emr-scale-suggest";
import { SCALE_LABELS, SCALE_SUBTITLES } from "@/lib/assessment/scale-selection";
import EmrForm, { type EmrScaleItem } from "./emr-form";

export const dynamic = "force-dynamic";

export default async function PatientEmrScalesPage({
  searchParams,
}: PageProps<"/patient/select-scales/emr">) {
  const params = await searchParams;
  const { patientId } = params;
  const error = firstQueryValue(params.error) ?? null;
  if (!patientId || typeof patientId !== "string") {
    redirect("/patient/register");
  }

  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { id: true },
  });
  if (!patient) notFound();

  // 可评分量表目录（适老化标签），供推荐结果渲染名称
  const catalog: EmrScaleItem[] = SCORABLE_SCALE_IDS.map((id) => ({
    id,
    label: SCALE_LABELS[id] ?? id,
    subtitle: SCALE_SUBTITLES[id] ?? "",
  }));

  return (
    <main className="patient-main flex-1">
      <Link
        href={`/patient/select-scales?patientId=${patientId}`}
        className="ui-button ui-button-quiet -ml-2 mb-6"
      >
        <IconArrowLeft size={19} stroke={2} aria-hidden="true" />
        返回方式选择
      </Link>

      <section className="patient-panel overflow-hidden">
        <div className="border-b border-blue-100 bg-[#f8fbff] px-6 py-7 sm:px-9 sm:py-9">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white text-blue-600 shadow-[0_6px_16px_rgba(33,87,160,0.08)]">
              <IconClipboardText size={26} stroke={1.9} aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-extrabold tracking-[0.1em] text-blue-700">第二步 · 病历智能评估</p>
              <h1 className="patient-display-title mt-2">病历智能评估</h1>
              <p className="patient-display-copy max-w-2xl">
                粘贴病历或上传文件，系统自动推荐评估项目。
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-7 sm:px-9 sm:py-9">
          <EmrForm
            patientId={patientId}
            catalog={catalog}
            supplementIds={EMR_SUPPLEMENT_POOL}
            error={error}
            action={startAssessment.bind(null, patientId)}
          />
        </div>
      </section>
    </main>
  );
}
