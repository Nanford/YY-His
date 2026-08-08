/**
 * 补充评估派生逻辑（V2.0 §3）单元测试：
 * 已完成量表集合 / 本次报告量表的"新增·复评"标识 / 量表是否需医生协助。
 */
import { describe, expect, it } from "vitest";
import {
  completedScaleIds,
  scaleComparisons,
  scaleNeedsClinician,
  scaleScopes,
  type ComparableTag,
  type SessionScaleInfo,
  type SessionSnapshotInfo,
} from "@/lib/assessment/supplementary";
import { scales } from "@/lib/rules";

const t = (iso: string) => new Date(iso);

function session(status: string, scaleIds: string[], startedAt = "2026-07-19T08:00:00Z"): SessionScaleInfo {
  return { status, scaleIds, startedAt: t(startedAt) };
}

/** 构造标签快照元素（score 默认为量表总分语义：同量表标签同分） */
function tag(scaleId: string, code: string, score: number, name = code, level = "是"): ComparableTag {
  return { code, tag: name, level, scaleId, score };
}

function snapshot(
  status: string,
  scaleIds: string[],
  startedAt: string,
  tags: ComparableTag[]
): SessionSnapshotInfo {
  return { status, scaleIds, startedAt: t(startedAt), tags };
}

describe("completedScaleIds", () => {
  it("只统计已出报告的会话（collected / confirmed）", () => {
    const sessions = [
      session("collected", ["frail", "fall_3q"]),
      session("confirmed", ["mnasf"]),
      session("in_progress", ["tcm_constitution"]), // 采集未完成，不算
      session("finalizing", ["tcm_constitution"]), // 评分中临时态，不算
    ];
    expect([...completedScaleIds(sessions)].sort()).toEqual(["fall_3q", "frail", "mnasf"]);
  });

  it("空会话列表 → 空集合", () => {
    expect(completedScaleIds([]).size).toBe(0);
  });
});

describe("scaleScopes", () => {
  it("本次发起前已有完成记录的量表标复评，其余标新增", () => {
    const others = [session("collected", ["frail", "fall_3q"], "2026-07-18T08:00:00Z")];
    const result = scaleScopes(t("2026-07-19T08:00:00Z"), ["frail", "mnasf"], others);
    expect(result).toEqual([
      { scaleId: "frail", scope: "repeat" },
      { scaleId: "mnasf", scope: "new" },
    ]);
  });

  it("晚于本次发起的完成记录不影响本次标识", () => {
    const others = [session("collected", ["frail"], "2026-07-20T08:00:00Z")];
    const result = scaleScopes(t("2026-07-19T08:00:00Z"), ["frail"], others);
    expect(result).toEqual([{ scaleId: "frail", scope: "new" }]);
  });

  it("更早的会话仍在采集中 → 不算复评", () => {
    const others = [session("in_progress", ["frail"], "2026-07-18T08:00:00Z")];
    const result = scaleScopes(t("2026-07-19T08:00:00Z"), ["frail"], others);
    expect(result).toEqual([{ scaleId: "frail", scope: "new" }]);
  });
});

describe("scaleNeedsClinician", () => {
  // V2 口径（以 01 表条目类型为准，src/lib/rules 投影派生）：含 observerAssisted 计分条目
  // （条目类型 ≠ 正式问题：系统读取/逻辑计算/绘图操作等）的量表才需医生协助。
  // 与 V1 口径的差异：frail 新增 frail_4/frail_5（疾病/体重，系统读取）→ true；
  // tcm_constitution 为 false——V2 中医体质 30 题全为患者自答的正式问题（舌象/测量题不再计入
  // 投影的计分题集），不再含观察题，故纯自助可答。
  it("与题库派生口径一致：frail/mnasf/minicog/mmse 需医生协助，其余纯自助", () => {
    expect(scaleNeedsClinician("frail")).toBe(true); // frail_4/frail_5 系统读取
    expect(scaleNeedsClinician("mnasf")).toBe(true); // mnasf_2/3/5/6 系统读取/逻辑计算
    expect(scaleNeedsClinician("minicog")).toBe(false); // M9.6：画钟向患者提问，无 observerAssisted 计分题
    expect(scaleNeedsClinician("mmse")).toBe(true); // 记忆指令/图片识别/操作指令（M10.3a）
    expect(scaleNeedsClinician("fall_3q")).toBe(false);
    expect(scaleNeedsClinician("tcm_constitution")).toBe(false);
    expect(scaleNeedsClinician("adl")).toBe(false);
    expect(scaleNeedsClinician("iadl")).toBe(false);
    expect(scaleNeedsClinician("depression_2q")).toBe(false);
    expect(scaleNeedsClinician("anxiety_2q")).toBe(false);
    expect(scaleNeedsClinician("gds15")).toBe(false); // 15 题全为正式问题
    expect(scaleNeedsClinician("gad7")).toBe(false);
    expect(scaleNeedsClinician("ais")).toBe(false);
  });

  it("未知量表 → false（不阻塞展示）", () => {
    expect(scaleNeedsClinician("no-such-scale")).toBe(false);
  });

  it("覆盖题库全部量表且无遗漏返回", () => {
    for (const scale of scales) {
      expect(typeof scaleNeedsClinician(scale.id)).toBe("boolean");
    }
  });
});

describe("scaleComparisons（随访对比，Demo_v2 步骤 2）", () => {
  it("复评量表：标签新增/消失/保留与总分升降正确派生", () => {
    // 上次 frail：标签 A（保留）+ B（本次消失），总分 2；本次：A + C（新增），总分 3
    const others = [
      snapshot("collected", ["frail"], "2026-07-18T08:00:00Z", [
        tag("frail", "FRAIL_A", 2),
        tag("frail", "FRAIL_B", 2),
      ]),
    ];
    const result = scaleComparisons(
      t("2026-07-19T08:00:00Z"),
      {
        scaleIds: ["frail"],
        tags: [tag("frail", "FRAIL_A", 3), tag("frail", "FRAIL_C", 3)],
      },
      others
    );
    expect(result).toHaveLength(1);
    const comparison = result[0];
    expect(comparison.scaleId).toBe("frail");
    expect(comparison.previousStartedAt).toEqual(t("2026-07-18T08:00:00Z"));
    expect(comparison.previousScore).toBe(2);
    expect(comparison.currentScore).toBe(3); // 2 → 3 升高
    expect(comparison.added.map((c) => c.code)).toEqual(["FRAIL_C"]);
    expect(comparison.removed.map((c) => c.code)).toEqual(["FRAIL_B"]);
    expect(comparison.kept.map((c) => c.code)).toEqual(["FRAIL_A"]);
  });

  it("无历史会话 → 不产对比", () => {
    const result = scaleComparisons(
      t("2026-07-19T08:00:00Z"),
      { scaleIds: ["frail"], tags: [tag("frail", "FRAIL_A", 3)] },
      []
    );
    expect(result).toEqual([]);
  });

  it("非复评量表（本次量表无更早完成记录）→ 不产对比", () => {
    const others = [
      snapshot("collected", ["fall_3q"], "2026-07-18T08:00:00Z", [tag("fall_3q", "FALL_POS", 1)]),
    ];
    const result = scaleComparisons(
      t("2026-07-19T08:00:00Z"),
      { scaleIds: ["frail"], tags: [tag("frail", "FRAIL_A", 3)] },
      others
    );
    expect(result).toEqual([]);
  });

  it("更早但仍在采集中的会话不作为对比基准", () => {
    const others = [
      snapshot("in_progress", ["frail"], "2026-07-18T08:00:00Z", [tag("frail", "FRAIL_A", 2)]),
    ];
    const result = scaleComparisons(
      t("2026-07-19T08:00:00Z"),
      { scaleIds: ["frail"], tags: [tag("frail", "FRAIL_A", 3)] },
      others
    );
    expect(result).toEqual([]);
  });

  it("晚于本次发起的会话不作为对比基准", () => {
    const others = [
      snapshot("collected", ["frail"], "2026-07-20T08:00:00Z", [tag("frail", "FRAIL_A", 2)]),
    ];
    const result = scaleComparisons(
      t("2026-07-19T08:00:00Z"),
      { scaleIds: ["frail"], tags: [tag("frail", "FRAIL_A", 3)] },
      others
    );
    expect(result).toEqual([]);
  });

  it("多次复评取最近一次包含该量表的已出报告会话为基准", () => {
    const others = [
      snapshot("collected", ["frail"], "2026-07-15T08:00:00Z", [tag("frail", "FRAIL_B", 1)]),
      snapshot("confirmed", ["frail"], "2026-07-18T08:00:00Z", [tag("frail", "FRAIL_A", 2)]),
    ];
    const result = scaleComparisons(
      t("2026-07-19T08:00:00Z"),
      { scaleIds: ["frail"], tags: [tag("frail", "FRAIL_A", 3)] },
      others
    );
    expect(result).toHaveLength(1);
    // 基准是 07-18 那次（A 保留），而非 07-15（那样 A 会被误判为新增）
    expect(result[0].previousStartedAt).toEqual(t("2026-07-18T08:00:00Z"));
    expect(result[0].kept.map((c) => c.code)).toEqual(["FRAIL_A"]);
    expect(result[0].added).toEqual([]);
  });

  it("中医体质型多分标签（同量表标签得分不一致）→ 总分为 null，只比标签", () => {
    const others = [
      snapshot("collected", ["tcm_constitution"], "2026-07-18T08:00:00Z", [
        tag("tcm_constitution", "TCM_QIXU", 42.5, "气虚质"),
        tag("tcm_constitution", "TCM_XUEYU", 35.0, "血瘀质"),
      ]),
    ];
    const result = scaleComparisons(
      t("2026-07-19T08:00:00Z"),
      {
        scaleIds: ["tcm_constitution"],
        tags: [tag("tcm_constitution", "TCM_QIXU", 45.0, "气虚质", "倾向是")],
      },
      others
    );
    expect(result).toHaveLength(1);
    expect(result[0].previousScore).toBeNull();
    expect(result[0].currentScore).toBeNull();
    expect(result[0].removed.map((c) => c.code)).toEqual(["TCM_XUEYU"]);
    expect(result[0].kept.map((c) => c.code)).toEqual(["TCM_QIXU"]);
    expect(result[0].kept[0].level).toBe("倾向是"); // 级别取本次快照
  });

  it("两次均零标签的复评量表 → 有对比条目但集合变化为空", () => {
    const others = [snapshot("collected", ["mnasf"], "2026-07-18T08:00:00Z", [])];
    const result = scaleComparisons(
      t("2026-07-19T08:00:00Z"),
      { scaleIds: ["mnasf"], tags: [] },
      others
    );
    expect(result).toHaveLength(1);
    expect(result[0].previousScore).toBeNull();
    expect(result[0].currentScore).toBeNull();
    expect(result[0].added).toEqual([]);
    expect(result[0].removed).toEqual([]);
    expect(result[0].kept).toEqual([]);
  });
});
