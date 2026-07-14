/**
 * INPUT:  VOLC_APP_ID / VOLC_ACCESS_TOKEN / VOLC_TTS_VOICE 环境变量、待播报文本（不含 PII）
 * OUTPUT: ttsAvailable、synthesizeSpeech —— 豆包 TTS 语音合成（文本哈希缓存）
 * POS:    数字医生播报音频的唯一来源。服务端调用 + storage/audio-cache 缓存，
 *         现场网络不可控时优先命中缓存（AGENTS.md"已知的坑"）。密钥只在服务端使用。
 *
 * 注意：本 Provider 尚未用真实密钥联调（密钥就绪后需按火山控制台配置核对
 * cluster/voice_type）。接口文档依据：火山引擎语音合成 HTTP 协议 /api/v1/tts。
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { piiSafeJsonFetch } from "./pii-filter";

const TTS_ENDPOINT = "https://openspeech.bytedance.com/api/v1/tts";
const REQUEST_TIMEOUT_MS = 15_000;
/** 豆包音色，可用 VOLC_TTS_VOICE 覆盖（需在火山控制台开通对应音色） */
const DEFAULT_VOICE = "zh_female_wanwanxiaohe_moon_bigtts";
/** 缓存根目录（.gitignore 已排除 storage/） */
const CACHE_DIR = path.join(process.cwd(), "storage", "audio-cache", "tts");

export function ttsAvailable(): boolean {
  return Boolean(process.env.VOLC_APP_ID && process.env.VOLC_ACCESS_TOKEN);
}

function voiceType(): string {
  return process.env.VOLC_TTS_VOICE || DEFAULT_VOICE;
}

/** 缓存键：音色 + 文本 的哈希。换音色不会命中旧缓存 */
export function ttsCacheKey(text: string): string {
  return createHash("sha256").update(`${voiceType()}|${text}`).digest("hex");
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
 * 合成播报音频（mp3）。优先返回缓存；未命中时调用豆包 TTS 并写缓存。
 * 调用方保证 text 不含患者姓名等 PII（话术模板统一出自 src/lib/dialogue/prompts.ts）。
 */
export async function synthesizeSpeech(text: string): Promise<{ audio: Buffer; cached: boolean }> {
  const key = ttsCacheKey(text);
  const cachedAudio = await readCache(key);
  if (cachedAudio) return { audio: cachedAudio, cached: true };

  const appId = process.env.VOLC_APP_ID;
  const accessToken = process.env.VOLC_ACCESS_TOKEN;
  if (!appId || !accessToken) {
    throw new TtsError("TTS 未配置（缺少 VOLC_APP_ID / VOLC_ACCESS_TOKEN）", "unavailable");
  }

  const response = await piiSafeJsonFetch(TTS_ENDPOINT, {
    method: "POST",
    // 火山 TTS 的鉴权格式为 "Bearer;{token}"（分号是协议要求，非笔误）
    headers: { Authorization: `Bearer;${accessToken}` },
    jsonBody: {
      app: { appid: appId, token: accessToken, cluster: "volcano_tts" },
      // uid 是调用方标识，非患者信息；播报文本与具体患者无关
      user: { uid: "yy-demo-tts" },
      audio: {
        voice_type: voiceType(),
        encoding: "mp3",
        speed_ratio: 0.9, // 面向老年患者：语速放缓
      },
      request: { reqid: randomUUID(), text, operation: "query" },
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch((error: unknown) => {
    throw new TtsError(`TTS 请求失败：${error instanceof Error ? error.message : String(error)}`, "upstream");
  });

  if (!response.ok) {
    throw new TtsError(`TTS 服务返回 HTTP ${response.status}`, "upstream");
  }
  const body = (await response.json()) as { code?: number; message?: string; data?: string };
  // 火山协议：code 3000 为成功，data 为 base64 音频
  if (body.code !== 3000 || !body.data) {
    throw new TtsError(`TTS 合成失败：${body.message ?? `code=${body.code}`}`, "upstream");
  }
  const audio = Buffer.from(body.data, "base64");
  await writeCache(key, audio);
  return { audio, cached: false };
}
