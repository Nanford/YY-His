/**
 * INPUT:  data/scales.json、data/tag-mapping.json、data/interventions.json（结构化医学规则）
 * OUTPUT: 类型化的规则数据与查询辅助（题目索引、映射索引、干预索引）
 * POS:    规则数据的唯一读取入口。评分/推荐/对话引擎一律从这里取规则，
 *         禁止各处自行 import JSON，保证类型定义与数据消费点一致。
 */
import scalesJson from "@data/scales.json";
import mappingJson from "@data/tag-mapping.json";
import interventionsJson from "@data/interventions.json";

// ---------- 类型定义（与 data/*.json 结构一一对应） ----------

export interface QuestionOption {
  label: string;
  score: number;
}

export interface ScaleQuestion {
  id: string;
  no: string;
  title: string;
  standardText: string;
  colloquialText: string;
  retryText: string;
  answerType: "boolean" | "choice" | "likert5";
  options?: QuestionOption[];
  /** 分值由测量数据换算：bmi=身高体重、waist=腹围、calf=小腿围 */
  measurement?: "bmi" | "waist" | "calf";
  /** 可由调查员/医生辅助观察填写（如舌象题） */
  observerAssisted?: boolean;
  /** 替代题：仅当被替代题无法作答时使用（MNA-SF F替代） */
  altOf?: string;
  /** 中医体质题对应的体质（仅展示用，判定以 judgment 为准） */
  constitutions?: string[];
}

export interface SumRangeJudgment {
  type: "sumRange";
  ranges: { tag: string; min: number; max: number }[];
}

export interface AnyYesJudgment {
  type: "anyYes";
  positiveTag: string;
  negativeTag: string;
}

export interface TcmJudgment {
  type: "tcmConstitution";
  biased: { tag: string; questionNos: number[] }[];
  biasedThresholds: { yesMin: number; tendencyMin: number; tendencyMax: number; noMax: number };
  pinghe: {
    tag: string;
    questionNos: number[];
    reverseNos: number[];
    totalMin: number;
    othersMaxForYes: number;
    othersMaxForBasicYes: number;
  };
}

export interface Scale {
  id: string;
  name: string;
  judgment: SumRangeJudgment | AnyYesJudgment | TcmJudgment;
  likertOptions?: QuestionOption[];
  questions: ScaleQuestion[];
}

export interface MappingEdge {
  assessmentTag: string;
  interventionTag: string;
}

export interface Intervention {
  tag: string;
  category: string;
  plan: string;
}

// ---------- 数据实例 ----------

export const scales = scalesJson.scales as unknown as Scale[];
export const mappingEdges = mappingJson.edges as MappingEdge[];
export const interventions = interventionsJson.interventions as Intervention[];
/** 三大类展示顺序，来源：需求文档"最终干预方案按照三大类进行展示" */
export const interventionCategories = interventionsJson.categories as string[];

// ---------- 查询索引（模块加载时构建一次） ----------

export const scaleById: ReadonlyMap<string, Scale> = new Map(scales.map((s) => [s.id, s]));

export const questionById: ReadonlyMap<string, ScaleQuestion> = new Map(
  scales.flatMap((s) => s.questions.map((q) => [q.id, q] as const))
);

/** 评估标签 → 干预标签列表（保持映射表原始顺序） */
export const interventionTagsByAssessmentTag: ReadonlyMap<string, string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const edge of mappingEdges) {
    const list = map.get(edge.assessmentTag) ?? [];
    list.push(edge.interventionTag);
    map.set(edge.assessmentTag, list);
  }
  return map;
})();

export const interventionByTag: ReadonlyMap<string, Intervention> = new Map(
  interventions.map((i) => [i.tag, i])
);

/** 取题目的可选项：likert5 题使用量表级通用 5 级选项 */
export function optionsOf(scale: Scale, question: ScaleQuestion): QuestionOption[] {
  if (question.answerType === "likert5") {
    // 来源：量表题目_Demo.txt"一般回答选项：1～5级"
    return scale.likertOptions ?? [];
  }
  return question.options ?? [];
}
