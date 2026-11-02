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
import { isFreeResponseItem } from "@/lib/dialogue/cognitive-flow";

// ---------- 旧形状类型（对话/代填/页面层的消费契约） ----------

export interface QuestionOption {
  label: string;
  score: number;
}

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
   *  患者端不提问，走医生端代填；缺失时按 deferClinical 口径豁免计分。
   *  例外：绘图操作（M9.6 患者可画，医生确认计分）仍向患者提问；
   *  词复述组 trigger 题（2026-08-13 认知题改版）虽为记忆指令仍向患者提问。 */
  observerAssisted?: boolean;
  /** V2 条目类型原文（系统读取/逻辑计算/正式问题…），代填界面展示用 */
  entryType?: string;
  /**
   * "free" = 自由回答题（2026-08-13 认知题改版，见 src/lib/dialogue/cognitive-flow.ts）：
   * 不向患者展示选项按钮（标准答案不泄露），语音/文字自由作答，
   * 由 LLM（规则兜底）把回答映射回既有标准选项，评分引擎零改动。
   */
  responseMode?: "free";
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

/**
 * 去掉题干中的流程注解（01 表跳题标注："可以（结束）、不可以（2）"等，仅 vision/hearing 阶梯题有）：
 * 注解是给采集流程看的，不应展示/播报给患者（2026-08-13 用户要求）；
 * 跳题行为由 state-machine.computeLadderSkips 按答案分值派生，与题干文本无关。
 * 评分引擎直接读 scales-v2.json 原文，不受本清理影响。
 */
function stripBranchAnnotations(text: string): string {
  return text
    .replace(/\s*可以（结束）、不可以(?:（结束）|（\d+）)[；;]?/g, "")
    // 01 表题号前缀（"2、"等，仅 vision/hearing 条目有）对患者无意义，一并剥除
    .replace(/^\d+、/, "")
    .trim();
}

/**
 * 患者端选项展示文案（2026-09-04 修改意见 1：选项里不要出现评分和备注，只给答案选择）。
 * 01 表选项 label 常带"（4分，结束听力评估）""（进入下一题）""（筛查阳性）"等注解——
 * 这些是给评分引擎/AI 归一化理解用的，不应展示也不应播报给患者。
 * 全量校验：42 量表 734 个选项剥除全部括号注后无空串、同题内无撞名（tests/display-option-label）。
 * 仅用于患者端展示与追问话术播报；提交/匹配/评分仍用原始 label（displayLabel 不改变数据流）。
 */
export function displayOptionLabel(label: string): string {
  return label.replace(/[（(][^（）()]*[)）]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * 题干展示文案覆盖（2026-08-13 用户要求：一次只问一个问题）。
 * vision_2 原文含 1-1（戴镜）/1-2（不戴镜）两个分支问句（因 vision_1 戴镜确认不在患者端提问），
 * 患者端合并为单一问句；戴镜口径已由 vision 量表前置旁白 narr_30 交代
 * （"平时戴眼镜的话，请按戴眼镜时的情况回答"）。医学语义不变，评分不受影响。
 */
const QUESTION_TEXT_OVERRIDES: ReadonlyMap<string, string> = new Map([
  ["vision_2", "您可以看清楚报纸或者书上的字吗？"],
]);

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

function toScaleQuestion(item: ScaleItemV2): ScaleQuestion {
  const options = (item.options ?? []).map((o) => ({ label: o.label, score: compatScore(o.label, o.score) }));
  const answerType = detectAnswerType(item);
  const scored = (item.options ?? []).map((o) => o.score).filter((s): s is number => s !== null);
  // 绘图操作向患者提问（画钟）；其余非正式问题仍走医生代填
  const observerAssisted = item.entryType !== "正式问题" && item.entryType !== "绘图操作";
  const text = stripBranchAnnotations(QUESTION_TEXT_OVERRIDES.get(item.id) ?? item.text);
  return {
    id: item.id,
    no: item.no,
    title: shortTitle(text),
    standardText: text,
    colloquialText: text,
    retryText: text,
    answerType,
    options,
    numberMin: scored.length > 0 ? Math.min(...scored) : undefined,
    numberMax: scored.length > 0 ? Math.max(...scored) : undefined,
    imageSrc: answerType === "imageChoice" ? "/interventions/bristol-stool.webp" : undefined,
    observerAssisted,
    entryType: item.entryType,
    responseMode: isFreeResponseItem(item.id) ? "free" : undefined,
  };
}

function toScale(scale: ScaleV2): Scale {
  const scoredIds = scoredItemIdsOf(scale.id);
  // 计分条目：有 options 的一律投影；绘图题 options 可解析时纳入
  const questions = scale.items
    .filter((item) => scoredIds.has(item.id) && item.options !== null)
    .map(toScaleQuestion);
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

/**
 * 量表名的口语化短名（2026-08-13 用户要求：开场点名说"听力评估"而不是"听力简易评估表"）：
 * 去掉"简易/简版"，书面前缀后缀归一（评估表/评估量表→评估、检查量表→检查、
 * 评定量表/评定简表→评定、问卷简表→问卷、筛查表→筛查、量表→去尾），括号内英文缩写保留。
 * 仅用于对患者播报/展示，医学数据与报告页仍用原始名称。
 *
 * 2026-09-04 修改意见 2/5：患者端不出现"智力"措辞——
 * 「简易智力评估量表」对患者称"认知功能筛查"；「简易智力状态检查量表（MMSE）」称"详细的认知功能评价"。
 */
const SCALE_SHORT_NAME_OVERRIDES: ReadonlyMap<string, string> = new Map([
  ["简易智力评估量表", "认知功能筛查"],
  ["简易智力状态检查量表（MMSE）", "详细的认知功能评价"],
]);

export function shortScaleName(name: string): string {
  const override = SCALE_SHORT_NAME_OVERRIDES.get(name);
  if (override) return override;
  const match = name.match(/^(.*?)(（[^）]*）)?$/);
  const base = (match?.[1] ?? name).replace(/简易|简版/g, "");
  const suffix = match?.[2] ?? "";
  const rules: [string, string][] = [
    ["评估表", "评估"],
    ["评估量表", "评估"],
    ["检查量表", "检查"],
    ["评定量表", "评定"],
    ["评定简表", "评定"],
    ["问卷简表", "问卷"],
    ["筛查表", "筛查"],
    ["量表", ""],
  ];
  for (const [from, to] of rules) {
    if (base.endsWith(from)) return base.slice(0, base.length - from.length) + to + suffix;
  }
  return base + suffix;
}
