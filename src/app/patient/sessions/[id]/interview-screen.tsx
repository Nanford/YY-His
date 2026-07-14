/**
 * INPUT:  会话 id、患者展示信息（本地渲染，不出网）、患者端状态 API（state/start/answer）、TTS API
 * OUTPUT: InterviewScreen —— 患者端大屏主组件（数字医生 + 字幕 + 进度 + 作答区）
 * POS:    患者端问询的前端编排：驱动 开始（选语音/手动模式）→ 逐题播报/作答 → 结束 的完整流程。
 *         TTS/ASR 任何一环失败自动降级（纯字幕 + 按钮/文字作答），流程不中断。
 *
 * 语音模式的麦克风流只在"开始评估"这一次点击里申请一次（浏览器策略要求首次授权
 * 必须由真实手势触发），此后由本组件持有并跨题复用；每题播报（playSpeaks）结束后
 * 置 readyForVoice=true，驱动 AnswerInput 自动开始听，患者不需要每题都动手。
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconCheck,
  IconClipboardList,
  IconClock,
  IconHandClick,
  IconHeartHandshake,
  IconMicrophone,
  IconShieldCheck,
  IconUser,
  IconVolume,
} from "@tabler/icons-react";
import type { PatientDialogueStateDto, SubmitAnswerResult } from "@/lib/dialogue/service";
import { DoctorAvatar } from "./avatar";
import { AnswerInput, type VoiceAnswer } from "./answer-input";
import { RecorderError, requestMicStream } from "./wav-recorder";

type LoadPhase = "loading" | "ready" | "error";
type Mode = "voice" | "manual";

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
  const [mode, setMode] = useState<Mode>("voice");
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  /** 本题播报是否已结束，语音模式下驱动 AnswerInput 自动开始听 */
  const [readyForVoice, setReadyForVoice] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** TTS 一旦失败即静默降级为纯字幕，不再重试拖慢流程 */
  const ttsBrokenRef = useRef(false);

  // 组件卸载或切换掉麦克风流时释放，避免麦克风占用指示一直亮着
  useEffect(() => {
    return () => {
      micStream?.getTracks().forEach((track) => track.stop());
    };
  }, [micStream]);

  // 问询已结束/转交医生时不再需要麦克风，主动释放轨道（不必再把 state 置空——
  // AnswerInput 本来就只在 in_question 阶段渲染，不会再用到这个流）
  useEffect(() => {
    if (state && (state.phase === "finished" || state.phase === "awaiting_doctor") && micStream) {
      micStream.getTracks().forEach((track) => track.stop());
    }
  }, [state, micStream]);

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
      setReadyForVoice(false);
      const fallbackSubtitle = next.prompt?.text ?? "";
      if (next.speak.length === 0) {
        setSubtitle(fallbackSubtitle);
        if (next.phase === "in_question") setReadyForVoice(true);
        return;
      }
      if (options.autoplay) {
        void playSpeaks(next.speak, next.capabilities.tts).then(() => {
          if (next.phase === "in_question") setReadyForVoice(true);
        });
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

  const handleStart = async (chosenMode: Mode) => {
    setSubmitting(true);
    try {
      let stream: MediaStream | null = null;
      if (chosenMode === "voice") {
        try {
          stream = await requestMicStream();
        } catch (error) {
          // 语音授权失败不阻塞整体流程，降级为手动模式（按钮/文字始终可用）
          chosenMode = "manual";
          setNotice(error instanceof RecorderError ? error.message : "麦克风授权失败，已切换为手动作答模式");
        }
      }
      setMode(chosenMode);
      setMicStream(stream);
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

  // 答题阶段找回语音：刷新或重进"进行中"的会话会丢失内存里的麦克风流（语音入口原本
  // 只在开始屏出现一次），这里让患者在任意一题重新一键开麦——申请麦克风 → 数字医生
  // 重读本题 → 播完自动开始听。首次开麦必须由这次点击这个真实手势触发（浏览器策略）。
  const enableVoice = async () => {
    setSubmitting(true);
    try {
      const stream = await requestMicStream();
      setMicStream(stream);
      setMode("voice");
      setReadyForVoice(false);
      if (state?.prompt) {
        await playSpeaks([state.prompt.text], state.capabilities.tts);
      }
      setReadyForVoice(true);
    } catch (error) {
      // 授权失败不阻塞：按钮/文字始终可用（AGENTS.md 四模式并存兜底）
      setNotice(error instanceof RecorderError ? error.message : "麦克风打开失败，仍可用按钮或文字作答");
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

  // 语音激活态 = 选了语音模式 + 麦克风流在 + ASR 可用。刷新/重进会话时麦克风流丢失
  // → false → 答题阶段常驻"用语音回答"入口（下方 enableVoice），把语音找回来。
  const voiceReady = mode === "voice" && micStream !== null && state.capabilities.asr;

  return (
    <main className="patient-shell flex-1">
      <PatientSessionTopbar />

      <div className="patient-main space-y-6">
        <section className="patient-panel px-6 py-5 md:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="inline-flex items-center gap-2 text-xl font-bold text-[var(--ink)]">
                  <IconUser size={23} stroke={1.8} aria-hidden="true" />
                  <span>{patientLabel}</span>
                </div>
                <span className="ui-badge">
                  <IconClipboardList size={16} stroke={1.8} aria-hidden="true" />
                  {state.scaleNames.join("、")}
                </span>
              </div>
              <p className="mt-2 text-base text-[var(--ink-muted)]">数字医生将逐题引导，您可随时选择按钮、文字或语音作答。</p>
            </div>

            {state.phase !== "not_started" && (
              <div className="w-full max-w-sm lg:w-80">
                <div className="mb-2 flex items-center justify-between text-sm font-semibold text-[var(--ink-muted)]">
                  <span>完成进度</span>
                  <span>
                    {state.progress.answered} / {state.progress.total} 题
                  </span>
                </div>
                <div
                  className="h-2 overflow-hidden rounded-full bg-[var(--surface-blue)]"
                  role="progressbar"
                  aria-label="评估完成进度"
                  aria-valuemin={0}
                  aria-valuemax={state.progress.total}
                  aria-valuenow={state.progress.answered}
                >
                  <span
                    className="block h-full rounded-full bg-[var(--brand)] transition-[width] duration-300"
                    style={{
                      width:
                        (state.progress.total
                          ? (state.progress.answered / state.progress.total) * 100
                          : 0) + "%",
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </section>

        {notice && (
          <div className="ui-alert ui-alert-warning text-base md:text-lg" role="status">
            <IconAlertTriangle size={23} stroke={1.8} aria-hidden="true" />
            <span>{notice}</span>
          </div>
        )}

        <section className="patient-panel overflow-hidden">
          <div className="grid min-h-[440px] lg:grid-cols-[270px_minmax(0,1fr)]">
            <aside className="flex flex-col items-center justify-center border-b border-[var(--line)] bg-[var(--surface-blue)] px-6 py-8 text-center lg:border-r lg:border-b-0">
              <DoctorAvatar speaking={speaking} mode={state.capabilities.avatarMode} />
              <p className="mt-5 text-xl font-bold text-[var(--ink)]">数字医生</p>
              <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">
                {speaking ? "正在为您播报问题" : "全程陪伴本次健康问询"}
              </p>
            </aside>

            <div className="flex min-w-0 flex-col justify-center px-6 py-8 md:px-10">
              {state.phase === "not_started" && (
                <div className="mx-auto max-w-2xl text-center">
                  <span className="ui-badge mx-auto">
                    <IconCheck size={16} stroke={2} aria-hidden="true" />
                    准备就绪
                  </span>
                  <h1 className="patient-display-title mt-5">您好，准备开始本次健康评估</h1>
                  <p className="patient-display-copy">
                    您好！点击下方按钮，数字医生将开始为您做健康问询。
                  </p>
                  <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                    <button
                      type="button"
                      aria-label="🎤 语音问答（推荐）"
                      disabled={submitting}
                      onClick={() => void handleStart("voice")}
                      className="patient-primary-action w-full sm:w-auto"
                    >
                      <IconMicrophone size={28} stroke={1.8} aria-hidden="true" />
                      <span>语音问答（推荐）</span>
                    </button>
                    <button
                      type="button"
                      aria-label="👆 手动选择作答"
                      disabled={submitting}
                      onClick={() => void handleStart("manual")}
                      className="ui-button ui-button-secondary ui-button-lg w-full sm:w-auto"
                    >
                      <IconHandClick size={21} stroke={1.8} aria-hidden="true" />
                      <span>手动选择作答</span>
                    </button>
                  </div>
                  <p className="mt-5 text-sm leading-6 text-[var(--ink-faint)]">
                    语音不可用时，仍可使用大按钮或文字输入完成问询。
                  </p>
                </div>
              )}

              {state.phase === "in_question" && state.prompt && (
                <div className="w-full">
                  <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                    <span className="ui-badge">
                      <IconClipboardList size={16} stroke={1.8} aria-hidden="true" />
                      健康问询
                    </span>
                    <span className="text-sm font-semibold text-[var(--ink-muted)]">
                      第 {state.progress.answered + 1} / {state.progress.total} 题
                    </span>
                  </div>
                  <p className="patient-display-title max-w-3xl text-[clamp(27px,3vw,40px)]">{subtitle}</p>
                  <button
                    type="button"
                    onClick={replay}
                    className="ui-button ui-button-quiet mt-4 px-0 text-base underline decoration-dotted underline-offset-4"
                  >
                    <IconVolume size={20} stroke={1.8} aria-hidden="true" />
                    <span>再听一遍</span>
                  </button>

                  {/* 语音未激活但 ASR 可用（如刷新/重进会话丢了麦克风流）时，常驻找回入口 */}
                  {!voiceReady && state.capabilities.asr && (
                    <div className="mt-6">
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => void enableVoice()}
                        aria-label="🎤 用语音回答这道题"
                        className="patient-primary-action w-full sm:w-auto"
                      >
                        <IconMicrophone size={26} stroke={1.8} aria-hidden="true" />
                        <span>用语音回答</span>
                      </button>
                      <p className="mt-2 text-sm leading-6 text-[var(--ink-faint)]">
                        点一下，数字医生会再读一遍问题，然后自动听您回答；也可以直接用下面的按钮或文字作答。
                      </p>
                    </div>
                  )}

                  <div className="mt-7 border-t border-[var(--line)] pt-7">
                    <AnswerInput
                      // 切题/换提问方式时重挂载作答区，清空未确认的转写与文字面板；
                      // 语音激活态变化时也重挂载，让 directVoice/自动开麦按新模式重新初始化
                      key={`${state.prompt.questionId}-${state.prompt.attempt}-${voiceReady ? "voice" : "manual"}`}
                      prompt={state.prompt}
                      sessionId={sessionId}
                      asrEnabled={state.capabilities.asr}
                      mode={mode}
                      micStream={micStream}
                      autoStart={readyForVoice}
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
                  </div>
                </div>
              )}

              {state.phase === "awaiting_doctor" && (
                <div className="mx-auto max-w-xl text-center">
                  <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-[var(--warning-soft)] text-[var(--warning)]">
                    <IconClock size={32} stroke={1.7} aria-hidden="true" />
                  </div>
                  <h1 className="mt-6 text-3xl font-bold text-[var(--ink)]">您的问答已经全部完成啦！</h1>
                  <p className="mt-3 text-lg leading-8 text-[var(--ink-muted)]">
                    还有一点信息需要医生帮您确认，请稍候，或者请医生过来看一下。
                  </p>
                </div>
              )}

              {state.phase === "finished" && (
                <div className="mx-auto max-w-xl text-center">
                  <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-[var(--success-soft)] text-[var(--success)]">
                    <IconCheck size={34} stroke={2} aria-hidden="true" />
                  </div>
                  <h1 className="mt-6 text-3xl font-bold text-[var(--ink)]">全部问题已完成，感谢您的配合！</h1>
                  <p className="mt-3 text-lg leading-8 text-[var(--ink-muted)]">您的评估报告已经生成好了。</p>
                  <button
                    type="button"
                    aria-label="查看我的评估报告 →"
                    onClick={() => router.refresh()}
                    className="patient-primary-action mt-7"
                  >
                    <span>查看我的评估报告</span>
                    <IconArrowRight size={26} stroke={1.8} aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
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

/** 患者端会话共用页头：保留大屏识别感，不增加会打断评估的导航。 */
function PatientSessionTopbar() {
  return (
    <header className="patient-topbar border-b border-[var(--line)]">
      <div className="patient-brand">
        <span className="grid size-10 place-items-center rounded-xl bg-[var(--brand)] text-white shadow-[0_8px_16px_rgb(23_105_232_/_20%)]">
          <IconHeartHandshake size={24} stroke={1.8} aria-hidden="true" />
        </span>
        <span>
          <span className="block">精准照护工作台</span>
          <span className="mt-0.5 block text-xs font-semibold text-[var(--ink-faint)]">老年健康评估与干预系统</span>
        </span>
      </div>
      <span className="ui-badge hidden sm:inline-flex">
        <IconShieldCheck size={16} stroke={1.8} aria-hidden="true" />
        信息仅用于本次健康服务
      </span>
    </header>
  );
}

function CenterMessage({ text }: { text: string }) {
  return (
    <main className="patient-shell flex-1">
      <PatientSessionTopbar />
      <div className="patient-main flex min-h-[calc(100vh-76px)] items-center justify-center">
        <section className="patient-panel w-full max-w-2xl px-8 py-12 text-center">
          <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-[var(--surface-blue)] text-[var(--brand)]">
            <IconClipboardList size={32} stroke={1.7} aria-hidden="true" />
          </div>
          <p className="mt-6 text-2xl font-bold leading-relaxed text-[var(--ink)]">{text}</p>
        </section>
      </div>
    </main>
  );
}
