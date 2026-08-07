/**
 * INPUT:  data/scales-v2.json（题库选项）
 * OUTPUT: scoring-v2 测试共用的答案构造函数
 * POS:    测试基建（非测试文件，vitest include 仅 *.test.ts，不会被当用例跑）。
 */
import { scaleV2ById } from "@/lib/rules/v2";
import type { AnswerValue, AnswersV2 } from "@/lib/scoring-v2";

/** 按分值构造 option 答案（取该条目 options 中第一个匹配分值的选项 label） */
export function optByScore(scaleId: string, itemId: string, score: number): AnswerValue {
  const item = scaleV2ById.get(scaleId)!.items.find((i) => i.id === itemId)!;
  const hit = item.options!.find((o) => o.score === score)!;
  return { kind: "option", label: hit.label };
}

/** 按 label 构造 option 答案（用于无分选项如「是（筛查阳性）」「不适用（非女性）」） */
export function optByLabel(scaleId: string, itemId: string, label: string): AnswerValue {
  const item = scaleV2ById.get(scaleId)!.items.find((i) => i.id === itemId)!;
  if (!item.options!.some((o) => o.label === label)) throw new Error(`测试构造失败：${itemId} 无选项「${label}」`);
  return { kind: "option", label };
}

/** 中医体质 27 个计分题 id（30 行 − 3 纯复用行，复用行 options=null 不计分） */
export const TCM_SCORED_ITEM_IDS: string[] = scaleV2ById
  .get("tcm_constitution")!
  .items.filter((i) => i.options !== null)
  .map((i) => i.id);

/**
 * 构造中医全量答案：默认 27 个计分题全部答「没有（1 分）」，
 * overrides 可覆盖单题为其他分值（1-5）、{ kind: "na" } 或完整 AnswerValue。
 */
export function tcmAnswers(overrides: Record<string, number | AnswerValue> = {}): AnswersV2 {
  const answers: AnswersV2 = {};
  for (const id of TCM_SCORED_ITEM_IDS) {
    const o = overrides[id];
    if (o === undefined) answers[id] = optByScore("tcm_constitution", id, 1);
    else if (typeof o === "number") answers[id] = optByScore("tcm_constitution", id, o);
    else answers[id] = o;
  }
  return answers;
}
