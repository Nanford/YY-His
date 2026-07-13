/**
 * INPUT:  无（纯类型定义）
 * OUTPUT: 评分引擎的输入/输出类型
 * POS:    评分引擎与上层（对话引擎、医生端、推荐引擎）之间的数据契约。
 */

/** 标准答案集合：题目 id → 标准分值（归一化/医生代填后的结果） */
export type AnswersByQuestionId = Readonly<Record<string, number>>;

/** 判定级别。FRAIL/MNA-SF/跌倒只产生"是"；中医体质另有"倾向是"（偏颇）与"基本是"（平和质） */
export type TagLevel = "是" | "倾向是" | "基本是";

/** 单题得分明细，供医生端标签下钻追溯 */
export interface QuestionScoreDetail {
  questionId: string;
  no: string;
  title: string;
  /** 患者/医生给出的原始分值 */
  rawScore: number;
  /** 参与判定的有效分值（平和质反向计分题为 6-rawScore，其余等于 rawScore） */
  effectiveScore: number;
  /** 是否反向计分（仅平和质题 2/4/5/13 为 true） */
  reversed: boolean;
}

/** 一条评估标签及其可追溯的得分依据 */
export interface AssessmentTag {
  tag: string;
  level: TagLevel;
  scaleId: string;
  /** 判定所依据的得分（量表总分或该体质小计） */
  score: number;
  detail: QuestionScoreDetail[];
}

/** 单个量表的评分结果 */
export interface ScaleScoreResult {
  scaleId: string;
  scaleName: string;
  /** 所有必答题均有标准答案时为 true；false 时 tags 恒为空 */
  ok: boolean;
  /** 缺失标准答案的题目 id（含待人工确认未补录的题） */
  missing: string[];
  tags: AssessmentTag[];
}
