/**
 * INPUT:  路由查询参数 patientId、错误提示；Prisma 患者档案
 * OUTPUT: 患者端「病历智能评估」方式页（2026-08-08 设计图·方式二）
 * POS:    患者自助建档第二步·方式二：粘贴病历与诊断，系统推荐评估项目（LLM/规则兜底，出网前脱敏）。
 *         引擎见 src/lib/assessment/emr-scale-suggest.ts，API 见 /api/patient/emr-suggest。
 */
import Link from "next/link";
import { PatientPageHeading } from "@/components/patient-page-heading";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ClipboardList } from "lucide-react";
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
    select: { name: true, gender: true, age: true },
  });
  if (!patient) notFound();

  // 可评分量表目录（适老化标签），供推荐结果渲染名称
  const catalog: EmrScaleItem[] = SCORABLE_SCALE_IDS.map((id) => ({
    id,
    label: SCALE_LABELS[id] ?? id,
    subtitle: SCALE_SUBTITLES[id] ?? "",
  }));

  return (
    <main className="patient-main assessment-page flex-1">
      <Link
        href={`/patient/select-scales?patientId=${patientId}`}
        className="ui-button ui-button-quiet -ml-2 mb-6"
      >
        <ArrowLeft size={19} strokeWidth={2} aria-hidden="true" />
        返回方式选择
      </Link>

      <section>
        <PatientPageHeading
          plain
          icon={<ClipboardList className="size-6" />}
          title="病历智能评估"
          description="粘贴病历或上传文件，系统自动推荐评估项目。"
        />

        <div>
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
