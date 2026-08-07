/**
 * INPUT:  data/judgments-v2.json（anyYes 判定配置）、data/scales-v2.json（题库）
 * OUTPUT: anyYes 判定器用例：抑郁两问/焦虑两问/尿失禁两问 均否→阴性、任一是→阳性、缺失阻断、
 *         答案 label 不命中选项抛错；M10.3b 新增单题 anyYes（sleep_1q/pain_1q/constipation_1q）
 * POS:    V2 评分引擎回归保险（来源：02 表「两题均回答『否』/任意一题回答『是』」）。
 */
import { describe, expect, it } from "vitest";
import { scoreScaleV2, type AnswersV2 } from "@/lib/scoring-v2";
import { optByLabel } from "./scoring-v2-helpers";

const YES = "是（筛查阳性）";
const NO = "否（筛查阴性）";

const tagCode = (r: ReturnType<typeof scoreScaleV2>): string => r.tags[0].code;

function twoQAnswers(scaleId: string, a1: string | null, a2: string | null): AnswersV2 {
  const answers: AnswersV2 = {};
  if (a1 !== null) answers[`${scaleId}_1`] = optByLabel(scaleId, `${scaleId}_1`, a1);
  if (a2 !== null) answers[`${scaleId}_2`] = optByLabel(scaleId, `${scaleId}_2`, a2);
  return answers;
}

describe.each([
  ["depression_2q", "DEPRESSION_2Q_POSITIVE", "DEPRESSION_2Q_NEGATIVE"],
  ["anxiety_2q", "ANXIETY_2Q_POSITIVE", "ANXIETY_2Q_NEGATIVE"],
])("%s（两问筛查）", (scaleId, positive, negative) => {
  it("两题均否 → 阴性", () => {
    const r = scoreScaleV2(scaleId, twoQAnswers(scaleId, NO, NO));
    expect(r.ok).toBe(true);
    expect(r.tags).toHaveLength(1);
    expect(r.tags[0].code).toBe(negative);
    expect(r.totalScore).toBeNull();
    expect(r.details.every((d) => d.answerLabel !== null && !d.excluded)).toBe(true);
  });
  it.each([[YES, NO], [NO, YES], [YES, YES]])("任一题是（%j）→ 阳性", (a1, a2) => {
    const r = scoreScaleV2(scaleId, twoQAnswers(scaleId, a1 as string, a2 as string));
    expect(r.tags[0].code).toBe(positive);
  });
  it("缺任一题 → 阻断不出标签（正式问题无豁免）", () => {
    const r = scoreScaleV2(scaleId, twoQAnswers(scaleId, NO, null), { deferClinical: true });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([`${scaleId}_2`]);
    expect(r.tags).toEqual([]);
  });
  it("答案 label 不在合法选项内 → 抛错（确定性红线）", () => {
    expect(() =>
      scoreScaleV2(scaleId, { [`${scaleId}_1`]: { kind: "option", label: "不知道" }, [`${scaleId}_2`]: optByLabel(scaleId, `${scaleId}_2`, NO) })
    ).toThrow(/不在合法选项内/);
  });
});

// M10.3b 新增：尿失禁两问筛查（同是两问 anyYes，标签编码不同）
describe("ui_2q（尿失禁两问筛查）", () => {
  it("两题均否 → 阴性；任一是 → 阳性", () => {
    const neg = scoreScaleV2("ui_2q", twoQAnswers("ui_2q", NO, NO));
    expect(tagCode(neg)).toBe("URINARY_INCONTINENCE_SCREEN_NEGATIVE");
    for (const [a1, a2] of [[YES, NO], [NO, YES], [YES, YES]] as const) {
      expect(tagCode(scoreScaleV2("ui_2q", twoQAnswers("ui_2q", a1, a2)))).toBe("URINARY_INCONTINENCE_SCREEN_POSITIVE");
    }
  });
});

// M10.3b 新增：一问筛查量表（单题 anyYes）——睡眠/疼痛同为「是（筛查阳性）」，便秘为「有便秘困扰（筛查阳性）」
describe.each([
  ["sleep_1q", "是（筛查阳性）", "否（筛查阴性）", "SLEEP_DISORDER_SCREEN_POSITIVE", "SLEEP_DISORDER_SCREEN_NEGATIVE"],
  ["pain_1q", "是（筛查阳性）", "否（筛查阴性）", "CHRONIC_PAIN_SCREEN_POSITIVE", "CHRONIC_PAIN_SCREEN_NEGATIVE"],
  ["constipation_1q", "有便秘困扰（筛查阳性）", "没有便秘困扰（筛查阴性）", "CONSTIPATION_SCREEN_POSITIVE", "CONSTIPATION_SCREEN_NEGATIVE"],
])("%s（一问筛查）", (scaleId, yes, no, positive, negative) => {
  it("答阳性选项 → 阳性标签", () => {
    const r = scoreScaleV2(scaleId, { [`${scaleId}_1`]: optByLabel(scaleId, `${scaleId}_1`, yes) });
    expect(r.ok).toBe(true);
    expect(tagCode(r)).toBe(positive);
    expect(r.totalScore).toBeNull();
  });
  it("答阴性选项 → 阴性标签", () => {
    expect(tagCode(scoreScaleV2(scaleId, { [`${scaleId}_1`]: optByLabel(scaleId, `${scaleId}_1`, no) }))).toBe(negative);
  });
  it("未答 → 阻断不出标签（正式问题无豁免）", () => {
    const r = scoreScaleV2(scaleId, {}, { deferClinical: true });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([`${scaleId}_1`]);
    expect(r.tags).toEqual([]);
  });
});
