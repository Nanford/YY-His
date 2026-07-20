/**
 * INPUT:  src/lib/scoring（ScoreOptions.deferClinical）
 * OUTPUT: Demo 口径（2026-07-20 用户拍板）用例：医生检查题（测量/临床观察类）缺失可豁免计分、
 *         先出部分计分报告；普通问答题缺失在任何模式下都阻断评分；strict 模式（默认）行为不变。
 * POS:    医学核心测试。豁免范围以 data/scales.json 的 measurement/observerAssisted 标记为准：
 *         tcm_9(BMI)、tcm_24(面色晦黯)、tcm_28(腹围)、tcm_32/33(舌象)；mnasf_E(神经心理)、
 *         mnasf_F(BMI)、mnasf_F_alt(小腿围)。
 */
import { describe, expect, it } from "vitest";
import { scoreAll, scoreMnasf, scoreTcm } from "@/lib/scoring";

/** 33 题全填 base 分再按题号覆盖；omit 中的题号删除（模拟未答/未补录） */
function tcmAnswers(overrides: Record<number, number> = {}, omit: number[] = [], base = 1): Record<string, number> {
  const a: Record<string, number> = {};
  for (let no = 1; no <= 33; no++) {
    if (omit.includes(no)) continue;
    a[`tcm_${no}`] = overrides[no] ?? base;
  }
  return a;
}

describe("deferClinical — 中医体质：观察/测量题豁免计分", () => {
  it("缺 9/24/28/32/33 医生题：豁免后照常出标签，deferred 按题序如实列明", () => {
    // 血瘀质对应题 19/22/24/33：24（面色晦黯）、33（舌象）豁免后按 19+22 计 9 分 → 倾向是
    const r = scoreTcm(tcmAnswers({ 19: 5, 22: 4 }, [9, 24, 28, 32, 33]), { deferClinical: true });
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.deferred).toEqual(["tcm_9", "tcm_24", "tcm_28", "tcm_32", "tcm_33"]);
    expect(r.tags.find((t) => t.tag === "血瘀质")).toMatchObject({ level: "倾向是", score: 9 });
  });

  it("同样的缺口在 strict 模式（默认）下仍阻断评分", () => {
    const r = scoreTcm(tcmAnswers({}, [32, 33]));
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["tcm_32", "tcm_33"]);
    expect(r.deferred).toEqual([]);
  });

  it("普通问答题缺失即使 deferClinical 也阻断（不得借豁免编造答案）", () => {
    const r = scoreTcm(tcmAnswers({}, [1]), { deferClinical: true });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["tcm_1"]);
    expect(r.deferred).toEqual([]);
  });

  it("痰湿质（9/16/28/32）三题豁免后按 16 单题记分，≤8 不产生标签", () => {
    const r = scoreTcm(tcmAnswers({ 16: 5 }, [9, 28, 32]), { deferClinical: true });
    expect(r.ok).toBe(true);
    expect(r.tags.find((t) => t.tag === "痰湿质")).toBeUndefined();
  });
});

describe("deferClinical — MNA-SF：E（观察）/F（测量）豁免", () => {
  const baseAD = { mnasf_A: 2, mnasf_B: 3, mnasf_C: 2, mnasf_D: 2 }; // A~D 合计 9

  it("E 与 F/F替代 均缺：豁免后按 A~D 出标签", () => {
    const r = scoreMnasf({ ...baseAD }, { deferClinical: true });
    expect(r.ok).toBe(true);
    expect(r.deferred).toEqual(["mnasf_E", "mnasf_F"]);
    expect(r.tags[0]).toMatchObject({ tag: "存在营养不良风险", score: 9 }); // 8~11 区间
  });

  it("仅缺 F：E 已答计入总分，F 豁免", () => {
    const r = scoreMnasf({ ...baseAD, mnasf_E: 2 }, { deferClinical: true });
    expect(r.ok).toBe(true);
    expect(r.deferred).toEqual(["mnasf_F"]);
    expect(r.tags[0]).toMatchObject({ tag: "存在营养不良风险", score: 11 });
  });

  it("A~D 普通题缺失即使 deferClinical 也阻断", () => {
    const r = scoreMnasf({ mnasf_B: 3, mnasf_C: 2, mnasf_D: 2, mnasf_E: 2, mnasf_F: 3 }, { deferClinical: true });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["mnasf_A"]);
    expect(r.deferred).toEqual([]);
  });

  it("strict 模式下缺 F 仍阻断（医生端补录路径口径不变）", () => {
    const r = scoreMnasf({ ...baseAD, mnasf_E: 2 });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["mnasf_F"]);
  });
});

describe("deferClinical — FRAIL/跌倒无医生题，行为不变", () => {
  it("FRAIL 缺题仍阻断（scoreAll 集成口径）", () => {
    const r = scoreAll(["frail"], { frail_1: 1, frail_2: 0, frail_3: 0, frail_4: 0 }, { deferClinical: true });
    expect(r.incompleteScaleIds).toEqual(["frail"]);
    expect(r.results[0].missing).toEqual(["frail_5"]);
  });

  it("跌倒缺题仍阻断（scoreAll 集成口径）", () => {
    const r = scoreAll(["fall"], { fall_1: 0, fall_2: 0 }, { deferClinical: true });
    expect(r.incompleteScaleIds).toEqual(["fall"]);
    expect(r.results[0].missing).toEqual(["fall_3"]);
  });
});
