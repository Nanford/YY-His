/**
 * INPUT:  推荐引擎候选方案、医生逐项 保留/删除/同类替换 输入 + 操作人
 * OUTPUT: 最终方案与完整审核决策留痕（含操作人、时间、原因、调整前后编码）
 * POS:    干预方案审核的纯逻辑层；页面与 Server Action 不自行判断 keep/remove/replace。
 *         来源：需求更新说明 V2.0 §4.2「医生可保留、删除或调整候选项，所有人工调整必须记录
 *         操作人、时间、调整原因和调整前后内容」。V2 干预正文为图片/标准动作文字，不再自由改写正文，
 *         "调整"收敛为"在同类别中替换为其他干预项"（替换项由调用方解析并计算积分）。
 */
import {
  FORBIDDEN_SCORE_V2,
  MAX_PER_CATEGORY_V2,
  type PlanCandidateItemV2,
} from "@/lib/recommend-v2";
import { scoringCategories } from "@/lib/rules";

export interface PlanReviewInput {
  action: "keep" | "remove" | "replace";
  /** action=replace 时，替换进来的候选（同类别；由调用方按积分矩阵解析并计算积分） */
  replacement?: PlanCandidateItemV2;
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
  finalPlan: PlanCandidateItemV2[];
  decisions: PlanDecision[];
}

const CATEGORY_LABELS = new Set(scoringCategories.map((category) => category.label));

function assertPlanItemShape(item: PlanCandidateItemV2, source: string): void {
  if (!item.code || !item.category || !item.categoryLabel) {
    throw new Error(source + "包含不完整的干预项");
  }
  if (!CATEGORY_LABELS.has(item.categoryLabel)) {
    throw new Error(source + "包含未知干预类别：" + item.categoryLabel);
  }
}

function assertPlanItemSafe(item: PlanCandidateItemV2, source: string): void {
  assertPlanItemShape(item, source);
  if (item.contributions.some((contribution) => contribution.score === FORBIDDEN_SCORE_V2)) {
    throw new Error(source + "包含本患者 -100 禁忌项：" + item.code);
  }
}

function assertReason(action: PlanReviewInput["action"], code: string, note: string): void {
  if (note.length > 500) throw new Error("审核说明过长：" + code);
  if ((action === "remove" || action === "replace") && note.length === 0) {
    throw new Error((action === "remove" ? "删除" : "替换") + "必须填写明确审核理由：" + code);
  }
}

/**
 * 依据医生逐项输入形成最终方案与决策留痕。
 * 每个候选映射为 0 或 1 个最终项（删除→0；保留/同类替换→1），因此候选已满足
 * "每类 1-2 项"（V2：每类普通项至多 2 项；100 强制项不占普通名额）时，最终方案自然不突破上限。
 */
export function applyPlanReview(
  candidates: readonly PlanCandidateItemV2[],
  inputs: Readonly<Record<string, PlanReviewInput>>,
  operator: string,
  now: Date
): PlanReviewResult {
  const finalPlan: PlanCandidateItemV2[] = [];
  const decisions: PlanDecision[] = [];
  const at = now.toISOString();
  const candidateCodes = new Set<string>();
  const finalCodes = new Set<string>();
  const ordinaryCountByCategory = new Map<string, number>();

  for (const candidate of candidates) {
    assertPlanItemShape(candidate, "候选方案");
    if (candidateCodes.has(candidate.code)) {
      throw new Error("候选方案编码重复：" + candidate.code);
    }
    candidateCodes.add(candidate.code);
  }

  const appendFinalItem = (item: PlanCandidateItemV2): void => {
    assertPlanItemSafe(item, "最终方案");
    if (finalCodes.has(item.code)) {
      throw new Error("最终干预编码重复：" + item.code);
    }
    if (!item.forced) {
      const nextCount = (ordinaryCountByCategory.get(item.categoryLabel) ?? 0) + 1;
      if (nextCount > MAX_PER_CATEGORY_V2) {
        throw new Error("最终方案每类普通干预最多 " + MAX_PER_CATEGORY_V2 + " 项：" + item.categoryLabel);
      }
      ordinaryCountByCategory.set(item.categoryLabel, nextCount);
    }
    finalCodes.add(item.code);
    finalPlan.push(item);
  };

  for (const candidate of candidates) {
    const input = inputs[candidate.code] ?? { action: "keep" };
    const note = input.note?.trim() ?? "";
    if (input.action !== "keep" && input.action !== "remove" && input.action !== "replace") {
      throw new Error("审核动作无效：" + candidate.code);
    }
    assertReason(input.action, candidate.code, note);

    if (input.action === "remove") {
      decisions.push({ code: candidate.code, action: "remove", note: note || "医生从候选方案中删除", operator, at });
      continue;
    }

    if (input.action === "replace") {
      if (!input.replacement) throw new Error("未提供替换项：" + candidate.code);
      if (input.replacement.code === candidate.code) throw new Error("替换项不能与原项相同：" + candidate.code);
      // 同类替换：新项类别必须与原项一致（跨类替换会破坏"每类 1-2 项"约束）
      if (
        input.replacement.category !== candidate.category ||
        input.replacement.categoryLabel !== candidate.categoryLabel
      ) {
        throw new Error(`同类替换要求同一类别：${candidate.category} ≠ ${input.replacement.category}`);
      }
      appendFinalItem(input.replacement);
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

    // 强制项是否可删除尚未形成最终策略；此处不额外限制，统一按医生提交动作留痕。
    appendFinalItem(candidate);
    decisions.push({ code: candidate.code, action: "keep", note, operator, at });
  }

  return { finalPlan, decisions };
}
