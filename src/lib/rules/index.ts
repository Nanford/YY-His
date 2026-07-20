/**
 * INPUT:  data/scales.json、data/tag-mapping.json、data/interventions.json（结构化医学规则）
 * OUTPUT: 类型化的规则数据与查询辅助（题目索引、映射索引、干预索引）
 * POS:    规则数据的唯一读取入口。评分/推荐/对话引擎一律从这里取规则，
 *         禁止各处自行 import JSON，保证类型定义与数据消费点一致。
 */
import scalesJson from "@data/scales.json";
import mappingJson from "@data/tag-mapping.json";
import interventionsJson from "@data/interventions.json";
import interventionScoringJson from "@data/intervention-scoring.json";

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
  /** 量表级作答/判定说明（展示用） */
  answerNote?: string;
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

// ---------- V2 积分推荐数据类型（来源：data/intervention-scoring.json） ----------

/** 单个干预项元数据（30 项：运动 M01-M12 / 膳食 D01-D10 / 中医食养 C01-C08） */
export interface InterventionItem {
  /** 稳定编码，素材关联的唯一标识（不随文案调整变化） */
  code: string;
  /** 三大类展示标签：运动干预 / 膳食干预 / 中医食养干预 */
  category: string;
  name: string;
  /** 展示形态：运动=视频教程（视频缺失回退文字要点）；膳食/中医食养=图文教程 */
  mediaType: "video" | "image";
  /** Web 可访问素材路径：/interventions/videos/M06.mp4 或 /interventions/D03.png */
  mediaSrc: string;
  /** 素材是否已就绪：图片恒 true；视频取决于是否已放入 public/interventions/videos（缺失则卡片回退文字） */
  mediaAvailable: boolean;
  /** 图片原始文件名（供医生端展示核对）；运动项为 null */
  sourceFile: string | null;
  /** 运动动作文字要点（来源：12种运动干预.docx）；图片项为 null（正文即图片） */
  text: string | null;
}

/** 三大类定义（固定展示顺序） */
export interface ScoringCategoryDef {
  key: string;
  label: string;
  codePrefix: string;
  mediaType: "video" | "image";
}

// ---------- 数据实例 ----------

export const scales = scalesJson.scales as unknown as Scale[];
export const mappingEdges = mappingJson.edges as MappingEdge[];
export const interventions = interventionsJson.interventions as Intervention[];
/** 三大类展示顺序，来源：需求文档"最终干预方案按照三大类进行展示" */
export const interventionCategories = interventionsJson.categories as string[];

// V2 积分推荐数据实例
/** 30 个干预项元数据（按类别 + 编码升序，展示顺序稳定） */
export const interventionItems = interventionScoringJson.interventions as InterventionItem[];
/** 三大类定义（固定展示顺序：运动干预 → 膳食干预 → 中医食养干预） */
export const scoringCategories = interventionScoringJson.categories as ScoringCategoryDef[];
/** 积分矩阵：matrix[评估标签名称][干预编码] = 匹配分（0-3）。来源：评估-干预标签积分规则表.xlsx */
export const interventionScoreMatrix = interventionScoringJson.matrix as Record<string, Record<string, number>>;
/** 干预编码 → 干预项元数据 */
export const interventionItemByCode: ReadonlyMap<string, InterventionItem> = new Map(
  interventionItems.map((i) => [i.code, i])
);

// ---------- 查询索引（模块加载时构建一次） ----------

export const scaleById: ReadonlyMap<string, Scale> = new Map(scales.map((s) => [s.id, s]));

export const questionById: ReadonlyMap<string, ScaleQuestion> = new Map(
  scales.flatMap((s) => s.questions.map((q) => [q.id, q] as const))
);

/** 题目 id → 所属量表（likert5 题取通用选项、按题定位量表时用） */
export const scaleByQuestionId: ReadonlyMap<string, Scale> = new Map(
  scales.flatMap((s) => s.questions.map((q) => [q.id, s] as const))
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
