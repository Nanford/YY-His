/**
 * INPUT:  data/scales-v2.json、data/result-tags.json、data/judgments-v2.json、
 *         data/intervention-scoring-v2.json、data/interventions-v2.json（V2 结构化医学规则）
 * OUTPUT: V2 规则数据的类型化实例与查询索引（量表/条目/标签/判定/干预/积分矩阵）
 * POS:    V2 规则数据的唯一读取入口。V2 评分/推荐引擎一律从这里取规则，
 *         禁止各处自行 import JSON。与 V1 入口 src/lib/rules/index.ts 完全独立，互不改写。
 */
import scalesV2Json from "@data/scales-v2.json";
import resultTagsJson from "@data/result-tags.json";
import judgmentsV2Json from "@data/judgments-v2.json";
import interventionScoringV2Json from "@data/intervention-scoring-v2.json";
import interventionsV2Json from "@data/interventions-v2.json";

// ---------- scales-v2.json（来源：V2/01_评估采集规则表.xlsx） ----------

export interface ScaleItemOptionV2 {
  label: string;
  /** 无分选项（如「不适用（非女性）」、筛查是/否）为 null */
  score: number | null;
}

export interface ScaleItemV2 {
  id: string;
  row: number;
  no: string;
  /** 条目类型全集见 convert-rules-v2.ts ENTRY_TYPES（正式问题/系统读取/逻辑计算/绘图操作/医护观察…） */
  entryType: string;
  text: string;
  optionsRaw: string;
  /** 尽力解析的选项；解不出为 null（原文在 optionsRaw 保留） */
  options: ScaleItemOptionV2[] | null;
  variableCode: string | null;
  reuseRule: string | null;
}

export interface ScaleV2 {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  items: ScaleItemV2[];
}

export interface NarrationV2 {
  id: string;
  row: number;
  entryType: string;
  category: string;
  scaleId: string | null;
  text: string;
}

// ---------- result-tags.json（来源：V2/02_结果标签判定表.xlsx） ----------

export interface ResultTagV2 {
  code: string;
  name: string;
  scaleName: string;
  /** 判定规则原文（展示与追溯用；机器判定以 judgments-v2.json 为准） */
  rule: string;
  placeholder: boolean;
}

// ---------- judgments-v2.json（02 表判定规则的手工整理，医学核心） ----------

export interface SumRangeJudgmentV2 {
  type: "sumRange";
  scoredItemIds: string[];
  /** 总分区间 → 标签；区间不重叠且覆盖 [0, 满分]，校验段保证 */
  ranges: { tagCode: string; min: number; max: number }[];
}

export interface AnyYesJudgmentV2 {
  type: "anyYes";
  scoredItemIds: string[];
  /** 命中即判「是」的选项 label（须为每个计分条目的合法选项） */
  yesLabels: string[];
  positiveTagCode: string;
  negativeTagCode: string;
}

export interface TcmThresholdsV2 {
  biasedYesMin: number;
  biasedTendencyMin: number;
  balancedMin: number;
  othersMaxForYes: number;
  othersMaxForBasically: number;
}

export interface TcmConstitutionJudgmentV2 {
  type: "tcmConstitutionV2";
  thresholds: TcmThresholdsV2;
  balanced: {
    questionIds: string[];
    /** 负向题（按 6−原始分 反向计分，来源：国标 CCMQ 平和质负向题反向计分口径）；必须是 questionIds 子集 */
    reverseItemIds?: string[];
    tagCodes: { yes: string; basically: string; no: string };
  };
  biased: {
    key: string;
    questionIds: string[];
    tagCodes: { yes: string; tendency: string; no: string };
  }[];
}

/**
 * 按文化程度分层阈值判定（MMSE 专用，来源：02 表 MMSE 判定规则）。
 * 总分 > 本档界值 → normalTagCode；≤ 界值 → declineTagCode。
 * 四档 key 的枚举值映射见 src/lib/scoring-v2/education.ts（EDUCATION_BANDS）。
 */
export interface ThresholdByEducationJudgmentV2 {
  type: "thresholdByEducation";
  scoredItemIds: string[];
  /** 四档文化程度的正常界值（illiterate 文盲 / primary 小学 / secondary 初中·高中中专技校 / college 大专及以上） */
  educationThresholds: Record<"illiterate" | "primary" | "secondary" | "college", number>;
  normalTagCode: string;
  declineTagCode: string;
}

/**
 * 单题标签判定（M10.3b 新增，来源：02 表「第N题回答『x』」类判定规则）。
 * 指定条目命中指定选项 label → 产出对应标签；未命中/未答（含 deferClinical 被豁免）不产出。
 * 与 sumRange/anyYes 组合在同一量表内使用（如 fall_3q：anyYes 出阴阳性 + 本判定出 3 个单题标签）。
 */
export interface PerQuestionTagsJudgmentV2 {
  type: "perQuestionTags";
  rules: { itemId: string; whenLabel: string; tagCode: string }[];
}

/**
 * 阶梯计分（M10.3b-2 新增，来源：02 表视力/听力简易评估）。
 * 按 stepItemIds 顺序推进：命中有分值选项即取该分结束；命中无分"继续"选项进入下一题。
 */
export interface LadderScoreJudgmentV2 {
  type: "ladderScore";
  stepItemIds: string[];
  ranges: { tagCode: string; min: number; max: number }[];
}

/**
 * 任一条目得分低于阈值 → 阳性（M10.3b-2 新增，来源：02 表耳语试验双侧词数）。
 */
export interface AnyBelowThresholdJudgmentV2 {
  type: "anyBelowThreshold";
  scoredItemIds: string[];
  /** 得分 < threshold 判阳性（耳语：正确复述词数 < 3） */
  threshold: number;
  positiveTagCode: string;
  negativeTagCode: string;
}

/**
 * 初筛 anyYes 门控 + 阳性时终筛 sumRange（M10.3b-2 新增，来源：02 表 NRS2002）。
 * 初筛全否 → 只出初筛阴性、终筛不要求；任一是 → 初筛阳性 + 终筛区间标签。
 */
export interface InitialGateSumRangeJudgmentV2 {
  type: "initialGateSumRange";
  initialItemIds: string[];
  yesLabels: string[];
  initialPositiveTagCode: string;
  initialNegativeTagCode: string;
  finalScoredItemIds: string[];
  finalRanges: { tagCode: string; min: number; max: number }[];
}

/**
 * 组合布尔判定（M10.3b-2 新增，来源：02 表 CAM/GLIM）。
 * groups 之间 AND；组内 anyOf 任一 label 命中即该组通过。
 * 全部通过 → positiveTagCode；否则 → negativeTagCode。
 * 可选 severeWhen：阳性且 severe 条件命中时改出 severeTagCode。
 */
export interface CompositeAllAnyJudgmentV2 {
  type: "compositeAllAny";
  groups: { anyOf: { itemId: string; labels: string[] }[] }[];
  positiveTagCode: string;
  negativeTagCode: string;
  severeWhen?: { anyOf: { itemId: string; labels: string[] }[] };
  severeTagCode?: string;
}

export type JudgmentV2 =
  | SumRangeJudgmentV2
  | AnyYesJudgmentV2
  | TcmConstitutionJudgmentV2
  | ThresholdByEducationJudgmentV2
  | PerQuestionTagsJudgmentV2
  | LadderScoreJudgmentV2
  | AnyBelowThresholdJudgmentV2
  | InitialGateSumRangeJudgmentV2
  | CompositeAllAnyJudgmentV2;

export interface ScaleJudgmentV2 {
  scaleId: string;
  /**
   * 一个量表 1～N 份判定配置（M10.3b 由单份 judgment 扩展为数组）：
   * scoreScaleV2 依次执行每份判定并合并结果——tags 拼接去重、missing/deferred 按条目共集、
   * details 按 itemId 合并去重、totalScore 取首个有总分的判定（当前配置一个量表至多一份带总分判定）。
   */
  judgments: JudgmentV2[];
}

// ---------- interventions-v2.json / intervention-scoring-v2.json（M8 推荐引擎用，此处先收口类型） ----------

export interface InterventionV2 {
  code: string;
  name: string;
  category: string;
  display: string;
  mediaType: string;
  content: string;
  mediaSrc: string | null;
  mediaAvailable: boolean;
}

export interface ScoringCategoryV2 {
  key: string;
  label: string;
  codePrefix: string;
  count: number;
  mediaType: string;
}

// ---------- 数据实例 ----------

export const scalesV2 = scalesV2Json.scales as unknown as ScaleV2[];
export const narrationsV2 = scalesV2Json.narrations as unknown as NarrationV2[];
export const categoriesV2 = scalesV2Json.categories as string[];

export const resultTagsV2 = resultTagsJson.tags as unknown as ResultTagV2[];

/** 已配判定量表的判定配置（sumRange / anyYes / tcmConstitutionV2 / thresholdByEducation / perQuestionTags；每量表 1～N 份） */
export const judgmentsV2 = (judgmentsV2Json as unknown as { scales: ScaleJudgmentV2[] }).scales;

export const interventionsV2 = interventionsV2Json.interventions as unknown as InterventionV2[];
export const scoringCategoriesV2 = interventionScoringV2Json.categories as unknown as ScoringCategoryV2[];
/** V2 积分矩阵：matrix[评估标签编码][干预编码] = 匹配分。稀疏存储，未出现的对视为 0。来源：03 表 */
export const interventionScoreMatrixV2 = interventionScoringV2Json.matrix as Record<string, Record<string, number>>;

// ---------- 查询索引（模块加载时构建一次） ----------

export const scaleV2ById: ReadonlyMap<string, ScaleV2> = new Map(scalesV2.map((s) => [s.id, s]));

export const tagV2ByCode: ReadonlyMap<string, ResultTagV2> = new Map(resultTagsV2.map((t) => [t.code, t]));

export const judgmentByScaleId: ReadonlyMap<string, ScaleJudgmentV2> = new Map(
  judgmentsV2.map((j) => [j.scaleId, j])
);

export const interventionV2ByCode: ReadonlyMap<string, InterventionV2> = new Map(
  interventionsV2.map((i) => [i.code, i])
);
