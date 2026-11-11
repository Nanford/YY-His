/**
 * INPUT:  src/lib/dialogue/cognitive-flow.ts（认知评估特殊流程配置）、src/lib/rules（投影）
 * OUTPUT: 配置完整性测试（2026-08-13 认知题改版）
 * POS:    锁定：词表/期望值/目标句从 scales-v2.json 正确解析；组配置与 free 题配置结构合法；
 *         投影层 responseMode/free 标记与可问性（组目标不单独提问、trigger 可问）；
 *         看图识物（2026-11-11）：命名题向患者提问并带图，图片文件存在。
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FREE_ANSWER_ITEMS,
  GROUP_NON_TRIGGER_IDS,
  INSTRUCTION_BROADCASTS,
  MINICOG_WORDS,
  MMSE_WORDS,
  SCREEN_STIMULI,
  WORD_RECALL_GROUPS,
  displayTextOverride,
  instructionBeforeItem,
  isFreeResponseItem,
  polarOptionsOf,
  spokenTextOverride,
} from "@/lib/dialogue/cognitive-flow";
import { askableQuestions } from "@/lib/dialogue/state-machine";
import { questionById } from "@/lib/rules";

describe("cognitive-flow：词表/期望值从 V2 条目解析", () => {
  it("MMSE 三词解析自 mmse_11/12/13 文本", () => {
    expect(MMSE_WORDS).toEqual(["皮球", "国旗", "树木"]);
  });

  it("minicog 三词解析自 minicog_1 文本", () => {
    expect(MINICOG_WORDS).toEqual(["苹果", "钥匙", "汽车"]);
  });

  it("连减固定答案解析自各题 1 分选项（93/86/79/72/65），并逐题指向上一步（相对计分）", () => {
    const specs = ["mmse_14", "mmse_15", "mmse_16", "mmse_17", "mmse_18"].map((id) => {
      const spec = FREE_ANSWER_ITEMS.get(id);
      if (spec?.kind !== "serialSubtraction") throw new Error(`${id} 应为 serialSubtraction`);
      return spec;
    });
    expect(specs.map((spec) => spec.expected)).toEqual([93, 86, 79, 72, 65]);
    expect(specs.map((spec) => spec.previousItemId)).toEqual([null, "mmse_14", "mmse_15", "mmse_16", "mmse_17"]);
    expect(specs.every((spec) => spec.step === 7)).toBe(true);
  });

  it("mmse_24 目标句解析为「瑞雪兆丰年」", () => {
    const spec = FREE_ANSWER_ITEMS.get("mmse_24");
    if (spec?.kind !== "verbatim") throw new Error("mmse_24 应为 verbatim");
    expect(spec.target).toBe("瑞雪兆丰年");
  });

  it("minicog_3 为词计数题，词表 3 个", () => {
    const spec = FREE_ANSWER_ITEMS.get("minicog_3");
    if (spec?.kind !== "wordCount") throw new Error("minicog_3 应为 wordCount");
    expect(spec.words).toEqual(["苹果", "钥匙", "汽车"]);
  });
});

describe("cognitive-flow：指令播报与组回答配置", () => {
  it("minicog 三词播报插在画钟（minicog_2）前，文本即 minicog_1 原文", () => {
    const broadcast = INSTRUCTION_BROADCASTS.find((b) => b.id === "instr_minicog_words");
    expect(broadcast?.beforeItemId).toBe("minicog_2");
    expect(broadcast?.text).toContain("苹果、钥匙、汽车");
    expect(instructionBeforeItem.get("minicog_2")?.id).toBe("instr_minicog_words");
  });

  it("MMSE 三词播报插在立即复述（mmse_11）前，含三个词", () => {
    const broadcast = INSTRUCTION_BROADCASTS.find((b) => b.id === "instr_mmse_words");
    expect(broadcast?.beforeItemId).toBe("mmse_11");
    for (const word of ["皮球", "国旗", "树木"]) expect(broadcast?.text).toContain(word);
  });

  it("指令播报：记忆词只播报不上屏 + 放慢语速（2026-09-04 修改意见 3）", () => {
    for (const broadcast of INSTRUCTION_BROADCASTS) {
      // 展示文案不得含任何记忆词（患者照屏读词会使记忆测试失效）
      const words = broadcast.scaleId === "minicog" ? MINICOG_WORDS : MMSE_WORDS;
      for (const word of words) expect(broadcast.displayText).not.toContain(word);
      // 播报语速低于全局默认（-10），让患者听清每个词
      expect(broadcast.speechRate).toBeLessThan(-10);
      expect(broadcast.speechRate).toBeGreaterThanOrEqual(-50);
    }
  });

  it("mmse_24 展示文案不含目标句「瑞雪兆丰年」（2026-09-04 修改意见 6）", () => {
    const display = displayTextOverride("mmse_24");
    expect(display).not.toBeNull();
    expect(display).not.toContain("瑞雪兆丰年");
    expect(display).toContain("完整地重复一遍");
    // 其余题展示与播报同文
    expect(displayTextOverride("mmse_1")).toBeNull();
    expect(displayTextOverride("frail_1")).toBeNull();
  });

  it("两个词复述组：trigger/目标/词数一致，组提问文案不逐词分问", () => {
    expect(WORD_RECALL_GROUPS).toHaveLength(2);
    for (const group of WORD_RECALL_GROUPS) {
      expect(group.targetItemIds.length).toBe(3);
      expect(group.words.length).toBe(3);
      expect(group.targetItemIds[0]).toBe(group.triggerItemId);
      expect(group.promptText).not.toContain("第1个词");
    }
    expect(GROUP_NON_TRIGGER_IDS).toEqual(new Set(["mmse_12", "mmse_13", "mmse_20", "mmse_21"]));
    expect(spokenTextOverride("mmse_19")).toContain("三个词");
    expect(spokenTextOverride("mmse_1")).toBeNull();
  });

  it("极性选项（正确/错误）对每个 free 题与组目标都可解析", () => {
    const ids = [
      ...FREE_ANSWER_ITEMS.keys(),
      ...WORD_RECALL_GROUPS.flatMap((g) => g.targetItemIds),
    ].filter((id) => id !== "minicog_3"); // minicog_3 是词计数（0~3 分四档），不走极性映射
    for (const id of ids) {
      const polar = polarOptionsOf(id);
      expect(polar.correct).not.toBe(polar.incorrect);
    }
  });
});

describe("cognitive-flow：投影与可问性", () => {
  it("free 题与组 trigger 投影出 responseMode=free", () => {
    for (const id of [...FREE_ANSWER_ITEMS.keys(), "mmse_11", "mmse_19"]) {
      expect(questionById.get(id)?.responseMode, id).toBe("free");
    }
    expect(isFreeResponseItem("mmse_24")).toBe(true);
    expect(isFreeResponseItem("mmse_1")).toBe(true);
    expect(isFreeResponseItem("frail_1")).toBe(false);
  });

  it("MMSE 患者端可问清单：trigger 可问、组目标不单独提问、看图识物可问、操作题不问", () => {
    const ids = askableQuestions(["mmse"]).map((item) => item.question.id);
    expect(ids).toContain("mmse_11"); // 立即复述 trigger（虽为记忆指令仍提问）
    expect(ids).toContain("mmse_19"); // 延迟回忆 trigger
    for (const excluded of ["mmse_12", "mmse_13", "mmse_20", "mmse_21"]) {
      expect(ids).not.toContain(excluded);
    }
    // 看图识物（图片识别）改为患者端出题（2026-11-11）
    expect(ids).toContain("mmse_22");
    expect(ids).toContain("mmse_23");
    // 操作指令仍为医生题，患者端不问
    for (const clinical of ["mmse_25", "mmse_28", "mmse_29", "mmse_30"]) {
      expect(ids).not.toContain(clinical);
    }
  });

  it("看图识物：投影为自由回答、非医生题、带屏幕图片，且图片文件存在", () => {
    expect(SCREEN_STIMULI.map((stimulus) => [stimulus.itemId, stimulus.spec.target])).toEqual([
      ["mmse_22", "手表"],
      ["mmse_23", "铅笔"],
    ]);
    for (const stimulus of SCREEN_STIMULI) {
      const question = questionById.get(stimulus.itemId);
      expect(question?.responseMode, stimulus.itemId).toBe("free");
      expect(question?.observerAssisted, stimulus.itemId).toBe(false);
      expect(question?.imageSrc, stimulus.itemId).toBe(stimulus.imageSrc);
      expect(existsSync(path.join(process.cwd(), "public", stimulus.imageSrc)), stimulus.imageSrc).toBe(true);
      // 图片路径与 alt 都不能泄露答案（文件名用英文、不含中文名称）
      expect(stimulus.imageSrc).not.toContain(stimulus.spec.target);
    }
    // 其他图片识别以外的医生题不受影响
    expect(questionById.get("mmse_30")?.observerAssisted).toBe(true);
    expect(questionById.get("mmse_30")?.imageSrc).toBeUndefined();
  });
});
