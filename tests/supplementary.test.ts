/**
 * 补充评估派生逻辑（V2.0 §3）单元测试：
 * 已完成量表集合 / 本次报告量表的"新增·复评"标识 / 量表是否需医生协助。
 */
import { describe, expect, it } from "vitest";
import {
  completedScaleIds,
  scaleNeedsClinician,
  scaleScopes,
  type SessionScaleInfo,
} from "@/lib/assessment/supplementary";
import { scales } from "@/lib/rules";

const t = (iso: string) => new Date(iso);

function session(status: string, scaleIds: string[], startedAt = "2026-07-19T08:00:00Z"): SessionScaleInfo {
  return { status, scaleIds, startedAt: t(startedAt) };
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
