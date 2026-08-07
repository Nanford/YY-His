/**
 * INPUT:  会话勾选的量表 id 列表、已确认答案（题目 id → 标准选项 label）
 * OUTPUT: deriveReuseAnswers —— 按 01 表「复用规则」应回填到其他量表条目的答案（纯函数、无 IO）
 * POS:    M9.3/M9.4 跨量表变量复用回填 + 分支跳过。01 表的「复用规则」本质是同一套机制：
 *         已确认答案 → 按规则回填其他条目；回填落库为 confirmed 答案后，对话状态机自然跳过该题
 *         （见 src/lib/dialogue/state-machine.ts：已有答案记录的题主轮不再提问）。
 *         规则注册表 REUSE_RULES 手工维护，条目数据取 rules/v2 原生形状；
 *         落库接线见 src/lib/assessment/system-answers.ts 的 syncReuseAnswers。
 *
 *         覆盖范围说明（2026-08-07 调研结论）：在当前 13 个已配判定的可评分量表内，
 *         01 表实际成立的复用规则只有「焦虑两问 ↔ GAD-7」一组；其余复用/分支规则
 *         （运动初筛→FRAIL2/3、跌倒史→Morse1、尿失禁→ICIQ、NRS2002 初筛→终筛等）
 *         涉及 morse/motor_screen/nrs2002 等未配判定量表，随 M10.3b 落地后在此扩充注册表。
 *         抑郁两问 → GDS-15 是否条件触发，01 表未明说（两表复用规则列均为「首次采集；同变量直接复用」），
 *         故不做门控，GDS-15 全部题目照常提问。
 */

import { scalesV2, type ScaleItemV2 } from "@/lib/rules/v2";

export interface ReuseAnswer {
  questionId: string;
  optionLabel: string;
  score: number;
  /** 回填依据（全链路可追溯硬约束：答案 → 原始依据逐级下钻） */
  rawText: string;
}

/** 复用规则：源题答出触发值（whenLabel）时，目标题按目标量表 0 分档直接回填 */
interface ReuseRule {
  sourceQuestionId: string;
  /** 触发值：源题标准选项 label（须精确等于 01 表选项，派生时校验，数据异常抛错） */
  whenLabel: string;
  targetQuestionId: string;
  /** 01 表出处与口径说明 */
  note: string;
}

/**
 * 复用规则注册表（手工维护；新增规则前确认两张量表均已配判定可评分）。
 * 抑郁两问 → GDS-15 不在此列：01 表未明说门控/回填规则（见文件头注释），不做门控。
 */
const REUSE_RULES: ReuseRule[] = [
  {
    // 来源：01 表 anxiety_2q_1 复用规则「若后续选择GAD-7且回答"否"，GAD-7第1题直接回填0分」
    // 与 gad7_1 复用规则「焦虑两问第1题为"否"时直接回填"无（0分）"；为"是"时只追问出现频率」；
    // 两条目共享信息变量编码 ANXIETY_TENSION_2W
    sourceQuestionId: "anxiety_2q_1",
    whenLabel: "否（筛查阴性）",
    targetQuestionId: "gad7_1",
    note: "焦虑两问第1题答「否」→ GAD-7 第1题回填 0 分；答「是」只追问频率（不回填）",
  },
  {
    // 来源：01 表 anxiety_2q_2 / gad7_2 复用规则（同上）；共享变量编码 ANXIETY_UNCONTROLLABLE_WORRY_2W
    sourceQuestionId: "anxiety_2q_2",
    whenLabel: "否（筛查阴性）",
    targetQuestionId: "gad7_2",
    note: "焦虑两问第2题答「否」→ GAD-7 第2题回填 0 分；答「是」只追问频率（不回填）",
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

function indexed(questionId: string): IndexedItem {
  const hit = itemIndex.get(questionId);
  if (!hit) throw new Error(`复用规则引用了未知条目：${questionId}（规则注册表与规则数据不一致）`);
  return hit;
}

/** 目标题 0 分档选项：从规则数据按分值反查（不硬编码 label）；查不到/不唯一均为规则数据异常，宁可抛错 */
function zeroScoreOption(item: ScaleItemV2): { label: string; score: number } {
  const scored = (item.options ?? []).filter((option) => option.score === 0);
  if (scored.length === 1) return { label: scored[0].label, score: 0 };
  throw new Error(`条目 ${item.id} 的 0 分选项${scored.length === 0 ? "不存在" : "不唯一"}（规则数据异常，无法回填）`);
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
    // 触发值必须是源题的合法选项（注册表与规则数据一致性校验，异常宁可抛错）
    if (!source.item.options?.some((option) => option.label === rule.whenLabel)) {
      throw new Error(
        `复用规则触发值「${rule.whenLabel}」不是条目 ${rule.sourceQuestionId} 的合法选项（规则数据异常）`
      );
    }
    const sourceLabel = confirmed.get(rule.sourceQuestionId);
    if (sourceLabel !== rule.whenLabel) continue;
    if (confirmed.has(rule.targetQuestionId)) continue;
    const zero = zeroScoreOption(target.item);
    out.push({
      questionId: rule.targetQuestionId,
      optionLabel: zero.label,
      score: zero.score,
      rawText: `复用「${source.scaleName}」第${source.item.no}题：${sourceLabel} → 按 01 表复用规则回填「${zero.label}」`,
    });
  }
  return out;
}
