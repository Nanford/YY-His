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
import { ArrowRight, Check, Keyboard, LoaderCircle, Mic, RefreshCw, Send, Volume2 } from "lucide-react";
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
  /** 大按钮/图片选择：提交选中选项的完整 label（同分选项靠 label 区分，服务端按 label 精确匹配） */
  onSubmitOption: (label: string) => void;
  /** number 题数字面板：分值唯一，提交分值 */
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
  /** 自由回答题（2026-08-13 认知题改版）：不展示选项按钮（标准答案不泄露），语音/文字自由作答 */
  const freeAnswer = props.prompt.responseMode === "free";
  // 数字/多选/图片/画钟题以专用控件为主；仅 number 题保留语音/文字兜底（分值唯一不会歧义）。
  // 多选题不出语音/文字入口：归一化只返回单个选项会丢多选语义（图片/画钟题本就走专用控件）
  const specialType =
    answerType === "number" ||
    answerType === "multiChoice" ||
    answerType === "imageChoice" ||
    answerType === "drawing";
  const showVoiceTextFallback = !specialType || answerType === "number";

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
      onSelect={props.onSubmitOption}
    />
  ) : answerType === "drawing" ? (
    <DrawingPanel disabled={props.disabled} onSubmit={props.onSubmitDrawing} />
  ) : freeAnswer ? (
    // 自由回答题：选项区只放作答提示，标准答案不出现在患者屏幕上
    <p className="rounded-2xl border border-blue-100 bg-blue-50/60 px-6 py-4 text-center text-lg font-semibold text-[var(--ink-muted)]">
      {voiceActive ? "请直接说出您的答案，说完稍停片刻会自动提交。" : "请在下方输入您的答案后提交。"}
    </p>
  ) : (
    <OptionButtons
      prompt={props.prompt}
      disabled={props.disabled}
      onSelect={props.onSubmitOption}
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
        <p className="voice-fallback-label">
          {freeAnswer ? "不方便说话时，也可用下方文字输入回答" : "不方便说话时，也可点选下方选项"}
        </p>
      )}

      {specialOrOptions}

      {/* 自由回答题在纯手动模式下直接展开文字输入（无语音入口时这是唯一作答途径） */}
      {!pendingVoice && showVoiceTextFallback && (textOpen || (freeAnswer && !voiceActive)) && (
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
            // 纯手动模式的自由回答题文字面板恒展开，切换按钮无意义
            style={freeAnswer && !voiceActive ? { display: "none" } : undefined}
          >
            <Keyboard size={20} strokeWidth={1.8} aria-hidden="true" />
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

/** 大按钮快捷作答：按钮展示 displayLabel（剥除评分/备注，2026-09-04 修改意见 1），
 *  提交仍用完整 label（同分选项靠 label 区分，服务端按 label 精确匹配）；语音为主时 compact 略收高度 */
function OptionButtons({
  prompt,
  disabled,
  onSelect,
  compact = false,
}: {
  prompt: PatientPromptDto;
  disabled: boolean;
  onSelect: (label: string) => void;
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
          onClick={() => onSelect(option.label)}
          className={[
            "patient-choice w-full justify-between text-left sm:justify-center sm:text-center",
            compact
              ? "min-h-[64px] px-4 py-3 text-[clamp(18px,1.8vw,24px)]"
              : "min-h-[80px]",
          ].join(" ")}
        >
          <span>{option.displayLabel}</span>
          <ArrowRight size={compact ? 22 : 26} strokeWidth={1.7} aria-hidden="true" />
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
          <Check size={22} strokeWidth={2} aria-hidden="true" />
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
              {/* 展示剥除评分/备注（2026-09-04 修改意见 1）；选中与提交仍用完整 label */}
              <span>{option.displayLabel}</span>
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
          <Check size={22} strokeWidth={2} aria-hidden="true" />
          <span>确认所选（{selected.length}）</span>
        </button>
      </div>
    </div>
  );
}

/** M9.6 图片选择（Bristol 等）：上方参照图 + 下方大按钮（按 label 提交） */
function ImageChoicePanel({
  prompt,
  disabled,
  onSelect,
}: {
  prompt: PatientPromptDto;
  disabled: boolean;
  onSelect: (label: string) => void;
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
    <div className="drawing-panel space-y-3">
      <p className="text-center text-base font-semibold text-[var(--ink-muted)]">
        请在白板上画一个钟，标上数字和指针；画完后点提交
      </p>
      {/* 画布内部分辨率 480×480 不变；展示尺寸由 .drawing-canvas flex 自适应剩余空间，
          保证整个画钟区域（画布+按钮）一屏放得下、不需要拖滚动条（2026-09-04 修改意见 4/7） */}
      <canvas
        ref={canvasRef}
        width={480}
        height={480}
        className="drawing-canvas touch-none rounded-2xl border-2 border-[var(--brand)] bg-white shadow-sm"
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
          <RefreshCw size={21} strokeWidth={1.9} aria-hidden="true" />
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
          <Send size={21} strokeWidth={1.9} aria-hidden="true" />
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
        <Volume2 size={22} strokeWidth={1.8} aria-hidden="true" />
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
          <Check size={22} strokeWidth={2} aria-hidden="true" />
          <span>对，就这么答</span>
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onRetry}
          className="ui-button ui-button-secondary ui-button-lg"
        >
          <RefreshCw size={21} strokeWidth={1.9} aria-hidden="true" />
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
        <Send size={21} strokeWidth={1.9} aria-hidden="true" />
        <span>提交</span>
      </button>
    </form>
  );
}

/** 声波可视化已随 2026-08-13 语音按钮恒定尺寸重构移除（三态只换图标颜色与文字） */
/**
 * 录音按钮：语音模式下播报一结束就自动开始（autoStart 由父组件在 TTS 播完后置 true），
 * 声音活动检测（VAD）判断患者说完了自动上传 /api/asr 转写，全程不用患者动手。
 * VAD 是能量阈值近似方案，老年患者停顿可能导致误判，因此录音中始终保留弱化样式的
 * 手动兜底按钮（见 wav-recorder.ts 头注释）。麦克风流由父组件持有传入，本组件只在
 * 这条已授权的流上开关录音，不重新申请权限（不会再弹授权弹窗）。
 *
 * 2026-08-13 用户要求：播报结束后按钮不再整体替换成大号监听面板（界面跳动），
 * 三态共用同一按钮外壳（尺寸恒定），只切换麦克风图标颜色与文字；
 * 兜底"我说完了"按钮放固定高度槽位，仅录音时可见（visibility 切换，不占位变化）。
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
          // 服务端报错原文直接提示（2026-09-14 用户拍板：ASR 未开通等技术提示保留给患者端可见）
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
      const recorder = new WavRecorder();
      await recorder.start(micStream, {
        onSpeechStart: () => setSpeaking(true),
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

  // 录音/识别中不用 disabled（:disabled 会压暗到 0.5 看不清图标变色），改为点击守卫 + aria-disabled
  const busy = recording || transcribing;
  return (
    <div className="flex w-full flex-col items-center">
      <button
        type="button"
        disabled={!busy && disabled}
        aria-disabled={busy || disabled}
        onClick={() => {
          if (!busy) void startRecording();
        }}
        className="patient-primary-action w-full max-w-xl justify-center self-center text-xl"
        data-voice-state={transcribing ? "transcribing" : recording ? (speaking ? "speaking" : "listening") : "idle"}
      >
        {transcribing ? (
          <>
            <LoaderCircle className="animate-spin" size={26} strokeWidth={1.8} aria-hidden="true" />
            <span>正在识别您的回答…</span>
          </>
        ) : recording ? (
          <>
            <Mic
              size={26}
              strokeWidth={1.8}
              aria-hidden="true"
              className={speaking ? "voice-mic-speaking" : "voice-mic-listening"}
            />
            <span>{speaking ? "正在听您说话…" : "请开始说话…"}</span>
          </>
        ) : (
          <>
            <Mic size={26} strokeWidth={1.8} aria-hidden="true" />
            <span>开始语音回答</span>
          </>
        )}
      </button>
      {/* 固定高度槽位：录音时才显示手动提交兜底，visibility 切换不引起布局跳动 */}
      <div className="voice-submit-slot">
        <button
          type="button"
          disabled={disabled}
          onClick={() => void stopRecording("manual")}
          className="ui-button ui-button-quiet min-h-0 px-3 py-1 text-sm underline decoration-dotted underline-offset-4"
          style={{ visibility: recording ? "visible" : "hidden" }}
          tabIndex={recording ? 0 : -1}
        >
          我说完了，直接提交
        </button>
      </div>
    </div>
  );
}
