/**
 * INPUT:  无（纯类型定义）
 * OUTPUT: V2 评分引擎的公共类型（答案、标签结果、条目得分明细、量表评分结果）
 * POS:    src/lib/scoring-v2 的类型收口，引擎各判定器与调用方共用。
 */

/** 标准答案：option=命中某选项 label；number=数值题（预留 M9）；na=不适用（如湿热质性别互斥题） */
export type AnswerValue =
  | { kind: "option"; label: string }
  | { kind: "number"; value: number }
  | { kind: "na" };

/** key = 条目 id（data/scales-v2.json 的 item id） */
export type AnswersV2 = Record<string, AnswerValue>;

export interface TagResultV2 {
  code: string;
  name: string;
}

export interface ItemScoreDetail {
  itemId: string;
  no: string;
  text: string;
  /** 命中的选项 label；na/未答/不计分条目为 null（na 经选项命中时保留该 label 以便追溯） */
  answerLabel: string | null;
  /** 该题原有得分字段；未答/豁免/不适用/不计分为 null。反向计分题另存 rawScore/effectiveScore。 */
  score: number | null;
  /** true = 不参与计分：N/A 不适用，或本来就不计分的条目（如 Mini-Cog 第 1 题记忆指令、中医纯复用行） */
  excluded: boolean;
  /** 患者/医生给出的原始分值；当前仅反向计分题由评分器显式填充。 */
  rawScore?: number;
  /** 参与判定的有效分值；当前仅反向计分题由评分器显式填充。 */
  effectiveScore?: number;
  /** 是否按规则反向计分；当前仅反向计分题由评分器显式填充。 */
  reversed?: boolean;
}

/** 中医体质单体质计分明细（来源：02 表转化分判定规则；转化分保留 1 位小数） */
export interface ConstitutionScoreDetail {
  /** "balanced" 或偏颇体质 key（judgments-v2.json 定义） */
  key: string;
  /** 原始分合计（不适用题已剔除） */
  rawSum: number;
  /** 适用题数（N/A 题已剔除） */
  applicableCount: number;
  /** 转化分 = (原始分合计 − 适用题数) / (适用题数 × 4) × 100，保留 1 位小数 */
  transformedScore: number;
  /** 该体质命中的标签编码 */
  tagCode: string;
}

export interface ScaleScoreResultV2 {
  scaleId: string;
  /** 无阻断缺失且无 blockedReason 时为 true，此时 tags/totalScore 有效 */
  ok: boolean;
  /** 阻断评分的缺失条目（普通问答题缺失在任何模式下都阻断） */
  missing: string[];
  /** deferClinical 模式下豁免计分的临床/系统类缺失条目 */
  deferred: string[];
  /** 总分；tcmConstitutionV2 无单一总分恒为 null；ok=false 时为 null */
  totalScore: number | null;
  tags: TagResultV2[];
  details: ItemScoreDetail[];
  /** true = 有豁免计分条目（部分计分报告，阈值不变、按已答题计分） */
  partial: boolean;
  /** 仅 tcmConstitutionV2 输出：9 种体质的原始分/适用题数/转化分明细 */
  constitutions?: ConstitutionScoreDetail[];
  /**
   * 非条目缺失类阻断原因（如 thresholdByEducation 缺患者文化程度无法分层判定）。
   * 设置时 ok 恒为 false；missing 可能为空——此类阻断无法靠补录题目解决，需补档案。
   */
  blockedReason?: string;
}

export interface ScoreOptionsV2 {
  /** 临床/系统类条目缺失时豁免计分（对应旧引擎 deferClinical 口径） */
  deferClinical?: boolean;
  /** 患者文化程度（Patient.education）；仅 thresholdByEducation 判定器（MMSE）需要 */
  education?: string;
}
