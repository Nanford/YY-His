/**
 * INPUT:  题目定义（src/lib/rules）、患者原始回答、DeepSeek Provider、规则兜底解析器
 * OUTPUT: normalizeAnswer —— 回答归一化统一编排入口（LLM 优先，规则兜底）
 * POS:    会话链路的归一化门面。策略来源：AGENTS.md"回答归一化：DeepSeek 优先，
 *         规则匹配兜底；两者都失败 → 待人工确认"。
 */
import type { QuestionOption, ScaleQuestion } from "@/lib/rules";
import { normalizeByDeepSeek } from "@/lib/providers/deepseek";
import { normalizeByRules, type NormalizationOutcome } from "./normalize-rules";

export type { NormalizationOutcome } from "./normalize-rules";

/**
 * 归一化编排：
 * 1. DeepSeek 可用 → 先问模型；模型给出 matched / unclear 都是有效结论；
 * 2. 模型通道失败（null：无密钥/网络/超时/解析失败）→ 规则兜底；
 * 3. 规则也解析不出 → unclear，由状态机走追问 → 待人工确认流程。
 */
export async function normalizeAnswer(input: {
  question: ScaleQuestion;
  options: QuestionOption[];
  utterance: string;
  patientCode: string;
}): Promise<NormalizationOutcome> {
  const llmOutcome = await normalizeByDeepSeek({
    standardText: input.question.standardText,
    colloquialText: input.question.colloquialText,
    options: input.options,
    utterance: input.utterance,
    patientCode: input.patientCode,
  });
  if (llmOutcome !== null) {
    // 模型明确说 unclear 时也再给规则一次机会：规则命中是确定性的，可靠性高于模型的"没把握"
    if (llmOutcome.status === "unclear") {
      const rulesOutcome = normalizeByRules(input.question, input.options, input.utterance);
      return rulesOutcome.status === "matched" ? rulesOutcome : llmOutcome;
    }
    return llmOutcome;
  }
  return normalizeByRules(input.question, input.options, input.utterance);
}
