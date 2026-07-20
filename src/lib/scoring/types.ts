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
  /**
   * 被豁免计分的"医生题" id（测量/临床观察类），仅 deferClinical 模式下可能非空：
   * 这些题未参与计分，对应量表结论为部分计分，报告页须如实标注。
   */
  deferred: string[];
  tags: AssessmentTag[];
}

/**
 * 评分选项。Demo 口径（2026-07-20 用户拍板）：患者自助答完一律先出报告，
 * 医生检查题（舌象/BMI/腹围/小腿围等测量或临床观察题）暂不计分——
 * 传 deferClinical=true 时这些题缺失不再阻断评分，忽略其分值并在 deferred 中列明；
 * 普通问答题缺失（如"待人工确认"未补录）在任何模式下都阻断评分。
 */
export interface ScoreOptions {
  deferClinical?: boolean;
}
