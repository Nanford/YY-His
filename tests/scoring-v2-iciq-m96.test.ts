/**
 * INPUT:  ICIQ / 便秘症状 M9.6 判定补全
 * OUTPUT: Q3 数字 + Q4 多选 + 便秘低频率标签用例
 */
import { describe, expect, it } from "vitest";
import { scoreScaleV2 } from "@/lib/scoring-v2";
import { optByLabel, optByScore } from "./scoring-v2-helpers";

describe("ICIQ M9.6", () => {
  it("Q1+Q2+Q3 全 0 且 Q4 从不 → 无尿失禁", () => {
    const r = scoreScaleV2("iciq", {
      iciq_1: optByScore("iciq", "iciq_1", 0),
      iciq_2: optByScore("iciq", "iciq_2", 0),
      iciq_3: optByScore("iciq", "iciq_3", 0),
      iciq_4: optByLabel("iciq", "iciq_4", "从不漏尿"),
    });
    expect(r.ok).toBe(true);
    expect(r.totalScore).toBe(0);
    expect(r.tags.map((t) => t.code)).toEqual(["ICIQ_NO_INCONTINENCE"]);
  });

  it("Q3 有分 → PRESENT；Q4 多选情形出漏尿标签", () => {
    const r = scoreScaleV2("iciq", {
      iciq_1: optByScore("iciq", "iciq_1", 0),
      iciq_2: optByScore("iciq", "iciq_2", 0),
      iciq_3: optByScore("iciq", "iciq_3", 5),
      iciq_4: {
        kind: "option",
        label: "咳嗽或打喷嚏时漏尿 || 睡着时漏尿",
      },
    });
    expect(r.totalScore).toBe(5);
    const codes = r.tags.map((t) => t.code);
    expect(codes).toContain("ICIQ_INCONTINENCE_PRESENT");
    expect(codes).toContain("ICIQ_LEAK_COUGH_SNEEZE");
    expect(codes).toContain("ICIQ_LEAK_ASLEEP");
    expect(codes).not.toContain("ICIQ_NO_INCONTINENCE");
  });
});

describe("便秘症状 Q3 低频率", () => {
  it("每周 2 次 → CONSTIPATION_LOW_FREQUENCY", () => {
    const answers: Record<string, ReturnType<typeof optByLabel | typeof optByScore>> = {
      constipation_symptom_3: optByScore("constipation_symptom", "constipation_symptom_3", 2),
      constipation_symptom_4: optByLabel("constipation_symptom", "constipation_symptom_4", "否"),
      constipation_symptom_5: optByLabel("constipation_symptom", "constipation_symptom_5", "否"),
      constipation_symptom_6: optByLabel("constipation_symptom", "constipation_symptom_6", "否"),
      constipation_symptom_7: optByLabel("constipation_symptom", "constipation_symptom_7", "否"),
      constipation_symptom_8: optByLabel("constipation_symptom", "constipation_symptom_8", "否"),
      constipation_symptom_9: optByLabel(
        "constipation_symptom",
        "constipation_symptom_9",
        "腊肠样或蛇状，光滑而柔软"
      ),
    };
    const r = scoreScaleV2("constipation_symptom", answers);
    expect(r.tags.map((t) => t.code)).toContain("CONSTIPATION_LOW_FREQUENCY");
    expect(r.tags.map((t) => t.code)).toContain("STOOL_FORM_TYPE_4");
  });
});
