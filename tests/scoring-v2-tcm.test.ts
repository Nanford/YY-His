/**
 * INPUT:  data/judgments-v2.json（tcmConstitutionV2 判定配置，含平和质 reverseItemIds）、data/scales-v2.json（题库）
 * OUTPUT: 中医体质判定用例：转化分精确边界（3 题体质 sum=8→41.7 是 / 7→33.3 倾向 / 6→25 否）、
 *         平和质负向题反向计分（健康画像 100 是 / 62.5 是 / 其他 30–39 基本是 / 56.25 否 / 症状重反降 25 否）、
 *         湿热质性别互斥 N/A 剔除分母、多体质同时命中全部保留、偏颇"是"与平和"否"并存、缺失阻断
 * POS:    V2 评分引擎回归保险（来源：02 表中医体质 27 条判定规则；转化分公式按国标推定；
 *         平和质 A.1-2/A.1-3/A.1-4 负向题按 6−原始分 反向计分，来源：国标 CCMQ 口径；
 *         偏颇 8 质题目经题干逐条核对均为正向症状描述，无需反向）。
 */
import { describe, expect, it } from "vitest";
import { scoreScaleV2 } from "@/lib/scoring-v2";
import { optByLabel, tcmAnswers } from "./scoring-v2-helpers";

const tagCodes = (r: ReturnType<typeof scoreScaleV2>): string[] => r.tags.map((t) => t.code);
const constitutionOf = (r: ReturnType<typeof scoreScaleV2>, key: string) =>
  r.constitutions!.find((c) => c.key === key)!;

describe("中医体质辨识（27 计分题转化分版）", () => {
  it("全部答 1 分 → 偏颇 8 质转化分全 0 判否；平和质负向题反向后 75 → 是", () => {
    const r = scoreScaleV2("tcm_constitution", tcmAnswers());
    expect(r.ok).toBe(true);
    expect(r.totalScore).toBeNull();
    expect(r.tags).toHaveLength(9);
    // A.1-1 原始 1 + 负向题反向 3×(6−1)=15 → 原始分 16 → (16−4)/16×100=75 ≥60 且其他 8 质全 0 <30
    const balanced = constitutionOf(r, "balanced");
    expect(balanced.rawSum).toBe(16);
    expect(balanced.transformedScore).toBe(75);
    expect(tagCodes(r)).toContain("TCM_BALANCED_YES");
    for (const key of ["qi_deficiency", "yang_deficiency", "yin_deficiency", "phlegm_dampness", "damp_heat", "blood_stasis", "qi_stagnation", "special_constitution"]) {
      expect(constitutionOf(r, key).transformedScore).toBe(0);
      expect(constitutionOf(r, key).tagCode).toMatch(/_NO$/);
    }
    expect(r.constitutions).toHaveLength(9);
    // 30 行明细：27 计分 + 3 纯复用行（excluded）
    expect(r.details).toHaveLength(30);
    expect(r.details.filter((d) => d.excluded)).toHaveLength(3);
  });

  describe("偏颇体质转化分精确边界（3 题体质：气虚）", () => {
    it.each([
      [{ "tcm_constitution_A.1-2": 3, "tcm_constitution_A.2-2": 3, "tcm_constitution_A.2-3": 2 }, 8, 41.7, "TCM_QI_DEFICIENCY_YES"],
      [{ "tcm_constitution_A.1-2": 3, "tcm_constitution_A.2-2": 2, "tcm_constitution_A.2-3": 2 }, 7, 33.3, "TCM_QI_DEFICIENCY_TENDENCY"],
      [{ "tcm_constitution_A.1-2": 2, "tcm_constitution_A.2-2": 2, "tcm_constitution_A.2-3": 2 }, 6, 25, "TCM_QI_DEFICIENCY_NO"],
    ])("气虚原始分合计 %i → 转化分 %f → %s", (overrides, rawSum, transformed, tag) => {
      const r = scoreScaleV2("tcm_constitution", tcmAnswers(overrides));
      const c = constitutionOf(r, "qi_deficiency");
      expect(c.rawSum).toBe(rawSum);
      expect(c.applicableCount).toBe(3);
      expect(c.transformedScore).toBe(transformed);
      expect(c.tagCode).toBe(tag);
      expect(tagCodes(r)).toContain(tag);
    });
  });

  describe("平和质判定（负向题 A.1-2/A.1-3/A.1-4 按 6−原始分 反向计分，来源：国标 CCMQ；依赖其他 8 种转化分）", () => {
    it("健康画像（A.1-1 答 5、负向题答 1）→ 原始分 20 → 转化分 100 → 是", () => {
      const r = scoreScaleV2("tcm_constitution", tcmAnswers({ "tcm_constitution_A.1-1": 5 }));
      const c = constitutionOf(r, "balanced");
      expect(c.rawSum).toBe(20); // 5 + 3×(6−1)
      expect(c.transformedScore).toBe(100);
      expect(c.tagCode).toBe("TCM_BALANCED_YES");
      // 共享题未反向计入偏颇质：气虚原始 3 → 转化分 0
      expect(constitutionOf(r, "qi_deficiency").transformedScore).toBe(0);
    });
    it("负向题症状重（各 5 分）→ 反向后原始分 8 → 转化分 25 → 否（症状多不再误判平和）", () => {
      const r = scoreScaleV2("tcm_constitution", tcmAnswers({
        "tcm_constitution_A.1-1": 5, "tcm_constitution_A.1-2": 5,
        "tcm_constitution_A.1-3": 5, "tcm_constitution_A.1-4": 5,
      }));
      const c = constitutionOf(r, "balanced");
      expect(c.rawSum).toBe(8); // 5 + 3×(6−5)
      expect(c.transformedScore).toBe(25);
      expect(c.tagCode).toBe("TCM_BALANCED_NO");
      // 同一回答在偏颇质方向正常累加：气虚原始 5+1+1=7 → 33.3 倾向是
      expect(constitutionOf(r, "qi_deficiency").tagCode).toBe("TCM_QI_DEFICIENCY_TENDENCY");
    });
    it("阈值边界：原始分 14 → 转化分 62.5 ≥60 且其他 8 质均 <30 → 是", () => {
      const r = scoreScaleV2("tcm_constitution", tcmAnswers({
        "tcm_constitution_A.1-1": 2, "tcm_constitution_A.1-2": 2,
        "tcm_constitution_A.1-3": 2, "tcm_constitution_A.1-4": 2,
      }));
      const c = constitutionOf(r, "balanced");
      expect(c.rawSum).toBe(14); // 2 + 3×(6−2)
      expect(c.transformedScore).toBe(62.5);
      expect(c.tagCode).toBe("TCM_BALANCED_YES");
      // 共享题带来的其他体质转化分仍 <30（气虚原始 2+1+1=4 → (4−3)/12×100≈8.3）
      expect(constitutionOf(r, "qi_deficiency").transformedScore).toBe(8.3);
    });
    it("转化分 ≥60 但气虚 33.3 落在 30–39 → 基本是", () => {
      const r = scoreScaleV2("tcm_constitution", tcmAnswers({
        "tcm_constitution_A.1-1": 5, "tcm_constitution_A.1-2": 2,
        "tcm_constitution_A.2-2": 3, "tcm_constitution_A.2-3": 2,
      }));
      // 平和质原始 5+(6−2)+5+5=19 → 93.75 ≥60；气虚原始 2+3+2=7 → 33.3 落在 30–39
      expect(constitutionOf(r, "balanced").tagCode).toBe("TCM_BALANCED_BASICALLY");
      expect(constitutionOf(r, "qi_deficiency").tagCode).toBe("TCM_QI_DEFICIENCY_TENDENCY");
    });
    it("阈值边界：原始分 13 → 转化分 56.25 <60 → 否", () => {
      const r = scoreScaleV2("tcm_constitution", tcmAnswers({
        "tcm_constitution_A.1-1": 1, "tcm_constitution_A.1-2": 2,
        "tcm_constitution_A.1-3": 2, "tcm_constitution_A.1-4": 2,
      }));
      expect(constitutionOf(r, "balanced").rawSum).toBe(13); // 1 + 3×(6−2)
      expect(constitutionOf(r, "balanced").transformedScore).toBe(56.3);
      expect(constitutionOf(r, "balanced").tagCode).toBe("TCM_BALANCED_NO");
    });
    it("偏颇质「是」与平和质「否」可同时成立", () => {
      const r = scoreScaleV2("tcm_constitution", tcmAnswers({
        "tcm_constitution_A.1-2": 3, "tcm_constitution_A.2-2": 3, "tcm_constitution_A.2-3": 2,
      }));
      expect(tagCodes(r)).toContain("TCM_QI_DEFICIENCY_YES");
      expect(tagCodes(r)).toContain("TCM_BALANCED_NO");
    });
  });

  describe("湿热质性别互斥题 N/A 剔除", () => {
    const dampHeatHigh = {
      "tcm_constitution_A.6-1": 5, "tcm_constitution_A.6-2": 5, "tcm_constitution_A.6-4": 5,
    };
    it("男性：A.6-3（白带）显式 na → 适用题数 3，转化分 100 → 是", () => {
      const r = scoreScaleV2("tcm_constitution", tcmAnswers({
        ...dampHeatHigh, "tcm_constitution_A.6-3": { kind: "na" },
      }));
      const c = constitutionOf(r, "damp_heat");
      expect(c.applicableCount).toBe(3);
      expect(c.rawSum).toBe(15);
      expect(c.transformedScore).toBe(100);
      expect(c.tagCode).toBe("TCM_DAMP_HEAT_YES");
      const detail = r.details.find((d) => d.itemId === "tcm_constitution_A.6-3")!;
      expect(detail.excluded).toBe(true);
      expect(detail.score).toBeNull();
    });
    it("女性：A.6-4（阴囊潮湿）选「不适用（非男性）」无分选项 → 同样剔除", () => {
      const r = scoreScaleV2("tcm_constitution", tcmAnswers({
        "tcm_constitution_A.6-1": 5, "tcm_constitution_A.6-2": 5, "tcm_constitution_A.6-3": 5,
        "tcm_constitution_A.6-4": optByLabel("tcm_constitution", "tcm_constitution_A.6-4", "不适用（非男性）"),
      }));
      const c = constitutionOf(r, "damp_heat");
      expect(c.applicableCount).toBe(3);
      expect(c.transformedScore).toBe(100);
      const detail = r.details.find((d) => d.itemId === "tcm_constitution_A.6-4")!;
      expect(detail.excluded).toBe(true);
      expect(detail.answerLabel).toBe("不适用（非男性）");
    });
    it("两题都答（均不适用外的选项）→ 适用题数 4", () => {
      const r = scoreScaleV2("tcm_constitution", tcmAnswers({
        "tcm_constitution_A.6-1": 5, "tcm_constitution_A.6-2": 5,
        "tcm_constitution_A.6-3": 5, "tcm_constitution_A.6-4": 5,
      }));
      expect(constitutionOf(r, "damp_heat").applicableCount).toBe(4);
      expect(constitutionOf(r, "damp_heat").transformedScore).toBe(100);
    });
  });

  it("多体质同时命中全部保留（气虚是 + 血瘀是），且 9 标签互斥档齐全", () => {
    const r = scoreScaleV2("tcm_constitution", tcmAnswers({
      "tcm_constitution_A.1-2": 3, "tcm_constitution_A.2-2": 3, "tcm_constitution_A.2-3": 2,
      "tcm_constitution_A.7-1": 3, "tcm_constitution_A.7-2": 3, "tcm_constitution_A.7-3": 2,
    }));
    expect(tagCodes(r)).toContain("TCM_QI_DEFICIENCY_YES");
    expect(tagCodes(r)).toContain("TCM_BLOOD_STASIS_YES");
    expect(r.tags).toHaveLength(9);
    // 每体质恰落一档：tagCode 与 tags 一一对应
    expect(new Set(r.constitutions!.map((c) => c.tagCode)).size).toBe(9);
    for (const t of r.tags) expect(t.name).toBeTruthy();
  });

  it("任一计分题（正式问题）缺失 → 阻断不出标签", () => {
    const answers = tcmAnswers();
    delete answers["tcm_constitution_A.5-1"];
    const r = scoreScaleV2("tcm_constitution", answers, { deferClinical: true });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["tcm_constitution_A.5-1"]);
    expect(r.tags).toEqual([]);
    expect(r.constitutions).toBeUndefined();
  });

  it("答案 label 不在合法选项内 → 抛错（确定性红线）", () => {
    const answers = tcmAnswers({ "tcm_constitution_A.1-1": { kind: "option", label: "大概吧" } });
    expect(() => scoreScaleV2("tcm_constitution", answers)).toThrow(/不在合法选项内/);
  });
});
