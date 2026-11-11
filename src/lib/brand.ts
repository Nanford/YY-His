/**
 * INPUT:  无（2026-11-11 用户确定的系统品牌，来源：项目建设方案封面）
 * OUTPUT: BRAND —— 品牌名、英文代号、中英文全称与 logo 路径
 * POS:    全站品牌文案的唯一来源：首页主视觉、患者/医生端顶栏、报告页眉页脚均引用此处。
 *         例外：根布局 src/app/layout.tsx 的 metadata 为同文案字面量（该文件另有未提交改动，
 *         本次只改了标题两行；后续可改为引用本常量）。浏览器标签图标为 src/app/favicon.ico 与 apple-icon.png。
 */
export const BRAND = {
  name: "岐颐智护",
  code: "TCM-CARE",
  fullNameZh: "中西医结合老年综合评估与个体化干预智能辅助系统",
  fullNameEn:
    "Traditional Chinese Medicine–Integrated Closed-loop Assessment, Recommendation and Evaluation for Older Adults",
  // 用户提供的 logo（透明底），裁边后导出 512px WebP
  logoSrc: "/brand/tcm-care-logo.webp",
} as const;
