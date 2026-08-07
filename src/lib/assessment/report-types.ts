/**
 * INPUT:  无（纯类型定义）
 * OUTPUT: 评估结果/干预方案落库快照的形状（AssessmentResult.tags、InterventionPlan.candidates 的 JSON 契约）
 * POS:    M9-B 装机后的快照类型收口。评分引擎 V2 原生输出见 src/lib/scoring-v2/types.ts，
 *         本文件的 AssessmentTag 是面向报告页的"标签视图"（在 V2 标签编码之外保留旧报告的
 *         level 徽章语义：从 02 表标签名「气虚质：倾向是」拆出 base/level）。
 */

/** 判定级别。V2 里只有中医体质标签名带「是/倾向是/基本是」后缀，其余量表标签恒为"是" */
export type TagLevel = "是" | "倾向是" | "基本是";

/** 单题得分明细，供医生端标签下钻追溯（自 scoring-v2 的 ItemScoreDetail 投影） */
export interface QuestionScoreDetail {
  questionId: string;
  no: string;
  title: string;
  /** 患者/医生给出的原始分值 */
  rawScore: number;
  /** 参与判定的有效分值（V2 无反向计分题，恒等于 rawScore） */
  effectiveScore: number;
  /** 是否反向计分（V2 恒为 false，字段为报告页兼容保留） */
  reversed: boolean;
}

/** 一条评估标签及其可追溯的得分依据（AssessmentResult.tags 的元素形状） */
export interface AssessmentTag {
  /** 标签展示名（中医体质为去掉「：级别」后缀的体质名，其余为 02 表标签名原文） */
  tag: string;
  level: TagLevel;
  /** 02 表结果标签编码（干预推荐查矩阵、医生审核同类替换复算积分用） */
  code: string;
  scaleId: string;
  /** 判定所依据的得分：量表总分；中医体质为该体质转化分（保留 1 位小数） */
  score: number;
  detail: QuestionScoreDetail[];
}
