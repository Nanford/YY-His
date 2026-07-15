/**
 * INPUT:  src/lib/assessment/patient-intake.ts（自助建档共享校验）
 * OUTPUT: parseScaleSelection 的白名单校验、去重、按量表库顺序归一化用例
 * POS:    量表自选是医患共用的写入口校验（不可信输入的红线之一）；此处只覆盖纯逻辑，
 *         不触库。SELF_SELECTABLE_SCALE_IDS 取自量表库，用例随题库自动对齐。
 */
import { describe, expect, it } from "vitest";
import {
  SELF_SELECTABLE_SCALE_IDS,
  parseScaleSelection,
} from "@/lib/assessment/patient-intake";

function formWithScales(...ids: string[]): FormData {
  const form = new FormData();
  for (const id of ids) form.append("scaleIds", id);
  return form;
}

describe("parseScaleSelection", () => {
  it("量表库顺序应为 frail → mnasf → fall → tcm（用例归一化依据）", () => {
    expect(SELF_SELECTABLE_SCALE_IDS).toEqual(["frail", "mnasf", "fall", "tcm"]);
  });

  it("未勾选任何量表 → null（不允许建空评估）", () => {
    expect(parseScaleSelection(new FormData())).toBeNull();
  });

  it("只有空白/空串 → null", () => {
    expect(parseScaleSelection(formWithScales("", "  "))).toBeNull();
  });

  it("单个合法量表 → 原样返回", () => {
    expect(parseScaleSelection(formWithScales("frail"))).toEqual(["frail"]);
  });

  it("默认预设 frail+fall → 按量表库顺序归一化", () => {
    expect(parseScaleSelection(formWithScales("frail", "fall"))).toEqual(["frail", "fall"]);
  });

  it("勾选顺序打乱且重复 → 去重并按量表库顺序归一化", () => {
    expect(parseScaleSelection(formWithScales("tcm", "frail", "frail", "tcm"))).toEqual([
      "frail",
      "tcm",
    ]);
  });

  it("全选四量表 → 完整量表库顺序", () => {
    expect(parseScaleSelection(formWithScales("fall", "tcm", "mnasf", "frail"))).toEqual([
      "frail",
      "mnasf",
      "fall",
      "tcm",
    ]);
  });

  it("含未知量表 id → 整体拒绝返回 null（不可信输入不放行）", () => {
    expect(parseScaleSelection(formWithScales("frail", "not-a-scale"))).toBeNull();
  });
});
