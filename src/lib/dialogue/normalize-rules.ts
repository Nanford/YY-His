/**
 * INPUT:  题目定义（src/lib/rules 的 ScaleQuestion + 选项）、患者原始回答文本
 * OUTPUT: normalizeByRules —— 纯函数规则解析（是/否、数字、选项关键词、likert5 频度词）
 * POS:    归一化的规则兜底层：DeepSeek 不可用或判断失败时的确定性解析。
 *         只做保守匹配，匹配不到一律返回 unclear，绝不猜测（AGENTS.md 硬约束 3 禁止编造）。
 */
import type { QuestionOption, ScaleQuestion } from "@/lib/rules";

export type NormalizationMethod = "rules" | "llm";

export type NormalizationOutcome =
  | {
      status: "matched";
      optionLabel: string;
      score: number;
      method: NormalizationMethod;
      /** 0～1，规则匹配固定给 1（确定性命中） */
      confidence: number;
      reason: string;
    }
  | {
      status: "unclear";
      method: NormalizationMethod | "none";
      reason: string;
    };

/** 患者明确表示"答不上来/没听懂"的话术 → 直接判定 unclear，走追问/待人工确认流程 */
const UNCERTAIN_PHRASES = [
  "不知道",
  "不清楚",
  "不记得",
  "记不得",
  "记不清",
  "说不好",
  "不好说",
  "说不上来",
  "想不起来",
  "没听清",
  "没听懂",
  "听不懂",
  "没听明白",
  "听不明白",
  "没明白",
  "再说一遍",
  "什么意思",
  "啥意思",
];

/** 文本清洗：去空白与常见标点，全角数字转半角，便于关键词匹配 */
function cleanUtterance(raw: string): string {
  return raw
    .trim()
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s，。、！？!?.,~；;：:""''"'（）()]/g, "");
}

function unclear(reason: string): NormalizationOutcome {
  return { status: "unclear", method: "rules", reason };
}

function matched(option: QuestionOption, reason: string): NormalizationOutcome {
  return {
    status: "matched",
    optionLabel: option.label,
    score: option.score,
    method: "rules",
    confidence: 1,
    reason,
  };
}

// ---------- 是/否题 ----------

/** 否定表达（优先扫描：命中后从文本中剔除，避免"不是"里的"是"造成误判） */
const NEGATIVE_PATTERNS = ["不是", "没有", "没得", "从来没", "从不", "不会", "不算", "没", "否", "不"];
const POSITIVE_PATTERNS = ["是的", "是啊", "对的", "没错", "确实", "经常", "总是", "是", "对", "有", "嗯", "会"];

/** 句首应答词：口语中先给答案再补充描述（如"对，没劲"），句首判定优先于全文扫描 */
const INITIAL_POSITIVE_STRONG = ["没错", "确实", "嗯"]; // 需先于否定检查（"没错"以"没"开头）
const INITIAL_NEGATIVE = ["不是", "没有", "没得", "不会", "从来没", "从不", "否", "没", "不"];
const INITIAL_POSITIVE = ["是", "对", "有", "会"];

function startsWithAny(text: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => text.startsWith(pattern));
}

/*
 * 已知限制（2026-07-15，产品决定本次只改 LLM 提示、规则层暂不动）：本函数是"门槛盲"的——
 * 它只做是/否关键词匹配，看不懂题干自带的频度/数量/幅度门槛。例如疲乏题"大部分时间感到疲乏"，
 * 患者答"有一点累"，句首"有"会被 INITIAL_POSITIVE 命中而误判为"是"（正确应为否/追问）。
 * 该误判仅在 DeepSeek 通道失效、回落到规则时才可能发生（在线时以 LLM 结论为准，见 deepseek.ts
 * 门槛判定）。替换路径：后续给规则层的门槛题单列"分级词不做单字肯定推断"的保护，或规则层对
 * 门槛题一律返回 unclear 交由追问/医生补录。
 */
/** 在选项中找"是/否"项：V2 选项 label 带括注（如"是（1分）""否（筛查阴性）"），按括号前主文案匹配 */
function findBooleanOption(options: QuestionOption[], label: "是" | "否"): QuestionOption | undefined {
  return options.find((item) => item.label.split(/[（(]/)[0].trim() === label);
}

function parseBoolean(text: string, options: QuestionOption[]): NormalizationOutcome {
  const initialLabel = startsWithAny(text, INITIAL_POSITIVE_STRONG)
    ? "是"
    : startsWithAny(text, INITIAL_NEGATIVE)
      ? "否"
      : startsWithAny(text, INITIAL_POSITIVE)
        ? "是"
        : null;
  if (initialLabel) {
    const option = findBooleanOption(options, initialLabel);
    if (!option) return unclear(`题目选项中不存在"${initialLabel}"`);
    return matched(option, `规则匹配：句首应答词识别为"${initialLabel}"`);
  }

  let rest = text;
  let negativeHit = false;
  for (const pattern of NEGATIVE_PATTERNS) {
    if (rest.includes(pattern)) {
      negativeHit = true;
      rest = rest.split(pattern).join("");
    }
  }
  const positiveHit = POSITIVE_PATTERNS.some((pattern) => rest.includes(pattern));

  // 肯定与否定同时出现（如"以前不会，现在会"）语义复杂 → 保守判 unclear
  if (negativeHit && positiveHit) return unclear("回答同时包含肯定与否定表达");
  const label = negativeHit ? "否" : positiveHit ? "是" : null;
  if (!label) return unclear("未识别出明确的是/否表达");
  const option = findBooleanOption(options, label);
  if (!option) return unclear(`题目选项中不存在"${label}"`);
  return matched(option, `规则匹配：识别为"${label}"`);
}

// ---------- 序数/数字表达 ----------

const CN_DIGITS: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5 };

/** 解析"第N个/选N/N"式的选项序号（1 起）。仅接受明确的选择表达，裸数字只在纯数字回答时接受 */
function parseOrdinal(text: string, optionCount: number): number | null {
  const normalized = text.replace(/[一二两三四五]/g, (ch) => String(CN_DIGITS[ch]));
  const explicit = normalized.match(/^(?:第|选|选择)(\d)(?:个|项)?$/);
  const bare = normalized.match(/^(\d)$/);
  const hit = explicit?.[1] ?? bare?.[1];
  if (!hit) return null;
  const index = Number(hit);
  return index >= 1 && index <= optionCount ? index : null;
}

// ---------- 数字题（按口述数值精确反查 score 档位） ----------

const CN_NUMERALS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/** 解析数字题的口述数值：接受阿拉伯数字与 0～10 的中文数字（可带"分"后缀），其余返回 null */
function parseSpokenValue(text: string): number | null {
  const stripped = text.replace(/分$/, "");
  if (/^\d+$/.test(stripped)) return Number(stripped);
  if (stripped.length === 1 && stripped in CN_NUMERALS) return CN_NUMERALS[stripped];
  return null;
}

/**
 * 数字题（如 iciq_3 漏尿影响 0～10 分）按 score 精确反查选项。
 * 不得落入 parseByOptionKeywords 的"第 N 项"序号解析——选项序号与分值并不一致
 * （0 分档是第 1 项，答"3"会被错配到 score=2），解析不出或无匹配档位一律 unclear（禁止编造）。
 */
function parseByScoreValue(text: string, options: QuestionOption[]): NormalizationOutcome {
  const value = parseSpokenValue(text);
  if (value === null) return unclear("未能从回答中解析出数值");
  const hits = options.filter((option) => option.score === value);
  if (hits.length === 1) return matched(hits[0], `规则匹配：数值 ${value} 对应选项"${hits[0].label}"`);
  return unclear(`数值 ${value} 无对应选项档位`);
}

// ---------- 选项关键词匹配（choice / likert5 通用） ----------

/** 把选项文案拆成可识别关键词：按（）、/ 顿号分段，如"没有（根本不/从来没有）"→ 没有|根本不|从来没有 */
function optionTokens(label: string): string[] {
  return label
    .split(/[（）()、/／]/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

/** 命中位置前一个字是"不/没"视为被否定（如"不经常"不能命中"经常"） */
function containsWithoutNegation(text: string, token: string): boolean {
  let from = 0;
  while (true) {
    const at = text.indexOf(token, from);
    if (at === -1) return false;
    const prev = at > 0 ? text[at - 1] : "";
    if (prev !== "不" && prev !== "没") return true;
    from = at + 1;
  }
}

function parseByOptionKeywords(text: string, options: QuestionOption[]): NormalizationOutcome {
  const hits: QuestionOption[] = [];
  for (const option of options) {
    const cleanLabel = cleanUtterance(option.label);
    // 整段互含：回答就是选项原文，或选项原文包含整个回答（回答需 ≥2 字）
    const wholeHit =
      text === cleanLabel || (text.length >= 2 && (cleanLabel.includes(text) || text.includes(cleanLabel)));
    const tokenHit = optionTokens(option.label).some((token) => containsWithoutNegation(text, token));
    if (wholeHit || tokenHit) hits.push(option);
  }
  if (hits.length === 1) {
    return matched(hits[0], `规则匹配：回答命中选项"${hits[0].label}"`);
  }
  if (hits.length > 1) return unclear("回答同时命中多个选项，无法确定");
  const ordinal = parseOrdinal(text, options.length);
  if (ordinal !== null) {
    const option = options[ordinal - 1];
    return matched(option, `规则匹配：按序号选择第 ${ordinal} 项"${option.label}"`);
  }
  return unclear("回答未命中任何选项关键词");
}

// ---------- 对外入口 ----------

/**
 * 规则兜底归一化：把患者原始回答解析为题目标准选项。
 * 保守策略：只在唯一、无歧义命中时返回 matched，其余一律 unclear（禁止编造）。
 */
export function normalizeByRules(
  question: Pick<ScaleQuestion, "answerType">,
  options: QuestionOption[],
  rawUtterance: string
): NormalizationOutcome {
  const text = cleanUtterance(rawUtterance);
  if (text.length === 0) return unclear("回答为空");
  if (options.length === 0) return unclear("题目缺少可匹配的选项");
  // "不知道"类表达含"不"，必须先于是/否解析判定，否则会被误判为"否"
  if (UNCERTAIN_PHRASES.some((phrase) => text.includes(phrase))) {
    return unclear("患者表示不确定或未听清");
  }
  if (question.answerType === "boolean") {
    return parseBoolean(text, options);
  }
  // 数字题走分值精确反查（见 parseByScoreValue），不走选项关键词/序号匹配
  if (question.answerType === "number") {
    return parseByScoreValue(text, options);
  }
  // likert5 与 choice 共用选项关键词 + 序号匹配（likert5 的五级频度词已包含在选项文案里）
  return parseByOptionKeywords(text, options);
}
