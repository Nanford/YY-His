/**
 * INPUT:  src/lib/assessment/patient-intake.ts（自助建档共享校验）
 * OUTPUT: parseScaleSelection 的白名单校验、去重、按量表库顺序归一化用例；
 *         buildV2ProfileExtensions（V2 基础信息扩展，docx §1）解析/拒绝用例
 * POS:    量表自选是医患共用的写入口校验（不可信输入的红线之一）；此处只覆盖纯逻辑，
 *         不触库。SELF_SELECTABLE_SCALE_IDS 取自量表库，用例随题库自动对齐。
 */
import { describe, expect, it } from "vitest";
import {
  SELF_SELECTABLE_SCALE_IDS,
  buildV2ProfileExtensions,
  parseScaleSelection,
} from "@/lib/assessment/patient-intake";

function formWithScales(...ids: string[]): FormData {
  const form = new FormData();
  for (const id of ids) form.append("scaleIds", id);
  return form;
}

describe("parseScaleSelection", () => {
  // V2 量表库顺序（01 表文档顺序，src/lib/rules 投影的 42 个可评分量表，M10.3b-2 补齐剩余 17 个）
  const V2_SCALE_ORDER = [
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
  ];

  it("量表库顺序应为 01 表文档顺序（用例归一化依据）", () => {
    expect(SELF_SELECTABLE_SCALE_IDS).toEqual(V2_SCALE_ORDER);
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

  it("默认预设 frail+fall_3q → 按量表库顺序归一化（fall_3q 在 frail 之前）", () => {
    expect(parseScaleSelection(formWithScales("frail", "fall_3q"))).toEqual(["fall_3q", "frail"]);
  });

  it("勾选顺序打乱且重复 → 去重并按量表库顺序归一化", () => {
    expect(
      parseScaleSelection(formWithScales("tcm_constitution", "frail", "frail", "tcm_constitution"))
    ).toEqual(["frail", "tcm_constitution"]);
  });

  it("全选 42 量表 → 完整量表库顺序", () => {
    const shuffled = [...V2_SCALE_ORDER].reverse();
    expect(parseScaleSelection(formWithScales(...shuffled))).toEqual(V2_SCALE_ORDER);
  });

  it("含未知量表 id → 整体拒绝返回 null（不可信输入不放行）", () => {
    expect(parseScaleSelection(formWithScales("frail", "not-a-scale"))).toBeNull();
  });
});

describe("buildV2ProfileExtensions（V2 基础信息扩展，docx §1，全部选填）", () => {
  function form(entries: Record<string, string>): FormData {
    const data = new FormData();
    for (const [key, value] of Object.entries(entries)) data.set(key, value);
    return data;
  }

  it("空表单 → 全 null、Json 键缺省（全部选填可通过）", () => {
    expect(buildV2ProfileExtensions(new FormData())).toEqual({
      education: null,
      maritalStatus: null,
      livingSituation: null,
      careSituation: null,
      calfLeftCm: null,
      calfRightCm: null,
      gripStrengthKg: null,
      gaitSpeed6mSec: null,
    });
  });

  it("正常解析：枚举 + 测量补充 + 体重史", () => {
    const result = buildV2ProfileExtensions(
      form({
        education: "高中中专技校",
        maritalStatus: "已婚",
        livingSituation: "与配偶同住",
        careSituation: "配偶照护",
        weightM1: "68.5",
        weightM12: "72",
        calfLeftCm: "33",
        calfRightCm: "33.5",
        gripStrengthKg: "22.5",
        gaitSpeed6mSec: "7.5",
      })
    );
    expect(result).toEqual({
      education: "高中中专技校",
      maritalStatus: "已婚",
      livingSituation: "与配偶同住",
      careSituation: "配偶照护",
      weightHistory: { m1: 68.5, m2: null, m3: null, m6: null, m12: 72 },
      calfLeftCm: 33,
      calfRightCm: 33.5,
      gripStrengthKg: 22.5,
      gaitSpeed6mSec: 7.5,
    });
  });

  it("文化程度枚举外 → null", () => {
    expect(buildV2ProfileExtensions(form({ education: "博士后" }))).toBeNull();
  });

  it("数值越界 → null（体重 <20 / 握力 >100 / 6 米用时 0）", () => {
    expect(buildV2ProfileExtensions(form({ weightM1: "10" }))).toBeNull();
    expect(buildV2ProfileExtensions(form({ gripStrengthKg: "120" }))).toBeNull();
    expect(buildV2ProfileExtensions(form({ gaitSpeed6mSec: "0" }))).toBeNull();
    expect(buildV2ProfileExtensions(form({ calfLeftCm: "abc" }))).toBeNull();
  });

  it("诊断清单：逗号/顿号/换行混合分隔 → 数组；空输入 → 键缺省", () => {
    const result = buildV2ProfileExtensions(
      form({ diagnoses: "高血压，2型糖尿病、冠心病\n脑梗死； 慢阻肺 " })
    );
    expect(result?.diagnoses).toEqual(["高血压", "2型糖尿病", "冠心病", "脑梗死", "慢阻肺"]);
  });

  it("用药清单：每行'药名,类别,剂量,频次'简式解析（中英文逗号均可，剂量/频次可省）", () => {
    const result = buildV2ProfileExtensions(
      form({ medications: "苯磺酸氨氯地平，西药，5mg，每日一次\n钙片,保健品" })
    );
    expect(result?.medications).toEqual([
      { name: "苯磺酸氨氯地平", category: "西药", dose: "5mg", frequency: "每日一次" },
      { name: "钙片", category: "保健品" },
    ]);
  });

  it("用药类别非法或行缺类别 → null", () => {
    expect(buildV2ProfileExtensions(form({ medications: "钙片，处方药" }))).toBeNull();
    expect(buildV2ProfileExtensions(form({ medications: "钙片" }))).toBeNull();
  });

  it("体重史全空 → weightHistory 键缺省", () => {
    const result = buildV2ProfileExtensions(form({ education: "小学" }));
    expect(result).not.toHaveProperty("weightHistory");
  });
});
