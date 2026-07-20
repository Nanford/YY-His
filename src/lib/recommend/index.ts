/**
 * INPUT:  评估标签集合（src/lib/scoring 输出）+ data/intervention-scoring.json（积分矩阵 + 30 干预项元数据）
 * OUTPUT: 按积分排序入选的候选干预方案（三大类分组，每类最多 2 项，附积分来源明细与素材信息）
 * POS:    干预推荐引擎（医学核心）。纯函数、确定性：查积分矩阵 → 逐项累加 → 每类排序截取。
 *         来源：需求更新说明 V2.0 §4「干预推荐积分规则」。V1 的知识图谱映射查询已停用（保留为历史资料）。
 */
import {
  interventionItems,
  interventionItemByCode,
  interventionScoreMatrix,
  scoringCategories,
} from "@/lib/rules";
import type { AssessmentTag, TagLevel } from "@/lib/scoring/types";

/** 单个评估标签对某干预项的积分贡献（供医生逐项下钻查看积分来源） */
export interface ScoreContribution {
  /** 评估标签名称 */
  tag: string;
  /** 级别：是 / 倾向是 / 基本是。"倾向/基本"体质按全分参与积分，级别仅供展示区分 */
  level: TagLevel;
  /** 该标签对本干预项的匹配分（0-3，仅 >0 的贡献进入明细） */
  score: number;
}

/** 一条入选候选干预（积分排序后的结果项） */
export interface RecommendedIntervention {
  /** 稳定编码 M06 / D03 / C01（素材关联唯一标识） */
  code: string;
  /** 三大类：运动干预 / 膳食干预 / 中医食养干预 */
  category: string;
  name: string;
  /** 展示形态：运动=视频教程（缺失回退文字要点）；膳食/中医食养=图文教程 */
  mediaType: "video" | "image";
  mediaSrc: string;
  sourceFile: string | null;
  /** 运动动作文字要点；图片项为 null */
  text: string | null;
  /** 本次全部有效评估标签对该项的累加总分 */
  score: number;
  /** 类别内排名（1 起） */
  rankInCategory: number;
  /** 积分来源明细（贡献 >0 的评估标签，按贡献分降序、同分按标签名升序） */
  matchDetail: ScoreContribution[];
}

export interface RecommendationCategory {
  category: string;
  items: RecommendedIntervention[];
}

export interface RecommendationResult {
  /** 三大类固定顺序分组；无匹配的类别保留（items 为空数组），界面布局稳定 */
  categories: RecommendationCategory[];
  /** 入选候选平铺列表（落库为候选方案快照，总数不超过 6 项） */
  flat: RecommendedIntervention[];
}

// 来源：需求更新说明 V2.0 §4.2 —— 每类最多展示 2 项，总数因此不超过 6 项
export const MAX_PER_CATEGORY = 2;

/** 校验标签均在积分矩阵中（17 全集已由 convert-rules 保证完整） */
function assertKnownTags(assessmentTags: readonly AssessmentTag[]): void {
  for (const at of assessmentTags) {
    if (!interventionScoreMatrix[at.tag]) {
      throw new Error(`评估标签「${at.tag}」不在积分规则表中`);
    }
  }
}

/** 单个干预编码对一组评估标签的累加总分与积分来源明细（唯一计分实现，供推荐与同类替换共用） */
function scoreItem(code: string, assessmentTags: readonly AssessmentTag[]): { total: number; matchDetail: ScoreContribution[] } {
  const matchDetail: ScoreContribution[] = [];
  let total = 0;
  for (const at of assessmentTags) {
    const s = interventionScoreMatrix[at.tag]?.[code] ?? 0;
    total += s;
    if (s > 0) matchDetail.push({ tag: at.tag, level: at.level, score: s });
  }
  matchDetail.sort((a, b) => b.score - a.score || (a.tag < b.tag ? -1 : 1));
  return { total, matchDetail };
}

/**
 * 由评估标签生成候选干预方案（积分排名）。
 * 算法（§4.1/§4.2）：每个候选项总分 = 全部有效评估标签对该项匹配分累加；
 * 每类独立按总分降序、同分按编码升序排序，仅取总分 >0 的前 2 项；没有则该类为空。
 * 医学口径（用户已确认）："倾向是"与"基本是"视同正式体质标签，按积分矩阵中该标签行的全分参与累加，
 * matchDetail 保留级别信息供报告标注"（倾向）"。
 */
export function recommend(assessmentTags: AssessmentTag[]): RecommendationResult {
  assertKnownTags(assessmentTags);

  const scored = interventionItems.map((item) => ({ item, ...scoreItem(item.code, assessmentTags) }));

  // 每类独立排序截取：总分降序 → 同分按编码升序（保证相同输入产生相同结果，§4.2）
  const categories: RecommendationCategory[] = scoringCategories.map((def) => {
    const items = scored
      .filter((s) => s.item.category === def.label && s.total > 0)
      .sort((a, b) => b.total - a.total || (a.item.code < b.item.code ? -1 : 1))
      .slice(0, MAX_PER_CATEGORY)
      .map((s, index): RecommendedIntervention => ({
        code: s.item.code,
        category: s.item.category,
        name: s.item.name,
        mediaType: s.item.mediaType,
        mediaSrc: s.item.mediaSrc,
        sourceFile: s.item.sourceFile,
        text: s.item.text,
        score: s.total,
        rankInCategory: index + 1,
        matchDetail: s.matchDetail,
      }));
    return { category: def.label, items };
  });

  return { categories, flat: categories.flatMap((c) => c.items) };
}

/**
 * 为任意干预编码构造候选对象——供医生"同类替换"：计算该项对本次标签集的积分与来源明细。
 * rankInCategory 继承被替换项的排位槽（医生指定项不参与自动排序，仅占位展示）。
 * 返回 null 表示编码不存在（调用方需拒绝该替换）。
 */
export function buildIntervention(
  code: string,
  assessmentTags: readonly AssessmentTag[],
  rankInCategory = 0
): RecommendedIntervention | null {
  const item = interventionItemByCode.get(code);
  if (!item) return null;
  assertKnownTags(assessmentTags);
  const { total, matchDetail } = scoreItem(item.code, assessmentTags);
  return {
    code: item.code,
    category: item.category,
    name: item.name,
    mediaType: item.mediaType,
    mediaSrc: item.mediaSrc,
    sourceFile: item.sourceFile,
    text: item.text,
    score: total,
    rankInCategory,
    matchDetail,
  };
}

/** 便捷校验：干预编码是否存在于积分数据中（供上层容错提示用） */
export function hasIntervention(code: string): boolean {
  return interventionItemByCode.has(code);
}
