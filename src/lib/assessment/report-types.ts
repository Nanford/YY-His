/**
 * INPUT:  无（纯类型定义）
 * OUTPUT: 评估结果/干预方案落库快照的形状（AssessmentResult.tags、InterventionPlan.candidates 的 JSON 契约）
 * POS:    M9-B 装机后的快照类型收口。评分引擎 V2 原生输出见 src/lib/scoring-v2/types.ts，
 *         本文件的 AssessmentTag 是面向报告页的"标签视图"（在 V2 标签编码之外保留旧报告的
 *         level 徽章语义：从 02 表标签名「气虚质：倾向是」拆出 base/level）。
 */

/** 判定级别。V2 中医体质标签名带「是/否/倾向是/基本是」后缀，其余量表标签恒为"是"。 */
export type TagLevel = "是" | "否" | "倾向是" | "基本是";

/** 单题得分明细，供医生端标签下钻追溯（自 scoring-v2 的 ItemScoreDetail 投影） */
export interface QuestionScoreDetail {
  questionId: string;
  no: string;
  title: string;
  /** 患者/医生给出的原始分值 */
  rawScore: number;
  /** 参与判定的有效分值；反向计分题与 rawScore 不同。 */
  effectiveScore: number;
  /** 是否反向计分。 */
  reversed: boolean;
}

/** 一条评估标签及其可追溯的得分依据（AssessmentResult.tags 的元素形状） */
export interface AssessmentTag {
  /** 标签展示名（中医体质为去掉「：级别」后缀的体质名，其余为 02 表标签名原文） */
  tag: string;
  level: TagLevel;
  /** 02 表结果标签编码（干预推荐查矩阵、医生审核同类替换复算积分用） */
  code: string;
  scaleId: string;
  /** 判定所依据的得分：量表总分；中医体质为该体质转化分（保留 1 位小数） */
  score: number;
  detail: QuestionScoreDetail[];
}

/**
 * 解析 02 表中医体质标签的展示名与级别。
 * 来源：02 表「平和质/偏颇体质：是、否、倾向是、基本是」标签名。
 * 仅用于报告快照展示，不参与评分或标签判定。
 */
export function splitTagName(name: string): { tag: string; level: TagLevel } {
  const levels: TagLevel[] = ["倾向是", "基本是", "否", "是"];
  for (const level of levels) {
    const suffix = `：${level}`;
    if (name.endsWith(suffix)) return { tag: name.slice(0, -suffix.length), level };
  }
  return { tag: name, level: "是" };
}

/**
 * 明确的报告关注语义：只服务于医患两端的排序和视觉提示，不改变 02 表医学判定、标签编码或推荐积分。
 * 使用稳定的 02 表标签编码而不是展示名称，避免同义词、否定词和语言文案变化造成误排。
 */
const ATTENTION_TAG_CODES = new Set([
  "ADL_DEPENDENCE_MILD", "ADL_DEPENDENCE_MODERATE", "ADL_DEPENDENCE_SEVERE",
  "IADL_DEPENDENCE_MILD", "IADL_DEPENDENCE_MODERATE", "IADL_DEPENDENCE_SEVERE",
  "MOTOR_SCREEN_POSITIVE", "SPPB_MODERATE", "SPPB_POOR",
  "VISION_LOW", "VISION_BLIND", "VISION_TOTAL_BLINDNESS",
  "VISUAL_FUNCTION_IMPAIRED", "VISUAL_FUNCTION_POOR",
  "VISUAL_DIFFICULTY_DAILY_ACTIVITY", "VISUAL_FIELD_DEFECT_SYMPTOM", "VISUAL_DISTORTION_SYMPTOM",
  "HEARING_DECLINE", "HEARING_IMPAIRMENT", "HEARING_TOTAL_LOSS", "WHISPER_TEST_POSITIVE",
  "COGNITIVE_BRIEF_SCREEN_POSITIVE", "MMSE_COGNITIVE_DECLINE", "MMSE_UNABLE_TO_COMPLETE",
  "DEPRESSION_2Q_POSITIVE", "GDS15_MODERATE_DEPRESSION", "GDS15_SEVERE_DEPRESSION",
  "ANXIETY_2Q_POSITIVE", "GAD7_MODERATE_ANXIETY", "GAD7_SEVERE_ANXIETY",
  "LUBBEN_SUPPORT_FAIR", "LUBBEN_SUPPORT_POOR",
  "HOME_PATHWAY_OBSTRUCTED", "HOME_FLOOR_UNSAFE", "HOME_FLOOR_SLIPPERY",
  "HOME_ANTI_SLIP_MAT_MISSING", "HOME_INDOOR_LIGHTING_INADEQUATE", "HOME_BEDSIDE_LIGHT_SWITCH_INCONVENIENT",
  "HOME_NIGHT_LIGHTING_INADEQUATE", "HOME_BATH_GRAB_BAR_MISSING", "HOME_BATH_ANTI_SLIP_INADEQUATE",
  "HOME_TOILET_BATHROOM_ACCESS_INCONVENIENT", "HOME_INDOOR_STAIR_HANDRAIL_MISSING",
  "HOME_OUTDOOR_STAIR_HANDRAIL_MISSING", "HOME_STAIR_EDGE_UNCLEAR", "HOME_SURROUNDING_ROAD_UNSAFE",
  "FALL_SCREEN_POSITIVE", "FALL_HISTORY_1Y", "FALL_UNSTEADY_STANDING_WALKING", "FALL_FEAR_ACTIVITY_RESTRICTION",
  "MORSE_FALL_RISK_MODERATE", "MORSE_FALL_RISK_HIGH", "FRAIL_PREFRAIL", "FRAIL_FRAIL",
  "URINARY_INCONTINENCE_SCREEN_POSITIVE", "ICIQ_INCONTINENCE_PRESENT", "ICIQ_LEAK_BEFORE_TOILET",
  "ICIQ_LEAK_COUGH_SNEEZE", "ICIQ_LEAK_ASLEEP", "ICIQ_LEAK_ACTIVITY", "ICIQ_LEAK_POST_VOID",
  "ICIQ_LEAK_NO_OBVIOUS_REASON", "ICIQ_CONTINUOUS_LEAKAGE",
  "CONSTIPATION_SCREEN_POSITIVE", "CONSTIPATION_DIAGNOSED", "CONSTIPATION_LOW_FREQUENCY",
  "CONSTIPATION_INCOMPLETE_EVACUATION", "CONSTIPATION_ANORECTAL_BLOCKAGE", "CONSTIPATION_PROLONGED_DEFECATION",
  "CONSTIPATION_MANUAL_MANEUVER", "CONSTIPATION_ABDOMINAL_DISCOMFORT_RELIEVED",
  "STOOL_FORM_TYPE_1", "STOOL_FORM_TYPE_2", "STOOL_FORM_TYPE_6", "STOOL_FORM_TYPE_7",
  "SLEEP_DISORDER_SCREEN_POSITIVE", "AIS_POSSIBLE_SLEEP_DISORDER", "AIS_SLEEP_DISORDER_PRESENT",
  "CHRONIC_PAIN_SCREEN_POSITIVE", "PAIN_NRS_MILD", "PAIN_NRS_MODERATE", "PAIN_NRS_SEVERE",
  "BEHAVIORAL_PAIN_SCORE", "PAIN_BEHAVIOR_FACE", "PAIN_BEHAVIOR_UPPER_LIMB", "PAIN_BEHAVIOR_VENTILATION", "PAIN_BEHAVIOR_VOCALIZATION",
  "PRESSURE_INJURY_SCREEN_POSITIVE", "PRESSURE_INJURY_LONG_TERM_BEDREST", "PRESSURE_INJURY_SKIN_ABNORMALITY",
  "BRADEN_RISK_LOW", "BRADEN_RISK_MODERATE", "BRADEN_RISK_HIGH", "BRADEN_RISK_VERY_HIGH",
  "POLYPHARMACY_PRESENT", "INAPPROPRIATE_MEDICATION_PRESENT", "POLYPHARMACY_AND_INAPPROPRIATE_USE",
  "MEDICATION_REVIEW_INSUFFICIENT_DATA", "DYSPHAGIA_SCREEN_POSITIVE", "DYSPHAGIA_DIFFICULTY_OR_PAIN",
  "DYSPHAGIA_COUGH_CHOKE", "DYSPHAGIA_ORAL_RESIDUE", "DYSPHAGIA_ORAL_LEAKAGE", "DYSPHAGIA_DROOLING",
  "WATER_SWALLOW_SUSPECTED_ABNORMAL", "WATER_SWALLOW_ABNORMAL",
  "NRS2002_INITIAL_POSITIVE", "NRS2002_NUTRITION_RISK", "MNA_SF_MALNUTRITION_RISK",
  "GLIM_MODERATE_MALNUTRITION", "GLIM_SEVERE_MALNUTRITION", "SARCOPENIA_CALF_SCREEN_POSITIVE",
  "GRIP_STRENGTH_LOW", "GAIT_SPEED_FUNCTION_DECLINE", "SARCOPENIA_DIAGNOSED", "CAM_DELIRIUM_POSITIVE",
]);

/** 报告是否需要关注：共享给医生端和患者端，保持两端排序与徽章同口径。 */
export function isAttentionTag(tag: Pick<AssessmentTag, "scaleId" | "code" | "level">): boolean {
  if (tag.scaleId === "tcm_constitution") {
    // 平和质「是」是健康结论；偏颇质「是」以及所有倾向/基本是均需关注。
    return tag.code !== "TCM_BALANCED_YES" && tag.level !== "否";
  }
  return ATTENTION_TAG_CODES.has(tag.code);
}
