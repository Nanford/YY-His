/**
 * INPUT:  环境变量（DEEPSEEK_API_KEY / VOLC_* / AVATAR_MODE）
 * OUTPUT: voiceCapabilities —— 语音链路各环节可用性汇总（服务端判定，供患者端降级）
 * POS:    "语音链路任何一环不可用时，演示流程仍能完整跑通"的判定依据（AGENTS.md 分层原则）。
 *         只输出布尔开关，不向客户端泄漏任何密钥信息。
 */
import { deepseekAvailable } from "./deepseek";
import { ttsAvailable } from "./volc-tts";
import { asrAvailable } from "./volc-asr";

export interface VoiceCapabilities {
  /** 语音合成可用：不可用时患者端只显示字幕，不播音频 */
  tts: boolean;
  /** 语音识别可用：不可用时隐藏语音作答入口，仅保留文字/按钮 */
  asr: boolean;
  /** 大模型归一化可用：不可用时归一化只走规则兜底 */
  llm: boolean;
  /** 数字人形象：sdk=商用数字人 SDK；fallback=内置 2D 降级形象 */
  avatarMode: "sdk" | "fallback";
}

export function voiceCapabilities(): VoiceCapabilities {
  return {
    tts: ttsAvailable(),
    asr: asrAvailable(),
    llm: deepseekAvailable(),
    // 数字人 SDK 开通周期不可控 → 默认降级形象（AGENTS.md"已知的坑"）
    avatarMode: process.env.AVATAR_MODE === "sdk" ? "sdk" : "fallback",
  };
}
