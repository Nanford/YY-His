/**
 * INPUT:  自由回答题配置（cognitive-flow）、患者原始回答、DeepSeek 判定通道、规则兜底
 * OUTPUT: judgeFreeAnswer / judgeWordRecall —— 自由回答判定编排（LLM 优先，规则兜底）
 * POS:    认知题改版的判定门面（2026-08-13）。LLM 只做语言理解：把患者自由回答
 *         映射回量表既有标准选项（正确/错误、回忆 N 个词），输出仍是 NormalizationOutcome，
 *         下游 resolveReply 与评分引擎零改动（AGENTS.md 硬约束 2：LLM 不参与评分和判定标签）。
 */
import type { QuestionOption, ScaleQuestion } from "@/lib/rules";
import {
  judgeAnswerByDeepSeek,
  judgeWordsByDeepSeek,
  type WordRecallVerdict,
} from "@/lib/providers/deepseek";
import {
  MMSE_LOCATION,
  polarOptionsOf,
  type FreeAnswerSpec,
} from "./cognitive-flow";
import { adjacentDaysOf, judgeByRules, matchWordsByRules, serialReferenceOf } from "./judge-rules";
import type { NormalizationOutcome } from "./normalize-rules";

const WEEKDAY_CN = ["日", "一", "二", "三", "四", "五", "六"];

/** 时间定向题的参考答案（运行时由系统日期生成） */
function dateReference(part: "year" | "season" | "month" | "day" | "weekday", now: Date): string {
  switch (part) {
    case "year":
      return `${now.getFullYear()}年`;
    case "season": {
      const month = now.getMonth() + 1;
      const season = month >= 3 && month <= 5 ? "春季" : month >= 6 && month <= 8 ? "夏季" : month >= 9 && month <= 11 ? "秋季" : "冬季";
      return `${season}（按月份划分：3-5月春、6-8月夏、9-11月秋、12-2月冬）`;
    }
    case "month":
      return `${now.getMonth() + 1}月`;
    // 国标注 2：日期和星期差一天可算正确；把三天逐一列给模型，免得它自己算错跨月/跨周
    case "day":
      return `${now.getDate()}号（前后差一天也算正确，即${adjacentDaysOf(now).map((day) => `${day.getDate()}号`).join("、")}均可）`;
    case "weekday":
      return `星期${WEEKDAY_CN[now.getDay()]}（前后差一天也算正确，即${adjacentDaysOf(now).map((day) => `星期${WEEKDAY_CN[day.getDay()]}`).join("、")}均可）`;
  }
}

/** 按题型拼装给 LLM 的评判标准（含参考答案；不含任何患者 PII） */
function criteriaOf(spec: FreeAnswerSpec, now: Date): string {
  switch (spec.kind) {
    case "datePart":
      return `正确答案是：${dateReference(spec.part, now)}。患者答出该时间（中文/阿拉伯数字均可）即正确。`;
    case "place":
      return `正确答案是：「${MMSE_LOCATION[spec.part]}」。患者答出该地点（允许省略「省/市/楼」等后缀、允许口语说法）即正确。`;
    case "serialSubtraction":
      // expected 已由 serialReferenceOf 换成本步参考答案（可能是上一步回答 − 7）
      return `正确答案是：${spec.expected}。患者最终说出的数字等于该值（含中文数字读法；先念算式再说结果、或说错后改口的，以最后说的数为准）即正确，其他数字或不作答即错误。`;
    case "verbatim":
      return `目标句是：「${spec.target}」。患者完整准确复述即正确（允许极轻微语气差异；漏词、错词、换词均算错误）。`;
    case "naming": {
      // 看图识物：同义说法算对；说成别的东西或只说笼统类别（如把铅笔说成"笔"）算错
      const synonyms = spec.synonyms.length > 0 ? `（说成${spec.synonyms.map((name) => `「${name}」`).join("")}也算正确）` : "";
      return `屏幕上展示的是一张${spec.target}的图片，患者需说出它的名称。正确答案是：「${spec.target}」${synonyms}。说成其他物品、只说笼统的类别、或表示认不出来，均算错误。`;
    }
    case "wordCount":
      return ""; // wordCount 不走 criteria 通道
  }
}

export interface JudgeInput {
  question: ScaleQuestion;
  options: QuestionOption[];
  spec: FreeAnswerSpec;
  utterance: string;
  patientCode: string;
  patientName?: string;
  /** 连减相对计分用：上一步条目的患者原始回答（其余题不传） */
  previousAnswerText?: string | null;
}

/**
 * 连减题按上一步回答换算本步参考答案（国标注 4），并给出留痕说明；
 * 参考答案与 01 表固定答案相同或非连减题时原样返回、说明为空。
 */
function resolveSerialReference(
  spec: FreeAnswerSpec,
  previousAnswerText: string | null | undefined
): { spec: FreeAnswerSpec; note: string } {
  if (spec.kind !== "serialSubtraction") return { spec, note: "" };
  const reference = serialReferenceOf(spec, previousAnswerText);
  if (reference === spec.expected) return { spec, note: "" };
  return {
    spec: { ...spec, expected: reference },
    note: `连减相对计分（WS/T 484 注 4）：上一步回答 ${reference + spec.step}，本步应答 ${reference}；`,
  };
}

function matchedOutcome(
  optionLabel: string,
  options: QuestionOption[],
  method: "llm" | "rules",
  reason: string,
  confidence: number = 1
): NormalizationOutcome {
  const option = options.find((o) => o.label === optionLabel);
  if (!option) throw new Error(`判定映射的选项不在题目选项内：${optionLabel}`);
  return { status: "matched", optionLabel: option.label, score: option.score, method, confidence, reason };
}

/**
 * 自由回答判定（单题）：correct/incorrect → 映射该题既有 1 分/0 分选项；
 * wordCount → 命中词数映射"回忆N个词"选项；unclear → 走追问流程。
 */
export async function judgeFreeAnswer(input: JudgeInput): Promise<NormalizationOutcome> {
  const { question, options, utterance, patientCode, patientName } = input;
  const { spec, note } = resolveSerialReference(input.spec, input.previousAnswerText);

  if (spec.kind === "wordCount") {
    const verdict = await judgeWordRecall(spec.words, utterance, patientCode, patientName);
    if (verdict.status === "unclear") return { status: "unclear", method: verdict.method, reason: verdict.reason };
    const count = verdict.matchedWords.length;
    const option = options.find((o) => o.score === count);
    if (!option) throw new Error(`题目 ${question.id} 缺少 ${count} 分选项（词计数映射失败）`);
    return {
      status: "matched",
      optionLabel: option.label,
      score: option.score,
      method: verdict.method,
      confidence: verdict.confidence ?? 1,
      reason: verdict.reason || `复述命中 ${count} 个词`,
    };
  }

  const criteria = criteriaOf(spec, new Date());
  const llm = await judgeAnswerByDeepSeek({
    question: question.standardText,
    criteria,
    utterance,
    patientCode,
    patientName,
  });
  const polar = polarOptionsOf(question.id);
  if (llm) {
    if (llm.verdict === "unclear") return { status: "unclear", method: "llm", reason: llm.reason };
    const label = llm.verdict === "correct" ? polar.correct : polar.incorrect;
    return matchedOutcome(label, options, "llm", `${note}${llm.reason}`, llm.confidence);
  }
  // 规则兜底（无密钥/网络失败）：拿不准一律 unclear 走追问，绝不编造
  const rule = judgeByRules(spec, utterance);
  if (rule === "unclear") return { status: "unclear", method: "rules", reason: "规则兜底无法判定，转追问" };
  const label = rule === "correct" ? polar.correct : polar.incorrect;
  return matchedOutcome(label, options, "rules", `${note}规则兜底判定`);
}

export interface WordRecallOutcome {
  status: "matched" | "unclear";
  matchedWords: string[];
  method: "llm" | "rules";
  confidence?: number;
  reason: string;
}

/**
 * 词复述识别编排（组回答与词计数共用）：DeepSeek 优先、规则兜底。
 * LLM 通道的结论（含 unclear）即最终结论，规则不复核（与 normalize.ts 同一原则）。
 */
export async function judgeWordRecall(
  words: readonly string[],
  utterance: string,
  patientCode: string,
  patientName?: string
): Promise<WordRecallOutcome> {
  const llm: WordRecallVerdict | null = await judgeWordsByDeepSeek({
    words,
    utterance,
    patientCode,
    patientName,
  });
  if (llm !== null) {
    return llm.status === "matched"
      ? { status: "matched", matchedWords: llm.matchedWords, method: "llm", reason: llm.reason }
      : { status: "unclear", matchedWords: [], method: "llm", reason: llm.reason };
  }
  const matched = matchWordsByRules(words, utterance);
  if (matched === null) {
    return { status: "unclear", matchedWords: [], method: "rules", reason: "规则兜底无法识别复述内容，转追问" };
  }
  return { status: "matched", matchedWords: matched, method: "rules", reason: `规则兜底命中 ${matched.length} 个词` };
}
