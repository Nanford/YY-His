/**
 * INPUT:  data/judgments-v2.json（perQuestionTags 判定配置 + 多判定数组合并）、data/scales-v2.json（题库）
 * OUTPUT: perQuestionTags 判定器与多判定合并用例（M10.3b）：
 *         fall_3q / dysphagia_screen / pressure_screen 的 anyYes+perQuestionTags 合并输出（阴阳性+单题标签）；
 *         water_swallow 六档选项 → 三标签映射；iciq 降级口径（Q1/Q2>0 或 Q4 漏尿情形 → 存在尿失禁 + 情形标签）；
 *         constipation_symptom 5 症状标签 + Bristol 7 型映射；缺失阻断/deferClinical 豁免语义
 * POS:    V2 评分引擎回归保险（来源：02 表「第N题回答『x』→ 标签」类单题判定规则）。
 */
import { describe, expect, it } from "vitest";
import { scoreScaleV2, type AnswersV2 } from "@/lib/scoring-v2";
import { optByLabel } from "./scoring-v2-helpers";

const YES = "是（筛查阳性）";
const NO = "否（筛查阴性）";

/** 按 label 逐题构造答案；null 表示不答（缺失） */
function labelAnswers(scaleId: string, entries: Record<string, string | null>): AnswersV2 {
  const answers: AnswersV2 = {};
  for (const [itemId, label] of Object.entries(entries)) {
    if (label !== null) answers[itemId] = optByLabel(scaleId, itemId, label);
  }
  return answers;
}

const tagCodes = (r: ReturnType<typeof scoreScaleV2>): string[] => r.tags.map((t) => t.code);

describe("fall_3q：anyYes + perQuestionTags 多判定合并（M10.3b）", () => {
  it("三题全否 → 仅阴性标签，无单题标签", () => {
    const r = scoreScaleV2("fall_3q", labelAnswers("fall_3q", { fall_3q_1: NO, fall_3q_2: NO, fall_3q_3: NO }));
    expect(r.ok).toBe(true);
    expect(tagCodes(r)).toEqual(["FALL_SCREEN_NEGATIVE"]);
    expect(r.totalScore).toBeNull();
  });

  it("仅第1题是 → 阳性 + FALL_HISTORY_1Y（合并输出 2 个标签）", () => {
    const r = scoreScaleV2("fall_3q", labelAnswers("fall_3q", { fall_3q_1: YES, fall_3q_2: NO, fall_3q_3: NO }));
    expect(tagCodes(r)).toEqual(["FALL_SCREEN_POSITIVE", "FALL_HISTORY_1Y"]);
  });

  it("三题全是 → 阳性 + 3 个单题标签（共 4 个，配置顺序拼接）", () => {
    const r = scoreScaleV2("fall_3q", labelAnswers("fall_3q", { fall_3q_1: YES, fall_3q_2: YES, fall_3q_3: YES }));
    expect(tagCodes(r)).toEqual([
      "FALL_SCREEN_POSITIVE",
      "FALL_HISTORY_1Y",
      "FALL_UNSTEADY_STANDING_WALKING",
      "FALL_FEAR_ACTIVITY_RESTRICTION",
    ]);
    // details 按 itemId 合并去重：同一条目被两份判定引用也只出现一次，且不计 duplicate
    expect(r.details).toHaveLength(3);
    expect(r.details.map((d) => d.itemId)).toEqual(["fall_3q_1", "fall_3q_2", "fall_3q_3"]);
    expect(r.details.every((d) => !d.excluded && d.answerLabel === YES)).toBe(true);
  });

  it("缺任一题 → 两份判定共集缺失，阻断且整体不出标签", () => {
    const r = scoreScaleV2("fall_3q", labelAnswers("fall_3q", { fall_3q_1: YES, fall_3q_2: NO, fall_3q_3: null }));
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["fall_3q_3"]);
    expect(r.tags).toEqual([]);
  });
});

describe("dysphagia_screen：anyYes + 5 条单题标签", () => {
  const SYM_YES = "是（该症状存在）";
  const SYM_NO = "否（该症状不存在）";
  const allNo = labelAnswers("dysphagia_screen", {
    dysphagia_screen_1: SYM_NO, dysphagia_screen_2: SYM_NO, dysphagia_screen_3: SYM_NO,
    dysphagia_screen_4: SYM_NO, dysphagia_screen_5: SYM_NO,
  });

  it("5 项全否 → 仅 DYSPHAGIA_SCREEN_NEGATIVE", () => {
    const r = scoreScaleV2("dysphagia_screen", allNo);
    expect(tagCodes(r)).toEqual(["DYSPHAGIA_SCREEN_NEGATIVE"]);
  });

  it("仅第2项是 → 阳性 + DYSPHAGIA_COUGH_CHOKE", () => {
    const r = scoreScaleV2("dysphagia_screen", {
      ...allNo,
      dysphagia_screen_2: optByLabel("dysphagia_screen", "dysphagia_screen_2", SYM_YES),
    });
    expect(tagCodes(r)).toEqual(["DYSPHAGIA_SCREEN_POSITIVE", "DYSPHAGIA_COUGH_CHOKE"]);
  });

  it("5 项全是 → 阳性 + 5 个单题标签", () => {
    const r = scoreScaleV2("dysphagia_screen", labelAnswers("dysphagia_screen", {
      dysphagia_screen_1: SYM_YES, dysphagia_screen_2: SYM_YES, dysphagia_screen_3: SYM_YES,
      dysphagia_screen_4: SYM_YES, dysphagia_screen_5: SYM_YES,
    }));
    expect(tagCodes(r)).toEqual([
      "DYSPHAGIA_SCREEN_POSITIVE",
      "DYSPHAGIA_DIFFICULTY_OR_PAIN",
      "DYSPHAGIA_COUGH_CHOKE",
      "DYSPHAGIA_ORAL_RESIDUE",
      "DYSPHAGIA_ORAL_LEAKAGE",
      "DYSPHAGIA_DROOLING",
    ]);
  });
});

describe("pressure_screen：双阳性文案 anyYes + 单题标签 + 医护观察题豁免", () => {
  const SKIN_YES = "发现皮肤异常（筛查阳性）";
  const SKIN_NO = "未发现皮肤异常（筛查阴性）";

  it("不卧床 + 皮肤无异常 → 阴性", () => {
    const r = scoreScaleV2("pressure_screen", labelAnswers("pressure_screen", {
      pressure_screen_1: NO, pressure_screen_2: SKIN_NO,
    }));
    expect(tagCodes(r)).toEqual(["PRESSURE_INJURY_SCREEN_NEGATIVE"]);
  });

  it("长期卧床（Q1 是）→ 阳性 + PRESSURE_INJURY_LONG_TERM_BEDREST", () => {
    const r = scoreScaleV2("pressure_screen", labelAnswers("pressure_screen", {
      pressure_screen_1: YES, pressure_screen_2: SKIN_NO,
    }));
    expect(tagCodes(r)).toEqual(["PRESSURE_INJURY_SCREEN_POSITIVE", "PRESSURE_INJURY_LONG_TERM_BEDREST"]);
  });

  it("皮肤异常（Q2 阳性文案）→ 阳性 + PRESSURE_INJURY_SKIN_ABNORMALITY", () => {
    const r = scoreScaleV2("pressure_screen", labelAnswers("pressure_screen", {
      pressure_screen_1: NO, pressure_screen_2: SKIN_YES,
    }));
    expect(tagCodes(r)).toEqual(["PRESSURE_INJURY_SCREEN_POSITIVE", "PRESSURE_INJURY_SKIN_ABNORMALITY"]);
  });

  it("Q2 医护观察题缺失：deferClinical 豁免（部分计分，按已答题判定）；strict 阻断", () => {
    const deferred = scoreScaleV2("pressure_screen",
      labelAnswers("pressure_screen", { pressure_screen_1: YES, pressure_screen_2: null }),
      { deferClinical: true });
    expect(deferred.ok).toBe(true);
    expect(deferred.partial).toBe(true);
    expect(deferred.deferred).toEqual(["pressure_screen_2"]);
    expect(tagCodes(deferred)).toEqual(["PRESSURE_INJURY_SCREEN_POSITIVE", "PRESSURE_INJURY_LONG_TERM_BEDREST"]);

    const strict = scoreScaleV2("pressure_screen",
      labelAnswers("pressure_screen", { pressure_screen_1: YES, pressure_screen_2: null }));
    expect(strict.ok).toBe(false);
    expect(strict.missing).toEqual(["pressure_screen_2"]);
    expect(strict.tags).toEqual([]);
  });
});

describe("water_swallow：六档选项 → 三标签逐档映射（操作测试条目）", () => {
  it.each([
    ["1级：一次喝完、无呛咳且≤5秒（正常）", "WATER_SWALLOW_NORMAL"],
    ["1级：一次喝完、无呛咳但＞5秒（可疑异常）", "WATER_SWALLOW_SUSPECTED_ABNORMAL"],
    ["2级：两次或以上喝完、无呛咳（可疑异常）", "WATER_SWALLOW_SUSPECTED_ABNORMAL"],
    ["3级：一次喝完但有呛咳（异常）", "WATER_SWALLOW_ABNORMAL"],
    ["4级：两次或以上喝完且有呛咳（异常）", "WATER_SWALLOW_ABNORMAL"],
    ["5级：饮水中频繁呛咳，很难全部喝完（异常）", "WATER_SWALLOW_ABNORMAL"],
  ])("「%s」→ %s", (label, tag) => {
    const r = scoreScaleV2("water_swallow", labelAnswers("water_swallow", { water_swallow_1: label }));
    expect(r.ok).toBe(true);
    expect(tagCodes(r)).toEqual([tag]);
  });

  it("未答：deferClinical 豁免（不出标签、部分计分）；strict 阻断", () => {
    const deferred = scoreScaleV2("water_swallow", {}, { deferClinical: true });
    expect(deferred.ok).toBe(true);
    expect(deferred.deferred).toEqual(["water_swallow_1"]);
    expect(deferred.partial).toBe(true);
    expect(deferred.tags).toEqual([]);

    const strict = scoreScaleV2("water_swallow", {});
    expect(strict.ok).toBe(false);
    expect(strict.missing).toEqual(["water_swallow_1"]);
  });

  it("答案 label 不在合法选项内 → 抛错（确定性红线）", () => {
    expect(() =>
      scoreScaleV2("water_swallow", { water_swallow_1: { kind: "option", label: "6级" } })
    ).toThrow(/不在合法选项内/);
  });
});

describe("iciq：M9.6 Q1+Q2+Q3 总分 + Q4 情形（多选）", () => {
  it("Q1～Q3 全 0 + Q4 从不 → NO_INCONTINENCE", () => {
    const r = scoreScaleV2("iciq", labelAnswers("iciq", {
      iciq_1: "从不（0分）",
      iciq_2: "没有（0分）",
      iciq_3: "0分（无任何影响）",
      iciq_4: "从不漏尿",
    }));
    expect(r.ok).toBe(true);
    expect(tagCodes(r)).toEqual(["ICIQ_NO_INCONTINENCE"]);
  });

  it("Q1 频率 >0 → PRESENT", () => {
    const r = scoreScaleV2("iciq", labelAnswers("iciq", {
      iciq_1: "每周2～3次（2分）",
      iciq_2: "没有（0分）",
      iciq_3: "0分（无任何影响）",
      iciq_4: "从不漏尿",
    }));
    expect(tagCodes(r)).toEqual(["ICIQ_INCONTINENCE_PRESENT"]);
  });

  it("Q2 漏量 >0 → PRESENT", () => {
    const r = scoreScaleV2("iciq", labelAnswers("iciq", {
      iciq_1: "从不（0分）",
      iciq_2: "大量（6分）",
      iciq_3: "0分（无任何影响）",
      iciq_4: "从不漏尿",
    }));
    expect(tagCodes(r)).toEqual(["ICIQ_INCONTINENCE_PRESENT"]);
  });

  it.each([
    ["未到达厕所前漏尿", "ICIQ_LEAK_BEFORE_TOILET"],
    ["咳嗽或打喷嚏时漏尿", "ICIQ_LEAK_COUGH_SNEEZE"],
    ["睡着时漏尿", "ICIQ_LEAK_ASLEEP"],
    ["活动或运动时漏尿", "ICIQ_LEAK_ACTIVITY"],
    ["小便结束并穿好衣服时漏尿", "ICIQ_LEAK_POST_VOID"],
    ["没有明显原因的漏尿", "ICIQ_LEAK_NO_OBVIOUS_REASON"],
    ["一直漏尿（本题不计入总分）", "ICIQ_CONTINUOUS_LEAKAGE"],
  ])("Q4 情形「%s」→ %s + PRESENT（总分 0 时剔除 NO）", (label, leakTag) => {
    const r = scoreScaleV2("iciq", labelAnswers("iciq", {
      iciq_1: "从不（0分）",
      iciq_2: "没有（0分）",
      iciq_3: "0分（无任何影响）",
      iciq_4: label,
    }));
    expect(tagCodes(r)).toEqual([leakTag, "ICIQ_INCONTINENCE_PRESENT"]);
  });

  it("缺 Q3 或 Q4（正式问题）→ 阻断", () => {
    const r = scoreScaleV2(
      "iciq",
      labelAnswers("iciq", {
        iciq_1: "每周2～3次（2分）",
        iciq_2: "少量（2分）",
        iciq_3: "0分（无任何影响）",
        iciq_4: null,
      }),
      { deferClinical: true }
    );
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["iciq_4"]);
    expect(r.tags).toEqual([]);
  });
});

describe("constipation_symptom：M9.6 Q3 低频率 + 症状 + Bristol", () => {
  const base: Record<string, string> = {
    constipation_symptom_3: "5次",
    constipation_symptom_4: "否",
    constipation_symptom_5: "否",
    constipation_symptom_6: "否",
    constipation_symptom_7: "否",
    constipation_symptom_8: "否",
    constipation_symptom_9: "腊肠样或蛇状，光滑而柔软",
  };

  it("5 症状全否 + Bristol 4 型 → 仅 STOOL_FORM_TYPE_4", () => {
    const r = scoreScaleV2("constipation_symptom", labelAnswers("constipation_symptom", base));
    expect(tagCodes(r)).toEqual(["STOOL_FORM_TYPE_4"]);
  });

  it.each([
    ["constipation_symptom_4", "CONSTIPATION_INCOMPLETE_EVACUATION"],
    ["constipation_symptom_5", "CONSTIPATION_ANORECTAL_BLOCKAGE"],
    ["constipation_symptom_6", "CONSTIPATION_PROLONGED_DEFECATION"],
    ["constipation_symptom_7", "CONSTIPATION_MANUAL_MANEUVER"],
    ["constipation_symptom_8", "CONSTIPATION_ABDOMINAL_DISCOMFORT_RELIEVED"],
  ])("%s 答「是」→ %s", (itemId, tag) => {
    const r = scoreScaleV2(
      "constipation_symptom",
      labelAnswers("constipation_symptom", { ...base, [itemId]: "是" })
    );
    expect(tagCodes(r)).toEqual([tag, "STOOL_FORM_TYPE_4"]);
  });

  it.each([
    ["数个干球状便，如坚果，很难排出", "STOOL_FORM_TYPE_1"],
    ["腊肠样，很硬", "STOOL_FORM_TYPE_2"],
    ["腊肠样，表面有裂缝", "STOOL_FORM_TYPE_3"],
    ["腊肠样或蛇状，光滑而柔软", "STOOL_FORM_TYPE_4"],
    ["柔软团块，切缘清楚（容易排出）", "STOOL_FORM_TYPE_5"],
    ["松散的碎片，边缘破糟，或糊状便", "STOOL_FORM_TYPE_6"],
    ["水样便", "STOOL_FORM_TYPE_7"],
  ])("Bristol「%s」→ %s", (label, tag) => {
    const r = scoreScaleV2(
      "constipation_symptom",
      labelAnswers("constipation_symptom", { ...base, constipation_symptom_9: label })
    );
    expect(tagCodes(r)).toEqual([tag]);
  });

  it("Q1/Q2 年月题 options=null 仍 excluded；Q3 已纳入", () => {
    const r = scoreScaleV2("constipation_symptom", labelAnswers("constipation_symptom", base));
    expect(r.details.find((d) => d.itemId === "constipation_symptom_1")!.excluded).toBe(true);
    expect(r.details.find((d) => d.itemId === "constipation_symptom_2")!.excluded).toBe(true);
    expect(r.details.find((d) => d.itemId === "constipation_symptom_3")!.excluded).toBe(false);
    expect(r.missing).toEqual([]);
  });

  it("临床判定标签不自动产出", () => {
    const r = scoreScaleV2(
      "constipation_symptom",
      labelAnswers("constipation_symptom", {
        ...base,
        constipation_symptom_4: "是",
        constipation_symptom_5: "是",
      })
    );
    expect(tagCodes(r)).not.toContain("CONSTIPATION_NOT_DIAGNOSED");
    expect(tagCodes(r)).not.toContain("CONSTIPATION_DIAGNOSED");
    expect(tagCodes(r)).not.toContain("CONSTIPATION_CLINICAL_TYPE");
  });

  it("缺 Q5（正式问题）→ 阻断不出标签", () => {
    const entries = { ...base, constipation_symptom_5: null };
    const r = scoreScaleV2("constipation_symptom", labelAnswers("constipation_symptom", entries));
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["constipation_symptom_5"]);
    expect(r.tags).toEqual([]);
  });
});
