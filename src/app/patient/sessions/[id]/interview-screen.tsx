/**
 * INPUT:  会话 id、患者展示信息（本地渲染，不出网）、患者端状态 API（state/start/answer）、TTS API
 * OUTPUT: InterviewScreen —— 患者端大屏主组件（数字医生 + 字幕 + 进度 + 作答区）
 * POS:    患者端问询的前端编排：驱动 开始 → 逐题播报/作答 → 结束 的完整流程。
 *         TTS/ASR 任何一环失败自动降级（纯字幕 + 按钮/文字作答），流程不中断。
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PatientDialogueStateDto, SubmitAnswerResult } from "@/lib/dialogue/service";
import { DoctorAvatar } from "./avatar";
import { AnswerInput, type VoiceAnswer } from "./answer-input";

type LoadPhase = "loading" | "ready" | "error";

interface InterviewScreenProps {
  sessionId: string;
  /** 患者称呼（本地页面展示用，绝不进入任何出网文本） */
  patientLabel: string;
}

export function InterviewScreen({ sessionId, patientLabel }: InterviewScreenProps) {
  const router = useRouter();
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("loading");
  const [state, setState] = useState<PatientDialogueStateDto | null>(null);
  const [subtitle, setSubtitle] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** TTS 一旦失败即静默降级为纯字幕，不再重试拖慢流程 */
  const ttsBrokenRef = useRef(false);

  // ---------- 播报：逐条设置字幕，可用时同步播放 TTS 音频 ----------

  const playSpeaks = useCallback(
    async (texts: string[], ttsEnabled: boolean) => {
      for (const text of texts) {
        setSubtitle(text);
        if (!ttsEnabled || ttsBrokenRef.current) continue;
        try {
          await playAudio(audioRef, `/api/tts?text=${encodeURIComponent(text)}`, setSpeaking);
        } catch {
          ttsBrokenRef.current = true; // 降级为纯字幕，流程继续
          setSpeaking(false);
        }
      }
    },
    []
  );

  const applyState = useCallback(
    (next: PatientDialogueStateDto, options: { autoplay: boolean }) => {
      setState(next);
      const fallbackSubtitle = next.prompt?.text ?? "";
      if (next.speak.length === 0) {
        setSubtitle(fallbackSubtitle);
        return;
      }
      if (options.autoplay) {
        void playSpeaks(next.speak, next.capabilities.tts);
      } else {
        // 无用户手势时不自动播放（浏览器策略），只展示字幕
        setSubtitle(next.speak[next.speak.length - 1] ?? fallbackSubtitle);
      }
    },
    [playSpeaks]
  );

  // ---------- 初始加载 ----------

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/patient/sessions/${sessionId}/state`);
        if (!response.ok) throw new Error(String(response.status));
        const dto = (await response.json()) as PatientDialogueStateDto;
        if (cancelled) return;
        applyState(dto, { autoplay: false });
        setLoadPhase("ready");
      } catch {
        if (!cancelled) setLoadPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, applyState]);

  // 提示信息 4 秒后自动消失
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  // ---------- 动作 ----------

  const handleStart = async () => {
    setSubmitting(true);
    try {
      const response = await fetch(`/api/patient/sessions/${sessionId}/start`, { method: "POST" });
      const dto = (await response.json()) as PatientDialogueStateDto & { error?: string };
      if (!response.ok) {
        setNotice(dto.error ?? "无法开始问询");
        return;
      }
      applyState(dto, { autoplay: true });
    } catch {
      setNotice("网络异常，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  const submitAnswer = async (payload: Record<string, unknown>) => {
    if (!state?.prompt) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/patient/sessions/${sessionId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: state.prompt.questionId, ...payload }),
      });
      const body = (await response.json()) as (SubmitAnswerResult & { error?: string }) | { error: string };
      if (!response.ok || !("state" in body)) {
        setNotice(("error" in body && body.error) || "提交失败，请重试");
        if (response.status === 409) await refreshState();
        return;
      }
      setNotice(resolutionNotice(body.resolution));
      applyState(body.state, { autoplay: true });
    } catch {
      setNotice("网络异常，提交失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  const refreshState = async () => {
    try {
      const response = await fetch(`/api/patient/sessions/${sessionId}/state`);
      if (response.ok) {
        applyState((await response.json()) as PatientDialogueStateDto, { autoplay: false });
      }
    } catch {
      // 刷新失败保持现状，用户可手动刷新页面
    }
  };

  const replay = () => {
    if (state?.prompt) void playSpeaks([state.prompt.text], state.capabilities.tts);
  };

  // ---------- 渲染 ----------

  if (loadPhase === "loading") {
    return <CenterMessage text="正在准备评估，请稍候…" />;
  }
  if (loadPhase === "error" || !state) {
    return <CenterMessage text="加载失败，请刷新页面或联系医生。" />;
  }
  if (state.phase === "locked") {
    return <CenterMessage text="本次评估不在采集中（可能已完成），请联系医生。" />;
  }

  return (
    <div className="flex-1 flex flex-col items-center px-4 py-6 gap-6">
      {/* 顶部：患者与量表信息 + 进度 */}
      <header className="w-full max-w-4xl flex items-center justify-between text-slate-300">
        <div className="text-lg md:text-xl">
          {patientLabel}
          <span className="ml-3 text-slate-500 text-base">{state.scaleNames.join("、")}</span>
        </div>
        {state.phase !== "not_started" && (
          <div className="text-lg md:text-xl">
            已完成 <span className="text-sky-300 font-bold">{state.progress.answered}</span> / {state.progress.total} 题
          </div>
        )}
      </header>

      <DoctorAvatar speaking={speaking} mode={state.capabilities.avatarMode} />

      {/* 字幕区 */}
      <section className="w-full max-w-4xl min-h-28 rounded-2xl bg-slate-800/70 border border-slate-700 px-6 py-5 text-center">
        {state.phase === "not_started" ? (
          <p className="text-slate-200 text-xl md:text-2xl leading-relaxed">
            您好！点击下方按钮，数字医生将开始为您做健康问询。
          </p>
        ) : (
          <p className="text-white text-xl md:text-3xl leading-relaxed">{subtitle}</p>
        )}
        {state.phase === "in_question" && (
          <button
            type="button"
            onClick={replay}
            className="mt-3 text-sky-300 text-base underline underline-offset-4 hover:text-sky-200"
          >
            🔊 再听一遍
          </button>
        )}
      </section>

      {/* 提示条 */}
      {notice && (
        <div className="rounded-xl bg-amber-500/20 border border-amber-400/60 text-amber-100 px-5 py-3 text-lg">
          {notice}
        </div>
      )}

      {/* 作答区 / 开始按钮 / 结束画面 */}
      {state.phase === "not_started" && (
        <button
          type="button"
          disabled={submitting}
          onClick={handleStart}
          className="rounded-3xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-3xl font-bold px-16 py-8 shadow-xl transition"
        >
          ▶ 开始评估
        </button>
      )}

      {state.phase === "in_question" && state.prompt && (
        <AnswerInput
          // 切题/换提问方式时重挂载作答区，清空未确认的转写与文字面板
          key={`${state.prompt.questionId}-${state.prompt.attempt}`}
          prompt={state.prompt}
          sessionId={sessionId}
          asrEnabled={state.capabilities.asr}
          disabled={submitting}
          onSubmitButton={(score) => void submitAnswer({ mode: "button", score })}
          onSubmitText={(text) => void submitAnswer({ mode: "text", utterance: text })}
          onSubmitVoice={(answer: VoiceAnswer) =>
            void submitAnswer({
              mode: "voice",
              utterance: answer.text,
              audioPath: answer.audioPath,
              asrRaw: answer.asrRaw,
            })
          }
          onNotice={setNotice}
        />
      )}

      {state.phase === "awaiting_doctor" && (
        <div className="text-center space-y-3">
          <p className="text-3xl">🙏</p>
          <p className="text-slate-100 text-2xl">您的问答已经全部完成啦！</p>
          <p className="text-slate-400 text-lg">还有一点信息需要医生帮您确认，请稍候，或者请医生过来看一下。</p>
        </div>
      )}

      {state.phase === "finished" && (
        <div className="text-center space-y-4">
          <p className="text-3xl">🎉</p>
          <p className="text-slate-100 text-2xl">全部问题已完成，感谢您的配合！</p>
          <p className="text-slate-400 text-lg">您的评估报告已经生成好了。</p>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-2xl font-semibold px-10 py-5 shadow-xl transition"
          >
            查看我的评估报告 →
          </button>
        </div>
      )}
    </div>
  );
}

/** 播放一段 TTS 音频；播放期间置 speaking=true。失败（503/网络）时 reject 由调用方降级 */
function playAudio(
  audioRef: React.RefObject<HTMLAudioElement | null>,
  src: string,
  setSpeaking: (value: boolean) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audio.src = src;
    audio.onended = () => {
      setSpeaking(false);
      resolve();
    };
    audio.onerror = () => {
      setSpeaking(false);
      reject(new Error("音频播放失败"));
    };
    setSpeaking(true);
    audio.play().catch((error: unknown) => {
      setSpeaking(false);
      reject(error instanceof Error ? error : new Error("音频播放失败"));
    });
  });
}

function resolutionNotice(resolution: SubmitAnswerResult["resolution"]): string | null {
  switch (resolution.action) {
    case "confirm":
      return `好的，已记录：${resolution.optionLabel}`;
    case "markPending":
      return "这道题先记下来，稍后我再和您确认一次。";
    case "markManual":
      return "这道题会请医生帮您确认，我们继续。";
    case "clarify":
      return null; // 追问话术本身就是反馈
  }
}

function CenterMessage({ text }: { text: string }) {
  return (
    <div className="flex-1 flex items-center justify-center px-6">
      <p className="text-slate-300 text-2xl text-center leading-relaxed">{text}</p>
    </div>
  );
}
