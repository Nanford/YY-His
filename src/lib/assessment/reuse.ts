/**
 * INPUT:  会话勾选的量表 id 列表、已确认答案（题目 id → 标准选项 label）
 * OUTPUT: deriveReuseAnswers —— 按 01 表「复用规则」应回填到其他量表条目的答案（纯函数、无 IO）
 * POS:    M9.3/M9.4 跨量表变量复用回填 + 分支跳过。01 表的「复用规则」本质是同一套机制：
 *         已确认答案 → 按规则回填其他条目；回填落库为 confirmed 答案后，对话状态机自然跳过该题
 *         （见 src/lib/dialogue/state-machine.ts：已有答案记录的题主轮不再提问）。
 *         规则注册表 REUSE_RULES 手工维护，条目数据取 rules/v2 原生形状；
 *         落库接线见 src/lib/assessment/system-answers.ts 的 syncReuseAnswers。
 *
 *         覆盖范围（M10.3b 后 42 量表）：
 *         - 焦虑两问 ↔ GAD-7（筛查阴性回填 0 分档）
 *         - 运动初筛阴性 → FRAIL 上楼/100 米题回填「否」
 *         - 跌倒三问第1题「否」→ Morse 跌倒史回填「无」
 *         - 尿失禁两问第1题「否」→ ICIQ 频率/漏量/情形回填无漏尿档
 *         - DXA/BIA 测量结论 → GLIM 肌肉量条目（只复用已确认的设备/医护结果）
 *         抑郁两问 → GDS-15 01 表未明说门控，不做门控；NRS2002 初筛→终筛为评分器分支，不在此伪造答案。
 */

import { scalesV2, type ScaleItemV2 } from "@/lib/rules/v2";

export interface ReuseAnswer {
  questionId: string;
  optionLabel: string;
  score: number;
  /** 回填依据（全链路可追溯硬约束：答案 → 原始依据逐级下钻） */
  rawText: string;
}

/** 复用规则：源题答出触发值时，目标题按 0 分档或显式 label 回填。 */
interface ReuseRule {
  sourceQuestionId: string;
  /** 触发值；缺省表示源题任一合法已确认 label 均触发（同变量复制）。 */
  whenLabel?: string;
  targetQuestionId: string;
  /**
   * 可选：显式目标 label（用于无分值选项如「从不漏尿」）；
   * 缺省时按目标题唯一 0 分档反查。
  */
  targetLabel?: string;
  /** 当目标选项未解析出 score（如 GLIM 布尔项）时使用的目标分值。 */
  targetScore?: number;
  /** 01 表出处与口径说明 */
  note: string;
}

/**
 * 复用规则注册表（手工维护；新增规则前确认两张量表均已配判定可评分）。
 * 抑郁两问 → GDS-15 不在此列：01 表未明说门控/回填规则（见文件头注释），不做门控。
 */
export const REUSE_RULES: readonly ReuseRule[] = [
  {
    // 来源：01 表 anxiety_2q_1 复用规则「若后续选择GAD-7且回答"否"，GAD-7第1题直接回填0分」
    sourceQuestionId: "anxiety_2q_1",
    whenLabel: "否（筛查阴性）",
    targetQuestionId: "gad7_1",
    note: "焦虑两问第1题答「否」→ GAD-7 第1题回填 0 分；答「是」只追问频率（不回填）",
  },
  {
    sourceQuestionId: "anxiety_2q_2",
    whenLabel: "否（筛查阴性）",
    targetQuestionId: "gad7_2",
    note: "焦虑两问第2题答「否」→ GAD-7 第2题回填 0 分；答「是」只追问频率（不回填）",
  },
  // 来源：01 表 motor_screen_1「若回答均无困难，FRAIL 的上楼及 100 米步行可直接回填否」
  {
    sourceQuestionId: "motor_screen_1",
    whenLabel: "否（筛查阴性）",
    targetQuestionId: "frail_2",
    note: "运动初筛阴性 → FRAIL 上楼困难回填「否」",
  },
  {
    sourceQuestionId: "motor_screen_1",
    whenLabel: "否（筛查阴性）",
    targetQuestionId: "frail_3",
    note: "运动初筛阴性 → FRAIL 100 米步行困难回填「否」",
  },
  // 来源：01 表 fall_3q_1「如回答否，Morse 过去 3 个月跌倒史直接回填无」
  {
    sourceQuestionId: "fall_3q_1",
    whenLabel: "否（筛查阴性）",
    targetQuestionId: "morse_1",
    note: "跌倒三问过去1年无跌倒 → Morse 跌倒史回填「无」",
  },
  // 来源：01 表 ui_2q_1「若回答否，ICIQ 第1、2 题回填 0 分，并跳过漏尿情形」
  {
    sourceQuestionId: "ui_2q_1",
    whenLabel: "否（筛查阴性）",
    targetQuestionId: "iciq_1",
    note: "尿失禁筛查无漏尿 → ICIQ 频率回填「从不」",
  },
  {
    sourceQuestionId: "ui_2q_1",
    whenLabel: "否（筛查阴性）",
    targetQuestionId: "iciq_2",
    note: "尿失禁筛查无漏尿 → ICIQ 漏量回填「没有」",
  },
  {
    sourceQuestionId: "ui_2q_1",
    whenLabel: "否（筛查阴性）",
    targetQuestionId: "iciq_4",
    targetLabel: "从不漏尿",
    note: "尿失禁筛查无漏尿 → ICIQ 情形回填「从不漏尿」",
  },
  {
    // 来源：01 表 GLIM-4 与 DXA/BIA 均使用 MUSCLE_MASS_INDEX；只复制已确认设备结论。
    sourceQuestionId: "dxa_bia_1",
    whenLabel: "符合肌少症肌肉量界值",
    targetQuestionId: "glim_4",
    targetScore: 1,
    targetLabel: "存在肌肉减少：DXA骨骼肌指数男＜7.0、女＜5.4 kg/m²，或BIA男＜7.0、女＜5.7 kg/m²，或去脂体质指数男＜17.0、女＜15.0 kg/m²",
    note: "DXA/BIA 已有设备/医护结论 → GLIM 肌肉量条目；没有设备结果不自动推导",
  },
  {
    sourceQuestionId: "dxa_bia_1",
    whenLabel: "未达肌少症肌肉量界值",
    targetQuestionId: "glim_4",
    targetScore: 0,
    targetLabel: "不存在",
    note: "DXA/BIA 已有设备/医护结论 → GLIM 肌肉量条目；没有设备结果不自动推导",
  },
];

interface IndexedItem {
  item: ScaleItemV2;
  scaleId: string;
  scaleName: string;
}

/** 条目 id → 条目 + 所属量表（模块加载时构建一次） */
const itemIndex: ReadonlyMap<string, IndexedItem> = new Map(
  scalesV2.flatMap((scale) =>
    scale.items.map((item) => [item.id, { item, scaleId: scale.id, scaleName: scale.name }] as const)
  )
);

export interface ReuseRegistryValidation {
  ok: boolean;
  invalidRules: string[];
  duplicateRules: string[];
}

function indexed(questionId: string): IndexedItem {
  const hit = itemIndex.get(questionId);
  if (!hit) throw new Error(`复用规则引用了未知条目：${questionId}（规则注册表与规则数据不一致）`);
  return hit;
}

/**
 * 校验复用注册表的引用和 label 口径；规则数据或注册表变化时由测试显式调用。
 * 这里只验证“能否安全复用”，不替医学表补充未定义的门控规则。
 */
export function validateReuseRegistry(): ReuseRegistryValidation {
  const invalidRules: string[] = [];
  const duplicateRules: string[] = [];
  const seen = new Set<string>();

  REUSE_RULES.forEach((rule, index) => {
    const identity = `${rule.sourceQuestionId}→${rule.targetQuestionId}→${rule.whenLabel ?? "*"}`;
    if (seen.has(identity)) duplicateRules.push(`第${index + 1}条：${identity}`);
    seen.add(identity);

    let source: IndexedItem;
    let target: IndexedItem;
    try {
      source = indexed(rule.sourceQuestionId);
      target = indexed(rule.targetQuestionId);
    } catch (error) {
      invalidRules.push(`第${index + 1}条：${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    if (rule.whenLabel && !source.item.options?.some((option) => option.label === rule.whenLabel)) {
      invalidRules.push(`第${index + 1}条：源题触发 label 不存在：${rule.sourceQuestionId}=${rule.whenLabel}`);
    }
    if (rule.targetLabel && !hasTargetLabel(target.item, rule.targetLabel)) {
      invalidRules.push(`第${index + 1}条：目标 label 不存在：${rule.targetQuestionId}=${rule.targetLabel}`);
    }
    if (rule.targetScore !== undefined && (!Number.isFinite(rule.targetScore) || rule.targetScore < 0)) {
      invalidRules.push(`第${index + 1}条：目标分值非法：${rule.targetQuestionId}=${rule.targetScore}`);
    }
  });

  return { ok: invalidRules.length === 0 && duplicateRules.length === 0, invalidRules, duplicateRules };
}

/** 目标题 0 分档选项：从规则数据按分值反查（不硬编码 label）；查不到/不唯一均为规则数据异常，宁可抛错 */
function zeroScoreOption(item: ScaleItemV2): { label: string; score: number } {
  const scored = (item.options ?? []).filter((option) => option.score === 0);
  if (scored.length === 1) return { label: scored[0].label, score: scored[0].score ?? 0 };
  throw new Error(`条目 ${item.id} 的 0 分选项${scored.length === 0 ? "不存在" : "不唯一"}（规则数据异常，无法回填）`);
}

/** 目标 label 可能来自结构化 options，也可能只存在于 01 表原文（复用题）。 */
function hasTargetLabel(item: ScaleItemV2, label: string): boolean {
  return item.options?.some((option) => option.label === label) ?? item.optionsRaw.includes(label);
}

/** 解析目标回填选项：优先显式 label，否则按 0 分档反查。 */
function resolveTargetOption(
  item: ScaleItemV2,
  targetLabel: string | undefined,
  targetScore: number | undefined
): { label: string; score: number } {
  if (targetLabel) {
    const hit = (item.options ?? []).find((o) => o.label === targetLabel);
    if (hit) return { label: hit.label, score: hit.score ?? targetScore ?? 0 };
    if (!hasTargetLabel(item, targetLabel)) {
      throw new Error(`复用目标 label「${targetLabel}」不是条目 ${item.id} 的合法选项`);
    }
    return { label: targetLabel, score: targetScore ?? 0 };
  }
  return zeroScoreOption(item);
}

/** 规则在会话内成立（源/目标量表均被勾选）时，目标题 id 集合——供落库层识别"条件不再成立需撤回"的回填 */
export function reuseTargetQuestionIds(scaleIds: readonly string[]): ReadonlySet<string> {
  const scaleSet = new Set(scaleIds);
  const targets = new Set<string>();
  for (const rule of REUSE_RULES) {
    const source = indexed(rule.sourceQuestionId);
    const target = indexed(rule.targetQuestionId);
    if (scaleSet.has(source.scaleId) && scaleSet.has(target.scaleId)) targets.add(rule.targetQuestionId);
  }
  return targets;
}

/**
 * 按 01 表复用规则推导应回填的答案。
 * - 源量表或目标量表不在 scaleIds → 不产出（anxiety_2q 不在会话时 GAD-7 全部照常提问）；
 * - 源题未确认、或已确认答案非触发值（答「是」只追问频率，不回填）→ 不产出；
 * - 目标题已有 confirmed 答案（人工优先，系统回填不覆盖）→ 不产出。
 * confirmed：题目 id → 已确认的标准选项 label。
 */
export function deriveReuseAnswers(
  scaleIds: readonly string[],
  confirmed: ReadonlyMap<string, string>
): ReuseAnswer[] {
  const scaleSet = new Set(scaleIds);
  const out: ReuseAnswer[] = [];
  for (const rule of REUSE_RULES) {
    const source = indexed(rule.sourceQuestionId);
    const target = indexed(rule.targetQuestionId);
    if (!scaleSet.has(source.scaleId) || !scaleSet.has(target.scaleId)) continue;
    // 有固定触发值时必须是源题的合法选项（注册表与规则数据一致性校验，异常宁可抛错）
    if (rule.whenLabel && !source.item.options?.some((option) => option.label === rule.whenLabel)) {
      throw new Error(
        `复用规则触发值「${rule.whenLabel}」不是条目 ${rule.sourceQuestionId} 的合法选项（规则数据异常）`
      );
    }
    const sourceLabel = confirmed.get(rule.sourceQuestionId);
    if (sourceLabel === undefined) continue;
    if (rule.whenLabel && sourceLabel !== rule.whenLabel) continue;
    if (!rule.whenLabel && !source.item.options?.some((option) => option.label === sourceLabel)) {
      throw new Error(`复用源题 ${rule.sourceQuestionId} 的已确认 label 不是规则数据中的合法选项`);
    }
    if (confirmed.has(rule.targetQuestionId)) continue;
    const fill = resolveTargetOption(target.item, rule.targetLabel, rule.targetScore);
    out.push({
      questionId: rule.targetQuestionId,
      optionLabel: fill.label,
      score: fill.score,
      rawText: `复用「${source.scaleName}」第${source.item.no}题：${sourceLabel} → 按 01 表复用规则回填「${fill.label}」`,
    });
  }
  return out;
}
