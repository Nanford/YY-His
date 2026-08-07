/**
 * INPUT:  compositeAllAny 判定配置（judgments-v2.json）、条目标准答案
 * OUTPUT: 组合布尔判定（CAM：特征1∧2∧(3∨4)；GLIM：表现型∨ ∧ 病因型∨，可升级重度）
 * POS:    V2 评分引擎判定器之一（M10.3b-2 新增）。来源：02 表 CAM/GLIM 组合规则。
 *         语义：groups 之间 AND；组内 anyOf 条目 label 命中任一即该组通过。
 *         全部通过 → positiveTagCode；否则 → negativeTagCode。
 *         若配置 severeWhen 且阳性时其 anyOf 也命中 → 改出 severeTagCode（替换阳性标签）。
 */
import type { CompositeAllAnyJudgmentV2, ScaleV2 } from "@/lib/rules/v2";
import { excludedDetail, partitionMissingV2, tagResult } from "./common";
import type { AnswersV2, ItemScoreDetail, ScaleScoreResultV2, ScoreOptionsV2 } from "./types";

function labelOf(
  scale: ScaleV2,
  itemId: string,
  answers: AnswersV2
): { missing: boolean; label: string | null } {
  const item = scale.items.find((i) => i.id === itemId);
  if (!item) throw new Error(`量表 ${scale.id} 无条目 ${itemId}（composite 配置异常）`);
  const answer = answers[itemId];
  if (answer === undefined || answer.kind !== "option") {
    return { missing: true, label: null };
  }
  if (item.options === null) {
    // 无 options 时仍接受配置中的 label（应在 convert 阶段补齐 options；兜底允许确定性匹配）
    return { missing: false, label: answer.label };
  }
  const hit = item.options.find((o) => o.label === answer.label);
  if (!hit) throw new Error(`条目 ${itemId} 的答案「${answer.label}」不在合法选项内`);
  return { missing: false, label: hit.label };
}

function anyOfHits(
  scale: ScaleV2,
  anyOf: { itemId: string; labels: string[] }[],
  answers: AnswersV2
): { missingIds: string[]; hit: boolean; answered: { itemId: string; label: string }[] } {
  const missingIds: string[] = [];
  const answered: { itemId: string; label: string }[] = [];
  let hit = false;
  for (const rule of anyOf) {
    const { missing, label } = labelOf(scale, rule.itemId, answers);
    if (missing) {
      missingIds.push(rule.itemId);
      continue;
    }
    answered.push({ itemId: rule.itemId, label: label! });
    if (rule.labels.includes(label!)) hit = true;
  }
  return { missingIds, hit, answered };
}

export function scoreCompositeAllAny(
  scale: ScaleV2,
  judgment: CompositeAllAnyJudgmentV2,
  answers: AnswersV2,
  opts: ScoreOptionsV2
): ScaleScoreResultV2 {
  const referenced = new Set<string>();
  for (const g of judgment.groups) {
    for (const r of g.anyOf) referenced.add(r.itemId);
  }
  if (judgment.severeWhen) {
    for (const r of judgment.severeWhen.anyOf) referenced.add(r.itemId);
  }

  const missingIds: string[] = [];
  const answeredLabels = new Map<string, string>();
  const groupHits: boolean[] = [];

  for (const group of judgment.groups) {
    const { missingIds: m, hit, answered } = anyOfHits(scale, group.anyOf, answers);
    for (const id of m) {
      if (!missingIds.includes(id)) missingIds.push(id);
    }
    for (const a of answered) answeredLabels.set(a.itemId, a.label);
    groupHits.push(hit);
  }

  // severeWhen 引用的条目也要纳入缺失检查（若尚未被 groups 覆盖）
  if (judgment.severeWhen) {
    const { missingIds: m, answered } = anyOfHits(scale, judgment.severeWhen.anyOf, answers);
    for (const id of m) {
      if (!missingIds.includes(id)) missingIds.push(id);
    }
    for (const a of answered) answeredLabels.set(a.itemId, a.label);
  }

  const details: ItemScoreDetail[] = [];
  for (const item of scale.items) {
    if (!referenced.has(item.id)) {
      details.push(excludedDetail(item));
      continue;
    }
    if (missingIds.includes(item.id) && !answeredLabels.has(item.id)) {
      details.push({
        itemId: item.id,
        no: item.no,
        text: item.text,
        answerLabel: null,
        score: null,
        excluded: false,
      });
      continue;
    }
    details.push({
      itemId: item.id,
      no: item.no,
      text: item.text,
      answerLabel: answeredLabels.get(item.id) ?? null,
      score: null,
      excluded: false,
    });
  }

  const { blocking, deferred } = partitionMissingV2(scale, missingIds, opts.deferClinical ?? false);
  const ok = blocking.length === 0;
  if (!ok) {
    return {
      scaleId: scale.id,
      ok: false,
      missing: blocking,
      deferred,
      totalScore: null,
      tags: [],
      details,
      partial: deferred.length > 0,
    };
  }

  // 缺失被豁免的条目：对应 anyOf 视为未命中（不因豁免而假阳性）
  const positive = groupHits.every(Boolean);
  let tagCode = positive ? judgment.positiveTagCode : judgment.negativeTagCode;
  if (positive && judgment.severeWhen && judgment.severeTagCode) {
    const { hit: severe } = anyOfHits(scale, judgment.severeWhen.anyOf, answers);
    if (severe) tagCode = judgment.severeTagCode;
  }

  return {
    scaleId: scale.id,
    ok: true,
    missing: [],
    deferred,
    totalScore: null,
    tags: [tagResult(tagCode)],
    details,
    partial: deferred.length > 0,
  };
}
