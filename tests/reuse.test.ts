/**
 * INPUT:  src/lib/assessment/reuse.ts（M9.3/M9.4 跨量表复用回填纯函数）、
 *         src/lib/dialogue/state-machine.ts（回填即跳过验证）、data/scales-v2.json（选项 label 事实来源）
 * OUTPUT: 焦虑两问 ↔ GAD-7 条件复用的规则用例（触发值/量表在会话/目标已答/两对映射独立）+
 *         状态机层"回填后 gad7_1 不再出现在待问步骤"的端到端走查
 * POS:    复用注册表与派生逻辑的回归保险（确定性红线：回填 label 必须精确等于规则数据 0 分档，不硬编码）。
 *         抑郁两问 → GDS-15 未门控（01 表未明说），注册表注释锁定，此处无需用例。
 */
import { describe, expect, it } from "vitest";
import { deriveReuseAnswers, reuseTargetQuestionIds } from "@/lib/assessment/reuse";
import {
  buildTimeline,
  nextStep,
  type AnswerStatus,
  type DialogueSnapshot,
} from "@/lib/dialogue/state-machine";
import { scalesV2 } from "@/lib/rules/v2";

const BOTH_SCALES = ["anxiety_2q", "gad7"] as const;
const NEGATIVE = "否（筛查阴性）";
const POSITIVE = "是（筛查阳性）";

/** 规则数据反查：该条目 0 分档选项的精确 label（测试也不硬编码 label，与实现同一事实来源核对） */
function zeroScoreLabel(questionId: string): string {
  for (const scale of scalesV2) {
    const item = scale.items.find((candidate) => candidate.id === questionId);
    if (item?.options) {
      const zero = item.options.filter((option) => option.score === 0);
      if (zero.length === 1) return zero[0].label;
    }
  }
  throw new Error(`测试数据异常：找不到条目 ${questionId} 的唯一 0 分选项`);
}

function derive(scaleIds: readonly string[], confirmed: Record<string, string>) {
  return deriveReuseAnswers(scaleIds, new Map(Object.entries(confirmed)));
}

describe("deriveReuseAnswers：焦虑两问 ↔ GAD-7 条件复用（01 表复用规则）", () => {
  it("双量表在会话 + anxiety_2q_1 答「否」→ 回填 gad7_1（label 精确等于规则数据 0 分档）", () => {
    const fills = derive(BOTH_SCALES, { anxiety_2q_1: NEGATIVE });
    expect(fills).toHaveLength(1);
    expect(fills[0].questionId).toBe("gad7_1");
    expect(fills[0].score).toBe(0);
    expect(fills[0].optionLabel).toBe(zeroScoreLabel("gad7_1"));
    expect(fills[0].optionLabel).toBe("无（0分）"); // 锁定当前规则数据，数据变更时此处应随之更新
    expect(fills[0].rawText).toContain("复用");
    expect(fills[0].rawText).toContain(NEGATIVE);
  });

  it("anxiety_2q_1 答「是（筛查阳性）」→ 不回填（患者只被追问频率）", () => {
    expect(derive(BOTH_SCALES, { anxiety_2q_1: POSITIVE })).toHaveLength(0);
  });

  it("anxiety_2q 不在会话 → gad7 全部照常提问（不回填）", () => {
    expect(derive(["gad7"], { anxiety_2q_1: NEGATIVE, anxiety_2q_2: NEGATIVE })).toHaveLength(0);
  });

  it("gad7 不在会话 → 无目标可填（不回填）", () => {
    expect(derive(["anxiety_2q"], { anxiety_2q_1: NEGATIVE })).toHaveLength(0);
  });

  it("目标题已有 confirmed 答案 → 不覆盖（人工/既有答案优先）", () => {
    const fills = derive(BOTH_SCALES, { anxiety_2q_1: NEGATIVE, gad7_1: "几乎每天（3分）" });
    expect(fills).toHaveLength(0);
  });

  it("两对映射各自独立：仅 anxiety_2q_2 答「否」→ 只回填 gad7_2", () => {
    const fills = derive(BOTH_SCALES, { anxiety_2q_1: POSITIVE, anxiety_2q_2: NEGATIVE });
    expect(fills).toHaveLength(1);
    expect(fills[0].questionId).toBe("gad7_2");
    expect(fills[0].optionLabel).toBe(zeroScoreLabel("gad7_2"));
  });

  it("两题都答「否」→ gad7_1 与 gad7_2 都回填", () => {
    const fills = derive(BOTH_SCALES, { anxiety_2q_1: NEGATIVE, anxiety_2q_2: NEGATIVE });
    expect(fills.map((fill) => fill.questionId).sort()).toEqual(["gad7_1", "gad7_2"]);
  });
});

describe("deriveReuseAnswers：M10.3b 后扩充规则", () => {
  it("运动初筛阴性 → frail_2 / frail_3 回填否", () => {
    const fills = derive(["motor_screen", "frail"], {
      motor_screen_1: "否（筛查阴性）",
    });
    expect(fills.map((f) => f.questionId).sort()).toEqual(["frail_2", "frail_3"]);
    expect(fills.every((f) => f.optionLabel === "否（0分）")).toBe(true);
  });

  it("跌倒三问过去1年否 → morse_1 无跌倒史", () => {
    const fills = derive(["fall_3q", "morse"], { fall_3q_1: NEGATIVE });
    expect(fills).toHaveLength(1);
    expect(fills[0].questionId).toBe("morse_1");
    expect(fills[0].optionLabel).toBe(zeroScoreLabel("morse_1"));
  });

  it("尿失禁筛查否 → iciq_1 / iciq_2 / iciq_4", () => {
    const fills = derive(["ui_2q", "iciq"], { ui_2q_1: NEGATIVE });
    expect(fills.map((f) => f.questionId).sort()).toEqual(["iciq_1", "iciq_2", "iciq_4"]);
    expect(fills.find((f) => f.questionId === "iciq_4")?.optionLabel).toBe("从不漏尿");
  });

  it("运动初筛阳性 → 不回填 FRAIL 步行题", () => {
    expect(
      derive(["motor_screen", "frail"], {
        motor_screen_1: "是（筛查阳性，进入SPPB评估）",
      })
    ).toHaveLength(0);
  });
});

describe("deriveReuseAnswers：边界", () => {
  it("源题未确认（无答案记录）→ 不回填", () => {
    expect(derive(BOTH_SCALES, {})).toHaveLength(0);
  });

  it("源题答案为其他 label（非触发值）→ 不回填", () => {
    expect(derive(BOTH_SCALES, { anxiety_2q_1: "不确定" })).toHaveLength(0);
  });
});

describe("reuseTargetQuestionIds：落库层撤回范围", () => {
  it("双量表在会话 → 目标题集合为 gad7_1/gad7_2", () => {
    expect([...reuseTargetQuestionIds(BOTH_SCALES)].sort()).toEqual(["gad7_1", "gad7_2"]);
  });

  it("任一量表不在会话 → 无目标题（不撤回任何答案）", () => {
    expect(reuseTargetQuestionIds(["gad7"]).size).toBe(0);
    expect(reuseTargetQuestionIds(["anxiety_2q"]).size).toBe(0);
  });
});

describe("状态机层：回填即跳过（回填后 gad7_1 不再出现在待问步骤）", () => {
  it("anxiety_2q_1 答「否」、anxiety_2q_2 答「是」→ 全程只跳过 gad7_1，gad7_2 照常提问", () => {
    const timeline = buildTimeline(BOTH_SCALES);
    // 模拟写入侧：答案状态 + 已确认 label + 提问/回答计数 + 已播报旁白
    const answerStatus = new Map<string, AnswerStatus>();
    const confirmedLabels = new Map<string, string>();
    const asks = new Map<string, number>();
    const replies = new Map<string, number>();
    const narrations = new Set<string>();
    const snapshot = (): DialogueSnapshot => ({
      answerStatus,
      doctorAskCount: asks,
      patientReplyCount: replies,
      deliveredNarrationIds: narrations,
    });
    /** 与 service 落库语义一致：答案确认后跑 deriveReuseAnswers，回填题标记 confirmed */
    const applyReuse = () => {
      for (const fill of deriveReuseAnswers(BOTH_SCALES, confirmedLabels)) {
        answerStatus.set(fill.questionId, "confirmed");
        confirmedLabels.set(fill.questionId, fill.optionLabel);
      }
    };

    const asked: string[] = [];
    for (let guard = 0; guard < 200; guard++) {
      const step = nextStep(timeline, snapshot());
      if (step.kind === "finished") break;
      if (step.kind === "narration") {
        narrations.add(step.narration.id);
        continue;
      }
      const item = step.kind === "prompt" ? step.prompt.item : step.item;
      const questionId = item.question.id;
      if (step.kind === "prompt") {
        asks.set(questionId, (asks.get(questionId) ?? 0) + 1);
        asked.push(questionId);
        continue;
      }
      // awaiting：患者首答即确认（attempt=1 + matched → confirmed，见 resolveReply）
      replies.set(questionId, (replies.get(questionId) ?? 0) + 1);
      const label =
        questionId === "anxiety_2q_1"
          ? NEGATIVE
          : questionId === "anxiety_2q_2"
            ? POSITIVE
            : item.options[0].label;
      answerStatus.set(questionId, "confirmed");
      confirmedLabels.set(questionId, label);
      applyReuse();
    }

    expect(asked).toContain("anxiety_2q_1");
    expect(asked).toContain("anxiety_2q_2");
    expect(asked).not.toContain("gad7_1"); // 已回填 0 分，不再提问
    expect(asked).toContain("gad7_2"); // 源题答「是」，只追问频率，照常提问
    expect(confirmedLabels.get("gad7_1")).toBe(zeroScoreLabel("gad7_1"));
    // 全部题目有结论（gad7_1 由回填满足），流程能走到 finished 而非卡死
    expect(asked.filter((id) => id.startsWith("gad7")).sort()).toEqual([
      "gad7_2",
      "gad7_3",
      "gad7_4",
      "gad7_5",
      "gad7_6",
      "gad7_7",
    ]);
  });
});
