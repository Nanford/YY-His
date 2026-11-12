/**
 * INPUT:  答案行的来源/状态/分值、Answer.aiJudgment（JSON，写入处见 dialogue/service.ts 的 persistAnswer）、
 *         题目定义（src/lib/rules 的 ScaleQuestion：作答类型与 01 表选项）
 * OUTPUT: readAiJudgment —— aiJudgment 的宽松解析；scoringMethodOf —— 评分方式；
 *         describeAnswerScoring —— 医生端追溯页「作答得分」的展示口径；scoringCriteriaOf —— 「评分标准」选项清单
 * POS:    2026-11-12 用户拍板：追溯页把「评分标准」（01 表各选项与分值）和「作答得分」（本题实际得分）分开，
 *         得分醒目展示并注明评分方式。「AI评分」只标大模型给出的分（DeepSeek 归一化/判定、视觉模型看图与临界复核，
 *         aiJudgment.method = "llm"）；没配密钥时的关键词规则兜底标「规则判定」，不算 AI。
 *         纯展示派生，不参与评分：分值仍是答案落库时按选项取的值（硬约束 2）。
 *         YY-Demo 采集语义：isScored = false 的条目（便秘病程开放题）落库是占位 0 分，显示「不计分」。
 */
import { MULTI_CHOICE_SEP, displayOptionLabel, type ScaleQuestion } from "@/lib/rules";

/** 落库的判定记录（只取展示要用的字段） */
export interface AiJudgmentRecord {
  /** llm = 大模型；rules = 规则（含按钮/多选的确定性匹配）；none = 未判定 */
  method: string;
  reason: string;
  confidence: number | null;
}

export type ScoringMethod = "ai" | "rules" | "patient" | "doctor" | "system";

export const SCORING_METHOD_LABEL: Record<ScoringMethod, string> = {
  ai: "AI评分",
  rules: "规则判定",
  patient: "患者点选",
  doctor: "医生评分",
  system: "系统换算",
};

export type AnswerScoring =
  | {
      kind: "scored";
      score: number;
      /** 本题满分（选项最高分）；题目没有选项时为 null */
      maxScore: number | null;
      method: ScoringMethod;
      /** 备注：AI/规则判定写判定理由，其余写得分来由 */
      note: string;
      /** 仅 AI 评分有意义（模型自报把握度） */
      confidence: number | null;
    }
  | { kind: "pending"; note: string }
  | { kind: "unscored"; note: string };

/** 评分标准里的一个选项：展示文字剥掉括号注解（分值单列），matched = 本题记录的答案 */
export interface ScoringCriterion {
  label: string;
  score: number;
  matched: boolean;
}

type ScoringQuestion = Pick<ScaleQuestion, "answerType" | "options" | "isScored">;

/** aiJudgment 在 Prisma 里是 Json，历史数据也可能是 JSON 字符串；形状不符一律视为没有判定记录 */
export function readAiJudgment(value: unknown): AiJudgmentRecord | null {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const { method, reason, confidence } = parsed as Record<string, unknown>;
  if (typeof method !== "string") return null;
  return {
    method,
    reason: typeof reason === "string" ? reason.trim() : "",
    confidence: typeof confidence === "number" ? confidence : null,
  };
}

/**
 * 评分方式按答案来源优先：医生改判后来源变为 doctor（aiJudgment 仍是改判前的，不能再标 AI）；
 * 只有语音/文字/画图这类需要"理解回答"的来源才看 aiJudgment.method 区分 AI 与规则。
 */
export function scoringMethodOf(source: string, aiMethod: string | null): ScoringMethod {
  if (source === "doctor") return "doctor";
  if (source === "system" || source === "measurement") return "system";
  if (source === "button" || source === "multi") return "patient";
  return aiMethod === "llm" ? "ai" : "rules";
}

function maxScoreOf(question: ScoringQuestion | undefined): number | null {
  const scores = (question?.options ?? []).map((option) => option.score);
  return scores.length > 0 ? Math.max(...scores) : null;
}

const METHOD_NOTE: Record<Exclude<ScoringMethod, "ai" | "rules">, string> = {
  patient: "患者在屏幕上点选，按所选项分值计分",
  doctor: "医生代填或改判，改动前后见修改历史",
  system: "由档案、测量数据换算或跨量表复用回填",
};

export function describeAnswerScoring(input: {
  source: string;
  score: number | null;
  aiJudgment: AiJudgmentRecord | null;
  question: ScoringQuestion | undefined;
}): AnswerScoring {
  // 不在判定配置里的条目只保存原始回答（dialogue/service.ts 的 unscoredRawOutcome 写占位 0 分），不能显示成 0 分
  if (input.question?.isScored === false) {
    return { kind: "unscored", note: "本题不在判定配置的计分条目内，只记录患者原始回答" };
  }
  // 多选题落库分值是占位 0（判定按所选项组合，见 scoring-v2），显示 0 分会误导
  if (input.question?.answerType === "multiChoice") {
    return { kind: "unscored", note: "多选题只记录所选项，按组合判定结果，不单独计分" };
  }
  if (input.score === null) {
    return { kind: "pending", note: input.aiJudgment?.reason || "尚未得出分值，待医生确认计分" };
  }
  const method = scoringMethodOf(input.source, input.aiJudgment?.method ?? null);
  const judged = method === "ai" || method === "rules";
  return {
    kind: "scored",
    score: input.score,
    maxScore: maxScoreOf(input.question),
    method,
    note: judged ? input.aiJudgment?.reason || "（未记录判定理由）" : METHOD_NOTE[method],
    confidence: method === "ai" ? (input.aiJudgment?.confidence ?? null) : null,
  };
}

/** 01 表选项即评分标准；多选题按连接符拆开逐项标记 */
export function scoringCriteriaOf(
  question: ScoringQuestion | undefined,
  optionLabel: string | null
): ScoringCriterion[] {
  const recorded = new Set(optionLabel ? optionLabel.split(MULTI_CHOICE_SEP) : []);
  return (question?.options ?? []).map((option) => ({
    label: displayOptionLabel(option.label),
    score: option.score,
    matched: recorded.has(option.label),
  }));
}
