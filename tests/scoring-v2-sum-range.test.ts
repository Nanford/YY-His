/**
 * INPUT:  data/judgments-v2.json（sumRange 判定配置）、data/scales-v2.json（题库）
 * OUTPUT: sumRange 判定器边界用例：ADL 100/95/60/40/0 分档与逐题明细、IADL 8/7/6/5/4/3/2/0、
 *         FRAIL 0/1/2/3/5 分档 + Q4/Q5（系统读取）deferClinical 豁免、
 *         MNA-SF 14/12/11 两档 + 临床题豁免、Mini-Cog Q2/Q3 组合 5/3/2/0 + Q1 不计分、
 *         GDS-15 8/9/11/12/15、GAD-7 9/10/14/15/21、AIS 3/4/5/6/24（M10.3a 新增）、
 *         Morse 24/25/44/45 边界 + 系统读取条目豁免、Lubben 11/12/23/24、疼痛 NRS 0/1/3/4/6/7/10（M10.3b 新增）
 * POS:    V2 评分引擎回归保险（来源：02 表各量表总分区间判定规则）。医学规则变更必须先改源文件。
 */
import { describe, expect, it } from "vitest";
import { scoreScaleV2, type AnswersV2 } from "@/lib/scoring-v2";
import { resolveSumRangeTagV2 } from "@/lib/scoring-v2/sum-range";
import { judgmentByScaleId, scaleV2ById, type SumRangeJudgmentV2 } from "@/lib/rules/v2";
import { optByScore } from "./scoring-v2-helpers";

const judgmentOf = (scaleId: string): SumRangeJudgmentV2 => {
  const j = judgmentByScaleId.get(scaleId)!.judgments.find((x) => x.type === "sumRange");
  if (!j || j.type !== "sumRange") throw new Error("测试前提失败：判定类型不是 sumRange");
  return j;
};

/** 给 sumRange 量表构造答案：itemId → 目标分值 */
function sumAnswers(scaleId: string, scores: Record<string, number>): AnswersV2 {
  const answers: AnswersV2 = {};
  for (const [itemId, score] of Object.entries(scores)) answers[itemId] = optByScore(scaleId, itemId, score);
  return answers;
}

describe("sumRange 区间解析（直接测不可达总分的区间归属）", () => {
  const adl = judgmentOf("adl");
  it.each([
    [100, "ADL_DEPENDENCE_NONE"], [99, "ADL_DEPENDENCE_MILD"], [61, "ADL_DEPENDENCE_MILD"],
    [60, "ADL_DEPENDENCE_MODERATE"], [41, "ADL_DEPENDENCE_MODERATE"], [40, "ADL_DEPENDENCE_SEVERE"],
    [0, "ADL_DEPENDENCE_SEVERE"],
  ])("ADL 总分 %i → %s", (total, tag) => {
    expect(resolveSumRangeTagV2(adl, total)).toBe(tag);
  });
  it("总分超出区间覆盖范围抛错（规则数据异常）", () => {
    expect(() => resolveSumRangeTagV2(adl, 101)).toThrow();
  });
});

describe("ADL（Barthel，10 题 0–100）", () => {
  const items = scaleV2ById.get("adl")!.items.map((i) => i.id);
  it("全独立 100 分 → 无依赖，逐题明细正确", () => {
    const r = scoreScaleV2("adl", sumAnswers("adl", {
      adl_1: 10, adl_2: 5, adl_3: 5, adl_4: 10, adl_5: 10, adl_6: 10, adl_7: 10, adl_8: 15, adl_9: 15, adl_10: 10,
    }));
    expect(r.ok).toBe(true);
    expect(r.totalScore).toBe(100);
    expect(r.tags).toEqual([{ code: "ADL_DEPENDENCE_NONE", name: "无依赖" }]);
    expect(r.partial).toBe(false);
    expect(r.details).toHaveLength(10);
    expect(r.details.map((d) => d.score)).toEqual([10, 5, 5, 10, 10, 10, 10, 15, 15, 10]);
    expect(r.details.every((d) => !d.excluded && d.answerLabel !== null)).toBe(true);
  });
  it.each([
    [95, "ADL_DEPENDENCE_MILD"], [65, "ADL_DEPENDENCE_MILD"],
    [60, "ADL_DEPENDENCE_MODERATE"], [45, "ADL_DEPENDENCE_MODERATE"],
    [40, "ADL_DEPENDENCE_SEVERE"], [0, "ADL_DEPENDENCE_SEVERE"],
  ])("总分 %i → %s", (total, tag) => {
    // 从满分扣分到目标值：ADL 选项分值均为 5 的倍数，total 必为 5 的倍数
    let remain = 100 - total;
    const scores: Record<string, number> = {};
    const max: Record<string, number> = { adl_1: 10, adl_2: 5, adl_3: 5, adl_4: 10, adl_5: 10, adl_6: 10, adl_7: 10, adl_8: 15, adl_9: 15, adl_10: 10 };
    for (const id of items) {
      const cut = Math.min(remain, max[id]);
      scores[id] = max[id] - cut;
      remain -= cut;
    }
    const r = scoreScaleV2("adl", sumAnswers("adl", scores));
    expect(r.totalScore).toBe(total);
    expect(r.tags[0].code).toBe(tag);
  });
  it("正式问题缺失一律阻断（deferClinical 也不豁免）", () => {
    const answers = sumAnswers("adl", Object.fromEntries(items.slice(1).map((id) => [id, 0])));
    const r = scoreScaleV2("adl", answers, { deferClinical: true });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["adl_1"]);
    expect(r.deferred).toEqual([]);
    expect(r.tags).toEqual([]);
    expect(r.totalScore).toBeNull();
  });
});

describe("IADL（8 题 0/1，总分 0–8）", () => {
  const items = scaleV2ById.get("iadl")!.items.map((i) => i.id);
  it.each([
    [8, "IADL_NORMAL"], [7, "IADL_DEPENDENCE_MILD"], [6, "IADL_DEPENDENCE_MILD"],
    [5, "IADL_DEPENDENCE_MODERATE"], [4, "IADL_DEPENDENCE_MODERATE"], [3, "IADL_DEPENDENCE_MODERATE"],
    [2, "IADL_DEPENDENCE_SEVERE"], [0, "IADL_DEPENDENCE_SEVERE"],
  ])("总分 %i → %s", (total, tag) => {
    const scores: Record<string, number> = {};
    items.forEach((id, idx) => (scores[id] = idx < total ? 1 : 0));
    const r = scoreScaleV2("iadl", sumAnswers("iadl", scores));
    expect(r.totalScore).toBe(total);
    expect(r.tags[0].code).toBe(tag);
  });
});

describe("FRAIL（5 题各 1/0）", () => {
  const all = (yesIds: string[]): AnswersV2 =>
    sumAnswers("frail", Object.fromEntries(["frail_1", "frail_2", "frail_3", "frail_4", "frail_5"].map((id) => [id, yesIds.includes(id) ? 1 : 0])));
  it.each([
    [[], 0, "FRAIL_NONE"],
    [["frail_1"], 1, "FRAIL_PREFRAIL"],
    [["frail_1", "frail_2"], 2, "FRAIL_PREFRAIL"],
    [["frail_1", "frail_2", "frail_3"], 3, "FRAIL_FRAIL"],
    [["frail_1", "frail_2", "frail_3", "frail_4", "frail_5"], 5, "FRAIL_FRAIL"],
  ])("是 %j → 总分 %i → %s", (yesIds: string[], total: number, tag: string) => {
    const r = scoreScaleV2("frail", all(yesIds));
    expect(r.totalScore).toBe(total);
    expect(r.tags[0].code).toBe(tag);
  });
  it("Q4/Q5（系统读取）缺失 + deferClinical=true → 豁免计分，按已答 3 题出标签", () => {
    const partial: AnswersV2 = {
      frail_1: optByScore("frail", "frail_1", 1),
      frail_2: optByScore("frail", "frail_2", 1),
      frail_3: optByScore("frail", "frail_3", 1),
    };
    const r = scoreScaleV2("frail", partial, { deferClinical: true });
    expect(r.ok).toBe(true);
    expect(r.partial).toBe(true);
    expect(r.deferred).toEqual(["frail_4", "frail_5"]);
    expect(r.missing).toEqual([]);
    expect(r.totalScore).toBe(3);
    expect(r.tags[0].code).toBe("FRAIL_FRAIL");
  });
  it("Q4/Q5 缺失 + deferClinical=false → 阻断不出标签", () => {
    const r = scoreScaleV2("frail", {
      frail_1: optByScore("frail", "frail_1", 0),
      frail_2: optByScore("frail", "frail_2", 0),
      frail_3: optByScore("frail", "frail_3", 0),
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["frail_4", "frail_5"]);
    expect(r.tags).toEqual([]);
  });
  it("系统读取题已答但 Q1（正式问题）缺失 → 仍阻断且不计入 deferred", () => {
    const answers = all(["frail_4"]);
    delete answers["frail_1"];
    const r = scoreScaleV2("frail", answers, { deferClinical: true });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["frail_1"]);
    expect(r.deferred).toEqual([]);
  });
});

describe("MNA-SF（6 题 0–14，V2 两档）", () => {
  const base: Record<string, number> = { mnasf_1: 2, mnasf_2: 3, mnasf_3: 2, mnasf_4: 2, mnasf_5: 2, mnasf_6: 3 };
  it.each([
    [14, "MNA_SF_NO_RISK"], [12, "MNA_SF_NO_RISK"], [11, "MNA_SF_MALNUTRITION_RISK"], [0, "MNA_SF_MALNUTRITION_RISK"],
  ])("总分 %i → %s", (total, tag) => {
    // 从满分 14 往下扣：优先扣 mnasf_2（0-3），再 mnasf_6，再其余
    let cut = 14 - total;
    const scores = { ...base };
    for (const id of ["mnasf_2", "mnasf_6", "mnasf_1", "mnasf_3", "mnasf_4", "mnasf_5"]) {
      const c = Math.min(cut, scores[id]);
      scores[id as keyof typeof scores] -= c;
      cut -= c;
    }
    const r = scoreScaleV2("mnasf", sumAnswers("mnasf", scores));
    expect(r.totalScore).toBe(total);
    expect(r.tags[0].code).toBe(tag);
  });
  it("mnasf_2/mnasf_6（系统读取）缺失 + deferClinical=true → 部分计分", () => {
    const answers = sumAnswers("mnasf", { mnasf_1: 2, mnasf_3: 2, mnasf_4: 2, mnasf_5: 2 });
    const r = scoreScaleV2("mnasf", answers, { deferClinical: true });
    expect(r.ok).toBe(true);
    expect(r.partial).toBe(true);
    expect(r.deferred).toEqual(["mnasf_2", "mnasf_6"]);
    // 已答 4 题满分 8 ≤ 11 → 营养不良风险（阈值不变，按已答题计分）
    expect(r.totalScore).toBe(8);
    expect(r.tags[0].code).toBe("MNA_SF_MALNUTRITION_RISK");
  });
  it("mnasf_3（逻辑计算）缺失 + deferClinical=false → 阻断", () => {
    const answers = sumAnswers("mnasf", { mnasf_1: 2, mnasf_2: 3, mnasf_4: 2, mnasf_5: 2, mnasf_6: 3 });
    const r = scoreScaleV2("mnasf", answers);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["mnasf_3"]);
  });
});

describe("Mini-Cog（Q2 画钟 0/2 + Q3 延迟回忆 0–3，总分 0–5）", () => {
  it.each([
    [2, 3, 5, "COGNITIVE_BRIEF_SCREEN_NEGATIVE"], [2, 1, 3, "COGNITIVE_BRIEF_SCREEN_NEGATIVE"],
    [2, 0, 2, "COGNITIVE_BRIEF_SCREEN_POSITIVE"], [0, 2, 2, "COGNITIVE_BRIEF_SCREEN_POSITIVE"],
    [0, 0, 0, "COGNITIVE_BRIEF_SCREEN_POSITIVE"],
  ])("Q2=%i Q3=%i → 总分 %i → %s", (q2, q3, total, tag) => {
    const r = scoreScaleV2("minicog", {
      minicog_2: optByScore("minicog", "minicog_2", q2),
      minicog_3: optByScore("minicog", "minicog_3", q3),
    });
    expect(r.totalScore).toBe(total);
    expect(r.tags[0].code).toBe(tag);
  });
  it("Q1（记忆指令，不计分）缺失不阻断，且明细标记 excluded", () => {
    const r = scoreScaleV2("minicog", {
      minicog_2: optByScore("minicog", "minicog_2", 2),
      minicog_3: optByScore("minicog", "minicog_3", 3),
    });
    expect(r.ok).toBe(true);
    expect(r.details).toHaveLength(3);
    const q1 = r.details.find((d) => d.itemId === "minicog_1")!;
    expect(q1.excluded).toBe(true);
    expect(q1.score).toBeNull();
  });
  it("Q2（绘图操作）缺失 + deferClinical=true → 豁免，按 Q3 计分", () => {
    const r = scoreScaleV2("minicog", { minicog_3: optByScore("minicog", "minicog_3", 3) }, { deferClinical: true });
    expect(r.ok).toBe(true);
    expect(r.partial).toBe(true);
    expect(r.deferred).toEqual(["minicog_2"]);
    expect(r.totalScore).toBe(3);
    expect(r.tags[0].code).toBe("COGNITIVE_BRIEF_SCREEN_NEGATIVE");
  });
  it("Q2 缺失 + deferClinical=false → 阻断", () => {
    const r = scoreScaleV2("minicog", { minicog_3: optByScore("minicog", "minicog_3", 3) });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["minicog_2"]);
  });
  it("Q3 缺失 + deferClinical=true 也阻断（正式问题无豁免）", () => {
    const r = scoreScaleV2("minicog", { minicog_2: optByScore("minicog", "minicog_2", 2) }, { deferClinical: true });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["minicog_3"]);
  });
});

/** 按目标总分贪心分配：从首题起每题给到 min(剩余, 该题满分)（适用于各题 0..max 连续可取的量表） */
function answersForTotal(scaleId: string, total: number): AnswersV2 {
  const items = scaleV2ById.get(scaleId)!.items;
  const scores: Record<string, number> = {};
  let remain = total;
  for (const item of items) {
    const max = Math.max(...item.options!.map((o) => o.score!));
    const score = Math.min(remain, max);
    scores[item.id] = score;
    remain -= score;
  }
  if (remain !== 0) throw new Error(`测试构造失败：${scaleId} 总分 ${total} 超出满分`);
  return sumAnswers(scaleId, scores);
}

describe("GDS-15（15 题是/否 0–15，Q1/5/7/11/13 反向计分已含在选项分值内）", () => {
  it.each([
    [0, "GDS15_NORMAL"], [8, "GDS15_NORMAL"],
    [9, "GDS15_MODERATE_DEPRESSION"], [11, "GDS15_MODERATE_DEPRESSION"],
    [12, "GDS15_SEVERE_DEPRESSION"], [15, "GDS15_SEVERE_DEPRESSION"],
  ])("总分 %i → %s", (total, tag) => {
    const r = scoreScaleV2("gds15", answersForTotal("gds15", total));
    expect(r.ok).toBe(true);
    expect(r.totalScore).toBe(total);
    expect(r.tags[0].code).toBe(tag);
  });
  it("反向计分题按选项分值取分（gds15_1「是的=0分」「不是=1分」）", () => {
    const r = scoreScaleV2("gds15", answersForTotal("gds15", 15));
    // 全量 15 分时 gds15_1 命中「不是（1分）」：明细分值与选项分值一致，不做额外反向换算
    expect(r.details.find((d) => d.itemId === "gds15_1")!.score).toBe(1);
    expect(r.details.find((d) => d.itemId === "gds15_1")!.answerLabel).toBe("不是（1分）");
  });
  it("任一正式问题缺失即阻断（GDS-15 无医生侧条目）", () => {
    const answers = answersForTotal("gds15", 14);
    delete answers["gds15_15"];
    const r = scoreScaleV2("gds15", answers, { deferClinical: true });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["gds15_15"]);
  });
});

describe("GAD-7（7 题频率四档 0–21）", () => {
  it.each([
    [0, "GAD7_NORMAL"], [9, "GAD7_NORMAL"],
    [10, "GAD7_MODERATE_ANXIETY"], [14, "GAD7_MODERATE_ANXIETY"],
    [15, "GAD7_SEVERE_ANXIETY"], [21, "GAD7_SEVERE_ANXIETY"],
  ])("总分 %i → %s", (total, tag) => {
    const r = scoreScaleV2("gad7", answersForTotal("gad7", total));
    expect(r.ok).toBe(true);
    expect(r.totalScore).toBe(total);
    expect(r.tags[0].code).toBe(tag);
  });
});

describe("AIS（8 题各 0–3，总分 0–24；4–5「可能有」按 02 表建议程序判定口径，标准原文 4–6）", () => {
  it.each([
    [0, "AIS_NO_SLEEP_DISORDER"], [3, "AIS_NO_SLEEP_DISORDER"],
    [4, "AIS_POSSIBLE_SLEEP_DISORDER"], [5, "AIS_POSSIBLE_SLEEP_DISORDER"],
    [6, "AIS_SLEEP_DISORDER_PRESENT"], [24, "AIS_SLEEP_DISORDER_PRESENT"],
  ])("总分 %i → %s", (total, tag) => {
    const r = scoreScaleV2("ais", answersForTotal("ais", total));
    expect(r.ok).toBe(true);
    expect(r.totalScore).toBe(total);
    expect(r.tags[0].code).toBe(tag);
  });
});

describe("Morse（6 题 0–125；中风险 25–44 按 02 表建议程序判定，标准原文 25～45）", () => {
  // 不可达总分（24/44 非 5 的倍数组合不可由选项分值凑出）直接测区间归属
  it.each([
    [0, "MORSE_FALL_RISK_LOW"], [24, "MORSE_FALL_RISK_LOW"],
    [25, "MORSE_FALL_RISK_MODERATE"], [44, "MORSE_FALL_RISK_MODERATE"],
    [45, "MORSE_FALL_RISK_HIGH"], [125, "MORSE_FALL_RISK_HIGH"],
  ])("总分 %i → %s（区间直测）", (total, tag) => {
    expect(resolveSumRangeTagV2(judgmentOf("morse"), total)).toBe(tag);
  });
  // 引擎全链路：morse 各题分值非连续（0/25、0/15、0/15/30、0/20、0/10/20、0/15），显式构造合法组合
  it.each([
    [{}, "MORSE_FALL_RISK_LOW", 0],
    [{ morse_4: 20 }, "MORSE_FALL_RISK_LOW", 20],
    [{ morse_1: 25 }, "MORSE_FALL_RISK_MODERATE", 25],
    [{ morse_1: 25, morse_2: 15 }, "MORSE_FALL_RISK_MODERATE", 40],
    [{ morse_1: 25, morse_4: 20 }, "MORSE_FALL_RISK_HIGH", 45],
    [{ morse_1: 25, morse_2: 15, morse_3: 30, morse_4: 20, morse_5: 20, morse_6: 15 }, "MORSE_FALL_RISK_HIGH", 125],
  ])("分值组合 %j → %s（总分 %i）", (partial: Record<string, number>, tag, total) => {
    const scores: Record<string, number> = {
      morse_1: 0, morse_2: 0, morse_3: 0, morse_4: 0, morse_5: 0, morse_6: 0, ...partial,
    };
    const r = scoreScaleV2("morse", sumAnswers("morse", scores));
    expect(r.ok).toBe(true);
    expect(r.totalScore).toBe(total);
    expect(r.tags[0].code).toBe(tag);
  });
  it("系统读取/逻辑计算条目缺失：deferClinical 豁免按已答题计分；strict 阻断代填", () => {
    const answers = sumAnswers("morse", { morse_1: 25, morse_3: 0 });
    const deferred = scoreScaleV2("morse", answers, { deferClinical: true });
    expect(deferred.ok).toBe(true);
    expect(deferred.partial).toBe(true);
    expect(deferred.deferred).toEqual(["morse_2", "morse_4", "morse_5", "morse_6"]);
    expect(deferred.totalScore).toBe(25);
    expect(deferred.tags[0].code).toBe("MORSE_FALL_RISK_MODERATE");

    const strict = scoreScaleV2("morse", answers);
    expect(strict.ok).toBe(false);
    expect(strict.missing).toEqual(["morse_2", "morse_4", "morse_5", "morse_6"]);
    expect(strict.tags).toEqual([]);
  });
});

describe("Lubben（6 题各 0–5，总分 0–30；≥24 良好 / 12–23 一般 / <12 较差）", () => {
  it.each([
    [0, "LUBBEN_SUPPORT_POOR"], [11, "LUBBEN_SUPPORT_POOR"],
    [12, "LUBBEN_SUPPORT_FAIR"], [23, "LUBBEN_SUPPORT_FAIR"],
    [24, "LUBBEN_SUPPORT_GOOD"], [30, "LUBBEN_SUPPORT_GOOD"],
  ])("总分 %i → %s", (total, tag) => {
    const r = scoreScaleV2("lubben", answersForTotal("lubben", total));
    expect(r.ok).toBe(true);
    expect(r.totalScore).toBe(total);
    expect(r.tags[0].code).toBe(tag);
  });
});

describe("疼痛 NRS（单题 0–10 共 11 档，选项分值取自 label 前导「N分：」）", () => {
  it.each([
    [0, "PAIN_NRS_NONE"],
    [1, "PAIN_NRS_MILD"], [3, "PAIN_NRS_MILD"],
    [4, "PAIN_NRS_MODERATE"], [6, "PAIN_NRS_MODERATE"],
    [7, "PAIN_NRS_SEVERE"], [10, "PAIN_NRS_SEVERE"],
  ])("评分 %i → %s", (total, tag) => {
    const r = scoreScaleV2("pain_nrs", sumAnswers("pain_nrs", { pain_nrs_1: total }));
    expect(r.ok).toBe(true);
    expect(r.totalScore).toBe(total);
    expect(r.tags[0].code).toBe(tag);
    expect(r.details).toHaveLength(1);
  });
  it("未答 → 阻断（正式问题无豁免）", () => {
    const r = scoreScaleV2("pain_nrs", {}, { deferClinical: true });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["pain_nrs_1"]);
  });
});
