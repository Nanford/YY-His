/**
 * INPUT:  会话勾选的量表（src/lib/rules）、V2 旁白（src/lib/rules/v2 的 narrationsV2）、
 *         对话快照（答案状态 + 提问/回答计数 + 已播报旁白，由 turns/answers 派生）
 * OUTPUT: askableQuestions、buildTimeline、nextStep、resolveReply —— 采集编排 + 追问状态机（纯函数、无 IO）
 * POS:    数字医生问询流程的确定性核心：总开场/分类过渡/工具说明旁白按 01 表顺序播报
 *         （来源：V2/Demo_v2更新说明.docx §3「采集过程中应按照预设顺序播放开场白、分类过渡句
 *         和必要的工具说明」），题目仍走 提问 → 追问 1 次 → 待确认 →
 *         轮末换说法复问 → 待人工确认（AGENTS.md 硬约束 3）。
 *         状态完全由 DialogueTurn/Answer 派生，不引入额外持久化状态字段。
 */
import { collectionItemsOf, scaleById, type QuestionOption, type ScaleQuestion } from "@/lib/rules";
import { judgmentsV2, narrationsV2, scalesV2, type NarrationV2 } from "@/lib/rules/v2";
import {
  GROUP_NON_TRIGGER_IDS,
  instructionBeforeItem,
  spokenTextOverride,
} from "./cognitive-flow";
import { clarifyText, narrationSuppressed, narrationText, recheckText, scaleTransitionSkipped, scaleTransitionSuppressed, SCALE_TRANSITION_OVERRIDES, SCALE_TRANSITION_TEXTS } from "./prompts";
import type { NormalizationOutcome } from "./normalize-rules";

/** 患者端可问的题目（含展示所需的量表信息与选项） */
export interface AskableQuestion {
  question: ScaleQuestion;
  scaleId: string;
  scaleName: string;
  options: QuestionOption[];
}

/** 患者端可见选项；医护判定题的“正确/错误”选项永不下发。 */
export function patientOptionsOf(question: ScaleQuestion): QuestionOption[] {
  if (question.judgmentMode === "clinician" || question.judgmentMode === "configuration_missing") return [];
  return question.options ?? [];
}

/**
 * 判定/计分用的标准选项（01 表全量，含医护判定题的"正确/错误"）。只在服务端使用，不下发患者端。
 * 画图题的 judgmentMode 是 clinician，patientOptionsOf 对它返回空数组；看图判定要把结论映射回
 * 标准选项，必须取这里的全量选项——2026-11-12 修复：此前误传患者端可见选项（空），
 * judgeDrawing 找不到正确项/0 分项，不调用视觉模型就落「待医生确认计分」。
 */
export function scoringOptionsOf(item: AskableQuestion): QuestionOption[] {
  return item.question.options ?? [];
}

function collectionItem(scaleId: string, question: ScaleQuestion): AskableQuestion {
  const scale = scaleById.get(scaleId);
  if (!scale) throw new Error(`会话包含未知量表：${scaleId}`);
  return { question, scaleId, scaleName: scale.name, options: patientOptionsOf(question) };
}

/**
 * 计算患者端问询题目清单（保持量表勾选顺序与题目原始顺序）。
 * 规则：只把明确需要患者响应且已配置进时间线的条目作为 askable；
 * 旁白/记忆指令等无响应条目由 buildTimeline 单独编排，系统读取/医护条目不进入患者时间线。
 */
export function askableQuestions(scaleIds: readonly string[]): AskableQuestion[] {
  const items: AskableQuestion[] = [];
  for (const scaleId of scaleIds) {
    for (const question of collectionItemsOf(scaleId)) {
      if (!question.inTimeline || question.patientResponseMode === "none" || GROUP_NON_TRIGGER_IDS.has(question.id)) continue;
      items.push(collectionItem(scaleId, question));
    }
  }
  return items;
}

// ---------- 采集编排时间线（M9.2：总开场/分类过渡/工具说明旁白） ----------

/** 旁白的展示/播报呈现参数（认知指令播报用：记忆词不上屏 + 放慢语速，2026-09-04 修改意见 3） */
export interface NarrationPresentation {
  /** 屏幕展示文案（缺省 = 与播报同文） */
  displayText?: string;
  /** 播报语速（豆包 TTS speech_rate，缺省 = 全局默认） */
  speechRate?: number;
  /** 计入题号进度（2026-09-12：minicog 记词指令是量表第 1 个条目，见 cognitive-flow.countsAsProgress） */
  countsAsProgress?: boolean;
}

/** 采集编排步骤：旁白（只播报、不需作答）或正式提问 */
export type TimelineStep =
  | { kind: "narration"; narration: NarrationV2 & NarrationPresentation }
  | { kind: "instruction"; item: AskableQuestion }
  | { kind: "question"; item: AskableQuestion };

/** 01 表各量表首个条目的行号（用于给 scaleId 为空的分类过渡找"紧邻其后的量表"锚点） */
const scaleFirstRowV2: ReadonlyMap<string, number> = new Map(
  scalesV2.map((scale) => [scale.id, Math.min(...scale.items.map((item) => item.row))])
);

/**
 * 旁白锚定量表（来源：V2/01_评估采集规则表.xlsx 行序）：
 * - 工具说明行自带 scaleId（紧邻其后的量表）；
 * - 分类过渡行 scaleId 为空，锚到"其后第一个量表"（首个条目行号大于旁白行号的量表）；
 * - 总开场不锚定任何量表（恒在最前，由 buildTimeline 单独处理）。
 */
function narrationAnchorScaleId(narration: NarrationV2): string | null {
  if (narration.scaleId) return narration.scaleId;
  for (const scale of scalesV2) {
    if ((scaleFirstRowV2.get(scale.id) ?? Infinity) > narration.row) return scale.id;
  }
  return null;
}

/**
 * 组装采集编排时间线：总开场恒在最前；每条分类过渡/工具说明锚定到其后的量表，
 * 仅当该量表被本次会话勾选时才纳入，插在该量表首题之前；同一量表前多条旁白按 01 表行号排序。
 * 未勾选量表的旁白不播；正文为空的旁白行（如 01 表 112 行）跳过。
 * 旁白文案经 prompts.narrationText 应用简化覆盖（2026-09-12：开场白、过渡句改简单一些，
 * 01 表只读源不动，编排层替换措辞）；prompts.narrationSuppressed 命中的旁白整条删除
 * （2026-09-13 用户拍板：认知初筛前三条开场白只留 narr_50，删 narr_3 总开场与 narr_51）。
 * 认知题指令播报（2026-08-13，cognitive-flow.INSTRUCTION_BROADCASTS）：插在配置题目之前
 * （可位于量表中部，如 MMSE 三词播报插在计算题之前），只播报不需作答，复用 narration 机制。
 * 来源：V2/Demo_v2更新说明.docx §3 —— 按预设顺序播放开场白、分类过渡句和必要的工具说明。
 */
export function buildTimeline(scaleIds: readonly string[]): TimelineStep[] {
  const steps: TimelineStep[] = [];
  for (const narration of narrationsV2) {
    if (narration.entryType === "总开场" && narration.text.trim() && !narrationSuppressed(narration.id)) {
      steps.push({ kind: "narration", narration: { ...narration, text: narrationText(narration) } });
    }
  }
  let transitionIndex = 0;
  for (const scaleId of scaleIds) {
    // 纯测量/医护观察量表（calf/grip/gait_speed/dxa_bia 等）在患者端无题可问：
    // 不播过渡句/旁白，避免"说了要测却没有下文"（2026-09-13）
    const items = collectionItemsOf(scaleId).filter((question) =>
      // Mini-Cog 记词已由 instr_minicog_words 编排，避免同时播报旧指令。
      question.inTimeline && question.id !== "minicog_1" && !GROUP_NON_TRIGGER_IDS.has(question.id)
    );
    if (items.length === 0) continue;
    const anchored = narrationsV2
      .filter(
        (narration) =>
          narration.entryType !== "总开场" &&
          narration.text.trim() &&
          !narrationSuppressed(narration.id) &&
          narrationAnchorScaleId(narration) === scaleId
      )
      .sort((a, b) => a.row - b.row);
    // 量表切换过渡（2026-09-13 用户拍板：开场白/过渡句不播报量表名称，用日常交流的话
    // 简要说明接下来了解什么，取代 2026-08-13 起"下面是「量表短名」。"的开场点名）：
    // 有锚定旁白 → 旁白本身即是口语过渡句，直接播；无锚定旁白 → 有专题过渡句用专题句
    // （SCALE_TRANSITION_OVERRIDES，如 mnasf → "下面问问您的营养情况。"），否则从过渡句池轮换注入
    if (anchored.length > 0) {
      for (const narration of anchored) {
        steps.push({ kind: "narration", narration: { ...narration, text: narrationText(narration) } });
      }
    } else if (!scaleTransitionSuppressed(scaleId) && !scaleTransitionSkipped(scaleId, scaleIds)) {
      // 整条删除（2026-09-15 修改.docx ③，如 anxiety_2q 开场白）：不播过渡句直接开问
      // 语境省略（2026-09-14）：过渡句重复/突兀时整条不播，直接开问（prompts.SCALE_TRANSITION_CONTEXT_SKIP）
      steps.push({
        kind: "narration",
        narration: {
          id: `scale_intro_${scaleId}`,
          row: 0,
          entryType: "工具说明",
          category: "量表开场",
          scaleId,
          text:
            SCALE_TRANSITION_OVERRIDES.get(scaleId) ??
            SCALE_TRANSITION_TEXTS[transitionIndex++ % SCALE_TRANSITION_TEXTS.length],
        },
      });
    }
    for (const question of items) {
      const item = collectionItem(scaleId, question);
      const instruction = instructionBeforeItem.get(question.id);
      if (instruction) {
        // 虚拟旁白：id 前缀 instr_，播报完成标记与 01 表旁白共用 system 轮次机制；
        // 认知指令带 displayText/speechRate（记忆词不上屏 + 放慢语速，2026-09-04 修改意见 3）
        steps.push({
          kind: "narration",
          narration: {
            id: instruction.id,
            row: 0,
            entryType: "记忆指令",
            category: "认知评估指令",
            scaleId,
            text: instruction.text,
            displayText: instruction.displayText,
            speechRate: instruction.speechRate,
            countsAsProgress: instruction.countsAsProgress,
          },
        });
      }
      steps.push({ kind: question.patientResponseMode === "none" ? "instruction" : "question", item });
    }
  }
  return steps;
}

export type AnswerStatus = "confirmed" | "pending" | "manual" | "superseded";

/** 对话快照：从 DialogueTurn（提问/回答/旁白播报计数）与 Answer（答案状态）派生 */
export interface DialogueSnapshot {
  /** 题目 id → 当前答案状态（无记录则不在 Map 中） */
  answerStatus: ReadonlyMap<string, AnswerStatus>;
  /** 题目 id → 数字医生已就该题发问的次数（首问/追问/轮末复问各计 1 次） */
  doctorAskCount: ReadonlyMap<string, number>;
  /** 题目 id → 患者已回答的次数 */
  patientReplyCount: ReadonlyMap<string, number>;
  /** 已播报旁白 id 集合（播报时写入 role=system、questionId=旁白 id 的轮次，由此派生） */
  deliveredNarrationIds: ReadonlySet<string>;
  /** 已播报采集指令 id 集合（同样以 system 轮次留痕，避免刷新后重复播报） */
  /** 可选以兼容旧测试/调用方未带该字段的快照；服务端加载时始终提供。 */
  deliveredInstructionIds?: ReadonlySet<string>;
  /**
   * 阶梯跳题（2026-08-13，视力/听力"可以（结束）"）：由已确认答案派生的跳过集合，
   * 见 computeLadderSkips；命中的题目视同已有记录，不再向患者提问（评分层 ladderScore
   * 本就按"命中即停、后续 excluded"计分，口径一致）。
   */
  skippedQuestionIds?: ReadonlySet<string>;
}

/** 提问尝试序号：1=首问（口语版） 2=追问 3=轮末换说法复问 */
export type AskAttempt = 1 | 2 | 3;

export interface DialoguePrompt {
  kind: "ask" | "clarify" | "recheck";
  item: AskableQuestion;
  attempt: AskAttempt;
  /** 需要播报/展示的完整文案（预生成模板拼装，不经 LLM） */
  text: string;
}

export type DialogueStep =
  /** 需要向患者发出新的提问（调用方应写入 doctor 轮次并播报） */
  | { kind: "prompt"; prompt: DialoguePrompt }
  /** 遇到未播报的旁白（调用方播报并写 system 轮次后即完成，不需患者作答） */
  | { kind: "narration"; narration: NarrationV2 & NarrationPresentation }
  /** 需要患者看到/听到但无需提交答案的采集指令（如 Mini-Cog 记忆指令） */
  | { kind: "instruction"; item: AskableQuestion }
  /** 提问已发出，等待患者作答（页面刷新/查询状态时命中此分支） */
  | { kind: "awaiting"; item: AskableQuestion; attempt: AskAttempt; phase: "main" | "recheck" }
  /** 全部题目均已有结论（confirmed / manual），问询结束 */
  | { kind: "finished" };

function counts(snapshot: DialogueSnapshot, questionId: string): { asks: number; replies: number } {
  return {
    asks: snapshot.doctorAskCount.get(questionId) ?? 0,
    replies: snapshot.patientReplyCount.get(questionId) ?? 0,
  };
}

/** 首问播报/展示文案：词复述组 trigger 题用组提问文案（不再逐词分问），其余用口语版题面 */
export function askText(question: ScaleQuestion): string {
  return spokenTextOverride(question.id) ?? question.colloquialText;
}

/**
 * 阶梯跳题派生（视力/听力等 ladderScore 量表）：按 stepItemIds 顺序扫描，
 * 首个已确认答案的条目若命中有分选项（"可以（N分，结束）"），其后阶梯题全部跳过；
 * 命中无分选项（"不可以（进入下一题）"，score=null）则继续看下一级。
 * 状态完全由已确认答案派生：医生改答后重算，跳题自动失效。
 */
export function computeLadderSkips(
  scaleIds: readonly string[],
  confirmedLabelById: ReadonlyMap<string, string | null>
): Set<string> {
  const skipped = new Set<string>();
  const selected = new Set(scaleIds);
  for (const entry of judgmentsV2) {
    if (!selected.has(entry.scaleId)) continue;
    const scale = scalesV2.find((s) => s.id === entry.scaleId);
    if (!scale) continue;
    for (const judgment of entry.judgments) {
      if (judgment.type !== "ladderScore") continue;
      for (let i = 0; i < judgment.stepItemIds.length; i++) {
        const itemId = judgment.stepItemIds[i];
        const label = confirmedLabelById.get(itemId);
        if (!label) break; // 该级尚无结论：后续级尚未轮到，无需处理
        const item = scale.items.find((candidate) => candidate.id === itemId);
        const option = item?.options?.find((candidate) => candidate.label === label);
        if (option && option.score !== null) {
          // "可以（结束）"：跳过后续全部阶梯题
          for (const rest of judgment.stepItemIds.slice(i + 1)) skipped.add(rest);
        }
        // 无分选项（"不可以"）：不跳，继续检查下一级是否已答（医生可能已代填多级）
      }
    }
  }
  return skipped;
}

/**
 * 由当前快照推导下一步。遍历顺序即时间线顺序（旁白插在锚定量表首题之前）：
 * 主轮：未播报的旁白 → narration 步骤（不需作答）；首个无答案记录的题目 → 首问或追问
 * （复用回填被撤回、计数残留的题目按既有计数重新提问，见主轮内注释）；
 * 复问轮：主轮全部有记录后，对 pending 题目发轮末复问（画钟题 pending 只等医生计分，跳过不复问）；
 * 全部旁白已播报且全部题目 confirmed/manual → finished。
 * 刷新重放安全：已写入 system 轮次的旁白（deliveredNarrationIds）不会再次返回。
 */
export function nextStep(timeline: readonly TimelineStep[], snapshot: DialogueSnapshot): DialogueStep {
  const skipped = snapshot.skippedQuestionIds ?? new Set<string>();
  // ---- 主轮（旁白与题目按时间线顺序交错） ----
  for (const step of timeline) {
    if (step.kind === "narration") {
      if (!snapshot.deliveredNarrationIds.has(step.narration.id)) {
        return { kind: "narration", narration: step.narration };
      }
      continue;
    }
    if (step.kind === "instruction") {
      if (!snapshot.deliveredInstructionIds?.has(step.item.question.id)) {
        return { kind: "instruction", item: step.item };
      }
      continue;
    }
    const item = step.item;
    if (skipped.has(item.question.id)) continue; // 阶梯题已被前序"可以（结束）"截断
    const status = snapshot.answerStatus.get(item.question.id);
    if (status) continue; // 已有记录（confirmed/pending/manual）→ 主轮完成
    const { asks, replies } = counts(snapshot, item.question.id);
    if (asks === 0) {
      return {
        kind: "prompt",
        prompt: { kind: "ask", item, attempt: 1, text: askText(item.question) },
      };
    }
    // 计数由 turns 派生、无法重置，故一轮"首问+追问"内 attempt 按 asks 奇偶推导：
    // 奇数 asks 对应该轮首问（attempt 1）、偶数 asks 对应追问（attempt 2）。
    // 正常流程只会走到 (1,0)/(1,1)/(2,1)；asks≥2 且 asks=replies 仍无答案记录，
    // 只可能是复用回填被撤回（答案置 superseded，见 service.ts loadContext）——
    // 此时按既有计数重新提问（新一轮首问），而不是抛错卡死：
    // 撤回源于医生改答源题这一正常操作，患者理应能重新作答（A2 修复）。
    if (asks === replies) {
      const attempt: AskAttempt = asks % 2 === 1 ? 2 : 1;
      return {
        kind: "prompt",
        prompt: {
          kind: attempt === 1 ? "ask" : "clarify",
          item,
          attempt,
          text: attempt === 1 ? askText(item.question) : clarifyText(item.question, item.options),
        },
      };
    }
    if (asks === replies + 1) {
      // 提问已发出、等待作答（奇偶推导同上文注释）
      const attempt: AskAttempt = asks % 2 === 1 ? 1 : 2;
      return { kind: "awaiting", item, attempt, phase: "main" };
    }
    // 回答次数多于提问次数：写入侧未维护好不变量，宁可报错也不越过医学流程
    throw new Error(`会话状态不一致：题目 ${item.question.id} 提问 ${asks} 次、回答 ${replies} 次但无答案记录`);
  }

  // ---- 轮末复问轮 ----
  for (const step of timeline) {
    if (step.kind !== "question") continue;
    const item = step.item;
    if (skipped.has(item.question.id)) continue;
    if (snapshot.answerStatus.get(item.question.id) !== "pending") continue;
    // 画钟题交卷即落 pending（首问后直接 markPending，asks=1/replies=1），只等医生在
    // CollectForm 确认计分（M9.6），无需也不应轮末复问——跳过让会话正常走到 finished，
    // 计分缺口按 deferClinical 既定口径豁免出「部分计分」报告
    // （A1 修复：此前复问轮只认 asks=2/asks=3 两种 pending 形态，asks=1 直接抛错卡死）。
    if (
      item.question.answerType === "drawing" ||
      item.question.judgmentMode === "clinician" ||
      item.question.judgmentMode === "configuration_missing"
    ) {
      // 医护判定题已经完整保留患者原话/操作结果；重复追问不会产生可用于确定性评分的新答案。
      // 直接结束患者采集并进入医护补录，避免一次回答后落入复问状态机不变量错误。
      continue;
    }
    const { asks, replies } = counts(snapshot, item.question.id);
    // 复问发出前：asks=replies≥2（患者已答完全部提问仍 pending）→ 发轮末复问；
    // asks≥4 来自复用撤回后的重新提问轮（A2），语义相同。
    // 旧版 MMSE 仅收集原话，一次回答即留待医护判定，升级后仍可继续原会话。
    if (item.question.responseMode === "free" && asks === 1 && replies === 1) continue;
    if (asks === replies && asks >= 2) {
      return {
        kind: "prompt",
        prompt: { kind: "recheck", item, attempt: 3, text: recheckText(item.question) },
      };
    }
    // 复问已发出、等待患者作答
    if (asks === replies + 1 && asks >= 3) {
      return { kind: "awaiting", item, attempt: 3, phase: "recheck" };
    }
    throw new Error(`会话状态不一致：待确认题目 ${item.question.id} 提问 ${asks} 次、回答 ${replies} 次`);
  }

  return { kind: "finished" };
}

/**
 * 按钮/图片作答的选项匹配（确定性输入，无需归一化）。
 * 优先按 label 精确匹配：rules 投影的兼容分值（compatScore）会把 score=null 折叠成 0/1，
 * 同分选项（如便秘筛查是/否、Bristol 7 图、IADL 同分档）按分值 find 必撞首项，属医学错误；
 * label 缺失时回退按分值匹配（number 题分值唯一，数字面板只传分值）。
 * 未命中返回 null，由调用方（service 层）抛业务冲突。
 */
export function matchButtonOption(
  item: AskableQuestion,
  label: string | undefined,
  score: number | undefined
): QuestionOption | null {
  if (label !== undefined) {
    return item.options.find((candidate) => candidate.label === label) ?? null;
  }
  return item.options.find((candidate) => candidate.score === score) ?? null;
}

/** 回答归一化后的落库动作 */
export type ReplyResolution =
  /** 命中标准选项 → 写入 confirmed 答案 */
  | { action: "confirm"; optionLabel: string; score: number }
  /** 首答模糊 → 不落答案，紧接着发追问 */
  | { action: "clarify" }
  /** 追问后仍模糊 → 标"待确认"（pending），等轮末复问 */
  | { action: "markPending" }
  /** 轮末复问仍模糊 → 标"待人工确认"（manual），由医生补录 */
  | { action: "markManual" };

/**
 * 根据"本次回答对应第几次提问"与归一化结果，决定落库动作。
 * 来源：AGENTS.md 硬约束 3 —— 模糊 → 追问 1 次 → 待确认 → 轮末复问 → 待人工确认，不得强行生成答案。
 */
export function resolveReply(attempt: AskAttempt, outcome: NormalizationOutcome): ReplyResolution {
  if (outcome.status === "matched") {
    return { action: "confirm", optionLabel: outcome.optionLabel, score: outcome.score };
  }
  if (attempt === 1) return { action: "clarify" };
  if (attempt === 2) return { action: "markPending" };
  return { action: "markManual" };
}

/**
 * 问询进度：total 为患者端可问题目数，answered 为已有结论（含待确认/待人工确认/阶梯跳过）的数量。
 * 传入时间线时，countsAsProgress 的指令播报（minicog_1 记词，01 表里是量表第 1 个条目）
 * 计入 total，播报落库（deliveredNarrationIds）后计入 answered——
 * 患者端题号由此呈现"第 1 题记词 → 第 2 题画钟 → 第 3 题复述"（2026-09-12 用户口径）。
 */
export function progressOf(
  questions: readonly AskableQuestion[],
  snapshot: DialogueSnapshot,
  timeline?: readonly TimelineStep[]
): { answered: number; total: number } {
  const skipped = snapshot.skippedQuestionIds ?? new Set<string>();
  let answered = questions.filter(
    (item) => snapshot.answerStatus.has(item.question.id) || skipped.has(item.question.id)
  ).length;
  let total = questions.length;
  for (const step of timeline ?? []) {
    if (step.kind === "narration" && step.narration.countsAsProgress) {
      total += 1;
      if (snapshot.deliveredNarrationIds.has(step.narration.id)) answered += 1;
    }
  }
  return { answered, total };
}
