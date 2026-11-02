/**
 * INPUT:  patient-scale-packages 套餐定义与 helper
 * OUTPUT: 套餐内容/项数、可评分断言、分组与时长估算用例
 * POS:    2026-08-08 设计图·患者端量表工具选择四方式页的套餐口径把关
 *         （标准包 12 / 门诊简版 7 / 住院入院 9；认知与情志 7 / 跌倒 6 / 肌少营养 8 / 睡眠疼痛 6）。
 */
import { describe, expect, it } from "vitest";
import {
  CUSTOM_PRESET_PACKAGES,
  ROUTINE_PACKAGES,
  askableQuestionCount,
  estimateMinutes,
  groupScalesByCategory,
  minutesFromAskable,
} from "@/lib/assessment/patient-scale-packages";
import { SCORABLE_SCALE_IDS } from "@/lib/assessment/scale-packages";
import { scaleV2ById } from "@/lib/rules/v2";

const ALL_PACKAGES = [...ROUTINE_PACKAGES, ...CUSTOM_PRESET_PACKAGES];

describe("患者端套餐定义（2026-08-08 设计图）", () => {
  it("项数与设计图一致：常规 12/7/9，自选预设 7/6/8/6", () => {
    const counts = Object.fromEntries(ALL_PACKAGES.map((p) => [p.key, p.scaleIds.length]));
    expect(counts).toEqual({
      standard: 12,
      outpatient: 7,
      inpatient: 9,
      cognition_mood: 7,
      fall_risk: 6,
      sarcopenia_nutrition: 8,
      sleep_pain: 6,
    });
  });

  it("套餐量表全部可评分且无重复", () => {
    const scorable = new Set(SCORABLE_SCALE_IDS);
    for (const pkg of ALL_PACKAGES) {
      expect(new Set(pkg.scaleIds).size).toBe(pkg.scaleIds.length);
      for (const id of pkg.scaleIds) {
        expect(scorable.has(id), `${pkg.key} 含不可评分量表 ${id}`).toBe(true);
      }
    }
  });

  it("标准包按一级分类分组与设计图一致（躯体5/精神心理3/社会与环境2/老年综合征2）", () => {
    const standard = ROUTINE_PACKAGES.find((p) => p.key === "standard")!;
    const groups = groupScalesByCategory(standard.scaleIds);
    expect(groups.map((g) => [g.category, g.scaleIds.length])).toEqual([
      ["躯体功能", 5],
      ["精神心理", 3],
      ["社会与环境", 2],
      ["老年综合征", 2],
    ]);
  });

  it("认知与情志评估包内容与设计图右栏明示一致", () => {
    const pkg = CUSTOM_PRESET_PACKAGES.find((p) => p.key === "cognition_mood")!;
    expect([...pkg.scaleIds]).toEqual(["minicog", "mmse", "depression_2q", "gds15", "anxiety_2q", "gad7", "ais"]);
  });
});

describe("groupScalesByCategory", () => {
  it("按入参首次出现顺序分组（调用方传入 01 表顺序即为文档顺序），未知 id 静默跳过", () => {
    const groups = groupScalesByCategory(["mnasf", "adl", "not_a_scale", "frail"]);
    expect(groups.map((g) => g.category)).toEqual(["老年综合征", "躯体功能"]);
    expect(groups[0].scaleIds).toEqual(["mnasf", "frail"]);
    expect(groups[1].scaleIds).toEqual(["adl"]);
  });
});

describe("时长估算（展示用）", () => {
  it("askableQuestionCount 只计正式问题条目", () => {
    const scale = scaleV2ById.get("frail")!;
    const expected = scale.items.filter((i) => i.entryType === "正式问题").length;
    expect(askableQuestionCount("frail")).toBe(expected);
    expect(askableQuestionCount("not_a_scale")).toBe(0);
  });

  it("minutesFromAskable 下限 2 分钟，按 4 题/分钟取整", () => {
    expect(minutesFromAskable(0)).toBe(2);
    expect(minutesFromAskable(3)).toBe(2);
    expect(minutesFromAskable(76)).toBe(19);
  });

  it("estimateMinutes 汇总多量表（标准包≈设计图 18 分钟量级）", () => {
    const standard = ROUTINE_PACKAGES.find((p) => p.key === "standard")!;
    const minutes = estimateMinutes(standard.scaleIds);
    expect(minutes).toBeGreaterThanOrEqual(15);
    expect(minutes).toBeLessThanOrEqual(25);
  });
});
