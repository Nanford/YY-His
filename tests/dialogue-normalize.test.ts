/**
 * INPUT:  src/lib/dialogue/normalize-rules.ts、V2 规则数据（经 src/lib/rules 投影）
 * OUTPUT: 规则兜底归一化的单元测试
 * POS:    验证"确定性解析 + 保守不猜测"（AGENTS.md 硬约束 3：禁止编造，模糊回答必须 unclear）。
 *         V2 装机后布尔题选项 label 带括注（"是（1分）/否（0分）"、"是（筛查阳性）/否（筛查阴性）"），
 *         五级频度题投影为 choice（选项文案自带频度词，关键词解析逻辑共用）。
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

describe("是/否题（FRAIL，选项 label 带括注）", () => {
  const { question, options } = fixture("frail_1");
  const YES = options[0].label; // 是（1分）
  const NO = options[1].label; // 否（0分）

  it.each([
    ["是", YES],
    ["是的，经常觉得累", YES],
    ["对，没劲", YES],
    ["嗯，会累", YES],
    ["否", NO],
    ["不是", NO],
    ["没有", NO],
    ["我从来没觉得累", NO],
    ["不会", NO],
  ])("%s → %s", (utterance, expected) => {
    const outcome = normalizeByRules(question, options, utterance);
    expect(outcome.status).toBe("matched");
    if (outcome.status === "matched") expect(outcome.optionLabel).toBe(expected);
  });

  it("筛查类布尔题（fall_3q，label 无分值括注）同样命中", () => {
    const { question: q, options: opts } = fixture("fall_3q_1");
    const positive = normalizeByRules(q, opts, "是的，去年摔过一次");
    expect(positive.status).toBe("matched");
    if (positive.status === "matched") expect(positive.optionLabel).toBe(opts[0].label); // 是（筛查阳性）
    const negative = normalizeByRules(q, opts, "没有");
    expect(negative.status).toBe("matched");
    if (negative.status === "matched") expect(negative.optionLabel).toBe(opts[1].label); // 否（筛查阴性）
  });

  it("肯定与否定并存 → unclear（不猜测）", () => {
    expect(normalizeByRules(question, options, "以前不会，现在有点会").status).toBe("unclear");
  });

  it("答非所问 → unclear", () => {
    expect(normalizeByRules(question, options, "我昨天去公园散步了").status).toBe("unclear");
  });
});

describe("五级频度题（中医体质，V2 投影为 choice、选项文案自带频度词）", () => {
  const { question, options } = fixture("tcm_constitution_A.1-1");

  it.each([
    ["没有", 1],
    ["从来没有过", 1],
    ["很少", 2],
    ["有时候", 3],
    ["经常这样", 4],
    ["总是", 5],
  ])("%s → %d 分", (utterance, score) => {
    const outcome = normalizeByRules(question, options, utterance);
    expect(outcome.status).toBe("matched");
    if (outcome.status === "matched") expect(outcome.score).toBe(score);
  });

  it("未命中任何选项关键词的口语表达 → unclear（不猜测）", () => {
    // "偶尔吧""几乎每天都这样"不在 V2 选项文案的关键词内，规则层不得猜测归类
    expect(normalizeByRules(question, options, "偶尔吧").status).toBe("unclear");
    expect(normalizeByRules(question, options, "几乎每天都这样").status).toBe("unclear");
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
  const { question, options } = fixture("mnasf_1");

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

  it.each(["不知道", "记不清了", "说不好", "没听清", "我没听明白", "你再说一遍", "这是啥意思", "还行吧，说不上来"])("%s → unclear（患者表示不确定）", (utterance) => {
    const outcome = normalizeByRules(question, options, utterance);
    expect(outcome.status).toBe("unclear");
    if (outcome.status === "unclear") expect(outcome.reason).toContain("不确定");
  });

  it("空回答 → unclear", () => {
    expect(normalizeByRules(question, options, "   ").status).toBe("unclear");
  });
});
