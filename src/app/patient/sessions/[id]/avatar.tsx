/**
 * INPUT:  speaking（是否正在播报）、mode（sdk | fallback，来自服务端能力开关）
 * OUTPUT: DoctorAvatar —— 数字医生形象组件
 * POS:    患者端数字人切换点（AGENTS.md：Avatar 双实现收敛于此）。
 *         fallback = 内置 2D 图标形象（无外部依赖，保演示）；
 *         sdk = 商用数字人 SDK 挂载位 —— 临时方案：SDK 商务开通后在 SdkAvatar
 *         内接入火山虚拟数字人 Web SDK（挂载容器已就位），当前先渲染降级形象。
 */
"use client";

import { IconStethoscope, IconUserHeart, IconVolume } from "@tabler/icons-react";

export function DoctorAvatar({ speaking, mode }: { speaking: boolean; mode: "sdk" | "fallback" }) {
  if (mode === "sdk") {
    return <SdkAvatar speaking={speaking} />;
  }
  return <FallbackAvatar speaking={speaking} />;
}

/** 数字人 SDK 挂载位：SDK 未接入前复用降级形象，容器 id 供后续 SDK 初始化使用 */
function SdkAvatar({ speaking }: { speaking: boolean }) {
  return (
    <div id="digital-human-mount" className="relative">
      {/* TODO(M4/商务)：火山虚拟数字人 SDK 开通后，在此容器内初始化数字人并按
          speaking 驱动口型；在此之前渲染降级形象，保证演示不中断。 */}
      <FallbackAvatar speaking={speaking} />
    </div>
  );
}

/** 内置 2D 医生形象：用统一图标语言提供可离线展示的数字医生占位。 */
function FallbackAvatar({ speaking }: { speaking: boolean }) {
  return (
    <div className="relative grid size-40 place-items-center select-none sm:size-44" aria-label="数字医生形象">
      <span
        className={[
          "absolute inset-0 rounded-[28px] border border-[var(--line-strong)] bg-white shadow-[0_12px_26px_rgb(23_105_232_/_10%)]",
          speaking ? "animate-pulse" : "",
        ].join(" ")}
        aria-hidden="true"
      />
      <span className="relative grid size-24 place-items-center rounded-[24px] bg-[var(--brand-soft)] text-[var(--brand)] sm:size-28">
        <IconUserHeart size={58} stroke={1.35} aria-hidden="true" />
      </span>
      <span className="absolute -right-2 -bottom-2 grid size-12 place-items-center rounded-2xl border border-[var(--line-strong)] bg-white text-[var(--brand)] shadow-[0_8px_16px_rgb(23_105_232_/_12%)]">
        <IconStethoscope size={25} stroke={1.75} aria-hidden="true" />
      </span>
      {speaking && (
        <span className="absolute -left-2 -top-2 grid size-10 place-items-center rounded-xl bg-[var(--brand)] text-white shadow-[0_8px_16px_rgb(23_105_232_/_20%)]">
          <IconVolume className="animate-pulse" size={20} stroke={1.9} aria-hidden="true" />
        </span>
      )}
      <span className="sr-only">{speaking ? "数字医生正在播报" : "数字医生等待作答"}</span>
    </div>
  );
}
