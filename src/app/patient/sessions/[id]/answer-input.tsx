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
    <div className="w-full max-w-3xl mx-auto space-y-4">
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

      <div className="flex flex-wrap items-center justify-center gap-3">
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
          className="rounded-xl border border-slate-500 px-5 py-3 text-lg text-slate-200 hover:border-sky-400 disabled:opacity-40"
        >
          ⌨️ 文字输入
        </button>
        {voiceActive && (
          <label className="flex items-center gap-2 text-slate-300 text-base cursor-pointer">
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
    <div className={`grid gap-3 ${twoColumns ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2"}`}>
      {prompt.options.map((option) => (
        <button
          key={option.label}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(option.score)}
          className="rounded-2xl bg-sky-600/90 hover:bg-sky-500 disabled:opacity-40 text-white text-xl md:text-2xl font-semibold px-6 py-5 shadow-lg transition text-left sm:text-center"
        >
          {option.label}
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
    <div className="rounded-2xl border-2 border-sky-400 bg-slate-800/80 p-6 space-y-4 text-center">
      <p className="text-slate-300 text-lg">您说的是：</p>
      <p className="text-white text-2xl font-semibold">“{transcript}”</p>
      <div className="flex justify-center gap-4">
        <button
          type="button"
          disabled={disabled}
          onClick={onConfirm}
          className="rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xl px-8 py-4"
        >
          ✅ 对，就这么答
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onRetry}
          className="rounded-xl border border-slate-400 text-slate-200 text-xl px-8 py-4 hover:border-sky-400"
        >
          🔁 重新说
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
      className="flex gap-3"
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
        className="flex-1 rounded-xl bg-slate-800 border border-slate-600 px-4 py-3 text-xl text-white placeholder:text-slate-500 focus:border-sky-400 outline-none"
      />
      <button
        type="submit"
        disabled={disabled || value.trim().length === 0}
        className="rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xl px-6"
      >
        提交
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
      <span className="rounded-xl border border-slate-500 px-5 py-3 text-lg text-slate-300 animate-pulse">
        正在识别您的回答…
      </span>
    );
  }

  if (recording) {
    return (
      <div className="flex flex-col items-center gap-2">
        <span
          className={`rounded-xl px-5 py-3 text-lg text-white transition ${
            speaking ? "bg-red-600 animate-pulse" : "bg-slate-700 border border-slate-500"
          }`}
        >
          {speaking ? "🎙️ 正在听您说话…" : "🎤 请开始说话…"}
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void stopRecording("manual")}
          className="text-slate-400 text-sm underline decoration-dotted hover:text-slate-200 disabled:opacity-40"
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
      className="rounded-xl px-5 py-3 text-lg text-white bg-slate-700 hover:bg-slate-600 border border-slate-500 disabled:opacity-40 transition"
    >
      🎤 语音回答
    </button>
  );
}
