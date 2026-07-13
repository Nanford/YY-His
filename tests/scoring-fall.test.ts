/**
 * INPUT:  src/lib/scoring/fall.ts
 * OUTPUT: 跌倒风险筛查判定用例
 * POS:    医学核心测试。判定依据：量表题目_Demo.txt"三、跌倒风险筛查"——任意一题"是"即为阳性。
 */
import { describe, expect, it } from "vitest";
import { scoreFall } from "@/lib/scoring";

function answers(q1: number, q2: number, q3: number): Record<string, number> {
  return { fall_1: q1, fall_2: q2, fall_3: q3 };
}

describe("跌倒风险筛查", () => {
  it("全部为否 → 阴性", () => {
    const r = scoreFall(answers(0, 0, 0));
    expect(r.tags[0]).toMatchObject({ tag: "跌倒风险筛查阴性", level: "是", score: 0 });
  });

  it.each([
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ])("任一题为是（%i,%i,%i）→ 阳性", (q1, q2, q3) => {
    const r = scoreFall(answers(q1, q2, q3));
    expect(r.tags[0].tag).toBe("跌倒风险筛查阳性");
  });

  it("多题为是 → 阳性，score 记录命中数", () => {
    const r = scoreFall(answers(1, 1, 1));
    expect(r.tags[0]).toMatchObject({ tag: "跌倒风险筛查阳性", score: 3 });
  });

  it("三题必须全部作答才出结论", () => {
    // 即使已答题中有"是"也不提前判阳性——需求文档要求完成全部采集后统一分析
    const r = scoreFall({ fall_1: 1 });
    expect(r.ok).toBe(false);
    expect(r.tags).toHaveLength(0);
    expect(r.missing).toEqual(["fall_2", "fall_3"]);
  });
});
