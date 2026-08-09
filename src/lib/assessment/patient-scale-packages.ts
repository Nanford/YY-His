/**
 * INPUT:  data/scales-v2.json（经 src/lib/rules/v2 读取）、SCORABLE_SCALE_IDS（scale-packages.ts）
 * OUTPUT: 患者端「量表工具选择」四方式页的套餐定义（常规综合 3 包 + 自选组合 4 预设包）、
 *         一级分类分组 helper 与预计时长估算
 * POS:    来源：2026-08-08 设计图（常规综合评估 / 自选组合评估）——患者端 /patient/select-scales/*
 *         专用；与医生端 SCALE_PACKAGES（scale-packages.ts，docx §2 口径）相互独立，互不改写。
 *         图未枚举的套餐内容（门诊简版/住院入院/跌倒风险/睡眠与疼痛）为推定组合，待甲方确认。
 */
import { SCORABLE_SCALE_IDS } from "@/lib/assessment/scale-packages";
import { scaleV2ById } from "@/lib/rules/v2";

const SCORABLE_SET: ReadonlySet<string> = new Set(SCORABLE_SCALE_IDS);

export interface PatientScalePackage {
  key: string;
  name: string;
  description: string;
  /** 适用场景说明（图1 套餐卡上的「适用：…」文案） */
  scene?: string;
  scaleIds: readonly string[];
}

/**
 * 常规综合评估页（图1）的 3 个预设套餐。
 * standard 内容与设计图右栏分组明示一致（躯体功能 5 / 精神心理 3 / 社会与环境 2 / 老年综合征 2）；
 * outpatient / inpatient 图中未枚举量表清单，按场景推定（推定待甲方确认）。
 */
export const ROUTINE_PACKAGES: readonly PatientScalePackage[] = [
  {
    key: "standard",
    name: "老年综合评估标准包",
    description: "躯体功能、精神心理、社会与环境、老年综合征四大类一次覆盖",
    scene: "初次综合评估",
    // 设计图明示：Barthel/IADL/运动功能初筛/视力/听力 + 简易智力/MMSE/抑郁两问 + Lubben/居家环境 + FRAIL/MNA-SF
    scaleIds: [
      "adl",
      "iadl",
      "motor_screen",
      "vision",
      "hearing",
      "minicog",
      "mmse",
      "depression_2q",
      "lubben",
      "home_env",
      "frail",
      "mnasf",
    ],
  },
  {
    key: "outpatient",
    name: "门诊简版评估包",
    description: "衰弱、营养、跌倒、认知与情志的快速筛查组合",
    scene: "门诊快速评估",
    // 推定（图未枚举，待甲方确认）：均为患者可自答的快筛量表
    scaleIds: ["frail", "mnasf", "fall_3q", "minicog", "depression_2q", "anxiety_2q", "ais"],
  },
  {
    key: "inpatient",
    name: "住院入院评估包",
    description: "入院常规：能力、跌倒、压伤、营养、谵妄与用药核对",
    scene: "入院评估",
    // 推定（图未枚举，待甲方确认）：按入院评估常见必评项组合
    scaleIds: ["adl", "frail", "mnasf", "nrs2002", "morse", "braden", "cam", "polypharmacy", "pain_1q"],
  },
];

/**
 * 自选组合页（图4）「系统预设套餐」tab 的 4 个套餐。
 * cognition_mood 内容与设计图右栏「已选评估项目」明示一致（7 项）；
 * fall_risk / sarcopenia_nutrition / sleep_pain 图中未枚举清单，按套餐说明推定（推定待甲方确认）。
 */
export const CUSTOM_PRESET_PACKAGES: readonly PatientScalePackage[] = [
  {
    key: "cognition_mood",
    name: "认知与情志评估包",
    description: "适用于认知及情绪状态的筛查与综合评估。",
    // 设计图明示：简易智力评估量表 / MMSE / 抑郁两问筛查 / GDS-15 / 焦虑两问筛查 / GAD-7 / AIS
    scaleIds: ["minicog", "mmse", "depression_2q", "gds15", "anxiety_2q", "gad7", "ais"],
  },
  {
    key: "fall_risk",
    name: "跌倒风险评估包",
    description: "评估老年人跌倒风险及相关影响因素。",
    // 推定（图未枚举，待甲方确认）：跌倒筛查 + 详评 + 居家环境 + 视听力与步速等影响因素
    scaleIds: ["fall_3q", "morse", "home_env", "vision", "hearing", "gait_speed"],
  },
  {
    key: "sarcopenia_nutrition",
    name: "肌少症与营养评估包",
    description: "评估肌少症风险及营养状况。",
    // 推定（图未枚举，待甲方确认）：肌少症测量四件 + 体能 + 营养三件套
    scaleIds: ["calf", "grip", "gait_speed", "dxa_bia", "sppb", "mnasf", "nrs2002", "glim"],
  },
  {
    key: "sleep_pain",
    name: "睡眠与疼痛评估包",
    description: "评估睡眠质量与疼痛程度及其影响。",
    // 推定（图未枚举，待甲方确认）：睡眠两档 + 疼痛三档 + 情绪影响
    scaleIds: ["sleep_1q", "ais", "pain_1q", "pain_nrs", "pain_behavior", "depression_2q"],
  },
];

// 模块加载即断言：套餐内量表必须全部可评分（已配判定）、无重复、项数与设计图一致（医学核心红线：
// 防止"选了评不了分"；项数断言锁定设计图 12/7/9 与 7/6/8/6，改动需同步设计口径与测试）
const EXPECTED_COUNTS: Record<string, number> = {
  standard: 12,
  outpatient: 7,
  inpatient: 9,
  cognition_mood: 7,
  fall_risk: 6,
  sarcopenia_nutrition: 8,
  sleep_pain: 6,
};
for (const pkg of [...ROUTINE_PACKAGES, ...CUSTOM_PRESET_PACKAGES]) {
  if (pkg.scaleIds.length !== EXPECTED_COUNTS[pkg.key]) {
    throw new Error(`患者端套餐 ${pkg.key} 项数 ${pkg.scaleIds.length} 与设计图 ${EXPECTED_COUNTS[pkg.key]} 不一致`);
  }
  if (new Set(pkg.scaleIds).size !== pkg.scaleIds.length) {
    throw new Error(`患者端套餐 ${pkg.key} 存在重复量表`);
  }
  for (const id of pkg.scaleIds) {
    if (!SCORABLE_SET.has(id)) {
      throw new Error(`患者端套餐 ${pkg.key} 包含未配判定的量表：${id}`);
    }
  }
}

export interface ScaleCategoryGroup {
  category: string;
  scaleIds: string[];
}

/**
 * 按 01 表一级分类分组（图1 右栏「本次量表与工具配置」/ 图4 自定义树）。
 * 分组与组内顺序按入参首次出现顺序——调用方传入 SCORABLE_SCALE_IDS（01 表文档顺序）
 * 或套餐定义顺序即为展示顺序；不在题库中的 id 静默跳过（调用方传入前已校验可评分）。
 */
export function groupScalesByCategory(scaleIds: readonly string[]): ScaleCategoryGroup[] {
  const groups: ScaleCategoryGroup[] = [];
  for (const id of scaleIds) {
    const scale = scaleV2ById.get(id);
    if (!scale) continue;
    let group = groups.find((g) => g.category === scale.category);
    if (!group) {
      group = { category: scale.category, scaleIds: [] };
      groups.push(group);
    }
    group.scaleIds.push(id);
  }
  return groups;
}

/**
 * 预计时长换算（分钟，仅页面展示用，非医学口径）：
 * "正式问题"条目数 ÷ 4 取整（约 15 秒/题，与标准包 76 题≈19 分钟≈设计图 18 分钟一致），下限 2 分钟。
 */
export function minutesFromAskable(askableCount: number): number {
  return Math.max(2, Math.round(askableCount / 4));
}

/** 单量表需患者/医护作答的"正式问题"条目数（系统读取/观察类不计入作答耗时） */
export function askableQuestionCount(scaleId: string): number {
  const scale = scaleV2ById.get(scaleId);
  if (!scale) return 0;
  return scale.items.filter((item) => item.entryType === "正式问题").length;
}

/** 一组量表的预计时长（分钟），口径同 minutesFromAskable */
export function estimateMinutes(scaleIds: readonly string[]): number {
  let askable = 0;
  for (const id of scaleIds) {
    askable += askableQuestionCount(id);
  }
  return minutesFromAskable(askable);
}
