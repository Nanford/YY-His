/**
 * INPUT:  MNA-SF 各题标准答案（A~E 必答；F 与 F替代 二选一）
 * OUTPUT: 评估标签：营养正常 / 存在营养不良风险 / 营养不良
 * POS:    MNA-SF 营养评估评分器。纯函数，规则来源：量表题目_Demo.txt"二、MNA-SF营养评估"。
 */
import { scaleById, type SumRangeJudgment } from "@/lib/rules";
import { collectScores, resolveSumRangeTag, sumOf } from "./common";
import type { AnswersByQuestionId, ScaleScoreResult } from "./types";

export function scoreMnasf(answers: AnswersByQuestionId): ScaleScoreResult {
  const scale = scaleById.get("mnasf")!;
  const fQuestion = scale.questions.find((q) => q.id === "mnasf_F")!;
  const fAltQuestion = scale.questions.find((q) => q.id === "mnasf_F_alt")!;
  const baseQuestions = scale.questions.filter((q) => q.id !== "mnasf_F" && q.id !== "mnasf_F_alt");

  const { missing, details } = collectScores(scale, baseQuestions, answers);

  // F 题分支：优先 BMI（F），无法得到 BMI 时用小腿围（F替代），二者取其一不叠加。
  // 来源：量表题目_Demo.txt"F替代. 如果无法得到BMI，用小腿围（CC）"
  const fQuestionToUse = answers["mnasf_F"] !== undefined ? fQuestion : fAltQuestion;
  const fResult = collectScores(scale, [fQuestionToUse], answers);
  if (fResult.missing.length > 0) {
    // F 与 F替代 都缺：标记 F 主题目缺失，医生端提示补录 BMI 或小腿围
    missing.push("mnasf_F");
  } else {
    details.push(...fResult.details);
  }

  if (missing.length > 0) {
    return { scaleId: scale.id, scaleName: scale.name, ok: false, missing, tags: [] };
  }
  const total = sumOf(details);
  const tag = resolveSumRangeTag(scale.judgment as SumRangeJudgment, total);
  return {
    scaleId: scale.id,
    scaleName: scale.name,
    ok: true,
    missing: [],
    tags: [{ tag, level: "是", scaleId: scale.id, score: total, detail: details }],
  };
}
