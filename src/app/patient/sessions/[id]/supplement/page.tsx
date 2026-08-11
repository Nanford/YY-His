/**
 * INPUT:  源评估会话 id、患者会话 cookie、同患者历史会话与 V2 量表配置
 * OUTPUT: 独立的补充评估项目选择页
 * POS:    V2.1 报告操作分层；报告页只保留入口，本页完成补充项目选择与新会话创建。
 */
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCheck,
  IconClipboardPlus,
  IconPlus,
  IconStethoscope,
} from "@tabler/icons-react";
import { createSupplementarySession } from "@/lib/actions/patient";
import {
  checkSupplementaryGuard,
  completedScaleIds,
  scaleNeedsClinician,
} from "@/lib/assessment/supplementary";
import { PATIENT_SESSION_COOKIE } from "@/lib/assessment/patient-intake";
import { prisma } from "@/lib/db";
import { firstQueryValue } from "@/lib/query";
import { scales } from "@/lib/rules";

export const dynamic = "force-dynamic";

interface SupplementPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string | string[] }>;
}

export default async function SupplementPage({ params, searchParams }: SupplementPageProps) {
  const { id } = await params;
  const error = firstQueryValue((await searchParams).error);
  const source = await prisma.assessmentSession.findUnique({
    where: { id },
    select: { patientId: true, status: true },
  });
  if (!source) notFound();

  // 补充评估沿用 Server Action 的归属与报告状态校验，避免仅靠页面隐藏造成越权。
  const cookieSessionId = (await cookies()).get(PATIENT_SESSION_COOKIE)?.value ?? null;
  const cookieSession = cookieSessionId
    ? await prisma.assessmentSession.findUnique({
        where: { id: cookieSessionId },
        select: { patientId: true },
      })
    : null;
  const guard = checkSupplementaryGuard(cookieSession?.patientId ?? null, source);
  if (!guard.ok) {
    if (guard.reason === "forbidden") redirect("/patient");
    redirect(`/patient/sessions/${id}`);
  }

  const siblings = await prisma.assessmentSession.findMany({
    where: { patientId: source.patientId },
    select: { status: true, scaleIds: true, startedAt: true },
  });
  const done = completedScaleIds(
    siblings.map((session) => ({
      status: session.status,
      scaleIds: session.scaleIds as string[],
      startedAt: session.startedAt,
    }))
  );
  const remainingScales = scales
    .filter((scale) => !done.has(scale.id))
    .map((scale) => ({
      id: scale.id,
      name: scale.name,
      needsClinician: scaleNeedsClinician(scale.id),
    }));

  return (
    <main className="patient-main flex-1">
      <Link href={`/patient/sessions/${id}`} className="ui-button ui-button-quiet -ml-2 mb-6">
        <IconArrowLeft size={19} stroke={2} aria-hidden="true" />
        返回评估报告
      </Link>

      <section className="patient-panel px-6 py-7 md:px-8">
        <span className="ui-badge">
          <IconClipboardPlus size={16} stroke={1.8} aria-hidden="true" />
          补充评估
        </span>
        <h1 className="mt-3 text-2xl font-extrabold text-[var(--ink)] sm:text-3xl">选择补充评估项目</h1>

        {error === "scales" && (
          <div className="ui-alert ui-alert-danger mt-5 text-lg" role="alert">
            <IconAlertTriangle size={23} stroke={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>请至少勾选一项评估内容。</span>
          </div>
        )}
        {error === "repeat" && (
          <div className="ui-alert ui-alert-danger mt-5 text-lg" role="alert">
            <IconAlertTriangle size={23} stroke={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>所选项目已经完成；复评请由医生在工作台发起。</span>
          </div>
        )}
        {error === "not_reported" && (
          <div className="ui-alert ui-alert-danger mt-5 text-lg" role="alert">
            <IconAlertTriangle size={23} stroke={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>当前评估尚未生成报告，暂不能发起补充评估。</span>
          </div>
        )}

        {remainingScales.length === 0 ? (
          <div className="ui-alert mt-6">
            <IconCheck size={21} stroke={2} aria-hidden="true" />
            <p>暂无可补充评估的项目。</p>
          </div>
        ) : (
          <form action={createSupplementarySession.bind(null, id)} className="mt-6 space-y-6">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {remainingScales.map((scale) => (
                <label key={scale.id} className="patient-check">
                  <input type="checkbox" name="scaleIds" value={scale.id} />
                  <span className="min-w-0">
                    <span className="block text-lg font-extrabold leading-tight text-[var(--ink)]">{scale.name}</span>
                    <span
                      className={`mt-2 flex items-start gap-1.5 text-sm font-semibold leading-6 ${
                        scale.needsClinician ? "text-[var(--warning)]" : "text-[var(--success)]"
                      }`}
                    >
                      {scale.needsClinician ? (
                        <IconStethoscope size={17} stroke={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                      ) : (
                        <IconCheck size={17} stroke={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                      )}
                      <span>{scale.needsClinician ? "含医护查看项，先出部分计分报告" : "可直接生成评估报告"}</span>
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <button type="submit" className="patient-primary-action w-full justify-center sm:w-auto">
              <IconPlus size={26} stroke={2} aria-hidden="true" />
              <span>开始补充评估</span>
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
