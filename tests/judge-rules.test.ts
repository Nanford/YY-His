/**
 * INPUT:  src/lib/dialogue/judge-rules.ts（自由回答规则兜底判定）、judge.ts（判定编排）
 * OUTPUT: 规则兜底的单元测试（数字/连减相对计分/日期 ±1/地点/原文复述/看图识物/词表命中）+ judgeFreeAnswer 无密钥路径
 * POS:    无 DeepSeek 密钥时的确定性兜底必须与 LLM 通道同口径：
 *         拿不准一律 unclear（硬约束 3 禁止编造），绝不强行给分。
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  extractFirstNumber,
  judgeByRules,
  matchWordsByRules,
  serialReferenceOf,
  statedNumberOf,
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

describe("statedNumberOf：患者最终说出的数", () => {
  it("取最后说的数；口头禅里的「一」不算", () => {
    expect(statedNumberOf("93")).toBe(93);
    expect(statedNumberOf("九十三吧")).toBe(93);
    expect(statedNumberOf("100减7等于93")).toBe(93); // 先念算式再说结果
    expect(statedNumberOf("九十三不对九十二")).toBe(92); // 改口以最后为准
    expect(statedNumberOf("九十三我想一下")).toBe(93);
    expect(statedNumberOf("我想一想八十六")).toBe(86);
    expect(statedNumberOf("不知道")).toBeNull();
  });
});

describe("judgeByRules：连减计算题（serialSubtraction）", () => {
  const spec = FREE_ANSWER_ITEMS.get("mmse_14"); // expected 93
  it("答对/答错/无法提取", () => {
    if (spec?.kind !== "serialSubtraction") throw new Error("spec 形态不对");
    expect(judgeByRules(spec, "九十三")).toBe("correct");
    expect(judgeByRules(spec, "93")).toBe("correct");
    expect(judgeByRules(spec, "一百减七等于九十三")).toBe("correct");
    expect(judgeByRules(spec, "九十五")).toBe("incorrect"); // 说错数字是有效错误回答
    expect(judgeByRules(spec, "不知道")).toBe("unclear"); // 规则兜底保守：交追问流程
  });
});

describe("serialReferenceOf：连减相对计分（国标 WS/T 484 表 C.1 注 4）", () => {
  const spec15 = FREE_ANSWER_ITEMS.get("mmse_15"); // 01 表固定答案 86
  const spec14 = FREE_ANSWER_ITEMS.get("mmse_14");
  it("上一步说了数 → 该数 − 7；首步、无回答、回答无数字 → 01 表固定答案", () => {
    if (spec15?.kind !== "serialSubtraction" || spec14?.kind !== "serialSubtraction") throw new Error("spec 形态不对");
    expect(serialReferenceOf(spec15, "九十二")).toBe(85); // 上一步错答 92，本步答 85 得分
    expect(serialReferenceOf(spec15, "93")).toBe(86); // 上一步答对时与固定答案一致
    expect(serialReferenceOf(spec15, null)).toBe(86);
    expect(serialReferenceOf(spec15, "不知道")).toBe(86);
    expect(serialReferenceOf(spec14, "随便什么")).toBe(93); // 首步恒为 100 − 7
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
    expect(judgeByRules({ kind: "datePart", part: "weekday" }, "星期三", now)).toBe("correct"); // 差一天可算正确（国标注 2）
    expect(judgeByRules({ kind: "datePart", part: "weekday" }, "星期五", now)).toBe("correct");
    expect(judgeByRules({ kind: "datePart", part: "weekday" }, "星期二", now)).toBe("incorrect");
    expect(judgeByRules({ kind: "datePart", part: "weekday" }, "礼拜天", now)).toBe("incorrect");
  });
  it("差一天按真实日历算：跨月、跨周相邻也算对", () => {
    const day = { kind: "datePart", part: "day" } as const;
    const weekday = { kind: "datePart", part: "weekday" } as const;
    const firstOfSeptember = new Date(2026, 8, 1); // 9 月 1 日，前一天是 8 月 31 日
    expect(judgeByRules(day, "31号", firstOfSeptember)).toBe("correct");
    expect(judgeByRules(day, "2号", firstOfSeptember)).toBe("correct");
    expect(judgeByRules(day, "30号", firstOfSeptember)).toBe("incorrect");
    expect(judgeByRules(day, "1号", new Date(2026, 7, 31))).toBe("correct"); // 8 月 31 日答 1 号
    const sunday = new Date(2026, 10, 15); // 2026-11-15 星期日
    expect(judgeByRules(weekday, "星期六", sunday)).toBe("correct");
    expect(judgeByRules(weekday, "星期一", sunday)).toBe("correct");
    expect(judgeByRules(weekday, "星期二", sunday)).toBe("incorrect");
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

describe("judgeByRules：看图识物（naming，MMSE 命名题）", () => {
  const watch = FREE_ANSWER_ITEMS.get("mmse_22");
  const pencil = FREE_ANSWER_ITEMS.get("mmse_23");
  it("手表：标准名称与同义说法判对（单字「表」须整句就是它）", () => {
    if (watch?.kind !== "naming") throw new Error("spec 形态不对");
    expect(judgeByRules(watch, "手表")).toBe("correct");
    expect(judgeByRules(watch, "这是一块手表吧。")).toBe("correct");
    expect(judgeByRules(watch, "表")).toBe("correct");
    expect(judgeByRules(watch, "这是一块表吧")).toBe("correct");
    expect(judgeByRules(watch, "钟表")).toBe("correct");
    expect(judgeByRules(watch, "电子表")).toBe("correct");
  });
  it("手表：说成别的东西/认不出判错，否定句与答非所问保守 unclear", () => {
    if (watch?.kind !== "naming") throw new Error("spec 形态不对");
    expect(judgeByRules(watch, "闹钟")).toBe("incorrect");
    expect(judgeByRules(watch, "像个手环")).toBe("incorrect");
    expect(judgeByRules(watch, "不认识")).toBe("incorrect");
    expect(judgeByRules(watch, "不知道")).toBe("incorrect");
    expect(judgeByRules(watch, "不是手表")).toBe("unclear");
    expect(judgeByRules(watch, "这个表示什么意思")).toBe("unclear"); // "表示"不能误命中单字「表」
    expect(judgeByRules(watch, "没听清")).toBe("unclear");
  });
  it("铅笔：只认含「铅笔」的说法，只说「笔」或说成其他笔判错", () => {
    if (pencil?.kind !== "naming") throw new Error("spec 形态不对");
    expect(judgeByRules(pencil, "铅笔")).toBe("correct");
    expect(judgeByRules(pencil, "是一支铅笔")).toBe("correct");
    expect(judgeByRules(pencil, "彩色铅笔")).toBe("correct");
    expect(judgeByRules(pencil, "笔")).toBe("incorrect");
    expect(judgeByRules(pencil, "钢笔吧")).toBe("incorrect");
    expect(judgeByRules(pencil, "圆珠笔")).toBe("incorrect");
    expect(judgeByRules(pencil, "说不上来")).toBe("incorrect");
    expect(judgeByRules(pencil, "再说一遍")).toBe("unclear");
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

  it("连减相对计分：上一步答 92，本步答 85 → 1 分并留痕；答 86 → 0 分", async () => {
    const question = questionById.get("mmse_15");
    const spec = FREE_ANSWER_ITEMS.get("mmse_15");
    if (!question || !spec) throw new Error("缺题目/配置");
    const base = { question, options: question.options ?? [], spec, patientCode: "P001", previousAnswerText: "九十二" };
    const relative = await judgeFreeAnswer({ ...base, utterance: "八十五" });
    expect(relative).toMatchObject({ status: "matched", optionLabel: "回答86（1分）", score: 1, method: "rules" });
    expect(relative.status === "matched" && relative.reason).toContain("上一步回答 92，本步应答 85");
    const fixed = await judgeFreeAnswer({ ...base, utterance: "八十六" });
    expect(fixed).toMatchObject({ status: "matched", score: 0 });
  });

  it("看图识物：说出「表」→ 1 分选项；说成「笔」→ 0 分选项", async () => {
    for (const [id, utterance, score] of [
      ["mmse_22", "表", 1],
      ["mmse_23", "一支笔", 0],
    ] as const) {
      const question = questionById.get(id);
      const spec = FREE_ANSWER_ITEMS.get(id);
      if (!question || !spec) throw new Error("缺题目/配置");
      const outcome = await judgeFreeAnswer({ question, options: question.options ?? [], spec, utterance, patientCode: "P001" });
      expect(outcome, id).toMatchObject({ status: "matched", score, method: "rules" });
    }
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
