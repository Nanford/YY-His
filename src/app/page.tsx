/**
 * INPUT:  无
 * OUTPUT: 系统入口页（医生工作台 / 患者评估大屏）
 * POS:    Demo 的双入口导航；医生和患者可按各自角色直接进入对应流程
 */
import Link from "next/link";
import { IconArrowRight, IconHeartbeat, IconShieldCheck, IconStethoscope, IconUserHeart } from "@tabler/icons-react";

const entrances = [
  {
    href: "/doctor",
    icon: IconStethoscope,
    label: "医生工作台",
    description: "患者建档、评估管理与干预方案审核",
    action: "进入医生工作台",
  },
  {
    href: "/patient",
    icon: IconUserHeart,
    label: "患者评估大屏",
    description: "自助建档、数字医生问询与报告查看",
    action: "开始健康评估",
  },
];

export default function HomePage() {
  return (
    <main className="flex flex-1 items-center px-5 py-10 sm:px-8">
      <section className="mx-auto grid w-full max-w-6xl gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)] lg:items-end">
        <div className="space-y-7 pb-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700">
            <IconShieldCheck size={18} stroke={2} aria-hidden="true" />
            医疗信息仅在本地安全保存
          </div>
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-blue-700">
              <span className="doctor-brand-mark" aria-hidden="true">
                <IconHeartbeat size={23} stroke={2.2} />
              </span>
              <span className="text-sm font-bold tracking-[0.16em]">HEALTHCARE INTELLIGENCE</span>
            </div>
            <h1 className="max-w-3xl text-4xl font-extrabold leading-[1.18] tracking-[-0.045em] text-[#102a56] sm:text-5xl">
              老年健康智能评估
              <span className="block text-blue-600">与干预系统</span>
            </h1>
            <p className="max-w-2xl text-base leading-8 text-[#62779a] sm:text-lg">
              通过标准化采集、确定性评估与个体化干预建议，帮助每一次照护判断更清晰、更可追溯。
            </p>
          </div>
          <div className="grid max-w-xl gap-3 text-sm text-[#58739a] sm:grid-cols-2">
            <div className="flex items-center gap-3 rounded-2xl border border-blue-100 bg-white px-4 py-3 shadow-[0_8px_22px_rgba(33,87,160,0.06)]">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600">
                <IconShieldCheck size={18} aria-hidden="true" />
              </span>
              PII 本地化存储
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-blue-100 bg-white px-4 py-3 shadow-[0_8px_22px_rgba(33,87,160,0.06)]">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600">
                <IconHeartbeat size={18} aria-hidden="true" />
              </span>
              评估结果全程可追溯
            </div>
          </div>
        </div>

        <div className="ui-panel overflow-hidden p-2 sm:p-3">
          <div className="rounded-[14px] border border-blue-100 bg-[#f8fbff] p-5 sm:p-7">
            <p className="page-eyebrow">选择服务入口</p>
            <h2 className="mt-1 text-2xl font-extrabold tracking-[-0.025em] text-[#102a56]">从这里开始</h2>
            <div className="mt-6 grid gap-3">
              {entrances.map(({ href, icon: Icon, label, description, action }) => (
                <Link
                  key={href}
                  href={href}
                  className="group flex items-center gap-4 rounded-2xl border border-blue-100 bg-white p-4 transition duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-[0_12px_24px_rgba(23,105,232,0.10)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200"
                >
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-600 transition duration-200 group-hover:bg-blue-600 group-hover:text-white">
                    <Icon size={25} stroke={1.9} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-extrabold text-[#173766]">{label}</span>
                    <span className="mt-1 block text-sm leading-6 text-[#6c83a5]">{description}</span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-sm font-bold text-blue-600">
                    <span className="hidden sm:inline">{action}</span>
                    <IconArrowRight size={18} aria-hidden="true" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
