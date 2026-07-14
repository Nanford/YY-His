/**
 * INPUT:  speaking（是否正在播报）、mode（sdk | fallback，来自服务端能力开关）
 * OUTPUT: DoctorAvatar —— 数字医生形象组件
 * POS:    患者端数字人切换点（AGENTS.md：Avatar 双实现收敛于此）。
 *         fallback = 内置 2D SVG 形象（无外部依赖，保演示）；
 *         sdk = 商用数字人 SDK 挂载位 —— 临时方案：SDK 商务开通后在 SdkAvatar
 *         内接入火山虚拟数字人 Web SDK（挂载容器已就位），当前先渲染降级形象。
 */
"use client";

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

/** 内置 2D 医生形象：纯 SVG + CSS 动画（说话时口型开合、常态眨眼） */
function FallbackAvatar({ speaking }: { speaking: boolean }) {
  return (
    <div className="flex flex-col items-center select-none">
      <svg viewBox="0 0 200 200" className="w-44 h-44 md:w-56 md:h-56" aria-label="数字医生形象">
        {/* 背景光环：说话时呼吸放大 */}
        <circle cx="100" cy="100" r="92" fill="#1e3a5f" className={speaking ? "avatar-halo" : ""} />
        <circle cx="100" cy="100" r="84" fill="#274b73" />
        {/* 脸 */}
        <circle cx="100" cy="96" r="52" fill="#f5d5b8" />
        {/* 医生帽 */}
        <path d="M52 78 Q100 30 148 78 L148 64 Q100 20 52 64 Z" fill="#e8f4fd" stroke="#bcd9f0" strokeWidth="2" />
        <rect x="92" y="38" width="16" height="6" rx="2" fill="#e05a5a" />
        <rect x="97" y="33" width="6" height="16" rx="2" fill="#e05a5a" />
        {/* 眼睛：CSS 周期眨眼 */}
        <g className="avatar-eyes">
          <circle cx="82" cy="92" r="5.5" fill="#333" />
          <circle cx="118" cy="92" r="5.5" fill="#333" />
        </g>
        {/* 腮红 */}
        <circle cx="72" cy="108" r="7" fill="#f3b8a0" opacity="0.6" />
        <circle cx="128" cy="108" r="7" fill="#f3b8a0" opacity="0.6" />
        {/* 嘴：说话时开合动画，静默时微笑弧线 */}
        {speaking ? (
          <ellipse cx="100" cy="122" rx="10" ry="6" fill="#b0563f" className="avatar-mouth" />
        ) : (
          <path d="M88 120 Q100 130 112 120" stroke="#b0563f" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        )}
        {/* 白大褂领口 */}
        <path d="M56 168 Q100 140 144 168 L144 200 L56 200 Z" fill="#ffffff" />
        <path d="M92 150 L100 162 L108 150" stroke="#94b8d8" strokeWidth="3" fill="none" />
      </svg>
      {/* 普通 style 标签（类名带 avatar- 前缀避免全局冲突），不依赖 styled-jsx */}
      <style>{`
        .avatar-halo {
          transform-origin: 100px 100px;
          animation: halo-breathe 1.6s ease-in-out infinite;
        }
        .avatar-mouth {
          transform-origin: 100px 122px;
          animation: mouth-talk 0.32s ease-in-out infinite alternate;
        }
        .avatar-eyes {
          transform-origin: 100px 92px;
          animation: eyes-blink 4.2s infinite;
        }
        @keyframes halo-breathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.04); }
        }
        @keyframes mouth-talk {
          from { transform: scaleY(0.35); }
          to { transform: scaleY(1); }
        }
        @keyframes eyes-blink {
          0%, 94%, 100% { transform: scaleY(1); }
          96% { transform: scaleY(0.1); }
        }
      `}</style>
    </div>
  );
}
