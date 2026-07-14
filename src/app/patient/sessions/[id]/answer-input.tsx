/**
 * INPUT:  当前题目 DTO、能力开关（asr）、提交回调
 * OUTPUT: AnswerInput —— 患者作答区（四种输入模式：大按钮 / 文字 / 语音确认 / 语音直答）
 * POS:    患者端输入模式的统一实现。语音链路任何一环不可用时按钮/文字始终可用
 *         （AGENTS.md：四种输入模式并存 + 兜底）。
 */
"use client";

import { useEffect, useRef, useState } from "react";
import type { PatientPromptDto } from "@/lib/dialogue/service";
import { RecorderError, WavRecorder } from "./wav-recorder";

export interface VoiceAnswer {
  text: string;
  audioPath?: string;
  asrRaw?: unknown;
}

interface AnswerInputProps {
  prompt: PatientPromptDto;
  sessionId: string;
  asrEnabled: boolean;
  disabled: boolean;
  onSubmitButton: (score: number) => void;
  onSubmitText: (text: string) => void;
  onSubmitVoice: (answer: VoiceAnswer) => void;
  onNotice: (message: string) => void;
}

export function AnswerInput(props: AnswerInputProps) {
  const [textOpen, setTextOpen] = useState(false);
  const [pendingVoice, setPendingVoice] = useState<VoiceAnswer | null>(null);
  /** 语音直答：转写完成后免确认直接提交（默认关闭，先确认更稳） */
  const [directVoice, setDirectVoice] = useState(false);

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
        {props.asrEnabled && !pendingVoice && (
          <VoiceButton
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
        {props.asrEnabled && (
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

/** 录音按钮：点击开始 → 再点结束 → 上传 /api/asr 转写 */
function VoiceButton({
  sessionId,
  disabled,
  onTranscript,
  onNotice,
}: {
  sessionId: string;
  disabled: boolean;
  onTranscript: (answer: VoiceAnswer) => void;
  onNotice: (message: string) => void;
}) {
  const recorderRef = useRef<WavRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  // 组件卸载时释放麦克风
  useEffect(() => () => recorderRef.current?.teardown(), []);

  const startRecording = async () => {
    try {
      const recorder = new WavRecorder();
      await recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch (error) {
      onNotice(error instanceof RecorderError ? error.message : "无法打开麦克风");
    }
  };

  const stopRecording = async () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setRecording(false);
    if (!recorder) return;
    const blob = await recorder.stop();
    if (!blob) {
      onNotice("没有录到声音，请再试一次");
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
  };

  if (transcribing) {
    return (
      <span className="rounded-xl border border-slate-500 px-5 py-3 text-lg text-slate-300 animate-pulse">
        正在识别您的回答…
      </span>
    );
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={recording ? stopRecording : startRecording}
      className={`rounded-xl px-5 py-3 text-lg text-white disabled:opacity-40 transition ${
        recording ? "bg-red-600 hover:bg-red-500 animate-pulse" : "bg-slate-700 hover:bg-slate-600 border border-slate-500"
      }`}
    >
      {recording ? "⏹ 说完了，点这里" : "🎤 语音回答"}
    </button>
  );
}
