/**
 * INPUT:  浏览器麦克风（getUserMedia + Web Audio API）
 * OUTPUT: WavRecorder —— 录音并编码为 16kHz 单声道 16bit WAV Blob；
 *         start() 可选传入 VadListener，由声音活动检测（VAD）自动判断患者说完了并回调，
 *         免去"说完了再点一下按钮"这一步
 * POS:    患者端语音作答的采音层。统一输出 WAV：MediaRecorder 的 webm/opus
 *         容器在火山 ASR 侧兼容性不稳，PCM WAV 是最稳的通用格式。
 *
 * VAD 是能量阈值近似方案（非语义理解），阈值按开麦克风后前 300ms 环境噪音自适应，
 * 不是写死常量——演示环境噪声水平不可控。老年患者说话可能有较长停顿，调参只能
 * 现场试，不追求一次到位；因此上层 UI 必须始终保留手动兜底按钮（见 answer-input.tsx）。
 */

const TARGET_SAMPLE_RATE = 16_000;

/** VAD 判断"说完了"触发自动停止的原因；manual（用户手动点兜底按钮）由调用方另行定义 */
export type VadStopReason = "auto-stop" | "timeout";

export interface VadListener {
  /** 首次检测到持续说话时触发一次，供 UI 切换"正在听您说话" */
  onSpeechStart?: () => void;
  /** auto-stop=检测到说完静音超时；timeout=从未检测到说话即超时兜底 */
  onAutoStop: (reason: VadStopReason) => void;
}

const VAD_CALIBRATION_MS = 300;
/** 需持续超过这个时长才计入"说话"，防止咳嗽/碰麦克风等瞬时噪声被误判为回答 */
const VAD_MIN_SPEECH_MS = 300;
/** 说话后静音持续这么久才判定"说完了"——老年患者语气停顿长，取值偏保守 */
const VAD_SILENCE_HOLD_MS = 1500;
/** 硬顶：无论如何 20 秒后强制停止，防止 VAD 判断失误导致无限录音 */
const VAD_MAX_DURATION_MS = 20_000;
/** 从未检测到说话时的超时兜底，早于硬顶给出反馈，避免患者干等 */
const VAD_NO_SPEECH_TIMEOUT_MS = 8_000;
const VAD_SPEECH_MULTIPLIER = 3;
/** 环境接近绝对静音时的阈值下限，避免 noiseFloor≈0 导致任何声响都触发说话 */
const VAD_ABSOLUTE_MIN_RMS = 0.01;
const VAD_SILENCE_RATIO = 0.6;

function computeRms(samples: Float32Array): number {
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) sumSquares += samples[i] * samples[i];
  return Math.sqrt(sumSquares / samples.length);
}

/** 能量阈值 VAD 状态机：校准噪声底噪 → 等待说话 → 说话中 → 静音超时/硬顶后停止 */
class VoiceActivityDetector {
  private phase: "calibrating" | "waiting" | "speaking" | "stopped" = "calibrating";
  private elapsedMs = 0;
  private noiseSamples: number[] = [];
  private speechThreshold = VAD_ABSOLUTE_MIN_RMS;
  private silenceThreshold = VAD_ABSOLUTE_MIN_RMS;
  private continuousSpeechMs = 0;
  private continuousSilenceMs = 0;
  private hasSpoken = false;

  /** 每个音频块推进一次状态机，触发时返回对应事件，否则返回空对象 */
  push(rms: number, chunkMs: number): { speechStarted?: true; stop?: VadStopReason } {
    if (this.phase === "stopped") return {};
    this.elapsedMs += chunkMs;

    if (this.phase === "calibrating") {
      this.noiseSamples.push(rms);
      if (this.elapsedMs < VAD_CALIBRATION_MS) return {};
      const noiseFloor = this.noiseSamples.reduce((sum, value) => sum + value, 0) / this.noiseSamples.length;
      this.speechThreshold = Math.max(noiseFloor * VAD_SPEECH_MULTIPLIER, VAD_ABSOLUTE_MIN_RMS);
      this.silenceThreshold = this.speechThreshold * VAD_SILENCE_RATIO;
      this.phase = "waiting";
      return {};
    }

    if (this.phase === "waiting") {
      if (rms >= this.speechThreshold) {
        this.continuousSpeechMs += chunkMs;
        if (this.continuousSpeechMs >= VAD_MIN_SPEECH_MS) {
          this.phase = "speaking";
          this.hasSpoken = true;
          this.continuousSilenceMs = 0;
          return { speechStarted: true };
        }
      } else {
        this.continuousSpeechMs = 0;
      }
      if (this.elapsedMs >= VAD_NO_SPEECH_TIMEOUT_MS) {
        this.phase = "stopped";
        return { stop: "timeout" };
      }
      return {};
    }

    // speaking
    if (rms < this.silenceThreshold) {
      this.continuousSilenceMs += chunkMs;
      if (this.continuousSilenceMs >= VAD_SILENCE_HOLD_MS) {
        this.phase = "stopped";
        return { stop: "auto-stop" };
      }
    } else {
      this.continuousSilenceMs = 0;
    }
    if (this.elapsedMs >= VAD_MAX_DURATION_MS) {
      this.phase = "stopped";
      return { stop: "auto-stop" };
    }
    return {};
  }
}

export class RecorderError extends Error {
  constructor(
    message: string,
    /** denied=用户拒绝麦克风授权；unsupported=浏览器不支持；failed=其他失败 */
    readonly kind: "denied" | "unsupported" | "failed"
  ) {
    super(message);
    this.name = "RecorderError";
  }
}

export class WavRecorder {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private inputSampleRate = TARGET_SAMPLE_RATE;

  /**
   * 开始录音（需要用户手势触发以满足浏览器策略）。
   * 传入 vad 时自动检测"说完了"并回调 onAutoStop，调用方收到回调后自行调用 stop() 完成上传；
   * 不传则保持原有"手动调用 stop() 才结束"的行为。
   */
  async start(vad?: VadListener): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new RecorderError("当前浏览器不支持录音", "unsupported");
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch (error) {
      const denied = error instanceof DOMException && error.name === "NotAllowedError";
      throw new RecorderError(
        denied ? "麦克风授权被拒绝，请改用按钮或文字作答" : "无法打开麦克风",
        denied ? "denied" : "failed"
      );
    }
    this.context = new AudioContext();
    this.inputSampleRate = this.context.sampleRate;
    this.source = this.context.createMediaStreamSource(this.stream);
    // ScriptProcessor 已标记废弃但各浏览器仍全面支持；AudioWorklet 需要额外文件加载，
    // 演示场景取稳妥方案。替换路径：迁移到 AudioWorkletNode（见 M4 打磨项）。
    this.processor = this.context.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    const detector = vad ? new VoiceActivityDetector() : null;
    const chunkMs = (4096 / this.inputSampleRate) * 1000;
    this.processor.onaudioprocess = (event) => {
      const data = event.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(data));
      if (!detector || !vad) return;
      const decision = detector.push(computeRms(data), chunkMs);
      if (decision.speechStarted) vad.onSpeechStart?.();
      if (decision.stop) vad.onAutoStop(decision.stop);
    };
    this.source.connect(this.processor);
    this.processor.connect(this.context.destination);
  }

  /** 结束录音并编码 WAV。未开始或无声音时返回 null */
  async stop(): Promise<Blob | null> {
    const { chunks, inputSampleRate } = this;
    this.teardown();
    if (chunks.length === 0) return null;

    const merged = mergeChunks(chunks);
    const resampled = downsample(merged, inputSampleRate, TARGET_SAMPLE_RATE);
    if (resampled.length === 0) return null;
    return new Blob([encodeWav(resampled, TARGET_SAMPLE_RATE)], { type: "audio/wav" });
  }

  /** 释放麦克风与音频节点（stop 或组件卸载时调用） */
  teardown(): void {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.context?.close().catch(() => undefined);
    this.processor = null;
    this.source = null;
    this.stream = null;
    this.context = null;
    this.chunks = [];
  }
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

/** 均值抽取降采样（48k → 16k 常见比率下质量足够语音识别使用） */
function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    output[i] = end > start ? sum / (end - start) : 0;
  }
  return output;
}

/** PCM Float32 → 16bit WAV（RIFF 头 + LPCM 数据） */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // fmt 块长度
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // 字节率
  view.setUint16(32, 2, true); // 块对齐
  view.setUint16(34, 16, true); // 位深
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return buffer;
}
