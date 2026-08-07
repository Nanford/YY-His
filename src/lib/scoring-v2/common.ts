/**
 * INPUT:  src/lib/rules/v2（量表/标签定义）、评分器传入的标准答案
 * OUTPUT: 各判定器共用的取分/缺失分组/标签解析辅助函数
 * POS:    V2 评分引擎内部工具，不对外导出业务结论。
 */
import { tagV2ByCode, type ScaleItemV2, type ScaleV2 } from "@/lib/rules/v2";
import type { AnswerValue, ItemScoreDetail, TagResultV2 } from "./types";

/**
 * 可用 deferClinical 豁免计分的条目类型（来源：01 表「条目类型」列；
 * 口径对齐旧引擎 src/lib/scoring/common.ts 的 partitionMissing——需医生检查/系统读取类才可豁免）。
 * 与 src/lib/rules/index.ts 投影的 observerAssisted（条目类型 ≠ 正式问题）保持一致：
 * 记忆指令/图片识别/操作指令等需现场道具、图片或医生判定的条目，患者端同样不提问，
 * 缺失时按 deferClinical 豁免计分。仅「正式问题」缺失在任何模式下都阻断评分。
 */
export const CLINICAL_ENTRY_TYPES: ReadonlySet<string> = new Set([
  "系统读取",
  "逻辑计算",
  "操作测试",
  "记忆指令",
  "绘图操作",
  "图片识别",
  "操作指令",
  "医护观察",
  "医护核对",
  "医护评估",
  "设备/人工测量",
]);

/** 取条目定义（判定配置引用了不存在的条目 id 属规则数据异常，宁可抛错不可带病计算） */
export function itemOf(scale: ScaleV2, itemId: string): ScaleItemV2 {
  const item = scale.items.find((i) => i.id === itemId);
  if (!item) throw new Error(`量表 ${scale.id} 无条目 ${itemId}（判定配置与题库不一致）`);
  return item;
}

export interface ResolvedAnswer {
  answerLabel: string | null;
  score: number | null;
  /** 不适用：显式 na 答案，或命中了无分选项（如「不适用（非女性）」） */
  na: boolean;
}

/**
 * 把标准答案解析为分值。
 * 确定性红线：option 答案必须命中条目 options 中的某个 label，命中不到即抛错；
 * number 答案（预留 M9）在条目有 options 时必须落在合法分值集合内。
 * 命中无分选项（score=null）按不适用处理，交由判定器剔除或阻断。
 */
export function resolveAnswerScore(item: ScaleItemV2, answer: AnswerValue): ResolvedAnswer {
  if (answer.kind === "na") return { answerLabel: null, score: null, na: true };
  if (answer.kind === "number") {
    if (item.options !== null) {
      const allowed = item.options.map((o) => o.score);
      if (!allowed.includes(answer.value)) {
        throw new Error(`条目 ${item.id} 的数值答案 ${answer.value} 不在合法选项分值 [${allowed.join(",")}] 内`);
      }
    }
    return { answerLabel: String(answer.value), score: answer.value, na: false };
  }
  if (item.options === null) {
    throw new Error(`条目 ${item.id} 无可解析选项（optionsRaw 未解析），无法确定性取分`);
  }
  const hit = item.options.find((o) => o.label === answer.label);
  if (!hit) {
    throw new Error(`条目 ${item.id} 的答案「${answer.label}」不在合法选项内`);
  }
  if (hit.score === null) return { answerLabel: hit.label, score: null, na: true };
  return { answerLabel: hit.label, score: hit.score, na: false };
}

/**
 * 把缺失条目分成「阻断评分」与「可豁免」两组。
 * 仅 deferClinical 模式且条目属临床/系统类（CLINICAL_ENTRY_TYPES）才可豁免；
 * 普通问答题缺失在任何模式下都阻断（与旧引擎口径一致）。
 */
export function partitionMissingV2(
  scale: ScaleV2,
  missingIds: readonly string[],
  deferClinical: boolean
): { blocking: string[]; deferred: string[] } {
  const blocking: string[] = [];
  const deferred: string[] = [];
  for (const id of missingIds) {
    const item = itemOf(scale, id);
    if (deferClinical && CLINICAL_ENTRY_TYPES.has(item.entryType)) {
      deferred.push(id);
    } else {
      blocking.push(id);
    }
  }
  return { blocking, deferred };
}

/** 标签编码 → {code, name}；编码不在 02 表 190 标签内属规则数据异常，抛错 */
export function tagResult(code: string): TagResultV2 {
  const tag = tagV2ByCode.get(code);
  if (!tag) throw new Error(`标签编码 ${code} 不在 data/result-tags.json 的 190 编码内`);
  return { code: tag.code, name: tag.name };
}

/** 构造一条不计分/未答题目的明细行 */
export function excludedDetail(item: ScaleItemV2, answerLabel: string | null = null): ItemScoreDetail {
  return { itemId: item.id, no: item.no, text: item.text, answerLabel, score: null, excluded: true };
}
