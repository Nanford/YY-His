/**
 * INPUT:  src/lib/scoring/tcm.ts
 * OUTPUT: 中医体质辨识判定用例：偏颇体质三档、平和质反向计分、是/基本是、多体质并存
 * POS:    医学核心测试（全项目最易出错处）。判定依据：量表题目_Demo.txt"五、中医体质判定规则"。
 */
import { describe, expect, it } from "vitest";
import { scoreTcm } from "@/lib/scoring";

/** 33 题全填 base 分，再按题号覆盖。默认 base=1（全部"没有"） */
function answers(overrides: Record<number, number> = {}, base = 1): Record<string, number> {
  const a: Record<string, number> = {};
  for (let no = 1; no <= 33; no++) {
    a[`tcm_${no}`] = overrides[no] ?? base;
  }
  return a;
}

describe("中医体质辨识 — 偏颇体质三档判定", () => {
  // 气虚质对应题 2、3、4、14
  it("4 题合计 11 分（下边界）→ 气虚质·是", () => {
    const r = scoreTcm(answers({ 2: 3, 3: 3, 4: 3, 14: 2 }));
    const qixu = r.tags.find((t) => t.tag === "气虚质");
    expect(qixu).toMatchObject({ tag: "气虚质", level: "是", score: 11 });
  });

  it("合计 9 分（下边界）→ 气虚质·倾向是", () => {
    const r = scoreTcm(answers({ 2: 3, 3: 2, 4: 2, 14: 2 }));
    expect(r.tags.find((t) => t.tag === "气虚质")).toMatchObject({ level: "倾向是", score: 9 });
  });

  it("合计 10 分（上边界）→ 气虚质·倾向是", () => {
    const r = scoreTcm(answers({ 2: 3, 3: 3, 4: 2, 14: 2 }));
    expect(r.tags.find((t) => t.tag === "气虚质")).toMatchObject({ level: "倾向是", score: 10 });
  });

  it("合计 8 分 → 气虚质不产生标签", () => {
    const r = scoreTcm(answers({ 2: 2, 3: 2, 4: 2, 14: 2 }));
    expect(r.tags.find((t) => t.tag === "气虚质")).toBeUndefined();
  });

  it("多个偏颇体质同时命中全部保留（需求：不强制单选）", () => {
    // 气虚质（2,3,4,14）=11 且 阳虚质（11,12,13,29）=12
    const r = scoreTcm(answers({ 2: 3, 3: 3, 4: 3, 14: 2, 11: 3, 12: 3, 13: 3, 29: 3 }));
    const tags = r.tags.map((t) => t.tag);
    expect(tags).toContain("气虚质");
    expect(tags).toContain("阳虚质");
  });
});

describe("中医体质辨识 — 平和质（含反向计分）", () => {
  it("全部答'没有' → 平和质·是（题2/4/5/13 反向计分为 5）", () => {
    const r = scoreTcm(answers());
    expect(r.tags).toHaveLength(1);
    // 总分 = 题1(1) + 反向后 5×4 = 21
    expect(r.tags[0]).toMatchObject({ tag: "平和质", level: "是", score: 21 });
    const no2 = r.tags[0].detail.find((d) => d.no === "2");
    expect(no2).toMatchObject({ rawScore: 1, effectiveScore: 5, reversed: true });
    const no1 = r.tags[0].detail.find((d) => d.no === "1");
    expect(no1).toMatchObject({ rawScore: 1, effectiveScore: 1, reversed: false });
  });

  it("总分≥17 但某偏颇体质达 9 分 → 平和质·基本是，且该体质'倾向是'并存", () => {
    // 湿热质（23,25,27,30）= 3+2+2+2 = 9；平和质总分 21 不受影响
    const r = scoreTcm(answers({ 23: 3, 25: 2, 27: 2, 30: 2 }));
    expect(r.tags.find((t) => t.tag === "平和质")).toMatchObject({ level: "基本是", score: 21 });
    expect(r.tags.find((t) => t.tag === "湿热质")).toMatchObject({ level: "倾向是", score: 9 });
  });

  it("某偏颇体质达 11 分 → 平和质不成立（其他体质须＜10）", () => {
    const r = scoreTcm(answers({ 23: 3, 25: 3, 27: 3, 30: 2 }));
    expect(r.tags.find((t) => t.tag === "平和质")).toBeUndefined();
    expect(r.tags.find((t) => t.tag === "湿热质")).toMatchObject({ level: "是", score: 11 });
  });

  it("平和质总分＜17 → 平和质不成立", () => {
    // 题1 答 1，反向题全答 5（反向后各 1 分）：总分 = 1 + 4 = 5
    const r = scoreTcm(answers({ 2: 5, 4: 5, 5: 5, 13: 5 }));
    expect(r.tags.find((t) => t.tag === "平和质")).toBeUndefined();
  });
});

describe("中医体质辨识 — 完整性与特殊计分题", () => {
  it("33 题未答全不出结论", () => {
    const partial = answers();
    delete (partial as Record<string, number>)["tcm_33"];
    const r = scoreTcm(partial);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["tcm_33"]);
  });

  it("特殊计分题（题9 BMI 档位）接受 1~5 档分值", () => {
    const r = scoreTcm(answers({ 9: 4 }));
    expect(r.ok).toBe(true);
  });

  it("特殊计分题分值越界抛错", () => {
    expect(() => scoreTcm(answers({ 9: 0 }))).toThrow(/不在合法选项/);
  });
});
