/**
 * INPUT:  src/lib/dialogue/state-machine.ts 的 matchButtonOption、V2 规则数据（经 src/lib/rules 投影）
 * OUTPUT: 按钮/图片作答按 label 精确匹配的单元测试
 * POS:    锁定 P0 医学 bug 修复：rules 投影的 compatScore 把 score=null 折叠成 0/1，
 *         同分选项按分值 find 必撞首项（便秘筛查恒假阳性、Bristol 恒记 1 型、
 *         居家「不适用」被记成「否」、IADL 同分档追溯错位）——按钮/图片作答必须按
 *         选项 label 精确匹配，label 缺失时才回退分值匹配（number 题分值唯一）。
 */
import { describe, expect, it } from "vitest";
import { askableQuestions, matchButtonOption, type AskableQuestion } from "@/lib/dialogue/state-machine";

/** 取患者端可问题目（正式问题才会进问询清单） */
function itemOf(scaleId: string, questionId: string): AskableQuestion {
  const item = askableQuestions([scaleId]).find((q) => q.question.id === questionId);
  if (!item) throw new Error(`题目不在患者端问询清单：${questionId}`);
  return item;
}

describe("matchButtonOption：按钮/图片作答按 label 精确匹配", () => {
  it("constipation_1q_1：同分碰撞前提下选「没有便秘困扰」命中阴性项，不再恒假阳性", () => {
    const item = itemOf("constipation_1q", "constipation_1q_1");
    // 碰撞前提：score=null 被 compatScore 折叠后两个选项同分，按分值 find 必中首项（旧 bug 成因）
    expect(item.options[0].score).toBe(item.options[1].score);
    const negative = item.options.find((o) => o.label.includes("没有便秘困扰"));
    expect(negative).toBeDefined();
    const matched = matchButtonOption(item, negative!.label, undefined);
    expect(matched?.label).toBe(negative!.label);
    expect(matched?.label).not.toContain("筛查阳性");
  });

  it("constipation_symptom_9（Bristol 7 图）：选 4 型记 4 型，七个选项各归各位", () => {
    const item = itemOf("constipation_symptom", "constipation_symptom_9");
    expect(item.options).toHaveLength(7);
    // 碰撞前提：全部选项 score=null → 投影同分（旧 bug 下无论选什么都记成 1 型）
    for (const option of item.options) {
      expect(matchButtonOption(item, option.label, undefined)?.label).toBe(option.label);
    }
    const type4 = item.options[3];
    expect(type4.label).toContain("光滑而柔软");
    expect(matchButtonOption(item, type4.label, undefined)?.label).toBe(type4.label);
  });

  it("home_env_11/12/13：「不适用」记「不适用」，不被折叠成「否（0分）」", () => {
    for (const questionId of ["home_env_11", "home_env_12", "home_env_13"]) {
      const item = itemOf("home_env", questionId);
      const notApplicable = item.options.find((o) => o.label.startsWith("不适用"));
      const no = item.options.find((o) => o.label.startsWith("否"));
      expect(notApplicable).toBeDefined();
      expect(no).toBeDefined();
      // 碰撞前提：不适用（score=null → 0）与否（0分）同分
      expect(notApplicable!.score).toBe(no!.score);
      expect(matchButtonOption(item, notApplicable!.label, undefined)?.label).toBe(notApplicable!.label);
    }
  });

  it("iadl_1/iadl_8：同分选项按 label 各归各位", () => {
    const shopping = itemOf("iadl", "iadl_1");
    // 三个 0 分档：逐个按 label 命中自身
    const zeroScore = shopping.options.filter((o) => o.score === 0);
    expect(zeroScore.length).toBeGreaterThanOrEqual(3);
    for (const option of zeroScore) {
      expect(matchButtonOption(shopping, option.label, undefined)?.label).toBe(option.label);
    }
    const finance = itemOf("iadl", "iadl_8");
    // 两个 1 分档：选第二项不再撞首项
    const oneScore = finance.options.filter((o) => o.score === 1);
    expect(oneScore).toHaveLength(2);
    expect(matchButtonOption(finance, oneScore[1].label, undefined)?.label).toBe(oneScore[1].label);
  });

  it("label 缺失时回退分值匹配（number 题数字面板只传分值，分值唯一）", () => {
    const item = itemOf("iadl", "iadl_1");
    expect(matchButtonOption(item, undefined, 1)?.label).toBe(item.options[0].label);
    expect(matchButtonOption(item, undefined, 99)).toBeNull();
  });

  it("label 为权威依据：label 不命中时即使分值可匹配也返回 null（由 service 层抛业务冲突）", () => {
    const item = itemOf("iadl", "iadl_1");
    expect(matchButtonOption(item, "不存在的选项", 1)).toBeNull();
  });
});
