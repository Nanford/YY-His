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

import { useCallback, useEffect, useRef, useState } from "react";
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
  onNotice: (message: string) => void;
}

export function AnswerInput(props: AnswerInputProps) {
  const [textOpen, setTextOpen] = useState(false);
  const [pendingVoice, setPendingVoice] = useState<VoiceAnswer | null>(null);
  /** 语音直答：转写完成后免确认直接提交。语音模式默认开（尽量免动手），手动模式无意义但保持一致初值 */
  const [directVoice, setDirectVoice] = useState(props.mode === "voice");
  const voiceActive = props.mode === "voice" && props.asrEnabled && props.micStream !== null;

  const handleTranscript = (answer: VoiceAnswer) => {
    if (directVoice) {
      props.onSubmitVoice(answer);
    } else {
      setPendingVoice(answer);
    }
  };

  // 切题时的状态重置由父组件的 key（questionId+attempt）触发整体重挂载完成

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      {pendingVoice ? (
        <TranscriptConfirm
          transcript={pendingVoice.text}
          disabled={props.disabled}
          onConfirm={() => {
            props.onSubmitVoice(pendingVoice);
            setPendingVoice(null);
          }}
          onRetry={() => setPendingVoice(null)}
        />
      ) : (
        <OptionButtons
          prompt={props.prompt}
          disabled={props.disabled}
          onSelect={props.onSubmitButton}
        />
      )}

      {textOpen && !pendingVoice && (
        <TextPanel
          disabled={props.disabled}
          onSubmit={(text) => {
            props.onSubmitText(text);
            setTextOpen(false);
          }}
        />
      )}

      <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
        {voiceActive && props.micStream && !pendingVoice && (
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
          className="ui-button ui-button-secondary ui-button-lg"
        >
          <IconKeyboard size={21} stroke={1.8} aria-hidden="true" />
          <span>文字输入</span>
        </button>
        {voiceActive && (
          <label className="ui-choice min-h-[52px] rounded-[14px] px-4 text-base">
            <input
              type="checkbox"
              checked={directVoice}
              onChange={(event) => setDirectVoice(event.target.checked)}
              className="w-5 h-5"
            />
            语音直答（免确认）
          </label>
        )}
      </div>
    </div>
  );
}

/** 大按钮快捷作答：选项即按钮，适老化大字体 */
function OptionButtons({
  prompt,
  disabled,
  onSelect,
}: {
  prompt: PatientPromptDto;
  disabled: boolean;
  onSelect: (score: number) => void;
}) {
  const twoColumns = prompt.options.length > 2;
  return (
    <div
      className={["grid gap-4", twoColumns ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2"].join(" ")}
    >
      {prompt.options.map((option) => (
        <button
          key={option.label}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(option.score)}
          className="patient-choice min-h-[88px] w-full justify-between text-left sm:justify-center sm:text-center"
        >
          <span>{option.label}</span>
          <IconArrowRight size={26} stroke={1.7} aria-hidden="true" />
        </button>
      ))}
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
      if (!blob) {
        onNotice(reason === "timeout" ? "没有听到您说话，请再试一次" : "没有录到声音，请再试一次");
        return;
      }
      setTranscribing(true);
      try {
        const form = new FormData();
        form.append("sessionId", sessionId);
        form.append("audio", blob, "answer.wav");
        const response = await fetch("/api/asr", { method: "POST", body: form });
        const body = (await response.json()) as {
          text?: string;
          audioPath?: string;
          raw?: unknown;
          error?: string;
        };
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

  if (transcribing) {
    return (
      <div className="ui-alert mx-auto w-fit text-lg">
        <IconLoader2 className="animate-spin" size={22} stroke={1.8} aria-hidden="true" />
        <span>正在识别您的回答…</span>
      </div>
    );
  }

  if (recording) {
    return (
      <div className="flex flex-col items-center gap-3">
        <span
          className={[
            "inline-flex min-h-[52px] items-center justify-center gap-2 rounded-[14px] border px-5 py-3 text-lg font-semibold transition",
            speaking
              ? "border-[#f1c4ca] bg-[var(--danger-soft)] text-[var(--danger)]"
              : "border-[var(--line-strong)] bg-[var(--surface-blue)] text-[var(--brand-strong)]",
          ].join(" ")}
        >
          {speaking ? (
            <IconWaveSine className="animate-pulse" size={23} stroke={1.8} aria-hidden="true" />
          ) : (
            <IconMicrophone size={22} stroke={1.8} aria-hidden="true" />
          )}
          <span>{speaking ? "正在听您说话…" : "请开始说话…"}</span>
        </span>
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
      className="ui-button ui-button-primary ui-button-lg"
    >
      <IconMicrophone size={22} stroke={1.8} aria-hidden="true" />
      <span>语音回答</span>
    </button>
  );
}
