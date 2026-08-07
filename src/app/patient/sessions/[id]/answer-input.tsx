/**
 * INPUT:  当前题目 DTO、能力开关（asr）、语音模式与已持有的麦克风流、提交回调
 * OUTPUT: AnswerInput —— 患者作答区（四种输入模式：大按钮 / 文字 / 语音确认 / 语音直答）
 * POS:    患者端输入模式的统一实现。语音链路任何一环不可用时按钮/文字始终可用
 *         （AGENTS.md：四种输入模式并存 + 兜底）。mode="voice" 时语音为主，播报完
 *         由父组件（interview-screen.tsx）通过 autoStart 驱动自动开始听，免去
 *         每题都要患者手动点一次的问题；mode="manual" 时完全不出现语音入口，
 *         尊重患者在开始画面的选择。
 */
"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  IconArrowRight,
  IconCheck,
  IconKeyboard,
  IconLoader2,
  IconMicrophone,
  IconRefresh,
  IconSend,
  IconVolume,
  IconWaveSine,
} from "@tabler/icons-react";
import type { PatientPromptDto } from "@/lib/dialogue/service";
import { RecorderError, WavRecorder, type VadStopReason } from "./wav-recorder";
import { logTiming } from "./timing";

export interface VoiceAnswer {
  text: string;
  audioPath?: string;
  asrRaw?: unknown;
}

interface AnswerInputProps {
  prompt: PatientPromptDto;
  sessionId: string;
  asrEnabled: boolean;
  /** 患者在开始画面的选择：语音为主 / 只用手动 */
  mode: "voice" | "manual";
  /** mode="voice" 且麦克风授权成功时非空；由父组件持有，跨题复用，本组件不申请也不释放 */
  micStream: MediaStream | null;
  /** 本题播报已结束，语音模式下应自动开始听；每次挂载只消费一次 */
  autoStart: boolean;
  disabled: boolean;
  onSubmitButton: (score: number) => void;
  onSubmitText: (text: string) => void;
  onSubmitVoice: (answer: VoiceAnswer) => void;
  /** M9.6 多选 */
  onSubmitMulti: (labels: string[]) => void;
  /** M9.6 画钟交卷 */
  onSubmitDrawing: (dataUrl: string) => void;
  onNotice: (message: string) => void;
}

export function AnswerInput(props: AnswerInputProps) {
  const [textOpen, setTextOpen] = useState(false);
  const [pendingVoice, setPendingVoice] = useState<VoiceAnswer | null>(null);
  /** 语音直答：转写完成后免确认直接提交。语音模式默认开（尽量免动手），手动模式无意义但保持一致初值 */
  const [directVoice, setDirectVoice] = useState(props.mode === "voice");
  const voiceActive = props.mode === "voice" && props.asrEnabled && props.micStream !== null;
  const answerType = props.prompt.answerType;
  // 数字/多选/图片/画钟题以专用控件为主，语音/文字仍作兜底（画钟除外）
  const specialType =
    answerType === "number" ||
    answerType === "multiChoice" ||
    answerType === "imageChoice" ||
    answerType === "drawing";
  const showVoiceTextFallback = !specialType || answerType === "number" || answerType === "multiChoice";

  const handleTranscript = (answer: VoiceAnswer) => {
    if (directVoice) {
      props.onSubmitVoice(answer);
    } else {
      setPendingVoice(answer);
    }
  };

  // 切题时的状态重置由父组件的 key（questionId+attempt）触发整体重挂载完成

  /** 语音模式：监听区置顶作主视觉；选项/专用控件作兜底，避免大按钮把声波挤成角落小控件 */
  const voicePrimary = voiceActive && !pendingVoice && showVoiceTextFallback;

  const specialOrOptions = pendingVoice ? (
    <TranscriptConfirm
      transcript={pendingVoice.text}
      disabled={props.disabled}
      onConfirm={() => {
        props.onSubmitVoice(pendingVoice);
        setPendingVoice(null);
      }}
      onRetry={() => setPendingVoice(null)}
    />
  ) : answerType === "number" ? (
    <NumberInputPanel
      prompt={props.prompt}
      disabled={props.disabled}
      onSelect={props.onSubmitButton}
    />
  ) : answerType === "multiChoice" ? (
    <MultiChoicePanel
      prompt={props.prompt}
      disabled={props.disabled}
      onSubmit={props.onSubmitMulti}
    />
  ) : answerType === "imageChoice" ? (
    <ImageChoicePanel
      prompt={props.prompt}
      disabled={props.disabled}
      onSelect={props.onSubmitButton}
    />
  ) : answerType === "drawing" ? (
    <DrawingPanel disabled={props.disabled} onSubmit={props.onSubmitDrawing} />
  ) : (
    <OptionButtons
      prompt={props.prompt}
      disabled={props.disabled}
      onSelect={props.onSubmitButton}
      compact={voicePrimary}
    />
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      {voicePrimary && props.micStream && (
        <VoiceButton
          micStream={props.micStream}
          autoStart={props.autoStart}
          sessionId={props.sessionId}
          disabled={props.disabled}
          onTranscript={handleTranscript}
          onNotice={props.onNotice}
        />
      )}

      {!pendingVoice && voicePrimary && (
        <p className="voice-fallback-label">不方便说话时，也可点选下方选项</p>
      )}

      {specialOrOptions}

      {textOpen && !pendingVoice && showVoiceTextFallback && (
        <TextPanel
          disabled={props.disabled}
          onSubmit={(text) => {
            props.onSubmitText(text);
            setTextOpen(false);
          }}
        />
      )}

      {showVoiceTextFallback && (
        <div className="flex flex-wrap items-center justify-center gap-2.5 pt-0.5">
          {!voicePrimary && voiceActive && props.micStream && !pendingVoice && (
            <VoiceButton
              micStream={props.micStream}
              autoStart={props.autoStart}
              sessionId={props.sessionId}
              disabled={props.disabled}
              onTranscript={handleTranscript}
              onNotice={props.onNotice}
            />
          )}
          <button
            type="button"
            onClick={() => setTextOpen((open) => !open)}
            disabled={props.disabled}
            className="ui-button ui-button-secondary min-h-[48px] px-4 text-base"
          >
            <IconKeyboard size={20} stroke={1.8} aria-hidden="true" />
            <span>文字输入</span>
          </button>
          {voiceActive && (
            <label className="ui-choice min-h-[48px] rounded-[14px] px-3.5 text-sm sm:text-base">
              <input
                type="checkbox"
                checked={directVoice}
                onChange={(event) => setDirectVoice(event.target.checked)}
                className="h-4 w-4"
              />
              说完直接提交
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/** 大按钮快捷作答：选项即按钮；语音为主时 compact 略收高度，避免压过监听区 */
function OptionButtons({
  prompt,
  disabled,
  onSelect,
  compact = false,
}: {
  prompt: PatientPromptDto;
  disabled: boolean;
  onSelect: (score: number) => void;
  /** 语音主视觉模式下作兜底，按钮略矮、字号略收 */
  compact?: boolean;
}) {
  const twoColumns = prompt.options.length > 2;
  return (
    <div
      className={[
        "grid",
        compact ? "gap-2.5" : "gap-3.5",
        twoColumns ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2",
      ].join(" ")}
    >
      {prompt.options.map((option) => (
        <button
          key={option.label}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(option.score)}
          className={[
            "patient-choice w-full justify-between text-left sm:justify-center sm:text-center",
            compact
              ? "min-h-[64px] px-4 py-3 text-[clamp(18px,1.8vw,24px)]"
              : "min-h-[80px]",
          ].join(" ")}
        >
          <span>{option.label}</span>
          <IconArrowRight size={compact ? 22 : 26} stroke={1.7} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

/** M9.6 数字输入：大号数字步进 + 滑条（适老化） */
function NumberInputPanel({
  prompt,
  disabled,
  onSelect,
}: {
  prompt: PatientPromptDto;
  disabled: boolean;
  onSelect: (score: number) => void;
}) {
  const min = prompt.numberMin ?? 0;
  const max = prompt.numberMax ?? 10;
  const [value, setValue] = useState(min);
  return (
    <div className="patient-panel space-y-5 p-6 text-center">
      <p className="text-lg font-semibold text-[var(--ink-muted)]">请选择一个数字（{min}～{max}）</p>
      <p className="text-6xl font-black tabular-nums text-[var(--brand-strong)]">{value}</p>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(Number(e.target.value))}
        className="mx-auto block w-full max-w-md accent-[var(--brand)]"
        aria-label={`选择 ${min} 到 ${max} 的数字`}
      />
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          disabled={disabled || value <= min}
          className="ui-button ui-button-secondary ui-button-lg"
          onClick={() => setValue((v) => Math.max(min, v - 1))}
        >
          −1
        </button>
        <button
          type="button"
          disabled={disabled || value >= max}
          className="ui-button ui-button-secondary ui-button-lg"
          onClick={() => setValue((v) => Math.min(max, v + 1))}
        >
          +1
        </button>
        <button
          type="button"
          disabled={disabled}
          className="ui-button ui-button-primary ui-button-lg"
          onClick={() => onSelect(value)}
        >
          <IconCheck size={22} stroke={2} aria-hidden="true" />
          <span>确认 {value} 分</span>
        </button>
      </div>
    </div>
  );
}

/** M9.6 多选大按钮 */
function MultiChoicePanel({
  prompt,
  disabled,
  onSubmit,
}: {
  prompt: PatientPromptDto;
  disabled: boolean;
  onSubmit: (labels: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (label: string) => {
    setSelected((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );
  };
  return (
    <div className="space-y-4">
      <p className="text-center text-base font-semibold text-[var(--ink-muted)]">可多选，选完后点确认</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {prompt.options.map((option) => {
          const on = selected.includes(option.label);
          return (
            <button
              key={option.label}
              type="button"
              disabled={disabled}
              onClick={() => toggle(option.label)}
              className={[
                "patient-choice min-h-[72px] w-full text-left",
                on ? "ring-2 ring-[var(--brand)] bg-[var(--surface-blue)]" : "",
              ].join(" ")}
              aria-pressed={on}
            >
              <span className="mr-2 inline-block w-6 text-center font-black text-[var(--brand)]">
                {on ? "✓" : "○"}
              </span>
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
      <div className="flex justify-center">
        <button
          type="button"
          disabled={disabled || selected.length === 0}
          className="ui-button ui-button-primary ui-button-lg"
          onClick={() => onSubmit(selected)}
        >
          <IconCheck size={22} stroke={2} aria-hidden="true" />
          <span>确认所选（{selected.length}）</span>
        </button>
      </div>
    </div>
  );
}

/** M9.6 图片选择（Bristol 等）：上方参照图 + 下方大按钮 */
function ImageChoicePanel({
  prompt,
  disabled,
  onSelect,
}: {
  prompt: PatientPromptDto;
  disabled: boolean;
  onSelect: (score: number) => void;
}) {
  return (
    <div className="space-y-4">
      {prompt.imageSrc && (
        <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={prompt.imageSrc}
            alt="大便分型参照图"
            className="mx-auto max-h-[280px] w-auto object-contain"
          />
          <p className="mt-2 text-center text-sm text-[var(--ink-faint)]">请对照上图选择最像的一型</p>
        </div>
      )}
      <OptionButtons prompt={prompt} disabled={disabled} onSelect={onSelect} />
    </div>
  );
}

/** M9.6 画钟画布：患者绘制后交卷，医生端确认计分 */
function DrawingPanel({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#1e3a5f";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
  }, []);

  const pos = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  return (
    <div className="space-y-4">
      <p className="text-center text-base font-semibold text-[var(--ink-muted)]">
        请在白板上画一个钟，指针指向规定时间；画完后提交，医生会帮您确认对不对
      </p>
      <canvas
        ref={canvasRef}
        width={480}
        height={480}
        className="mx-auto block max-w-full touch-none rounded-2xl border-2 border-[var(--brand)] bg-white shadow-sm"
        onPointerDown={(e) => {
          drawing.current = true;
          const ctx = canvasRef.current?.getContext("2d");
          if (!ctx) return;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = canvasRef.current?.getContext("2d");
          if (!ctx) return;
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
        }}
      />
      <div className="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          disabled={disabled}
          className="ui-button ui-button-secondary ui-button-lg"
          onClick={() => {
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext("2d");
            if (!canvas || !ctx) return;
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }}
        >
          <IconRefresh size={21} stroke={1.9} aria-hidden="true" />
          <span>清空重画</span>
        </button>
        <button
          type="button"
          disabled={disabled}
          className="ui-button ui-button-primary ui-button-lg"
          onClick={() => {
            const dataUrl = canvasRef.current?.toDataURL("image/png");
            if (dataUrl) onSubmit(dataUrl);
          }}
        >
          <IconSend size={21} stroke={1.9} aria-hidden="true" />
          <span>提交画作</span>
        </button>
      </div>
    </div>
  );
}

/** 语音转写确认面板（语音转文字确认模式） */
function TranscriptConfirm({
  transcript,
  disabled,
  onConfirm,
  onRetry,
}: {
  transcript: string;
  disabled: boolean;
  onConfirm: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="patient-panel border-[var(--brand)] bg-[var(--surface-blue)] p-6 text-center">
      <div className="mb-3 flex items-center justify-center gap-2 text-lg font-semibold text-[var(--brand-strong)]">
        <IconVolume size={22} stroke={1.8} aria-hidden="true" />
        <p>您说的是：</p>
      </div>
      <p className="text-2xl font-bold leading-relaxed text-[var(--ink)]">“{transcript}”</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={onConfirm}
          className="ui-button ui-button-primary ui-button-lg"
        >
          <IconCheck size={22} stroke={2} aria-hidden="true" />
          <span>对，就这么答</span>
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onRetry}
          className="ui-button ui-button-secondary ui-button-lg"
        >
          <IconRefresh size={21} stroke={1.9} aria-hidden="true" />
          <span>重新说</span>
        </button>
      </div>
    </div>
  );
}

/** 文字输入面板 */
function TextPanel({ disabled, onSubmit }: { disabled: boolean; onSubmit: (text: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        if (trimmed) {
          onSubmit(trimmed);
          setValue("");
        }
      }}
    >
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="请输入您的回答…"
        maxLength={200}
        className="patient-input flex-1"
      />
      <button
        type="submit"
        disabled={disabled || value.trim().length === 0}
        className="ui-button ui-button-primary ui-button-lg shrink-0"
      >
        <IconSend size={21} stroke={1.9} aria-hidden="true" />
        <span>提交</span>
      </button>
    </form>
  );
}

/** 声波条数：奇数带中心；监听主视觉下略增条数更饱满 */
const WAVE_BAR_COUNT = 25;
/** 声条高度范围（px），与 .voice-listen-hero .voice-wave 的 72px 容器匹配 */
const WAVE_MIN_PX = 8;
const WAVE_MAX_PX = 60;

/** 静息基线：中间略高的对称小丘，配合 CSS 呼吸动画即成"待命声波" */
function idleWaveLevels(): number[] {
  return Array.from({ length: WAVE_BAR_COUNT }, (_, index) => {
    const t = index / (WAVE_BAR_COUNT - 1); // 0..1
    return 0.14 + 0.05 * Math.sin(t * Math.PI); // 0.14~0.19
  });
}

/**
 * 真实 RMS → 0..1 归一化。语音 RMS 常见 0.02~0.15；减去底噪门限再线性拉伸，
 * 末尾轻微压缩曲线让小音量也可见、大音量不顶格。常量为经验值，与 wav-recorder
 * 的 VAD 阈值同属"现场可微调"性质。
 */
function normalizeLevel(rms: number): number {
  const NOISE_FLOOR = 0.006;
  const SPAN = 0.11;
  const linear = (rms - NOISE_FLOOR) / SPAN;
  const clamped = Math.min(1, Math.max(0, linear));
  return Math.pow(clamped, 0.85);
}

/**
 * 语音波浪：真实麦克风音量（经 wav-recorder 的 onLevel 引出的 RMS）驱动的一排声条。
 * speaking=false（等待说话）：整体缓呼吸 + 逐条静息起伏（CSS）；
 * speaking=true（检测到说话）：高度纯随真实音量跳动、转暖色（CSS 按 data-active 切换）。
 * 纯装饰性可视化，对读屏无意义，aria-hidden。
 */
function VoiceWave({ levels, speaking }: { levels: number[]; speaking: boolean }) {
  return (
    <div className="voice-wave" data-active={speaking} aria-hidden="true">
      {levels.map((level, index) => (
        <span
          key={index}
          className="voice-wave-bar"
          style={{
            height: `${WAVE_MIN_PX + level * (WAVE_MAX_PX - WAVE_MIN_PX)}px`,
            // 静息时逐条相位差形成波动；说话时该动画被 CSS 撤除，仅剩真实高度
            animationDelay: `${(index % 7) * 0.16}s`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * 录音按钮：语音模式下播报一结束就自动开始（autoStart 由父组件在 TTS 播完后置 true），
 * 声音活动检测（VAD）判断患者说完了自动上传 /api/asr 转写，全程不用患者动手。
 * VAD 是能量阈值近似方案，老年患者停顿可能导致误判，因此录音中始终保留弱化样式的
 * 手动兜底按钮（见 wav-recorder.ts 头注释）。麦克风流由父组件持有传入，本组件只在
 * 这条已授权的流上开关录音，不重新申请权限（不会再弹授权弹窗）。
 */
function VoiceButton({
  micStream,
  autoStart,
  sessionId,
  disabled,
  onTranscript,
  onNotice,
}: {
  micStream: MediaStream;
  autoStart: boolean;
  sessionId: string;
  disabled: boolean;
  onTranscript: (answer: VoiceAnswer) => void;
  onNotice: (message: string) => void;
}) {
  const recorderRef = useRef<WavRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  /** 语音波浪的实时高度缓冲：新音量从右侧入队、逐帧左移，形成滚动声波 */
  const [waveLevels, setWaveLevels] = useState<number[]>(idleWaveLevels);
  /** autoStart 每次挂载只应触发一次自动开始，防止后续重渲染重复触发 */
  const autoStartedRef = useRef(false);

  // 组件卸载时释放本次录音的音频节点（不动 micStream，那是父组件的资源）
  useEffect(() => () => recorderRef.current?.teardown(), []);

  const stopRecording = useCallback(
    async (reason: "manual" | VadStopReason = "manual") => {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      setRecording(false);
      setSpeaking(false);
      if (!recorder) return;
      const blob = await recorder.stop();
      // 链路埋点（V2.0 §2.1）：录音结束（VAD 判定说完 / 手动提交 / 超时）
      logTiming("recording_end", { reason });
      if (!blob) {
        onNotice(reason === "timeout" ? "没有听到您说话，请再试一次" : "没有录到声音，请再试一次");
        return;
      }
      setTranscribing(true);
      try {
        const form = new FormData();
        form.append("sessionId", sessionId);
        form.append("audio", blob, "answer.wav");
        logTiming("asr_request");
        const response = await fetch("/api/asr", { method: "POST", body: form });
        const body = (await response.json()) as {
          text?: string;
          audioPath?: string;
          raw?: unknown;
          error?: string;
        };
        logTiming("asr_response", { status: response.status });
        if (!response.ok || !body.text) {
          onNotice(body.error ?? "没听清，请再说一次，或改用按钮作答");
          return;
        }
        onTranscript({ text: body.text, audioPath: body.audioPath, asrRaw: body.raw });
      } catch {
        onNotice("网络异常，转写失败，请改用按钮或文字作答");
      } finally {
        setTranscribing(false);
      }
    },
    [sessionId, onTranscript, onNotice]
  );

  const startRecording = useCallback(async () => {
    try {
      setWaveLevels(idleWaveLevels()); // 每次开录先回到静息波形
      const recorder = new WavRecorder();
      await recorder.start(micStream, {
        onSpeechStart: () => setSpeaking(true),
        // 真实音量入队：整条缓冲左移一格、右端补入归一化后的新音量，驱动滚动声波
        onLevel: (rms) =>
          setWaveLevels((prev) => {
            const next = prev.slice(1);
            next.push(normalizeLevel(rms));
            return next;
          }),
        onAutoStop: (reason) => {
          void stopRecording(reason);
        },
      });
      recorderRef.current = recorder;
      setRecording(true);
      setSpeaking(false);
    } catch (error) {
      onNotice(error instanceof RecorderError ? error.message : "无法打开麦克风");
    }
  }, [micStream, stopRecording, onNotice]);

  // 播报刚结束（autoStart 由 false 变 true）就自动开始听，不需要患者点按钮
  useEffect(() => {
    if (autoStart && !autoStartedRef.current && !recording && !transcribing) {
      autoStartedRef.current = true;
      void startRecording();
    }
  }, [autoStart, recording, transcribing, startRecording]);

  if (transcribing) {
    return (
      <div className="voice-listen-hero" role="status">
        <IconLoader2 className="animate-spin text-[var(--brand)]" size={28} stroke={1.8} aria-hidden="true" />
        <span className="text-xl font-bold text-[var(--brand-strong)]">正在识别您的回答…</span>
      </div>
    );
  }

  if (recording) {
    return (
      <div className="flex w-full flex-col items-center gap-2.5">
        <div className="voice-listen-hero" data-speaking={speaking}>
          <VoiceWave levels={waveLevels} speaking={speaking} />
          <span
            className={[
              "inline-flex items-center gap-2 text-xl font-bold sm:text-2xl",
              speaking ? "text-[var(--danger)]" : "text-[var(--brand-strong)]",
            ].join(" ")}
          >
            {speaking ? (
              <IconWaveSine size={26} stroke={1.8} aria-hidden="true" />
            ) : (
              <IconMicrophone size={24} stroke={1.8} aria-hidden="true" />
            )}
            <span>{speaking ? "正在听您说话…" : "请开始说话…"}</span>
          </span>
          <p className="text-sm leading-6 text-[var(--ink-muted)]">
            说完稍停片刻会自动提交；停顿较长可点下方按钮
          </p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void stopRecording("manual")}
          className="ui-button ui-button-quiet min-h-0 px-3 py-1 text-sm underline decoration-dotted underline-offset-4"
        >
          我说完了，直接提交
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={startRecording}
      className="patient-primary-action w-full max-w-xl justify-center self-center text-xl"
    >
      <IconMicrophone size={26} stroke={1.8} aria-hidden="true" />
      <span>开始语音回答</span>
    </button>
  );
}
