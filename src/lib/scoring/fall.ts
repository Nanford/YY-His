/**
 * INPUT:  跌倒风险筛查 3 题标准答案（是=1/否=0）
 * OUTPUT: 评估标签：跌倒风险筛查阳性 / 跌倒风险筛查阴性
 * POS:    跌倒风险筛查评分器。纯函数，规则来源：量表题目_Demo.txt"三、跌倒风险筛查"。
 */
import { scaleById, type AnyYesJudgment } from "@/lib/rules";
import { collectScores } from "./common";
import type { AnswersByQuestionId, ScaleScoreResult } from "./types";

// 判定：任意一个问题回答"是"，即为跌倒风险筛查阳性。
// 三题必须全部作答后才出结论（需求文档：完成全部信息采集后统一分析）。
export function scoreFall(answers: AnswersByQuestionId): ScaleScoreResult {
  const scale = scaleById.get("fall")!;
  const { missing, details } = collectScores(scale, scale.questions, answers);
  if (missing.length > 0) {
    return { scaleId: scale.id, scaleName: scale.name, ok: false, missing, tags: [] };
  }
  const judgment = scale.judgment as AnyYesJudgment;
  const positiveCount = details.filter((d) => d.effectiveScore === 1).length;
  const tag = positiveCount > 0 ? judgment.positiveTag : judgment.negativeTag;
  return {
    scaleId: scale.id,
    scaleName: scale.name,
    ok: true,
    missing: [],
    tags: [{ tag, level: "是", scaleId: scale.id, score: positiveCount, detail: details }],
  };
}
