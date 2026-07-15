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

/*
 * 系统提示设计（2026-07-15 修订，真实 DeepSeek 探针逐条验证）：
 * 旧版孤立地看回答、"含糊即顶"，把"有一点""偶尔"这类**省略了核心词、靠题干补全**的
 * 明确回答误判为不匹配，逼患者退回"有/无"。新版要求模型：
 *   (1) 结合题干把省略/口语/程度词还原成完整意思再判断（问"困难吗"答"有一点"=有一点困难→是）；
 *   (2) 先判题干有没有自带门槛（程度/频度/数量/幅度），有门槛按门槛算、无门槛"存在即肯定"——
 *       这条是医学安全关键：疲乏题"大部分时间"下"有一点累"不能算"是"（否则 FRAIL 多算一分）。
 * 仍严守硬约束 2/3：模型只做语言理解不参与评分；够不够门槛/答非所问/不知道一律判不匹配，绝不猜测。
 * 已知限制：DeepSeek 掉线时的规则兜底（normalize-rules.ts）仍是"门槛盲"，见该文件 parseBoolean 注释。
 */
const SYSTEM_PROMPT = [
  "你是老年健康评估问卷的回答归一化助手。",
  "任务：结合题目语境，判断患者的口语回答对应题目给定选项中的哪一个。",
  "",
  "理解原则：",
  "1. 患者常用省略、口语、带程度或频度的说法回答，需结合题目把它还原成完整意思再判断。",
  '   例：问"走一百米困难吗"，答"有一点""费劲""不太好走"意思是"有一点困难"，对应"是"；答"不困难""挺轻松"对应"否"。',
  '2. 先看题干本身有没有设定门槛（程度、频度、数量、幅度，如"大部分时间""五种以上""下降5%以上""明显"）：',
  '   - 有门槛：只有回答达到该门槛才对应肯定项；未达到（如"偶尔""有一点"对"大部分时间"，"三四种"对"五种以上"）对应否定项；够不够拿不准时判为不匹配。',
  '   - 无门槛（只问"有没有""困难吗"）：只要表达该情况存在（哪怕程度很轻）就对应肯定项，明确不存在对应否定项。',
  '3. 程度/频度分级题：把回答的程度或频度对应到语义最接近的选项；选项文字括号内是同义说法（如"很少（有一点/偶尔）"），患者说"有一点""偶尔"即对应"很少"。',
  "",
  "必须判为不匹配（matched=false）的情况：",
  "1. 答非所问、说的是别的话题；",
  "2. 患者表示不知道、没听清、要再听一遍；",
  "3. 回答能同时说得通多个选项、或够不够门槛无法确定；",
  "4. 你确实无法判断。绝不猜测。",
  "",
  "输出规则：",
  "1. 只能从给定选项中选择，禁止创造新答案；",
  '2. 只输出 JSON 对象：{"matched": boolean, "optionLabel": string|null, "confidence": 0到1的数字, "reason": "简短中文说明"}；',
  "3. optionLabel 必须与给定选项文字完全一致，matched=false 时为 null。",
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
