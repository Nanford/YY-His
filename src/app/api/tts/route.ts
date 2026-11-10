/**
 * INPUT:  查询参数 text（待播报文案，来自服务端下发的 speak 文案）、
 *         rate（可选，豆包 speech_rate [-50,100]；认知指令播报放慢语速用，2026-09-04 修改意见 3）
 * OUTPUT: GET —— mp3 音频（豆包 TTS，文本+语速哈希缓存）
 * POS:    患者端 <audio> 的播放源。密钥只在服务端；未配置时返回 503 供 UI 降级为纯字幕。
 */
import { synthesizeSpeech, TtsError } from "@/lib/providers/volc-tts";

/** 播报文案均为题目/话术级长度；超长请求直接拒绝，防滥用 */
const MAX_TEXT_LENGTH = 600;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const text = (url.searchParams.get("text") ?? "").trim();
  if (text.length === 0 || text.length > MAX_TEXT_LENGTH) {
    return Response.json({ error: "text 参数缺失或超长" }, { status: 400 });
  }
  // 语速参数：非法值忽略（走全局默认），合法值钳制在豆包允许区间
  const rateParam = url.searchParams.get("rate")?.trim();
  const rateRaw = rateParam ? Number(rateParam) : NaN;
  const speechRate = Number.isFinite(rateRaw) ? Math.max(-50, Math.min(100, Math.round(rateRaw))) : undefined;

  try {
    const { audio } = await synthesizeSpeech(text, { speechRate });
    return new Response(new Uint8Array(audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        // 同一文案音频不变，浏览器侧长缓存，进一步降低现场网络依赖
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    if (error instanceof TtsError) {
      // 故障细节（如 45000030 资源未开通）落服务端日志便于排障；患者端只走字幕降级
      console.error("TTS 不可用/失败：", error.message);
      const status = error.kind === "unavailable" ? 503 : 502;
      return Response.json({ error: error.message }, { status });
    }
    console.error("TTS 合成失败：", error);
    return Response.json({ error: "TTS 合成失败" }, { status: 500 });
  }
}
