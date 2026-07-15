/**
 * INPUT:  src/app/patient/sessions/[id]/wav-recorder.ts 的 VoiceActivityDetector（纯状态机）
 * OUTPUT: 答题档行为不变、intro 确认档"宽进"、门槛上限兜住校准期抢答 三组用例
 * POS:    VAD 是能量阈值近似方案，无法用合成信号覆盖真实声学，但状态机本身（门槛/时长判定）
 *         是确定性纯逻辑，可精确断言。本测试锁住"改动只放宽确认、不动答题"这条不变量。
 */
import { describe, expect, it } from "vitest";
import {
  CONSENT_VAD_CONFIG,
  VoiceActivityDetector,
} from "@/app/patient/sessions/[id]/wav-recorder";

const CHUNK_MS = 50;

interface FeedResult {
  speechStarted: boolean;
  stop: "auto-stop" | "timeout" | null;
}

function newResult(): FeedResult {
  return { speechStarted: false, stop: null };
}

/** 以固定 RMS 连续喂 durationMs 的音频块，累积触发的事件（stop 后即停止喂入）。 */
function feed(detector: VoiceActivityDetector, rms: number, durationMs: number, acc: FeedResult): void {
  for (let elapsed = 0; elapsed < durationMs; elapsed += CHUNK_MS) {
    if (acc.stop) return;
    const decision = detector.push(rms, CHUNK_MS);
    if (decision.speechStarted) acc.speechStarted = true;
    if (decision.stop) acc.stop = decision.stop;
  }
}

const QUIET = 0.002; // 安静底噪
const SPEECH = 0.05; // 正常说话能量

describe("VoiceActivityDetector 档位行为", () => {
  it("答题默认档：正常作答（出声≥300ms 后静音）触发 auto-stop（回归保护）", () => {
    const acc = newResult();
    const vad = new VoiceActivityDetector();
    feed(vad, QUIET, 300, acc); // 校准
    feed(vad, SPEECH, 400, acc); // 出声 400ms ≥ 默认 minSpeech 300ms
    expect(acc.speechStarted).toBe(true);
    feed(vad, QUIET, 1500, acc); // 静音 1500ms → 说完
    expect(acc.stop).toBe("auto-stop");
  });

  it("答题默认档：短促 150ms 出声不算说话，最终超时（行为不变）", () => {
    const acc = newResult();
    const vad = new VoiceActivityDetector();
    feed(vad, QUIET, 300, acc); // 校准
    feed(vad, SPEECH, 150, acc); // 150ms < 默认 minSpeech 300ms
    feed(vad, QUIET, 8000, acc); // 之后安静直到 8s 超时
    expect(acc.speechStarted).toBe(false);
    expect(acc.stop).toBe("timeout");
  });

  it("确认宽进档：同样 150ms 短促出声即算说话，随后静音 700ms → auto-stop", () => {
    const acc = newResult();
    const vad = new VoiceActivityDetector(CONSENT_VAD_CONFIG);
    feed(vad, QUIET, 300, acc); // 校准
    feed(vad, SPEECH, 150, acc); // 宽进档 minSpeech=150ms → 短促"好的/开始"也算数
    expect(acc.speechStarted).toBe(true);
    feed(vad, QUIET, 700, acc); // 宽进档 silenceHold=700ms → 更快判定说完
    expect(acc.stop).toBe("auto-stop");
  });

  it("门槛上限：校准期混入抢答时，默认档被顶到够不着、确认档仍能识别正常语音", () => {
    const polluted = 0.1; // 讲解一结束就抢答，说话落进 300ms 校准窗
    const normal = 0.08; // 之后的正常语音

    // 默认档无上限：门槛=0.1×3=0.3，正常语音 0.08 够不到 → 漏判 → 超时
    const accDefault = newResult();
    const vadDefault = new VoiceActivityDetector();
    feed(vadDefault, polluted, 300, accDefault);
    feed(vadDefault, normal, 500, accDefault);
    feed(vadDefault, QUIET, 8000, accDefault);
    expect(accDefault.speechStarted).toBe(false);
    expect(accDefault.stop).toBe("timeout");

    // 确认档上限 0.06 兜住：门槛被夹到 0.06，正常语音 0.08 仍被识别 → 触发
    const accConsent = newResult();
    const vadConsent = new VoiceActivityDetector(CONSENT_VAD_CONFIG);
    feed(vadConsent, polluted, 300, accConsent);
    feed(vadConsent, normal, 200, accConsent);
    expect(accConsent.speechStarted).toBe(true);
  });
});
