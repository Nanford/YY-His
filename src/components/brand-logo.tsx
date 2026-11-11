/**
 * INPUT:  BRAND.logoSrc（public/brand/tcm-care-logo.webp）
 * OUTPUT: BrandLogo —— 品牌 logo 图形（装饰性，品牌名由旁边的文字承担读屏）
 * POS:    顶栏、首页、报告页眉页脚共用；尺寸由调用方按场景传入。
 */
import { BRAND } from "@/lib/brand";

export function BrandLogo({ size, className }: { size: number; className?: string }) {
  return (
    // 静态小图不走 next/image：无需运行时优化，便携包（standalone）也不依赖 sharp
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={BRAND.logoSrc}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      decoding="async"
      className={className}
    />
  );
}
