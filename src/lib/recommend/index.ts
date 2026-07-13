/**
 * INPUT:  评估标签集合（src/lib/scoring 输出）+ data/tag-mapping.json + data/interventions.json
 * OUTPUT: 去重后的候选干预方案（按运动干预/膳食补充/中医食养三大类分组，附执行方案全文与触发来源）
 * POS:    干预推荐引擎（医学核心）。纯函数：查映射 → 汇总 → 去重 → 分组 → 附全文。
 *         Demo 阶段严格按映射表推荐，不引入优先级/禁忌证等复杂逻辑（需求文档明确 V2 再做）。
 */
import { interventionByTag, interventionCategories, interventions, interventionTagsByAssessmentTag } from "@/lib/rules";
import type { AssessmentTag, TagLevel } from "@/lib/scoring/types";

/** 触发某个干预的评估标签来源（保留级别，供医生审核时区分"倾向"体质） */
export interface TriggerSource {
  tag: string;
  level: TagLevel;
}

export interface RecommendedIntervention {
  tag: string;
  category: string;
  /** 执行方案全文，展示时必须完整呈现（需求文档：不能只显示标签名称） */
  plan: string;
  triggeredBy: TriggerSource[];
}

export interface RecommendationResult {
  /** 按三大类固定顺序分组；空类不省略，便于界面稳定布局 */
  categories: { category: string; items: RecommendedIntervention[] }[];
  /** 去重后的候选干预平铺列表 */
  flat: RecommendedIntervention[];
}

/**
 * 由评估标签生成候选干预方案。
 * 医学口径（用户已确认）："倾向是"与"基本是"视同正式体质标签参与映射查询，
 * 但 triggeredBy 保留级别信息，报告中标注"（倾向）"。
 */
export function recommend(assessmentTags: AssessmentTag[]): RecommendationResult {
  // 逐标签查映射 → 汇总去重，triggeredBy 记录每个干预由哪些评估标签触发（可追溯）
  const byInterventionTag = new Map<string, TriggerSource[]>();
  for (const at of assessmentTags) {
    const targets = interventionTagsByAssessmentTag.get(at.tag);
    if (!targets) {
      // 17 个评估标签在 convert-rules 校验过全部有映射；走到这里说明上游传了非法标签
      throw new Error(`评估标签「${at.tag}」不在知识图谱映射表中`);
    }
    for (const t of targets) {
      const sources = byInterventionTag.get(t) ?? [];
      sources.push({ tag: at.tag, level: at.level });
      byInterventionTag.set(t, sources);
    }
  }

  // 以 interventions.json 的原始顺序为干预展示顺序（与源文件一致，输出稳定）
  const flat: RecommendedIntervention[] = interventions
    .filter((i) => byInterventionTag.has(i.tag))
    .map((i) => ({
      tag: i.tag,
      category: i.category,
      plan: i.plan,
      triggeredBy: byInterventionTag.get(i.tag)!,
    }));

  return {
    categories: interventionCategories.map((category) => ({
      category,
      items: flat.filter((i) => i.category === category),
    })),
    flat,
  };
}

/** 便捷校验：干预标签对应的执行方案是否存在（供上层容错提示用） */
export function hasIntervention(tag: string): boolean {
  return interventionByTag.has(tag);
}
