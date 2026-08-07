/**
 * INPUT:  thresholdByEducation 判定配置（judgments-v2.json）、条目标准答案、患者文化程度
 * OUTPUT: 按文化程度分层阈值的两档判定结果（MMSE）
 * POS:    V2 评分引擎判定器之一。来源：02 表 MMSE 判定规则——
 *         文盲 总分>17 / 小学（≤6年）>20 / 初中·高中·技校·中专 >22 / 大专及以上 >23 为
 *         「MMSE认知功能未见明显减退」，≤ 界值为「MMSE提示认知功能减退」。
 *         注：02 表另有 MMSE_UNABLE_TO_COMPLETE（无法完成足够条目）标签，
 *         属医生临床判断（严重听力/视力/语言/意识或配合问题），本配置不自动判定该标签。
 */
import type { ScaleV2, ThresholdByEducationJudgmentV2 } from "@/lib/rules/v2";
import { excludedDetail, partitionMissingV2, resolveAnswerScore, tagResult } from "./common";
import { educationBandOf } from "./education";
import type { AnswersV2, ItemScoreDetail, ScaleScoreResultV2, ScoreOptionsV2 } from "./types";

export function scoreThresholdByEducation(
  scale: ScaleV2,
  judgment: ThresholdByEducationJudgmentV2,
  answers: AnswersV2,
  opts: ScoreOptionsV2
): ScaleScoreResultV2 {
  // 计分与缺失分组与 sumRange 完全一致（MMSE 30 题各 1/0，无 N/A 语义）
  const scoredIds = new Set(judgment.scoredItemIds);
  const details: ItemScoreDetail[] = [];
  const missingIds: string[] = [];
  let total = 0;

  for (const item of scale.items) {
    if (!scoredIds.has(item.id)) {
      details.push(excludedDetail(item));
      continue;
    }
    const answer = answers[item.id];
    if (answer === undefined || answer.kind === "na") {
      missingIds.push(item.id);
      details.push({ itemId: item.id, no: item.no, text: item.text, answerLabel: null, score: null, excluded: false });
      continue;
    }
    const resolved = resolveAnswerScore(item, answer);
    if (resolved.na) {
      throw new Error(`条目 ${item.id} 命中无分选项「${resolved.answerLabel}」，thresholdByEducation 无法计分`);
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

  // 缺文化程度（或非法枚举值）无法分层判定：按阻断信息返回（非条目缺失，补录档案后可评）。
  // 条目缺失与文化程度缺失可能同时存在，missing 照实返回。
  const band = educationBandOf(opts.education);
  if (band === null) {
    return {
      scaleId: scale.id,
      ok: false,
      missing: blocking,
      deferred,
      totalScore: null,
      tags: [],
      details,
      partial: deferred.length > 0,
      blockedReason: `量表 ${scale.name} 需按患者文化程度分层判定，但档案缺少「文化程度」——请医生在患者档案中补录后再评`,
    };
  }

  // 来源：02 表——总分 > 本档界值 → 正常；≤ 界值 → 认知功能减退
  const threshold = judgment.educationThresholds[band];
  const ok = blocking.length === 0;
  return {
    scaleId: scale.id,
    ok,
    missing: blocking,
    deferred,
    totalScore: ok ? total : null,
    // 豁免计分时阈值不变，按已答题目累加后判定（口径对齐 sumRange 的 deferClinical）
    tags: ok ? [tagResult(total > threshold ? judgment.normalTagCode : judgment.declineTagCode)] : [],
    details,
    partial: deferred.length > 0,
  };
}
