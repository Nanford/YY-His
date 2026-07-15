/**
 * INPUT:  浏览器麦克风（getUserMedia + Web Audio API）
 * OUTPUT: requestMicStream() —— 申请一次麦克风流，调用方持有并可跨多次录音复用；
 *         WavRecorder —— 用外部传入的流录音，编码为 16kHz 单声道 16bit WAV Blob；
 *         start() 可选传入 VadListener，由声音活动检测（VAD）自动判断患者说完了并回调，
 *         免去"说完了再点一下按钮"这一步
 * POS:    患者端语音作答的采音层。统一输出 WAV：MediaRecorder 的 webm/opus
 *         容器在火山 ASR 侧兼容性不稳，PCM WAV 是最稳的通用格式。
 *
 * 麦克风流与单次录音的生命周期是分离的：浏览器策略要求首次弹出授权必须由真实点击
 * 触发，但同一权限一旦被允许，同页面后续再申请不需要新手势也不会再弹窗。因此把
 * 申请动作收敛到"开始评估"这一次点击（interview-screen.tsx），流由患者端页面持有，
 * 逐题只是在这条已授权的流上开关 AudioContext 采样，不重新申请——这样才能做到
 * "播报完自动开始听"而不需要患者每题都点一次。WavRecorder 自身不再管流的申请/释放。
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
  /**
   * 每个音频块的实时音量（未归一化 RMS，约 0～0.3），供 UI 语音波浪显示。
   * 纯只读旁路：不参与 VAD 判定，归一化与平滑交给上层组件（answer-input.tsx）。
   */
  onLevel?: (rms: number) => void;
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
/** 说话门槛上限：答题档默认不设限（Infinity），保持既有行为完全不变 */
const VAD_MAX_SPEECH_THRESHOLD = Infinity;

/**
 * VAD 可覆盖参数：不传时全部回落上面的答题档常量，因此答题录音路径行为与改动前字节一致。
 * intro 语音确认传 CONSENT_VAD_CONFIG 走"宽进"档（见其注释）。
 */
export interface VadConfig {
  calibrationMs?: number;
  minSpeechMs?: number;
  silenceHoldMs?: number;
  maxDurationMs?: number;
  noSpeechTimeoutMs?: number;
  speechMultiplier?: number;
  absoluteMinRms?: number;
  silenceRatio?: number;
  /** 门槛上限：防止校准期混入说话/回声把门槛顶到正常语音都够不着（答题档为 Infinity=不设限） */
  maxSpeechThreshold?: number;
}

/**
 * intro 语音确认专用"宽进"档：确认是低风险动作——宁可误进也别漏判（第一题本就要问）。
 * 相比答题档：最短说话时长更短（短促"好的/开始"也算数）、出声门槛更低、说完判定更快、
 * 无声超时更早（上层据此重新听而非死锁），并加门槛上限兜住"讲解一结束就抢答、
 * 说话落进 300ms 校准期把门槛顶高"这一最常见的漏判成因。
 */
export const CONSENT_VAD_CONFIG: VadConfig = {
  minSpeechMs: 150,
  silenceHoldMs: 700,
  noSpeechTimeoutMs: 4_000,
  speechMultiplier: 2,
  maxSpeechThreshold: 0.06,
};

function computeRms(samples: Float32Array): number {
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) sumSquares += samples[i] * samples[i];
  return Math.sqrt(sumSquares / samples.length);
}

/**
 * 能量阈值 VAD 状态机：校准噪声底噪 → 等待说话 → 说话中 → 静音超时/硬顶后停止。
 * 档位参数经构造函数注入（缺省回落答题档常量）：答题不传 config 即行为与改动前一致，
 * intro 确认传 CONSENT_VAD_CONFIG 走宽进档。导出供纯状态机单测。
 */
export class VoiceActivityDetector {
  private phase: "calibrating" | "waiting" | "speaking" | "stopped" = "calibrating";
  private elapsedMs = 0;
  private noiseSamples: number[] = [];
  private speechThreshold: number;
  private silenceThreshold: number;
  private continuousSpeechMs = 0;
  private continuousSilenceMs = 0;

  private readonly calibrationMs: number;
  private readonly minSpeechMs: number;
  private readonly silenceHoldMs: number;
  private readonly maxDurationMs: number;
  private readonly noSpeechTimeoutMs: number;
  private readonly speechMultiplier: number;
  private readonly absoluteMinRms: number;
  private readonly silenceRatio: number;
  private readonly maxSpeechThreshold: number;

  constructor(config?: VadConfig) {
    this.calibrationMs = config?.calibrationMs ?? VAD_CALIBRATION_MS;
    this.minSpeechMs = config?.minSpeechMs ?? VAD_MIN_SPEECH_MS;
    this.silenceHoldMs = config?.silenceHoldMs ?? VAD_SILENCE_HOLD_MS;
    this.maxDurationMs = config?.maxDurationMs ?? VAD_MAX_DURATION_MS;
    this.noSpeechTimeoutMs = config?.noSpeechTimeoutMs ?? VAD_NO_SPEECH_TIMEOUT_MS;
    this.speechMultiplier = config?.speechMultiplier ?? VAD_SPEECH_MULTIPLIER;
    this.absoluteMinRms = config?.absoluteMinRms ?? VAD_ABSOLUTE_MIN_RMS;
    this.silenceRatio = config?.silenceRatio ?? VAD_SILENCE_RATIO;
    this.maxSpeechThreshold = config?.maxSpeechThreshold ?? VAD_MAX_SPEECH_THRESHOLD;
    this.speechThreshold = this.absoluteMinRms;
    this.silenceThreshold = this.absoluteMinRms;
  }

  /** 每个音频块推进一次状态机，触发时返回对应事件，否则返回空对象 */
  push(rms: number, chunkMs: number): { speechStarted?: true; stop?: VadStopReason } {
    if (this.phase === "stopped") return {};
    this.elapsedMs += chunkMs;

    if (this.phase === "calibrating") {
      this.noiseSamples.push(rms);
      if (this.elapsedMs < this.calibrationMs) return {};
      const noiseFloor = this.noiseSamples.reduce((sum, value) => sum + value, 0) / this.noiseSamples.length;
      // 门槛下限防"绝对静音→任何声响都触发"；上限防"校准期混入说话→门槛高到正常语音都够不着"。
      this.speechThreshold = Math.min(
        Math.max(noiseFloor * this.speechMultiplier, this.absoluteMinRms),
        this.maxSpeechThreshold
      );
      this.silenceThreshold = this.speechThreshold * this.silenceRatio;
      this.phase = "waiting";
      return {};
    }

    if (this.phase === "waiting") {
      if (rms >= this.speechThreshold) {
        this.continuousSpeechMs += chunkMs;
        if (this.continuousSpeechMs >= this.minSpeechMs) {
          this.phase = "speaking";
          this.continuousSilenceMs = 0;
          return { speechStarted: true };
        }
      } else {
        this.continuousSpeechMs = 0;
      }
      if (this.elapsedMs >= this.noSpeechTimeoutMs) {
        this.phase = "stopped";
        return { stop: "timeout" };
      }
      return {};
    }

    // speaking
    if (rms < this.silenceThreshold) {
      this.continuousSilenceMs += chunkMs;
      if (this.continuousSilenceMs >= this.silenceHoldMs) {
        this.phase = "stopped";
        return { stop: "auto-stop" };
      }
    } else {
      this.continuousSilenceMs = 0;
    }
    if (this.elapsedMs >= this.maxDurationMs) {
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

/** 申请一次麦克风流（需要用户手势触发以满足浏览器策略）。调用方持有并跨多次录音复用。 */
export async function requestMicStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new RecorderError("当前浏览器不支持录音", "unsupported");
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
  } catch (error) {
    const denied = error instanceof DOMException && error.name === "NotAllowedError";
    throw new RecorderError(
      denied ? "麦克风授权被拒绝，请改用按钮或文字作答" : "无法打开麦克风",
      denied ? "denied" : "failed"
    );
  }
}

export class WavRecorder {
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private inputSampleRate = TARGET_SAMPLE_RATE;

  /**
   * 在调用方已持有的麦克风流上开始录音（流的申请/释放由调用方负责，见 requestMicStream）。
   * 传入 vad 时自动检测"说完了"并回调 onAutoStop，调用方收到回调后自行调用 stop() 完成上传；
   * 不传则保持"手动调用 stop() 才结束"的行为。
   */
  async start(stream: MediaStream, vad?: VadListener, config?: VadConfig): Promise<void> {
    this.context = new AudioContext();
    this.inputSampleRate = this.context.sampleRate;
    this.source = this.context.createMediaStreamSource(stream);
    // ScriptProcessor 已标记废弃但各浏览器仍全面支持；AudioWorklet 需要额外文件加载，
    // 演示场景取稳妥方案。替换路径：迁移到 AudioWorkletNode（见 M4 打磨项）。
    this.processor = this.context.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    const detector = vad ? new VoiceActivityDetector(config) : null;
    const chunkMs = (4096 / this.inputSampleRate) * 1000;
    this.processor.onaudioprocess = (event) => {
      const data = event.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(data));
      if (!detector || !vad) return;
      // RMS 只算一次，既喂 VAD 又旁路给 UI 声波，避免重复计算、也保证两者同源
      const rms = computeRms(data);
      vad.onLevel?.(rms);
      const decision = detector.push(rms, chunkMs);
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

  /** 释放本次录音的音频节点（不动传入的麦克风流，流的生命周期由调用方管理） */
  teardown(): void {
    this.processor?.disconnect();
    this.source?.disconnect();
    void this.context?.close().catch(() => undefined);
    this.processor = null;
    this.source = null;
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
