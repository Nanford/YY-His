/**
 * INPUT:  src/lib/dialogue/judge-rules.ts（自由回答规则兜底判定）、judge.ts（判定编排）
 * OUTPUT: 规则兜底的单元测试（数字/日期/地点/原文复述/词表命中）+ judgeFreeAnswer 无密钥路径
 * POS:    无 DeepSeek 密钥时的确定性兜底必须与 LLM 通道同口径：
 *         拿不准一律 unclear（硬约束 3 禁止编造），绝不强行给分。
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  extractFirstNumber,
  judgeByRules,
  matchWordsByRules,
} from "@/lib/dialogue/judge-rules";
import { judgeFreeAnswer } from "@/lib/dialogue/judge";
import { FREE_ANSWER_ITEMS, MMSE_LOCATION } from "@/lib/dialogue/cognitive-flow";
import { questionById } from "@/lib/rules";

// 判定编排测试强制走规则兜底（即使本机 .env.local 配了密钥也不出网）
beforeAll(() => {
  delete process.env.DEEPSEEK_API_KEY;
});

describe("extractFirstNumber：数字提取（阿拉伯/中文）", () => {
  it("常见读法", () => {
    expect(extractFirstNumber("93")).toBe(93);
    expect(extractFirstNumber("九十三")).toBe(93);
    expect(extractFirstNumber("一百")).toBe(100);
    expect(extractFirstNumber("等于八十六")).toBe(86);
    expect(extractFirstNumber("二零二六")).toBe(2026);
    expect(extractFirstNumber("不知道")).toBeNull();
  });
});

describe("judgeByRules：连减计算题（exactNumber）", () => {
  const spec = FREE_ANSWER_ITEMS.get("mmse_14"); // expected 93
  it("答对/答错/无法提取", () => {
    if (spec?.kind !== "exactNumber") throw new Error("spec 形态不对");
    expect(judgeByRules(spec, "九十三")).toBe("correct");
    expect(judgeByRules(spec, "93")).toBe("correct");
    expect(judgeByRules(spec, "九十五")).toBe("incorrect"); // 说错数字是有效错误回答
    expect(judgeByRules(spec, "不知道")).toBe("unclear"); // 规则兜底保守：交追问流程
  });
});

describe("judgeByRules：原文复述（verbatim）", () => {
  const spec = FREE_ANSWER_ITEMS.get("mmse_24"); // 瑞雪兆丰年
  it("完整复述判对，漏字长度不足保守 unclear，说够长度但不对判错", () => {
    if (spec?.kind !== "verbatim") throw new Error("spec 形态不对");
    expect(judgeByRules(spec, "瑞雪兆丰年")).toBe("correct");
    expect(judgeByRules(spec, "瑞雪兆丰年。")).toBe("correct");
    expect(judgeByRules(spec, "瑞雪兆丰")).toBe("unclear");
    expect(judgeByRules(spec, "大雪满天飞")).toBe("incorrect");
  });
});

describe("judgeByRules：时间定向（datePart，固定 2026-08-13 周四）", () => {
  const now = new Date(2026, 7, 13); // 2026-08-13，星期四
  it("年份：阿拉伯/中文读法判对，错年份判错", () => {
    const spec = { kind: "datePart", part: "year" } as const;
    expect(judgeByRules(spec, "2026年", now)).toBe("correct");
    expect(judgeByRules(spec, "二零二六年", now)).toBe("correct");
    expect(judgeByRules(spec, "2020年", now)).toBe("incorrect");
  });
  it("季节/月份/日期/星期", () => {
    expect(judgeByRules({ kind: "datePart", part: "season" }, "夏天", now)).toBe("correct");
    expect(judgeByRules({ kind: "datePart", part: "season" }, "冬天", now)).toBe("incorrect");
    expect(judgeByRules({ kind: "datePart", part: "month" }, "八月份", now)).toBe("correct");
    expect(judgeByRules({ kind: "datePart", part: "month" }, "3月", now)).toBe("incorrect");
    expect(judgeByRules({ kind: "datePart", part: "day" }, "13号", now)).toBe("correct");
    expect(judgeByRules({ kind: "datePart", part: "day" }, "12日", now)).toBe("correct"); // ±1 容忍
    expect(judgeByRules({ kind: "datePart", part: "day" }, "20号", now)).toBe("incorrect");
    expect(judgeByRules({ kind: "datePart", part: "weekday" }, "星期四", now)).toBe("correct");
    expect(judgeByRules({ kind: "datePart", part: "weekday" }, "礼拜天", now)).toBe("incorrect");
  });
});

describe("judgeByRules：地点定向（place，读 MMSE_LOCATION 配置）", () => {
  it("命中配置值（允许省略后缀）判对，否则保守 unclear", () => {
    expect(judgeByRules({ kind: "place", part: "province" }, `我们在${MMSE_LOCATION.province}`)).toBe("correct");
    // 省略「省」后缀的核心词也算对
    expect(judgeByRules({ kind: "place", part: "province" }, MMSE_LOCATION.province.replace(/省$/, ""))).toBe("correct");
    expect(judgeByRules({ kind: "place", part: "city" }, "不知道")).toBe("unclear");
  });
});

describe("matchWordsByRules：词复述兜底", () => {
  const words = ["皮球", "国旗", "树木"];
  it("命中部分/全部/明确不记得/无法判断", () => {
    expect(matchWordsByRules(words, "皮球和国旗")).toEqual(["皮球", "国旗"]);
    expect(matchWordsByRules(words, "皮球、国旗、树木")).toEqual(words);
    expect(matchWordsByRules(words, "不记得了")).toEqual([]); // 0 个词是有效回答
    expect(matchWordsByRules(words, "没听清")).toBeNull(); // unclear → 追问
    expect(matchWordsByRules(words, "今天天气不错")).toBeNull();
  });
});

describe("judgeFreeAnswer：编排（无密钥走规则兜底，映射回既有选项）", () => {
  it("连减题答对 → 1 分选项；答错 → 0 分选项", async () => {
    const question = questionById.get("mmse_14");
    const spec = FREE_ANSWER_ITEMS.get("mmse_14");
    if (!question || !spec) throw new Error("缺题目/配置");
    const base = { question, options: question.options ?? [], spec, patientCode: "P001" };
    const correct = await judgeFreeAnswer({ ...base, utterance: "九十三" });
    expect(correct).toMatchObject({ status: "matched", optionLabel: "回答93（1分）", score: 1, method: "rules" });
    const wrong = await judgeFreeAnswer({ ...base, utterance: "95" });
    expect(wrong).toMatchObject({ status: "matched", score: 0, method: "rules" });
  });

  it("minicog 词计数：复述两个词 → 「回忆2个词（2分）」选项", async () => {
    const question = questionById.get("minicog_3");
    const spec = FREE_ANSWER_ITEMS.get("minicog_3");
    if (!question || !spec) throw new Error("缺题目/配置");
    const outcome = await judgeFreeAnswer({
      question,
      options: question.options ?? [],
      spec,
      utterance: "苹果和汽车",
      patientCode: "P001",
    });
    expect(outcome).toMatchObject({ status: "matched", optionLabel: "回忆2个词（2分）", score: 2 });
  });
});
