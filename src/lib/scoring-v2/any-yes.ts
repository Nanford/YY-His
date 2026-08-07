/**
 * INPUT:  anyYes 判定配置（judgments-v2.json）、条目标准答案
 * OUTPUT: 任一是/全否两档判定结果（抑郁两问、焦虑两问）
 * POS:    V2 评分引擎判定器之一。来源：02 表「两题均回答『否』/任意一题回答『是』」。
 */
import type { AnyYesJudgmentV2, ScaleV2 } from "@/lib/rules/v2";
import { partitionMissingV2, tagResult } from "./common";
import type { AnswersV2, ItemScoreDetail, ScaleScoreResultV2, ScoreOptionsV2 } from "./types";

export function scoreAnyYes(
  scale: ScaleV2,
  judgment: AnyYesJudgmentV2,
  answers: AnswersV2,
  opts: ScoreOptionsV2
): ScaleScoreResultV2 {
  const scoredIds = new Set(judgment.scoredItemIds);
  const details: ItemScoreDetail[] = [];
  const missingIds: string[] = [];
  let anyYes = false;

  for (const item of scale.items) {
    if (!scoredIds.has(item.id)) {
      details.push({ itemId: item.id, no: item.no, text: item.text, answerLabel: null, score: null, excluded: true });
      continue;
    }
    const answer = answers[item.id];
    if (answer === undefined || answer.kind !== "option") {
      // anyYes 只认选项答案；na/number 无法判定是否，一律按缺失阻断（两问题目均为正式问题，无豁免）
      missingIds.push(item.id);
      details.push({ itemId: item.id, no: item.no, text: item.text, answerLabel: null, score: null, excluded: false });
      continue;
    }
    // 确定性红线：答案必须命中条目 options 中的某个 label
    const hit = (item.options ?? []).find((o) => o.label === answer.label);
    if (!hit) throw new Error(`条目 ${item.id} 的答案「${answer.label}」不在合法选项内`);
    if (judgment.yesLabels.includes(hit.label)) anyYes = true;
    // 两问题目选项本身无分值（score=null），明细只记录命中 label
    details.push({ itemId: item.id, no: item.no, text: item.text, answerLabel: hit.label, score: null, excluded: false });
  }

  const { blocking, deferred } = partitionMissingV2(scale, missingIds, opts.deferClinical ?? false);
  const ok = blocking.length === 0;
  return {
    scaleId: scale.id,
    ok,
    missing: blocking,
    deferred,
    totalScore: null,
    tags: ok ? [tagResult(anyYes ? judgment.positiveTagCode : judgment.negativeTagCode)] : [],
    details,
    partial: deferred.length > 0,
  };
}
