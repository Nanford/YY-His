/**
 * INPUT:  VOLC_APP_ID / VOLC_ACCESS_TOKEN 环境变量、患者录音（WAV Buffer）、患者唯一编号
 * OUTPUT: asrAvailable、recognizeSpeech —— 火山引擎录音识别（极速版一句话场景）
 * POS:    患者语音 → 转写文本的唯一通道。出网只携带音频与患者编号（PII 红线），
 *         识别失败/未配置时由患者端降级为文字/按钮作答（AGENTS.md 输入模式兜底）。
 *
 * 注意：本 Provider 尚未用真实密钥联调（密钥就绪后需核对资源 ID 是否已开通
 * volc.bigasr.auc_turbo）。接口文档依据：火山引擎大模型录音文件识别-极速版。
 */
import { randomUUID } from "node:crypto";
import { piiSafeJsonFetch } from "./pii-filter";

const ASR_ENDPOINT = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";
const REQUEST_TIMEOUT_MS = 20_000;

export function asrAvailable(): boolean {
  return Boolean(process.env.VOLC_APP_ID && process.env.VOLC_ACCESS_TOKEN);
}

export class AsrError extends Error {
  constructor(
    message: string,
    /** unavailable=未配置密钥（UI 隐藏语音入口）；upstream=云端调用失败（可提示重试/改用按钮） */
    readonly kind: "unavailable" | "upstream"
  ) {
    super(message);
    this.name = "AsrError";
  }
}

export interface AsrResult {
  /** 转写文本（已含标点） */
  text: string;
  /** 云端原始返回（置信度等），落库到 DialogueTurn.asrRaw 供追溯 */
  raw: unknown;
}

/**
 * 识别一段患者回答录音（WAV，患者端已重采样为 16kHz 单声道）。
 * uid 只允许传患者唯一编号 code —— 出网请求经 PII 过滤层强制校验。
 */
export async function recognizeSpeech(input: { audio: Buffer; patientCode: string }): Promise<AsrResult> {
  const appId = process.env.VOLC_APP_ID;
  const accessToken = process.env.VOLC_ACCESS_TOKEN;
  if (!appId || !accessToken) {
    throw new AsrError("ASR 未配置（缺少 VOLC_APP_ID / VOLC_ACCESS_TOKEN）", "unavailable");
  }

  const response = await piiSafeJsonFetch(ASR_ENDPOINT, {
    method: "POST",
    headers: {
      "X-Api-App-Key": appId,
      "X-Api-Access-Key": accessToken,
      "X-Api-Resource-Id": "volc.bigasr.auc_turbo",
      "X-Api-Request-Id": randomUUID(),
      "X-Api-Sequence": "-1",
    },
    jsonBody: {
      user: { uid: input.patientCode },
      audio: { format: "wav", data: input.audio.toString("base64") },
      request: { model_name: "bigmodel", enable_punc: true },
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch((error: unknown) => {
    throw new AsrError(`ASR 请求失败：${error instanceof Error ? error.message : String(error)}`, "upstream");
  });

  // 火山协议：业务状态码在响应头 X-Api-Status-Code，20000000 为成功
  const statusCode = response.headers.get("X-Api-Status-Code");
  if (!response.ok || (statusCode !== null && statusCode !== "20000000")) {
    const statusMessage = response.headers.get("X-Api-Message") ?? `HTTP ${response.status}`;
    // 45000030 = 资源未授权：账号尚未开通"录音文件识别-极速版"（2026-07-14 联调确认）
    if (statusCode === "45000030" || statusMessage.includes("not granted")) {
      throw new AsrError(
        "语音识别服务未开通：请在火山引擎控制台开通 语音识别大模型-录音文件识别极速版（volc.bigasr.auc_turbo）",
        "upstream"
      );
    }
    throw new AsrError(`ASR 服务返回错误：${statusMessage}`, "upstream");
  }

  const body = (await response.json()) as { result?: { text?: string } };
  const text = body.result?.text?.trim() ?? "";
  if (!text) {
    throw new AsrError("ASR 未识别出有效文本（可能是静音或噪声）", "upstream");
  }
  return { text, raw: body };
}
