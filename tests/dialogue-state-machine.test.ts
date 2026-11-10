/**
 * INPUT:  src/lib/dialogue/state-machine.ts、V2 规则数据（经 src/lib/rules 投影）与旁白（narrationsV2）
 * OUTPUT: 采集编排 + 追问状态机的单元测试（旁白时间线 → 提问 → 追问 → 待确认 → 轮末复问 → 待人工确认；
 *         画钟 pending 跳过复问等医生计分；复用回填撤回后按既有计数重新提问）
 * POS:    验证 AGENTS.md 硬约束 3 的完整流程、题目跳过规则
 *         （observerAssisted 计分条目——系统读取/绘图操作等——不问患者），
 *         以及 M9.2 采集编排（来源：V2/Demo_v2更新说明.docx §3）：总开场恒在最前、
 *         分类过渡/工具说明锚定其后量表、只播勾选量表的旁白、播报后不重复。
 *         V2 装机后量表/题目 id 以 01 表为准：frail_4/frail_5（系统读取）、minicog_2（绘图操作）等
 *         不参与患者端问询。
 */
import { describe, expect, it } from "vitest";
import {
  askableQuestions,
  buildTimeline,
  computeLadderSkips,
  nextStep,
  progressOf,
  resolveReply,
  type AnswerStatus,
  type AskableQuestion,
  type AskAttempt,
  type DialogueSnapshot,
  type DialogueStep,
  type TimelineStep,
} from "@/lib/dialogue/state-machine";
import type { NormalizationOutcome } from "@/lib/dialogue/normalize-rules";
import { shortScaleName } from "@/lib/rules";

const MATCHED_YES: NormalizationOutcome = {
  status: "matched",
  optionLabel: "是",
  score: 1,
  method: "rules",
  confidence: 1,
  reason: "测试",
};
const UNCLEAR: NormalizationOutcome = { status: "unclear", method: "rules", reason: "测试模糊" };

/** 纯题目时间线（无旁白）：既有追问语义用例只关心题目步骤 */
function asTimeline(questions: readonly AskableQuestion[]): TimelineStep[] {
  return questions.map((item) => ({ kind: "question", item }));
}

/** 模拟"写入侧"：维护 turns/answers 派生出的计数 Map/集合，与服务端落库逻辑一致 */
class SessionSim {
  private answers = new Map<string, AnswerStatus>();
  private asks = new Map<string, number>();
  private replies = new Map<string, number>();
  private narrations = new Set<string>();

  constructor(private readonly timeline: TimelineStep[]) {}

  static fromQuestions(questions: AskableQuestion[]): SessionSim {
    return new SessionSim(asTimeline(questions));
  }

  snapshot(): DialogueSnapshot {
    return {
      answerStatus: this.answers,
      doctorAskCount: this.asks,
      patientReplyCount: this.replies,
      deliveredNarrationIds: this.narrations,
    };
  }

  /** 推进到下一步：prompt 记 doctor 轮次、narration 记 system 轮次（播报即完成），返回该步骤 */
  emitPrompt(): DialogueStep {
    const step = nextStep(this.timeline, this.snapshot());
    if (step.kind === "prompt") {
      const id = step.prompt.item.question.id;
      this.asks.set(id, (this.asks.get(id) ?? 0) + 1);
    }
    if (step.kind === "narration") {
      this.narrations.add(step.narration.id);
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

  /** 画钟交卷（M9.6）：service 层不走 resolveReply，首答直接落 pending 等医生计分 */
  submitDrawing(questionId: string): void {
    this.replies.set(questionId, (this.replies.get(questionId) ?? 0) + 1);
    this.answers.set(questionId, "pending");
  }

  /**
   * 复用回填撤回（M9.3/M9.4）：医生改答源题使复用条件不再成立，
   * 旧回填答案置 superseded——service loadContext 对 superseded 不计入快照，
   * 故表现为"删除答案记录、提问/回答计数残留"
   */
  retract(questionId: string): void {
    this.answers.delete(questionId);
  }

  status(questionId: string): AnswerStatus | undefined {
    return this.answers.get(questionId);
  }

  progress() {
    const questions = this.timeline
      .filter((step): step is Extract<TimelineStep, { kind: "question" }> => step.kind === "question")
      .map((step) => step.item);
    return progressOf(questions, this.snapshot());
  }
}

describe("askableQuestions：患者端题目清单", () => {
  it("observerAssisted 计分条目（系统读取/绘图操作等）不向患者提问（走系统读取/医生代填）", () => {
    const ids = askableQuestions(["frail", "mnasf", "minicog"]).map((item) => item.question.id);
    // V2 条目类型 ≠ 正式问题的计分条目：frail_4/frail_5（系统读取）、
    // mnasf_2/3/5/6（系统读取/逻辑计算等）不问；M9.6：minicog_2 画钟向患者提问
    for (const skipped of ["frail_4", "frail_5", "mnasf_2", "mnasf_3", "mnasf_5", "mnasf_6"]) {
      expect(ids).not.toContain(skipped);
    }
    expect(ids).toContain("minicog_2");
    expect(ids.filter((id) => id.startsWith("frail")).length).toBe(3); // frail_1-3
    expect(ids.filter((id) => id.startsWith("mnasf")).length).toBe(2); // mnasf_1、mnasf_4
    expect(ids.filter((id) => id.startsWith("minicog")).length).toBe(2); // minicog_2 画钟 + minicog_3 回忆 // minicog_3
  });

  it("保持量表勾选顺序与题目原始顺序", () => {
    const ids = askableQuestions(["fall_3q", "frail"]).map((item) => item.question.id);
    expect(ids).toEqual(["fall_3q_1", "fall_3q_2", "fall_3q_3", "frail_1", "frail_2", "frail_3"]);
  });

  it("非计分开放题使用自由文本，明确不重复提问的复用行不进入患者时间线", () => {
    const constipation = askableQuestions(["constipation_symptom"]);
    expect(constipation.find((item) => item.question.id === "constipation_symptom_1")?.question).toMatchObject({
      patientResponseMode: "free_text",
      judgmentMode: "not_scored",
    });

    const tcmTimeline = buildTimeline(["tcm_constitution"]);
    const timelineIds = tcmTimeline
      .filter((step) => step.kind === "question" || step.kind === "instruction")
      .map((step) => step.item.question.id);
    expect(timelineIds).not.toContain("tcm_constitution_A.2-1");
    expect(timelineIds).not.toContain("tcm_constitution_A.3-3");
    expect(timelineIds).not.toContain("tcm_constitution_A.8-1");
  });

  it("未知量表直接报错", () => {
    expect(() => askableQuestions(["unknown"])).toThrow("未知量表");
  });
});

describe("黄金路径：FRAIL+跌倒三问 演示预设全部答清", () => {
  it("6 题依次首问 → 全部 confirmed → finished", () => {
    const questions = askableQuestions(["frail", "fall_3q"]);
    expect(questions.length).toBe(6); // frail_1-3（frail_4/5 系统读取不问）+ fall_3q_1-3
    const sim = SessionSim.fromQuestions(questions);

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
    expect(sim.progress()).toEqual({ answered: 6, total: 6 });
  });
});

describe("模糊回答的完整降级链：追问 → 待确认 → 轮末复问 → 待人工确认", () => {
  it("首答模糊 → 追问（作答提示）；追问再模糊 → pending 并继续下一题", () => {
    const questions = askableQuestions(["frail"]);
    const sim = SessionSim.fromQuestions(questions);

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
    const sim = SessionSim.fromQuestions(questions);

    // frail_1 两次模糊 → pending
    sim.emitPrompt();
    sim.reply("frail_1", 1, UNCLEAR);
    sim.emitPrompt();
    sim.reply("frail_1", 2, UNCLEAR);
    // 其余 2 题（frail_2/frail_3）一次答清
    for (let i = 0; i < 2; i++) {
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
    const questions = askableQuestions(["fall_3q"]);
    const sim = SessionSim.fromQuestions(questions);

    // fall_3q_1：首答模糊、追问答清
    sim.emitPrompt();
    sim.reply("fall_3q_1", 1, UNCLEAR);
    sim.emitPrompt();
    sim.reply("fall_3q_1", 2, MATCHED_YES);
    expect(sim.status("fall_3q_1")).toBe("confirmed");

    // fall_3q_2：两次模糊 → pending；fall_3q_3 答清
    sim.emitPrompt();
    sim.reply("fall_3q_2", 1, UNCLEAR);
    sim.emitPrompt();
    sim.reply("fall_3q_2", 2, UNCLEAR);
    sim.emitPrompt();
    sim.reply("fall_3q_3", 1, MATCHED_YES);

    // 轮末复问 fall_3q_2 答清 → confirmed
    const recheck = sim.emitPrompt();
    if (recheck.kind !== "prompt") throw new Error("应发出轮末复问");
    expect(recheck.prompt.item.question.id).toBe("fall_3q_2");
    sim.reply("fall_3q_2", 3, MATCHED_YES);
    expect(sim.status("fall_3q_2")).toBe("confirmed");
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
  it("回答次数多于提问次数（写入侧不变量被破坏）时报错，不越过医学流程", () => {
    const questions = askableQuestions(["fall_3q"]);
    const snapshot: DialogueSnapshot = {
      answerStatus: new Map(),
      doctorAskCount: new Map([["fall_3q_1", 1]]),
      patientReplyCount: new Map([["fall_3q_1", 2]]),
      deliveredNarrationIds: new Set(),
    };
    expect(() => nextStep(asTimeline(questions), snapshot)).toThrow("会话状态不一致");
  });

  it("pending 题计数形态不可能（复问未发出却只答 1 次）时报错", () => {
    const questions = askableQuestions(["fall_3q"]);
    // fall_3q 全部落答案，fall_3q_1 为 pending 但计数 (2,1)：复问轮不认此形态
    const snapshot: DialogueSnapshot = {
      answerStatus: new Map<string, AnswerStatus>([
        ["fall_3q_1", "pending"],
        ["fall_3q_2", "confirmed"],
        ["fall_3q_3", "confirmed"],
      ]),
      doctorAskCount: new Map([["fall_3q_1", 2]]),
      patientReplyCount: new Map([["fall_3q_1", 1]]),
      deliveredNarrationIds: new Set(),
    };
    expect(() => nextStep(asTimeline(questions), snapshot)).toThrow("会话状态不一致");
  });
});

describe("A1 画钟题：交卷落 pending 后跳过轮末复问（M9.6 等医生 CollectForm 计分）", () => {
  it("画钟 pending（asks=1/replies=1）不再抛错，会话正常走到 finished", () => {
    const questions = askableQuestions(["minicog"]); // minicog_2 画钟 + minicog_3 回忆
    expect(questions[0].question.id).toBe("minicog_2");
    expect(questions[0].question.answerType).toBe("drawing");
    const sim = SessionSim.fromQuestions(questions);

    // 首问画钟 → 患者交卷：service 层直接落 pending（不走追问）
    const first = sim.emitPrompt();
    if (first.kind !== "prompt") throw new Error("应发出画钟首问");
    expect(first.prompt.attempt).toBe(1);
    sim.submitDrawing("minicog_2");
    expect(sim.status("minicog_2")).toBe("pending");

    // 主轮继续下一题，不因 asks=1 的 pending 抛「会话状态不一致」
    const second = sim.emitPrompt();
    if (second.kind !== "prompt") throw new Error("应继续下一题");
    expect(second.prompt.item.question.id).toBe("minicog_3");
    sim.reply("minicog_3", 1, MATCHED_YES);

    // 复问轮跳过画钟 pending（只等医生计分，无需复问）→ finished
    expect(sim.emitPrompt().kind).toBe("finished");
    expect(sim.progress()).toEqual({ answered: 2, total: 2 });
  });

  it("医护判定题记录患者响应后不进入无意义的轮末复问", () => {
    const item = askableQuestions(["mmse"]).find((candidate) => candidate.question.id === "mmse_25");
    if (!item) throw new Error("缺少 MMSE 操作指令");
    expect(item.question.judgmentMode).toBe("clinician");
    const sim = SessionSim.fromQuestions([item]);
    const first = sim.emitPrompt();
    if (first.kind !== "prompt") throw new Error("应发出医护判定题首问");
    sim.submitDrawing(item.question.id); // 模拟 service 将患者原话落为 pending
    expect(sim.emitPrompt()).toEqual({ kind: "finished" });
  });
});

describe("A2 复用回填撤回：有提问/回答计数但无有效答案 → 按既有计数重新提问", () => {
  it("gad7_1 撤回后（asks=2/replies=2 无答案记录）重新首问，计数奇偶推导 attempt，走完完整降级链", () => {
    const questions = askableQuestions(["gad7"]);
    const sim = SessionSim.fromQuestions(questions);

    // gad7_1 两次模糊 → pending（asks=2/replies=2）
    sim.emitPrompt();
    sim.reply("gad7_1", 1, UNCLEAR);
    sim.emitPrompt();
    sim.reply("gad7_1", 2, UNCLEAR);
    expect(sim.status("gad7_1")).toBe("pending");

    // 医生改 anxiety_2q_1 触发复用回填覆盖 gad7_1，又改回 → 回填撤回置 superseded
    // （快照中不计入 superseded → 该题无有效答案但计数残留）
    sim.retract("gad7_1");

    // 主轮重新提问：按既有计数发起新一轮首问（attempt 1，口语版文案），不抛错
    const reask = sim.emitPrompt();
    if (reask.kind !== "prompt") throw new Error("应重新提问 gad7_1");
    expect(reask.prompt.item.question.id).toBe("gad7_1");
    expect(reask.prompt.kind).toBe("ask");
    expect(reask.prompt.attempt).toBe(1);
    expect(reask.prompt.text).toBe(questions[0].question.colloquialText);

    // 提问已发出等待作答：asks=3/replies=2 → awaiting attempt 1（GET /state 重建路径）
    const awaiting = nextStep(asTimeline(questions), sim.snapshot());
    expect(awaiting).toMatchObject({ kind: "awaiting", attempt: 1, phase: "main" });

    // 重新作答仍两次模糊 → 追问（asks=4）→ 再次 pending（asks=4/replies=4）
    sim.reply("gad7_1", 1, UNCLEAR);
    const clarify = sim.emitPrompt();
    if (clarify.kind !== "prompt") throw new Error("应发出追问");
    expect(clarify.prompt.kind).toBe("clarify");
    expect(clarify.prompt.attempt).toBe(2);
    sim.reply("gad7_1", 2, UNCLEAR);
    expect(sim.status("gad7_1")).toBe("pending");

    // 其余 6 题一次答清
    for (let i = 1; i < questions.length; i++) {
      const step = sim.emitPrompt();
      if (step.kind !== "prompt") throw new Error("应发出首问");
      expect(step.prompt.item.question.id).toBe(questions[i].question.id);
      sim.reply(step.prompt.item.question.id, 1, MATCHED_YES);
    }

    // 复问轮对 asks=4 的 pending 仍发轮末复问；答清 → confirmed → finished
    const recheck = sim.emitPrompt();
    if (recheck.kind !== "prompt") throw new Error("应发出轮末复问");
    expect(recheck.prompt.kind).toBe("recheck");
    expect(recheck.prompt.attempt).toBe(3);
    expect(recheck.prompt.item.question.id).toBe("gad7_1");
    const recheckAwaiting = nextStep(asTimeline(questions), sim.snapshot());
    expect(recheckAwaiting).toMatchObject({ kind: "awaiting", attempt: 3, phase: "recheck" });
    sim.reply("gad7_1", 3, MATCHED_YES);
    expect(sim.status("gad7_1")).toBe("confirmed");
    expect(sim.emitPrompt().kind).toBe("finished");
  });

  it("撤回后重新提问一次答清 → confirmed，流程直接推进", () => {
    const questions = askableQuestions(["gad7"]);
    const sim = SessionSim.fromQuestions(questions);
    sim.emitPrompt();
    sim.reply("gad7_1", 1, UNCLEAR);
    sim.emitPrompt();
    sim.reply("gad7_1", 2, UNCLEAR);
    sim.retract("gad7_1");

    const reask = sim.emitPrompt();
    if (reask.kind !== "prompt") throw new Error("应重新提问 gad7_1");
    sim.reply("gad7_1", reask.prompt.attempt, MATCHED_YES);
    expect(sim.status("gad7_1")).toBe("confirmed");

    // 继续问 gad7_2，不回头不抛错
    const next = sim.emitPrompt();
    if (next.kind !== "prompt") throw new Error("应继续下一题");
    expect(next.prompt.item.question.id).toBe("gad7_2");
  });
});

describe("buildTimeline：采集编排时间线（M9.2，来源：V2/Demo_v2更新说明.docx §3 + 01 表行序）", () => {
  it("总开场恒在最前；分类过渡/工具说明插在锚定量表首题之前，按 01 表行号排序", () => {
    // minicog 前原锚定两条旁白：narr_50（分类过渡，行 50）+ narr_51（工具说明，行 51）；
    // 2026-09-13 用户拍板：三条开场白（含总开场 narr_3）只保留 narr_50，narr_3/narr_51 编排层删除
    const timeline = buildTimeline(["minicog"]);
    expect(timeline[0]).toMatchObject({ kind: "narration", narration: { id: "narr_50", entryType: "分类过渡" } });
    // 认知题改版（2026-08-13）：画钟前插入三词指令播报（虚拟旁白 instr_minicog_words，文本取 minicog_1）
    expect(timeline[1]).toMatchObject({
      kind: "narration",
      narration: { id: "instr_minicog_words", entryType: "记忆指令" },
    });
    // 2026-09-04 修改意见 3：指令播报的展示文案（不含记忆词）与放慢语速随时间线透传到 DTO
    if (timeline[1].kind !== "narration") throw new Error("timeline[1] 应为旁白");
    expect(timeline[1].narration.displayText).toBeTruthy();
    expect(timeline[1].narration.displayText).not.toContain("苹果");
    expect(timeline[1].narration.speechRate).toBeLessThan(0);
    // 指令播报之后是该量表首题（M9.6：minicog_2 画钟向患者提问）
    expect(timeline[2]).toMatchObject({ kind: "question", item: { question: { id: "minicog_2" } } });
  });

  it("记词指令（minicog_1）计入题号进度：画钟=第 2 题、复述=第 3 题（2026-09-12 用户口径）", () => {
    const timeline = buildTimeline(["minicog"]);
    const questions = askableQuestions(["minicog"]);
    const empty: DialogueSnapshot = {
      answerStatus: new Map(),
      doctorAskCount: new Map(),
      patientReplyCount: new Map(),
      deliveredNarrationIds: new Set(),
    };
    // 指令未播报：total=3（指令+画钟+复述），画钟页显示"第 answered+1 / total 题"= 第 2 / 3 题
    expect(progressOf(questions, empty, timeline)).toEqual({ answered: 0, total: 3 });
    // 指令播完（system 轮次落库）+ 画钟交卷 pending：复述页显示第 3 / 3 题
    const afterDrawing: DialogueSnapshot = {
      ...empty,
      answerStatus: new Map([["minicog_2", "pending"]]),
      deliveredNarrationIds: new Set(["narr_50", "instr_minicog_words"]),
    };
    expect(progressOf(questions, afterDrawing, timeline)).toEqual({ answered: 2, total: 3 });
    // 不传 timeline 时维持原口径（只计可问题目）
    expect(progressOf(questions, empty)).toEqual({ answered: 0, total: 2 });
  });

  it("只纳入勾选量表锚定的旁白，未勾选量表的旁白不播", () => {
    const timeline = buildTimeline(["frail", "fall_3q"]);
    const narrationIds = timeline
      .filter((step): step is Extract<TimelineStep, { kind: "narration" }> => step.kind === "narration")
      .map((step) => step.narration.id);
    // 总开场 narr_3 已删除（2026-09-13）；锚定 fall_3q 的分类过渡 narr_136（行 136，其后第一个量表为 fall_3q）保留；
    // 其余旁白锚定 sppb/vision/minicog/mmse/tcm_constitution 等未勾选量表，一律不播；
    // frail 无锚定旁白 → 注入虚拟过渡 scale_intro_frail（2026-09-13 起不再念量表名，
    // 用专题过渡句点出内容）；fall_3q 有锚定旁白 narr_136 → 直接播旁白本身（id 不变）
    expect(narrationIds).toEqual(["scale_intro_frail", "narr_136"]);
    const introFrail = timeline.find(
      (step): step is Extract<TimelineStep, { kind: "narration" }> =>
        step.kind === "narration" && step.narration.id === "scale_intro_frail"
    );
    expect(introFrail?.narration.text).toBe("下面问问您最近的活动情况。");
    const narr136 = timeline.find(
      (step): step is Extract<TimelineStep, { kind: "narration" }> =>
        step.kind === "narration" && step.narration.id === "narr_136"
    );
    // 过渡句不含量表名/书名号
    expect(narr136?.narration.text).toBe("下面问几个老年人常见的健康问题。");
    // narr_136 插在 fall_3q 首题之前、frail 题目之后（遵循量表勾选顺序）
    expect(timeline.map((step) => (step.kind === "narration" ? step.narration.id : step.item.question.id))).toEqual([
      "scale_intro_frail",
      "frail_1",
      "frail_2",
      "frail_3",
      "narr_136",
      "fall_3q_1",
      "fall_3q_2",
      "fall_3q_3",
    ]);
  });

  it("正文为空的旁白行（01 表 112 行）不进时间线", () => {
    // 投影层 9 个可评分量表全选（M10.3b 后共 25 个，本用例沿用原 9 个勾选范围）：纳入时间线的旁白都必须有可播报正文
    const timeline = buildTimeline([
      "adl",
      "iadl",
      "minicog",
      "depression_2q",
      "anxiety_2q",
      "fall_3q",
      "frail",
      "mnasf",
      "tcm_constitution",
    ]);
    const narrationIds: string[] = [];
    for (const step of timeline) {
      if (step.kind !== "narration") continue;
      expect(step.narration.text.trim()).not.toBe("");
      narrationIds.push(step.narration.id);
    }
    // narr_112（空文本分类过渡）锚定 lubben（本用例未勾选），即便锚定命中也因空文本被跳过
    expect(narrationIds).not.toContain("narr_112");
  });
});

describe("nextStep：旁白步骤消费", () => {  it("未播报旁白 → narration 步骤；播报（写 system 轮次）后不再重复返回", () => {
    const sim = new SessionSim(buildTimeline(["fall_3q"]));
    // 总开场 narr_3 已删除（2026-09-13）：fall_3q 时间线首条即锚定的分类过渡 narr_136
    const first = sim.emitPrompt();
    expect(first).toMatchObject({ kind: "narration", narration: { id: "narr_136" } });
    // 已播报 → 不再返回 narr_136，旁白全部播完，发出第一题首问
    const second = sim.emitPrompt();
    expect(second.kind).toBe("prompt");
    if (second.kind === "prompt") expect(second.prompt.item.question.id).toBe("fall_3q_1");
  });

  it("旁白不需要作答：全部旁白播完且题目答完才 finished；只播旁白不够", () => {
    const sim = new SessionSim(buildTimeline(["fall_3q"]));
    sim.emitPrompt(); // narr_136
    // 旁白全播完但题目未答 → 不是 finished，而是首题 prompt
    expect(sim.emitPrompt().kind).toBe("prompt");
    // 播完旁白后正常答完全部 3 题 → finished（旁白全程无需回答也能走到终点）
    for (const questionId of ["fall_3q_1", "fall_3q_2", "fall_3q_3"]) {
      sim.reply(questionId, 1, MATCHED_YES);
      sim.emitPrompt();
    }
    // 最后一次 emitPrompt 已在答完 fall_3q_3 后消费；再确认一次终态幂等
    expect(sim.emitPrompt().kind).toBe("finished");
  });
});

describe("阶梯跳题（2026-08-13：视力/听力「可以（结束）」）", () => {
  it("题干中的流程注解（可以（结束）、不可以（2）等）不向患者展示/播报", () => {
    // 来源：01 表跳题标注只给流程用；清理在 rules/index.ts stripBranchAnnotations
    for (const item of askableQuestions(["vision", "hearing"])) {
      expect(item.question.colloquialText).not.toMatch(/可以（结束）/);
      expect(item.question.colloquialText).not.toMatch(/不可以（/);
    }
    // 清理后题干仍完整（vision_2 保留 1-1/1-2 两个分支问句）
    const vision2 = askableQuestions(["vision"]).find((i) => i.question.id === "vision_2");
    expect(vision2?.question.colloquialText).toContain("报纸或者书上的字");
  });

  it("computeLadderSkips：命中有分选项 → 后续阶梯题全跳过；命中无分「不可以」→ 不跳", () => {
    const yesVision = computeLadderSkips(
      ["vision"],
      new Map([["vision_2", "可以看清标准字体（4分，结束视力评估）"]])
    );
    expect([...yesVision].sort()).toEqual(["vision_3", "vision_4", "vision_5"]);

    const noVision = computeLadderSkips(["vision"], new Map([["vision_2", "不可以（进入下一题）"]]));
    expect(noVision.size).toBe(0);

    // 多级已答：第二级答「可以」→ 只跳其后
    const midHearing = computeLadderSkips(
      ["hearing"],
      new Map([
        ["hearing_2", "不可以（进入下一题）"],
        ["hearing_3", "可以听清（3分，结束听力评估）"],
      ])
    );
    expect([...midHearing].sort()).toEqual(["hearing_4", "hearing_5"]);

    // 未勾选量表不计算
    expect(computeLadderSkips(["frail"], new Map([["vision_2", "可以看清标准字体（4分，结束视力评估）"]])).size).toBe(0);
  });

  it("答「可以」后 nextStep 不再问后续阶梯题，直接结束量表；答「不可以」继续下一题", () => {
    const timeline = buildTimeline(["vision"]);
    const sim = new SessionSim(timeline);
    // 播完旁白后到 vision_2 首问
    let step = sim.emitPrompt();
    while (step.kind === "narration") step = sim.emitPrompt();
    expect(step).toMatchObject({ kind: "prompt", prompt: { item: { question: { id: "vision_2" } } } });

    // 答「可以（4分，结束）」→ 带跳题集合的快照直接 finished
    sim.reply("vision_2", 1, {
      status: "matched",
      optionLabel: "可以看清标准字体（4分，结束视力评估）",
      score: 4,
      method: "rules",
      confidence: 1,
      reason: "测试",
    });
    const skipped = computeLadderSkips(["vision"], new Map([["vision_2", "可以看清标准字体（4分，结束视力评估）"]]));
    const snapshot: DialogueSnapshot = { ...sim.snapshot(), skippedQuestionIds: skipped };
    expect(nextStep(timeline, snapshot).kind).toBe("finished");
    // 进度把跳过题计入 answered，不回退
    expect(progressOf(askableQuestions(["vision"]), snapshot)).toEqual({ answered: 4, total: 4 });
  });

  it("答「不可以」继续下一级阶梯题", () => {
    const timeline = buildTimeline(["vision"]);
    const sim = new SessionSim(timeline);
    let step = sim.emitPrompt();
    while (step.kind === "narration") step = sim.emitPrompt();
    sim.reply("vision_2", 1, {
      status: "matched",
      optionLabel: "不可以（进入下一题）",
      score: 0,
      method: "rules",
      confidence: 1,
      reason: "测试",
    });
    const skipped = computeLadderSkips(["vision"], new Map([["vision_2", "不可以（进入下一题）"]]));
    const snapshot: DialogueSnapshot = { ...sim.snapshot(), skippedQuestionIds: skipped };
    const next = nextStep(timeline, snapshot);
    expect(next).toMatchObject({ kind: "prompt", prompt: { item: { question: { id: "vision_3" } } } });
  });
});

describe("认知题时间线（2026-08-13：MMSE 三词播报与组提问）", () => {
  it("MMSE：三词播报插在 mmse_11 前；组目标题不在时间线；trigger 用组提问文案", () => {
    const timeline = buildTimeline(["mmse"]);
    const seq = timeline.map((step) => (step.kind === "narration" ? step.narration.id : step.item.question.id));
    // 组目标不单独提问
    for (const excluded of ["mmse_12", "mmse_13", "mmse_20", "mmse_21"]) {
      expect(seq).not.toContain(excluded);
    }
    // 指令播报紧跟在 mmse_11（立即复述 trigger）之前、mmse_10 之后
    const instructionIndex = seq.indexOf("instr_mmse_words");
    expect(instructionIndex).toBeGreaterThan(-1);
    expect(seq[instructionIndex - 1]).toBe("mmse_10");
    expect(seq[instructionIndex + 1]).toBe("mmse_11");
    // 立即复述 trigger 首问文案是组提问文案（不逐词分问）
    const sim = new SessionSim(timeline);
    let step = sim.emitPrompt();
    while (step.kind === "narration" || (step.kind === "prompt" && step.prompt.item.question.id !== "mmse_11")) {
      if (step.kind === "prompt") sim.reply(step.prompt.item.question.id, 1, MATCHED_YES);
      step = sim.emitPrompt();
    }
    if (step.kind !== "prompt") throw new Error("应推进到 mmse_11");
    expect(step.prompt.text).toContain("三个词");
    expect(step.prompt.text).not.toContain("第一个词是");
  });
});

describe("量表切换过渡（2026-09-13：不再念量表名，用日常过渡句）", () => {
  it("shortScaleName：去「简易/简版」，书面后缀归一", () => {
    expect(shortScaleName("听力简易评估表")).toBe("听力评估");
    expect(shortScaleName("视力简易评估表")).toBe("视力评估");
    expect(shortScaleName("FRAIL量表")).toBe("FRAIL");
    expect(shortScaleName("微型营养评定简表（MNA-SF）")).toBe("微型营养评定（MNA-SF）");
    expect(shortScaleName("耳语试验")).toBe("耳语试验");
    expect(shortScaleName("中医体质辨识")).toBe("中医体质辨识");
  });

  it("shortScaleName：认知类量表患者端不出现「智力」措辞（2026-09-04 修改意见 2/5）", () => {
    // 修改意见 2：「简易智力评估量表」（minicog）→ 认知功能筛查
    expect(shortScaleName("简易智力评估量表")).toBe("认知功能筛查");
    // 修改意见 5：「简易智力状态检查量表（MMSE）」→ 详细的认知功能评价
    expect(shortScaleName("简易智力状态检查量表（MMSE）")).toBe("详细的认知功能评价");
  });

  it("有锚定旁白的量表直接播旁白本身，不再拼量表名（视力/听力）", () => {
    const timeline = buildTimeline(["vision", "hearing"]);
    const texts = timeline
      .filter((step): step is Extract<TimelineStep, { kind: "narration" }> => step.kind === "narration")
      .map((step) => step.narration.text);
    // narr_30/narr_39 锚定 vision/hearing，播报其简化覆盖文案
    expect(texts).toContain("下面问看东西的情况。戴眼镜就按戴镜时回答。");
    expect(texts).toContain("下面问听声音的情况。戴助听器就按戴时回答。");
    // 任何过渡句都不出现量表名/书名号/书面后缀
    expect(texts.some((t) => t.includes("「"))).toBe(false);
    expect(texts.some((t) => t.includes("简易评估表"))).toBe(false);
  });

  it("无锚定旁白的量表用专题过渡句（mnasf → 营养情况、frail → 活动情况）", () => {
    const timeline = buildTimeline(["mnasf", "frail"]);
    const introMnasf = timeline.find(
      (step): step is Extract<TimelineStep, { kind: "narration" }> =>
        step.kind === "narration" && step.narration.id === "scale_intro_mnasf"
    );
    expect(introMnasf?.narration.text).toBe("下面问问您的营养情况。");
    const introFrail = timeline.find(
      (step): step is Extract<TimelineStep, { kind: "narration" }> =>
        step.kind === "narration" && step.narration.id === "scale_intro_frail"
    );
    expect(introFrail?.narration.text).toBe("下面问问您最近的活动情况。");
  });

  it("患者端无题可问的量表（纯测量/医护观察）不播过渡句和旁白", () => {
    // grip/gait_speed 全为测量题、braden 全为医护评估题：患者端不问，也就不该有"下面要……"的空预告
    const timeline = buildTimeline(["grip", "gait_speed", "braden", "frail"]);
    const narrations = timeline.filter(
      (step): step is Extract<TimelineStep, { kind: "narration" }> => step.kind === "narration"
    );
    // 总开场 narr_3 已删除（2026-09-13）：只剩 frail 的虚拟过渡句
    expect(narrations.map((step) => step.narration.id)).toEqual(["scale_intro_frail"]);
  });

  it("过渡句语境省略（2026-09-14 门诊简版啰嗦过渡句）：重复/没头没尾的整条不播", () => {
    const narrationIdsOf = (scaleIds: string[]) =>
      buildTimeline(scaleIds)
        .filter((step): step is Extract<TimelineStep, { kind: "narration" }> => step.kind === "narration")
        .map((step) => step.narration.id);
    // 门诊简版包：depression_2q 的"问问心情"与 minicog 锚定旁白 narr_50"记忆和心情"重复 → 省略；
    // ais 的"再细问睡觉"以 sleep_1q 为前题，本包没有 → 省略；
    // anxiety_2q 开场白已整条删除（2026-09-15 修改.docx ③，SCALE_TRANSITION_SUPPRESSED_IDS）；其余过渡句保留
    const outpatient = narrationIdsOf(["frail", "mnasf", "fall_3q", "minicog", "depression_2q", "anxiety_2q", "ais"]);
    expect(outpatient).not.toContain("scale_intro_depression_2q");
    expect(outpatient).not.toContain("scale_intro_ais");
    expect(outpatient).toContain("scale_intro_frail");
    expect(outpatient).not.toContain("scale_intro_anxiety_2q");
    // 睡眠疼痛包：sleep_1q 在会话 → ais"再细问"有前题，保留；无 minicog → depression_2q 不重复，保留
    const sleepPain = narrationIdsOf(["sleep_1q", "ais", "pain_1q", "pain_nrs", "pain_behavior", "depression_2q"]);
    expect(sleepPain).toContain("scale_intro_ais");
    expect(sleepPain).toContain("scale_intro_depression_2q");
  });
});
