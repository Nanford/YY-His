/**
 * INPUT:  AssessmentTag 的快照最小形状
 * OUTPUT: 报告级别解析与关注语义的边界回归
 * POS:    锁定医患两端共用的展示语义，不参与 02 表医学判定。
 */
import { describe, expect, it } from "vitest";
import { isAttentionTag, splitTagName, type AssessmentTag, type TagLevel } from "@/lib/assessment/report-types";

function tag(scaleId: string, code: string, level: TagLevel, name = "任意展示名"): AssessmentTag {
  return { tag: name, level, code, scaleId, score: 0, detail: [] };
}

describe("报告标签语义", () => {
  it.each([
    ["平和质：是", { tag: "平和质", level: "是" }],
    ["平和质：否", { tag: "平和质", level: "否" }],
    ["气虚质：倾向是", { tag: "气虚质", level: "倾向是" }],
    ["气虚质：基本是", { tag: "气虚质", level: "基本是" }],
  ] as const)("%s 不把否定档位默认当成是", (name, expected) => {
    expect(splitTagName(name)).toEqual(expected);
  });

  it("中医体质四档关注语义只由明确级别决定", () => {
    expect(isAttentionTag(tag("tcm_constitution", "TCM_BALANCED_YES", "是"))).toBe(false);
    expect(isAttentionTag(tag("tcm_constitution", "TCM_BALANCED_NO", "否"))).toBe(false);
    expect(isAttentionTag(tag("tcm_constitution", "TCM_QI_DEFICIENCY_NO", "否"))).toBe(false);
    expect(isAttentionTag(tag("tcm_constitution", "TCM_QI_DEFICIENCY_TENDENCY", "倾向是"))).toBe(true);
    expect(isAttentionTag(tag("tcm_constitution", "TCM_QI_DEFICIENCY_YES", "是"))).toBe(true);
    expect(isAttentionTag(tag("tcm_constitution", "TCM_BALANCED_BASICALLY", "基本是"))).toBe(true);
  });

  it("非中医标签按编码判断，不受展示名称中的否定词干扰", () => {
    expect(isAttentionTag(tag("fall_3q", "FALL_SCREEN_NEGATIVE", "是", "含风险字样但实际阴性"))).toBe(false);
    expect(isAttentionTag(tag("fall_3q", "FALL_SCREEN_POSITIVE", "是", "正常"))).toBe(true);
    expect(isAttentionTag(tag("morse", "MORSE_FALL_RISK_LOW", "是", "低风险"))).toBe(false);
    expect(isAttentionTag(tag("morse", "MORSE_FALL_RISK_HIGH", "是", "任意名称"))).toBe(true);
  });
});
