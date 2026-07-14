/**
 * INPUT:  multipart 表单（sessionId + 患者回答录音 WAV 文件）
 * OUTPUT: POST —— { text, audioPath, raw }：转写文本 + 录音存档路径 + ASR 原始返回
 * POS:    患者语音回答的转写入口。录音先落盘存档（追溯硬约束 4），再送火山 ASR；
 *         出网只携带音频与患者唯一编号。未配置密钥返回 503，UI 隐藏语音入口。
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { AsrError, recognizeSpeech } from "@/lib/providers/volc-asr";

/** 单段回答录音上限：16kHz 16bit 单声道 WAV 约 1.9MB/分钟，8MB 足够容纳数分钟 */
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "请求不是有效的 multipart 表单" }, { status: 400 });
  }
  const sessionId = form.get("sessionId");
  const audio = form.get("audio");
  if (typeof sessionId !== "string" || sessionId.length < 5 || !(audio instanceof File)) {
    return Response.json({ error: "缺少 sessionId 或录音文件" }, { status: 400 });
  }
  if (audio.size === 0 || audio.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: "录音为空或超出大小限制" }, { status: 400 });
  }

  const session = await prisma.assessmentSession.findUnique({
    where: { id: sessionId },
    include: { patient: { select: { code: true } } },
  });
  if (!session || session.status !== "in_progress") {
    return Response.json({ error: "会话不存在或不在采集中" }, { status: 409 });
  }

  const buffer = Buffer.from(await audio.arrayBuffer());

  // 1. 录音先落盘存档：即使 ASR 失败，原始语音也已保留（全链路可追溯）
  const relativePath = `audio-cache/recordings/${session.id}/${randomUUID()}.wav`;
  const absolutePath = path.join(process.cwd(), "storage", relativePath);
  try {
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, buffer);
  } catch (error) {
    console.error("录音存档失败：", error);
    return Response.json({ error: "录音存档失败" }, { status: 500 });
  }

  // 2. 送火山 ASR 转写（uid 只携带患者唯一编号，经 PII 过滤层出网）
  try {
    const result = await recognizeSpeech({ audio: buffer, patientCode: session.patient.code });
    return Response.json({ text: result.text, audioPath: relativePath, raw: result.raw });
  } catch (error) {
    if (error instanceof AsrError) {
      const status = error.kind === "unavailable" ? 503 : 502;
      return Response.json({ error: error.message, audioPath: relativePath }, { status });
    }
    console.error("ASR 转写失败：", error);
    return Response.json({ error: "ASR 转写失败", audioPath: relativePath }, { status: 500 });
  }
}
