/**
 * INPUT:  emr-scale-suggest 规则兜底与脱敏
 * OUTPUT: 关键词推荐与 PII 脱敏用例
 * POS:    M10.2 病历智能评估纯逻辑把关（不调用 DeepSeek 网络）。
 */
import { describe, expect, it } from "vitest";
import { redactEmrText, suggestScalesByRules } from "@/lib/assessment/emr-scale-suggest";

describe("redactEmrText", () => {
  it("脱敏身份证与手机号", () => {
    const raw = "张三 身份证 110101199001011234 手机 13812345678 诊断：衰弱";
    const out = redactEmrText(raw);
    expect(out).not.toMatch(/110101199001011234/);
    expect(out).not.toMatch(/13812345678/);
    expect(out).toContain("[身份证号已脱敏]");
    expect(out).toContain("[手机号已脱敏]");
    expect(out).toContain("衰弱");
  });
});

describe("suggestScalesByRules", () => {
  it("衰弱+跌倒关键词命中 frail 与 fall_3q", () => {
    const r = suggestScalesByRules("患者近一年多次跌倒，自觉明显乏力衰弱");
    expect(r.method).toBe("rules");
    expect(r.scaleIds).toContain("frail");
    expect(r.scaleIds).toContain("fall_3q");
  });

  it("无关键词时给常规筛查组合", () => {
    const r = suggestScalesByRules("一般情况可，无明显主诉");
    expect(r.scaleIds.length).toBeGreaterThan(0);
    expect(r.scaleIds).toContain("frail");
  });
});
