/**
 * INPUT:  data/judgments-v2.json（已配判定的可评分量表，经 src/lib/rules/v2 读取）、表单 FormData
 * OUTPUT: 量表套餐定义（常规综合评估包 + 4 个系统预设套餐）与"发起评估"选择解析（套餐/自定义/随访复评）
 * POS:    医生端「发起评估」量表工具选择（来源：V2/Demo_v2更新说明.docx §2）的唯一解析口径，
 *         供 src/lib/actions/doctor.ts 的 createSession 与患者详情页表单共用。
 *         病历智能评估（docx §2 LLM 推荐量表）已实现，见 src/lib/assessment/emr-scale-suggest.ts。
 */
import { judgmentsV2, scalesV2 } from "@/lib/rules/v2";

/** 可评分量表 = 已配判定（judgments-v2.json）的量表，顺序保持 01 表文档顺序 */
export const SCORABLE_SCALE_IDS: readonly string[] = scalesV2
  .filter((scale) => judgmentsV2.some((j) => j.scaleId === scale.id))
  .map((scale) => scale.id);

const SCORABLE_SET: ReadonlySet<string> = new Set(SCORABLE_SCALE_IDS);

export interface ScalePackage {
  key: string;
  name: string;
  description: string;
  scaleIds: readonly string[];
}

/**
 * 量表套餐（来源：V2/Demo_v2更新说明.docx §2 量表工具选择）。
 * routine 为 docx §2(1) 常规综合评估（默认）；其余 4 个为 §2(2) 系统预设套餐 A–D。
 * 套餐内容变更的唯一路径：改 docx 口径 → 改此处 → 跑 tests/scale-packages.test.ts。
 */
export const SCALE_PACKAGES: readonly ScalePackage[] = [
  {
    key: "routine",
    name: "常规综合评估包",
    description: "预设常规量表包：躯体功能、衰弱、营养、认知初筛、情志初筛与中医体质一次覆盖",
    // docx §2(1)：ADL / IADL / FRAIL / MNA-SF / Mini-Cog / 抑郁两问 / 焦虑两问 / 中医体质
    scaleIds: ["adl", "iadl", "frail", "mnasf", "minicog", "depression_2q", "anxiety_2q", "tcm_constitution"],
  },
  {
    key: "frailty",
    name: "衰弱与机能评估包",
    description: "系统预设套餐 A：日常生活能力与衰弱筛查",
    // docx §2(2)A：ADL / IADL / FRAIL
    scaleIds: ["adl", "iadl", "frail"],
  },
  {
    key: "cognitive",
    name: "认知评估包",
    description: "系统预设套餐 B：认知初筛 + MMSE 详评",
    // docx §2(2)B：Mini-Cog / MMSE
    scaleIds: ["minicog", "mmse"],
  },
  {
    key: "mood",
    name: "情志评估包",
    description: "系统预设套餐 C：抑郁、焦虑与睡眠",
    // docx §2(2)C：GDS-15 / GAD-7 / AIS
    scaleIds: ["gds15", "gad7", "ais"],
  },
  {
    key: "tcm",
    name: "中医特色评估包",
    description: "系统预设套餐 D：中医体质辨识",
    // docx §2(2)D：中医体质
    scaleIds: ["tcm_constitution"],
  },
];

// 模块加载即断言：套餐内量表必须全部已配判定（可评分），防止"选了评不了分"（医学核心红线）
for (const pkg of SCALE_PACKAGES) {
  for (const id of pkg.scaleIds) {
    if (!SCORABLE_SET.has(id)) {
      throw new Error(`量表套餐 ${pkg.key} 包含未配判定的量表：${id}`);
    }
  }
}

/** 按 key 取套餐量表范围；未命中返回 undefined（含自定义组合的 "custom" 伪 key） */
export function resolvePackageScaleIds(key: string): readonly string[] | undefined {
  return SCALE_PACKAGES.find((pkg) => pkg.key === key)?.scaleIds;
}

export interface SessionScaleSelectionOptions {
  /**
   * 随访对比复评（docx §2(3)）：调用方从数据库取出的"最近一次已出报告会话"的量表范围。
   * 客户端提交的任何量表 id 都不被采信，有效范围一律以服务端该字段为准（防篡改）。
   */
  followupScaleIds?: readonly string[];
}

/**
 * 解析「发起评估」表单的量表选择，优先级（互斥，命中即返回）：
 * 1. `followup` 字段非空 → 随访复评：取可评分量表 ∩ 调用方给出的上次会话范围（无上次范围 → 拒绝）；
 * 2. `package` 字段命中套餐 key → 套餐量表（"custom" 或空 → 落到第 3 步；未知 key 抛错）；
 * 3. 收集 `scale.<id>` 勾选（旧表单字段，保持兼容）；未配判定的量表 id 一律抛错。
 * 全部为空返回 null（调用方回 error=no-scale）。返回值按 01 表文档顺序归一化。
 */
export function parseSessionScaleSelection(
  formData: FormData,
  options: SessionScaleSelectionOptions = {}
): string[] | null {
  const followup = formData.get("followup");
  if (typeof followup === "string" && followup !== "") {
    const baseline = options.followupScaleIds;
    if (!baseline || baseline.length === 0) return null;
    const ids = SCORABLE_SCALE_IDS.filter((id) => baseline.includes(id));
    return ids.length > 0 ? ids : null;
  }

  const pkg = formData.get("package");
  if (typeof pkg === "string" && pkg !== "" && pkg !== "custom") {
    const scaleIds = resolvePackageScaleIds(pkg);
    if (!scaleIds) throw new Error(`未知量表套餐：${pkg}`);
    return [...scaleIds];
  }

  const checked = new Set<string>();
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("scale.")) continue;
    const id = key.slice("scale.".length);
    if (!SCORABLE_SET.has(id)) throw new Error(`未知或不可评分量表：${id}`);
    if (value === "on") checked.add(id);
  }
  if (checked.size === 0) return null;
  return SCORABLE_SCALE_IDS.filter((id) => checked.has(id));
}
