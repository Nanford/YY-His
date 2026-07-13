/**
 * INPUT:  src/lib/rules（量表定义）、评分器传入的标准答案
 * OUTPUT: 各评分器共用的取分/校验/区间判定辅助函数
 * POS:    评分引擎内部工具，不对外导出业务结论。
 */
import { optionsOf, type Scale, type ScaleQuestion, type SumRangeJudgment } from "@/lib/rules";
import type { AnswersByQuestionId, QuestionScoreDetail } from "./types";

/**
 * 读取一批题目的分值并做合法性校验。
 * 分值必须命中题目选项定义中的某个 score——防止归一化层或代填层
 * 传入越界分值污染判定（医学正确性红线，宁可抛错不可带病计算）。
 */
export function collectScores(
  scale: Scale,
  questions: ScaleQuestion[],
  answers: AnswersByQuestionId
): { missing: string[]; details: QuestionScoreDetail[] } {
  const missing: string[] = [];
  const details: QuestionScoreDetail[] = [];
  for (const q of questions) {
    const raw = answers[q.id];
    if (raw === undefined) {
      missing.push(q.id);
      continue;
    }
    const allowed = optionsOf(scale, q).map((o) => o.score);
    if (!allowed.includes(raw)) {
      throw new Error(`题目 ${q.id} 的分值 ${raw} 不在合法选项 [${allowed.join(",")}] 内`);
    }
    details.push({
      questionId: q.id,
      no: q.no,
      title: q.title,
      rawScore: raw,
      effectiveScore: raw,
      reversed: false,
    });
  }
  return { missing, details };
}

/** 按总分落入的区间取评估标签。区间在 data/scales.json 中照抄源文件，必然覆盖全部合法总分 */
export function resolveSumRangeTag(judgment: SumRangeJudgment, total: number): string {
  const hit = judgment.ranges.find((r) => total >= r.min && total <= r.max);
  if (!hit) {
    throw new Error(`总分 ${total} 未命中任何判定区间（规则数据异常）`);
  }
  return hit.tag;
}

export function sumOf(details: QuestionScoreDetail[]): number {
  return details.reduce((acc, d) => acc + d.effectiveScore, 0);
}
