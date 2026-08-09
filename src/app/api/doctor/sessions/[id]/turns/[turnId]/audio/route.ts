/**
 * INPUT:  医生追溯页的会话 id、对话轮次 id、本地 DialogueTurn.audioPath
 * OUTPUT: GET —— 受会话与轮次归属保护的本地原始录音二进制
 * POS:    医生追溯音频唯一读取入口；不经过 public 目录、不访问第三方服务，
 *         仅允许读取 storage/audio-cache/recordings/<sessionId>/ 下的实际文件。
 */
import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type DoctorAudioStatus = "available" | "missing" | "not_recorded";

// 路径动态取自数据库，构建期不能枚举具体录音文件；限定根目录后由下方词法边界 + realpath 双重校验。
const STORAGE_ROOT = path.join(/*turbopackIgnore: true*/ process.cwd(), "storage");
const RECORDINGS_ROOT = path.resolve(STORAGE_ROOT, "audio-cache", "recordings");
const RECORD_ID_PATTERN = /^[A-Za-z0-9_-]{5,128}$/;
const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".webm", ".ogg", ".m4a"]);

function isSafeRecordId(value: string): boolean {
  return RECORD_ID_PATTERN.test(value);
}

function isDescendant(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

/**
 * 先做词法边界校验，再由 safeAudioFilePath 做 realpath 校验，双重防止
 * ../、绝对路径或符号链接把读取范围带出本会话录音目录。
 */
export function resolveDoctorAudioPath(sessionId: string, audioPath: string | null): string | null {
  if (!isSafeRecordId(sessionId) || !audioPath || audioPath.includes(String.fromCharCode(0))) return null;
  if (path.isAbsolute(audioPath) || path.posix.isAbsolute(audioPath) || path.win32.isAbsolute(audioPath)) return null;

  const candidate = path.resolve(/*turbopackIgnore: true*/ STORAGE_ROOT, audioPath);
  const sessionRoot = path.resolve(RECORDINGS_ROOT, sessionId);
  if (!isDescendant(sessionRoot, candidate)) return null;

  const extension = path.extname(candidate).toLowerCase();
  return AUDIO_EXTENSIONS.has(extension) ? candidate : null;
}

async function safeAudioFilePath(sessionId: string, audioPath: string | null): Promise<string | null> {
  const candidate = resolveDoctorAudioPath(sessionId, audioPath);
  if (!candidate) return null;

  try {
    const realRecordingsRoot = await realpath(/*turbopackIgnore: true*/ RECORDINGS_ROOT);
    const realSessionRoot = await realpath(
      /*turbopackIgnore: true*/ path.resolve(RECORDINGS_ROOT, sessionId)
    );
    const realCandidate = await realpath(/*turbopackIgnore: true*/ candidate);
    if (!isDescendant(realRecordingsRoot, realSessionRoot) || !isDescendant(realSessionRoot, realCandidate)) {
      return null;
    }
    const info = await stat(/*turbopackIgnore: true*/ realCandidate);
    return info.isFile() ? realCandidate : null;
  } catch {
    return null;
  }
}

/** 页面展示用：有路径但文件不存在、路径越界或不是普通文件，统一记为 missing。 */
export async function inspectDoctorAudioFile(
  sessionId: string,
  audioPath: string | null
): Promise<DoctorAudioStatus> {
  if (!audioPath) return "not_recorded";
  return (await safeAudioFilePath(sessionId, audioPath)) ? "available" : "missing";
}

function contentTypeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".wav":
      return "audio/wav";
    case ".mp3":
      return "audio/mpeg";
    case ".webm":
      return "audio/webm";
    case ".ogg":
      return "audio/ogg";
    case ".m4a":
      return "audio/mp4";
    default:
      return "application/octet-stream";
  }
}

interface ByteRange {
  start: number;
  end: number;
}

/** 只接受单段 bytes 范围；非法或越界返回 null，由路由按 RFC 7233 返回 416。 */
export function parseDoctorAudioRange(rangeHeader: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || size <= 0) return null;
  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return null;

  if (!startRaw) {
    const suffixLength = Number(endRaw);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(startRaw);
  const requestedEnd = endRaw ? Number(endRaw) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return null;
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

async function readAudioBytes(filePath: string, range: ByteRange): Promise<Buffer> {
  const length = range.end - range.start + 1;
  const buffer = Buffer.allocUnsafe(length);
  const handle = await open(/*turbopackIgnore: true*/ filePath, "r");
  try {
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await handle.read(buffer, offset, length - offset, range.start + offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return offset === length ? buffer : buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; turnId: string }> }
): Promise<Response> {
  const { id: sessionId, turnId } = await context.params;
  if (!isSafeRecordId(sessionId) || !isSafeRecordId(turnId)) {
    return Response.json({ error: "录音参数无效" }, { status: 400 });
  }

  // Demo 暂无登录鉴权；资源级授权必须同时命中本会话、患者回答轮次，避免跨会话 IDOR。
  const turn = await prisma.dialogueTurn.findFirst({
    where: { id: turnId, sessionId, role: "patient" },
    select: { audioPath: true },
  });
  if (!turn) return Response.json({ error: "录音不存在" }, { status: 404 });

  const filePath = await safeAudioFilePath(sessionId, turn.audioPath);
  if (!filePath) {
    return Response.json(
      { error: turn.audioPath ? "录音文件缺失" : "本题未录音" },
      { status: 404 }
    );
  }

  try {
    const info = await stat(/*turbopackIgnore: true*/ filePath);
    const rangeHeader = request.headers.get("range");
    const range = rangeHeader
      ? parseDoctorAudioRange(rangeHeader, info.size)
      : info.size > 0
        ? { start: 0, end: info.size - 1 }
        : null;
    if (rangeHeader && !range) {
      return new Response(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${info.size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, no-store",
        },
      });
    }
    const buffer = range ? await readAudioBytes(filePath, range) : Buffer.alloc(0);
    // Response 的 DOM 类型不接受 Node Buffer<ArrayBufferLike>；复制为标准 ArrayBuffer 后返回。
    const body = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(body).set(buffer);
    const isPartial = Boolean(rangeHeader && range);
    return new Response(body, {
      status: isPartial ? 206 : 200,
      headers: {
        "Content-Type": contentTypeFor(filePath),
        "Content-Length": String(buffer.byteLength),
        "Accept-Ranges": "bytes",
        ...(isPartial && range
          ? { "Content-Range": `bytes ${range.start}-${range.end}/${info.size}` }
          : {}),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "录音文件缺失" }, { status: 404 });
  }
}
