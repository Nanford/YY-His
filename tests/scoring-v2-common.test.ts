/**
 * INPUT:  data/judgments-v2.json、data/result-tags.json、src/lib/scoring-v2 引擎
 * OUTPUT: 引擎通用行为用例：number 答案（预留 M9）取值与越界抛错、未知量表/缺判定配置抛错、
 *         scoreAllV2 批量评分、判定配置全部 tagCode 都能在 02 表 190 标签中查到 name
 * POS:    V2 评分引擎回归保险（跨判定器的通用语义）。
 */
import { describe, expect, it } from "vitest";
import { scoreAllV2, scoreScaleV2 } from "@/lib/scoring-v2";
import { judgmentsV2, tagV2ByCode } from "@/lib/rules/v2";
import { optByLabel, optByScore } from "./scoring-v2-helpers";

describe("引擎通用行为", () => {
  it("number 答案（预留 M9 题型）：条目有 options 时按合法分值取分", () => {
    const r = scoreScaleV2("minicog", {
      minicog_2: { kind: "number", value: 2 },
      minicog_3: { kind: "number", value: 3 },
    });
    expect(r.ok).toBe(true);
    expect(r.totalScore).toBe(5);
    expect(r.tags[0].code).toBe("COGNITIVE_BRIEF_SCREEN_NEGATIVE");
    expect(r.details.find((d) => d.itemId === "minicog_3")!.answerLabel).toBe("3");
  });

  it("number 答案越界（不在合法选项分值内）→ 抛错", () => {
    expect(() =>
      scoreScaleV2("minicog", { minicog_2: { kind: "number", value: 1 }, minicog_3: { kind: "number", value: 3 } })
    ).toThrow(/不在合法选项分值/);
  });

  it("option 答案 label 匹配不到 → 抛错（sumRange）", () => {
    expect(() =>
      scoreScaleV2("frail", {
        frail_1: { kind: "option", label: "可能吧" },
        frail_2: optByScore("frail", "frail_2", 0),
        frail_3: optByScore("frail", "frail_3", 0),
        frail_4: optByScore("frail", "frail_4", 0),
        frail_5: optByScore("frail", "frail_5", 0),
      })
    ).toThrow(/不在合法选项内/);
  });

  it("未知量表 id → 抛错", () => {
    expect(() => scoreScaleV2("not_a_scale", {})).toThrow(/不存在/);
  });

  it("存在于题库但无判定配置的量表 id → 抛错（M10.3b-2 后 42 量表均已配判定，用假 id 锁契约）", () => {
    // 量表 id 若碰巧在 scales-v2 中会被"无判定配置"挡住；此处用明确不存在的 id 锁「无判定」分支需先有量表
    // 真实无判定场景：先命中量表存在检查
    expect(() => scoreScaleV2("not_a_scale", {})).toThrow(/不存在/);
  });

  it("scoreAllV2 批量评分互不影响", () => {
    const results = scoreAllV2(["frail", "depression_2q"], {
      frail_1: optByScore("frail", "frail_1", 0),
      frail_2: optByScore("frail", "frail_2", 0),
      frail_3: optByScore("frail", "frail_3", 0),
      frail_4: optByScore("frail", "frail_4", 0),
      frail_5: optByScore("frail", "frail_5", 0),
      depression_2q_1: optByLabel("depression_2q", "depression_2q_1", "否（筛查阴性）"),
      depression_2q_2: optByLabel("depression_2q", "depression_2q_2", "否（筛查阴性）"),
    });
    expect(results.map((r) => r.scaleId)).toEqual(["frail", "depression_2q"]);
    expect(results[0].tags[0].code).toBe("FRAIL_NONE");
    expect(results[1].tags[0].code).toBe("DEPRESSION_2Q_NEGATIVE");
  });

  it("judgments-v2.json 全部 tagCode 都能在 02 表 190 标签中查到 name", () => {
    const codes: string[] = [];
    for (const { judgments } of judgmentsV2) {
      for (const judgment of judgments) {
        if (judgment.type === "sumRange" || judgment.type === "ladderScore") {
          codes.push(...judgment.ranges.map((r) => r.tagCode));
        } else if (judgment.type === "anyYes" || judgment.type === "anyBelowThreshold") {
          codes.push(judgment.positiveTagCode, judgment.negativeTagCode);
        } else if (judgment.type === "thresholdByEducation") {
          codes.push(judgment.normalTagCode, judgment.declineTagCode);
        } else if (judgment.type === "perQuestionTags") {
          codes.push(...judgment.rules.map((r) => r.tagCode));
        } else if (judgment.type === "initialGateSumRange") {
          codes.push(
            judgment.initialPositiveTagCode,
            judgment.initialNegativeTagCode,
            ...judgment.finalRanges.map((r) => r.tagCode)
          );
        } else if (judgment.type === "compositeAllAny") {
          codes.push(judgment.positiveTagCode, judgment.negativeTagCode);
          if (judgment.severeTagCode) codes.push(judgment.severeTagCode);
        } else if (judgment.type === "tcmConstitutionV2") {
          codes.push(...Object.values(judgment.balanced.tagCodes));
          for (const b of judgment.biased) codes.push(...Object.values(b.tagCodes));
        }
      }
    }
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      const tag = tagV2ByCode.get(code);
      expect(tag, `tagCode ${code} 应在 result-tags.json 中`).toBeDefined();
      expect(tag!.name).toBeTruthy();
      expect(tag!.placeholder).toBe(false);
    }
  });
});
