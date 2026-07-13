/**
 * INPUT:  src/lib/scoring/frail.ts
 * OUTPUT: FRAIL 衰弱评估判定的全档位边界用例
 * POS:    医学核心测试。判定依据：量表题目_Demo.txt"一、FRAIL衰弱评估"——0项无衰弱；1～2项衰弱前期；≥3项衰弱。
 */
import { describe, expect, it } from "vitest";
import { scoreFrail } from "@/lib/scoring";

function answers(scores: number[]): Record<string, number> {
  return Object.fromEntries(scores.map((s, i) => [`frail_${i + 1}`, s]));
}

describe("FRAIL 衰弱评估", () => {
  it("0 分 → 无衰弱", () => {
    const r = scoreFrail(answers([0, 0, 0, 0, 0]));
    expect(r.ok).toBe(true);
    expect(r.tags).toHaveLength(1);
    expect(r.tags[0]).toMatchObject({ tag: "无衰弱", level: "是", score: 0 });
  });

  it("1 分（下边界）→ 衰弱前期", () => {
    const r = scoreFrail(answers([1, 0, 0, 0, 0]));
    expect(r.tags[0]).toMatchObject({ tag: "衰弱前期", score: 1 });
  });

  it("2 分（上边界）→ 衰弱前期", () => {
    const r = scoreFrail(answers([1, 1, 0, 0, 0]));
    expect(r.tags[0]).toMatchObject({ tag: "衰弱前期", score: 2 });
  });

  it("3 分（下边界）→ 衰弱", () => {
    const r = scoreFrail(answers([1, 1, 1, 0, 0]));
    expect(r.tags[0]).toMatchObject({ tag: "衰弱", score: 3 });
  });

  it("5 分（满分）→ 衰弱", () => {
    const r = scoreFrail(answers([1, 1, 1, 1, 1]));
    expect(r.tags[0]).toMatchObject({ tag: "衰弱", score: 5 });
  });

  it("缺答案时不出结论，报告缺失题目", () => {
    const r = scoreFrail({ frail_1: 1, frail_2: 0 });
    expect(r.ok).toBe(false);
    expect(r.tags).toHaveLength(0);
    expect(r.missing).toEqual(["frail_3", "frail_4", "frail_5"]);
  });

  it("非法分值直接抛错（防止归一化层污染判定）", () => {
    expect(() => scoreFrail(answers([2, 0, 0, 0, 0]))).toThrow(/不在合法选项/);
  });

  it("得分明细完整可追溯", () => {
    const r = scoreFrail(answers([1, 0, 1, 0, 0]));
    expect(r.tags[0].detail).toHaveLength(5);
    expect(r.tags[0].detail[0]).toMatchObject({ questionId: "frail_1", rawScore: 1, effectiveScore: 1, reversed: false });
  });
});
