/**
 * INPUT:  会话 id、患者展示信息（本地渲染，不出网）、患者端状态 API（state/start/answer）、TTS API
 * OUTPUT: InterviewScreen —— 患者端大屏主组件（大数字医生 + 当前题大字展示 + 作答区）
 * POS:    患者端问询的前端编排：驱动 开始（默认语音）→ 逐题播报/作答 → 结束 的完整流程。
 *         适老化改版（意见4）：界面只留一个大大的数字医生形象；2026-08-08 设计口径起主区
 *         只展示当前这一条问题/旁白，不再累积滚动聊天记录。TTS/ASR 任何一环失败自动降级
 *         （纯字幕 + 按钮/文字作答）。
 *
 * 语音模式的麦克风流只在"开始评估"这一次点击里申请一次（浏览器策略要求首次授权必须由
 * 真实手势触发），此后由本组件持有并跨题复用；每题播报（playSpeaks）结束后置
 * readyForVoice=true，驱动 AnswerInput 自动开始听，患者不需要每题都动手。刷新/重进
 * 进行中的会话会丢失内存里的麦克风流，答题阶段常驻"用语音回答"入口（enableVoice）找回。
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TriangleAlert, ArrowRight, Check, ClipboardList, Clock, Hand, Mic, Volume2 } from "lucide-react";
import type {
  PatientDialogueStateDto,
  PatientPromptDto,
  SubmitAnswerResult,
} from "@/lib/dialogue/service";
import { DoctorAvatar } from "./avatar";
import { AnswerInput, type VoiceAnswer } from "./answer-input";
import { CONSENT_VAD_CONFIG, RecorderError, WavRecorder, requestMicStream } from "./wav-recorder";
import { logTiming } from "./timing";

type LoadPhase = "loading" | "ready" | "error";
type Mode = "voice" | "manual";

interface InterviewScreenProps {
  sessionId: string;
  /** 患者称呼（本地页面展示用，绝不进入任何出网文本） */
  patientLabel: string;
}

/** TTS 播放器对应的 Web Audio 节点；只分析本机播放波形，不新增任何出网数据。 */
interface LipSyncRuntime {
  context: AudioContext | null;
  source: MediaElementAudioSourceNode | null;
  analyser: AnalyserNode | null;
  animationFrame: number | null;
}

export function InterviewScreen({ sessionId, patientLabel }: InterviewScreenProps) {
  const router = useRouter();
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("loading");
  const [state, setState] = useState<PatientDialogueStateDto | null>(null);
  const [subtitle, setSubtitle] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [mouthLevel, setMouthLevel] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("voice");
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  /** 本题播报是否已结束，语音模式下驱动 AnswerInput 自动开始听 */
  const [readyForVoice, setReadyForVoice] = useState(false);
  /** intro 讲解播报是否已结束，语音模式下驱动"听患者说'开始'"的确认监听 */
  const [readyForConsent, setReadyForConsent] = useState(false);
  /** intro 语音确认没听清时置真：提示患者可再说一声或直接点「开始」（后台已在自动重新听） */
  const [consentHint, setConsentHint] = useState(false);
  /** intro 确认阶段的临时录音器（只用于"检测到患者开口"，不做转写/评分） */
  const consentRecorderRef = useRef<WavRecorder | null>(null);
  /** 确认监听每个 intro 只启动一次；进入第一题只推进一次（防语音+按钮重复触发） */
  const consentStartedRef = useRef(false);
  const beginningRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lipSyncRef = useRef<LipSyncRuntime>({
    context: null,
    source: null,
    analyser: null,
    animationFrame: null,
  });
  /** TTS 失败熔断（冷却式）：失败后 60s 内不再请求（避免服务宕掉时每题都卡到超时拖慢流程），
   *  冷却结束自动重试——一次失败不再永久静默整场，服务恢复/短时抖动后播报自动回来
   *  （2026-09-14：此前一次失败即永久置位，火山账号授权失效时表现为"自某题起全场无声"） */
  const ttsBrokenUntilRef = useRef(0);
  /** 本次展示里当前旁白/题目未能真实播出（TTS 关闭/失败、刷新后无手势自动播放被禁）：
   *  未播出时上屏展示完整文案兜底（含认知指令的记忆词/复述句，否则降级模式下内容彻底丢失——
   *  2026-09-12 修复"认知初筛第一题（三个词）缺失"）；正常播出时沿用 displayText 不上屏口径 */
  const [narrationUnspoken, setNarrationUnspoken] = useState(false);
  const [promptUnspoken, setPromptUnspoken] = useState(false);
  /** 旁白自动推进去重（M9.2）：播完自动调 /advance 与「继续」按钮共用，防重复推进 */
  const advancingRef = useRef(false);
  /** 报告自动跳转去重（2026-08-08：答完直接出报告，免点按钮）；跳转前短延迟让完成提示可见 */
  const reportJumpedRef = useRef(false);
  /** applyState（稳定 useCallback）经此 ref 调用推进函数，避免 useCallback 依赖循环 */
  const advanceRef = useRef<() => void>(() => {});
  /** 当前界面状态的镜像：播放链异步收尾时据此判断"界面是否已推进到下一步"（防止旧链污染新步骤的展示口径） */
  const stateRef = useRef<PatientDialogueStateDto | null>(null);

  // 离开页面时停止 TTS 与口型采样，释放 AudioContext，避免后台继续占用音频资源。
  useEffect(() => {
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    const lipSync = lipSyncRef.current;
    return () => {
      audio.pause();
      if (lipSync.animationFrame !== null) cancelAnimationFrame(lipSync.animationFrame);
      if (lipSync.context && lipSync.context.state !== "closed") void lipSync.context.close();
    };
  }, []);

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

  // speechRate：豆包 speech_rate（认知指令播报放慢语速，2026-09-04 修改意见 3）；缺省走全局默认
  // 返回是否有音频真正完整播出：false = TTS 关闭/已降级/被新播放链切断，调用方据此走
  // 纯字幕兜底（旁白不自动推进，2026-09-12：被切断不算播出，否则旁白链会级联闪切）
  const playSpeaks = useCallback(
    async (texts: string[], ttsEnabled: boolean, speechRate?: number): Promise<boolean> => {
      let played = false;
      for (const [index, text] of texts.entries()) {
        // 链路埋点（V2.0 §2.1）：每轮播报起播第一条记一次"下一题播报开始"
        if (index === 0) logTiming("speak_start");
        setSubtitle(text);
        if (!ttsEnabled || Date.now() < ttsBrokenUntilRef.current) continue;
        try {
          const rateParam = speechRate === undefined ? "" : `&rate=${speechRate}`;
          const completed = await playAudio(
            audioRef,
            lipSyncRef,
            `/api/tts?text=${encodeURIComponent(text)}${rateParam}`,
            setSpeaking,
            setMouthLevel
          );
          // 被新播放链接管：本链音频已被切断，剩余文本不应再播（会反切新链），按未播出收尾
          if (!completed) return false;
          played = true;
        } catch {
          ttsBrokenUntilRef.current = Date.now() + 60_000; // 熔断冷却 60s，本条字幕兜底，流程继续
          setSpeaking(false);
          setMouthLevel(0);
        }
      }
      return played;
    },
    []
  );

  // 评估完成（报告随 finished 状态已落库）后自动切换到报告视图：结束语 TTS 播完才触发
  // （见 applyState），不打断播报；1.5s 短延迟让"已完成"提示可见。
  // 「查看我的评估报告」按钮保留为兜底（刷新失败/想立即查看时仍可点）。
  const jumpToReport = useCallback(() => {
    if (reportJumpedRef.current) return;
    reportJumpedRef.current = true;
    window.setTimeout(() => router.refresh(), 1500);
  }, [router]);

  const applyState = useCallback(
    (next: PatientDialogueStateDto, options: { autoplay: boolean }) => {
      setState(next);
      stateRef.current = next;
      setReadyForVoice(false);
      setReadyForConsent(false);
      setConsentHint(false);
      // 2026-08-08 设计口径：不再累积聊天记录，主区只展示当前这一条问题/旁白（CurrentPrompt）
      const fallbackSubtitle = next.prompt?.text ?? next.narration?.text ?? "";
      // 本次 viewing 未播出语音时置位：主区改展示完整文案（含记忆词/复述句）兜底，
      // 避免"只播报不上屏"的内容在纯字幕模式下彻底丢失
      const markUnspoken = () => {
        setNarrationUnspoken(next.phase === "narration");
        setPromptUnspoken(next.phase === "in_question");
      };
      if (next.speak.length === 0) {
        setSubtitle(fallbackSubtitle);
        markUnspoken();
        if (next.phase === "in_question") setReadyForVoice(true);
        if (next.phase === "intro") setReadyForConsent(true);
        if (next.phase === "finished") jumpToReport();
        return;
      }
      if (options.autoplay) {
        // 认知指令播报（三词记忆）带 speechRate 放慢语速（2026-09-04 修改意见 3）
        const speechRate = next.phase === "narration" ? next.narration?.speechRate : undefined;
        void playSpeaks(next.speak, next.capabilities.tts, speechRate).then((played) => {
          if (played) {
            setNarrationUnspoken(false);
            setPromptUnspoken(false);
          } else if (stateRef.current === next) {
            // 仅当界面仍停留在本步骤时才按"未播出"兜底上屏；若已推进（如患者点了「继续」，
            // 本链被重播/下一步接管而切断），不得给新步骤误挂完整文案（记忆词会随新旁白上屏）
            markUnspoken();
          }
          if (next.phase === "in_question") setReadyForVoice(true);
          if (next.phase === "intro") setReadyForConsent(true);
          // 旁白不需作答：语音自然播完后自动请求下一步（M9.2）；未播出（TTS 关闭/失败）时
          // 停在原地展示全文字幕，由患者点「继续」推进；被新链切断（played=false）同样不推进——
          // 否则切断会沿旁白链级联，几条旁白几秒内全被切掉（2026-09-12 "三个词没播"的根因）
          if (next.phase === "narration" && played) advanceRef.current();
          // 答完全部问题：结束语播完自动跳转评估报告（2026-08-08 口径：答完直接出报告）
          if (next.phase === "finished") jumpToReport();
        });
      } else {
        // 无用户手势时不自动播放（浏览器策略），只展示字幕
        setSubtitle(next.speak[next.speak.length - 1] ?? fallbackSubtitle);
        markUnspoken();
        if (next.phase === "finished") jumpToReport();
      }
    },
    [playSpeaks, jumpToReport]
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
      if (chosenMode === "voice" && !state?.capabilities.asr) {
        // ASR 不可用（密钥缺失/未开通）：静默降级手动模式，不申请麦克风、不出现语音入口，
        // 与下方"语音授权被拒绝静默降级"同一口径
        chosenMode = "manual";
      }
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

  // ---------- intro 讲解 → 患者确认"开始" → 进入第一题 ----------

  // 患者确认后推进到第一题。语音确认与"开始"按钮共用，靠 beginningRef 保证只推进一次。
  const beginQuestions = useCallback(async () => {
    if (beginningRef.current) return;
    beginningRef.current = true;
    consentRecorderRef.current?.teardown(); // 停掉确认监听（不动 micStream，第一题作答还要用）
    consentRecorderRef.current = null;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/patient/sessions/${sessionId}/begin`, { method: "POST" });
      const dto = (await response.json()) as PatientDialogueStateDto & { error?: string };
      if (!response.ok) {
        setNotice(dto.error ?? "无法开始问询");
        beginningRef.current = false;
        return;
      }
      applyState(dto, { autoplay: true });
    } catch {
      setNotice("网络异常，请重试");
      beginningRef.current = false;
    } finally {
      setSubmitting(false);
    }
  }, [sessionId, applyState]);

  // intro 语音确认：讲解播完开一段轻量录音，检测到患者开口（VAD 判定说完一句）即进入第一题。
  // 从宽——只判"有没有说话"，不转写、不评分，走 CONSENT_VAD_CONFIG 宽进档（短促"好的/开始"也算）。
  // 关键：没听到（timeout）不再静默死锁，给提示后自动重新听，直到听到说话或患者点「开始」兜底；
  // 离开 intro / 卸载时由下方 effect 的清理 teardown 停住这条重听链。
  const listenForConsent = useCallback(async () => {
    if (!micStream || consentStartedRef.current) return;
    consentStartedRef.current = true;
    const armOnce = async () => {
      try {
        const recorder = new WavRecorder();
        consentRecorderRef.current = recorder;
        await recorder.start(
          micStream,
          {
            onAutoStop: (reason) => {
              void recorder.stop();
              consentRecorderRef.current = null;
              if (reason === "auto-stop") {
                void beginQuestions(); // 听到患者说话就进第一题
              } else {
                setConsentHint(true); // 没听清：提示可再说一声或点按钮，并重新听（不死锁）
                void armOnce();
              }
            },
          },
          CONSENT_VAD_CONFIG
        );
      } catch {
        consentRecorderRef.current = null; // 失败静默，"开始"按钮兜底
      }
    };
    await armOnce();
  }, [micStream, beginQuestions]);

  // 讲解播完（readyForConsent）且语音模式在 → 自动听患者确认；离开 intro/卸载时清理录音器
  useEffect(() => {
    if (readyForConsent && state?.phase === "intro" && mode === "voice" && micStream && !submitting) {
      void listenForConsent();
    }
    return () => {
      consentRecorderRef.current?.teardown();
      consentRecorderRef.current = null;
    };
  }, [readyForConsent, state?.phase, mode, micStream, submitting, listenForConsent]);

  const submitAnswer = async (payload: Record<string, unknown>) => {
    if (!state?.prompt) return;
    const prompt = state.prompt; // 固定当前题：供作答记录与提交用，避免 await 后 state 变化
    setSubmitting(true);
    try {
      logTiming("answer_request", { questionId: prompt.questionId });
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
      // 链路埋点（V2.0 §2.1）：标准答案确认（归一化决策返回）
      logTiming("answer_confirm", { action: body.resolution.action });
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

  // ---------- 旁白（M9.2 总开场/分类过渡/工具说明）：播完自动推进，不需患者作答 ----------

  // 旁白播报完成（自动链）或患者点「继续」（刷新后无手势自动播放被禁的兜底）后推进：
  // 服务端写 system 轮次标记已播报，返回下一旁白/下一题/收尾状态。advancingRef 防重复推进。
  const advanceFromNarration = async () => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/patient/sessions/${sessionId}/advance`, { method: "POST" });
      const dto = (await response.json()) as PatientDialogueStateDto & { error?: string };
      if (!response.ok) {
        setNotice(dto.error ?? "推进失败，请点「继续」重试");
        if (response.status === 409) await refreshState();
        return;
      }
      applyState(dto, { autoplay: true });
    } catch {
      setNotice("网络异常，请点「继续」重试");
    } finally {
      advancingRef.current = false;
      setSubmitting(false);
    }
  };

  // applyState 是稳定 useCallback，经 ref 拿到最新的推进闭包，避免依赖循环
  useEffect(() => {
    advanceRef.current = () => void advanceFromNarration();
  });

  // 「继续」按钮：本次已播出过的旁白直接推进（自动链下播完本来就会自动推进，此按钮是
  // 跳过/刷新/降级兜底入口）；只有本次未播出过（刷新后自动播放被禁、TTS 降级）才先补播再推进。
  // 2026-09-12 用户反馈修复：此前一律先整条重播再推进，且重播期间按钮未锁，
  // 表现为"点了继续还重复、要再点一次才走"。全程 submitting 锁定防连点。
  const handleNarrationContinue = async () => {
    if (!state?.narration || submitting) return;
    setSubmitting(true);
    try {
      if (narrationUnspoken) {
        await playSpeaks([state.narration.text], state.capabilities.tts, state.narration.speechRate);
      }
      await advanceFromNarration();
    } finally {
      setSubmitting(false);
    }
  };

  const replayNarration = () => {
    if (state?.narration) {
      // 重播真正出声后，回到 displayText 不上屏口径（记忆词听过即隐去）
      void playSpeaks([state.narration.text], state.capabilities.tts, state.narration.speechRate).then(
        (played) => {
          if (played) setNarrationUnspoken(false);
        }
      );
    }
  };

  const replay = () => {
    if (state?.prompt) {
      void playSpeaks([state.prompt.text], state.capabilities.tts).then((played) => {
        if (played) setPromptUnspoken(false);
      });
    }
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
    // 2026-09-04 修改意见 4/7：患者布局（patient/layout.tsx）已有品牌顶栏与 patient-shell 外壳，
    // 本页不再叠第二条顶栏、main 也不重复挂 patient-shell（其 min-height:100vh 会叠在顶栏之后
    // 把整页撑出纵向滚动条），把省下的高度让给问询主区
    <main className="flex-1">
      {/* 例外提示层（V2.0 §2.2）：固定定位浮层，不占用主内容流，出现/消失都不会引起
          数字医生、字幕、对话记录或作答区上下跳动；4 秒后自动关闭（见上方 effect） */}
      {notice && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
          <div
            className="ui-alert ui-alert-warning pointer-events-auto max-w-2xl text-lg shadow-lg md:text-xl"
            role="status"
          >
            <TriangleAlert size={24} strokeWidth={1.8} aria-hidden="true" />
            <span>{notice}</span>
          </div>
        </div>
      )}

      <div className="patient-main patient-main-interview">
        <section className="patient-panel overflow-hidden" aria-label="健康问询">
          <div className="patient-interview-stage">
            <aside className="patient-interview-aside">
              <DoctorAvatar
                speaking={speaking}
                mouthLevel={mouthLevel}
                mode={state.capabilities.avatarMode}
                size="rail"
              />
              <div className="min-w-0">
                <p className="text-lg font-bold text-foreground">
                  数字医生
                </p>
                <p className="text-sm text-muted-foreground">
                  {speaking
                    ? state.phase === "intro"
                      ? "正在为您讲解…"
                      : state.phase === "narration"
                        ? "正在为您说明…"
                        : "正在为您播报问题…"
                    : voiceReady
                      ? "请开口回答就行"
                      : state.phase === "in_question" ? "请选择或输入答案" : "健康问询"}
                </p>
              </div>
            </aside>

            {/* 右侧：按阶段渲染；问询阶段对话区 flex 吃满，作答区固定比例 */}
            <div className="patient-interview-main">
              {state.phase === "not_started" && (
                <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center md:px-12">
                  <span className="ui-badge">
                    <Check size={16} strokeWidth={2} aria-hidden="true" />
                    准备就绪
                  </span>
                  <h1 className="patient-display-title mt-5">
                    您好{patientLabel ? `，${patientLabel}` : ""}
                  </h1>
                  <p className="patient-display-copy max-w-xl">
                    {state.capabilities.asr ? "您可以说出答案，也可以用按钮或文字作答。" : "请用按钮或文字回答健康问题。"}
                  </p>
                  <div className="mt-9 flex w-full flex-col items-center gap-4">
                    <button
                      type="button"
                      aria-label={
                        state.capabilities.asr
                          ? "开始评估，数字医生会先讲解，之后用语音作答"
                          : "开始评估，用按钮或文字作答"
                      }
                      disabled={submitting}
                      onClick={() => void handleStart(state.capabilities.asr ? "voice" : "manual")}
                      className="patient-primary-action w-full min-w-[280px] max-w-md justify-center text-2xl"
                    >
                      {state.capabilities.asr && <Mic size={30} strokeWidth={1.8} aria-hidden="true" />}
                      <span>开始评估</span>
                    </button>
                    {state.capabilities.asr && (
                      <button
                        type="button"
                        aria-label="不方便说话，改用按钮或文字作答"
                        disabled={submitting}
                        onClick={() => void handleStart("manual")}
                        className="ui-button ui-button-quiet text-base"
                      >
                        <Hand size={19} strokeWidth={1.8} aria-hidden="true" />
                        <span>不方便说话？改用按钮 / 文字作答</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {state.phase === "intro" && (
                <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center md:px-12">
                  <span className="ui-badge">
                    <Volume2 size={16} strokeWidth={2} aria-hidden="true" />
                    数字医生正在讲解
                  </span>
                  {/* 讲解全文作字幕展示（TTS 关闭/听不清时的兜底），内容见 prompts.ts OPENING_TEXT */}
                  <p className="patient-display-copy mt-6 max-w-2xl text-[clamp(20px,2.2vw,28px)] font-semibold leading-relaxed text-[var(--ink)]">
                    {subtitle || "……"}
                  </p>
                  {consentHint ? (
                    <p className="mt-5 text-lg font-semibold leading-7 text-[var(--warning)]">
                      没太听清您说话，直接点下面的「开始」大按钮就可以 👇（也可以再说一声“开始”）
                    </p>
                  ) : (
                    <p className="mt-5 text-lg leading-7 text-[var(--ink-muted)]">
                      {mode === "voice" && micStream && state.capabilities.asr
                        ? "听完您说一声“好的”或者“开始”就可以，也可以点下面的大按钮。"
                        : "准备好了就点下面的大按钮开始。"}
                    </p>
                  )}
                  <button
                    type="button"
                    aria-label="开始回答健康问题"
                    disabled={submitting}
                    onClick={() => void beginQuestions()}
                    className="patient-primary-action mt-8"
                  >
                    <span>开始</span>
                    <ArrowRight size={26} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                </div>
              )}

              {state.phase === "narration" && state.narration && (
                <>
                  {/* 旁白说明（M9.2 总开场/分类过渡/工具说明）：只展示当前这一条（2026-08-08 设计口径），
                      带「说明」徽章，不显示作答区；语音播出后自动推进，「继续」按钮作刷新/降级兜底。
                      认知指令播报展示 displayText（记忆词不上屏，2026-09-04 修改意见 3）；
                      例外：本次未播出语音（TTS 关闭/失败、刷新后未重播）时展示完整文案兜底，
                      否则记忆词在纯字幕模式下彻底丢失（2026-09-12 修复） */}
                  <div className="patient-interview-log flex flex-col items-center justify-center">
                    <CurrentPrompt
                      text={
                        narrationUnspoken
                          ? state.narration.text
                          : state.narration.displayText ?? state.narration.text
                      }
                      badge="说明"
                      speaking={speaking}
                    />
                  </div>
                  <div className="patient-interview-answer">
                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={replayNarration}
                        className="ui-button ui-button-quiet px-0 text-base underline decoration-dotted underline-offset-4"
                      >
                        <Volume2 size={20} strokeWidth={1.8} aria-hidden="true" />
                        <span>再听一遍</span>
                      </button>
                      <button
                        type="button"
                        aria-label="继续，听数字医生往下讲"
                        disabled={submitting}
                        onClick={() => void handleNarrationContinue()}
                        className="patient-primary-action"
                      >
                        <span>继续</span>
                        <ArrowRight size={26} strokeWidth={1.8} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </>
              )}

              {state.phase === "in_question" && state.prompt && (
                <>
                  <div className="shrink-0 border-b border-border bg-card px-4 py-2 sm:px-7">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="font-bold text-foreground tabular-nums">
                        第 {state.progress.answered + 1} / {state.progress.total} 题
                      </span>
                      <button type="button" onClick={replay} className="ui-button ui-button-quiet ui-button-sm">
                        <Volume2 size={18} aria-hidden="true" />
                        再听一遍
                      </button>
                    </div>
                    <progress
                      className="block h-1.5 w-full overflow-hidden rounded-full bg-accent [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-accent [&::-webkit-progress-value]:bg-primary"
                      aria-label="评估完成进度"
                      max={Math.max(1, state.progress.total)}
                      value={state.progress.answered}
                    />
                  </div>
                  {/* 当前题大字展示（2026-08-08 设计口径：只展示当前这一条问题，不留聊天记录）。
                      displayText 优先（MMSE 复述题目标句不上屏，2026-09-04 修改意见 6）；
                      例外：本次未播出语音时展示完整题干兜底（2026-09-12，同旁白口径）。
                      画钟题用紧凑样式：题干字小一档，把高度让给画布 */}
                  <div className="patient-interview-log flex flex-col items-center justify-center">
                    <CurrentPrompt
                      text={promptUnspoken ? state.prompt.text : state.prompt.displayText ?? state.prompt.text}
                      speaking={speaking}
                      compact={state.prompt.answerType === "drawing"}
                    />
                  </div>

                  {/* 作答区：语音为主视觉，按钮/文字为兜底；高度上限避免挤掉对话 */}
                  <div className="patient-interview-answer">
                    {/* 语音未激活但 ASR 可用（如刷新/重进会话丢了麦克风流）时，常驻找回入口。
                        多选/图片/画钟等专用控件题不收语音作答（多选只点选、画钟交卷），
                        展示语音入口没有意义，反而挤占作答区高度（2026-09-04 修改意见 4/7） */}
                    {!voiceReady && state.capabilities.asr && voiceAnswerable(state.prompt.answerType) && (
                      <div className="mb-4">
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => void enableVoice()}
                          aria-label="用语音回答这道题"
                          className="patient-primary-action w-full sm:w-auto"
                        >
                          <Mic size={26} strokeWidth={1.8} aria-hidden="true" />
                          <span>用语音回答</span>
                        </button>
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
                      onSubmitOption={(label) => void submitAnswer({ mode: "button", label })}
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
                      onSubmitMulti={(labels) => void submitAnswer({ mode: "multi", labels })}
                      onSubmitDrawing={(drawingDataUrl) =>
                        void submitAnswer({ mode: "drawing", drawingDataUrl })
                      }
                      onNotice={setNotice}
                    />
                  </div>
                </>
              )}

              {state.phase === "awaiting_doctor" && (
                <div className="mx-auto flex max-w-xl flex-1 flex-col items-center justify-center px-6 py-12 text-center">
                  <div className="grid size-16 place-items-center rounded-2xl bg-[var(--warning-soft)] text-[var(--warning)]">
                    <Clock size={32} strokeWidth={1.7} aria-hidden="true" />
                  </div>
                  <h1 className="mt-6 text-3xl font-bold text-[var(--ink)]">您的问答已经全部完成啦！</h1>
                  <p className="mt-3 text-xl leading-8 text-[var(--ink-muted)]">
                    还有一点信息需要医生帮您确认，请稍候，或者请医生过来看一下。
                  </p>
                  {/* 修复死路：给患者一个明确的返回首页出口，不再卡在此页 */}
                  <Link href="/patient" className="ui-button ui-button-secondary ui-button-lg mt-8">
                    <ArrowRight size={21} strokeWidth={1.9} aria-hidden="true" />
                    <span>返回首页</span>
                  </Link>
                </div>
              )}

              {state.phase === "finished" && (
                <div className="mx-auto flex max-w-xl flex-1 flex-col items-center justify-center px-6 py-12 text-center">
                  <div className="grid size-16 place-items-center rounded-2xl bg-[var(--success-soft)] text-[var(--success)]">
                    <Check size={34} strokeWidth={2} aria-hidden="true" />
                  </div>
                  <h1 className="mt-6 text-3xl font-bold text-[var(--ink)]">全部问题已完成，感谢您的配合！</h1>
                  <p className="mt-3 text-xl leading-8 text-[var(--ink-muted)]">您的评估报告已经生成好了，正在为您打开…</p>
                  <button
                    type="button"
                    aria-label="查看我的评估报告"
                    onClick={() => router.refresh()}
                    className="patient-primary-action mt-7"
                  >
                    <span>查看我的评估报告</span>
                    <ArrowRight size={26} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                  <p className="mt-3 text-sm text-[var(--ink-muted)]">如未自动打开，请点上方按钮。</p>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

/**
 * 播放链代际登记：同一 audio 元素任意时刻只保留一条活跃播放链。
 * 新一次 playAudio 先静默收尾旧链（旧 Promise 以 resolve(false) 结束，外层 await 链不悬挂——
 * 如自动播报中患者点「再听一遍」时置 readyForVoice 的那条链），旧链残留的
 * onended/onerror/play() 回调凭代际 token 失效，不再触碰口型/speaking 状态。
 */
const playChains = new WeakMap<HTMLAudioElement, { generation: number; supersede: () => void }>();

/**
 * 播放一段 TTS 音频；播放期间置 speaking=true。失败（503/网络）时 reject 由调用方降级。
 * resolve(true)=自然播完；resolve(false)=被新播放链接管（音频被切断，不算播出——
 * 2026-09-12：此前被取代也按"播完"处理，旁白自动推进链会在几秒内级联切完全部旁白音频，
 * 表现为"三个词没播就跳到画钟"）。
 */
function playAudio(
  audioRef: React.RefObject<HTMLAudioElement | null>,
  lipSyncRef: React.RefObject<LipSyncRuntime>,
  src: string,
  setSpeaking: (value: boolean) => void,
  setMouthLevel: (value: number) => void
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    // 新链接管：先静默收尾旧链，再停掉当前播放（旧 play() 的 AbortError 回调会被代际判失效吞掉）
    const prev = playChains.get(audio);
    const generation = (prev?.generation ?? 0) + 1;
    prev?.supersede();
    audio.pause();
    const isCurrent = () => playChains.get(audio)?.generation === generation;
    const finish = (settle: () => void) => {
      if (!isCurrent()) return; // 已被新链接管：静默退出，状态由新链负责
      playChains.delete(audio);
      stopLipSync(lipSyncRef.current, setMouthLevel);
      setSpeaking(false);
      settle();
    };
    playChains.set(audio, {
      generation,
      // 被新播放取代不属于失败：resolve(false) 静默收尾（ttsBrokenRef 不应因此置位，
      // 但也不算"播出"——调用方不得据此自动推进旁白）
      supersede: () => finish(() => resolve(false)),
    });
    audio.src = src;
    audio.onended = () => finish(() => resolve(true));
    audio.onerror = () => finish(() => reject(new Error("音频播放失败")));
    setMouthLevel(0);
    setSpeaking(true);
    audio
      .play()
      .then(() => {
        if (isCurrent()) void startLipSync(audio, lipSyncRef, setMouthLevel);
      })
      .catch((error: unknown) => {
        finish(() => reject(error instanceof Error ? error : new Error("音频播放失败")));
      });
  });
}

/**
 * 用 TTS 音频的短时能量控制开/闭口图层；若浏览器禁用 Web Audio，按播放时间生成
 * 保守的节奏口型，保证语音仍正常播放且形象不会退回静态占位图。
 */
async function startLipSync(
  audio: HTMLAudioElement,
  lipSyncRef: React.RefObject<LipSyncRuntime>,
  setMouthLevel: (value: number) => void
): Promise<void> {
  const runtime = lipSyncRef.current;
  if (runtime.animationFrame !== null) cancelAnimationFrame(runtime.animationFrame);

  try {
    if (!runtime.context) {
      runtime.context = new AudioContext();
      runtime.analyser = runtime.context.createAnalyser();
      runtime.analyser.fftSize = 256;
      runtime.analyser.smoothingTimeConstant = 0.55;
      runtime.source = runtime.context.createMediaElementSource(audio);
      runtime.source.connect(runtime.analyser);
      runtime.analyser.connect(runtime.context.destination);
    }
    if (runtime.context.state === "suspended") await runtime.context.resume();
  } catch {
    // 旧浏览器或音频策略不支持 Web Audio 时由下方时间节奏兜底，不影响 TTS 播放。
  }

  const samples = runtime.analyser ? new Uint8Array(runtime.analyser.fftSize) : null;
  let lastLevel = -1;
  const updateMouth = () => {
    if (audio.paused || audio.ended) {
      stopLipSync(runtime, setMouthLevel);
      return;
    }

    let level: number;
    if (runtime.context?.state === "running" && runtime.analyser && samples) {
      runtime.analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) {
        const centered = (sample - 128) / 128;
        energy += centered * centered;
      }
      const rms = Math.sqrt(energy / samples.length);
      // 音量映射到 0～1 口型开合：门限以下闭口，往上线性张开（分级比开/闭硬切更自然）。
      const RMS_FLOOR = 0.02;
      const RMS_CEIL = 0.11;
      level = Math.max(0, Math.min(1, (rms - RMS_FLOOR) / (RMS_CEIL - RMS_FLOOR)));
    } else {
      // 不支持 AudioContext 时的视觉兜底：按播放时间生成有停顿的开合节奏。
      level = Math.floor(audio.currentTime * 7) % 3 === 0 ? 0 : 0.85;
    }
    // 量化到 6 档，只在档位变化时更新 state，避免逐帧重渲染肖像。
    const quantized = Math.round(level * 5) / 5;
    if (quantized !== lastLevel) {
      lastLevel = quantized;
      setMouthLevel(quantized);
    }
    runtime.animationFrame = requestAnimationFrame(updateMouth);
  };
  updateMouth();
}

function stopLipSync(runtime: LipSyncRuntime, setMouthLevel: (value: number) => void): void {
  if (runtime.animationFrame !== null) cancelAnimationFrame(runtime.animationFrame);
  runtime.animationFrame = null;
  setMouthLevel(0);
}

// 来源：需求更新说明 V2.0 §2.2 —— 标准答案确认后不弹"已记录"提示；2026-08-08 设计口径起
// 不再累积回答气泡（主区只展示当前题），作答点选态与进入下一题即反馈；
// 仅追问外的例外情形（待确认/转医生）走固定浮层提示。
function resolutionNotice(resolution: SubmitAnswerResult["resolution"]): string | null {
  switch (resolution.action) {
    case "confirm":
      return null; // 气泡即反馈，不再插入"已记录"提示
    case "markPending":
      return "这道题先记下来，稍后我再和您确认一次。";
    case "markManual":
      return "这道题会请医生帮您确认，我们继续。";
    case "clarify":
      return null; // 追问话术本身就是反馈
  }
}

/**
 * 当前条目大字展示（2026-08-08 设计口径：主区只展示当前这一条问题/旁白，不累积聊天记录）。
 * 题目使用大字阅读区，旁白带「说明」徽章，播报中显示状态。
 */
function CurrentPrompt({
  text,
  badge,
  speaking,
  compact = false,
}: {
  text: string;
  badge?: string;
  speaking: boolean;
  /** 紧凑模式（画钟题）：文字小一档、留白收紧，把题目区高度让给作答区画布 */
  compact?: boolean;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div
        className={
          compact
            ? "border-l-4 border-primary px-3 py-1 leading-snug text-foreground"
            : "border-l-4 border-primary px-4 py-2 leading-relaxed text-foreground sm:px-6"
        }
      >
        {badge && <p className="mb-2 text-sm font-bold text-primary">{badge}</p>}
        <p className={compact ? "text-[clamp(17px,1.5vw,21px)] font-bold" : "text-[clamp(22px,2.2vw,30px)] font-bold"}>
          {text}
        </p>
        {speaking && (
          <p className={`${compact ? "mt-1" : "mt-2"} inline-flex items-center gap-2 text-sm font-semibold text-[var(--brand)]`}>
            {/* 三点缓呼吸，比图标脉冲更像"数字医生正在说话"（样式见 globals.css） */}
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
}

/** 该题型是否支持语音作答（专用控件题不收语音：多选只点选、图片点选、画钟交卷；数字题保留语音兜底） */
function voiceAnswerable(answerType: PatientPromptDto["answerType"]): boolean {
  return (
    answerType === "boolean" ||
    answerType === "choice" ||
    answerType === "likert5" ||
    answerType === "number"
  );
}

function CenterMessage({ text }: { text: string }) {
  // 顶栏与 patient-shell 外壳由患者布局（patient/layout.tsx）统一提供（2026-09-04 修改意见 4/7）
  return (
    <main className="flex-1">
      <div className="patient-main flex min-h-[calc(100vh-76px)] items-center justify-center">
        <section className="patient-panel w-full max-w-2xl px-8 py-12 text-center">
          <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-[var(--surface-blue)] text-[var(--brand)]">
            <ClipboardList size={32} strokeWidth={1.7} aria-hidden="true" />
          </div>
          <p className="mt-6 text-2xl font-bold leading-relaxed text-[var(--ink)]">{text}</p>
        </section>
      </div>
    </main>
  );
}
