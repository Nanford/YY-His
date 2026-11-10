/**
 * INPUT:  VOLC_APP_ID / VOLC_ACCESS_TOKEN / VOLC_TTS_VOICE 环境变量、待播报文本（不含 PII）
 * OUTPUT: ttsAvailable、synthesizeSpeech —— 豆包语音合成大模型 2.0（文本哈希缓存）
 * POS:    数字医生播报音频的唯一来源。服务端调用 + storage/audio-cache 缓存，
 *         现场网络不可控时优先命中缓存（AGENTS.md"已知的坑"）。密钥只在服务端使用。
 *
 * 接口：POST /api/v3/tts/unidirectional（HTTP Chunked 单向流式，响应为逐行 JSON），
 * 已用真实密钥联调通过（2026-07-14，资源 seed-tts-2.0 + uranus 系列音色）。
 * 来源：豆包语音 API 参考 "1.2.1 单向流式语音合成HTTP"。
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { piiSafeJsonFetch } from "./pii-filter";

const TTS_ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
const REQUEST_TIMEOUT_MS = 15_000;
/** 默认音色（账号已开通并联调通过），可用 VOLC_TTS_VOICE 覆盖 */
const DEFAULT_VOICE = "zh_female_xiaohe_uranus_bigtts";
/** 模型资源：seed-tts-2.0 = 豆包语音合成大模型 2.0（uranus 等 2.0 音色） */
const DEFAULT_RESOURCE_ID = "seed-tts-2.0";
/** 缓存根目录（.gitignore 已排除 storage/） */
const CACHE_DIR = path.join(process.cwd(), "storage", "audio-cache", "tts");

export function ttsAvailable(): boolean {
  return Boolean(process.env.VOLC_APP_ID && process.env.VOLC_ACCESS_TOKEN);
}

function voiceType(): string {
  return process.env.VOLC_TTS_VOICE || DEFAULT_VOICE;
}

function resourceId(): string {
  return process.env.VOLC_TTS_RESOURCE_ID || DEFAULT_RESOURCE_ID;
}

/** 全局默认语速：取值 [-50,100]，-10 ≈ 0.9 倍速：面向老年患者放缓语速 */
const DEFAULT_SPEECH_RATE = -10;

/** 缓存键：音色 + 语速 + 文本 的哈希。换音色/换语速不会命中旧缓存 */
export function ttsCacheKey(text: string, speechRate: number = DEFAULT_SPEECH_RATE): string {
  // 默认语速和旧版相同，复用本机已合成的缓存；只有变速播报使用独立键。
  const voice = voiceType();
  const cacheInput = speechRate === DEFAULT_SPEECH_RATE ? `${voice}|${text}` : `${voice}|rate=${speechRate}|${text}`;
  return createHash("sha256").update(cacheInput).digest("hex");
}

export class TtsError extends Error {
  constructor(
    message: string,
    /** unavailable=未配置密钥（UI 降级为纯字幕）；upstream=云端调用失败 */
    readonly kind: "unavailable" | "upstream"
  ) {
    super(message);
    this.name = "TtsError";
  }
}

async function readCache(key: string): Promise<Buffer | null> {
  try {
    return await readFile(path.join(CACHE_DIR, `${key}.mp3`));
  } catch {
    return null;
  }
}

async function writeCache(key: string, audio: Buffer): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(path.join(CACHE_DIR, `${key}.mp3`), audio);
  } catch {
    // 缓存写失败不阻断播报（下次重新合成即可）
  }
}

/**
 * 解析单向流式响应：HTTP Chunked 返回逐行 JSON，
 * 中间行 {code:0, data:<base64 音频分片>}，末行 {code:20000000, message:"OK"}。
 */
function parseStreamedAudio(rawBody: string): Buffer {
  const chunks: Buffer[] = [];
  for (const line of rawBody.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: { code?: number; message?: string; data?: string | null };
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new TtsError("TTS 响应格式异常（非 JSON 行）", "upstream");
    }
    if (parsed.code !== 0 && parsed.code !== 20000000) {
      throw new TtsError(`TTS 合成失败：${parsed.message ?? `code=${parsed.code}`}`, "upstream");
    }
    if (parsed.data) chunks.push(Buffer.from(parsed.data, "base64"));
  }
  if (chunks.length === 0) {
    throw new TtsError("TTS 响应中没有音频数据", "upstream");
  }
  return Buffer.concat(chunks);
}

/**
 * 合成播报音频（mp3）。优先返回缓存；未命中时调用豆包 TTS 并写缓存。
 * 调用方保证 text 不含患者姓名等 PII（话术模板统一出自 src/lib/dialogue/prompts.ts）。
 * speechRate：豆包 speech_rate [-50,100]，缺省 DEFAULT_SPEECH_RATE（-10）；
 * 认知指令播报传更低值放慢语速（2026-09-04 修改意见 3，见 cognitive-flow.INSTRUCTION_SPEECH_RATE）。
 */
export async function synthesizeSpeech(
  text: string,
  options?: { speechRate?: number }
): Promise<{ audio: Buffer; cached: boolean }> {
  const speechRate = options?.speechRate ?? DEFAULT_SPEECH_RATE;
  const key = ttsCacheKey(text, speechRate);
  const cachedAudio = await readCache(key);
  if (cachedAudio) return { audio: cachedAudio, cached: true };

  const appId = process.env.VOLC_APP_ID;
  const accessToken = process.env.VOLC_ACCESS_TOKEN;
  if (!appId || !accessToken) {
    throw new TtsError("TTS 未配置（缺少 VOLC_APP_ID / VOLC_ACCESS_TOKEN）", "unavailable");
  }

  const response = await piiSafeJsonFetch(TTS_ENDPOINT, {
    method: "POST",
    // 旧版控制台双头鉴权。文档写 X-Api-App-Id；实测同时携带 App-Key 亦兼容，双发以防文档口径差异
    headers: {
      "X-Api-App-Id": appId,
      "X-Api-App-Key": appId,
      "X-Api-Access-Key": accessToken,
      "X-Api-Resource-Id": resourceId(),
      "X-Api-Request-Id": randomUUID(),
    },
    jsonBody: {
      // uid 是调用方标识，非患者信息；播报文本与具体患者无关
      user: { uid: "yy-demo-tts" },
      req_params: {
        text,
        speaker: voiceType(),
        audio_params: {
          format: "mp3",
          sample_rate: 24000,
          speech_rate: speechRate,
        },
      },
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch((error: unknown) => {
    throw new TtsError(`TTS 请求失败：${error instanceof Error ? error.message : String(error)}`, "upstream");
  });

  if (!response.ok) {
    // 403 时错误明细常在响应体首行 JSON（如 45000030 = 资源未开通），解析出来便于排障
    const bodyText = await response.text().catch(() => "");
    let bodyMessage: string | undefined;
    for (const line of bodyText.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        bodyMessage = (JSON.parse(trimmed) as { header?: { message?: string } }).header?.message;
      } catch {
        // 忽略非 JSON 行
      }
      if (bodyMessage) break;
    }
    // 45000030 = 资源未开通（2026-09-14 实测：volc.seedtts.default not granted）：
    // 重试不会自愈，按 unavailable 归类（与 ASR 同口径），开通指引只落服务端日志
    if (bodyMessage?.includes("not granted")) {
      throw new TtsError(
        `语音合成服务未开通：请在火山引擎控制台开通 语音合成大模型（seed-tts-2.0）。明细：${bodyMessage}`,
        "unavailable"
      );
    }
    const detail = bodyMessage ?? response.headers.get("X-Api-Message") ?? `HTTP ${response.status}`;
    throw new TtsError(`TTS 服务返回错误：${detail}`, "upstream");
  }
  const audio = parseStreamedAudio(await response.text());
  await writeCache(key, audio);
  return { audio, cached: false };
}
