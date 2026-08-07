/**
 * INPUT:  anyBelowThreshold 判定配置（judgments-v2.json）、条目标准答案
 * OUTPUT: 任一条目得分低于阈值 → 阳性，否则阴性（耳语试验双侧词数）
 * POS:    V2 评分引擎判定器之一（M10.3b-2 新增）。来源：02 表耳语试验
 *         「任一侧耳正确复述少于 3 个词 → 阳性」。
 */
import type { AnyBelowThresholdJudgmentV2, ScaleV2 } from "@/lib/rules/v2";
import { excludedDetail, partitionMissingV2, resolveAnswerScore, tagResult } from "./common";
import type { AnswersV2, ItemScoreDetail, ScaleScoreResultV2, ScoreOptionsV2 } from "./types";

export function scoreAnyBelowThreshold(
  scale: ScaleV2,
  judgment: AnyBelowThresholdJudgmentV2,
  answers: AnswersV2,
  opts: ScoreOptionsV2
): ScaleScoreResultV2 {
  const scoredIds = new Set(judgment.scoredItemIds);
  const details: ItemScoreDetail[] = [];
  const missingIds: string[] = [];
  let anyBelow = false;

  for (const item of scale.items) {
    if (!scoredIds.has(item.id)) {
      details.push(excludedDetail(item));
      continue;
    }
    const answer = answers[item.id];
    if (answer === undefined || answer.kind === "na") {
      missingIds.push(item.id);
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
    const resolved = resolveAnswerScore(item, answer);
    if (resolved.na || resolved.score === null) {
      throw new Error(`条目 ${item.id} 在 anyBelowThreshold 中命中无分选项，无法与阈值比较`);
    }
    if (resolved.score < judgment.threshold) anyBelow = true;
    details.push({
      itemId: item.id,
      no: item.no,
      text: item.text,
      answerLabel: resolved.answerLabel,
      score: resolved.score,
      excluded: false,
    });
  }

  const { blocking, deferred } = partitionMissingV2(scale, missingIds, opts.deferClinical ?? false);
  const ok = blocking.length === 0;
  return {
    scaleId: scale.id,
    ok,
    missing: blocking,
    deferred,
    totalScore: null,
    tags: ok
      ? [tagResult(anyBelow ? judgment.positiveTagCode : judgment.negativeTagCode)]
      : [],
    details,
    partial: deferred.length > 0,
  };
}
