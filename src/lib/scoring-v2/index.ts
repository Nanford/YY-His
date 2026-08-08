/**
 * INPUT:  src/lib/rules/v2（V2 规则数据）、judgments-v2.json 判定配置、标准答案
 * OUTPUT: scoreScaleV2 / scoreAllV2 —— V2 泛化评分引擎入口
 * POS:    V2 评分引擎的唯一对外入口。纯函数、确定性、无 IO：大模型只做语言理解，
 *         绝不参与评分与判定（硬约束 #2）。按 judgment.type 派发判定器，注册表数据驱动。
 *         M10.3b 起：一个量表允许 1～N 份判定配置（judgments 数组），依次执行并合并结果。
 *         另含全豁免守卫：零条已答计分条目（全部缺失且全部 deferClinical 豁免）的量表不产标签。
 */
import { judgmentByScaleId, scaleV2ById, type JudgmentV2, type ScaleV2 } from "@/lib/rules/v2";
import { scoreAnyBelowThreshold } from "./any-below-threshold";
import { scoreAnyYes } from "./any-yes";
import { scoreCompositeAllAny } from "./composite-all-any";
import { scoreInitialGateSumRange } from "./initial-gate-sum-range";
import { scoreLadderScore } from "./ladder-score";
import { scorePerQuestionTags } from "./per-question-tags";
import { scoreSumRange } from "./sum-range";
import { scoreTcmConstitution } from "./tcm-constitution";
import { scoreThresholdByEducation } from "./threshold-by-education";
import type { AnswersV2, ItemScoreDetail, ScaleScoreResultV2, ScoreOptionsV2, TagResultV2 } from "./types";

export * from "./types";
export { EDUCATION_BANDS, educationBandOf, type EducationBand } from "./education";

/** 按判定类型派发单个判定器（数据驱动注册表） */
function runJudgment(
  scale: ScaleV2,
  judgment: JudgmentV2,
  answers: AnswersV2,
  opts: ScoreOptionsV2
): ScaleScoreResultV2 {
  switch (judgment.type) {
    case "sumRange":
      return scoreSumRange(scale, judgment, answers, opts);
    case "anyYes":
      return scoreAnyYes(scale, judgment, answers, opts);
    case "tcmConstitutionV2":
      return scoreTcmConstitution(scale, judgment, answers, opts);
    case "thresholdByEducation":
      return scoreThresholdByEducation(scale, judgment, answers, opts);
    case "perQuestionTags":
      return scorePerQuestionTags(scale, judgment, answers, opts);
    case "ladderScore":
      return scoreLadderScore(scale, judgment, answers, opts);
    case "anyBelowThreshold":
      return scoreAnyBelowThreshold(scale, judgment, answers, opts);
    case "initialGateSumRange":
      return scoreInitialGateSumRange(scale, judgment, answers, opts);
    case "compositeAllAny":
      return scoreCompositeAllAny(scale, judgment, answers, opts);
  }
}

/**
 * 合并同一量表多份判定的结果（M10.3b）：
 * - ok：全部判定无阻断才为 true；任一判定带 blockedReason 时取首个原因（ok 恒 false）。
 * - missing/deferred：按条目共集（同一条目在任一份判定里被引用才计），按量表条目顺序输出。
 * - tags：各判定 tags 按配置顺序拼接、按编码去重；任一份判定未过（ok=false）则整体不出标签。
 * - details：按 itemId 合并去重——同一条目被多份判定引用时优先取计分（非 excluded）明细，
 *   按量表条目顺序输出，保证跨判定不重复、顺序稳定。
 * - totalScore：取首个有总分的判定（当前配置一个量表至多一份带总分的判定；
 *   若未来出现多总分判定场景，维持"取首份"取舍并在配置注释中说明）。
 * - partial：任一份判定有豁免计分条目即为 true。
 */
function mergeJudgmentResults(scale: ScaleV2, parts: ScaleScoreResultV2[]): ScaleScoreResultV2 {
  const missingSet = new Set(parts.flatMap((p) => p.missing));
  const deferredSet = new Set(parts.flatMap((p) => p.deferred));
  const byItemOrder = (ids: Set<string>): string[] =>
    scale.items.map((i) => i.id).filter((id) => ids.has(id));

  const detailByItem = new Map<string, ItemScoreDetail>();
  for (const item of scale.items) {
    const candidates = parts
      .map((p) => p.details.find((d) => d.itemId === item.id))
      .filter((d): d is ItemScoreDetail => d !== undefined);
    if (candidates.length === 0) continue;
    detailByItem.set(item.id, candidates.find((d) => !d.excluded) ?? candidates[0]);
  }

  const ok = parts.every((p) => p.ok);
  const tags: TagResultV2[] = [];
  if (ok) {
    const seen = new Set<string>();
    for (const tag of parts.flatMap((p) => p.tags)) {
      if (seen.has(tag.code)) continue;
      seen.add(tag.code);
      tags.push(tag);
    }
    // ICIQ：总分 0 会出 NO，Q4 漏尿情形又会出 PRESENT——安全优先保留阳性、剔除阴性
    if (
      tags.some((t) => t.code === "ICIQ_INCONTINENCE_PRESENT") &&
      tags.some((t) => t.code === "ICIQ_NO_INCONTINENCE")
    ) {
      const idx = tags.findIndex((t) => t.code === "ICIQ_NO_INCONTINENCE");
      if (idx >= 0) tags.splice(idx, 1);
    }
  }

  return {
    scaleId: scale.id,
    ok,
    missing: byItemOrder(missingSet),
    deferred: byItemOrder(deferredSet),
    totalScore: parts.find((p) => p.totalScore !== null)?.totalScore ?? null,
    tags,
    details: [...detailByItem.values()],
    partial: parts.some((p) => p.partial),
    constitutions: parts.find((p) => p.constitutions !== undefined)?.constitutions,
    blockedReason: parts.find((p) => p.blockedReason !== undefined)?.blockedReason,
  };
}

export function scoreScaleV2(scaleId: string, answers: AnswersV2, opts: ScoreOptionsV2 = {}): ScaleScoreResultV2 {
  const scale = scaleV2ById.get(scaleId);
  if (!scale) throw new Error(`量表 ${scaleId} 不存在于 data/scales-v2.json`);
  const entry = judgmentByScaleId.get(scaleId);
  if (!entry) throw new Error(`量表 ${scaleId} 无判定配置（data/judgments-v2.json 未收录）`);
  if (entry.judgments.length === 0) {
    throw new Error(`量表 ${scaleId} 判定配置为空（judgments 数组至少 1 份）`);
  }
  const parts = entry.judgments.map((j) => runJudgment(scale, j, answers, opts));
  return guardFullyDeferred(mergeJudgmentResults(scale, parts));
}

/**
 * 全豁免守卫（统一入口，覆盖全部判定器）：某量表全部计分条目均缺失且全部被
 * deferClinical 豁免（零条已答计分条目）时，该量表不产出任何标签。
 * 否则 anyYes=false、总分 0 等会产出「肌肉力量未下降」「NRS2002 初筛阴性」类伪造阴性标签
 * （患者自助勾纯测量量表 calf/grip/gait_speed/dxa_bia 时可问题数为 0，会话直接 finished，
 * 全部条目走豁免即命中此情形）。
 * 只摘标签：deferred 快照、partial 标注、totalScore 照旧，报告页「部分计分」逻辑不受影响。
 */
function guardFullyDeferred(result: ScaleScoreResultV2): ScaleScoreResultV2 {
  if (!result.ok || result.tags.length === 0 || result.deferred.length === 0) return result;
  // 计分条目 = 明细中未排除（excluded=false）的条目；已答 = 有命中 label 或有分值
  const scored = result.details.filter((d) => !d.excluded);
  if (scored.length === 0) return result;
  const anyAnswered = scored.some((d) => d.score !== null || d.answerLabel !== null);
  if (anyAnswered) return result;
  return { ...result, tags: [] };
}

/** 批量评分：按传入顺序逐量表评分，互不影响（某量表抛错即整体抛错——确定性红线） */
export function scoreAllV2(scaleIds: string[], answers: AnswersV2, opts: ScoreOptionsV2 = {}): ScaleScoreResultV2[] {
  return scaleIds.map((id) => scoreScaleV2(id, answers, opts));
}
