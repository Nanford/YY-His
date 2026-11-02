/**
 * INPUT:  无（静态入口页）
 * OUTPUT: 系统入口页第一层（用户评估入口 / 医生工作台）
 * POS:    v2.1 两层展示（来源：v2.1修改思路.pptx 第1~3页）：首页只保留服务入口，
 *         六步流程说明移至第二层 /patient/flow；患者由此进入，医生直接进工作台。
 *         2026-08-09 适老化重排：居中单栏、大字号、大按钮、大点击区域。
 *         2026-09-15（修改.docx ①）：首页删除除「老年健康智能评估与干预」与两个
 *         入口名以外的全部文字（徽标/主标语/说明段/入口副标题），保持极简风。
 */
import Link from "next/link";
import { IconArrowRight, IconHeartbeat, IconStethoscope, IconUserHeart } from "@tabler/icons-react";

const entrances = [
  {
    href: "/patient/flow",
    icon: IconUserHeart,
    label: "用户评估入口",
  },
  {
    href: "/doctor",
    icon: IconStethoscope,
    label: "医生工作台",
  },
];

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col px-5 py-10 sm:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center text-center">
        <div className="flex items-center gap-3 text-blue-700">
          <span className="doctor-brand-mark" aria-hidden="true">
            <IconHeartbeat size={26} stroke={2.2} />
          </span>
          <span className="text-lg font-bold tracking-[0.16em]">老年健康智能评估与干预</span>
        </div>

        <div className="mt-14 grid w-full gap-5">
          {entrances.map(({ href, icon: Icon, label }) => (
            <Link
              key={href}
              href={href}
              className="group flex items-center gap-5 rounded-3xl border-2 border-blue-100 bg-white px-7 py-8 text-left shadow-[0_10px_28px_rgba(23,105,232,0.08)] transition duration-200 hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-[0_16px_36px_rgba(23,105,232,0.14)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200"
            >
              <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-600 transition duration-200 group-hover:bg-blue-600 group-hover:text-white">
                <Icon size={34} stroke={1.9} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 text-2xl font-extrabold text-[#173766] sm:text-3xl">{label}</span>
              <span className="shrink-0 text-blue-600">
                <IconArrowRight
                  size={30}
                  stroke={2.2}
                  className="transition group-hover:translate-x-1"
                  aria-hidden="true"
                />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
