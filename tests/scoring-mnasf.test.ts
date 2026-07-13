/**
 * INPUT:  src/lib/scoring/mnasf.ts
 * OUTPUT: MNA-SF 营养评估判定边界用例 + F/F替代 分支用例
 * POS:    医学核心测试。判定依据：量表题目_Demo.txt"二、MNA-SF营养评估"——12~14 营养正常；8~11 营养不良风险；0~7 营养不良。
 */
import { describe, expect, it } from "vitest";
import { scoreMnasf } from "@/lib/scoring";

type Answers = Record<string, number>;

/** 组装 A~E + F 的答案；F 传 null 表示不作答 */
function answers(a: number, b: number, c: number, d: number, e: number, f: number | null, fAlt?: number): Answers {
  const result: Answers = { mnasf_A: a, mnasf_B: b, mnasf_C: c, mnasf_D: d, mnasf_E: e };
  if (f !== null) result["mnasf_F"] = f;
  if (fAlt !== undefined) result["mnasf_F_alt"] = fAlt;
  return result;
}

describe("MNA-SF 营养评估", () => {
  it("14 分（满分）→ 营养正常", () => {
    const r = scoreMnasf(answers(2, 3, 2, 2, 2, 3));
    expect(r.tags[0]).toMatchObject({ tag: "营养正常", level: "是", score: 14 });
  });

  it("12 分（下边界）→ 营养正常", () => {
    const r = scoreMnasf(answers(2, 3, 2, 2, 2, 1));
    expect(r.tags[0]).toMatchObject({ tag: "营养正常", score: 12 });
  });

  it("11 分（上边界）→ 存在营养不良风险", () => {
    const r = scoreMnasf(answers(2, 3, 2, 2, 2, 0));
    expect(r.tags[0]).toMatchObject({ tag: "存在营养不良风险", score: 11 });
  });

  it("8 分（下边界）→ 存在营养不良风险", () => {
    const r = scoreMnasf(answers(1, 1, 1, 2, 1, 2));
    expect(r.tags[0]).toMatchObject({ tag: "存在营养不良风险", score: 8 });
  });

  it("7 分（上边界）→ 营养不良", () => {
    const r = scoreMnasf(answers(1, 1, 1, 0, 1, 3));
    expect(r.tags[0]).toMatchObject({ tag: "营养不良", score: 7 });
  });

  it("0 分 → 营养不良", () => {
    const r = scoreMnasf(answers(0, 0, 0, 0, 0, 0));
    expect(r.tags[0]).toMatchObject({ tag: "营养不良", score: 0 });
  });

  it("无 BMI 时用 F替代（小腿围）计分", () => {
    // 来源：量表题目_Demo.txt "F替代. 如果无法得到BMI，用小腿围（CC）"
    const r = scoreMnasf(answers(2, 3, 2, 2, 2, null, 3));
    expect(r.ok).toBe(true);
    expect(r.tags[0]).toMatchObject({ tag: "营养正常", score: 14 });
    expect(r.tags[0].detail.map((d) => d.questionId)).toContain("mnasf_F_alt");
  });

  it("F 与 F替代 同时存在时只用 F，不叠加", () => {
    const r = scoreMnasf(answers(2, 3, 2, 2, 2, 0, 3));
    expect(r.tags[0].score).toBe(11); // 若错误叠加 F替代 的 3 分会变成 14
    const ids = r.tags[0].detail.map((d) => d.questionId);
    expect(ids).toContain("mnasf_F");
    expect(ids).not.toContain("mnasf_F_alt");
  });

  it("F 与 F替代 都缺 → 不出结论，提示补录", () => {
    const r = scoreMnasf(answers(2, 3, 2, 2, 2, null));
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("mnasf_F");
  });

  it("非法分值抛错（D 题只有 0/2 两档）", () => {
    expect(() => scoreMnasf(answers(2, 3, 2, 1, 2, 3))).toThrow(/不在合法选项/);
  });
});
