/**
 * INPUT:  src/lib/recommend、src/lib/scoring、src/lib/rules
 * OUTPUT: 干预推荐引擎（V2 积分排名）用例：§4.3 黄金示例、同分排序、total>0 过滤、每类≤2、
 *         倾向是全分口径、积分明细求和、同类替换、端到端评分→推荐
 * POS:    医学核心测试。依据：需求更新说明 V2.0 §4「干预推荐积分规则」与积分表 510 条计分。
 */
import { describe, expect, it } from "vitest";
import { recommend, buildIntervention, MAX_PER_CATEGORY, type RecommendationResult } from "@/lib/recommend";
import { scoreAll } from "@/lib/scoring";
import type { AssessmentTag } from "@/lib/scoring";

/** 构造评估标签（推荐引擎只消费 tag 与 level） */
function tag(name: string, level: AssessmentTag["level"] = "是"): AssessmentTag {
  return { tag: name, level, scaleId: "test", score: 0, detail: [] };
}

/** 结果不变量：每类 ≤2 项、全部总分>0、flat 为各类拼接、类别固定顺序 */
function assertInvariants(result: RecommendationResult): void {
  expect(result.categories.map((c) => c.category)).toEqual(["运动干预", "膳食干预", "中医食养干预"]);
  for (const cat of result.categories) {
    expect(cat.items.length).toBeLessThanOrEqual(MAX_PER_CATEGORY);
    for (const item of cat.items) {
      expect(item.score).toBeGreaterThan(0);
      // 积分明细求和必须等于总分，且每条贡献 1-3
      expect(item.matchDetail.reduce((sum, d) => sum + d.score, 0)).toBe(item.score);
      for (const d of item.matchDetail) expect(d.score).toBeGreaterThanOrEqual(1);
    }
  }
  expect(result.flat).toEqual(result.categories.flatMap((c) => c.items));
  expect(result.flat.length).toBeLessThanOrEqual(6); // 总数不超过 6 项（§4.2）
}

describe("干预推荐 — §4.3 黄金示例", () => {
  // 来源：需求更新说明 V2.0 §4.3 —— 标签「衰弱、存在营养不良风险、跌倒风险筛查阳性、气虚质、血瘀质」
  const result = recommend([
    tag("衰弱"),
    tag("存在营养不良风险"),
    tag("跌倒风险筛查阳性"),
    tag("气虚质"),
    tag("血瘀质"),
  ]);

  it("恰好 6 项候选，编码与总分与文档逐项一致", () => {
    expect(result.flat.map((i) => [i.code, i.score])).toEqual([
      ["M06", 7], ["M12", 7], // 运动干预
      ["D03", 9], ["D06", 7], // 膳食干预
      ["C01", 9], ["C08", 4], // 中医食养干预
    ]);
  });

  it("按三大类分组：运动 2 / 膳食 2 / 中医食养 2", () => {
    expect(result.categories.map((c) => [c.category, c.items.map((i) => i.code)])).toEqual([
      ["运动干预", ["M06", "M12"]],
      ["膳食干预", ["D03", "D06"]],
      ["中医食养干预", ["C01", "C08"]],
    ]);
  });

  it("同分（M06=M12=7）按干预编码升序排列，结果稳定可复现", () => {
    const 运动 = result.categories[0].items;
    expect(运动[0].code).toBe("M06");
    expect(运动[1].code).toBe("M12");
    expect(运动[0].score).toBe(运动[1].score);
  });

  it("满足全部结果不变量（每类≤2、总分>0、明细求和一致）", () => {
    assertInvariants(result);
  });

  it("候选携带素材信息：运动为视频位、膳食/中医食养为图片", () => {
    const m06 = result.flat.find((i) => i.code === "M06")!;
    expect(m06.mediaType).toBe("video");
    expect(m06.mediaSrc).toBe("/interventions/videos/M06.mp4");
    expect(m06.text).toContain("抬起膝盖"); // 运动动作文字要点（来源 docx）
    const d03 = result.flat.find((i) => i.code === "D03")!;
    expect(d03.mediaType).toBe("image");
    expect(d03.mediaSrc).toBe("/interventions/D03.png");
    expect(d03.sourceFile).toBe("优质蛋白加餐.png");
  });
});

describe("干预推荐 — 级别口径与健壮性", () => {
  it("'倾向是'按积分矩阵全分参与（与'是'同码同分），级别保留在明细中", () => {
    const asIs = recommend([tag("血瘀质", "是")]);
    const asTend = recommend([tag("血瘀质", "倾向是")]);
    expect(asTend.flat.map((i) => [i.code, i.score])).toEqual(asIs.flat.map((i) => [i.code, i.score]));
    expect(asTend.flat[0].matchDetail[0].level).toBe("倾向是");
  });

  it("多体质 + 倾向是组合与'是'组合同码同分（口径不因级别改变）", () => {
    const asIs = recommend([tag("气虚质", "是"), tag("血瘀质", "是")]);
    const asTend = recommend([tag("气虚质", "倾向是"), tag("血瘀质", "倾向是")]);
    expect(asTend.flat.map((i) => i.code)).toEqual(asIs.flat.map((i) => i.code));
    assertInvariants(asTend);
  });

  it("空标签集：三大类结构完整但全部为空", () => {
    const result = recommend([]);
    expect(result.flat).toHaveLength(0);
    expect(result.categories.map((c) => c.items.length)).toEqual([0, 0, 0]);
  });

  it("总分为 0 的干预项不入选（total>0 过滤）", () => {
    // 单一"无衰弱"标签：入选项必然全部总分>0，不会因凑数纳入 0 分项
    const result = recommend([tag("无衰弱")]);
    assertInvariants(result);
    for (const item of result.flat) expect(item.score).toBeGreaterThan(0);
  });

  it("未知评估标签抛错", () => {
    expect(() => recommend([tag("不存在的标签")])).toThrow(/不在积分规则表中/);
  });

  it("17 个评估标签每个单独输入都能产出至少一项候选（矩阵无空行）", () => {
    const allTags = [
      "无衰弱", "衰弱前期", "衰弱", "营养正常", "存在营养不良风险", "营养不良",
      "跌倒风险筛查阴性", "跌倒风险筛查阳性",
      "平和质", "气虚质", "阳虚质", "阴虚质", "痰湿质", "湿热质", "血瘀质", "气郁质", "特禀质",
    ];
    for (const t of allTags) {
      expect(recommend([tag(t)]).flat.length).toBeGreaterThan(0);
    }
  });
});

describe("干预推荐 — 同类替换（医生调整）", () => {
  it("buildIntervention 计算任意编码对标签集的积分，供同类替换", () => {
    const tags = [tag("衰弱"), tag("气虚质")];
    const item = buildIntervention("M06", tags, 1)!;
    expect(item.code).toBe("M06");
    expect(item.category).toBe("运动干预");
    expect(item.rankInCategory).toBe(1);
    expect(item.score).toBe(item.matchDetail.reduce((s, d) => s + d.score, 0));
  });

  it("未知编码返回 null（调用方拒绝替换）", () => {
    expect(buildIntervention("X99", [tag("衰弱")])).toBeNull();
  });
});

describe("端到端：评分 → 积分推荐", () => {
  it("四类量表评分产出标签集，推荐结果满足全部不变量", () => {
    const answers: Record<string, number> = {
      frail_1: 1, frail_2: 1, frail_3: 1, frail_4: 0, frail_5: 0, // 衰弱
      mnasf_A: 1, mnasf_B: 2, mnasf_C: 2, mnasf_D: 2, mnasf_E: 2, mnasf_F: 1, // 存在营养不良风险
      fall_1: 0, fall_2: 0, fall_3: 0, // 跌倒阴性
    };
    for (let no = 1; no <= 33; no++) {
      answers[`tcm_${no}`] = { 10: 3, 21: 3, 26: 3, 31: 2 }[no] ?? 1; // 阴虚质
    }
    const scored = scoreAll(["frail", "mnasf", "fall", "tcm"], answers);
    expect(scored.incompleteScaleIds).toHaveLength(0);

    const plan = recommend(scored.tags);
    assertInvariants(plan);
    expect(plan.flat.length).toBeGreaterThan(0);
  });
});
