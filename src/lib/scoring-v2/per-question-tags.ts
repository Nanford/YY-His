/**
 * INPUT:  perQuestionTags 判定配置（judgments-v2.json）、条目标准答案
 * OUTPUT: 单题标签判定结果（跌倒三问单题标签、吞咽初筛 5 项、洼田饮水、ICIQ 漏尿情形、便秘症状等）
 * POS:    V2 评分引擎判定器之一（M10.3b 新增）。来源：02 表「第N题回答『x』→ 标签」类判定规则。
 *         语义：指定条目命中指定选项 label → 产出对应标签；未命中/未答（含 deferClinical 被豁免）不产出。
 *         只产"命中"标签，不产反向/阴性标签（阴性结论由 anyYes 等判定器在同量表另一份配置中产出）。
 */
import type { PerQuestionTagsJudgmentV2, ScaleV2 } from "@/lib/rules/v2";
import { excludedDetail, partitionMissingV2, tagResult } from "./common";
import type { AnswersV2, ItemScoreDetail, ScaleScoreResultV2, ScoreOptionsV2, TagResultV2 } from "./types";

export function scorePerQuestionTags(
  scale: ScaleV2,
  judgment: PerQuestionTagsJudgmentV2,
  answers: AnswersV2,
  opts: ScoreOptionsV2
): ScaleScoreResultV2 {
  const referencedIds = new Set(judgment.rules.map((r) => r.itemId));
  const details: ItemScoreDetail[] = [];
  const missingIds: string[] = [];
  const hitTagCodes: string[] = [];

  for (const item of scale.items) {
    if (!referencedIds.has(item.id)) {
      details.push(excludedDetail(item));
      continue;
    }
    const answer = answers[item.id];
    if (answer === undefined || answer.kind !== "option") {
      // 未答 / na / 数值答案：无法做 label 匹配，按缺失处理（正式问题阻断、临床/系统类可豁免）
      missingIds.push(item.id);
      details.push({ itemId: item.id, no: item.no, text: item.text, answerLabel: null, score: null, excluded: false });
      continue;
    }
    // 确定性红线：答案必须命中条目 options 中的某个 label
    const hit = (item.options ?? []).find((o) => o.label === answer.label);
    if (!hit) throw new Error(`条目 ${item.id} 的答案「${answer.label}」不在合法选项内`);
    for (const rule of judgment.rules) {
      if (rule.itemId === item.id && rule.whenLabel === hit.label && !hitTagCodes.includes(rule.tagCode)) {
        hitTagCodes.push(rule.tagCode);
      }
    }
    // 单题标签判定不计分，明细只记录命中 label
    details.push({ itemId: item.id, no: item.no, text: item.text, answerLabel: hit.label, score: null, excluded: false });
  }

  const { blocking, deferred } = partitionMissingV2(scale, missingIds, opts.deferClinical ?? false);
  const ok = blocking.length === 0;
  const tags: TagResultV2[] = ok ? hitTagCodes.map(tagResult) : [];
  return {
    scaleId: scale.id,
    ok,
    missing: blocking,
    deferred,
    totalScore: null,
    tags,
    details,
    partial: deferred.length > 0,
  };
}
