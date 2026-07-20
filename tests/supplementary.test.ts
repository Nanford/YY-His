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
      session("collected", ["frail", "fall"]),
      session("confirmed", ["mnasf"]),
      session("in_progress", ["tcm"]), // 采集未完成，不算
      session("finalizing", ["tcm"]), // 评分中临时态，不算
    ];
    expect([...completedScaleIds(sessions)].sort()).toEqual(["fall", "frail", "mnasf"]);
  });

  it("空会话列表 → 空集合", () => {
    expect(completedScaleIds([]).size).toBe(0);
  });
});

describe("scaleScopes", () => {
  it("本次发起前已有完成记录的量表标复评，其余标新增", () => {
    const others = [session("collected", ["frail", "fall"], "2026-07-18T08:00:00Z")];
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
  it("与题库派生口径一致：FRAIL/跌倒纯自助，MNA-SF/中医体质需医生协助", () => {
    expect(scaleNeedsClinician("frail")).toBe(false);
    expect(scaleNeedsClinician("fall")).toBe(false);
    expect(scaleNeedsClinician("mnasf")).toBe(true);
    expect(scaleNeedsClinician("tcm")).toBe(true);
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
