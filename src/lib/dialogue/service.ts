/**
 * INPUT:  Prisma（会话/轮次/答案）、追问状态机、归一化编排、话术模板、能力开关
 * OUTPUT: getPatientDialogueState / startPatientDialogue / submitPatientAnswer
 * POS:    患者端问询的服务端编排层：加载快照 → 状态机决策 → 落库（DialogueTurn/Answer）→ 返回 DTO。
 *         不实现任何医学规则；评分仍由医生端 finalize 时调用评分引擎完成。
 *         2026-11-10：画图题交卷接视觉模型看图判定（drawing-judge.ts），判定在事务外完成。
 *         2026-11-11：连减题判定前读取上一步原始回答，供相对计分换算参考答案（国标注 4）。
 */
import { prisma } from "@/lib/db";
import {
  displayOptionLabel,
  questionById,
  scaleById,
  type CollectionRole,
  type InteractionMode,
  type JudgmentMode,
} from "@/lib/rules";
import type { Prisma } from "@/generated/prisma/client";
import { appendAnswerEditHistory, type AnswerSnapshot } from "@/lib/assessment/audit";
import { acquireFinalizingLock, scoreAndSnapshot, type FinalizeOutcome } from "@/lib/assessment/finalize";
import { syncReuseAnswers } from "@/lib/assessment/system-answers";
import { voiceCapabilities, type VoiceCapabilities } from "@/lib/providers/capabilities";
import { normalizeAnswer, type NormalizationOutcome } from "./normalize";
import { judgeWordRecall, type WordRecallOutcome } from "./judge";
import { judgeDrawing, validateDrawing } from "./drawing-judge";
import {
  FREE_ANSWER_ITEMS,
  displayTextOverride,
  polarOptionsOf,
  wordRecallGroupByTrigger,
  type WordRecallGroup,
} from "./cognitive-flow";
import { CLOSING_TEXT, OPENING_TEXT, clarifyText, recheckText } from "./prompts";
import {
  askableQuestions,
  askText,
  buildTimeline,
  computeLadderSkips,
  matchButtonOption,
  nextStep,
  progressOf,
  resolveReply,
  scoringOptionsOf,
  type AnswerStatus,
  type AskableQuestion,
  type AskAttempt,
  type DialogueSnapshot,
  type DialogueStep,
  type NarrationPresentation,
  type TimelineStep,
} from "./state-machine";
import type { NarrationV2 } from "@/lib/rules/v2";

// ---------- DTO（患者端大屏消费的全部数据） ----------

export interface PatientPromptDto {
  questionId: string;
  kind: "ask" | "clarify" | "recheck";
  attempt: AskAttempt;
  /** 播报/字幕文案（预生成模板拼装） */
  text: string;
  /**
   * 屏幕展示文案（2026-09-04 修改意见 6：MMSE 复述题目标句"瑞雪兆丰年"只播报不上屏）。
   * 缺省时前端展示 text 本身。
   */
  displayText?: string;
  answerType: "boolean" | "choice" | "likert5" | "number" | "multiChoice" | "imageChoice" | "drawing" | "freeText" | "acknowledge";
  /** free = 自由回答题（认知题改版）：前端不渲染选项按钮，只给语音/文字作答入口 */
  responseMode?: "free";
  /**
   * label 为提交/匹配/评分用的原始选项 label（含评分注解，不得改动）；
   * displayLabel 为患者端按钮展示文案（2026-09-04 修改意见 1：剥除评分与流程备注）。
   */
  options: { label: string; displayLabel: string; score: number }[];
  /** number 题合法分值范围 */
  numberMin?: number;
  numberMax?: number;
  /** 题目配图：imageChoice 参照图、看图识物的物品图、临摹题的参照图 */
  imageSrc?: string;
  /** 画图题画板上方的作答提示 */
  drawingHint?: string;
  scaleName: string;
  questionNo: string;
  title: string;
  collectionRole: CollectionRole;
  interactionMode: InteractionMode;
  isScored: boolean;
  inTimeline: boolean;
  judgmentMode: JudgmentMode;
}

/** 采集编排旁白（M9.2：总开场/分类过渡/工具说明，只播报不需作答） */
export interface PatientNarrationDto {
  /** 旁白 id（01 表行号派生，如 narr_3）；播报完成由 /advance 写 system 轮次标记 */
  id: string;
  /** 总开场 | 分类过渡 | 工具说明（来源：V2/01_评估采集规则表.xlsx 条目类型） */
  entryType: string;
  /** 播报/字幕文案（01 表预生成文本，不经 LLM） */
  text: string;
  /** 屏幕展示文案（2026-09-04 修改意见 3：记忆词指令只播报不上屏；缺省 = 与 text 同文） */
  displayText?: string;
  /** 播报语速（豆包 TTS speech_rate；缺省 = 全局默认） */
  speechRate?: number;
}

/** 患者端采集指令（如 Mini-Cog 记忆指令）：进入时间线并播报，但不生成答案。 */
export interface PatientInstructionDto {
  questionId: string;
  text: string;
  scaleName: string;
  questionNo: string;
  collectionRole: CollectionRole;
  interactionMode: InteractionMode;
  isScored: boolean;
  inTimeline: boolean;
  judgmentMode: JudgmentMode;
}

export interface PatientDialogueStateDto {
  sessionId: string;
  /**
   * not_started：尚未点击"开始"（未写任何轮次）。
   * intro：已播报讲解开场白、正在等患者口头确认"开始"，第一题尚未发出（已问候但无题目轮次）。
   * narration：正在播放采集编排旁白（M9.2 总开场/分类过渡/工具说明），只播报不需作答，
   *           播完前端自动调 /advance 推进（旁白轮次由 /advance 写入）。
   * instruction：正在播放量表采集指令（如 Mini-Cog 记忆词），与旁白一样留痕并自动推进。
   * in_question：问询进行中。
   * awaiting_doctor：兜底状态（2026-08-13 起患者自助一律出报告，正常流程不再进入此态；
   *           仅评分异常等意外情况可能出现），提示请医生协助。
   * finished：本次提交刚好完成评分并生成报告——仅作为触发前端跳转去看报告的一次性信号，不会被 GET /state 重复返回。
   * locked：会话已不在 in_progress（通常因为报告已生成，应改为渲染报告页；此值仅作兜底）。
   */
  phase:
    | "not_started"
    | "intro"
    | "narration"
    | "instruction"
    | "in_question"
    | "awaiting_doctor"
    | "finished"
    | "locked";
  scaleNames: string[];
  capabilities: VoiceCapabilities;
  progress: { answered: number; total: number };
  /** 当前待回答的题目；仅 in_question 阶段非 null */
  prompt: PatientPromptDto | null;
  /** 当前待播报的旁白；仅 narration 阶段非 null */
  narration: PatientNarrationDto | null;
  /** 当前待播报的采集指令；仅 instruction 阶段非 null */
  instruction: PatientInstructionDto | null;
  /** 本次需要依序播报的文案（开场白/旁白/下一题/结束语）；刷新时为当前题或当前旁白的重播文案 */
  speak: string[];
}

export interface SubmitAnswerInput {
  questionId: string;
  /**
   * 输入模式：
   * voice/text/button 既有；multi=多选；drawing=画图交卷（视觉模型看图判定计分，临界由复核定分；不可用时落 pending 等医生计分）；
   * acknowledge=完成操作确认（不自评分）
   */
  mode: "voice" | "text" | "button" | "multi" | "drawing" | "acknowledge";
  /** voice/text 模式的原始回答文本（语音为 ASR 转写） */
  utterance?: string;
  /** button 模式点选的选项 label（完整字符串，按 label 精确匹配选项，同分选项不歧义） */
  label?: string;
  /** button 模式的选项分值（仅 number 题数字面板走此路径；choice/imageChoice 一律传 label） */
  score?: number;
  /** multi 模式选中的选项 label 列表 */
  labels?: string[];
  /** drawing 模式：画布 PNG data URL（存 rawText 供追溯；判定见 drawing-judge.ts） */
  drawingDataUrl?: string;
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
  session: { id: string; status: string; scaleIds: string[]; patientCode: string; patientName: string };
  questions: AskableQuestion[];
  /** 采集编排时间线（M9.2：旁白 + 题目按 01 表顺序交错） */
  timeline: TimelineStep[];
  snapshot: DialogueSnapshot;
  /** 已确认答案的 label（questionId → optionLabel），供阶梯跳题在答案落库后即时重算 */
  confirmedLabelById: Map<string, string | null>;
  started: boolean;
}

type Tx = Prisma.TransactionClient;

async function loadContext(tx: Tx, sessionId: string): Promise<LoadedContext> {
  const session = await tx.assessmentSession.findUnique({
    where: { id: sessionId },
    include: {
      patient: { select: { code: true, name: true } },
      answers: { select: { questionId: true, status: true, optionLabel: true } },
      turns: { select: { role: true, questionId: true } },
    },
  });
  if (!session) throw new DialogueConflictError("评估会话不存在");

  const scaleIds = session.scaleIds as string[];
  const questions = askableQuestions(scaleIds);
  const timeline = buildTimeline(scaleIds);

  const answerStatus = new Map<string, AnswerStatus>();
  const confirmedLabelById = new Map<string, string | null>();
  for (const answer of session.answers) {
    // superseded 是分支切换后的历史答案，不参与当前问询判断
    if (answer.status === "superseded") continue;
    answerStatus.set(answer.questionId, answer.status as AnswerStatus);
    if (answer.status === "confirmed") confirmedLabelById.set(answer.questionId, answer.optionLabel);
  }
  const doctorAskCount = new Map<string, number>();
  const patientReplyCount = new Map<string, number>();
  const deliveredNarrationIds = new Set<string>();
  const deliveredInstructionIds = new Set<string>();
  const narrationIds = new Set(
    timeline
      .filter((step): step is Extract<TimelineStep, { kind: "narration" }> => step.kind === "narration")
      .map((step) => step.narration.id)
  );
  const instructionIds = new Set(
    timeline
      .filter((step): step is Extract<TimelineStep, { kind: "instruction" }> => step.kind === "instruction")
      .map((step) => step.item.question.id)
  );
  for (const turn of session.turns) {
    if (!turn.questionId) continue;
    if (turn.role === "doctor") {
      doctorAskCount.set(turn.questionId, (doctorAskCount.get(turn.questionId) ?? 0) + 1);
    } else if (turn.role === "patient") {
      patientReplyCount.set(turn.questionId, (patientReplyCount.get(turn.questionId) ?? 0) + 1);
    } else if (turn.role === "system") {
      // 旁白/采集指令均用 system 轮次留痕；按当前时间线区分，兼容既有旁白记录。
      if (narrationIds.has(turn.questionId)) deliveredNarrationIds.add(turn.questionId);
      if (instructionIds.has(turn.questionId)) deliveredInstructionIds.add(turn.questionId);
      // 保留旧版 Mini-Cog 已播放记录，避免升级时对进行中的评估再次播报记忆词。
      if (turn.questionId === "minicog_1" && narrationIds.has("instr_minicog_words")) {
        deliveredNarrationIds.add("instr_minicog_words");
      }
    }
  }

  return {
    session: {
      id: session.id,
      status: session.status,
      scaleIds,
      patientCode: session.patient.code,
      // 档案姓名仅用于归一化出网前的值级替换脱敏（硬约束 1），本身不出网
      patientName: session.patient.name,
    },
    questions,
    timeline,
    snapshot: {
      answerStatus,
      doctorAskCount,
      patientReplyCount,
      deliveredNarrationIds,
      deliveredInstructionIds,
      // 阶梯跳题（视力/听力"可以（结束）"）：由已确认答案派生，见 state-machine.computeLadderSkips
      skippedQuestionIds: computeLadderSkips(scaleIds, confirmedLabelById),
    },
    confirmedLabelById,
    started: session.turns.some((turn) => turn.role === "doctor"),
  };
}

function promptDto(step: DialogueStep): PatientPromptDto | null {
  if (step.kind === "finished" || step.kind === "narration" || step.kind === "instruction") return null;
  // awaiting 时按 attempt 重建话术：模板是确定性的，与写入 turns 的播报文本一致
  const item = step.kind === "prompt" ? step.prompt.item : step.item;
  const attempt = step.kind === "prompt" ? step.prompt.attempt : step.attempt;
  const kind = attempt === 1 ? "ask" : attempt === 2 ? "clarify" : "recheck";
  const text =
    attempt === 1
      ? askText(item.question)
      : attempt === 2
        ? clarifyText(item.question, item.options)
        : recheckText(item.question);
  const answerType =
    item.question.responseMode === "free" || item.question.patientResponseMode === "free_text"
      ? "freeText"
      : item.question.patientResponseMode === "acknowledge"
        ? "acknowledge"
        : item.question.answerType;
  return {
    questionId: item.question.id,
    kind,
    attempt,
    text,
    // 展示文案覆盖（mmse_24 复述目标句不上屏，2026-09-04 修改意见 6）；追问/复问展示同一干净题面
    displayText: displayTextOverride(item.question.id) ?? undefined,
    answerType,
    responseMode: item.question.responseMode,
    // 展示用 displayLabel（剥除评分/备注）与提交用原始 label 并行下发，匹配/评分链路不动
    options: (answerType === "freeText" ? [] : item.options).map((option) => ({
      label: option.label,
      displayLabel: displayOptionLabel(option.label),
      score: option.score,
    })),
    numberMin: item.question.numberMin,
    numberMax: item.question.numberMax,
    imageSrc: item.question.imageSrc,
    drawingHint: item.question.drawingHint,
    scaleName: item.scaleName,
    questionNo: item.question.no,
    title: item.question.title,
    collectionRole: item.question.collectionRole,
    interactionMode: item.question.interactionMode,
    isScored: item.question.isScored,
    inTimeline: item.question.inTimeline,
    judgmentMode: item.question.judgmentMode,
  };
}

function narrationDto(narration: NarrationV2 & NarrationPresentation): PatientNarrationDto {
  return {
    id: narration.id,
    entryType: narration.entryType,
    text: narration.text,
    displayText: narration.displayText,
    speechRate: narration.speechRate,
  };
}

function instructionDto(item: AskableQuestion): PatientInstructionDto {
  return {
    questionId: item.question.id,
    text: item.question.standardText,
    scaleName: item.scaleName,
    questionNo: item.question.no,
    collectionRole: item.question.collectionRole,
    interactionMode: item.question.interactionMode,
    isScored: item.question.isScored,
    inTimeline: item.question.inTimeline,
    judgmentMode: item.question.judgmentMode,
  };
}

/**
 * 旁白阶段的显式状态构造：用于 begin/advance 等"刚决定播这条旁白"的返回。
 * 不能走 buildState —— 首条旁白播报前既无题目轮次也无旁白轮次，
 * buildState 的 intro 判定（讲解确认阶段）会把它吞掉；GET /state 刷新重放仍走 buildState。
 */
function narrationState(
  context: LoadedContext,
  scaleNames: string[],
  narration: NarrationV2 & NarrationPresentation
): PatientDialogueStateDto {
  return {
    sessionId: context.session.id,
    phase: "narration",
    scaleNames,
    capabilities: voiceCapabilities(),
    progress: progressOf(context.questions, context.snapshot, context.timeline),
    prompt: null,
    narration: narrationDto(narration),
    instruction: null,
    speak: [narration.text],
  };
}

function instructionState(
  context: LoadedContext,
  scaleNames: string[],
  item: AskableQuestion
): PatientDialogueStateDto {
  return {
    sessionId: context.session.id,
    phase: "instruction",
    scaleNames,
    capabilities: voiceCapabilities(),
    progress: progressOf(context.questions, context.snapshot),
    prompt: null,
    narration: null,
    instruction: instructionDto(item),
    speak: [item.question.standardText],
  };
}

function buildState(
  context: LoadedContext,
  scaleNames: string[],
  speak: string[]
): PatientDialogueStateDto {
  const capabilities = voiceCapabilities();
  const progress = progressOf(context.questions, context.snapshot, context.timeline);
  const base = { sessionId: context.session.id, scaleNames, capabilities, progress };
  if (context.session.status !== "in_progress") {
    return { ...base, phase: "locked", prompt: null, narration: null, instruction: null, speak: [] };
  }
  if (!context.started) {
    return { ...base, phase: "not_started", prompt: null, narration: null, instruction: null, speak: [] };
  }
  const step = nextStep(context.timeline, context.snapshot);
  // 已问候但还没发出任何题目、也没播任何旁白（无带 questionId 的 doctor/system 轮次）＝讲解+确认阶段：
  // 数字医生已播讲解开场白，正在等患者说"开始"，总开场旁白与第一题待 beginPatientQuestions 才推进。
  // 仅当确实还有内容可播（step 非 finished）时才停在 intro；若医生已代填全部（finished）则照常收尾。
  const questionsBegun = context.snapshot.doctorAskCount.size > 0;
  const narrationsBegun = context.snapshot.deliveredNarrationIds.size > 0;
  const instructionsBegun = (context.snapshot.deliveredInstructionIds?.size ?? 0) > 0;
  if (!questionsBegun && !narrationsBegun && !instructionsBegun && step.kind !== "finished") {
    return { ...base, phase: "intro", prompt: null, narration: null, instruction: null, speak };
  }
  if (step.kind === "narration") {
    // 旁白步骤：只播报不需作答；system 轮次由 /advance 在播报完成后写入
    return {
      ...base,
      phase: "narration",
      prompt: null,
      narration: narrationDto(step.narration),
      instruction: null,
      speak,
    };
  }
  if (step.kind === "instruction") {
    return {
      ...base,
      phase: "instruction",
      prompt: null,
      narration: null,
      instruction: instructionDto(step.item),
      speak,
    };
  }
  if (step.kind === "finished") {
    // 到达这里时 session 仍是 in_progress：问答已问完但评分未成功落库。
    // 2026-08-13 起 deferClinical 全豁免，正常流程不会到这里；仅评分异常等意外情况兜底。
    return { ...base, phase: "awaiting_doctor", prompt: null, narration: null, instruction: null, speak };
  }
  return { ...base, phase: "in_question", prompt: promptDto(step), narration: null, instruction: null, speak };
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
    progress: progressOf(context.questions, context.snapshot, context.timeline),
    prompt: null,
    narration: null,
    instruction: null,
    speak,
  };
}

/** 刷新/幂等重入时的重播文案：intro 重播讲解、narration 重播旁白、in_question 重播当前题 */
function withReplaySpeak(state: PatientDialogueStateDto): PatientDialogueStateDto {
  if (state.phase === "intro") return { ...state, speak: [OPENING_TEXT] };
  if (state.phase === "narration" && state.narration) return { ...state, speak: [state.narration.text] };
  if (state.phase === "instruction" && state.instruction) return { ...state, speak: [state.instruction.text] };
  if (state.phase === "in_question" && state.prompt) return { ...state, speak: [state.prompt.text] };
  return state;
}

/**
 * 患者问答已全部完成（state machine 判定 finished）时尝试自动生成评估报告。
 * 用户已确认的产品口径：评估内容是确定性计算，问答完成即应生成报告，
 * 不需要医生先审核评估结果——干预方案候选医生仍可另行审核调整，互不阻塞。
 * Demo 口径（2026-08-13 用户拍板，覆盖 2026-07-20 版）：患者自助答完**一律出报告**——
 * 任何缺失条目（医生检查题、答不清转"待人工确认"的普通问答题）都按 deferClinical
 * 豁免计分，报告标注"部分计分"；医生后续补录仍可在医生端重算更新。
 */
async function tryAutoFinalize(tx: Tx, sessionId: string): Promise<FinalizeOutcome> {
  await acquireFinalizingLock(tx, sessionId);
  return scoreAndSnapshot(tx, sessionId, { deferClinical: true });
}

/**
 * M9.3/M9.4 跨量表复用回填（01 表复用规则，当前为焦虑两问 ↔ GAD-7）：
 * 按当前已确认答案重算并落库系统回填（source=system），结果同步进对话快照——
 * 回填到位的题状态机随即视为已答跳过（"回填即跳过"）；复用条件不再成立
 * （如医生改答源题）时旧回填撤回为 superseded，该题恢复待问。
 * 在患者答案确认后与 begin/advance 推进时调用；评分前 finalize 会再兜底同步一次。
 */
async function applyReuseAnswers(tx: Tx, context: LoadedContext): Promise<void> {
  const { filled, retracted } = await syncReuseAnswers(tx, context.session.id, context.session.scaleIds);
  if (filled.length === 0 && retracted.length === 0) return;
  const answerStatus = context.snapshot.answerStatus as Map<string, AnswerStatus>;
  for (const questionId of filled) answerStatus.set(questionId, "confirmed");
  for (const questionId of retracted) answerStatus.delete(questionId);
}

function scaleNamesOf(context: LoadedContext): string[] {
  return context.session.scaleIds.map((scaleId) => scaleById.get(scaleId)?.name ?? scaleId);
}

// ---------- 对外服务 ----------

/** 查询当前问询状态（只读，不写任何轮次）。刷新页面时重建当前题/当前旁白的播报文案 */
export async function getPatientDialogueState(sessionId: string): Promise<PatientDialogueStateDto> {
  const context = await loadContext(prisma, sessionId);
  const scaleNames = scaleNamesOf(context);
  // 刷新场景：intro 重播讲解、narration 重播旁白、in_question 重播当前题，供患者端"重听一遍"
  return withReplaySpeak(buildState(context, scaleNames, []));
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
      return withReplaySpeak(buildState(context, scaleNames, []));
    }

    await tx.dialogueTurn.create({
      data: { sessionId, role: "doctor", questionId: null, text: OPENING_TEXT },
    });
    const step = nextStep(context.timeline, context.snapshot);
    if (step.kind === "prompt" || step.kind === "narration" || step.kind === "instruction") {
      // 讲解播完进入 intro：不写旁白/第一题轮次，等患者确认后由 beginPatientQuestions 推进。
      // M9.2 取舍：OPENING_TEXT 保留作"征求开始"的确认触发器（含"说一声开始"指令与 VAD 确认监听）；
      // 01 表总开场旁白 narr_3 已于 2026-09-13 编排层删除（prompts.NARRATION_SUPPRESSED_IDS），
      // 确认后直接进各量表的分类过渡/专题过渡句。
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
    // M9.3/M9.4：推进前同步复用回填（覆盖医生预先代填焦虑两问等场景），回填题随即跳过
    await applyReuseAnswers(tx, context);
    // 已经在答题或旁白链中（有题目/旁白轮次）→ 幂等返回当前状态
    if (
      context.snapshot.doctorAskCount.size > 0 ||
      context.snapshot.deliveredNarrationIds.size > 0 ||
      (context.snapshot.deliveredInstructionIds?.size ?? 0) > 0
    ) {
      return withReplaySpeak(buildState(context, scaleNames, []));
    }
    const step = nextStep(context.timeline, context.snapshot);
    if (step.kind === "narration") {
      // 确认后先播编排旁白（分类过渡/专题过渡句）：不写轮次（旁白轮次由 /advance 在播报完成后写入），
      // 前端播完自动调 /advance 推进到下一旁白或第一题。
      // 注意必须走 narrationState 直构：首条旁白前无任何题目/旁白轮次，buildState 会误判回 intro。
      return narrationState(context, scaleNames, step.narration);
    }
    if (step.kind === "instruction") {
      // Mini-Cog 记忆指令等不生成答案，但必须作为患者时间线步骤播报/展示。
      return instructionState(context, scaleNames, step.item);
    }
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

/**
 * 旁白播报完成后的推进（M9.2，幂等）：前端播完当前旁白后调用。
 * 当前步骤不是旁白（已推进过/状态漂移）→ 直接返回当前状态（幂等重放安全）；
 * 是旁白 → 写 role=system、questionId=旁白 id 的轮次标记"已播报"，再推进到下一步：
 * 下一旁白（不写轮次，等再次 /advance）/ 下一题（写 doctor 轮次）/ 全部完成（结束语 + 自动生成报告）。
 * 旁白轮次只在本函数写入，保证一条旁白恰好落库一次。
 */
export async function advancePatientNarration(
  sessionId: string,
  expectedStepId: string
): Promise<PatientDialogueStateDto> {
  return prisma.$transaction(async (tx) => {
    const context = await loadContext(tx, sessionId);
    if (context.session.status !== "in_progress") {
      throw new DialogueConflictError("当前会话不在采集中，无法推进");
    }
    const scaleNames = scaleNamesOf(context);
    if (!context.started) {
      throw new DialogueConflictError("问询尚未开始，请先开始评估");
    }
    // M9.3/M9.4：推进前同步复用回填（旁白推进也可能紧接被回填跳过的题目）
    await applyReuseAnswers(tx, context);
    const step = nextStep(context.timeline, context.snapshot);
    if (step.kind !== "narration" && step.kind !== "instruction") {
      // 旁白已推进过（如前端重复调用/刷新后重放）：幂等返回当前状态
      return withReplaySpeak(buildState(context, scaleNames, []));
    }

    // 标记当前旁白已播报（system 轮次，刷新重放不再重复播报）
    const stepId = step.kind === "narration" ? step.narration.id : step.item.question.id;
    // 前端必须声明刚刚实际播完的步骤。旧播放链、重复点击或跨标签页请求即使晚到，
    // 也不能把服务端已经切换到的新旁白/指令误标为已播报并直接跳过。
    if (expectedStepId !== stepId) {
      throw new DialogueConflictError("当前播报步骤已变化，请按页面提示继续");
    }
    const stepText = step.kind === "narration" ? step.narration.text : step.item.question.standardText;
    await tx.dialogueTurn.create({
      data: { sessionId, role: "system", questionId: stepId, text: stepText },
    });
    if (step.kind === "narration") {
      (context.snapshot.deliveredNarrationIds as Set<string>).add(stepId);
    } else {
      (context.snapshot.deliveredInstructionIds as Set<string>).add(stepId);
    }

    const following = nextStep(context.timeline, context.snapshot);
    if (following.kind === "narration") {
      return buildState(context, scaleNames, [following.narration.text]);
    }
    if (following.kind === "instruction") {
      return buildState(context, scaleNames, [following.item.question.standardText]);
    }
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
      return buildState(context, scaleNames, [following.prompt.text]);
    }
    if (following.kind === "finished") {
      // 旁白之后无题可问（如末位量表只有医生代答题）：直接收尾并尝试自动生成报告
      await tx.dialogueTurn.create({
        data: { sessionId, role: "doctor", questionId: null, text: CLOSING_TEXT },
      });
      const outcome = await tryAutoFinalize(tx, sessionId);
      if (outcome.kind === "completed") {
        return reportReadyState(context, scaleNames, [CLOSING_TEXT]);
      }
      return buildState(context, scaleNames, [CLOSING_TEXT]);
    }
    // 升级前已发出的问题可能位于新旁白之后，继续等待原题作答，不重复写提问轮次。
    const state = buildState(context, scaleNames, []);
    return state.prompt ? { ...state, speak: [state.prompt.text] } : state;
  });
}

/** 按钮作答直接按选项确认（确定性输入，无需归一化）；label 优先、分值兜底，见 matchButtonOption */
function buttonOutcome(
  item: AskableQuestion,
  label: string | undefined,
  score: number | undefined
): NormalizationOutcome {
  const option = matchButtonOption(item, label, score);
  if (!option) {
    throw new DialogueConflictError("按钮选项无效：未命中题目选项");
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

/** 多选：label 列表须全部为合法选项；拼接存盘（M9.6 MULTI_CHOICE_SEP） */
function multiOutcome(item: AskableQuestion, labels: string[] | undefined): NormalizationOutcome {
  const selected = [...new Set((labels ?? []).map((l) => l.trim()).filter(Boolean))];
  if (selected.length === 0) throw new DialogueConflictError("请至少选择一个选项");
  const allowed = new Set(item.options.map((o) => o.label));
  for (const lab of selected) {
    if (!allowed.has(lab)) throw new DialogueConflictError(`选项无效：${lab}`);
  }
  // 「从不漏尿」与其它漏尿情形互斥：若同时勾选，以漏尿情形为准剔掉从不
  const never = "从不漏尿";
  const filtered =
    selected.includes(never) && selected.length > 1 ? selected.filter((l) => l !== never) : selected;
  return {
    status: "matched",
    optionLabel: filtered.join(" || "),
    score: 0,
    method: "rules",
    confidence: 1,
    reason: "患者多选作答",
  };
}

/**
 * 画图题交卷（M9.6 画钟；2026-11-10 起接视觉模型看图判定）：
 * 模型给出对/错 → 映射到标准选项直接计分（医生事后可改判）；
 * 规则拿不准 → 临界复核由模型定分（2026-11-11 用户拍板：画图不再等医生确认，见 drawing-judge.ts）；
 * 未配置/调用失败/复核失败 → unclear，落 pending 等医生确认计分（原口径兜底）。
 */
async function drawingOutcome(
  item: AskableQuestion,
  drawingDataUrl: string | undefined
): Promise<NormalizationOutcome> {
  const invalidReason = validateDrawing(drawingDataUrl);
  if (invalidReason || !drawingDataUrl) throw new DialogueConflictError(invalidReason ?? "画作数据无效");
  // 用标准选项而非 item.options：画图题属医护判定题，患者端可见选项为空（见 scoringOptionsOf）
  return judgeDrawing(item.question.id, scoringOptionsOf(item), drawingDataUrl);
}

/**
 * 连减相对计分（2026-11-11，国标 WS/T 484 注 4）需要上一步的患者原始回答；非连减题或无上一步回答返回 null。
 * 原文只在本地换算参考答案，送 DeepSeek 的只有换算后的数字。
 */
async function previousSerialAnswerText(sessionId: string, questionId: string): Promise<string | null> {
  const spec = FREE_ANSWER_ITEMS.get(questionId);
  if (spec?.kind !== "serialSubtraction" || spec.previousItemId === null) return null;
  const previous = await prisma.answer.findUnique({
    where: { sessionId_questionId: { sessionId, questionId: spec.previousItemId } },
    select: { rawText: true, status: true },
  });
  // superseded 是分支切换后的历史答案，不作依据
  return previous && previous.status !== "superseded" ? previous.rawText : null;
}

/**
 * 医护判定题只保存患者原话/完成动作，不做选项归一化。
 * 来源：AGENTS.md 硬约束 2、3；MMSE 等题缺少可由患者自评的机构标准答案时必须留给医护。
 */
function clinicalPendingOutcome(item: AskableQuestion, input: SubmitAnswerInput): NormalizationOutcome {
  if (item.question.patientResponseMode === "acknowledge" && input.mode !== "acknowledge") {
    throw new DialogueConflictError("该操作只接受完成确认，不能自行选择正确或错误");
  }
  if (item.question.patientResponseMode === "free_text" && !["voice", "text"].includes(input.mode)) {
    throw new DialogueConflictError("该题请直接说出或输入您的回答，由医护判定");
  }
  return {
    status: "unclear",
    method: "clinical",
    reason:
      item.question.judgmentMode === "configuration_missing"
        ? "题目缺少机构标准答案或判定配置，已记录原始响应，需医护判定"
        : "患者响应已记录，正确性由医护依据机构标准判定",
  };
}

/** 非计分开放题只采集原始文本并确认已记录，不调用 LLM、也不形成医学分值。 */
function unscoredRawOutcome(utterance: string): NormalizationOutcome {
  if (!utterance) throw new DialogueConflictError("回答内容为空");
  return {
    status: "matched",
    optionLabel: "已记录（不计分）",
    score: 0,
    method: "rules",
    confidence: 1,
    reason: "非计分开放题仅保存患者原始回答",
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
  const previewStep = nextStep(preview.timeline, preview.snapshot);
  // A2 复用回填撤回后的重新提问：提问轮次可能尚未落库（患者经 GET /state 看到题目后直接作答），
  // 允许 prompt 形态通过预检，提问轮次在事务内补写
  const previewItem =
    previewStep.kind === "awaiting"
      ? previewStep.item
      : previewStep.kind === "prompt"
        ? previewStep.prompt.item
        : null;
  const previewAttempt =
    previewStep.kind === "awaiting"
      ? previewStep.attempt
      : previewStep.kind === "prompt"
        ? previewStep.prompt.attempt
        : null;
  if (previewItem === null || previewItem.question.id !== input.questionId) {
    throw new DialogueConflictError("提交的题目与当前问询进度不符，请刷新患者端");
  }
  const item = previewItem;

  const utterance = (input.utterance ?? "").trim();
  if (input.mode === "voice" || input.mode === "text") {
    if (utterance.length === 0) throw new DialogueConflictError("回答内容为空");
  }
  // 认知题改版（2026-08-13）：自由回答题与词复述组只接受语音/文字作答（选项不向患者展示）
  const group = wordRecallGroupByTrigger.get(input.questionId);
  if ((group || FREE_ANSWER_ITEMS.has(input.questionId)) && input.mode !== "voice" && input.mode !== "text") {
    throw new DialogueConflictError("该题目只支持语音或文字作答");
  }
  // 词复述组：一次复述由 LLM（规则兜底）识别命中词，组内各题逐一落分（事务内 persistGroupAnswers）
  let groupVerdict: WordRecallOutcome | null = null;
  let outcome: NormalizationOutcome;
  if (group) {
    groupVerdict = await judgeWordRecall(
      group.words,
      utterance,
      preview.session.patientCode,
      preview.session.patientName
    );
    outcome =
      groupVerdict.status === "matched"
        ? {
            status: "matched",
            optionLabel: `复述命中 ${groupVerdict.matchedWords.length} 个词`,
            score: groupVerdict.matchedWords.length,
            method: groupVerdict.method,
            confidence: groupVerdict.confidence ?? 1,
            reason: groupVerdict.reason,
          }
        : { status: "unclear", method: groupVerdict.method, reason: groupVerdict.reason };
  } else {
    outcome =
      // 画图题先走视觉模型看图判定（judgmentMode 虽为 clinician，模型给出对错即可直接计分）；
      // 其余医护判定题只留原话/完成确认，不做选项归一化
      input.mode === "drawing"
        ? await drawingOutcome(item, input.drawingDataUrl)
        : item.question.judgmentMode === "not_scored" && item.question.patientResponseMode === "free_text"
          ? unscoredRawOutcome(utterance)
          : item.question.judgmentMode === "clinician" || item.question.judgmentMode === "configuration_missing"
            ? clinicalPendingOutcome(item, input)
            : input.mode === "button"
              ? buttonOutcome(item, input.label, input.score)
              : input.mode === "multi"
                ? multiOutcome(item, input.labels)
                : await normalizeAnswer({
                    question: item.question,
                    options: item.options,
                    utterance,
                    patientCode: preview.session.patientCode,
                    patientName: preview.session.patientName,
                    previousAnswerText: await previousSerialAnswerText(sessionId, input.questionId),
                  });
  }

  // 第二步（事务内）：重新校验进度未变化后落库
  return prisma.$transaction(async (tx) => {
    const context = await loadContext(tx, sessionId);
    if (context.session.status !== "in_progress") {
      throw new DialogueConflictError("当前会话不在采集中，无法作答");
    }
    const step0 = nextStep(context.timeline, context.snapshot);
    // A2：复用撤回后的重新提问（asks≥2 的 prompt）轮次尚未落库 → 先在事务内补写 doctor 轮次，
    //     再按等答（awaiting）处理；首轮首问（asks=0）不在此列，仍按进度不符拒绝
    let step = step0;
    if (
      step.kind === "prompt" &&
      step.prompt.item.question.id === input.questionId &&
      (context.snapshot.doctorAskCount.get(input.questionId) ?? 0) >= 2
    ) {
      await tx.dialogueTurn.create({
        data: {
          sessionId,
          role: "doctor",
          questionId: input.questionId,
          text: step.prompt.text,
        },
      });
      bumpCount(context.snapshot.doctorAskCount, input.questionId);
      step = nextStep(context.timeline, context.snapshot);
    }
    if (
      step.kind !== "awaiting" ||
      step.item.question.id !== input.questionId ||
      step.attempt !== previewAttempt
    ) {
      throw new DialogueConflictError("问询进度已变化，请刷新患者端");
    }

    // 1. 患者回答轮次（原始转写/文字/按钮选择全部留痕，语音附录音路径）
    const turnText =
      input.mode === "button"
        ? `[按钮作答] ${outcome.status === "matched" ? outcome.optionLabel : ""}`
        : input.mode === "multi"
          ? `[多选作答] ${outcome.status === "matched" ? outcome.optionLabel : ""}`
          : input.mode === "drawing"
            ? outcome.status === "matched"
              ? `[画图交卷] 视觉模型判定：${outcome.optionLabel}`
              : "[画图交卷] 待医生确认计分"
            : input.mode === "acknowledge"
              ? "[完成确认] 已完成操作，待医护判定"
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
    // 画图交卷不走追问：视觉模型已判定 → 直接确认计分；否则 pending 等医生确认计分（M9.6）
    const resolution =
      input.mode === "drawing"
        ? outcome.status === "matched"
          ? ({ action: "confirm", optionLabel: outcome.optionLabel } as const)
          : ({ action: "markPending" } as const)
        : input.mode === "acknowledge" ||
            item.question.judgmentMode === "clinician" ||
            item.question.judgmentMode === "configuration_missing"
          ? ({ action: "markPending" } as const)
          : resolveReply(step.attempt, outcome);
    if (resolution.action !== "clarify") {
      const nextAnswerStatus =
        resolution.action === "confirm"
          ? "confirmed"
          : resolution.action === "markPending"
            ? "pending"
            : "manual";
      if (group) {
        // 词复述组：一次回答给组内各题（mmse_11/12/13 或 mmse_19/20/21）同步落库
        await persistGroupAnswers(tx, sessionId, group, input, groupVerdict, nextAnswerStatus, utterance);
        for (const targetId of group.targetItemIds) {
          (context.snapshot.answerStatus as Map<string, AnswerStatus>).set(targetId, nextAnswerStatus);
        }
      } else {
        await persistAnswer(tx, sessionId, input.questionId, input, outcome, nextAnswerStatus, utterance);
        (context.snapshot.answerStatus as Map<string, AnswerStatus>).set(input.questionId, nextAnswerStatus);
        if (resolution.action === "confirm") {
          context.confirmedLabelById.set(input.questionId, resolution.optionLabel);
        }
      }
    }

    // 阶梯跳题即时重算（2026-08-13 修复）：快照在事务开始时装载，答完"可以（结束）"后若不重算，
    // 下面推进的 nextStep 会返回本应跳过的下一道阶梯题（患者端表现为"答了可以还继续问"）
    (context.snapshot as { skippedQuestionIds?: ReadonlySet<string> }).skippedQuestionIds =
      computeLadderSkips(context.session.scaleIds, context.confirmedLabelById);

    // 2b. M9.3/M9.4：答案确认后同步跨量表复用回填（如焦虑两问答「否」→ GAD-7 对应题回填 0 分），
    //     回填题在下面推进 nextStep 时自然跳过；非确认类落库（pending/manual）不触发新回填，调用为空操作
    await applyReuseAnswers(tx, context);

    // 3. 推进流程：追问/下一题/轮末复问 → 写 doctor 轮次；旁白 → 不写轮次等前端播完调 /advance；
    //    全部完成 → 写结束语并自动生成报告
    const speak: string[] = [];
    const following = nextStep(context.timeline, context.snapshot);
    const scaleNames = scaleNamesOf(context);
    const resolutionDto =
      resolution.action === "confirm"
        ? ({ action: "confirm", optionLabel: resolution.optionLabel } as const)
        : ({ action: resolution.action } as const);

    if (following.kind === "narration") {
      // 下一量表前的分类过渡/工具说明旁白：只播报不需作答，轮次由 /advance 写入
      speak.push(following.narration.text);
      return { resolution: resolutionDto, state: buildState(context, scaleNames, speak) };
    }
    if (following.kind === "instruction") {
      // 采集指令不写 doctor 提问轮次，完成播报后由 /advance 写 system 留痕并推进。
      speak.push(following.item.question.standardText);
      return { resolution: resolutionDto, state: buildState(context, scaleNames, speak) };
    }
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
  questionId: string,
  input: SubmitAnswerInput,
  outcome: NormalizationOutcome,
  status: "confirmed" | "pending" | "manual",
  utterance: string
): Promise<void> {
  const next: AnswerSnapshot = {
    optionLabel: outcome.status === "matched" ? outcome.optionLabel : null,
    score: outcome.status === "matched" ? outcome.score : null,
      rawText:
      input.mode === "drawing"
        ? (input.drawingDataUrl ?? null)
        : input.mode === "button" || input.mode === "multi"
          ? null
          : input.mode === "acknowledge"
            ? "患者确认已完成操作，待医护判定"
          : utterance,
    // multi/drawing 写入扩展 source 字面量（追溯界面可识别）
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
    where: { sessionId_questionId: { sessionId, questionId } },
  });
  if (!existing) {
    await tx.answer.create({
      data: { sessionId, questionId, ...next, aiJudgment },
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

/**
 * 词复述组回答落库（2026-08-13 认知题改版）：一次复述给组内每题各记一条答案——
 * 命中词 → 该题 1 分选项，未命中 → 0 分选项；rawText 均存同一段原始转写（可追溯，硬约束 4）。
 * 追问后仍不清（pending/manual）：组内各题同步落同一状态，避免目标题被当成"未问"。
 */
async function persistGroupAnswers(
  tx: Tx,
  sessionId: string,
  group: WordRecallGroup,
  input: SubmitAnswerInput,
  verdict: WordRecallOutcome | null,
  status: "confirmed" | "pending" | "manual",
  utterance: string
): Promise<void> {
  for (let i = 0; i < group.targetItemIds.length; i++) {
    const targetId = group.targetItemIds[i];
    if (status !== "confirmed" || !verdict || verdict.status !== "matched") {
      await persistAnswer(
        tx,
        sessionId,
        targetId,
        input,
        { status: "unclear", method: verdict?.method ?? "none", reason: verdict?.reason ?? "组回答未判定" },
        status,
        utterance
      );
      continue;
    }
    const word = group.words[i];
    const hit = verdict.matchedWords.includes(word);
    const polar = polarOptionsOf(targetId);
    const question = questionById.get(targetId);
    const option = question?.options?.find((o) => o.label === (hit ? polar.correct : polar.incorrect));
    const outcome: NormalizationOutcome = {
      status: "matched",
      optionLabel: hit ? polar.correct : polar.incorrect,
      score: option?.score ?? (hit ? 1 : 0),
      method: verdict.method,
      confidence: verdict.confidence ?? 1,
      reason: hit ? `复述命中「${word}」` : `未复述出「${word}」`,
    };
    await persistAnswer(tx, sessionId, targetId, input, outcome, "confirmed", utterance);
  }
}
