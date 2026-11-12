/**
 * INPUT:  src/lib/assessment/answer-scoring.ts、src/lib/rules（真实题库的 minicog_2 / 多选题）
 * OUTPUT: 医生端追溯页「作答得分 / 评分标准」展示口径的单测
 * POS:    锁定 2026-11-12 用户拍板的口径：「AI评分」只标大模型给出的分，规则兜底标「规则判定」；
 *         医生改判后不再标 AI；多选题不显示占位 0 分；评分标准按 01 表选项列出并标记命中项。
 */
import { describe, expect, it } from "vitest";
import {
  describeAnswerScoring,
  readAiJudgment,
  scoringCriteriaOf,
  scoringMethodOf,
} from "@/lib/assessment/answer-scoring";
import { collectionItemById, questionById, scales } from "@/lib/rules";

const clock = questionById.get("minicog_2");
const AI = { method: "llm", reason: "看图判定：钟面轮廓闭合，1～12 齐全且方位正确，画有指针", confidence: 0.92 };

describe("readAiJudgment", () => {
  it("接受对象与 JSON 字符串两种存储形态", () => {
    expect(readAiJudgment(AI)).toEqual(AI);
    expect(readAiJudgment(JSON.stringify(AI))).toEqual(AI);
  });

  it("形状不符视为没有判定记录", () => {
    expect(readAiJudgment(null)).toBeNull();
    expect(readAiJudgment("不是 JSON")).toBeNull();
    expect(readAiJudgment({ reason: "缺 method" })).toBeNull();
    expect(readAiJudgment({ method: "rules", confidence: "高" })).toEqual({ method: "rules", reason: "", confidence: null });
  });
});

describe("scoringMethodOf", () => {
  it("理解回答的来源按判定方式区分 AI 与规则", () => {
    expect(scoringMethodOf("drawing", "llm")).toBe("ai");
    expect(scoringMethodOf("voice", "llm")).toBe("ai");
    expect(scoringMethodOf("text", "rules")).toBe("rules");
    expect(scoringMethodOf("voice", null)).toBe("rules");
  });

  it("来源优先：医生改判后即使留着 AI 判定记录也标医生评分", () => {
    expect(scoringMethodOf("doctor", "llm")).toBe("doctor");
    expect(scoringMethodOf("button", "rules")).toBe("patient");
    expect(scoringMethodOf("multi", "rules")).toBe("patient");
    expect(scoringMethodOf("system", null)).toBe("system");
    expect(scoringMethodOf("measurement", null)).toBe("system");
  });
});

describe("describeAnswerScoring", () => {
  it("AI 看图判定：得分、满分、理由与把握度", () => {
    expect(describeAnswerScoring({ source: "drawing", score: 2, aiJudgment: AI, question: clock })).toEqual({
      kind: "scored",
      score: 2,
      maxScore: 2,
      method: "ai",
      note: AI.reason,
      confidence: 0.92,
    });
  });

  it("规则判定写判定理由，不带把握度", () => {
    const scoring = describeAnswerScoring({
      source: "text",
      score: 0,
      aiJudgment: { method: "rules", reason: "规则兜底：未命中", confidence: 1 },
      question: clock,
    });
    expect(scoring).toMatchObject({ kind: "scored", method: "rules", note: "规则兜底：未命中", confidence: null });
  });

  it("医生评分的备注指向修改历史，不复述改判前的 AI 理由", () => {
    const scoring = describeAnswerScoring({ source: "doctor", score: 0, aiJudgment: AI, question: clock });
    expect(scoring).toMatchObject({ kind: "scored", method: "doctor", confidence: null });
    if (scoring.kind !== "scored") throw new Error("应为 scored");
    expect(scoring.note).toContain("修改历史");
  });

  it("没有分值 → 待评分，备注沿用判定理由", () => {
    const reason = "患者已提交画作，待医生确认计分（视觉模型不可用）";
    expect(
      describeAnswerScoring({ source: "drawing", score: null, aiJudgment: { method: "none", reason, confidence: null }, question: clock })
    ).toEqual({ kind: "pending", note: reason });
  });

  it("多选题不显示占位 0 分", () => {
    const multi = scales.flatMap((scale) => scale.questions).find((question) => question.answerType === "multiChoice");
    if (!multi) throw new Error("题库应至少有一道多选题");
    expect(describeAnswerScoring({ source: "multi", score: 0, aiJudgment: null, question: multi }).kind).toBe("unscored");
  });

  it("不计分条目（便秘病程开放题）不显示占位 0 分，追溯页能兜底查到题干与量表名", () => {
    expect(questionById.has("constipation_symptom_1")).toBe(false);
    const item = collectionItemById.get("constipation_symptom_1");
    expect(item?.question.isScored).toBe(false);
    expect(item?.scaleName).toBeTruthy();
    const scoring = describeAnswerScoring({
      source: "voice",
      score: 0,
      aiJudgment: { method: "rules", reason: "非计分开放题仅保存患者原始回答", confidence: 1 },
      question: item?.question,
    });
    expect(scoring.kind).toBe("unscored");
  });
});

describe("scoringCriteriaOf", () => {
  it("按 01 表选项列出评分标准，分值单列、文字剥掉括号注解，命中项打标记", () => {
    if (!clock?.options) throw new Error("minicog_2 应有标准选项");
    const criteria = scoringCriteriaOf(clock, clock.options[0].label);
    expect(criteria).toEqual([
      { label: "画钟正确：数字位置正确，且指针显示规定时间", score: 2, matched: true },
      { label: "画钟错误或未完成", score: 0, matched: false },
    ]);
  });

  it("没有记录答案时无命中项；题目不存在时为空清单", () => {
    expect(scoringCriteriaOf(clock, null).every((criterion) => !criterion.matched)).toBe(true);
    expect(scoringCriteriaOf(undefined, "任意")).toEqual([]);
  });
});
