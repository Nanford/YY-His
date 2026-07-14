/**
 * INPUT:  src/lib/dialogue/state-machine.ts、data/scales.json（经 src/lib/rules）
 * OUTPUT: 追问状态机的单元测试（提问 → 追问 → 待确认 → 轮末复问 → 待人工确认）
 * POS:    验证 AGENTS.md 硬约束 3 的完整流程与题目跳过规则（测量题/观察题不问患者）。
 */
import { describe, expect, it } from "vitest";
import {
  askableQuestions,
  nextStep,
  progressOf,
  resolveReply,
  type AnswerStatus,
  type AskableQuestion,
  type AskAttempt,
  type DialogueSnapshot,
  type DialogueStep,
} from "@/lib/dialogue/state-machine";
import type { NormalizationOutcome } from "@/lib/dialogue/normalize-rules";

const MATCHED_YES: NormalizationOutcome = {
  status: "matched",
  optionLabel: "是",
  score: 1,
  method: "rules",
  confidence: 1,
  reason: "测试",
};
const UNCLEAR: NormalizationOutcome = { status: "unclear", method: "rules", reason: "测试模糊" };

/** 模拟"写入侧"：维护 turns/answers 派生出的三个计数 Map，与服务端落库逻辑一致 */
class SessionSim {
  private answers = new Map<string, AnswerStatus>();
  private asks = new Map<string, number>();
  private replies = new Map<string, number>();

  constructor(private readonly questions: AskableQuestion[]) {}

  snapshot(): DialogueSnapshot {
    return {
      answerStatus: this.answers,
      doctorAskCount: this.asks,
      patientReplyCount: this.replies,
    };
  }

  /** 推进到下一个提问（记录 doctor 轮次），返回该步骤 */
  emitPrompt(): DialogueStep {
    const step = nextStep(this.questions, this.snapshot());
    if (step.kind === "prompt") {
      const id = step.prompt.item.question.id;
      this.asks.set(id, (this.asks.get(id) ?? 0) + 1);
    }
    return step;
  }

  /** 患者作答（记录 patient 轮次），按状态机决定的动作落库 */
  reply(questionId: string, attempt: AskAttempt, outcome: NormalizationOutcome): void {
    this.replies.set(questionId, (this.replies.get(questionId) ?? 0) + 1);
    const resolution = resolveReply(attempt, outcome);
    if (resolution.action === "confirm") this.answers.set(questionId, "confirmed");
    if (resolution.action === "markPending") this.answers.set(questionId, "pending");
    if (resolution.action === "markManual") this.answers.set(questionId, "manual");
    // clarify：不落答案，等待下一次 emitPrompt 发出追问
  }

  status(questionId: string): AnswerStatus | undefined {
    return this.answers.get(questionId);
  }

  progress() {
    return progressOf(this.questions, this.snapshot());
  }
}

describe("askableQuestions：患者端题目清单", () => {
  it("测量题与观察题不向患者提问（走本地换算/医生代填）", () => {
    const ids = askableQuestions(["mnasf", "tcm"]).map((item) => item.question.id);
    // 测量题：mnasf_F(BMI)/mnasf_F_alt(小腿围)/tcm_9(BMI)/tcm_28(腹围)
    // 观察题：mnasf_E(神经心理)/tcm_24/tcm_32/tcm_33(舌象等)
    for (const skipped of ["mnasf_F", "mnasf_F_alt", "tcm_9", "tcm_28", "mnasf_E", "tcm_24", "tcm_32", "tcm_33"]) {
      expect(ids).not.toContain(skipped);
    }
    expect(ids.filter((id) => id.startsWith("mnasf")).length).toBe(4); // A/B/C/D
    expect(ids.filter((id) => id.startsWith("tcm")).length).toBe(28); // 33 - 2测量 - 3观察
  });

  it("保持量表勾选顺序与题目原始顺序", () => {
    const ids = askableQuestions(["fall", "frail"]).map((item) => item.question.id);
    expect(ids).toEqual(["fall_1", "fall_2", "fall_3", "frail_1", "frail_2", "frail_3", "frail_4", "frail_5"]);
  });

  it("未知量表直接报错", () => {
    expect(() => askableQuestions(["unknown"])).toThrow("未知量表");
  });
});

describe("黄金路径：FRAIL+跌倒 演示预设全部答清", () => {
  it("8 题依次首问 → 全部 confirmed → finished", () => {
    const questions = askableQuestions(["frail", "fall"]);
    const sim = new SessionSim(questions);

    for (let i = 0; i < questions.length; i++) {
      const step = sim.emitPrompt();
      expect(step.kind).toBe("prompt");
      if (step.kind !== "prompt") return;
      expect(step.prompt.kind).toBe("ask");
      expect(step.prompt.attempt).toBe(1);
      expect(step.prompt.item.question.id).toBe(questions[i].question.id);
      // 首问使用口语版文案
      expect(step.prompt.text).toBe(questions[i].question.colloquialText);
      sim.reply(step.prompt.item.question.id, step.prompt.attempt, MATCHED_YES);
    }
    expect(sim.emitPrompt().kind).toBe("finished");
    expect(sim.progress()).toEqual({ answered: 8, total: 8 });
  });
});

describe("模糊回答的完整降级链：追问 → 待确认 → 轮末复问 → 待人工确认", () => {
  it("首答模糊 → 追问（作答提示）；追问再模糊 → pending 并继续下一题", () => {
    const questions = askableQuestions(["frail"]);
    const sim = new SessionSim(questions);

    const first = sim.emitPrompt();
    if (first.kind !== "prompt") throw new Error("应发出首问");
    sim.reply("frail_1", 1, UNCLEAR);

    const clarify = sim.emitPrompt();
    if (clarify.kind !== "prompt") throw new Error("应发出追问");
    expect(clarify.prompt.kind).toBe("clarify");
    expect(clarify.prompt.attempt).toBe(2);
    expect(clarify.prompt.text).toContain("不好意思");
    expect(clarify.prompt.text).toContain(questions[0].question.colloquialText);

    sim.reply("frail_1", 2, UNCLEAR);
    expect(sim.status("frail_1")).toBe("pending");

    // 继续问下一题，而不是卡在 frail_1
    const next = sim.emitPrompt();
    if (next.kind !== "prompt") throw new Error("应继续下一题");
    expect(next.prompt.item.question.id).toBe("frail_2");
  });

  it("主轮结束后对 pending 题发轮末复问（预生成换说法 retryText）；仍模糊 → manual", () => {
    const questions = askableQuestions(["frail"]);
    const sim = new SessionSim(questions);

    // frail_1 两次模糊 → pending
    sim.emitPrompt();
    sim.reply("frail_1", 1, UNCLEAR);
    sim.emitPrompt();
    sim.reply("frail_1", 2, UNCLEAR);
    // 其余 4 题一次答清
    for (let i = 0; i < 4; i++) {
      const step = sim.emitPrompt();
      if (step.kind !== "prompt") throw new Error("应发出首问");
      sim.reply(step.prompt.item.question.id, 1, MATCHED_YES);
    }

    const recheck = sim.emitPrompt();
    if (recheck.kind !== "prompt") throw new Error("应发出轮末复问");
    expect(recheck.prompt.kind).toBe("recheck");
    expect(recheck.prompt.attempt).toBe(3);
    expect(recheck.prompt.item.question.id).toBe("frail_1");
    expect(recheck.prompt.text).toContain(questions[0].question.retryText);

    sim.reply("frail_1", 3, UNCLEAR);
    expect(sim.status("frail_1")).toBe("manual"); // 待人工确认，由医生补录
    expect(sim.emitPrompt().kind).toBe("finished");
  });

  it("追问后答清 → confirmed；轮末复问答清 → confirmed", () => {
    const questions = askableQuestions(["fall"]);
    const sim = new SessionSim(questions);

    // fall_1：首答模糊、追问答清
    sim.emitPrompt();
    sim.reply("fall_1", 1, UNCLEAR);
    sim.emitPrompt();
    sim.reply("fall_1", 2, MATCHED_YES);
    expect(sim.status("fall_1")).toBe("confirmed");

    // fall_2：两次模糊 → pending；fall_3 答清
    sim.emitPrompt();
    sim.reply("fall_2", 1, UNCLEAR);
    sim.emitPrompt();
    sim.reply("fall_2", 2, UNCLEAR);
    sim.emitPrompt();
    sim.reply("fall_3", 1, MATCHED_YES);

    // 轮末复问 fall_2 答清 → confirmed
    const recheck = sim.emitPrompt();
    if (recheck.kind !== "prompt") throw new Error("应发出轮末复问");
    expect(recheck.prompt.item.question.id).toBe("fall_2");
    sim.reply("fall_2", 3, MATCHED_YES);
    expect(sim.status("fall_2")).toBe("confirmed");
    expect(sim.emitPrompt().kind).toBe("finished");
  });
});

describe("resolveReply：归一化结果 → 落库动作", () => {
  it("命中选项：任何一次提问都直接 confirm", () => {
    for (const attempt of [1, 2, 3] as const) {
      expect(resolveReply(attempt, MATCHED_YES)).toEqual({
        action: "confirm",
        optionLabel: "是",
        score: 1,
      });
    }
  });

  it("模糊回答按提问次数降级：追问 → 待确认 → 待人工确认", () => {
    expect(resolveReply(1, UNCLEAR)).toEqual({ action: "clarify" });
    expect(resolveReply(2, UNCLEAR)).toEqual({ action: "markPending" });
    expect(resolveReply(3, UNCLEAR)).toEqual({ action: "markManual" });
  });
});

describe("异常防护", () => {
  it("计数与答案记录不一致时报错，不越过医学流程", () => {
    const questions = askableQuestions(["fall"]);
    const snapshot: DialogueSnapshot = {
      answerStatus: new Map(),
      doctorAskCount: new Map([["fall_1", 2]]),
      patientReplyCount: new Map([["fall_1", 2]]),
    };
    expect(() => nextStep(questions, snapshot)).toThrow("会话状态不一致");
  });
});
