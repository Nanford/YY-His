/**
 * INPUT:  src/lib/providers/pii-filter.ts
 * OUTPUT: PII 出网过滤层的单元测试
 * POS:    合规红线的测试把关（AGENTS.md 硬约束 1：出网前必须经过字段过滤，且有单元测试）。
 */
import { describe, expect, it } from "vitest";
import { assertPiiSafe, PiiViolationError } from "@/lib/providers/pii-filter";

describe("PII 出网过滤：字段级拦截", () => {
  it("顶层出现禁用字段名 → 拦截", () => {
    expect(() => assertPiiSafe({ name: "张三" })).toThrow(PiiViolationError);
    expect(() => assertPiiSafe({ idCard: "110101..." })).toThrow(PiiViolationError);
    expect(() => assertPiiSafe({ phone: "13800000000" })).toThrow(PiiViolationError);
    expect(() => assertPiiSafe({ address: "北京市…" })).toThrow(PiiViolationError);
    expect(() => assertPiiSafe({ admissionNo: "ZY001" })).toThrow(PiiViolationError);
    expect(() => assertPiiSafe({ outpatientNo: "MZ001" })).toThrow(PiiViolationError);
  });

  it("嵌套对象与数组内的禁用字段 → 拦截", () => {
    expect(() => assertPiiSafe({ user: { profile: { patient_name: "张三" } } })).toThrow(
      PiiViolationError
    );
    expect(() => assertPiiSafe({ messages: [{ role: "user", meta: { mobile: "138" } }] })).toThrow(
      PiiViolationError
    );
  });

  it("大小写与分隔符变体不能绕过（IdCard / id-card / PHONE_NUMBER）", () => {
    expect(() => assertPiiSafe({ IdCard: "x" })).toThrow(PiiViolationError);
    expect(() => assertPiiSafe({ "id-card": "x" })).toThrow(PiiViolationError);
    expect(() => assertPiiSafe({ PHONE_NUMBER: "x" })).toThrow(PiiViolationError);
    expect(() => assertPiiSafe({ Home_Address: "x" })).toThrow(PiiViolationError);
  });

  it("合法业务字段不受影响（model_name/voice_type 等含相似子串的字段应放行）", () => {
    // model_name 归一化后为 modelname，不等于 name，精确匹配不应误伤
    expect(() =>
      assertPiiSafe({
        model: "deepseek-chat",
        request: { model_name: "bigmodel", enable_punc: true },
        audio: { voice_type: "zh_female", encoding: "mp3" },
        user: { uid: "P20260714-X3F9" },
        messages: [{ role: "user", content: "过去4周您是否感到疲乏？回答：是" }],
      })
    ).not.toThrow();
  });

  it("患者唯一编号 code 允许出网（AGENTS.md：出网只允许携带患者唯一编号）", () => {
    expect(() => assertPiiSafe({ user: { uid: "P20260714-X3F9" }, code: "P20260714-X3F9" })).not.toThrow();
  });
});

describe("PII 出网过滤：值级兜底拦截", () => {
  it("字符串值中包含已登记的 PII 明文 → 拦截", () => {
    expect(() =>
      assertPiiSafe(
        { messages: [{ role: "user", content: "患者张桂芳说她最近很累" }] },
        { piiValues: ["张桂芳"] }
      )
    ).toThrow(PiiViolationError);
    expect(() =>
      assertPiiSafe({ text: "回电 13812345678" }, { piiValues: ["13812345678"] })
    ).toThrow(PiiViolationError);
  });

  it("未命中登记值时正常放行；空白登记值忽略", () => {
    expect(() =>
      assertPiiSafe({ text: "最近吃饭没胃口" }, { piiValues: ["张桂芳", "  ", ""] })
    ).not.toThrow();
  });

  it("拦截错误带有字段路径，便于定位", () => {
    try {
      assertPiiSafe({ a: [{ patientName: "x" }] });
      expect.unreachable("应当抛出 PiiViolationError");
    } catch (error) {
      expect(error).toBeInstanceOf(PiiViolationError);
      expect((error as PiiViolationError).path).toBe("$.a[0].patientName");
    }
  });
});
