/**
 * INPUT:  路由查询参数 patientId、错误提示；Prisma 患者档案
 * OUTPUT: 患者端「常规综合评估」配置页（2026-08-08 设计图·方式一）
 * POS:    患者自助建档第二步·方式一：预设套餐（标准包/门诊简版/住院入院）+ 按一级分类分组的
 *         量表配置（可增减）。套餐定义见 src/lib/assessment/patient-scale-packages.ts。
 */
import Link from "next/link";
import { PatientPageHeading } from "@/components/patient-page-heading";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ListTodo } from "lucide-react";
import { startAssessment } from "@/lib/actions/patient";
import { prisma } from "@/lib/db";
import { firstQueryValue } from "@/lib/query";
import { scaleById } from "@/lib/rules";
import {
  ROUTINE_PACKAGES,
  estimateMinutes,
  groupScalesByCategory,
} from "@/lib/assessment/patient-scale-packages";
import { SCALE_LABELS, SCALE_SUBTITLES, needsClinicianAssist } from "@/lib/assessment/scale-selection";
import RoutineForm, { type RoutinePackageOption } from "./routine-form";

export const dynamic = "force-dynamic";

export default async function PatientRoutineScalesPage({
  searchParams,
}: PageProps<"/patient/select-scales/routine">) {
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

  // 服务端预分组：套餐量表按 01 表一级分类分组（保持文档顺序），附适老化标签与医护协助提示
  const packageOptions: RoutinePackageOption[] = ROUTINE_PACKAGES.map((pkg) => ({
    key: pkg.key,
    name: pkg.name,
    description: pkg.description,
    scene: pkg.scene ?? "综合评估",
    recommended: pkg.key === "outpatient", // 2026-09-14 用户拍板：门诊简版为默认推荐/默认选中
    scaleIds: pkg.scaleIds,
    minutes: estimateMinutes(pkg.scaleIds),
    groups: groupScalesByCategory(pkg.scaleIds).map((group) => ({
      category: group.category,
      scales: group.scaleIds.map((scaleId) => {
        const scale = scaleById.get(scaleId);
        return {
          id: scaleId,
          label: SCALE_LABELS[scaleId] ?? scaleId,
          subtitle: SCALE_SUBTITLES[scaleId] ?? "",
          needsAssist: scale ? needsClinicianAssist(scale.questions) : false,
        };
      }),
    })),
  }));

  return (
    <main className="patient-main flex-1">
      <Link
        href={`/patient/select-scales?patientId=${patientId}`}
        className="ui-button ui-button-quiet -ml-2 mb-6"
      >
        <ArrowLeft size={19} strokeWidth={2} aria-hidden="true" />
        返回方式选择
      </Link>

      <section className="patient-panel overflow-hidden">
        <PatientPageHeading
          icon={<ListTodo className="size-6" />}
          title="常规综合评估"
          description="请选择评估套餐，确认后开始评估。"
        />

        <div className="px-6 py-7 sm:px-9">
          <RoutineForm
            packages={packageOptions}
            error={error}
            action={startAssessment.bind(null, patientId)}
          />
        </div>
      </section>
    </main>
  );
}
