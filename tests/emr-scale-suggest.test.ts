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

  it("病历含患者姓名时按档案姓名值级脱敏（精确替换）", () => {
    const out = redactEmrText("患者张桂芳，女，82岁，近一年多次跌倒", "张桂芳");
    expect(out).not.toContain("张桂芳");
    expect(out).toContain("[姓名已脱敏]");
    expect(out).toContain("跌倒");
  });

  it("称谓不当作姓名替换（防误伤：张大爷 ≠ 姓名本体）", () => {
    const out = redactEmrText("张大爷自述乏力", "张桂芳");
    expect(out).toContain("张大爷");
  });

  it("8 位日期不被长数字串规则误伤，非日期长号码仍脱敏", () => {
    const out = redactEmrText("20260808 入院，2026-08-09 手术，住院号 12345678901");
    expect(out).not.toContain("20260808");
    expect(out).toContain("[日期]");
    // 带分隔符的日期每段不足 8 位，本来就不命中长数字串规则
    expect(out).toContain("2026-08-09");
    expect(out).not.toContain("12345678901");
    expect(out).toContain("[号码已脱敏]");
  });
});

describe("suggestScalesByRules", () => {
  it("衰弱+跌倒关键词命中 frail 与 fall_3q", () => {
    const r = suggestScalesByRules("患者近一年多次跌倒，自觉明显乏力衰弱");
    expect(r.method).toBe("rules");
    expect(r.scaleIds).toContain("frail");
    expect(r.scaleIds).toContain("fall_3q");
  });

  it("无关键词时给常规筛查组合，reason 如实说明（不谎称关键词匹配）", () => {
    const r = suggestScalesByRules("一般情况可，无明显主诉");
    expect(r.scaleIds.length).toBeGreaterThan(0);
    expect(r.scaleIds).toContain("frail");
    expect(r.reason).toBe("未识别到明确线索，已给出常规筛查组合");
  });

  it("有关键词命中时 reason 报匹配数量", () => {
    const r = suggestScalesByRules("患者近一年多次跌倒，自觉明显乏力衰弱");
    expect(r.reason).toContain("关键词匹配到");
  });

  it("命中时返回实际风险关键词（设计图·病历智能评估 chips），无命中为空", () => {
    const hit = suggestScalesByRules("患者近一年多次跌倒，夜间睡眠差，自觉明显乏力");
    expect(hit.keywords).toContain("跌倒");
    expect(hit.keywords.length).toBeLessThanOrEqual(8);
    const miss = suggestScalesByRules("一般情况可，无明显主诉");
    expect(miss.keywords).toEqual([]);
  });
});
