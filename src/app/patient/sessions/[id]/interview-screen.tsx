/**
 * INPUT:  会话 id、患者展示信息（本地渲染，不出网）、患者端状态 API（state/start/answer）、TTS API
 * OUTPUT: InterviewScreen —— 患者端大屏主组件（大数字医生 + 大字体对话记录 + 作答区）
 * POS:    患者端问询的前端编排：驱动 开始（默认语音）→ 逐题播报/作答 → 结束 的完整流程。
 *         适老化改版（意见4）：界面只留一个大大的数字医生形象 + 大字体滚动对话记录，
 *         砍掉信息卡/徽章等装饰。TTS/ASR 任何一环失败自动降级（纯字幕 + 按钮/文字作答）。
 *
 * 语音模式的麦克风流只在"开始评估"这一次点击里申请一次（浏览器策略要求首次授权必须由
 * 真实手势触发），此后由本组件持有并跨题复用；每题播报（playSpeaks）结束后置
 * readyForVoice=true，驱动 AnswerInput 自动开始听，患者不需要每题都动手。刷新/重进
 * 进行中的会话会丢失内存里的麦克风流，答题阶段常驻"用语音回答"入口（enableVoice）找回。
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
  IconVolume,
} from "@tabler/icons-react";
import type {
  PatientDialogueStateDto,
  PatientPromptDto,
  SubmitAnswerResult,
} from "@/lib/dialogue/service";
import { DoctorAvatar } from "./avatar";
import { AnswerInput, type VoiceAnswer } from "./answer-input";
import { RecorderError, requestMicStream } from "./wav-recorder";

type LoadPhase = "loading" | "ready" | "error";
type Mode = "voice" | "manual";

/** 对话记录条目（意见4 大字体对话记录）：数字医生的问 / 患者的答 */
interface TalkEntry {
  id: string;
  role: "doctor" | "patient";
  text: string;
}

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
  /** 大字体对话记录（意见4）：医生问 + 患者答，客户端累积，自动滚到最新 */
  const [talks, setTalks] = useState<TalkEntry[]>([]);
  const talkScrollRef = useRef<HTMLDivElement | null>(null);
  /** 同一题（questionId+attempt）只追加一条医生气泡，避免重渲染/重播重复入列 */
  const lastDoctorKeyRef = useRef<string | null>(null);
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
      // 累积医生气泡：进入某题时把该题问题文本记入对话记录（同题去重）
      if (next.phase === "in_question" && next.prompt) {
        const q = next.prompt;
        const dkey = `${q.questionId}-${q.attempt}`;
        if (lastDoctorKeyRef.current !== dkey) {
          lastDoctorKeyRef.current = dkey;
          setTalks((prev) => [...prev, { id: `d-${dkey}`, role: "doctor", text: q.text }]);
        }
      }
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

  // 对话记录更新（新气泡或播报状态变化）后自动滚到最新一条
  useEffect(() => {
    const el = talkScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [talks, speaking]);

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
    const prompt = state.prompt; // 固定当前题：供作答记录与提交用，避免 await 后 state 变化
    setSubmitting(true);
    try {
      const response = await fetch(`/api/patient/sessions/${sessionId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: prompt.questionId, ...payload }),
      });
      const body = (await response.json()) as (SubmitAnswerResult & { error?: string }) | { error: string };
      if (!response.ok || !("state" in body)) {
        setNotice(("error" in body && body.error) || "提交失败，请重试");
        if (response.status === 409) await refreshState();
        return;
      }
      // 累积患者气泡：把这次作答（按钮选项文案 / 语音·文字原话）记入对话记录
      const said = describeAnswer(prompt, payload);
      if (said) {
        setTalks((prev) => [
          ...prev,
          { id: `p-${prompt.questionId}-${prompt.attempt}-${prev.length}`, role: "patient", text: said },
        ]);
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

      <div className="patient-main">
        {notice && (
          <div className="ui-alert ui-alert-warning mb-5 text-lg md:text-xl" role="status">
            <IconAlertTriangle size={24} stroke={1.8} aria-hidden="true" />
            <span>{notice}</span>
          </div>
        )}

        <section className="patient-panel overflow-hidden u-rise-in">
          <div className="grid min-h-[560px] lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
            {/* 左侧：大大的数字医生（改版主视觉，意见4）*/}
            <aside className="flex flex-col items-center justify-center gap-7 border-b border-[var(--line)] bg-[var(--surface-blue)] px-8 py-12 text-center lg:border-r lg:border-b-0">
              <DoctorAvatar speaking={speaking} mode={state.capabilities.avatarMode} size="xl" />
              <div>
                <p className="text-3xl font-extrabold text-[var(--ink)]">数字医生</p>
                <p className="mt-2 text-xl leading-8 text-[var(--ink-muted)]">
                  {speaking ? "正在为您播报问题…" : voiceReady ? "请开口回答就行" : "全程陪伴本次问询"}
                </p>
                {speaking && subtitle && (
                  <p className="mx-auto mt-3 max-w-[260px] text-base leading-7 text-[var(--ink-faint)]">
                    “{subtitle}”
                  </p>
                )}
              </div>
              {state.phase === "in_question" && (
                <div className="w-full max-w-[260px]">
                  <div className="mb-2 flex items-center justify-between text-base font-semibold text-[var(--ink-muted)]">
                    <span>进度</span>
                    <span>
                      {state.progress.answered} / {state.progress.total} 题
                    </span>
                  </div>
                  <div
                    className="h-2.5 overflow-hidden rounded-full bg-white"
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
                          (state.progress.total ? (state.progress.answered / state.progress.total) * 100 : 0) + "%",
                      }}
                    />
                  </div>
                </div>
              )}
            </aside>

            {/* 右侧：按阶段渲染 */}
            <div className="flex min-h-[560px] min-w-0 flex-col">
              {state.phase === "not_started" && (
                <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center md:px-12">
                  <span className="ui-badge">
                    <IconCheck size={16} stroke={2} aria-hidden="true" />
                    准备就绪
                  </span>
                  <h1 className="patient-display-title mt-5">
                    您好{patientLabel ? `，${patientLabel}` : ""}
                  </h1>
                  <p className="patient-display-copy max-w-xl">
                    数字医生会像聊天一样，一句一句地问您几个健康小问题。点下面的大按钮，直接开口说就行。
                  </p>
                  <div className="mt-9 flex w-full flex-col items-center gap-4">
                    <button
                      type="button"
                      aria-label="开始语音评估，直接开口说话"
                      disabled={submitting}
                      onClick={() => void handleStart("voice")}
                      className="patient-primary-action w-full min-w-[280px] max-w-md justify-center text-2xl"
                    >
                      <IconMicrophone size={30} stroke={1.8} aria-hidden="true" />
                      <span>开始语音评估</span>
                    </button>
                    <button
                      type="button"
                      aria-label="不方便说话，改用按钮或文字作答"
                      disabled={submitting}
                      onClick={() => void handleStart("manual")}
                      className="ui-button ui-button-quiet text-base"
                    >
                      <IconHandClick size={19} stroke={1.8} aria-hidden="true" />
                      <span>不方便说话？改用按钮 / 文字作答</span>
                    </button>
                  </div>
                </div>
              )}

              {state.phase === "in_question" && state.prompt && (
                <>
                  {/* 大字体对话记录（意见4）：医生问 + 患者答，自动滚到最新 */}
                  <div ref={talkScrollRef} className="max-h-[52vh] flex-1 overflow-y-auto px-6 py-8 md:px-10">
                    <ConversationLog talks={talks} speaking={speaking} />
                  </div>

                  {/* 作答区：语音为主，按钮/文字兜底（AGENTS.md 四模式并存）*/}
                  <div className="border-t border-[var(--line)] px-6 py-6 md:px-10">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={replay}
                        className="ui-button ui-button-quiet px-0 text-base underline decoration-dotted underline-offset-4"
                      >
                        <IconVolume size={20} stroke={1.8} aria-hidden="true" />
                        <span>再听一遍</span>
                      </button>
                      <span className="text-base font-semibold text-[var(--ink-muted)]">
                        第 {state.progress.answered + 1} / {state.progress.total} 题
                      </span>
                    </div>

                    {/* 语音未激活但 ASR 可用（如刷新/重进会话丢了麦克风流）时，常驻找回入口 */}
                    {!voiceReady && state.capabilities.asr && (
                      <div className="mb-5">
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => void enableVoice()}
                          aria-label="用语音回答这道题"
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
                </>
              )}

              {state.phase === "awaiting_doctor" && (
                <div className="mx-auto flex max-w-xl flex-1 flex-col items-center justify-center px-6 py-12 text-center">
                  <div className="grid size-16 place-items-center rounded-2xl bg-[var(--warning-soft)] text-[var(--warning)]">
                    <IconClock size={32} stroke={1.7} aria-hidden="true" />
                  </div>
                  <h1 className="mt-6 text-3xl font-bold text-[var(--ink)]">您的问答已经全部完成啦！</h1>
                  <p className="mt-3 text-xl leading-8 text-[var(--ink-muted)]">
                    还有一点信息需要医生帮您确认，请稍候，或者请医生过来看一下。
                  </p>
                </div>
              )}

              {state.phase === "finished" && (
                <div className="mx-auto flex max-w-xl flex-1 flex-col items-center justify-center px-6 py-12 text-center">
                  <div className="grid size-16 place-items-center rounded-2xl bg-[var(--success-soft)] text-[var(--success)]">
                    <IconCheck size={34} stroke={2} aria-hidden="true" />
                  </div>
                  <h1 className="mt-6 text-3xl font-bold text-[var(--ink)]">全部问题已完成，感谢您的配合！</h1>
                  <p className="mt-3 text-xl leading-8 text-[var(--ink-muted)]">您的评估报告已经生成好了。</p>
                  <button
                    type="button"
                    aria-label="查看我的评估报告"
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

/** 把一次作答转成对话记录里"患者说的话"：按钮取选项文案，语音/文字取原话 */
function describeAnswer(prompt: PatientPromptDto, payload: Record<string, unknown>): string {
  if (payload.mode === "button") {
    const opt = prompt.options.find((o) => o.score === payload.score);
    return opt?.label ?? "";
  }
  return typeof payload.utterance === "string" ? payload.utterance : "";
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

/** 大字体对话记录：医生气泡靠左、患者气泡靠右，最新一条医生气泡（当前题）加大加粗强调 */
function ConversationLog({ talks, speaking }: { talks: TalkEntry[]; speaking: boolean }) {
  if (talks.length === 0) {
    return (
      <p className="mx-auto max-w-3xl text-center text-xl leading-relaxed text-[var(--ink-muted)]">
        数字医生正在准备第一个问题…
      </p>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      {talks.map((talk, index) => {
        const isDoctor = talk.role === "doctor";
        const isCurrent = isDoctor && index === talks.length - 1;
        return (
          <div key={talk.id} className={`u-rise-in ${isDoctor ? "flex justify-start" : "flex justify-end"}`}>
            <div
              className={[
                "max-w-[90%] rounded-3xl px-6 py-4 leading-relaxed",
                isDoctor
                  ? "rounded-tl-md bg-[var(--surface-blue)] text-[var(--ink)]"
                  : "rounded-tr-md border border-[var(--line-strong)] bg-white text-[var(--ink)]",
                isCurrent
                  ? "text-[clamp(24px,2.6vw,34px)] font-bold shadow-[0_10px_24px_rgb(23_105_232_/_10%)]"
                  : "text-2xl",
              ].join(" ")}
            >
              <p className="mb-1 text-sm font-bold tracking-wide text-[var(--ink-faint)]">
                {isDoctor ? "数字医生" : "您"}
              </p>
              <p>{talk.text}</p>
              {isCurrent && speaking && (
                <p className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-[var(--brand)]">
                  {/* 三点缓呼吸，比图标脉冲更像"数字医生正在说话"（D 对话过程，样式见 globals.css） */}
                  <span className="typing-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                  正在播报…
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 患者端会话共用页头：极简，只留品牌识别，不加会打断评估的导航。 */
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
