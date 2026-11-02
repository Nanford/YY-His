/**
 * INPUT:  src/lib/rules/v2（量表/标签定义）、评分器传入的标准答案
 * OUTPUT: 各判定器共用的取分/缺失分组/标签解析辅助函数
 * POS:    V2 评分引擎内部工具，不对外导出业务结论。
 */
import { tagV2ByCode, type ScaleItemV2, type ScaleV2 } from "@/lib/rules/v2";
import type { AnswerValue, ItemScoreDetail, TagResultV2 } from "./types";

/**
 * 医生侧/系统侧条目类型集合（来源：01 表「条目类型」列；与 rules/index.ts 投影的
 * observerAssisted 口径一致）。2026-08-13 起 deferClinical 不再按条目类型区分豁免
 * （全部缺失条目一律豁免，见 partitionMissingV2），本集合保留供报告/代填等
 * 展示层识别「需临床处理」的条目。
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
 * deferClinical（患者自助 Demo 路径）：2026-08-13 用户拍板「不需要医生确认，直接生成评估报告」——
 * 所有缺失条目一律豁免计分（含答不清转「待人工确认」的普通问答题；2026-07-20「普通问答题
 * 缺失仍阻断」口径废止），按已答题目计分并在报告标注「部分计分」；零条已答的量表仍受
 * 全豁免守卫（guardFullyDeferred）约束不产标签，杜绝"零证据伪造阴性"。
 * strict（医生端，deferClinical=false）：任何缺失都阻断，待医生补录后重算。
 */
export function partitionMissingV2(
  missingIds: readonly string[],
  deferClinical: boolean
): { blocking: string[]; deferred: string[] } {
  if (deferClinical) return { blocking: [], deferred: [...missingIds] };
  return { blocking: [...missingIds], deferred: [] };
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
