/**
 * INPUT:  sumRange 判定配置（judgments-v2.json）、条目标准答案
 * OUTPUT: 总分区间判定结果（ADL/IADL/FRAIL/MNA-SF/Mini-Cog）
 * POS:    V2 评分引擎判定器之一。来源：02 表各量表「总分N～M分」判定规则。
 */
import type { ScaleV2, SumRangeJudgmentV2 } from "@/lib/rules/v2";
import { excludedDetail, partitionMissingV2, resolveAnswerScore, tagResult } from "./common";
import type { AnswersV2, ItemScoreDetail, ScaleScoreResultV2, ScoreOptionsV2 } from "./types";

/** 按总分落入的区间取评估标签（区间在 judgments-v2.json 照抄 02 表，校验段保证覆盖全部合法总分） */
export function resolveSumRangeTagV2(judgment: SumRangeJudgmentV2, total: number): string {
  const hit = judgment.ranges.find((r) => total >= r.min && total <= r.max);
  if (!hit) throw new Error(`总分 ${total} 未命中任何判定区间（判定配置异常）`);
  return hit.tagCode;
}

export function scoreSumRange(
  scale: ScaleV2,
  judgment: SumRangeJudgmentV2,
  answers: AnswersV2,
  opts: ScoreOptionsV2
): ScaleScoreResultV2 {
  const scoredIds = new Set(judgment.scoredItemIds);
  const details: ItemScoreDetail[] = [];
  const missingIds: string[] = [];
  let total = 0;

  for (const item of scale.items) {
    if (!scoredIds.has(item.id)) {
      // 不计分条目（如 Mini-Cog 第 1 题记忆指令，来源：01 表 optionsRaw「不计入量表总分」）：缺失不阻断
      details.push(excludedDetail(item));
      continue;
    }
    const answer = answers[item.id];
    if (answer === undefined || answer.kind === "na") {
      // 无答案 / 显式不适用：按缺失处理（sumRange 不适用 N/A 剔除，该语义仅 tcmConstitutionV2 有）
      missingIds.push(item.id);
      details.push({ itemId: item.id, no: item.no, text: item.text, answerLabel: null, score: null, excluded: false });
      continue;
    }
    const resolved = resolveAnswerScore(item, answer);
    if (resolved.na) {
      // 命中无分选项（score=null）：sumRange 计分条目不允许空分，属数据异常
      throw new Error(`条目 ${item.id} 命中无分选项「${resolved.answerLabel}」，sumRange 无法计分`);
    }
    total += resolved.score!;
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
    totalScore: ok ? total : null,
    // 豁免计分时阈值不变，按已答题目累加后判定（口径对齐旧引擎 deferClinical）
    tags: ok ? [tagResult(resolveSumRangeTagV2(judgment, total))] : [],
    details,
    partial: deferred.length > 0,
  };
}
