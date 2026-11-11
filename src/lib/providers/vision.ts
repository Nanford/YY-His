/**
 * INPUT:  环境变量 DASHSCOPE_API_KEY（或通用名 VISION_API_KEY，后者优先）、
 *         VISION_MODEL（可选，默认 qwen3-vl-plus）、VISION_ARBITRATION_MODEL（可选，临界复核用，默认 qwen3.8-max）、
 *         VISION_API_BASE（可选，默认阿里云百炼兼容入口）、
 *         待观察的图片（data URL）与提示词——不含任何患者身份信息
 * OUTPUT: visionAvailable、requestVisionJson —— 具备视觉理解能力的大模型看图并返回 JSON 对象
 * POS:    画图题（画钟等）的看图通道（2026-11-10 用户拍板：改用阿里通义千问 VL，
 *         密钥为 .env.local 的 DASHSCOPE_API_KEY）。
 *         按 OpenAI 兼容的 chat/completions 多模态格式调用，地址/密钥/模型名全走环境变量，
 *         换模型或换厂商（火山方舟豆包视觉等同样兼容该格式）不需要改代码。
 *         本层只负责"发图、拿回 JSON"，不含任何题目口径：模型看到了什么由调用方定义输出结构、
 *         逐字段校验后再用（模型输出不可信），对错判定在调用方用确定性规则完成（硬约束 2）。
 *         出网内容只有图片与提示词，不带患者编号/姓名（硬约束 1），且仍经 piiSafeJsonFetch 出网。
 *         通道不可用或调用失败返回 null，由调用方回落到"待医生确认计分"。
 *         2026-11-11（画图不再等医生确认）：限流/服务端错误/网络中断自动重试 1 次，减少因瞬时故障交医生；
 *         超时不重试（单次已等 30 秒，患者在交卷界面等不起）。
 */
import { piiSafeJsonFetch } from "./pii-filter";

/** 阿里云百炼（DashScope）OpenAI 兼容入口（来源：百炼文档「OpenAI 兼容 - Chat」） */
const DEFAULT_API_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1";
/**
 * 默认视觉模型：通义千问 VL。2026-11-10 用该账号实测：qwen-vl-max 返回 model_not_found，
 * qwen3-vl-plus 可用；可用 VISION_MODEL 覆盖为账号下其他视觉模型。
 */
const DEFAULT_MODEL = "qwen3-vl-plus";
/**
 * 画图题临界复核的默认模型（2026-11-11 用户拍板）：同一批合成临界图实测，qwen3-vl-plus 看不出
 * "尖角伸进另一个图形里"的五边形（总看成矩形），会把照参照图画对的临摹判成 0 分，附上参照图也一样；
 * qwen3.8-max 能判对。只在首轮拿不准时调用，单次约 2～3 秒。仅用于默认百炼入口（其他厂商没有这个模型名）。
 */
const DEFAULT_ARBITRATION_MODEL = "qwen3.8-max";
/** 看图比纯文本慢，超时放宽；超时即回落医生确认，不阻塞流程 */
const REQUEST_TIMEOUT_MS = 30_000;
/** 瞬时故障（限流、服务端错误、网络中断）的自动重试次数；超时、鉴权失败等不重试 */
const TRANSIENT_RETRIES = 1;

interface VisionConfig {
  apiKey: string;
  /** 首轮看图观察用的模型 */
  model: string;
  /** 临界复核用的模型 */
  arbitrationModel: string;
  apiBase: string;
  /** 合并进请求体的厂商扩展参数 */
  extraBody: Record<string, unknown>;
}

/**
 * 厂商扩展参数：VISION_EXTRA_BODY（JSON 对象）显式配置优先；未配置且走默认的百炼入口时，
 * 关闭深度思考（enable_thinking=false，来源：百炼文档「深度思考」）——看图观察是逐项报告，
 * 不需要长思考；2026-11-10 实测不关时单次 15～30 秒且频繁超时，患者端等不起。
 * 换其他厂商（改了 VISION_API_BASE）时不附带任何扩展参数，避免对方拒绝未知字段。
 */
function resolveExtraBody(usingDefaultBase: boolean): Record<string, unknown> {
  const configured = (process.env.VISION_EXTRA_BODY || "").trim();
  if (configured) {
    try {
      const parsed: unknown = JSON.parse(configured);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // 配置写错不阻断：落到下面的默认值，并在服务端日志提示
    }
    console.warn("[vision] VISION_EXTRA_BODY 不是合法的 JSON 对象，已忽略");
  }
  return usingDefaultBase ? { enable_thinking: false } : {};
}

/** 读取视觉通道配置；值做 trim（.env 里等号后带空格是常见手误） */
function visionConfig(): VisionConfig | null {
  const apiKey = (process.env.VISION_API_KEY || process.env.DASHSCOPE_API_KEY || "").trim();
  if (!apiKey) return null;
  const configuredBase = (process.env.VISION_API_BASE || "").trim();
  const model = (process.env.VISION_MODEL || "").trim() || DEFAULT_MODEL;
  return {
    apiKey,
    model,
    // 换了厂商（配了 VISION_API_BASE）又没单独配复核模型时沿用观察模型，不去请求对方不存在的模型名
    arbitrationModel:
      (process.env.VISION_ARBITRATION_MODEL || "").trim() || (configuredBase ? model : DEFAULT_ARBITRATION_MODEL),
    apiBase: (configuredBase || DEFAULT_API_BASE).replace(/\/+$/, ""),
    extraBody: resolveExtraBody(configuredBase.length === 0),
  };
}

export function visionAvailable(): boolean {
  return visionConfig() !== null;
}

export interface VisionJsonRequest {
  /** 系统提示：角色与输出 JSON 结构 */
  systemPrompt: string;
  /** 用户侧文字说明（题意等） */
  userText: string;
  /** 图片 data URL，按顺序发送（临摹题可先放示例图再放患者画作） */
  imageDataUrls: readonly string[];
  /** 用途：arbitration = 画图题临界复核，走复核模型；缺省为首轮观察 */
  purpose?: "observation" | "arbitration";
}

/** 模型输出可能包在 ```json 代码块或前后带说明文字里：取第一个 { 到最后一个 } 之间的内容解析 */
export function extractJsonObject(content: string): Record<string, unknown> | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(content.slice(start, end + 1));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 单次请求的结果：done = 已有定论（成功或不值得重试的失败）；transient = 瞬时故障，可重试 */
type AttemptResult = { kind: "done"; value: Record<string, unknown> | null } | { kind: "transient" };

/** 429 限流与 5xx 服务端错误属瞬时故障；4xx 是密钥/模型名/请求体配置问题，重试也不会好 */
function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function attemptVisionRequest(config: VisionConfig, jsonBody: Record<string, unknown>): Promise<AttemptResult> {
  try {
    const response = await piiSafeJsonFetch(`${config.apiBase}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      jsonBody,
      // 每次尝试单独计时，重试不吃上一次剩下的时间
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      // 只记状态码与服务端错误摘要（不含图片与患者信息），便于演示现场排查密钥/模型名配置
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      console.warn(`[vision] 看图请求失败：HTTP ${response.status} ${detail}`);
      return isTransientStatus(response.status) ? { kind: "transient" } : { kind: "done", value: null };
    }
    const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) return { kind: "done", value: null };
    return { kind: "done", value: extractJsonObject(content) };
  } catch (error) {
    console.warn(`[vision] 看图调用异常：${error instanceof Error ? error.name : "unknown"}`);
    // fetch 的网络中断抛 TypeError，可重试；超时（TimeoutError）、PII 拦截、响应体解析失败都不重试
    return error instanceof TypeError ? { kind: "transient" } : { kind: "done", value: null };
  }
}

/**
 * 发图并取回模型输出的 JSON 对象。
 * 返回 null = 通道不可用或调用失败（未配置/网络/超时/输出不是 JSON 对象）。
 * 返回的对象未经校验，调用方必须逐字段校验后再用。
 */
export async function requestVisionJson(request: VisionJsonRequest): Promise<Record<string, unknown> | null> {
  const config = visionConfig();
  if (!config) return null;

  const userContent: Record<string, unknown>[] = [
    { type: "text", text: request.userText },
    ...request.imageDataUrls.map((url) => ({ type: "image_url", image_url: { url } })),
  ];
  // 出网 payload 只含提示词与图片；不传 user 字段（看图不需要任何患者标识）
  const jsonBody: Record<string, unknown> = {
    ...config.extraBody,
    model: request.purpose === "arbitration" ? config.arbitrationModel : config.model,
    temperature: 0,
    messages: [
      { role: "system", content: request.systemPrompt },
      { role: "user", content: userContent },
    ],
  };

  for (let attempt = 0; attempt <= TRANSIENT_RETRIES; attempt += 1) {
    const result = await attemptVisionRequest(config, jsonBody);
    if (result.kind === "done") return result.value;
  }
  return null;
}
