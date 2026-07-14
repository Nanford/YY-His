/**
 * INPUT:  会话勾选的量表（src/lib/rules）、对话快照（答案状态 + 提问/回答计数，由 turns/answers 派生）
 * OUTPUT: askableQuestions、nextStep、resolveReply —— 追问状态机（纯函数、无 IO）
 * POS:    数字医生问询流程的确定性核心：提问 → 追问 1 次 → 待确认 →
 *         轮末换说法复问 → 待人工确认（AGENTS.md 硬约束 3）。
 *         状态完全由 DialogueTurn/Answer 派生，不引入额外持久化状态字段。
 */
import { optionsOf, scaleById, type QuestionOption, type ScaleQuestion } from "@/lib/rules";
import { clarifyText, recheckText } from "./prompts";
import type { NormalizationOutcome } from "./normalize-rules";

/** 患者端可问的题目（含展示所需的量表信息与选项） */
export interface AskableQuestion {
  question: ScaleQuestion;
  scaleId: string;
  scaleName: string;
  options: QuestionOption[];
}

/**
 * 计算患者端问询题目清单（保持量表勾选顺序与题目原始顺序）。
 * 跳过规则（来源：AGENTS.md"已知的坑"与评分实现要点）：
 * - measurement 题：由本地测量数据换算，禁止向患者提问，也禁止采用口头报数；
 * - observerAssisted 题（舌象、神经心理等）：需调查员/医生观察判断，走医生端代填。
 */
export function askableQuestions(scaleIds: readonly string[]): AskableQuestion[] {
  const items: AskableQuestion[] = [];
  for (const scaleId of scaleIds) {
    const scale = scaleById.get(scaleId);
    if (!scale) throw new Error(`会话包含未知量表：${scaleId}`);
    for (const question of scale.questions) {
      if (question.measurement || question.observerAssisted) continue;
      items.push({ question, scaleId: scale.id, scaleName: scale.name, options: optionsOf(scale, question) });
    }
  }
  return items;
}

export type AnswerStatus = "confirmed" | "pending" | "manual" | "superseded";

/** 对话快照：从 DialogueTurn（提问/回答计数）与 Answer（答案状态）派生 */
export interface DialogueSnapshot {
  /** 题目 id → 当前答案状态（无记录则不在 Map 中） */
  answerStatus: ReadonlyMap<string, AnswerStatus>;
  /** 题目 id → 数字医生已就该题发问的次数（首问/追问/轮末复问各计 1 次） */
  doctorAskCount: ReadonlyMap<string, number>;
  /** 题目 id → 患者已回答的次数 */
  patientReplyCount: ReadonlyMap<string, number>;
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

/**
 * 由当前快照推导下一步。遍历顺序即题目顺序：
 * 主轮：首个无答案记录的题目 → 首问或追问；
 * 复问轮：主轮全部有记录后，对 pending 题目发轮末复问；
 * 全部题目 confirmed/manual → finished。
 */
export function nextStep(questions: readonly AskableQuestion[], snapshot: DialogueSnapshot): DialogueStep {
  // ---- 主轮 ----
  for (const item of questions) {
    const status = snapshot.answerStatus.get(item.question.id);
    if (status) continue; // 已有记录（confirmed/pending/manual）→ 主轮完成
    const { asks, replies } = counts(snapshot, item.question.id);
    if (asks === 0) {
      return {
        kind: "prompt",
        prompt: { kind: "ask", item, attempt: 1, text: item.question.colloquialText },
      };
    }
    if (asks === 1 && replies === 1) {
      // 首答模糊 → 追问 1 次（AGENTS.md 硬约束 3）
      return {
        kind: "prompt",
        prompt: { kind: "clarify", item, attempt: 2, text: clarifyText(item.question, item.options) },
      };
    }
    if (asks === replies + 1 && (asks === 1 || asks === 2)) {
      return { kind: "awaiting", item, attempt: asks as AskAttempt, phase: "main" };
    }
    // 无答案记录却出现 2 次以上回答：写入侧未维护好不变量，宁可报错也不越过医学流程
    throw new Error(`会话状态不一致：题目 ${item.question.id} 提问 ${asks} 次、回答 ${replies} 次但无答案记录`);
  }

  // ---- 轮末复问轮 ----
  for (const item of questions) {
    if (snapshot.answerStatus.get(item.question.id) !== "pending") continue;
    const { asks, replies } = counts(snapshot, item.question.id);
    if (asks === 2) {
      return {
        kind: "prompt",
        prompt: { kind: "recheck", item, attempt: 3, text: recheckText(item.question) },
      };
    }
    if (asks === 3 && replies === 2) {
      return { kind: "awaiting", item, attempt: 3, phase: "recheck" };
    }
    throw new Error(`会话状态不一致：待确认题目 ${item.question.id} 提问 ${asks} 次、回答 ${replies} 次`);
  }

  return { kind: "finished" };
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

/** 问询进度：total 为患者端可问题目数，answered 为已有结论（含待确认/待人工确认）的数量 */
export function progressOf(
  questions: readonly AskableQuestion[],
  snapshot: DialogueSnapshot
): { answered: number; total: number } {
  const answered = questions.filter((item) => snapshot.answerStatus.has(item.question.id)).length;
  return { answered, total: questions.length };
}
