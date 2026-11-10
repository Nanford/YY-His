/**
 * INPUT:  路由查询参数 patientId、错误提示；Prisma 患者档案
 * OUTPUT: 患者端「自选组合评估」方式页（2026-08-08 设计图·方式四）
 * POS:    患者自助建档第二步·方式四：系统预设套餐 / 机构预设套餐（占位禁用，需甲方定义）/
 *         临时自定义选择。套餐定义见 src/lib/assessment/patient-scale-packages.ts。
 */
import Link from "next/link";
import { PatientPageHeading } from "@/components/patient-page-heading";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ListChecks } from "lucide-react";
import { startAssessment } from "@/lib/actions/patient";
import { prisma } from "@/lib/db";
import { firstQueryValue } from "@/lib/query";
import { SCORABLE_SCALE_IDS } from "@/lib/assessment/scale-packages";
import {
  CUSTOM_PRESET_PACKAGES,
  askableQuestionCount,
  groupScalesByCategory,
} from "@/lib/assessment/patient-scale-packages";
import { SCALE_LABELS, SCALE_SUBTITLES } from "@/lib/assessment/scale-selection";
import CustomForm, { type CustomGroup, type CustomPackageOption } from "./custom-form";

export const dynamic = "force-dynamic";

export default async function PatientCustomScalesPage({
  searchParams,
}: PageProps<"/patient/select-scales/custom">) {
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

  const toItem = (id: string) => ({
    id,
    label: SCALE_LABELS[id] ?? id,
    subtitle: SCALE_SUBTITLES[id] ?? "",
  });

  const packages: CustomPackageOption[] = CUSTOM_PRESET_PACKAGES.map((pkg) => ({
    key: pkg.key,
    name: pkg.name,
    description: pkg.description,
    scales: pkg.scaleIds.map(toItem),
  }));

  const customGroups: CustomGroup[] = groupScalesByCategory(SCORABLE_SCALE_IDS).map((group) => ({
    category: group.category,
    scales: group.scaleIds.map(toItem),
  }));

  const askableCounts: Record<string, number> = {};
  for (const id of SCORABLE_SCALE_IDS) {
    askableCounts[id] = askableQuestionCount(id);
  }

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
          icon={<ListChecks className="size-6" />}
          title="自选组合评估"
          description="可选择预设套餐，或自由勾选评估项目。"
        />

        <div className="px-6 py-7 sm:px-9">
          <CustomForm
            packages={packages}
            customGroups={customGroups}
            askableCounts={askableCounts}
            error={error}
            action={startAssessment.bind(null, patientId)}
          />
        </div>
      </section>
    </main>
  );
}
