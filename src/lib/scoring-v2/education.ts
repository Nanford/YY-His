/**
 * INPUT:  Patient.education 枚举值（src/lib/assessment/patient-intake.ts EDUCATION_LEVELS）
 * OUTPUT: 文化程度 → thresholdByEducation 四档阈值 key 的映射
 * POS:    独立零依赖模块，评分引擎（threshold-by-education.ts）与转换脚本
 *         （scripts/convert-rules-v2.ts 校验段）双侧引用同一映射，避免漂移。
 *         来源：02 表 MMSE 判定规则——文盲 / 小学（≤6年）/ 初中·高中·技校·中专 / 大专及以上 四档。
 */

/** thresholdByEducation 的四档文化程度 key（与 judgments-v2.json educationThresholds 对应） */
export type EducationBand = "illiterate" | "primary" | "secondary" | "college";

/** Patient.education 枚举值 → 四档 key；「初中」「高中中专技校」同属 secondary 档（02 表"初中/高中/技校/中专"一档） */
export const EDUCATION_BANDS: Record<string, EducationBand> = {
  文盲: "illiterate",
  小学: "primary",
  初中: "secondary",
  高中中专技校: "secondary",
  大专及以上: "college",
};

/** 文化程度 → 四档 key；未填写或非枚举值 → null（调用方按"无法判定"处理） */
export function educationBandOf(education: string | null | undefined): EducationBand | null {
  if (!education) return null;
  return EDUCATION_BANDS[education.trim()] ?? null;
}
