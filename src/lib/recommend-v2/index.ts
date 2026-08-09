/**
 * INPUT:  评估标签编码列表（result-tags.json 的 code）+ src/lib/rules/v2（积分矩阵、干预元数据、标签索引）
 * OUTPUT: V2 候选干预方案：5 大类分组（每类 forced 置顶 + 普通项最多 2 项）、forced 平铺列表、forbidden 禁止明细
 * POS:    V2 推荐引擎（医学核心）。纯函数、确定性、无 IO。
 *         分值语义来源：V2/03_标签干预匹配表.xlsx（intervention-scoring-v2.json scoreSemantics：
 *         100=强制优先、-100=禁止、0=无关（稀疏不存）、2-10=普通匹配）；
 *         每类截取与强制置顶来源：V2/Demo_v2更新说明.docx「每类原则上选择 1 至 2 个」+ 100 分「强制优先推荐」。
 *         当前由 finalize 与医患报告页直接使用；旧引擎 src/lib/recommend 仅保留历史兼容，不参与 V2 运行时。
 */
import {
  interventionsV2,
  interventionV2ByCode,
  interventionScoreMatrixV2,
  scoringCategoriesV2,
  tagV2ByCode,
} from "@/lib/rules/v2";

/** 单个评估标签对某干预项的积分贡献（供医生端逐项下钻查看积分来源） */
export interface ScoreContribution {
  tagCode: string;
  tagName: string;
  /** 该标签对本干预项的匹配分：2-10 普通匹配 / 100 强制优先 / -100 禁止 */
  score: number;
}

/** 一条入选候选干预 */
export interface RecommendedItemV2 {
  /** 稳定编码 YD01 / SS02 / ZY05 / JZ01 / QT15（素材关联唯一标识） */
  code: string;
  name: string;
  /** 干预所属大类 label（就诊建议 / 运动 等，来自 interventions-v2.json） */
  category: string;
  mediaType: "video" | "image" | "text";
  /** 方案正文（运动动作要点 / 就诊建议文本等；图片类为图片配套说明） */
  content: string;
  mediaSrc: string | null;
  /** 素材是否就绪；false 时展示层标"素材待补齐"（展示逻辑随 M9 装机接入） */
  mediaAvailable: boolean;
  /**
   * 普通匹配分（2-10）的累加总分。
   * 约定：forced 项的 total 同样只累加普通匹配分，100 强制标记本身不计入 total
   *（100 是排序决策而非分值），因此仅由 100 强制的项 total 为 0。
   */
  total: number;
  /** 有任一标签给 100 → 强制优先（来源：03 表 100 分语义） */
  forced: boolean;
  /** 积分来源明细：全部非零贡献（含 100 决策依据；被禁止项的 -100 依据在 forbidden 结果里），
   *  按分值降序、同分按标签编码升序，顺序稳定 */
  contributions: ScoreContribution[];
}

/** 被 -100 一票禁止的干预项及禁止来源（医生端可见，全链路可追溯硬约束） */
export interface ForbiddenItemV2 {
  code: string;
  name: string;
  /** 禁止决策依据：-100 贡献排在最前，其余非零贡献随后（便于医生先看禁止来源） */
  reasons: ScoreContribution[];
}

export interface RecommendationCategoryV2 {
  /** 大类 key：exercise / diet / tcmFood / referral / other（固定顺序见 scoringCategoriesV2） */
  key: string;
  label: string;
  /** forced 项单独置顶且**不占用**每类 2 个普通名额（约定，见 MAX_PER_CATEGORY_V2 注释） */
  items: RecommendedItemV2[];
}

export interface RecommendationResultV2 {
  categories: RecommendationCategoryV2[];
  /** 全部强制优先项平铺列表（报告页醒目标注用，如谵妄 → JZ01 紧急就医建议） */
  forced: RecommendedItemV2[];
  /** 全部被 -100 禁止的项及来源（不出现在任何 category 里） */
  forbidden: ForbiddenItemV2[];
}

// 来源：intervention-scoring-v2.json scoreSemantics
export const FORCED_SCORE_V2 = 100;
export const FORBIDDEN_SCORE_V2 = -100;
// 来源：Demo_v2更新说明.docx「每类原则上选择 1 至 2 个」；
// 约定：forced 项（100 强制优先）单独置顶，不占用这 2 个普通名额（"强制优先"语义即不受普通排序名额约束）
export const MAX_PER_CATEGORY_V2 = 2;

/** 校验标签编码均在 190 全集内（与旧引擎 assertKnownTags 同红线：未知编码直接抛错） */
function assertKnownTagCodes(tagCodes: readonly string[]): void {
  for (const code of tagCodes) {
    if (!tagV2ByCode.has(code)) {
      throw new Error(`评估标签编码「${code}」不在 V2 结果标签全集（190 项）中`);
    }
  }
}

/** 明细排序：分值降序、同分按标签编码升序（保证相同输入产生相同输出） */
function byScoreDescThenCode(a: ScoreContribution, b: ScoreContribution): number {
  return b.score - a.score || (a.tagCode < b.tagCode ? -1 : 1);
}

/** 禁止原因排序：-100 决策依据最前，其余按分值降序、同分按标签编码升序 */
function byForbiddenFirst(a: ScoreContribution, b: ScoreContribution): number {
  const aForbidden = a.score === FORBIDDEN_SCORE_V2 ? 0 : 1;
  const bForbidden = b.score === FORBIDDEN_SCORE_V2 ? 0 : 1;
  return aForbidden - bForbidden || byScoreDescThenCode(a, b);
}

interface ItemAccum {
  contributions: ScoreContribution[];
  /** 仅累加普通匹配分（2-10）；100/-100 是决策标记，不参与累加 */
  total: number;
  forced: boolean;
  forbidden: boolean;
}

/** 单个干预项对一组标签的汇总（唯一计分实现）：贡献明细、普通分累加、强制/禁止判定 */
function scoreItemV2(code: string, tagCodes: readonly string[]): ItemAccum {
  const contributions: ScoreContribution[] = [];
  let total = 0;
  let forced = false;
  let forbidden = false;
  for (const tagCode of tagCodes) {
    const s = interventionScoreMatrixV2[tagCode]?.[code] ?? 0;
    if (s === 0) continue; // 稀疏矩阵：未出现的对视为 0（无关）
    const tag = tagV2ByCode.get(tagCode)!;
    contributions.push({ tagCode, tagName: tag.name, score: s });
    if (s === FORBIDDEN_SCORE_V2) forbidden = true;
    else if (s === FORCED_SCORE_V2) forced = true;
    else total += s;
  }
  contributions.sort(byScoreDescThenCode);
  return { contributions, total, forced, forbidden };
}

/**
 * 由评估标签编码生成 V2 候选干预方案。
 * 算法：逐项汇总所有标签分值 →
 *   -100 一票禁止（安全优先：即使另有标签给 100 也禁止，被禁项只进 forbidden、不进任何类；
 *        当前 03 表数据中不存在「同一项同时有 100 与 -100」的冲突，此处按安全口径约定）→
 *   有 100 → forced，强制置顶、不参与普通排序 →
 *   其余按 2-10 累加 total，每大类按 total 降序、同分按编码升序，只取 total>0 的前 2 项。
 * 输入处理：未知编码抛错；placeholder 标签（如 HOME_ENVIRONMENT_SCORE 等 5 个采集占位）静默剔除；
 * 重复编码去重（同一标签不应重复计分）。
 */
export function recommendV2(tagCodes: string[]): RecommendationResultV2 {
  assertKnownTagCodes(tagCodes);

  // placeholder 标签无医学结论含义（占位待录入数值），静默剔除；重复编码去重，保持输入顺序
  const effectiveCodes = [...new Set(tagCodes)].filter((code) => !tagV2ByCode.get(code)!.placeholder);

  const scored = interventionsV2.map((item) => ({ item, ...scoreItemV2(item.code, effectiveCodes) }));

  const forbidden: ForbiddenItemV2[] = scored
    .filter((s) => s.forbidden)
    .map((s) => ({ code: s.item.code, name: s.item.name, reasons: [...s.contributions].sort(byForbiddenFirst) }));

  const toRecommended = (s: (typeof scored)[number]): RecommendedItemV2 => ({
    code: s.item.code,
    name: s.item.name,
    category: s.item.category,
    mediaType: s.item.mediaType as RecommendedItemV2["mediaType"],
    content: s.item.content,
    mediaSrc: s.item.mediaSrc,
    mediaAvailable: s.item.mediaAvailable,
    total: s.total,
    forced: s.forced,
    contributions: s.contributions,
  });

  const forced: RecommendedItemV2[] = scored
    .filter((s) => s.forced && !s.forbidden)
    .sort((a, b) => (a.item.code < b.item.code ? -1 : 1))
    .map(toRecommended);

  // 每大类：forced 项置顶（不占名额，编码升序）+ 普通项 total 降序/同分编码升序取前 2
  const categories: RecommendationCategoryV2[] = scoringCategoriesV2.map((def) => {
    const inCategory = scored.filter((s) => !s.forbidden && s.item.code.startsWith(def.codePrefix));
    const forcedItems = inCategory
      .filter((s) => s.forced)
      .sort((a, b) => (a.item.code < b.item.code ? -1 : 1))
      .map(toRecommended);
    const normalItems = inCategory
      .filter((s) => !s.forced && s.total > 0)
      .sort((a, b) => b.total - a.total || (a.item.code < b.item.code ? -1 : 1))
      .slice(0, MAX_PER_CATEGORY_V2)
      .map(toRecommended);
    return { key: def.key, label: def.label, items: [...forcedItems, ...normalItems] };
  });

  return { categories, forced, forbidden };
}

// ---------- 落库快照形状（InterventionPlan.candidates 的 JSON 契约） ----------

/** 落库候选项：推荐结果项 + 类别内排名（forced 置顶项 rank 从 1 起先于普通项） */
export interface PlanCandidateItemV2 extends RecommendedItemV2 {
  rankInCategory: number;
  /** 大类展示标签（运动干预/膳食营养/中医食养/就诊建议/其他），来自 scoringCategoriesV2 */
  categoryLabel: string;
}

/** InterventionPlan.candidates 的 JSON 形状：候选平铺 + 强制编码 + 禁止明细（医生端可见，可追溯） */
export interface PlanCandidatesV2 {
  items: PlanCandidateItemV2[];
  /** 强制推荐（100 分）干预编码，页面需醒目标注（来源：03 表 100=强制优先推荐） */
  forcedCodes: string[];
  forbidden: ForbiddenItemV2[];
}

/** 把推荐结果投影为落库快照（finalize 唯一写入点；排名在各类内按 items 顺序 1 起编号） */
export function toPlanCandidates(result: RecommendationResultV2): PlanCandidatesV2 {
  const items = result.categories.flatMap((category) =>
    category.items.map((item, index) => ({
      ...item,
      rankInCategory: index + 1,
      categoryLabel: category.label,
    }))
  );
  return { items, forcedCodes: result.forced.map((item) => item.code), forbidden: result.forbidden };
}

/**
 * 为任意干预编码构造完整候选对象——供医生"同类替换"：计算该项对本次标签集的
 * 积分与来源明细（total/contributions 与 recommendV2 输出同口径；被 -100 禁止的项
 * 也照常返回以便展示积分明细，但替换入口须拦截：服务端 confirmPlan 对命中会话快照
 * forbidden 的替换目标硬拦截拒绝，页面层 plan-review 下拉同步禁用并标注「本患者禁止」）。
 * 返回 null 表示编码不存在（调用方需拒绝该替换）。
 */
export function buildInterventionV2(code: string, tagCodes: string[]): RecommendedItemV2 | null {
  const item = interventionV2ByCode.get(code);
  if (!item) return null;
  assertKnownTagCodes(tagCodes);
  const effectiveCodes = [...new Set(tagCodes)].filter((c) => !tagV2ByCode.get(c)!.placeholder);
  const accum = scoreItemV2(item.code, effectiveCodes);
  return {
    code: item.code,
    name: item.name,
    category: item.category,
    mediaType: item.mediaType as RecommendedItemV2["mediaType"],
    content: item.content,
    mediaSrc: item.mediaSrc,
    mediaAvailable: item.mediaAvailable,
    total: accum.total,
    forced: accum.forced,
    contributions: accum.contributions,
  };
}

/** 便捷校验：干预编码是否存在于 V2 干预数据中（供上层容错提示用） */
export function hasInterventionV2(code: string): boolean {
  return interventionV2ByCode.has(code);
}
