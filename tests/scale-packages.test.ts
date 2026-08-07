/**
 * INPUT:  src/lib/assessment/scale-packages.ts（量表套餐定义与发起评估选择解析）
 * OUTPUT: 套餐内容与 docx §2 精确对齐、套餐量表全部可评分（judgments-v2）、
 *         parseSessionScaleSelection 的套餐/自定义/随访复评/空拒绝四路径与非法 id 拒绝用例
 * POS:    量表工具选择（V2/Demo_v2更新说明.docx §2）的纯逻辑把关，不触库。
 *         期望值手工抄自 docx §2 口径硬编码，不反向引用实现，防止实现与测试一起错。
 */
import { describe, expect, it } from "vitest";
import {
  SCALE_PACKAGES,
  SCORABLE_SCALE_IDS,
  parseSessionScaleSelection,
  resolvePackageScaleIds,
} from "@/lib/assessment/scale-packages";
import { judgmentsV2 } from "@/lib/rules/v2";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

describe("SCALE_PACKAGES（来源：docx §2 量表工具选择）", () => {
  it("常规综合评估包排最前，内容与 docx §2(1) 一致（8 个量表）", () => {
    const routine = SCALE_PACKAGES[0];
    expect(routine.key).toBe("routine");
    // docx §2(1)：ADL / IADL / FRAIL / MNA-SF / Mini-Cog / 抑郁两问 / 焦虑两问 / 中医体质
    expect(routine.scaleIds).toEqual([
      "adl",
      "iadl",
      "frail",
      "mnasf",
      "minicog",
      "depression_2q",
      "anxiety_2q",
      "tcm_constitution",
    ]);
  });

  it("4 个系统预设套餐与 docx §2(2) A–D 精确一致", () => {
    const byKey = new Map(SCALE_PACKAGES.map((pkg) => [pkg.key, pkg.scaleIds]));
    // A 衰弱与机能评估包 / B 认知评估包 / C 情志评估包 / D 中医特色评估包
    expect(byKey.get("frailty")).toEqual(["adl", "iadl", "frail"]);
    expect(byKey.get("cognitive")).toEqual(["minicog", "mmse"]);
    expect(byKey.get("mood")).toEqual(["gds15", "gad7", "ais"]);
    expect(byKey.get("tcm")).toEqual(["tcm_constitution"]);
  });

  it("套餐内量表必须全部已配判定（可评分，judgments-v2 收录）", () => {
    const judged = new Set(judgmentsV2.map((j) => j.scaleId));
    for (const pkg of SCALE_PACKAGES) {
      for (const id of pkg.scaleIds) {
        expect(judged.has(id), `${pkg.key} 包含未配判定量表 ${id}`).toBe(true);
      }
    }
  });

  it("resolvePackageScaleIds 命中返回量表，未命中返回 undefined", () => {
    expect(resolvePackageScaleIds("mood")).toEqual(["gds15", "gad7", "ais"]);
    expect(resolvePackageScaleIds("custom")).toBeUndefined();
    expect(resolvePackageScaleIds("nope")).toBeUndefined();
  });
});

describe("parseSessionScaleSelection", () => {
  it("套餐路径：package 命中即返回套餐量表", () => {
    expect(parseSessionScaleSelection(form({ package: "routine" }))).toEqual([
      "adl",
      "iadl",
      "frail",
      "mnasf",
      "minicog",
      "depression_2q",
      "anxiety_2q",
      "tcm_constitution",
    ]);
    expect(parseSessionScaleSelection(form({ package: "cognitive" }))).toEqual(["minicog", "mmse"]);
  });

  it("自定义路径：收集 scale.<id> 勾选并按 01 表文档顺序归一化", () => {
    const data = form({ package: "custom", "scale.gad7": "on", "scale.adl": "on" });
    expect(parseSessionScaleSelection(data)).toEqual(["adl", "gad7"]);
  });

  it("旧表单兼容：无 package 字段时仍按 scale.<id> 勾选解析", () => {
    const data = form({ "scale.frail": "on", "scale.fall_3q": "on" });
    expect(parseSessionScaleSelection(data)).toEqual(["fall_3q", "frail"]);
  });

  it("空选择返回 null（调用方回 error=no-scale）", () => {
    expect(parseSessionScaleSelection(form({}))).toBeNull();
    expect(parseSessionScaleSelection(form({ package: "custom" }))).toBeNull();
  });

  it("非法输入拒绝：未知套餐 key / 未知量表 id 一律抛错", () => {
    expect(() => parseSessionScaleSelection(form({ package: "emr" }))).toThrow();
    // M10.3b-2 后 42 量表均已配判定；未知 id 仍须拒绝
    expect(() => parseSessionScaleSelection(form({ "scale.unknown": "on" }))).toThrow();
  });

  it("随访复评：取可评分量表 ∩ 上次会话范围，按 01 表顺序归一化", () => {
    const data = form({ followup: "1" });
    expect(
      parseSessionScaleSelection(data, { followupScaleIds: ["frail", "mmse", "tcm_constitution"] })
    ).toEqual(["mmse", "frail", "tcm_constitution"]);
  });

  it("随访复评防篡改：客户端夹带的 scale.<id> 一律忽略，只认服务端给出的上次范围", () => {
    const data = form({ followup: "1", "scale.gad7": "on", "scale.mmse": "on" });
    expect(parseSessionScaleSelection(data, { followupScaleIds: ["frail"] })).toEqual(["frail"]);
  });

  it("随访复评无上次范围（或交集为空）返回 null", () => {
    expect(parseSessionScaleSelection(form({ followup: "1" }))).toBeNull();
    expect(parseSessionScaleSelection(form({ followup: "1" }), { followupScaleIds: [] })).toBeNull();
  });

  it("优先级：followup 高于 package", () => {
    const data = form({ followup: "1", package: "tcm" });
    expect(parseSessionScaleSelection(data, { followupScaleIds: ["adl"] })).toEqual(["adl"]);
  });

  it("SCORABLE_SCALE_IDS 为 01 表文档顺序的 42 个已配判定量表（M10.3b-2 全量）", () => {
    expect([...SCORABLE_SCALE_IDS]).toEqual([
      "adl",
      "iadl",
      "motor_screen",
      "sppb",
      "vision",
      "visual_function",
      "hearing",
      "whisper",
      "minicog",
      "mmse",
      "depression_2q",
      "gds15",
      "anxiety_2q",
      "gad7",
      "lubben",
      "home_env",
      "fall_3q",
      "morse",
      "frail",
      "ui_2q",
      "iciq",
      "constipation_1q",
      "constipation_symptom",
      "sleep_1q",
      "ais",
      "pain_1q",
      "pain_nrs",
      "pain_behavior",
      "pressure_screen",
      "braden",
      "polypharmacy",
      "dysphagia_screen",
      "water_swallow",
      "nrs2002",
      "mnasf",
      "glim",
      "calf",
      "grip",
      "gait_speed",
      "dxa_bia",
      "cam",
      "tcm_constitution",
    ]);
  });
});
