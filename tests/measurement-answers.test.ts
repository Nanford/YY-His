/**
 * INPUT:  src/lib/assessment/measurements.ts
 * OUTPUT: MNA-SF F/F替代、中医体质第 9/28 题的全部分档边界、缺失与优先级用例
 * POS:    M2 测量题纯逻辑测试；医学边界依据 data/scales.json 与量表题目_Demo.txt。
 */
import { describe, expect, it } from "vitest";
import {
  calculateBmi,
  resolveMeasurementAnswers,
  type MeasurementAnswerResolution,
  type PatientMeasurements,
} from "@/lib/assessment/measurements";

const emptyPatient: PatientMeasurements = {
  heightCm: null,
  weightKg: null,
  waistCm: null,
  calfCm: null,
};

function patient(overrides: Partial<PatientMeasurements>): PatientMeasurements {
  return { ...emptyPatient, ...overrides };
}

function answer(
  answers: readonly MeasurementAnswerResolution[],
  questionId: MeasurementAnswerResolution["questionId"]
): MeasurementAnswerResolution {
  const found = answers.find((item) => item.questionId === questionId);
  if (!found) throw new Error(`缺少测量题结果：${questionId}`);
  return found;
}

describe("BMI 计算", () => {
  it("按 kg/m² 使用未舍入数值", () => {
    expect(calculateBmi(patient({ heightCm: 170, weightKg: 69 }))).toBeCloseTo(23.8754, 4);
  });

  it.each([
    [null, 60],
    [170, null],
    [0, 60],
    [170, 0],
    [Number.NaN, 60],
    [170, Number.POSITIVE_INFINITY],
  ])("身高或体重无效（%s, %s）时不可计算", (heightCm, weightKg) => {
    expect(calculateBmi(patient({ heightCm, weightKg }))).toBeNull();
  });
});

describe("MNA-SF F/F替代 二选一", () => {
  it.each([
    [18.99, 0, "BMI＜19"],
    [19, 1, "19≤BMI＜21"],
    [20.99, 1, "19≤BMI＜21"],
    [21, 2, "21≤BMI＜23"],
    [22.99, 2, "21≤BMI＜23"],
    [23, 3, "BMI≥23"],
  ])("BMI %s → %s 分（%s）", (bmi, score, optionLabel) => {
    const results = resolveMeasurementAnswers(patient({ heightCm: 100, weightKg: bmi, calfCm: 29 }), ["mnasf"]);
    expect(answer(results, "mnasf_F")).toMatchObject({ status: "confirmed", score, optionLabel });
    expect(answer(results, "mnasf_F_alt")).toMatchObject({ status: "superseded", score: null, optionLabel: null });
  });

  it.each([
    [30.99, 0, "CC＜31 cm"],
    [31, 3, "CC≥31 cm"],
  ])("BMI 缺失时小腿围 %s cm → F替代 %s 分", (calfCm, score, optionLabel) => {
    const results = resolveMeasurementAnswers(patient({ calfCm }), ["mnasf"]);
    expect(answer(results, "mnasf_F")).toMatchObject({ status: "superseded", score: null });
    expect(answer(results, "mnasf_F_alt")).toMatchObject({ status: "confirmed", score, optionLabel });
  });

  it("BMI 与小腿围同时存在时优先 BMI，分值不叠加", () => {
    const results = resolveMeasurementAnswers(patient({ heightCm: 100, weightKg: 23, calfCm: 20 }), ["mnasf"]);
    expect(answer(results, "mnasf_F")).toMatchObject({ status: "confirmed", score: 3 });
    expect(answer(results, "mnasf_F_alt")).toMatchObject({ status: "superseded", score: null });
  });

  it("BMI 与小腿围均缺失时两道分支均标记待人工补录", () => {
    const results = resolveMeasurementAnswers(emptyPatient, ["mnasf"]);
    expect(answer(results, "mnasf_F")).toMatchObject({ status: "manual", score: null, optionLabel: null });
    expect(answer(results, "mnasf_F_alt")).toMatchObject({ status: "manual", score: null, optionLabel: null });
    expect(answer(results, "mnasf_F").reason).toContain("身高或体重");
    expect(answer(results, "mnasf_F_alt").reason).toContain("小腿围");
  });

  it("仅缺身高或仅缺体重时，只要小腿围有效就使用 F替代", () => {
    for (const measurements of [
      patient({ weightKg: 60, calfCm: 31 }),
      patient({ heightCm: 170, calfCm: 31 }),
    ]) {
      const results = resolveMeasurementAnswers(measurements, ["mnasf"]);
      expect(answer(results, "mnasf_F_alt")).toMatchObject({ status: "confirmed", score: 3 });
    }
  });
});

describe("中医体质第 9 题（BMI）", () => {
  it.each([
    [23.99, 1, "BMI＜24"],
    [24, 2, "24≤BMI＜25"],
    [24.99, 2, "24≤BMI＜25"],
    [25, 3, "25≤BMI＜26"],
    [25.99, 3, "25≤BMI＜26"],
    [26, 4, "26≤BMI＜28"],
    [27.99, 4, "26≤BMI＜28"],
    [28, 5, "BMI≥28"],
  ])("BMI %s → %s 分（%s）", (bmi, score, optionLabel) => {
    const result = answer(resolveMeasurementAnswers(patient({ heightCm: 100, weightKg: bmi }), ["tcm"]), "tcm_9");
    expect(result).toMatchObject({ status: "confirmed", score, optionLabel });
  });

  it.each([
    patient({ weightKg: 60 }),
    patient({ heightCm: 170 }),
    patient({ heightCm: 0, weightKg: 60 }),
  ])("身高或体重缺失/无效时待人工补录", (measurements) => {
    const result = answer(resolveMeasurementAnswers(measurements, ["tcm"]), "tcm_9");
    expect(result).toMatchObject({ status: "manual", score: null, optionLabel: null, rawText: null });
    expect(result.reason).toContain("BMI");
  });
});

describe("中医体质第 28 题（腹围）", () => {
  it.each([
    [79.99, 1, "腹围＜80 cm"],
    [80, 2, "腹围80～85 cm"],
    [85, 2, "腹围80～85 cm"],
    [86, 3, "腹围86～90 cm"],
    [90, 3, "腹围86～90 cm"],
    [91, 4, "腹围91～105 cm"],
    [105, 4, "腹围91～105 cm"],
    [105.01, 5, "腹围＞105 cm"],
  ])("腹围 %s cm → %s 分（%s）", (waistCm, score, optionLabel) => {
    const result = answer(resolveMeasurementAnswers(patient({ waistCm }), ["tcm"]), "tcm_28");
    expect(result).toMatchObject({ status: "confirmed", score, optionLabel });
  });

  it.each([null, 0, Number.NaN, Number.NEGATIVE_INFINITY])("腹围 %s 缺失/无效时待人工补录", (waistCm) => {
    const result = answer(resolveMeasurementAnswers(patient({ waistCm }), ["tcm"]), "tcm_28");
    expect(result).toMatchObject({ status: "manual", score: null, optionLabel: null, rawText: null });
    expect(result.reason).toContain("腹围");
  });
});

describe("量表选择范围", () => {
  it("只返回本次勾选量表的测量题，并忽略重复或未知 ID", () => {
    const p = patient({ heightCm: 100, weightKg: 24, waistCm: 90, calfCm: 31 });
    expect(resolveMeasurementAnswers(p, [])).toEqual([]);
    expect(resolveMeasurementAnswers(p, ["mnasf", "mnasf", "unknown"]).map((item) => item.questionId)).toEqual([
      "mnasf_F",
      "mnasf_F_alt",
    ]);
    expect(resolveMeasurementAnswers(p, ["tcm"]).map((item) => item.questionId)).toEqual(["tcm_9", "tcm_28"]);
    expect(resolveMeasurementAnswers(p, ["mnasf", "tcm"]).map((item) => item.questionId)).toEqual([
      "mnasf_F",
      "mnasf_F_alt",
      "tcm_9",
      "tcm_28",
    ]);
  });
});
