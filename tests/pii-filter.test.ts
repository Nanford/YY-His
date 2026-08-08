/**
 * INPUT:  src/lib/providers/pii-filter.ts
 * OUTPUT: PII 出网过滤层的单元测试
 * POS:    合规红线的测试把关（AGENTS.md 硬约束 1：出网前必须经过字段过滤，且有单元测试）。
 */
import { describe, expect, it, vi } from "vitest";
import { assertPiiSafe, PiiViolationError } from "@/lib/providers/pii-filter";
import { normalizeByDeepSeek } from "@/lib/providers/deepseek";

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

describe("DeepSeek 归一化出网：患者姓名值级脱敏", () => {
  const question = {
    standardText: "过去4周您是否感到疲乏？",
    colloquialText: "最近觉得累不累？",
    options: [
      { label: "是", score: 1 },
      { label: "否", score: 0 },
    ],
    patientCode: "P20260714-X3F9",
  };

  function stubFetch(captured: { body: string }) {
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      captured.body = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  matched: true,
                  optionLabel: "是",
                  confidence: 0.9,
                  reason: "命中",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
  }

  it("口述自报档案姓名时，出网文本姓名被替换为「患者」", async () => {
    const prevKey = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "test-key";
    const captured = { body: "" };
    stubFetch(captured);
    try {
      const outcome = await normalizeByDeepSeek({
        ...question,
        utterance: "我叫张桂芳，最近是有点累",
        patientName: "张桂芳",
      });
      expect(outcome?.status).toBe("matched");
      expect(captured.body).not.toContain("张桂芳");
      expect(captured.body).toContain("患者");
    } finally {
      vi.unstubAllGlobals();
      if (prevKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = prevKey;
    }
  });

  it("不传 patientName 时口述原文出网（可选参数，不破坏既有调用方）", async () => {
    const prevKey = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "test-key";
    const captured = { body: "" };
    stubFetch(captured);
    try {
      const outcome = await normalizeByDeepSeek({
        ...question,
        utterance: "最近是有点累",
      });
      expect(outcome?.status).toBe("matched");
      expect(captured.body).toContain("最近是有点累");
    } finally {
      vi.unstubAllGlobals();
      if (prevKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = prevKey;
    }
  });
});
