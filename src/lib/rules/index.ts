/**
 * INPUT:  src/lib/rules/v2 的 V2 规则数据（scales-v2.json / judgments-v2.json / interventions-v2.json 等）
 * OUTPUT: 旧形状（Scale/ScaleQuestion/QuestionOption）的规则视图 + V2 干预/分类数据透传
 * POS:    运行时规则数据的唯一读取入口。M9-B 装机后：对话状态机/医生代填/页面层继续消费旧形状，
 *         本模块把 V2 采集编排数据（42 量表）投影为"已配判定的可评分量表 + 可问/可填题目"；
 *         评分与推荐走 src/lib/scoring-v2、src/lib/recommend-v2（V2 原生形状，不经本模块）。
 *         医学口径来源：V2/01_评估采集规则表.xlsx（条目类型/选项）、data/judgments-v2.json（判定）。
 */
import {
  judgmentsV2,
  scalesV2,
  interventionsV2,
  interventionV2ByCode,
  scoringCategoriesV2,
  type ScaleV2,
  type ScaleItemV2,
  type InterventionV2,
  type ScoringCategoryV2,
} from "./v2";

// ---------- 旧形状类型（对话/代填/页面层的消费契约） ----------

export interface QuestionOption {
  label: string;
  score: number;
}

/**
 * 采集执行角色。patient_and_clinician 表示患者完成动作/回答，医护负责确认计分。
 * 来源：V2/01_评估采集规则表.xlsx 条目类型与患者自助 deferClinical 口径。
 */
export type CollectionRole = "patient" | "system" | "clinician" | "patient_and_clinician";

/** 采集交互形式；unknown 只用于题库未配置的条目，禁止按猜测进入患者端。 */
export type InteractionMode =
  | "question"
  | "instruction"
  | "drawing"
  | "picture"
  | "system_read"
  | "logic"
  | "observation"
  | "verification"
  | "measurement"
  | "unknown";

/** 患者端是否需要提交一个响应；none 表示只播报/展示后自动推进。 */
export type PatientResponseMode = "none" | "options" | "free_text" | "acknowledge" | "drawing";

/** 计分责任状态；configuration_missing 是显式配置缺失，不是默认答案。 */
export type JudgmentMode = "patient_answer" | "system" | "clinician" | "configuration_missing" | "not_scored";

/**
 * 作答题型（M9.6 扩展）：
 * - boolean/choice/likert5：大按钮单选（既有）
 * - number：数字输入（ICIQ 影响分 0～10、便秘每周次数等）
 * - multiChoice：多选（ICIQ 漏尿情形、GLIM 病因）
 * - imageChoice：图片参照选择（Bristol 大便分型）
 * - drawing：画钟等绘图（患者画 + 医生确认计分）
 */
export type AnswerType =
  | "boolean"
  | "choice"
  | "likert5"
  | "number"
  | "multiChoice"
  | "imageChoice"
  | "drawing";

export interface ScaleQuestion {
  id: string;
  no: string;
  title: string;
  /** 标准题面（V2 即 01 表自然语言内容，已是口语化题干） */
  standardText: string;
  /** 口语版首问文案（V2 与标准题面同源） */
  colloquialText: string;
  /** 换说法复问文案（V2 暂与题面同源，后续预生成换说法后替换） */
  retryText: string;
  answerType: AnswerType;
  options?: QuestionOption[];
  /** number 题的合法分值范围（来自 options 分值） */
  numberMin?: number;
  numberMax?: number;
  /** imageChoice 参照图（public 路径） */
  imageSrc?: string;
  /** 需医生/系统侧处理的计分条目（系统读取/逻辑计算/操作测试/医护观察等）：
   *  旧字段保留给医生端/历史调用方；患者端是否进入时间线以采集语义字段为准。 */
  observerAssisted?: boolean;
  /** V2 条目类型原文（系统读取/逻辑计算/正式问题…），代填界面展示用 */
  entryType?: string;
  /** 执行角色：不要再用 entryType 反推患者端是否静默跳过。 */
  collectionRole: CollectionRole;
  /** 交互形式：问题、指令、绘图、图片识别或系统/医护处理。 */
  interactionMode: InteractionMode;
  /** 是否属于当前判定配置引用的计分条目；与是否进入患者时间线独立。 */
  isScored: boolean;
  /** 是否应进入患者采集时间线；未计分的记忆指令也可以为 true。 */
  inTimeline: boolean;
  /** 患者端响应形式；none 表示仅播报/展示，不生成答案。 */
  patientResponseMode: PatientResponseMode;
  /** 计分由谁负责；MMSE 等需外部标准答案的题目明确标为 clinician。 */
  judgmentMode: JudgmentMode;
}

/** 多选答案 label 连接符（存储于 Answer.optionLabel，判定时拆分） */
export const MULTI_CHOICE_SEP = " || ";

export interface Scale {
  id: string;
  name: string;
  /** 量表级作答/判定说明（展示用） */
  answerNote?: string;
  likertOptions?: QuestionOption[];
  questions: ScaleQuestion[];
}

// ---------- V2 投影：已配判定（judgments-v2.json）的量表 → 旧形状 ----------

/** 量表计分条目 id 集合（来源：data/judgments-v2.json；纯复用行/记忆指令等不计分条目不在内）。
 *  M10.3b 起一个量表可多份判定：取各份判定引用条目的并集（perQuestionTags 取其 rules 的 itemId） */
function scoredItemIdsOf(scaleId: string): ReadonlySet<string> {
  const entry = judgmentsV2.find((j) => j.scaleId === scaleId);
  if (!entry) throw new Error(`量表 ${scaleId} 无判定配置（data/judgments-v2.json 未收录）`);
  const ids = new Set<string>();
  for (const j of entry.judgments) {
    if (j.type === "tcmConstitutionV2") {
      for (const id of [...j.balanced.questionIds, ...j.biased.flatMap((b) => b.questionIds)]) ids.add(id);
    } else if (j.type === "perQuestionTags") {
      for (const rule of j.rules) ids.add(rule.itemId);
    } else if (j.type === "ladderScore") {
      for (const id of j.stepItemIds) ids.add(id);
    } else if (j.type === "initialGateSumRange") {
      for (const id of [...j.initialItemIds, ...j.finalScoredItemIds]) ids.add(id);
    } else if (j.type === "compositeAllAny") {
      for (const g of j.groups) {
        for (const r of g.anyOf) ids.add(r.itemId);
      }
      if (j.severeWhen) {
        for (const r of j.severeWhen.anyOf) ids.add(r.itemId);
      }
    } else {
      // sumRange / anyYes / thresholdByEducation / anyBelowThreshold
      for (const id of j.scoredItemIds) ids.add(id);
    }
  }
  return ids;
}

/** 无分选项（score=null，如筛查是/否）派生兼容分值：仅用于旧管道存储/展示，判定以 scoring-v2 的 label 匹配为准 */
function compatScore(label: string, score: number | null): number {
  if (score !== null) return score;
  return label.startsWith("是") ? 1 : 0;
}

/** 展示用短标题：取题面第一个分句（限长），长题面在明细表里仍看 standardText 全文 */
function shortTitle(text: string): string {
  const first = text.split(/[，。；？?]/)[0] ?? text;
  return first.length > 24 ? `${first.slice(0, 24)}…` : first;
}

/** 从条目形态推断作答题型（M9.6；医学选项仍以 scales-v2 options 为准） */
function detectAnswerType(item: ScaleItemV2): AnswerType {
  if (item.entryType === "绘图操作") return "drawing";
  // Bristol 大便分型：便秘症状表 Q9
  if (item.id === "constipation_symptom_9") return "imageChoice";
  if (item.optionsRaw.includes("可多选")) return "multiChoice";
  // 数字选择题：选项为连续整数分值且题干/原文提示数值区间
  if (
    item.id === "iciq_3" ||
    item.id === "constipation_symptom_3" ||
    item.id === "pain_nrs_1"
  ) {
    return "number";
  }
  const options = item.options ?? [];
  const isBoolean =
    options.length === 2 &&
    options[0].label.startsWith("是") &&
    options[1].label.startsWith("否");
  if (isBoolean) return "boolean";
  return "choice";
}

interface CollectionSemantics {
  collectionRole: CollectionRole;
  interactionMode: InteractionMode;
  inTimeline: boolean;
  patientResponseMode: PatientResponseMode;
  judgmentMode: JudgmentMode;
}

/**
 * 识别“选项本身就是正确性判断”的题目。
 * 这些选项是医护评分工具语义，不是患者可自评的答案；MMSE 全量使用机构/医护判定。
 */
function needsClinicianJudgment(scaleId: string, item: ScaleItemV2): boolean {
  if (scaleId === "mmse") return true;
  return (item.options ?? []).some((option) =>
    /回答正确|回答错误|正确复述|错误或未复述|正确完成|错误或未完成|未正确执行|其他答案|未说出|完整准确|正确复制/.test(
      option.label
    )
  );
}

/**
 * V2 采集语义映射。
 * 重要边界：已知的患者可执行非正式条目进入时间线；只有明确的系统/医护条目才静默不问；
 * 未知条目类型进入 configuration_missing，避免用默认答案掩盖题库配置缺口。
 */
function semanticsOf(scaleId: string, item: ScaleItemV2, isScored: boolean): CollectionSemantics {
  const clinicianJudgment = needsClinicianJudgment(scaleId, item);
  const missingConfiguration = isScored && item.options === null;
  const judgmentMode: JudgmentMode = missingConfiguration
    ? "configuration_missing"
    : clinicianJudgment
      ? "clinician"
      : isScored
        ? "patient_answer"
        : "not_scored";

  // 01 表将部分中医复用行写成“正式问题”，但复用规则明确“不重复提问”；
  // 这类行只承担变量映射，答案由 reuse 注册表回填，不能再次进入患者时间线。
  if (!isScored && item.reuseRule?.includes("不重复提问")) {
    return {
      collectionRole: "system",
      interactionMode: "system_read",
      inTimeline: false,
      patientResponseMode: "none",
      judgmentMode: "not_scored",
    };
  }

  switch (item.entryType) {
    case "正式问题":
      return {
        collectionRole: clinicianJudgment ? "patient_and_clinician" : "patient",
        interactionMode: "question",
        inTimeline: true,
        // 便秘病程等非计分开放题没有标准选项，只采集原话并确认已记录，不交给 LLM 猜选项。
        patientResponseMode: clinicianJudgment || item.options === null ? "free_text" : "options",
        judgmentMode,
      };
    case "记忆指令":
      return {
        collectionRole: isScored ? "patient_and_clinician" : "patient",
        interactionMode: "instruction",
        inTimeline: true,
        patientResponseMode: isScored ? "free_text" : "none",
        judgmentMode,
      };
    case "绘图操作":
      return {
        collectionRole: "patient_and_clinician",
        interactionMode: "drawing",
        inTimeline: true,
        patientResponseMode: "drawing",
        judgmentMode: "clinician",
      };
    case "图片识别":
      return {
        collectionRole: "patient_and_clinician",
        interactionMode: "picture",
        inTimeline: true,
        patientResponseMode: "free_text",
        judgmentMode: "clinician",
      };
    case "操作指令":
      return {
        collectionRole: "patient_and_clinician",
        interactionMode: "instruction",
        inTimeline: true,
        patientResponseMode: "acknowledge",
        judgmentMode: "clinician",
      };
    case "系统读取":
      return {
        collectionRole: "system",
        interactionMode: "system_read",
        inTimeline: false,
        patientResponseMode: "none",
        judgmentMode: "system",
      };
    case "逻辑计算":
      return {
        collectionRole: "system",
        interactionMode: "logic",
        inTimeline: false,
        patientResponseMode: "none",
        judgmentMode: "system",
      };
    case "操作测试":
      return {
        collectionRole: "clinician",
        interactionMode: "observation",
        inTimeline: false,
        patientResponseMode: "none",
        judgmentMode: "clinician",
      };
    case "医护观察":
      return {
        collectionRole: "clinician",
        interactionMode: "observation",
        inTimeline: false,
        patientResponseMode: "none",
        judgmentMode: "clinician",
      };
    case "医护核对":
      return {
        collectionRole: "clinician",
        interactionMode: "verification",
        inTimeline: false,
        patientResponseMode: "none",
        judgmentMode: "clinician",
      };
    case "医护评估":
      return {
        collectionRole: "clinician",
        interactionMode: "observation",
        inTimeline: false,
        patientResponseMode: "none",
        judgmentMode: "clinician",
      };
    case "设备/人工测量":
      return {
        collectionRole: "clinician",
        interactionMode: "measurement",
        inTimeline: false,
        patientResponseMode: "none",
        judgmentMode: "clinician",
      };
    default:
      return {
        collectionRole: "clinician",
        interactionMode: "unknown",
        inTimeline: false,
        patientResponseMode: "none",
        judgmentMode: "configuration_missing",
      };
  }
}

function toScaleQuestion(item: ScaleItemV2, scaleId: string, isScored: boolean): ScaleQuestion {
  const options = (item.options ?? []).map((o) => ({ label: o.label, score: compatScore(o.label, o.score) }));
  const answerType = detectAnswerType(item);
  const scored = (item.options ?? []).map((o) => o.score).filter((s): s is number => s !== null);
  const semantics = semanticsOf(scaleId, item, isScored);
  // 兼容旧的医生端/补充评估派生口径：绘图操作虽需医护判定，但不等同于“需医生协助才能开始采集”。
  // 患者端不再读取该历史字段，改用下方显式采集语义决定是否入时间线及如何交互。
  const observerAssisted = item.entryType !== "正式问题" && item.entryType !== "绘图操作";
  return {
    id: item.id,
    no: item.no,
    title: shortTitle(item.text),
    standardText: item.text,
    colloquialText: item.text,
    retryText: item.text,
    answerType,
    options,
    numberMin: scored.length > 0 ? Math.min(...scored) : undefined,
    numberMax: scored.length > 0 ? Math.max(...scored) : undefined,
    imageSrc: answerType === "imageChoice" ? "/interventions/bristol-stool.webp" : undefined,
    observerAssisted,
    entryType: item.entryType,
    ...semantics,
    isScored,
  };
}

function toScale(scale: ScaleV2): Scale {
  const scoredIds = scoredItemIdsOf(scale.id);
  // 计分条目：有 options 的一律投影；绘图题 options 可解析时纳入
  const questions = scale.items
    .filter((item) => scoredIds.has(item.id) && item.options !== null)
    .map((item) => toScaleQuestion(item, scale.id, true));
  const hasClinical = questions.some((q) => q.observerAssisted);
  return {
    id: scale.id,
    name: scale.name,
    answerNote: hasClinical
      ? "含需医生评估/系统读取的计分条目，患者端不提问；缺失时按「部分计分」处理。"
      : undefined,
    questions,
  };
}

/**
 * 全量采集条目索引：与 Scale.questions（旧的“可代填计分题”视图）分开，
 * 允许无分的 Mini-Cog 记忆指令进入患者时间线，同时不改变医生端既有题目集合。
 */
export const collectionItemsByScale: ReadonlyMap<string, ScaleQuestion[]> = new Map(
  scalesV2.map((scale) => {
    const scoredIds = scoredItemIdsOf(scale.id);
    return [
      scale.id,
      scale.items.map((item) => toScaleQuestion(item, scale.id, scoredIds.has(item.id))),
    ] as const;
  })
);

/** 取量表全量采集条目；未知量表仍直接报错，保持旧入口的失败语义。 */
export function collectionItemsOf(scaleId: string): ScaleQuestion[] {
  const items = collectionItemsByScale.get(scaleId);
  if (!items) throw new Error(`未知量表：${scaleId}`);
  return items;
}

/** 可评分量表（已配判定的量表，M10.3b-2 起 42 个），顺序保持 01 表文档顺序 */
export const scales: Scale[] = scalesV2
  .filter((s) => judgmentsV2.some((j) => j.scaleId === s.id))
  .map(toScale);

// ---------- V2 干预/分类数据透传（页面层用，形状即 rules/v2 的 InterventionV2/ScoringCategoryV2） ----------

export type { InterventionV2, ScoringCategoryV2 };
/** 60 个干预项元数据（YD/SS/ZY/JZ/QT），按 04 表顺序 */
export const interventionItems = interventionsV2;
/** 干预编码 → 干预项元数据 */
export const interventionItemByCode = interventionV2ByCode;
/** 5 大类定义（固定展示顺序：运动干预 → 膳食营养 → 中医食养 → 就诊建议 → 其他） */
export const scoringCategories = scoringCategoriesV2;

// ---------- 查询索引（模块加载时构建一次） ----------

export const scaleById: ReadonlyMap<string, Scale> = new Map(scales.map((s) => [s.id, s]));

export const questionById: ReadonlyMap<string, ScaleQuestion> = new Map(
  scales.flatMap((s) => s.questions.map((q) => [q.id, q] as const))
);

/** 题目 id → 所属量表 */
export const scaleByQuestionId: ReadonlyMap<string, Scale> = new Map(
  scales.flatMap((s) => s.questions.map((q) => [q.id, s] as const))
);

/** 取题目的可选项（V2 投影后选项均在题目上；likertOptions 分支仅为类型兼容保留） */
export function optionsOf(scale: Scale, question: ScaleQuestion): QuestionOption[] {
  if (question.answerType === "likert5") {
    return scale.likertOptions ?? [];
  }
  return question.options ?? [];
}
