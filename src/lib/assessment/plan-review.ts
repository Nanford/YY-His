/**
 * INPUT:  推荐引擎候选方案、医生逐项保留/删除/正文调整输入
 * OUTPUT: 最终方案与完整审核决策留痕
 * POS:    干预方案审核的纯逻辑层；页面与 Server Action 不自行判断 keep/remove/adjust。
 */
import type { RecommendedIntervention } from "@/lib/recommend";

export interface PlanReviewInput {
  keep: boolean;
  plan?: string;
  note?: string;
}

export interface PlanDecision {
  tag: string;
  action: "keep" | "remove" | "adjust";
  note: string;
  at: string;
  originalPlan?: string;
  finalPlan?: string;
}

export interface PlanReviewResult {
  finalPlan: RecommendedIntervention[];
  decisions: PlanDecision[];
}

export function applyPlanReview(
  candidates: readonly RecommendedIntervention[],
  inputs: Readonly<Record<string, PlanReviewInput>>,
  now: Date
): PlanReviewResult {
  const finalPlan: RecommendedIntervention[] = [];
  const decisions: PlanDecision[] = [];
  const at = now.toISOString();

  for (const candidate of candidates) {
    const input = inputs[candidate.tag] ?? { keep: false };
    const note = input.note?.trim() ?? "";
    if (!input.keep) {
      decisions.push({
        tag: candidate.tag,
        action: "remove",
        note: note || "医生从候选方案中删除",
        at,
      });
      continue;
    }

    const submittedPlan = input.plan?.trim() || candidate.plan;
    if (submittedPlan !== candidate.plan) {
      finalPlan.push({ ...candidate, plan: submittedPlan });
      decisions.push({
        tag: candidate.tag,
        action: "adjust",
        note: note || "医生调整执行方案",
        at,
        originalPlan: candidate.plan,
        finalPlan: submittedPlan,
      });
      continue;
    }

    finalPlan.push(candidate);
    decisions.push({ tag: candidate.tag, action: "keep", note, at });
  }

  return { finalPlan, decisions };
}
