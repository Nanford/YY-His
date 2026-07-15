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

/** 形象尺寸档位：md=作答陪伴态；xl=改版后患者大屏的主视觉大数字医生 */
export type AvatarSize = "md" | "xl";

/** 各档位的具体尺寸（外框/内圈/主图标/听诊器角标/播报角标），集中在此便于统一调节 */
const SIZE_STYLE: Record<
  AvatarSize,
  { frame: string; inner: string; icon: number; steth: string; stethIcon: number; volume: string; volumeIcon: number }
> = {
  md: {
    frame: "size-40 sm:size-44",
    inner: "size-24 rounded-[24px] sm:size-28",
    icon: 58,
    steth: "-right-2 -bottom-2 size-12 rounded-2xl",
    stethIcon: 25,
    volume: "-left-2 -top-2 size-10 rounded-xl",
    volumeIcon: 20,
  },
  xl: {
    frame: "size-56 sm:size-72",
    inner: "size-36 rounded-[32px] sm:size-44",
    icon: 96,
    steth: "-right-3 -bottom-3 size-16 rounded-3xl",
    stethIcon: 34,
    volume: "-left-3 -top-3 size-14 rounded-2xl",
    volumeIcon: 28,
  },
};

export function DoctorAvatar({
  speaking,
  mode,
  size = "md",
}: {
  speaking: boolean;
  mode: "sdk" | "fallback";
  size?: AvatarSize;
}) {
  if (mode === "sdk") {
    return <SdkAvatar speaking={speaking} size={size} />;
  }
  return <FallbackAvatar speaking={speaking} size={size} />;
}

/** 数字人 SDK 挂载位：SDK 未接入前复用降级形象，容器 id 供后续 SDK 初始化使用 */
function SdkAvatar({ speaking, size }: { speaking: boolean; size: AvatarSize }) {
  return (
    <div id="digital-human-mount" className="relative">
      {/* TODO(M4/商务)：火山虚拟数字人 SDK 开通后，在此容器内初始化数字人并按
          speaking 驱动口型；在此之前渲染降级形象，保证演示不中断。 */}
      <FallbackAvatar speaking={speaking} size={size} />
    </div>
  );
}

/** 内置 2D 医生形象：用统一图标语言提供可离线展示的数字医生占位。 */
function FallbackAvatar({ speaking, size }: { speaking: boolean; size: AvatarSize }) {
  const s = SIZE_STYLE[size];
  return (
    <div className={`relative grid ${s.frame} place-items-center select-none`} aria-label="数字医生形象">
      {/* 播报时晕开的柔光呼吸；非播报时透明（B 呼吸感，样式见 globals.css .avatar-halo） */}
      <span className="avatar-halo" data-speaking={speaking} aria-hidden="true" />
      <span
        className="absolute inset-0 rounded-[28px] border border-[var(--line-strong)] bg-white shadow-[0_12px_26px_rgb(23_105_232_/_10%)]"
        aria-hidden="true"
      />
      {/* 内圈常驻极缓呼吸，让形象"活着"（.avatar-core） */}
      <span
        className={`avatar-core relative grid ${s.inner} place-items-center bg-[var(--brand-soft)] text-[var(--brand)]`}
      >
        <IconUserHeart size={s.icon} stroke={1.35} aria-hidden="true" />
      </span>
      <span
        className={`absolute ${s.steth} grid place-items-center border border-[var(--line-strong)] bg-white text-[var(--brand)] shadow-[0_8px_16px_rgb(23_105_232_/_12%)]`}
      >
        <IconStethoscope size={s.stethIcon} stroke={1.75} aria-hidden="true" />
      </span>
      {speaking && (
        <span
          className={`absolute ${s.volume} grid place-items-center bg-[var(--brand)] text-white shadow-[0_8px_16px_rgb(23_105_232_/_20%)]`}
        >
          <IconVolume className="animate-pulse" size={s.volumeIcon} stroke={1.9} aria-hidden="true" />
        </span>
      )}
      <span className="sr-only">{speaking ? "数字医生正在播报" : "数字医生等待作答"}</span>
    </div>
  );
}
