/**
 * INPUT:  会话勾选的量表 id 列表 + 全部标准答案
 * OUTPUT: 各量表评分结果与汇总的评估标签集合
 * POS:    评分引擎对外唯一入口（医学核心）。纯函数、确定性，大模型不得参与此层。
 */
import { scoreFrail } from "./frail";
import { scoreMnasf } from "./mnasf";
import { scoreFall } from "./fall";
import { scoreTcm } from "./tcm";
import type { AnswersByQuestionId, AssessmentTag, ScaleScoreResult, ScoreOptions } from "./types";

export type { AnswersByQuestionId, AssessmentTag, ScaleScoreResult, TagLevel, QuestionScoreDetail, ScoreOptions } from "./types";
export { scoreFrail, scoreMnasf, scoreFall, scoreTcm };

const scorers: Record<string, (answers: AnswersByQuestionId, opts?: ScoreOptions) => ScaleScoreResult> = {
  frail: scoreFrail,
  mnasf: scoreMnasf,
  fall: scoreFall,
  tcm: scoreTcm,
};

export interface ScoreAllResult {
  results: ScaleScoreResult[];
  /** 全部完成评分的量表产生的评估标签汇总（含体质多标签与"倾向"级） */
  tags: AssessmentTag[];
  /** 尚未完成的量表 id（存在缺失答案） */
  incompleteScaleIds: string[];
}

export function scoreAll(scaleIds: string[], answers: AnswersByQuestionId, opts?: ScoreOptions): ScoreAllResult {
  const results = scaleIds.map((id) => {
    const scorer = scorers[id];
    if (!scorer) {
      throw new Error(`未知量表 id：${id}`);
    }
    return scorer(answers, opts);
  });
  return {
    results,
    tags: results.flatMap((r) => r.tags),
    incompleteScaleIds: results.filter((r) => !r.ok).map((r) => r.scaleId),
  };
}
