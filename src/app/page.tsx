/**
 * INPUT:  无
 * OUTPUT: 系统一级入口页，仅提供用户评估入口与医生工作台两个端口
 * POS:    V2.1 信息架构入口；一级页面只负责分流，具体流程与业务内容放到下一级页面。
 */
import Link from "next/link";
import {
  IconArrowRight,
  IconHeartbeat,
  IconStethoscope,
  IconUserHeart,
} from "@tabler/icons-react";

const entrances = [
  {
    href: "/patient",
    icon: IconUserHeart,
    label: "用户评估入口",
  },
  {
    href: "/doctor",
    icon: IconStethoscope,
    label: "医生工作台",
  },
] as const;

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-1 flex-col bg-[#f7faff] px-5 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 text-blue-700">
        <span className="doctor-brand-mark" aria-hidden="true">
          <IconHeartbeat size={23} stroke={2.2} />
        </span>
        <span className="text-sm font-bold tracking-[0.16em]">老年健康智能评估与干预</span>
      </div>

      <section className="mx-auto flex w-full max-w-2xl flex-1 items-center justify-center py-12" aria-label="服务入口">
        <div className="grid w-full gap-5 sm:gap-6">
          {entrances.map(({ href, icon: Icon, label }) => (
            <Link
              key={href}
              href={href}
              className="group flex min-h-28 items-center gap-5 rounded-[24px] border border-blue-100 bg-white px-7 py-6 shadow-[0_18px_45px_rgba(33,87,160,0.08)] transition duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-[0_22px_52px_rgba(23,105,232,0.14)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 sm:px-9"
            >
              <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-600 transition duration-200 group-hover:bg-blue-600 group-hover:text-white">
                <Icon size={29} stroke={1.9} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 text-2xl font-extrabold tracking-[-0.025em] text-[#173766] sm:text-3xl">
                {label}
              </span>
              <IconArrowRight
                size={28}
                stroke={2}
                className="shrink-0 text-blue-600 transition group-hover:translate-x-1"
                aria-hidden="true"
              />
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
