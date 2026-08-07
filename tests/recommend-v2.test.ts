/**
 * INPUT:  src/lib/recommend-v2、src/lib/rules/v2
 * OUTPUT: V2 推荐引擎用例：黄金用例（5 大类前 2 与总分）、CAM→JZ01 强制 + 谵妄禁 30 项、
 *         YD07 禁忌（MORSE / ADL 重度依赖）、placeholder 剔除、未知编码抛错、
 *         同分按编码升序、total=0 不入选、全 0 标签全空、forced 不占每类 2 名额、积分明细
 * POS:    医学核心测试。期望值全部从 data/intervention-scoring-v2.json 手工抄出后硬编码
 *         （禁止测试内反查 matrix 自算期望，防循环论证）。依据：V2/03_标签干预匹配表.xlsx 分值语义、
 *         V2/Demo_v2更新说明.docx「每类 1 至 2 个」「100 强制优先」。
 */
import { describe, expect, it } from "vitest";
import {
  recommendV2,
  MAX_PER_CATEGORY_V2,
  type RecommendationResultV2,
  type RecommendedItemV2,
} from "@/lib/recommend-v2";

/** 结果不变量：类别固定 5 类顺序；每类 forced 置顶且普通项 ≤2、普通项 total>0；被禁项不出现在任何类 */
function assertInvariants(result: RecommendationResultV2): void {
  expect(result.categories.map((c) => c.key)).toEqual(["exercise", "diet", "tcmFood", "referral", "other"]);
  const forbiddenCodes = new Set(result.forbidden.map((f) => f.code));
  for (const cat of result.categories) {
    const normal = cat.items.filter((i) => !i.forced);
    expect(normal.length).toBeLessThanOrEqual(MAX_PER_CATEGORY_V2);
    for (const item of normal) expect(item.total).toBeGreaterThan(0);
    // forced 项必须在普通项之前
    const firstNormalIndex = cat.items.findIndex((i) => !i.forced);
    for (const [index, item] of cat.items.entries()) {
      if (item.forced) expect(index).toBeLessThan(firstNormalIndex === -1 ? cat.items.length : firstNormalIndex);
      expect(forbiddenCodes.has(item.code)).toBe(false);
    }
  }
}

/** 取某大类下的普通（非 forced）项 */
function normalItems(result: RecommendationResultV2, key: string): RecommendedItemV2[] {
  return result.categories.find((c) => c.key === key)!.items.filter((i) => !i.forced);
}

describe("recommendV2 — 黄金用例（期望值自 03 表手工抄算）", () => {
  // 输入标签的非零向量（手工抄自 data/intervention-scoring-v2.json）：
  // FRAIL_FRAIL:                YD01:6 YD02:9 | SS02:9 SS03:8 | ZY01:6 | JZ02:8 JZ03:7 | QT15:6
  // MNA_SF_MALNUTRITION_RISK:   SS02:7 SS03:8 SS04:7 | ZY01:5 | JZ02:5 JZ08:8
  // FALL_SCREEN_POSITIVE:       YD02:5 YD04:4 YD06:6 | JZ03:6 | QT01:4 QT02:4 QT03:4 QT04:4 QT05:6
  // TCM_QI_DEFICIENCY_YES:      YD01:4 | SS02:4 | ZY01:9
  // TCM_BLOOD_STASIS_YES:       ZY05:4 | JZ02:3
  // 逐类累加：YD02=14 YD01=10 YD06=6 YD04=4；SS02=20 SS03=16 SS04=7；ZY01=20 ZY05=4；
  //           JZ02=16 JZ03=13 JZ08=8；QT05=6 QT15=6 QT01..04=4
  const result = recommendV2([
    "FRAIL_FRAIL",
    "MNA_SF_MALNUTRITION_RISK",
    "FALL_SCREEN_POSITIVE",
    "TCM_QI_DEFICIENCY_YES",
    "TCM_BLOOD_STASIS_YES",
  ]);

  it("每大类前 2 项与累加总分正确", () => {
    assertInvariants(result);
    expect(result.forced).toEqual([]);
    expect(result.forbidden).toEqual([]);
    expect(normalItems(result, "exercise").map((i) => [i.code, i.total])).toEqual([
      ["YD02", 14],
      ["YD01", 10],
    ]);
    expect(normalItems(result, "diet").map((i) => [i.code, i.total])).toEqual([
      ["SS02", 20],
      ["SS03", 16],
    ]);
    expect(normalItems(result, "tcmFood").map((i) => [i.code, i.total])).toEqual([
      ["ZY01", 20],
      ["ZY05", 4],
    ]);
    expect(normalItems(result, "referral").map((i) => [i.code, i.total])).toEqual([
      ["JZ02", 16],
      ["JZ03", 13],
    ]);
    // QT05 与 QT15 同分 6 → 按编码升序 QT05 在前；QT01..04 各 4 分被截断
    expect(normalItems(result, "other").map((i) => [i.code, i.total])).toEqual([
      ["QT05", 6],
      ["QT15", 6],
    ]);
  });

  it("积分明细含全部来源标签与分值，顺序稳定（分值降序）", () => {
    const yd02 = normalItems(result, "exercise")[0];
    expect(yd02.contributions).toEqual([
      { tagCode: "FRAIL_FRAIL", tagName: "衰弱", score: 9 },
      { tagCode: "FALL_SCREEN_POSITIVE", tagName: "跌倒风险筛查阳性", score: 5 },
    ]);
    const zy01 = normalItems(result, "tcmFood")[0];
    expect(zy01.contributions).toEqual([
      { tagCode: "TCM_QI_DEFICIENCY_YES", tagName: "气虚质：是", score: 9 },
      { tagCode: "FRAIL_FRAIL", tagName: "衰弱", score: 6 },
      { tagCode: "MNA_SF_MALNUTRITION_RISK", tagName: "营养不良风险", score: 5 },
    ]);
    // 明细求和 = total
    for (const cat of result.categories) {
      for (const item of cat.items) {
        expect(item.contributions.reduce((sum, c) => sum + c.score, 0)).toBe(item.total);
      }
    }
  });

  it("干预元数据从 interventions-v2 透传", () => {
    const qt15 = normalItems(result, "other")[1];
    expect(qt15.name).toBe("照护者支持方案");
    expect(qt15.category).toBe("其他");
    expect(qt15.mediaType).toBe("text");
    expect(typeof qt15.content).toBe("string");
    expect(qt15.mediaAvailable).toBe(false);
  });
});

describe("recommendV2 — 谵妄：JZ01 强制优先 + YD/SS/ZY 全 30 项禁止", () => {
  // CAM_DELIRIUM_POSITIVE 非零向量（手工抄）：JZ01:100 JZ02:8 QT12:5 QT15:8，
  // YD01..YD10 / SS01..SS10 / ZY01..ZY10 各 -100（共 30 条）
  const result = recommendV2(["CAM_DELIRIUM_POSITIVE"]);

  it("forced=[JZ01]，total 约定为 0（100 是决策标记不计入累加）", () => {
    assertInvariants(result);
    expect(result.forced.map((i) => i.code)).toEqual(["JZ01"]);
    expect(result.forced[0].name).toBe("紧急就医建议");
    expect(result.forced[0].total).toBe(0);
    expect(result.forced[0].forced).toBe(true);
    expect(result.forced[0].contributions).toEqual([
      { tagCode: "CAM_DELIRIUM_POSITIVE", tagName: "谵妄", score: 100 },
    ]);
  });

  it("forbidden 含全部 30 项 YD/SS/ZY，原因首条即 -100 决策依据", () => {
    expect(result.forbidden).toHaveLength(30);
    for (const f of result.forbidden) {
      expect(["YD", "SS", "ZY"]).toContain(f.code.slice(0, 2));
      expect(f.reasons[0]).toEqual({ tagCode: "CAM_DELIRIUM_POSITIVE", tagName: "谵妄", score: -100 });
    }
  });

  it("就诊建议类 JZ01 强制置顶；运动/膳食/中医食养类为空", () => {
    const referral = result.categories.find((c) => c.key === "referral")!;
    expect(referral.items.map((i) => i.code)).toEqual(["JZ01", "JZ02"]);
    expect(referral.items[0].forced).toBe(true);
    expect(normalItems(result, "referral").map((i) => [i.code, i.total])).toEqual([["JZ02", 8]]);
    expect(normalItems(result, "other").map((i) => [i.code, i.total])).toEqual([
      ["QT15", 8],
      ["QT12", 5],
    ]);
    expect(result.categories.find((c) => c.key === "exercise")!.items).toEqual([]);
    expect(result.categories.find((c) => c.key === "diet")!.items).toEqual([]);
    expect(result.categories.find((c) => c.key === "tcmFood")!.items).toEqual([]);
  });
});

describe("recommendV2 — YD07 禁忌标签", () => {
  it("MORSE_FALL_RISK_HIGH：YD07 被禁，运动类前 2 为 YD06(9)、YD02(8)", () => {
    // MORSE_FALL_RISK_HIGH 非零向量（手工抄）：YD02:8 YD04:7 YD06:9 YD07:-100
    // JZ03:9 | QT01:7 QT02:7 QT03:7 QT04:7 QT05:9
    const result = recommendV2(["MORSE_FALL_RISK_HIGH"]);
    assertInvariants(result);
    expect(result.forced).toEqual([]);
    expect(result.forbidden.map((f) => f.code)).toEqual(["YD07"]);
    expect(result.forbidden[0].name).toBe("扶椅单脚站立训练");
    expect(result.forbidden[0].reasons).toEqual([
      { tagCode: "MORSE_FALL_RISK_HIGH", tagName: "跌倒高风险", score: -100 },
    ]);
    expect(normalItems(result, "exercise").map((i) => [i.code, i.total])).toEqual([
      ["YD06", 9],
      ["YD02", 8],
    ]);
    expect(normalItems(result, "referral").map((i) => [i.code, i.total])).toEqual([["JZ03", 9]]);
    // QT 类 4 项同分 7 → 编码升序 QT01 入选
    expect(normalItems(result, "other").map((i) => [i.code, i.total])).toEqual([
      ["QT05", 9],
      ["QT01", 7],
    ]);
  });

  it("ADL_DEPENDENCE_SEVERE：YD07 被禁，运动类 YD02(9)、YD03(7)；就诊建议 JZ03(8)、JZ02(7)", () => {
    // ADL_DEPENDENCE_SEVERE 非零向量（手工抄）：YD02:9 YD03:7 YD07:-100 YD10:7
    // JZ02:7 JZ03:8 | QT05:7 QT15:7
    const result = recommendV2(["ADL_DEPENDENCE_SEVERE"]);
    assertInvariants(result);
    expect(result.forbidden.map((f) => f.code)).toEqual(["YD07"]);
    // YD03 与 YD10 同分 7 → 编码升序 YD03 入选
    expect(normalItems(result, "exercise").map((i) => [i.code, i.total])).toEqual([
      ["YD02", 9],
      ["YD03", 7],
    ]);
    expect(normalItems(result, "referral").map((i) => [i.code, i.total])).toEqual([
      ["JZ03", 8],
      ["JZ02", 7],
    ]);
    expect(normalItems(result, "other").map((i) => [i.code, i.total])).toEqual([
      ["QT05", 7],
      ["QT15", 7],
    ]);
  });
});

describe("recommendV2 — 输入处理与边界机制", () => {
  it("placeholder 标签静默剔除（HOME_ENVIRONMENT_SCORE 等 5 个采集占位）", () => {
    const empty = recommendV2(["HOME_ENVIRONMENT_SCORE"]);
    expect(empty.forced).toEqual([]);
    expect(empty.forbidden).toEqual([]);
    for (const cat of empty.categories) expect(cat.items).toEqual([]);

    // 与真实标签混合时，结果与仅传真实标签完全一致
    const mixed = recommendV2(["HOME_ENVIRONMENT_SCORE", "MORSE_FALL_RISK_HIGH", "MEDICATION_COUNT"]);
    expect(mixed).toEqual(recommendV2(["MORSE_FALL_RISK_HIGH"]));
  });

  it("未知标签编码抛错（与旧引擎 assertKnownTags 同红线）", () => {
    expect(() => recommendV2(["NO_SUCH_TAG"])).toThrow(/NO_SUCH_TAG/);
    expect(() => recommendV2(["衰弱"])).toThrow(/不在 V2 结果标签全集/); // 旧名非编码
  });

  it("全 0 标签（FRAIL_NONE）：全部类为空、forced/forbidden 为空（total=0 不入选）", () => {
    const result = recommendV2(["FRAIL_NONE"]);
    expect(result.forced).toEqual([]);
    expect(result.forbidden).toEqual([]);
    for (const cat of result.categories) expect(cat.items).toEqual([]);
  });

  it("重复编码去重：同一标签不重复计分", () => {
    expect(recommendV2(["MORSE_FALL_RISK_HIGH", "MORSE_FALL_RISK_HIGH"])).toEqual(
      recommendV2(["MORSE_FALL_RISK_HIGH"])
    );
  });

  it("forced 单独置顶且不占每类 2 个普通名额", () => {
    // CAM_DELIRIUM_POSITIVE: JZ01:100 JZ02:8 QT12:5 QT15:8 + YD/SS/ZY 全禁
    // FRAIL_FRAIL:           JZ02:8 JZ03:7 QT15:6（其 YD/SS/ZY 贡献因谵妄全禁不生效）
    // 就诊建议类应为 [JZ01(forced), JZ02(16), JZ03(7)] 共 3 项——forced 不占普通名额
    const result = recommendV2(["CAM_DELIRIUM_POSITIVE", "FRAIL_FRAIL"]);
    assertInvariants(result);
    const referral = result.categories.find((c) => c.key === "referral")!;
    expect(referral.items.map((i) => [i.code, i.total, i.forced])).toEqual([
      ["JZ01", 0, true],
      ["JZ02", 16, false],
      ["JZ03", 7, false],
    ]);
    expect(normalItems(result, "other").map((i) => [i.code, i.total])).toEqual([
      ["QT15", 14],
      ["QT12", 5],
    ]);
    // 被禁项的 reasons 保留全部非零贡献（含非 -100 的普通贡献），-100 决策依据排最前
    const yd01 = result.forbidden.find((f) => f.code === "YD01")!;
    expect(yd01.reasons).toEqual([
      { tagCode: "CAM_DELIRIUM_POSITIVE", tagName: "谵妄", score: -100 },
      { tagCode: "FRAIL_FRAIL", tagName: "衰弱", score: 6 },
    ]);
  });
});
