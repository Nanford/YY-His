/**
 * INPUT:  src/lib/recommend、src/lib/scoring、src/lib/rules
 * OUTPUT: 干预推荐引擎用例：需求文档黄金用例、去重、倾向是触发、三大类分组、全标签覆盖
 * POS:    医学核心测试。依据：需求文档"第四步：干预方案推荐"与映射表 75 条边。
 */
import { describe, expect, it } from "vitest";
import { recommend } from "@/lib/recommend";
import { scoreAll } from "@/lib/scoring";
import type { AssessmentTag } from "@/lib/scoring";
import { mappingEdges } from "@/lib/rules";

/** 构造"是"级评估标签（detail 为空即可，推荐引擎只消费 tag 与 level） */
function tag(name: string, level: AssessmentTag["level"] = "是"): AssessmentTag {
  return { tag: name, level, scaleId: "test", score: 0, detail: [] };
}

describe("干预推荐 — 需求文档黄金用例", () => {
  // 来源：需求文档第四步示例——"衰弱、存在营养不良风险、跌倒风险筛查阴性、阴虚质"
  // 应汇总去重出：八段锦、太极拳、抗阻训练、平衡训练、均衡膳食维持、优质蛋白强化、能量与营养强化、滋阴食养
  const result = recommend([tag("衰弱"), tag("存在营养不良风险"), tag("跌倒风险筛查阴性"), tag("阴虚质")]);

  it("候选干预恰为 8 项且与需求文档示例一致", () => {
    expect(result.flat.map((i) => i.tag)).toEqual([
      "八段锦", "太极拳", "抗阻训练", "平衡训练",
      "均衡膳食维持", "优质蛋白强化", "能量与营养强化", "滋阴食养",
    ]);
  });

  it("按三大类分组：运动 4 / 膳食 3 / 中医食养 1", () => {
    const byCategory = Object.fromEntries(result.categories.map((c) => [c.category, c.items.length]));
    expect(byCategory).toEqual({ "运动干预": 4, "膳食补充": 3, "中医食养": 1 });
  });

  it("重复推荐已去重，triggeredBy 保留全部触发来源", () => {
    // 八段锦被 衰弱/跌倒阴性/阴虚质 三个标签同时触发，只出现一次
    const baduanjin = result.flat.find((i) => i.tag === "八段锦")!;
    expect(baduanjin.triggeredBy.map((s) => s.tag)).toEqual(["衰弱", "跌倒风险筛查阴性", "阴虚质"]);
  });

  it("展示的是执行方案全文而非标签名", () => {
    const ziyin = result.flat.find((i) => i.tag === "滋阴食养")!;
    expect(ziyin.plan).toContain("枸杞");
    expect(ziyin.plan).toContain("银耳");
    expect(ziyin.plan.length).toBeGreaterThan(50);
  });
});

describe("干预推荐 — 级别口径与健壮性", () => {
  it("'倾向是'视同正式体质触发映射（用户已确认口径），级别保留在触发来源中", () => {
    const result = recommend([tag("阴虚质", "倾向是")]);
    const tags = result.flat.map((i) => i.tag);
    expect(tags).toContain("滋阴食养");
    expect(result.flat[0].triggeredBy[0]).toEqual({ tag: "阴虚质", level: "倾向是" });
  });

  it("'基本是'（平和质）同样触发映射", () => {
    const result = recommend([tag("平和质", "基本是")]);
    expect(result.flat.map((i) => i.tag)).toContain("均衡膳食维持");
  });

  it("空标签集返回空结果但三大类结构完整", () => {
    const result = recommend([]);
    expect(result.flat).toHaveLength(0);
    expect(result.categories.map((c) => c.category)).toEqual(["运动干预", "膳食补充", "中医食养"]);
  });

  it("未知评估标签抛错", () => {
    expect(() => recommend([tag("不存在的标签")])).toThrow(/不在知识图谱映射表中/);
  });

  it("映射表中每个评估标签都能产出至少一项候选干预", () => {
    const allTags = [...new Set(mappingEdges.map((e) => e.assessmentTag))];
    expect(allTags).toHaveLength(17);
    for (const t of allTags) {
      expect(recommend([tag(t)]).flat.length).toBeGreaterThan(0);
    }
  });
});

describe("端到端：评分 → 推荐（需求文档示例患者）", () => {
  it("四类量表评分产出示例标签集，并推出 8 项候选干预", () => {
    const answers: Record<string, number> = {
      // FRAIL：3 项满足 → 衰弱
      frail_1: 1, frail_2: 1, frail_3: 1, frail_4: 0, frail_5: 0,
      // MNA-SF：合计 10 分 → 存在营养不良风险
      mnasf_A: 1, mnasf_B: 2, mnasf_C: 2, mnasf_D: 2, mnasf_E: 2, mnasf_F: 1,
      // 跌倒：全否 → 阴性
      fall_1: 0, fall_2: 0, fall_3: 0,
    };
    // 中医体质：阴虚质（题10,21,26,31）= 3+3+3+2 = 11 → 是；其余全部答 1
    for (let no = 1; no <= 33; no++) {
      answers[`tcm_${no}`] = { 10: 3, 21: 3, 26: 3, 31: 2 }[no] ?? 1;
    }

    const scored = scoreAll(["frail", "mnasf", "fall", "tcm"], answers);
    expect(scored.incompleteScaleIds).toHaveLength(0);
    expect(scored.tags.map((t) => `${t.tag}:${t.level}`).sort()).toEqual(
      ["衰弱:是", "存在营养不良风险:是", "跌倒风险筛查阴性:是", "阴虚质:是"].sort()
    );

    const plan = recommend(scored.tags);
    expect(plan.flat).toHaveLength(8);
    expect(plan.flat.map((i) => i.tag)).toContain("滋阴食养");
  });
});
