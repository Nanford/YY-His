/**
 * INPUT:  无
 * OUTPUT: 系统入口页（医生工作台 / 患者评估大屏）+ Demo V2 六步主流程
 * POS:    Demo 双入口导航；流程文案对齐 V2/Demo_v2更新说明.docx 总体流程
 */
import Link from "next/link";
import {
  IconArrowRight,
  IconHeartbeat,
  IconShieldCheck,
  IconStethoscope,
  IconUserHeart,
} from "@tabler/icons-react";
import { V2DemoPipeline } from "@/components/v2-pipeline";

const entrances = [
  {
    href: "/doctor",
    icon: IconStethoscope,
    label: "医生工作台",
    description: "①建档 → ②选量表 → ③代填采集 → ⑤审核干预",
    action: "进入医生工作台",
  },
  {
    href: "/patient",
    icon: IconUserHeart,
    label: "患者评估大屏",
    description: "①自助建档 → ③语音/点选采集 → ④⑥看结论与建议",
    action: "开始健康评估",
  },
];

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col px-5 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8">
        <section className="grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(400px,0.95fr)] lg:items-end">
          <div className="space-y-6 pb-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700">
              <IconShieldCheck size={18} stroke={2} aria-hidden="true" />
              Demo V2 · 医疗信息仅在本地保存
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-blue-700">
                <span className="doctor-brand-mark" aria-hidden="true">
                  <IconHeartbeat size={23} stroke={2.2} />
                </span>
                <span className="text-sm font-bold tracking-[0.16em]">老年健康智能评估与干预</span>
              </div>
              <h1 className="max-w-3xl text-4xl font-extrabold leading-[1.15] tracking-[-0.045em] text-[#102a56] sm:text-5xl">
                按六步主流程
                <span className="block text-blue-600">跑通评估与干预</span>
              </h1>
              <p className="max-w-2xl text-base leading-8 text-[#62779a] sm:text-lg">
                依据《Demo_v2更新说明》：基础信息填写 → 量表工具选择 → 数据采集 → 结果判断 →
                干预匹配 → 干预展示。评分与推荐为确定性规则，大模型只做语言理解。
              </p>
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
                      <span className="block text-lg font-extrabold text-[#173766]">{label}</span>
                      <span className="mt-1 block text-sm leading-6 text-[#6b82a4]">{description}</span>
                      <span className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-blue-700">
                        {action}
                        <IconArrowRight
                          size={16}
                          className="transition group-hover:translate-x-0.5"
                          aria-hidden="true"
                        />
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        <V2DemoPipeline
          current={0}
          links={{
            1: "/doctor/patients/new",
            2: "/doctor",
            3: "/patient",
            4: "/patient",
            5: "/doctor",
            6: "/patient",
          }}
        />
      </div>
    </main>
  );
}
