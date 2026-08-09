import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findTurn: vi.fn(),
  open: vi.fn(),
  realpath: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { dialogueTurn: { findFirst: mocks.findTurn } },
}));
vi.mock("node:fs/promises", () => ({
  open: mocks.open,
  realpath: mocks.realpath,
  stat: mocks.stat,
}));

import {
  GET,
  inspectDoctorAudioFile,
  parseDoctorAudioRange,
  resolveDoctorAudioPath,
} from "@/app/api/doctor/sessions/[id]/turns/[turnId]/audio/route";

const PARAMS = { params: Promise.resolve({ id: "session-1", turnId: "turn-1" }) };
const AUDIO_PATH = "audio-cache/recordings/session-1/answer.wav";
const AUDIO_BYTES = Buffer.from("RIFF-test");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findTurn.mockResolvedValue({ audioPath: AUDIO_PATH });
  mocks.realpath.mockImplementation(async (value: string) => value);
  mocks.stat.mockResolvedValue({ isFile: () => true, size: AUDIO_BYTES.length });
  mocks.open.mockResolvedValue({
    read: vi.fn(async (buffer: Buffer, offset: number, length: number, position: number) => {
      const bytesRead = AUDIO_BYTES.copy(buffer, offset, position, position + length);
      return { bytesRead };
    }),
    close: vi.fn().mockResolvedValue(undefined),
  });
});

describe("医生追溯本地录音读取", () => {
  it("只解析本会话录音目录内的相对音频路径", () => {
    expect(resolveDoctorAudioPath("session-1", AUDIO_PATH)).not.toBeNull();
    expect(resolveDoctorAudioPath("session-1", "audio-cache/recordings/session-2/other.wav")).toBeNull();
    expect(resolveDoctorAudioPath("session-1", "audio-cache/recordings/session-1/../session-2/other.wav")).toBeNull();
    expect(resolveDoctorAudioPath("session-1", "C:\\outside\\other.wav")).toBeNull();
  });

  it("按本地文件状态区分未录音、文件存在和文件缺失", async () => {
    await expect(inspectDoctorAudioFile("session-1", null)).resolves.toBe("not_recorded");
    await expect(inspectDoctorAudioFile("session-1", AUDIO_PATH)).resolves.toBe("available");

    mocks.stat.mockRejectedValueOnce(new Error("ENOENT"));
    await expect(inspectDoctorAudioFile("session-1", AUDIO_PATH)).resolves.toBe("missing");
  });

  it("校验对话轮次属于指定会话后才返回本地音频", async () => {
    const response = await GET(new Request("http://localhost"), PARAMS);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/wav");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("RIFF-test");
    expect(mocks.findTurn).toHaveBeenCalledWith({
      where: { id: "turn-1", sessionId: "session-1", role: "patient" },
      select: { audioPath: true },
    });
  });

  it("支持浏览器音频播放器的单段 Range 请求并拒绝越界范围", async () => {
    expect(parseDoctorAudioRange("bytes=2-5", AUDIO_BYTES.length)).toEqual({ start: 2, end: 5 });
    expect(parseDoctorAudioRange("bytes=-4", AUDIO_BYTES.length)).toEqual({ start: 5, end: 8 });
    expect(parseDoctorAudioRange("bytes=9-10", AUDIO_BYTES.length)).toBeNull();

    const partial = await GET(
      new Request("http://localhost", { headers: { Range: "bytes=2-5" } }),
      PARAMS
    );
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe("bytes 2-5/9");
    expect(Buffer.from(await partial.arrayBuffer()).toString()).toBe("FF-t");

    const invalid = await GET(
      new Request("http://localhost", { headers: { Range: "bytes=99-100" } }),
      PARAMS
    );
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get("content-range")).toBe("bytes */9");
  });

  it("跨会话轮次不存在或路径越界时拒绝读取", async () => {
    mocks.findTurn.mockResolvedValueOnce(null);
    const ownershipResponse = await GET(new Request("http://localhost"), PARAMS);
    expect(ownershipResponse.status).toBe(404);

    mocks.findTurn.mockResolvedValueOnce({
      audioPath: "audio-cache/recordings/session-1/../session-2/other.wav",
    });
    const boundaryResponse = await GET(new Request("http://localhost"), PARAMS);
    expect(boundaryResponse.status).toBe(404);
    expect(mocks.open).not.toHaveBeenCalled();
  });
});
