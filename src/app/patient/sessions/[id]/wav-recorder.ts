/**
 * INPUT:  浏览器麦克风（getUserMedia + Web Audio API）
 * OUTPUT: WavRecorder —— 录音并编码为 16kHz 单声道 16bit WAV Blob
 * POS:    患者端语音作答的采音层。统一输出 WAV：MediaRecorder 的 webm/opus
 *         容器在火山 ASR 侧兼容性不稳，PCM WAV 是最稳的通用格式。
 */

const TARGET_SAMPLE_RATE = 16_000;

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

  /** 开始录音（需要用户手势触发以满足浏览器策略） */
  async start(): Promise<void> {
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
    this.processor.onaudioprocess = (event) => {
      this.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
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
