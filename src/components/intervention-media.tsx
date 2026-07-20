/**
 * INPUT:  单个干预项的素材信息（类型/路径/是否就绪/文字要点/名称/原始文件名）
 * OUTPUT: 运动视频卡（缺失或播放失败回退文字要点）、膳食/中医食养图片卡（支持放大查看，缺失标记"素材待补齐"）
 * POS:    干预展示的客户端媒体组件，医生端与患者端复用。视频/图片的播放失败与素材缺失回退逻辑
 *         收敛在此（来源：需求更新说明 V2.0 §5.1 视频回退文字、§5.2 图片放大与"素材待补齐"）。
 */
"use client";
import { useState } from "react";
import { IconVideoOff, IconZoomIn, IconX, IconPhotoOff } from "@tabler/icons-react";

/** 运动视频卡：视频就绪则播放，未就绪/播放失败回退文字动作要点（文字要点始终展示，作为正文与兜底） */
export function InterventionVideo({
  src,
  available,
  text,
}: {
  src: string;
  available: boolean;
  text: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const showVideo = available && !failed;

  return (
    <div className="space-y-3">
      {showVideo ? (
        <video
          className="aspect-video w-full rounded-xl bg-black"
          controls
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
        >
          <source src={src} type="video/mp4" />
        </video>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-[var(--line-strong,#bcd4f5)] bg-[var(--brand-soft,#f1f6ff)] px-4 py-3 text-sm font-semibold text-[var(--ink-muted,#5b7196)]">
          <IconVideoOff size={18} aria-hidden="true" />
          <span>{failed ? "视频暂时无法播放，请参考下方动作要点" : "视频教程待上线，请先参考下方动作要点"}</span>
        </div>
      )}
      {text && (
        <p className="whitespace-pre-wrap text-base leading-7 text-[var(--ink-muted,#4b668e)]">{text}</p>
      )}
    </div>
  );
}

/** 膳食/中医食养图片卡：完整未裁切展示，点击放大；素材缺失明确标记"素材待补齐"，禁止用其他图片替代 */
export function InterventionImage({
  src,
  available,
  name,
  sourceFile,
  showSourceFile = false,
}: {
  src: string;
  available: boolean;
  name: string;
  sourceFile: string | null;
  /** 医生端在同一视图显示图片原始文件名（§5.2） */
  showSourceFile?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  // 同名 WebP 派生图（convert-rules 生成，体积约为 PNG 一半）：<picture> 优先取用，不支持时回退 src 的 PNG
  const webpSrc = src.replace(/\.png(\?.*)?$/, ".webp$1");

  if (!available || failed) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-[#f0b8b8] bg-[#fff5f5] px-4 py-3 text-sm font-semibold text-[#b4322f]">
        <IconPhotoOff size={18} aria-hidden="true" />
        <span>该项图文教程素材待补齐（不以其他干预图片替代）</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setZoomed(true)}
        className="group relative block w-full overflow-hidden rounded-xl border border-[var(--line,#dbe7f6)]"
        aria-label={`放大查看「${name}」图文教程`}
      >
        {/* loading=lazy：首屏只加载可视区图片，带宽受限服务器减负；内容不变（同源 WebP/PNG 双格式） */}
        <picture>
          <source srcSet={webpSrc} type="image/webp" />
          <img
            src={src}
            alt={`${name}图文教程`}
            onError={() => setFailed(true)}
            loading="lazy"
            decoding="async"
            className="w-full"
          />
        </picture>
        <span className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-lg bg-black/55 px-2.5 py-1 text-xs font-bold text-white opacity-90">
          <IconZoomIn size={14} aria-hidden="true" />
          放大查看
        </span>
      </button>
      {showSourceFile && sourceFile && (
        <p className="text-xs text-[var(--ink-faint,#6b82a4)]">图片文件：{sourceFile}</p>
      )}

      {zoomed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${name}图文教程（放大）`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setZoomed(false)}
        >
          <picture>
            <source srcSet={webpSrc} type="image/webp" />
            <img src={src} alt={`${name}图文教程`} className="max-h-full max-w-full rounded-lg" />
          </picture>
          <button
            type="button"
            onClick={() => setZoomed(false)}
            className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-xl bg-white/95 px-3 py-2 text-sm font-bold text-[#173766] shadow"
          >
            <IconX size={16} aria-hidden="true" />
            关闭
          </button>
        </div>
      )}
    </div>
  );
}
