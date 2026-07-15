/**
 * INPUT:  Prisma（采集中的评估会话列表）
 * OUTPUT: 患者端入口页：新患者自助建档，或从列表选择已有评估会话继续
 * POS:    演示动线：患者可自助建档直接开始评估（/patient/register），
 *         也可以选择医生已创建好的会话继续未完成的问询。
 */
import Link from "next/link";
import {
  IconArrowRight,
  IconCalendarClock,
  IconChevronRight,
  IconClipboardHeart,
  IconFileDescription,
  IconHeartRateMonitor,
  IconUserPlus,
} from "@tabler/icons-react";
import { prisma } from "@/lib/db";
import { scaleById } from "@/lib/rules";

export const dynamic = "force-dynamic";

const assessmentSteps = [
  {
    icon: IconUserPlus,
    title: "建立健康档案",
    description: "填写姓名、性别和年龄",
  },
  {
    icon: IconHeartRateMonitor,
    title: "完成健康问询",
    description: "可选择语音或手动作答",
  },
  {
    icon: IconFileDescription,
    title: "查看评估报告",
    description: "了解初步干预建议",
  },
];

export default async function PatientHomePage() {
  const sessions = await prisma.assessmentSession.findMany({
    where: { status: "in_progress" },
    include: { patient: { select: { name: true, gender: true, age: true, code: true } } },
    orderBy: { startedAt: "desc" },
    take: 20,
  });

  return (
    <main className="patient-main flex-1 u-stagger">
      <section className="patient-panel overflow-hidden">
        <div className="grid gap-8 p-6 sm:p-9 lg:grid-cols-[minmax(0,1.12fr)_minmax(290px,0.88fr)] lg:items-center lg:p-12">
          <div>
            <span className="ui-badge">
              <IconHeartRateMonitor size={17} stroke={2.1} aria-hidden="true" />
              患者自助服务
            </span>
            <h1 className="patient-display-title mt-5">从健康档案开始，完成一次安心的评估</h1>
            <p className="patient-display-copy max-w-2xl">
              首次使用可直接建立档案并开始健康问询；已开始的评估也可以在下方继续完成。
            </p>
            <div className="mt-7 flex flex-col items-stretch gap-4 sm:items-start">
              <Link href="/patient/register" className="patient-primary-action w-full sm:w-auto">
                <IconUserPlus size={28} stroke={2.1} aria-hidden="true" />
                新建健康档案
                <IconArrowRight size={25} stroke={2.1} aria-hidden="true" />
              </Link>
              <p className="flex items-center gap-2 text-base font-medium leading-6 text-[#62779a]">
                <IconCalendarClock size={20} stroke={2} className="shrink-0 text-blue-600" aria-hidden="true" />
                只需填写基础信息，即可开始健康评估。
              </p>
            </div>
          </div>

          <aside className="rounded-[20px] border border-blue-100 bg-[#f8fbff] p-5 sm:p-6" aria-label="评估流程">
            <p className="text-sm font-extrabold tracking-[0.12em] text-blue-700">评估流程</p>
            <ol className="mt-5 grid gap-4">
              {assessmentSteps.map(({ icon: Icon, title, description }, index) => (
                <li key={title} className="flex items-center gap-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white text-blue-600 shadow-[0_6px_16px_rgba(33,87,160,0.08)]">
                    <Icon size={23} stroke={1.9} aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-base font-extrabold text-[#173766]">
                      {index + 1}. {title}
                    </span>
                    <span className="mt-1 block text-sm leading-6 text-[#6c83a5]">{description}</span>
                  </span>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      </section>

      {sessions.length === 0 ? (
        <section className="ui-panel-subtle mt-7 flex min-h-36 flex-col items-center justify-center px-6 py-7 text-center sm:flex-row sm:text-left">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white text-blue-600 shadow-[0_6px_16px_rgba(33,87,160,0.08)]">
            <IconClipboardHeart size={25} stroke={1.9} aria-hidden="true" />
          </span>
          <div className="mt-4 sm:mt-0 sm:ml-4">
            <h2 className="text-xl font-extrabold text-[#173766]">当前没有进行中的评估</h2>
            <p className="mt-1 text-base leading-7 text-[#62779a]">点击上方按钮建立健康档案，即可开始。</p>
          </div>
        </section>
      ) : (
        <section className="mt-8">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-bold tracking-[0.08em] text-blue-700">继续评估</p>
              <h2 className="mt-1 text-2xl font-extrabold tracking-[-0.025em] text-[#173766]">已有的评估会话</h2>
            </div>
            <p className="text-sm leading-6 text-[#62779a]">请选择需要继续完成的评估。</p>
          </div>
          <div className="grid gap-4">
            {sessions.map((session) => {
              const scaleNames = (session.scaleIds as string[])
                .map((scaleId) => scaleById.get(scaleId)?.name ?? scaleId)
                .join("、");
              return (
                <Link
                  key={session.id}
                  href={`/patient/sessions/${session.id}`}
                  className="patient-choice group min-h-[112px] justify-between gap-5 p-5 text-left shadow-[0_8px_22px_rgba(33,87,160,0.06)] focus-visible:outline-none"
                >
                  <span className="flex min-w-0 items-center gap-4">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-600 transition duration-200 group-hover:bg-blue-600 group-hover:text-white">
                      <IconClipboardHeart size={25} stroke={1.9} aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-2xl font-extrabold leading-tight text-[#173766]">
                        {session.patient.name}
                        <span className="ml-3 text-base font-semibold text-[#62779a]">
                          {session.patient.gender} · {session.patient.age} 岁
                        </span>
                      </span>
                      <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium leading-6 text-[#62779a]">
                        <span className="font-mono text-[#466187]">{session.patient.code}</span>
                        <span>{scaleNames}</span>
                      </span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-base font-extrabold text-blue-600">
                    <span className="hidden sm:inline">继续评估</span>
                    <IconChevronRight size={23} stroke={2.2} aria-hidden="true" />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
