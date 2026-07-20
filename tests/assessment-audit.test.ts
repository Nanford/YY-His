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

describe("干预方案审核（V2：保留 / 删除 / 同类替换）", () => {
  /** 构造候选项（推荐引擎结构，测试只关心 code/category/name） */
  function candidate(code: string, category: string, name: string, rank: number): RecommendedIntervention {
    return {
      code, category, name, mediaType: "video", mediaSrc: `/interventions/videos/${code}.mp4`,
      sourceFile: null, text: "动作要点", score: 5, rankInCategory: rank, matchDetail: [],
    };
  }
  const candidates: RecommendedIntervention[] = [
    candidate("M06", "运动干预", "坐位抬腿踏步", 1),
    candidate("M12", "运动干预", "步行训练", 2),
    candidate("M01", "运动干预", "扶椅坐站", 3),
  ];

  it("同时形成保留、删除和同类替换三类决策，并记录操作人/前后编码", () => {
    const replacement = { ...candidate("M07", "运动干预", "墙壁俯卧撑", 2), score: 3 };
    const result = applyPlanReview(
      candidates,
      {
        M06: { action: "keep" },
        M12: { action: "remove", note: "步行受限" },
        M01: { action: "replace", replacement, note: "改用上肢训练" },
      },
      "doctor",
      new Date("2026-07-19T01:00:00.000Z")
    );

    expect(result.finalPlan.map((item) => item.code)).toEqual(["M06", "M07"]);
    expect(result.decisions.map((item) => item.action)).toEqual(["keep", "remove", "replace"]);
    expect(result.decisions[2]).toMatchObject({
      action: "replace", fromCode: "M01", toCode: "M07", operator: "doctor", note: "改用上肢训练",
    });
  });

  it("跨类别替换被拒绝（破坏每类 1-2 项约束）", () => {
    const dietItem = candidate("D03", "膳食干预", "优质蛋白加餐", 1);
    expect(() =>
      applyPlanReview(candidates, { M06: { action: "replace", replacement: dietItem } }, "doctor", new Date())
    ).toThrow(/同一类别/);
  });

  it("允许候选与最终方案都为空", () => {
    expect(applyPlanReview([], {}, "doctor", new Date()).finalPlan).toEqual([]);
  });
});
