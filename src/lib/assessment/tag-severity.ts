/**
 * INPUT:  02 表结果标签编码全集（src/lib/rules/v2 的 tagV2ByCode）
 * OUTPUT: tagSeverity / isAbnormalTag —— 报告页「正常 / 提示信息 / 异常」的展示分级
 * POS:    报告版式（2026-11-10）展示口径收口：既存问题清单、结果表▲标记、正常范围取值都以本分级为准。
 *         只影响展示，不参与评分/判定/推荐（硬约束 2）。此前报告页按标签名关键词正则猜测异常，
 *         现改为按编码显式配置：NORMAL（量表的正常/阴性档）与 INFO（不表达好坏的记录性标签）
 *         显式列出，其余 02 表标签一律视为异常；`tests/tag-severity.test.ts` 锁定完整异常清单，
 *         02 表新增标签时测试会失败，强制人工归类。
 *         分级为工程侧整理（待甲方医学确认）：如「平和质：否」「粪便性状 N 型」归为提示信息、
 *         Morse 低风险与 Braden 19～23 分归为正常。
 */
import { tagV2ByCode } from "@/lib/rules/v2";

export type TagSeverity = "normal" | "info" | "abnormal";

/** 各量表的正常/阴性档标签（其 02 表 rule 原文即报告「正常范围」列的取值来源） */
const NORMAL_TAG_CODES: ReadonlySet<string> = new Set([
  "ADL_DEPENDENCE_NONE",
  "IADL_NORMAL",
  "MOTOR_SCREEN_NEGATIVE",
  "SPPB_GOOD",
  "VISION_NORMAL",
  "VISUAL_FUNCTION_GOOD",
  "HEARING_NORMAL",
  "WHISPER_TEST_NEGATIVE",
  "COGNITIVE_BRIEF_SCREEN_NEGATIVE",
  "MMSE_WITHIN_NORMAL_RANGE",
  "DEPRESSION_2Q_NEGATIVE",
  "GDS15_NORMAL",
  "ANXIETY_2Q_NEGATIVE",
  "GAD7_NORMAL",
  "LUBBEN_SUPPORT_GOOD",
  "FALL_SCREEN_NEGATIVE",
  "MORSE_FALL_RISK_LOW",
  "FRAIL_NONE",
  "URINARY_INCONTINENCE_SCREEN_NEGATIVE",
  "ICIQ_NO_INCONTINENCE",
  "CONSTIPATION_SCREEN_NEGATIVE",
  "CONSTIPATION_NOT_DIAGNOSED",
  "SLEEP_DISORDER_SCREEN_NEGATIVE",
  "AIS_NO_SLEEP_DISORDER",
  "CHRONIC_PAIN_SCREEN_NEGATIVE",
  "PAIN_NRS_NONE",
  "PRESSURE_INJURY_SCREEN_NEGATIVE",
  "BRADEN_BELOW_LOW_RISK_THRESHOLD",
  "MEDICATION_REVIEW_NO_ISSUE",
  "DYSPHAGIA_SCREEN_NEGATIVE",
  "WATER_SWALLOW_NORMAL",
  "NRS2002_INITIAL_NEGATIVE",
  "NRS2002_NO_NUTRITION_RISK",
  "MNA_SF_NO_RISK",
  "GLIM_NO_MALNUTRITION",
  "SARCOPENIA_CALF_SCREEN_NEGATIVE",
  "GRIP_STRENGTH_NORMAL",
  "GAIT_SPEED_FUNCTION_NORMAL",
  "SARCOPENIA_MUSCLE_MASS_NEGATIVE",
  "CAM_DELIRIUM_NEGATIVE",
  "TCM_BALANCED_YES",
  "TCM_BALANCED_BASICALLY",
  "TCM_QI_DEFICIENCY_NO",
  "TCM_YANG_DEFICIENCY_NO",
  "TCM_YIN_DEFICIENCY_NO",
  "TCM_PHLEGM_DAMPNESS_NO",
  "TCM_DAMP_HEAT_NO",
  "TCM_BLOOD_STASIS_NO",
  "TCM_QI_STAGNATION_NO",
  "TCM_SPECIAL_CONSTITUTION_NO",
]);

/** 记录性标签：只陈述事实（总分占位、粪便性状、信息不足等），不标▲也不进既存问题 */
const INFO_TAG_CODES: ReadonlySet<string> = new Set([
  "HOME_ENVIRONMENT_SCORE",
  "ICIQ_UI_SF_SCORE",
  "CONSTIPATION_CLINICAL_TYPE",
  "BEHAVIORAL_PAIN_SCORE",
  "MEDICATION_COUNT",
  "STOOL_FORM_TYPE_1",
  "STOOL_FORM_TYPE_2",
  "STOOL_FORM_TYPE_3",
  "STOOL_FORM_TYPE_4",
  "STOOL_FORM_TYPE_5",
  "STOOL_FORM_TYPE_6",
  "STOOL_FORM_TYPE_7",
  "TCM_BALANCED_NO",
  "MEDICATION_REVIEW_INSUFFICIENT_DATA",
  "MMSE_UNABLE_TO_COMPLETE",
  "NRS2002_INITIAL_POSITIVE",
]);

/**
 * 历史快照兜底：V2 装机前的老会话标签编码不在 02 表内，沿用旧的标签名关键词口径，
 * 保证历史报告的既存问题不因改版消失。现行 190 个标签不走这条分支。
 */
function legacySeverityByName(name: string): TagSeverity {
  if (/阴性|正常|无依赖|良好|未提示/.test(name)) return "normal";
  if (/阳性|风险|重度|差|障碍|依赖|衰弱|营养不良|谵妄|失禁|疼痛|下降|受损/.test(name)) {
    return "abnormal";
  }
  return "info";
}

/** 标签展示分级；code 为 02 表标签编码，name 仅在编码不在现行 02 表时用于历史兜底 */
export function tagSeverity(code: string, name: string): TagSeverity {
  if (NORMAL_TAG_CODES.has(code)) return "normal";
  if (INFO_TAG_CODES.has(code)) return "info";
  if (tagV2ByCode.has(code)) return "abnormal";
  return legacySeverityByName(name);
}

/** 是否为需要关注的异常标签（既存问题清单 / 结果表▲） */
export function isAbnormalTag(tag: { code: string; tag: string }): boolean {
  return tagSeverity(tag.code, tag.tag) === "abnormal";
}

/** 是否为某量表的正常档标签（「正常范围」列取其 rule 原文） */
export function isNormalTagCode(code: string): boolean {
  return NORMAL_TAG_CODES.has(code);
}

/** 测试用：显式配置的编码全集，供校验"全部编码都在 02 表内" */
export const CONFIGURED_SEVERITY_CODES: readonly string[] = [...NORMAL_TAG_CODES, ...INFO_TAG_CODES];
