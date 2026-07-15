/**
 * INPUT:  speaking（是否正在播报）、mouthLevel（TTS 音量驱动的口型开合 0～1）、
 *         mode（sdk | fallback，来自服务端能力开关）
 * OUTPUT: DoctorAvatar —— 数字医生形象组件
 * POS:    患者端数字人切换点（AGENTS.md：Avatar 双实现收敛于此）。
 *         fallback = 内置 3D 女医护形象 + 本地口型图层（无外部依赖，保演示）；
 *         sdk = 商用数字人 SDK 挂载位 —— 临时方案：SDK 商务开通后在 SdkAvatar
 *         内接入火山虚拟数字人 Web SDK（挂载容器已就位），当前先渲染降级形象。
 */
"use client";

import Image from "next/image";
import { IconVolume } from "@tabler/icons-react";

/** 形象尺寸档位：md=作答陪伴态；xl=改版后患者大屏的主视觉大数字医生 */
export type AvatarSize = "md" | "xl";

/** 各档位的具体尺寸（外框/播报角标），集中在此便于统一调节 */
const SIZE_STYLE: Record<
  AvatarSize,
  { frame: string; volume: string; volumeIcon: number }
> = {
  md: {
    frame: "size-40 sm:size-44",
    volume: "-left-2 -top-2 size-10 rounded-xl",
    volumeIcon: 20,
  },
  xl: {
    frame: "size-56 sm:size-72",
    volume: "-left-3 -top-3 size-14 rounded-2xl",
    volumeIcon: 28,
  },
};

export function DoctorAvatar({
  speaking,
  mouthLevel,
  mode,
  size = "md",
}: {
  speaking: boolean;
  /** 口型开合程度 0～1（由 TTS 音量驱动，分级平滑，比开/闭硬切更自然） */
  mouthLevel: number;
  mode: "sdk" | "fallback";
  size?: AvatarSize;
}) {
  if (mode === "sdk") {
    return <SdkAvatar speaking={speaking} mouthLevel={mouthLevel} size={size} />;
  }
  return <FallbackAvatar speaking={speaking} mouthLevel={mouthLevel} size={size} />;
}

/** 数字人 SDK 挂载位：SDK 未接入前复用降级形象，容器 id 供后续 SDK 初始化使用 */
function SdkAvatar({ speaking, mouthLevel, size }: { speaking: boolean; mouthLevel: number; size: AvatarSize }) {
  return (
    <div id="digital-human-mount" className="relative">
      {/* TODO(M4/商务)：火山虚拟数字人 SDK 开通后，在此容器内初始化数字人并按
          speaking 驱动口型；在此之前渲染降级形象，保证演示不中断。 */}
      <FallbackAvatar speaking={speaking} mouthLevel={mouthLevel} size={size} />
    </div>
  );
}

/**
 * 内置 3D 医护形象：闭口图作稳定底图，仅在嘴部区域叠加开口图。
 * 口型由 TTS 音频波形驱动（mouthLevel 0～1 分级开合），说话时肖像加细微头部律动，
 * 让静态肖像"活"起来。不上传音频或患者信息，离线缓存命中时同样可用。
 */
function FallbackAvatar({ speaking, mouthLevel, size }: { speaking: boolean; mouthLevel: number; size: AvatarSize }) {
  const s = SIZE_STYLE[size];
  return (
    <div className={`relative grid ${s.frame} place-items-center select-none`} aria-label="3D 女医护数字医生形象">
      {/* 播报时晕开的柔光呼吸；非播报时透明（B 呼吸感，样式见 globals.css .avatar-halo） */}
      <span className="avatar-halo" data-speaking={speaking} aria-hidden="true" />
      {/* data-speaking 触发说话时的头部细微律动（globals.css .digital-doctor-portrait[data-speaking]） */}
      <span
        className="digital-doctor-portrait avatar-core absolute inset-0 overflow-hidden rounded-[28px] border border-[var(--line-strong)] bg-[var(--brand-soft)] shadow-[0_12px_26px_rgb(23_105_232_/_10%)]"
        data-speaking={speaking}
      >
        <Image
          src="/images/digital-doctor/female-doctor-idle.png"
          alt=""
          fill
          preload={size === "xl"}
          sizes={size === "xl" ? "(max-width: 640px) 14rem, 18rem" : "(max-width: 640px) 10rem, 11rem"}
          className="object-cover object-center"
        />
        {/* 只在口鼻下方小区域按音量分级显隐开口图，避免完整人像交替造成面部抖动。 */}
        <Image
          src="/images/digital-doctor/female-doctor-speaking.png"
          alt=""
          fill
          sizes={size === "xl" ? "(max-width: 640px) 14rem, 18rem" : "(max-width: 640px) 10rem, 11rem"}
          className="digital-doctor-mouth-layer object-cover object-center"
          style={{ opacity: mouthLevel }}
        />
      </span>
      {speaking && (
        <span
          className={`absolute ${s.volume} grid place-items-center bg-[var(--brand)] text-white shadow-[0_8px_16px_rgb(23_105_232_/_20%)]`}
        >
          <IconVolume className="animate-pulse" size={s.volumeIcon} stroke={1.9} aria-hidden="true" />
        </span>
      )}
      <span className="sr-only">{speaking ? "3D 女医护数字医生正在播报" : "3D 女医护数字医生等待作答"}</span>
    </div>
  );
}
