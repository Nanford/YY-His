/**
 * INPUT:  FRAIL 5 题标准答案（是=1/否=0）
 * OUTPUT: 评估标签：无衰弱 / 衰弱前期 / 衰弱
 * POS:    FRAIL 衰弱评估评分器。纯函数，规则来源：量表题目_Demo.txt"一、FRAIL衰弱评估"。
 */
import { scaleById, type SumRangeJudgment } from "@/lib/rules";
import { collectScores, resolveSumRangeTag, sumOf } from "./common";
import type { AnswersByQuestionId, ScaleScoreResult } from "./types";

// 判定：0项＝无衰弱；1～2项＝衰弱前期；≥3项＝衰弱（区间数据在 scales.json）
// FRAIL 无测量/观察类医生题，deferClinical 对结果无影响（scoreAll 传入的选项天然不会被用到）
export function scoreFrail(answers: AnswersByQuestionId): ScaleScoreResult {
  const scale = scaleById.get("frail")!;
  const { missing, details } = collectScores(scale, scale.questions, answers);
  if (missing.length > 0) {
    return { scaleId: scale.id, scaleName: scale.name, ok: false, missing, deferred: [], tags: [] };
  }
  const total = sumOf(details);
  const tag = resolveSumRangeTag(scale.judgment as SumRangeJudgment, total);
  return {
    scaleId: scale.id,
    scaleName: scale.name,
    ok: true,
    missing: [],
    deferred: [],
    tags: [{ tag, level: "是", scaleId: scale.id, score: total, detail: details }],
  };
}
