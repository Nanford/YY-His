/**
 * INPUT:  ladderScore 判定配置（judgments-v2.json）、条目标准答案
 * OUTPUT: 阶梯计分结果（视力/听力简易评估：命中有分档即结束，"不可以"档继续下一题）
 * POS:    V2 评分引擎判定器之一（M10.3b-2 新增）。来源：02 表视力/听力「评估得分＝N 分」判定。
 *         语义：按 stepItemIds 顺序推进——命中有分值选项立即取该分并停止；命中无分"继续"选项
 *         则进入下一题；最后一题必须落到有分值选项。总分用 ranges 映射标签（与 sumRange 同形）。
 */
import type { LadderScoreJudgmentV2, ScaleV2 } from "@/lib/rules/v2";
import { excludedDetail, itemOf, partitionMissingV2, resolveAnswerScore, tagResult } from "./common";
import { resolveSumRangeTagV2 } from "./sum-range";
import type { AnswersV2, ItemScoreDetail, ScaleScoreResultV2, ScoreOptionsV2 } from "./types";

export function scoreLadderScore(
  scale: ScaleV2,
  judgment: LadderScoreJudgmentV2,
  answers: AnswersV2,
  opts: ScoreOptionsV2
): ScaleScoreResultV2 {
  const stepSet = new Set(judgment.stepItemIds);
  const details: ItemScoreDetail[] = [];
  const missingIds: string[] = [];
  let total: number | null = null;
  let stopped = false;
  /** 阶梯中途缺题后，后续阶梯不再计分（避免"跳题取分"破坏阶梯语义） */
  let ladderBroken = false;

  for (const item of scale.items) {
    if (!stepSet.has(item.id)) {
      details.push(excludedDetail(item));
      continue;
    }
    if (stopped || ladderBroken) {
      // 阶梯已结束或已断：后续阶梯题按排除处理（不阻断、不计分）
      details.push(excludedDetail(item));
      continue;
    }
    const answer = answers[item.id];
    if (answer === undefined || answer.kind === "na") {
      missingIds.push(item.id);
      ladderBroken = true;
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
    if (resolved.na) {
      // 无分"继续"选项：推进下一阶梯
      details.push({
        itemId: item.id,
        no: item.no,
        text: item.text,
        answerLabel: resolved.answerLabel,
        score: null,
        excluded: false,
      });
      continue;
    }
    total = resolved.score;
    stopped = true;
    details.push({
      itemId: item.id,
      no: item.no,
      text: item.text,
      answerLabel: resolved.answerLabel,
      score: resolved.score,
      excluded: false,
    });
  }

  // 全部阶梯走完却未取到分：最后一题若答了"继续"属规则异常；若因缺失未完成则走 missing
  if (!stopped && missingIds.length === 0) {
    throw new Error(`量表 ${scale.id} 阶梯计分未落到任何有分值选项（判定配置或答案异常）`);
  }

  // 只把"尚未结束前"的缺失当作真实缺失；阶梯结束后的题已 excluded
  const { blocking, deferred } = partitionMissingV2(scale, missingIds, opts.deferClinical ?? false);
  const ok = blocking.length === 0 && total !== null;
  // 复用 sumRange 的区间解析（ranges 形状一致）；此处构造最小判定壳
  const tagCode =
    ok && total !== null
      ? resolveSumRangeTagV2(
          { type: "sumRange", scoredItemIds: judgment.stepItemIds, ranges: judgment.ranges },
          total
        )
      : null;

  // 校验 stepItemIds 都在量表内（配置异常尽早暴露）
  for (const id of judgment.stepItemIds) itemOf(scale, id);

  return {
    scaleId: scale.id,
    ok,
    missing: blocking,
    deferred,
    totalScore: ok ? total : null,
    tags: tagCode ? [tagResult(tagCode)] : [],
    details,
    partial: deferred.length > 0,
  };
}
