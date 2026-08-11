/**
 * INPUT:  路由查询参数 patientId、错误提示；Prisma 患者档案
 * OUTPUT: 患者端「自选组合评估」方式页（2026-08-08 设计图·方式四）
 * POS:    患者自助建档第二步·方式四：系统预设套餐 / 机构预设套餐（占位禁用，需甲方定义）/
 *         临时自定义选择。套餐定义见 src/lib/assessment/patient-scale-packages.ts。
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { IconArrowLeft, IconListCheck } from "@tabler/icons-react";
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
    select: { id: true },
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
        <IconArrowLeft size={19} stroke={2} aria-hidden="true" />
        返回方式选择
      </Link>

      <section className="patient-panel overflow-hidden">
        <div className="border-b border-blue-100 bg-[#f8fbff] px-6 py-7 sm:px-9 sm:py-9">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white text-blue-600 shadow-[0_6px_16px_rgba(33,87,160,0.08)]">
              <IconListCheck size={26} stroke={1.9} aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-extrabold tracking-[0.1em] text-blue-700">第二步 · 自选组合评估</p>
              <h1 className="patient-display-title mt-2">自选组合评估</h1>
              <p className="patient-display-copy max-w-2xl">
                可选择预设套餐，或自由勾选评估项目。
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-7 sm:px-9 sm:py-9">
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
