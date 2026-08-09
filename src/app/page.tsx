/**
 * INPUT:  浏览器 localStorage 中的流程解锁进度
 * OUTPUT: 系统入口页（医生工作台 / 患者评估大屏）+ Demo V2 六步主流程导航
 * POS:    流程导航按顺序解锁：仅已完成步骤及下一步可点，未解锁步骤锁定展示。
 *         来源：V2/Demo_v2更新说明.docx 总体流程
 */
"use client";

import { useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  IconArrowRight,
  IconHeartbeat,
  IconLock,
  IconShieldCheck,
  IconStethoscope,
  IconUserHeart,
} from "@tabler/icons-react";
import { V2DemoPipeline } from "@/components/v2-pipeline";
import { getUnlockedStep } from "@/lib/pipeline-progress";

const entrances = [
  {
    href: "/doctor",
    icon: IconStethoscope,
    label: "医生工作台",
    description: "患者建档、量表选择、结果审核与干预方案确认",
  },
  {
    href: "/patient",
    icon: IconUserHeart,
    label: "患者评估大屏",
    description: "自助建档、健康问询与评估报告查看",
  },
];

export default function HomePage() {
  const subscribe = useCallback((callback: () => void) => {
    const handler = () => callback();
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);
  const unlockedStep = useSyncExternalStore(subscribe, () => getUnlockedStep(), () => 1);

  return (
    <main className="flex flex-1 flex-col px-5 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8">
        <section className="grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] lg:items-end">
          <div className="space-y-6 pb-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700">
              <IconShieldCheck size={18} stroke={2} aria-hidden="true" />
              医疗信息本地安全保存
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-blue-700">
                <span className="doctor-brand-mark" aria-hidden="true">
                  <IconHeartbeat size={23} stroke={2.2} />
                </span>
                <span className="text-sm font-bold tracking-[0.16em]">老年健康智能评估与干预</span>
              </div>
              <h1 className="max-w-3xl text-4xl font-extrabold leading-[1.15] tracking-[-0.045em] text-[#102a56] sm:text-5xl">
                标准化采集
                <span className="block text-blue-600">个体化评估与干预</span>
              </h1>
              <p className="max-w-2xl text-base leading-8 text-[#62779a] sm:text-lg">
                完成基础信息与量表采集后，系统自动生成评估结论，并推荐运动、膳食、中医食养与就诊等干预建议，供医生审核确认。
              </p>
            </div>
          </div>

          <div className="ui-panel overflow-hidden p-2 sm:p-3">
            <div className="rounded-[14px] border border-blue-100 bg-[#f8fbff] p-5 sm:p-6">
              <p className="page-eyebrow">选择服务入口</p>
              <h2 className="mt-1 text-xl font-extrabold tracking-[-0.025em] text-[#102a56]">从这里开始</h2>
              <div className="mt-4 grid gap-3">
                {entrances.map(({ href, icon: Icon, label, description }) => (
                  <Link
                    key={href}
                    href={href}
                    className="group flex items-center gap-3 rounded-xl border border-blue-100 bg-white p-3.5 transition duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-[0_12px_24px_rgba(23,105,232,0.10)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600 transition duration-200 group-hover:bg-blue-600 group-hover:text-white">
                      <Icon size={22} stroke={1.9} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-extrabold text-[#173766]">{label}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-[#6b82a4]">{description}</span>
                    </span>
                    <span className="shrink-0 text-sm font-bold text-blue-700">
                      <IconArrowRight
                        size={18}
                        className="transition group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="ui-panel p-5 sm:p-7">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="page-eyebrow">服务流程</p>
              <h2 className="mt-1 text-xl font-extrabold tracking-[-0.02em] text-[#102a56]">按顺序完成六步评估</h2>
              <p className="mt-1.5 text-sm text-[#62779a]">
                {unlockedStep === 1
                  ? "完成上一步后，下一步自动解锁；当前仅可进入第一步。"
                  : `已完成前 ${unlockedStep} 步，可继续进入下一步；未解锁步骤将在完成后开放。`}
              </p>
            </div>
            <span className="ui-badge">共 6 步</span>
          </div>

          <V2DemoPipeline current={0} unlockedStep={unlockedStep} showHeader={false} />

          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/patient/register"
              className="ui-button ui-button-primary ui-button-lg w-full sm:w-auto"
            >
              开始第一步：填写基础信息
              <IconArrowRight size={20} stroke={2.2} aria-hidden="true" />
            </Link>
            {unlockedStep === 1 && (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#8ba0bd]">
                <IconLock size={15} stroke={2.2} aria-hidden="true" />
                后续步骤将在完成本步后解锁
              </span>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
