/**
 * INPUT:  DEEPSEEK_API_KEY 环境变量、题目定义与患者原始回答（不含任何直接身份信息）
 * OUTPUT: deepseekAvailable、normalizeByDeepSeek —— 大模型回答归一化（JSON mode）
 * POS:    归一化的首选通道。大模型只做语言理解（判断回答是否命中选项），
 *         绝不参与评分和判定（AGENTS.md 硬约束 2）；失败/超时由调用方回落到规则兜底。
 */
import type { QuestionOption } from "@/lib/rules";
import type { NormalizationOutcome } from "@/lib/dialogue/normalize-rules";
import { piiSafeJsonFetch } from "./pii-filter";

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const REQUEST_TIMEOUT_MS = 10_000;
/** 低于该置信度视为不清晰，转入追问流程（禁止编造：宁可追问也不猜测） */
const MIN_CONFIDENCE = 0.6;

export function deepseekAvailable(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

export interface DeepSeekNormalizeInput {
  /** 标准题干（医学原文，语义判断以此为准） */
  standardText: string;
  /** 实际播报给患者的口语版题干（帮助模型理解对话语境） */
  colloquialText: string;
  options: QuestionOption[];
  /** 患者原始回答（转写文本或文字输入）。上游不得拼入姓名等 PII */
  utterance: string;
  /** 患者唯一编号，出网允许的唯一患者标识 */
  patientCode: string;
}

const SYSTEM_PROMPT = [
  "你是老年健康评估问卷的回答归一化助手。",
  "任务：判断患者的口语回答是否明确对应题目给定选项中的某一个。",
  "规则：",
  "1. 只能从给定选项中选择，禁止创造新答案；",
  "2. 回答含糊、答非所问、同时指向多个选项、或你没有把握时，必须判定为不匹配（matched=false），绝不猜测；",
  "3. 只输出 JSON 对象：{\"matched\": boolean, \"optionLabel\": string|null, \"confidence\": 0到1的数字, \"reason\": \"简短中文说明\"}；",
  "4. optionLabel 必须与给定选项文字完全一致，matched=false 时为 null。",
].join("\n");

/** DeepSeek 返回的 JSON 结构（模型输出，逐字段校验后才可信） */
interface DeepSeekVerdict {
  matched: boolean;
  optionLabel: string | null;
  confidence: number;
  reason: string;
}

function parseVerdict(content: string): DeepSeekVerdict | null {
  try {
    const raw = JSON.parse(content) as Partial<DeepSeekVerdict>;
    if (typeof raw.matched !== "boolean") return null;
    if (typeof raw.confidence !== "number" || raw.confidence < 0 || raw.confidence > 1) return null;
    return {
      matched: raw.matched,
      optionLabel: typeof raw.optionLabel === "string" ? raw.optionLabel : null,
      confidence: raw.confidence,
      reason: typeof raw.reason === "string" ? raw.reason : "",
    };
  } catch {
    return null;
  }
}

/**
 * 调用 DeepSeek 做回答归一化。
 * 返回 null 表示通道不可用或调用失败（网络/超时/解析失败），调用方应回落规则兜底；
 * 返回 unclear 表示模型明确判断"不命中"，属于有效结论，直接进入追问流程。
 */
export async function normalizeByDeepSeek(
  input: DeepSeekNormalizeInput
): Promise<NormalizationOutcome | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;

  const userPayload = {
    question: input.standardText,
    questionAsSpoken: input.colloquialText,
    options: input.options.map((option) => option.label),
    patientReply: input.utterance,
  };

  try {
    const response = await piiSafeJsonFetch(DEEPSEEK_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      // 出网 payload 只含题目、选项、回答文本与患者编号（PII 过滤层强制校验）
      jsonBody: {
        model: "deepseek-chat",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(userPayload) },
        ],
        user: input.patientCode,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) return null;
    const verdict = parseVerdict(content);
    if (!verdict) return null;

    if (!verdict.matched || verdict.optionLabel === null) {
      return { status: "unclear", method: "llm", reason: verdict.reason || "模型判断回答未命中选项" };
    }
    // optionLabel 必须与规则选项精确一致：模型输出不可信，命不中一律视为 unclear
    const option = input.options.find((item) => item.label === verdict.optionLabel);
    if (!option) {
      return { status: "unclear", method: "llm", reason: "模型返回了选项之外的答案，已丢弃" };
    }
    if (verdict.confidence < MIN_CONFIDENCE) {
      return { status: "unclear", method: "llm", reason: `模型置信度不足（${verdict.confidence}）` };
    }
    return {
      status: "matched",
      optionLabel: option.label,
      score: option.score,
      method: "llm",
      confidence: verdict.confidence,
      reason: verdict.reason || "模型判断回答命中选项",
    };
  } catch {
    // 网络错误/超时：不是医学结论，交由规则兜底
    return null;
  }
}
