/**
 * INPUT:  推荐引擎候选方案、医生逐项 保留/删除/同类替换 输入 + 操作人
 * OUTPUT: 最终方案与完整审核决策留痕（含操作人、时间、原因、调整前后编码）
 * POS:    干预方案审核的纯逻辑层；页面与 Server Action 不自行判断 keep/remove/replace。
 *         来源：需求更新说明 V2.0 §4.2「医生可保留、删除或调整候选项，所有人工调整必须记录
 *         操作人、时间、调整原因和调整前后内容」。V2 干预正文为图片/标准动作文字，不再自由改写正文，
 *         "调整"收敛为"在同类别中替换为其他干预项"（替换项由调用方解析并计算积分）。
 */
import type { RecommendedIntervention } from "@/lib/recommend";

export interface PlanReviewInput {
  action: "keep" | "remove" | "replace";
  /** action=replace 时，替换进来的候选（同类别；由调用方按积分矩阵解析并计算积分） */
  replacement?: RecommendedIntervention;
  /** 调整原因/审核备注 */
  note?: string;
}

export interface PlanDecision {
  /** 被审核的原候选编码 */
  code: string;
  action: "keep" | "remove" | "replace";
  note: string;
  /** 操作人（Demo 无鉴权，为占位标识，如 "doctor"） */
  operator: string;
  at: string;
  /** replace：原编码 */
  fromCode?: string;
  /** replace：替换后编码 */
  toCode?: string;
}

export interface PlanReviewResult {
  finalPlan: RecommendedIntervention[];
  decisions: PlanDecision[];
}

/**
 * 依据医生逐项输入形成最终方案与决策留痕。
 * 每个候选映射为 0 或 1 个最终项（删除→0；保留/同类替换→1），因此候选已满足
 * "每类 1-2 项、总数不超过 6" 时，最终方案自然不突破上限（§4.2）。
 */
export function applyPlanReview(
  candidates: readonly RecommendedIntervention[],
  inputs: Readonly<Record<string, PlanReviewInput>>,
  operator: string,
  now: Date
): PlanReviewResult {
  const finalPlan: RecommendedIntervention[] = [];
  const decisions: PlanDecision[] = [];
  const at = now.toISOString();

  for (const candidate of candidates) {
    const input = inputs[candidate.code] ?? { action: "keep" };
    const note = input.note?.trim() ?? "";

    if (input.action === "remove") {
      decisions.push({ code: candidate.code, action: "remove", note: note || "医生从候选方案中删除", operator, at });
      continue;
    }

    if (input.action === "replace" && input.replacement && input.replacement.code !== candidate.code) {
      // 同类替换：新项类别必须与原项一致（跨类替换会破坏"每类 1-2 项"约束）
      if (input.replacement.category !== candidate.category) {
        throw new Error(`同类替换要求同一类别：${candidate.category} ≠ ${input.replacement.category}`);
      }
      finalPlan.push(input.replacement);
      decisions.push({
        code: candidate.code,
        action: "replace",
        note: note || "医生同类替换候选项",
        operator,
        at,
        fromCode: candidate.code,
        toCode: input.replacement.code,
      });
      continue;
    }

    // 默认保留（含 action=replace 但未提供有效替换项的情形）
    finalPlan.push(candidate);
    decisions.push({ code: candidate.code, action: "keep", note, operator, at });
  }

  return { finalPlan, decisions };
}
