import { describe, expect, it } from "vitest";
import { appendAnswerEditHistory, readAnswerEditHistory } from "@/lib/assessment/audit";
import { applyPlanReview } from "@/lib/assessment/plan-review";
import type { RecommendedIntervention } from "@/lib/recommend";

describe("答案修改留痕", () => {
  it("只记录发生变化的字段并保留既有历史", () => {
    const previous = { optionLabel: "否", score: 0, rawText: "没有", source: "button", status: "confirmed" };
    const next = { optionLabel: "是", score: 1, rawText: "没有", source: "doctor", status: "confirmed" };
    const history = appendAnswerEditHistory(
      [{ at: "2026-01-01T00:00:00.000Z", field: "score", from: null, to: 0, operator: "system", reason: "初始化" }],
      previous,
      next,
      { at: "2026-07-14T01:00:00.000Z", operator: "doctor", reason: "医生修改标准答案" }
    );

    expect(history).toHaveLength(4);
    expect(history.slice(1).map((item) => item.field)).toEqual(["optionLabel", "score", "source"]);
    expect(history[2]).toMatchObject({ from: 0, to: 1, operator: "doctor" });
  });

  it("忽略旧版本中的无效 JSON 记录", () => {
    expect(readAnswerEditHistory([null, { foo: "bar" }])).toEqual([]);
  });
});

describe("干预方案审核", () => {
  const candidates: RecommendedIntervention[] = [
    { tag: "八段锦", category: "运动干预", plan: "原方案A", triggeredBy: [] },
    { tag: "太极拳", category: "运动干预", plan: "原方案B", triggeredBy: [] },
    { tag: "平衡训练", category: "运动干预", plan: "原方案C", triggeredBy: [] },
  ];

  it("同时形成保留、删除和调整三类决策", () => {
    const result = applyPlanReview(
      candidates,
      {
        八段锦: { keep: true, plan: "原方案A" },
        太极拳: { keep: false, note: "膝关节不适" },
        平衡训练: { keep: true, plan: "调整后方案C", note: "降低强度" },
      },
      new Date("2026-07-14T01:00:00.000Z")
    );

    expect(result.finalPlan.map((item) => [item.tag, item.plan])).toEqual([
      ["八段锦", "原方案A"],
      ["平衡训练", "调整后方案C"],
    ]);
    expect(result.decisions.map((item) => item.action)).toEqual(["keep", "remove", "adjust"]);
    expect(result.decisions[2]).toMatchObject({ originalPlan: "原方案C", finalPlan: "调整后方案C" });
  });

  it("允许候选与最终方案都为空", () => {
    expect(applyPlanReview([], {}, new Date()).finalPlan).toEqual([]);
  });
});
