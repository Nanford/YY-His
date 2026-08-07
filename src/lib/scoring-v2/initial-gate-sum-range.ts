/**
 * INPUT:  initialGateSumRange 判定配置（judgments-v2.json）、条目标准答案
 * OUTPUT: 初筛 anyYes + 阳性时再评终筛 sumRange（NRS2002）
 * POS:    V2 评分引擎判定器之一（M10.3b-2 新增）。来源：02 表 NRS2002
 *         「初筛 4 项均为否 → 初筛阴性（无需终筛）；任一是 → 初筛阳性并做终筛总分判定」。
 */
import type { InitialGateSumRangeJudgmentV2, ScaleV2 } from "@/lib/rules/v2";
import { excludedDetail, partitionMissingV2, resolveAnswerScore, tagResult } from "./common";
import { resolveSumRangeTagV2 } from "./sum-range";
import type { AnswersV2, ItemScoreDetail, ScaleScoreResultV2, ScoreOptionsV2, TagResultV2 } from "./types";

export function scoreInitialGateSumRange(
  scale: ScaleV2,
  judgment: InitialGateSumRangeJudgmentV2,
  answers: AnswersV2,
  opts: ScoreOptionsV2
): ScaleScoreResultV2 {
  const initialIds = new Set(judgment.initialItemIds);
  const finalIds = new Set(judgment.finalScoredItemIds);
  const details: ItemScoreDetail[] = [];
  const missingIds: string[] = [];
  let anyYes = false;

  // ---- 初筛 ----
  for (const item of scale.items) {
    if (!initialIds.has(item.id)) continue;
    const answer = answers[item.id];
    if (answer === undefined || answer.kind !== "option") {
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
    const hit = (item.options ?? []).find((o) => o.label === answer.label);
    if (!hit) throw new Error(`条目 ${item.id} 的答案「${answer.label}」不在合法选项内`);
    if (judgment.yesLabels.includes(hit.label)) anyYes = true;
    details.push({
      itemId: item.id,
      no: item.no,
      text: item.text,
      answerLabel: hit.label,
      score: hit.score,
      excluded: false,
    });
  }

  const initialPartition = partitionMissingV2(scale, missingIds, opts.deferClinical ?? false);
  if (initialPartition.blocking.length > 0) {
    // 初筛未齐：终筛条目仅占位 excluded，整体阻断
    for (const item of scale.items) {
      if (initialIds.has(item.id)) continue;
      if (finalIds.has(item.id)) {
        details.push({
          itemId: item.id,
          no: item.no,
          text: item.text,
          answerLabel: null,
          score: null,
          excluded: false,
        });
      } else if (!details.some((d) => d.itemId === item.id)) {
        details.push(excludedDetail(item));
      }
    }
    return {
      scaleId: scale.id,
      ok: false,
      missing: initialPartition.blocking,
      deferred: initialPartition.deferred,
      totalScore: null,
      tags: [],
      details,
      partial: initialPartition.deferred.length > 0,
    };
  }

  // 初筛齐全且全否：终筛不要求，直接出初筛阴性
  if (!anyYes) {
    for (const item of scale.items) {
      if (initialIds.has(item.id)) continue;
      details.push(excludedDetail(item));
    }
    return {
      scaleId: scale.id,
      ok: true,
      missing: [],
      deferred: initialPartition.deferred,
      totalScore: null,
      tags: [tagResult(judgment.initialNegativeTagCode)],
      details,
      partial: initialPartition.deferred.length > 0,
    };
  }

  // ---- 终筛 sumRange ----
  const finalMissing: string[] = [];
  let total = 0;
  for (const item of scale.items) {
    if (!finalIds.has(item.id)) {
      if (!initialIds.has(item.id) && !details.some((d) => d.itemId === item.id)) {
        details.push(excludedDetail(item));
      }
      continue;
    }
    const answer = answers[item.id];
    if (answer === undefined || answer.kind === "na") {
      finalMissing.push(item.id);
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
      throw new Error(`条目 ${item.id} 命中无分选项，initialGateSumRange 终筛无法计分`);
    }
    total += resolved.score;
    details.push({
      itemId: item.id,
      no: item.no,
      text: item.text,
      answerLabel: resolved.answerLabel,
      score: resolved.score,
      excluded: false,
    });
  }

  const finalPartition = partitionMissingV2(scale, finalMissing, opts.deferClinical ?? false);
  const deferred = [...initialPartition.deferred, ...finalPartition.deferred];
  const ok = finalPartition.blocking.length === 0;
  const tags: TagResultV2[] = [];
  if (ok) {
    tags.push(tagResult(judgment.initialPositiveTagCode));
    const finalTag = resolveSumRangeTagV2(
      {
        type: "sumRange",
        scoredItemIds: judgment.finalScoredItemIds,
        ranges: judgment.finalRanges,
      },
      total
    );
    tags.push(tagResult(finalTag));
  }

  return {
    scaleId: scale.id,
    ok,
    missing: finalPartition.blocking,
    deferred,
    totalScore: ok ? total : null,
    tags,
    details,
    partial: deferred.length > 0,
  };
}
