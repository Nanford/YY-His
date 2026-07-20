/**
 * INPUT:  Prisma（会话/轮次/答案）、追问状态机、归一化编排、话术模板、能力开关
 * OUTPUT: getPatientDialogueState / startPatientDialogue / submitPatientAnswer
 * POS:    患者端问询的服务端编排层：加载快照 → 状态机决策 → 落库（DialogueTurn/Answer）→ 返回 DTO。
 *         不实现任何医学规则；评分仍由医生端 finalize 时调用评分引擎完成。
 */
import { prisma } from "@/lib/db";
import { scaleById } from "@/lib/rules";
import type { Prisma } from "@/generated/prisma/client";
import { appendAnswerEditHistory, type AnswerSnapshot } from "@/lib/assessment/audit";
import { acquireFinalizingLock, scoreAndSnapshot, type FinalizeOutcome } from "@/lib/assessment/finalize";
import { voiceCapabilities, type VoiceCapabilities } from "@/lib/providers/capabilities";
import { normalizeAnswer, type NormalizationOutcome } from "./normalize";
import { CLOSING_TEXT, OPENING_TEXT, clarifyText, recheckText } from "./prompts";
import {
  askableQuestions,
  nextStep,
  progressOf,
  resolveReply,
  type AnswerStatus,
  type AskableQuestion,
  type AskAttempt,
  type DialogueSnapshot,
  type DialogueStep,
} from "./state-machine";

// ---------- DTO（患者端大屏消费的全部数据） ----------

export interface PatientPromptDto {
  questionId: string;
  kind: "ask" | "clarify" | "recheck";
  attempt: AskAttempt;
  /** 播报/字幕文案（预生成模板拼装） */
  text: string;
  answerType: "boolean" | "choice" | "likert5";
  options: { label: string; score: number }[];
  scaleName: string;
  questionNo: string;
  title: string;
}

export interface PatientDialogueStateDto {
  sessionId: string;
  /**
   * not_started：尚未点击"开始"（未写任何轮次）。
   * intro：已播报讲解开场白、正在等患者口头确认"开始"，第一题尚未发出（已问候但无题目轮次）。
   * in_question：问询进行中。
   * awaiting_doctor：问答已全部答完，但评估暂未生成（存在普通问答题"待人工确认"未补录），需医生协助后才能生成报告。
   * （测量/观察类医生题缺口不再进入此态——Demo 口径 deferClinical 豁免其计分，直接出部分计分报告。）
   * finished：本次提交刚好完成评分并生成报告——仅作为触发前端跳转去看报告的一次性信号，不会被 GET /state 重复返回。
   * locked：会话已不在 in_progress（通常因为报告已生成，应改为渲染报告页；此值仅作兜底）。
   */
  phase: "not_started" | "intro" | "in_question" | "awaiting_doctor" | "finished" | "locked";
  scaleNames: string[];
  capabilities: VoiceCapabilities;
  progress: { answered: number; total: number };
  /** 当前待回答的题目；非 in_question 阶段为 null */
  prompt: PatientPromptDto | null;
  /** 本次需要依序播报的文案（开场白/下一题/结束语）；刷新时为当前题重播文案 */
  speak: string[];
}

export interface SubmitAnswerInput {
  questionId: string;
  /** 输入模式（AGENTS.md：语音转文字确认 / 语音直答 → voice；文字 → text；大按钮 → button） */
  mode: "voice" | "text" | "button";
  /** voice/text 模式的原始回答文本（语音为 ASR 转写） */
  utterance?: string;
  /** button 模式点选的选项分值（服务端按规则选项校验） */
  score?: number;
  /** 语音回答的录音文件相对路径（storage/audio-cache 下），供追溯回放 */
  audioPath?: string;
  /** ASR 原始返回（置信度等） */
  asrRaw?: unknown;
}

export interface SubmitAnswerResult {
  /** 本题处理结论：给患者端展示的简短反馈 */
  resolution:
    | { action: "confirm"; optionLabel: string }
    | { action: "clarify" }
    | { action: "markPending" }
    | { action: "markManual" };
  state: PatientDialogueStateDto;
}

/** 业务校验失败（会话状态不符/题目不匹配等），路由层映射为 409 */
export class DialogueConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DialogueConflictError";
  }
}

// ---------- 内部：快照加载与 DTO 组装 ----------

interface LoadedContext {
  session: { id: string; status: string; scaleIds: string[]; patientCode: string };
  questions: AskableQuestion[];
  snapshot: DialogueSnapshot;
  started: boolean;
}

type Tx = Prisma.TransactionClient;

async function loadContext(tx: Tx, sessionId: string): Promise<LoadedContext> {
  const session = await tx.assessmentSession.findUnique({
    where: { id: sessionId },
    include: {
      patient: { select: { code: true } },
      answers: { select: { questionId: true, status: true } },
      turns: { select: { role: true, questionId: true } },
    },
  });
  if (!session) throw new DialogueConflictError("评估会话不存在");

  const scaleIds = session.scaleIds as string[];
  const questions = askableQuestions(scaleIds);

  const answerStatus = new Map<string, AnswerStatus>();
  for (const answer of session.answers) {
    // superseded 是分支切换后的历史答案，不参与当前问询判断
    if (answer.status === "superseded") continue;
    answerStatus.set(answer.questionId, answer.status as AnswerStatus);
  }
  const doctorAskCount = new Map<string, number>();
  const patientReplyCount = new Map<string, number>();
  for (const turn of session.turns) {
    if (!turn.questionId) continue;
    if (turn.role === "doctor") {
      doctorAskCount.set(turn.questionId, (doctorAskCount.get(turn.questionId) ?? 0) + 1);
    } else if (turn.role === "patient") {
      patientReplyCount.set(turn.questionId, (patientReplyCount.get(turn.questionId) ?? 0) + 1);
    }
  }

  return {
    session: {
      id: session.id,
      status: session.status,
      scaleIds,
      patientCode: session.patient.code,
    },
    questions,
    snapshot: { answerStatus, doctorAskCount, patientReplyCount },
    started: session.turns.some((turn) => turn.role === "doctor"),
  };
}

function promptDto(step: DialogueStep): PatientPromptDto | null {
  if (step.kind === "finished") return null;
  // awaiting 时按 attempt 重建话术：模板是确定性的，与写入 turns 的播报文本一致
  const item = step.kind === "prompt" ? step.prompt.item : step.item;
  const attempt = step.kind === "prompt" ? step.prompt.attempt : step.attempt;
  const kind = attempt === 1 ? "ask" : attempt === 2 ? "clarify" : "recheck";
  const text =
    attempt === 1
      ? item.question.colloquialText
      : attempt === 2
        ? clarifyText(item.question, item.options)
        : recheckText(item.question);
  return {
    questionId: item.question.id,
    kind,
    attempt,
    text,
    answerType: item.question.answerType,
    options: item.options,
    scaleName: item.scaleName,
    questionNo: item.question.no,
    title: item.question.title,
  };
}

function buildState(
  context: LoadedContext,
  scaleNames: string[],
  speak: string[]
): PatientDialogueStateDto {
  const capabilities = voiceCapabilities();
  const progress = progressOf(context.questions, context.snapshot);
  if (context.session.status !== "in_progress") {
    return {
      sessionId: context.session.id,
      phase: "locked",
      scaleNames,
      capabilities,
      progress,
      prompt: null,
      speak: [],
    };
  }
  if (!context.started) {
    return {
      sessionId: context.session.id,
      phase: "not_started",
      scaleNames,
      capabilities,
      progress,
      prompt: null,
      speak: [],
    };
  }
  const step = nextStep(context.questions, context.snapshot);
  // 已问候但还没发出任何题目（无带 questionId 的 doctor 轮次）＝讲解+确认阶段：
  // 数字医生已播讲解开场白，正在等患者说"开始"，第一题待 beginPatientQuestions 才发。
  // 仅当确实还有题可问（step 为 prompt）时才停在 intro；若医生已代填全部（finished）则照常收尾。
  const questionsBegun = context.snapshot.doctorAskCount.size > 0;
  if (!questionsBegun && step.kind === "prompt") {
    return {
      sessionId: context.session.id,
      phase: "intro",
      scaleNames,
      capabilities,
      progress,
      prompt: null,
      speak,
    };
  }
  if (step.kind === "finished") {
    // 到达这里时 session 仍是 in_progress：说明问答已问完，但评分未成功
    // （存在普通问答题"待人工确认"未补录；测量/观察类医生题已按 deferClinical 豁免不阻断），
    // 需医生协助补录后才能生成报告。
    return {
      sessionId: context.session.id,
      phase: "awaiting_doctor",
      scaleNames,
      capabilities,
      progress,
      prompt: null,
      speak,
    };
  }
  return {
    sessionId: context.session.id,
    phase: "in_question",
    scaleNames,
    capabilities,
    progress,
    prompt: promptDto(step),
    speak,
  };
}

/** 刚完成评分快照生成时的一次性响应：告知前端跳转去看报告，不通过 buildState 派生。 */
function reportReadyState(
  context: LoadedContext,
  scaleNames: string[],
  speak: string[]
): PatientDialogueStateDto {
  return {
    sessionId: context.session.id,
    phase: "finished",
    scaleNames,
    capabilities: voiceCapabilities(),
    progress: progressOf(context.questions, context.snapshot),
    prompt: null,
    speak,
  };
}

/**
 * 患者问答已全部完成（state machine 判定 finished）时尝试自动生成评估报告。
 * 用户已确认的产品口径：评估内容是确定性计算，问答完成即应生成报告，
 * 不需要医生先审核评估结果——干预方案候选医生仍可另行审核调整，互不阻塞。
 * Demo 口径（2026-07-20 用户拍板）：患者自助路径传 deferClinical——舌象/测量等
 * 医生检查题缺失不再阻断出报告，忽略其计分并在报告中标注"部分计分"；
 * 仅普通问答题"待人工确认"未补录时才会落 awaiting_doctor 等医生补录。
 */
async function tryAutoFinalize(tx: Tx, sessionId: string): Promise<FinalizeOutcome> {
  await acquireFinalizingLock(tx, sessionId);
  return scoreAndSnapshot(tx, sessionId, { deferClinical: true });
}

function scaleNamesOf(context: LoadedContext): string[] {
  return context.session.scaleIds.map((scaleId) => scaleById.get(scaleId)?.name ?? scaleId);
}

// ---------- 对外服务 ----------

/** 查询当前问询状态（只读，不写任何轮次）。刷新页面时重建当前题的播报文案 */
export async function getPatientDialogueState(sessionId: string): Promise<PatientDialogueStateDto> {
  const context = await loadContext(prisma, sessionId);
  const scaleNames = scaleNamesOf(context);
  const state = buildState(context, scaleNames, []);
  // 刷新场景：intro 重播讲解、in_question 重播当前题，供患者端"重听一遍"
  if (state.phase === "intro") {
    return { ...state, speak: [OPENING_TEXT] };
  }
  if (state.phase === "in_question" && state.prompt) {
    return { ...state, speak: [state.prompt.text] };
  }
  return state;
}

/**
 * 开始问询（幂等）：只写入讲解开场白轮次，进入 intro 阶段等患者口头确认"开始"；
 * 第一题的提问轮次留给 beginPatientQuestions（患者确认后）写入。
 * 已开始的会话重复调用不再写轮次，直接返回当前状态（intro 重播讲解、in_question 重播当前题）。
 * 特例：医生已通过表单代填全部患者可答题目 → 开场白后直接收尾并尝试出报告，不停在 intro。
 */
export async function startPatientDialogue(sessionId: string): Promise<PatientDialogueStateDto> {
  return prisma.$transaction(async (tx) => {
    const context = await loadContext(tx, sessionId);
    if (context.session.status !== "in_progress") {
      throw new DialogueConflictError("当前会话不在采集中，无法开始问询");
    }
    const scaleNames = scaleNamesOf(context);
    if (context.started) {
      const state = buildState(context, scaleNames, []);
      if (state.phase === "intro") return { ...state, speak: [OPENING_TEXT] };
      return state.phase === "in_question" && state.prompt
        ? { ...state, speak: [state.prompt.text] }
        : state;
    }

    await tx.dialogueTurn.create({
      data: { sessionId, role: "doctor", questionId: null, text: OPENING_TEXT },
    });
    const step = nextStep(context.questions, context.snapshot);
    if (step.kind === "prompt") {
      // 讲解播完进入 intro：不写第一题轮次，等患者确认后由 beginPatientQuestions 推进
      return buildState({ ...context, started: true }, scaleNames, [OPENING_TEXT]);
    }
    if (step.kind === "finished") {
      // 医生已代填全部患者可答题目：开场白后直接播报结束语并尝试自动生成报告
      await tx.dialogueTurn.create({
        data: { sessionId, role: "doctor", questionId: null, text: CLOSING_TEXT },
      });
      const speak = [OPENING_TEXT, CLOSING_TEXT];
      const outcome = await tryAutoFinalize(tx, sessionId);
      if (outcome.kind === "completed") {
        return reportReadyState({ ...context, started: true }, scaleNames, speak);
      }
      return buildState({ ...context, started: true }, scaleNames, speak);
    }
    throw new Error("状态机不变量被打破：开场后不应处于 awaiting");
  });
}

/**
 * 讲解确认后推进到第一题（幂等）：患者在 intro 阶段口头/点击确认"开始"后调用，
 * 写入第一题提问轮次并进入 in_question。已开始答题（幂等重复调用）直接返回当前状态。
 * 特例：医生已代填全部题目 → 直接收尾出报告。
 */
export async function beginPatientQuestions(sessionId: string): Promise<PatientDialogueStateDto> {
  return prisma.$transaction(async (tx) => {
    const context = await loadContext(tx, sessionId);
    if (context.session.status !== "in_progress") {
      throw new DialogueConflictError("当前会话不在采集中，无法开始问询");
    }
    const scaleNames = scaleNamesOf(context);
    if (!context.started) {
      // 还没播讲解就要进第一题：调用次序异常，交前端先 /start
      throw new DialogueConflictError("问询尚未开始，请先开始评估");
    }
    // 已经在答题（有题目轮次）→ 幂等返回当前状态
    if (context.snapshot.doctorAskCount.size > 0) {
      const state = buildState(context, scaleNames, []);
      return state.phase === "in_question" && state.prompt
        ? { ...state, speak: [state.prompt.text] }
        : state;
    }
    const step = nextStep(context.questions, context.snapshot);
    if (step.kind === "prompt") {
      await tx.dialogueTurn.create({
        data: { sessionId, role: "doctor", questionId: step.prompt.item.question.id, text: step.prompt.text },
      });
      bumpCount(context.snapshot.doctorAskCount, step.prompt.item.question.id);
      return buildState(context, scaleNames, [step.prompt.text]);
    }
    if (step.kind === "finished") {
      await tx.dialogueTurn.create({
        data: { sessionId, role: "doctor", questionId: null, text: CLOSING_TEXT },
      });
      const outcome = await tryAutoFinalize(tx, sessionId);
      if (outcome.kind === "completed") {
        return reportReadyState(context, scaleNames, [CLOSING_TEXT]);
      }
      return buildState(context, scaleNames, [CLOSING_TEXT]);
    }
    throw new Error("状态机不变量被打破：确认后不应处于 awaiting");
  });
}

function bumpCount(map: ReadonlyMap<string, number>, questionId: string): void {
  (map as Map<string, number>).set(questionId, (map.get(questionId) ?? 0) + 1);
}

/** 按钮作答直接按选项分值确认（确定性输入，无需归一化） */
function buttonOutcome(item: AskableQuestion, score: number | undefined): NormalizationOutcome {
  const option = item.options.find((candidate) => candidate.score === score);
  if (!option) {
    throw new DialogueConflictError("按钮选项无效：分值未命中题目选项");
  }
  return {
    status: "matched",
    optionLabel: option.label,
    score: option.score,
    method: "rules",
    confidence: 1,
    reason: "患者通过按钮直接选择",
  };
}

/**
 * 提交患者回答：归一化 → 状态机决策 → 事务落库（患者轮次 + 答案 + 下一题提问轮次）。
 * 归一化含网络调用，放在事务外执行；事务内重新校验状态防并发错位。
 */
export async function submitPatientAnswer(
  sessionId: string,
  input: SubmitAnswerInput
): Promise<SubmitAnswerResult> {
  // 第一步（事务外）：校验当前应答题目，并完成归一化（可能调用 DeepSeek）
  const preview = await loadContext(prisma, sessionId);
  if (preview.session.status !== "in_progress") {
    throw new DialogueConflictError("当前会话不在采集中，无法作答");
  }
  const previewStep = nextStep(preview.questions, preview.snapshot);
  if (previewStep.kind !== "awaiting" || previewStep.item.question.id !== input.questionId) {
    throw new DialogueConflictError("提交的题目与当前问询进度不符，请刷新患者端");
  }
  const item = previewStep.item;

  const utterance = (input.utterance ?? "").trim();
  if (input.mode !== "button" && utterance.length === 0) {
    throw new DialogueConflictError("回答内容为空");
  }
  const outcome =
    input.mode === "button"
      ? buttonOutcome(item, input.score)
      : await normalizeAnswer({
          question: item.question,
          options: item.options,
          utterance,
          patientCode: preview.session.patientCode,
        });

  // 第二步（事务内）：重新校验进度未变化后落库
  return prisma.$transaction(async (tx) => {
    const context = await loadContext(tx, sessionId);
    if (context.session.status !== "in_progress") {
      throw new DialogueConflictError("当前会话不在采集中，无法作答");
    }
    const step = nextStep(context.questions, context.snapshot);
    if (
      step.kind !== "awaiting" ||
      step.item.question.id !== input.questionId ||
      step.attempt !== previewStep.attempt
    ) {
      throw new DialogueConflictError("问询进度已变化，请刷新患者端");
    }

    // 1. 患者回答轮次（原始转写/文字/按钮选择全部留痕，语音附录音路径）
    const turnText =
      input.mode === "button"
        ? `[按钮作答] ${outcome.status === "matched" ? outcome.optionLabel : ""}`
        : utterance;
    await tx.dialogueTurn.create({
      data: {
        sessionId,
        role: "patient",
        questionId: input.questionId,
        text: turnText,
        audioPath: input.audioPath ?? null,
        asrRaw: (input.asrRaw ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    bumpCount(context.snapshot.patientReplyCount, input.questionId);

    // 2. 按状态机决定答案落库动作
    const resolution = resolveReply(step.attempt, outcome);
    if (resolution.action !== "clarify") {
      const nextAnswerStatus =
        resolution.action === "confirm"
          ? "confirmed"
          : resolution.action === "markPending"
            ? "pending"
            : "manual";
      await persistAnswer(tx, sessionId, input, outcome, nextAnswerStatus, utterance);
      (context.snapshot.answerStatus as Map<string, AnswerStatus>).set(input.questionId, nextAnswerStatus);
    }

    // 3. 推进流程：追问/下一题/轮末复问 → 写 doctor 轮次；全部完成 → 写结束语并自动生成报告
    const speak: string[] = [];
    const following = nextStep(context.questions, context.snapshot);
    const scaleNames = scaleNamesOf(context);
    const resolutionDto =
      resolution.action === "confirm"
        ? ({ action: "confirm", optionLabel: resolution.optionLabel } as const)
        : ({ action: resolution.action } as const);

    if (following.kind === "prompt") {
      await tx.dialogueTurn.create({
        data: {
          sessionId,
          role: "doctor",
          questionId: following.prompt.item.question.id,
          text: following.prompt.text,
        },
      });
      bumpCount(context.snapshot.doctorAskCount, following.prompt.item.question.id);
      speak.push(following.prompt.text);
      return { resolution: resolutionDto, state: buildState(context, scaleNames, speak) };
    }
    if (following.kind === "finished") {
      await tx.dialogueTurn.create({
        data: { sessionId, role: "doctor", questionId: null, text: CLOSING_TEXT },
      });
      speak.push(CLOSING_TEXT);
      const outcome = await tryAutoFinalize(tx, sessionId);
      if (outcome.kind === "completed") {
        return { resolution: resolutionDto, state: reportReadyState(context, scaleNames, speak) };
      }
      return { resolution: resolutionDto, state: buildState(context, scaleNames, speak) };
    }
    throw new Error("状态机不变量被打破：刚提交回答后不应处于 awaiting");
  });
}

/** 写入/更新答案行；已有记录（如 pending → manual/confirmed）时按审计规范留痕 */
async function persistAnswer(
  tx: Tx,
  sessionId: string,
  input: SubmitAnswerInput,
  outcome: NormalizationOutcome,
  status: "confirmed" | "pending" | "manual",
  utterance: string
): Promise<void> {
  const next: AnswerSnapshot = {
    optionLabel: outcome.status === "matched" ? outcome.optionLabel : null,
    score: outcome.status === "matched" ? outcome.score : null,
    rawText: input.mode === "button" ? null : utterance,
    source: input.mode,
    status,
  };
  const aiJudgment = {
    method: outcome.method,
    status: outcome.status,
    confidence: outcome.status === "matched" ? outcome.confidence : null,
    reason: outcome.reason,
  } as Prisma.InputJsonValue;

  const existing = await tx.answer.findUnique({
    where: { sessionId_questionId: { sessionId, questionId: input.questionId } },
  });
  if (!existing) {
    await tx.answer.create({
      data: { sessionId, questionId: input.questionId, ...next, aiJudgment },
    });
    return;
  }
  const previous: AnswerSnapshot = {
    optionLabel: existing.optionLabel,
    score: existing.score,
    rawText: existing.rawText,
    source: existing.source,
    status: existing.status,
  };
  const editHistory = appendAnswerEditHistory(existing.editHistory, previous, next, {
    at: new Date().toISOString(),
    operator: "system", // 对话系统按追问规则迁移状态（如 待确认 → 待人工确认）
    reason: status === "manual" ? "轮末复问仍未答清，转待人工确认" : "患者复问后作答，更新答案",
  });
  await tx.answer.update({
    where: { id: existing.id },
    data: { ...next, aiJudgment, editHistory: editHistory as unknown as Prisma.InputJsonValue },
  });
}
