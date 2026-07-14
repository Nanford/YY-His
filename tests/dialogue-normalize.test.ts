/**
 * INPUT:  src/lib/dialogue/normalize-rules.ts、data/scales.json（经 src/lib/rules）
 * OUTPUT: 规则兜底归一化的单元测试
 * POS:    验证"确定性解析 + 保守不猜测"（AGENTS.md 硬约束 3：禁止编造，模糊回答必须 unclear）。
 */
import { describe, expect, it } from "vitest";
import { normalizeByRules } from "@/lib/dialogue/normalize-rules";
import { optionsOf, questionById, scaleByQuestionId } from "@/lib/rules";

/** 从真实规则数据取题目与选项，保证测试和线上数据结构一致 */
function fixture(questionId: string) {
  const question = questionById.get(questionId);
  const scale = scaleByQuestionId.get(questionId);
  if (!question || !scale) throw new Error(`测试数据缺少题目 ${questionId}`);
  return { question, options: optionsOf(scale, question) };
}

describe("是/否题（FRAIL/跌倒）", () => {
  const { question, options } = fixture("frail_1");

  it.each([
    ["是", "是"],
    ["是的，经常觉得累", "是"],
    ["对，没劲", "是"],
    ["嗯，会累", "是"],
    ["否", "否"],
    ["不是", "否"],
    ["没有", "否"],
    ["我从来没觉得累", "否"],
    ["不会", "否"],
  ])("%s → %s", (utterance, expected) => {
    const outcome = normalizeByRules(question, options, utterance);
    expect(outcome.status).toBe("matched");
    if (outcome.status === "matched") expect(outcome.optionLabel).toBe(expected);
  });

  it("肯定与否定并存 → unclear（不猜测）", () => {
    expect(normalizeByRules(question, options, "以前不会，现在有点会").status).toBe("unclear");
  });

  it("答非所问 → unclear", () => {
    expect(normalizeByRules(question, options, "我昨天去公园散步了").status).toBe("unclear");
  });
});

describe("likert5 题（中医体质五级频度）", () => {
  const { question, options } = fixture("tcm_1");

  it.each([
    ["没有", 1],
    ["从来没有过", 1],
    ["很少", 2],
    ["偶尔吧", 2],
    ["有时候", 3],
    ["经常这样", 4],
    ["总是", 5],
    ["几乎每天都这样", 5],
  ])("%s → %d 分", (utterance, score) => {
    const outcome = normalizeByRules(question, options, utterance);
    expect(outcome.status).toBe("matched");
    if (outcome.status === "matched") expect(outcome.score).toBe(score);
  });

  it("否定频度词不误判：不经常 → unclear（而不是命中\"经常\"）", () => {
    expect(normalizeByRules(question, options, "不经常").status).toBe("unclear");
  });

  it("序号与数字表达：选3 / 第三个 / 3", () => {
    for (const utterance of ["选3", "第三个", "3"]) {
      const outcome = normalizeByRules(question, options, utterance);
      expect(outcome.status).toBe("matched");
      if (outcome.status === "matched") expect(outcome.score).toBe(3);
    }
  });

  it("超范围序号 → unclear", () => {
    expect(normalizeByRules(question, options, "选8").status).toBe("unclear");
  });
});

describe("choice 题（MNA-SF）", () => {
  const { question, options } = fixture("mnasf_A");

  it("选项原文与关键词命中", () => {
    const byLabel = normalizeByRules(question, options, "食量没有改变");
    expect(byLabel.status).toBe("matched");
    if (byLabel.status === "matched") expect(byLabel.score).toBe(2);
  });

  it("命中多个选项 → unclear", () => {
    expect(normalizeByRules(question, options, "有时候严重减少有时候没有改变").status).toBe("unclear");
  });

  it("序号选择：第一个 → 首个选项", () => {
    const outcome = normalizeByRules(question, options, "第一个");
    expect(outcome.status).toBe("matched");
    if (outcome.status === "matched") expect(outcome.optionLabel).toBe(options[0].label);
  });
});

describe("通用保守策略", () => {
  const { question, options } = fixture("frail_1");

  it.each(["不知道", "记不清了", "说不好", "没听清"])("%s → unclear（患者表示不确定）", (utterance) => {
    const outcome = normalizeByRules(question, options, utterance);
    expect(outcome.status).toBe("unclear");
    if (outcome.status === "unclear") expect(outcome.reason).toContain("不确定");
  });

  it("空回答 → unclear", () => {
    expect(normalizeByRules(question, options, "   ").status).toBe("unclear");
  });
});
