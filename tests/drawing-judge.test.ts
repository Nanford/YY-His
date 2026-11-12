/**
 * INPUT:  src/lib/dialogue/drawing-judge.ts（画图题判定编排）、src/lib/providers/vision.ts（视觉模型通道）
 * OUTPUT: 画图题看图判定的单测（画钟、五边形临摹；全部用桩函数/桩 fetch，不出网）
 * POS:    锁定三条红线：① 明确的对错由确定性规则根据模型的观察结果判定，结论只映射到 01 表既有选项，
 *         分值取选项分值（硬约束 2）；② 规则判为临界时追加临界复核、由模型给出合格/不合格并计分
 *         （2026-11-11 用户拍板：画图不再等医生确认），视觉通道不可用/输出不合法/复核失败才交医生，
 *         不编造结论（硬约束 3）；③ 出网请求只含图片与提示词，不带任何患者标识（硬约束 1）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clockVerdict,
  createClockJudge,
  createPentagonJudge,
  judgeDrawing,
  parseArbitration,
  parseClockObservation,
  parsePentagonObservation,
  pentagonVerdict,
  validateDrawing,
  type ClockObservation,
  type PentagonObservation,
} from "@/lib/dialogue/drawing-judge";
import type { VisionJsonRequest } from "@/lib/providers/vision";
import { extractJsonObject, requestVisionJson, visionAvailable } from "@/lib/providers/vision";
import { askableQuestions, scoringOptionsOf } from "@/lib/dialogue/state-machine";
import { questionById } from "@/lib/rules";

const DRAWING = "data:image/png;base64,AAAA";

function clockOptions() {
  const question = questionById.get("minicog_2");
  if (!question?.options) throw new Error("minicog_2 应有标准选项");
  return question.options;
}

/** 标准钟面的模型原始输出（各数字都在应在方位）；overrides 覆盖个别字段构造异常画法 */
function rawClock(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hasOutline: true,
    numbers: [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    sectors: {
      "1": "右上",
      "2": "右上",
      "3": "右",
      "4": "右下",
      "5": "右下",
      "6": "下",
      "7": "左下",
      "8": "左下",
      "9": "左",
      "10": "左上",
      "11": "左上",
      "12": "上",
    },
    handCount: 2,
    confidence: 0.95,
    note: "",
    ...overrides,
  };
}

function observe(overrides: Record<string, unknown> = {}): ClockObservation {
  const observation = parseClockObservation(rawClock(overrides));
  if (!observation) throw new Error("测试观察数据应合法");
  return observation;
}

describe("validateDrawing", () => {
  it("非图片 data URL 与超长数据被拒绝", () => {
    expect(validateDrawing(undefined)).toBe("画作数据无效");
    expect(validateDrawing("hello")).toBe("画作数据无效");
    expect(validateDrawing(`data:image/png;base64,${"A".repeat(800_001)}`)).toBe("画作数据过大，请简化后重试");
    expect(validateDrawing(DRAWING)).toBeNull();
  });
});

describe("parseClockObservation：模型输出逐字段校验", () => {
  it("整数写成字符串也接受", () => {
    const observation = parseClockObservation(rawClock({ numbers: ["12", "1", 2], handCount: "2" }));
    expect(observation?.numbers).toEqual([12, 1, 2]);
    expect(observation?.handCount).toBe(2);
  });

  it("「未见」与不认识的方位都记为未看到", () => {
    const observation = observe({ sectors: { "12": "未见", "3": "东边" } });
    expect(observation.sectors[12]).toBeNull();
    expect(observation.sectors[3]).toBeNull();
    expect(observation.sectors[6]).toBeNull();
  });

  it("形状不合法返回 null", () => {
    expect(parseClockObservation(null)).toBeNull();
    expect(parseClockObservation(rawClock({ hasOutline: "yes" }))).toBeNull();
    expect(parseClockObservation(rawClock({ numbers: [1, "abc"] }))).toBeNull();
    expect(parseClockObservation(rawClock({ sectors: null }))).toBeNull();
    expect(parseClockObservation(rawClock({ handCount: 1.5 }))).toBeNull();
    expect(parseClockObservation(rawClock({ confidence: 2 }))).toBeNull();
  });
});

describe("clockVerdict：画钟确定性判定", () => {
  it("标准钟面判正确；非基准数字偏一格属正常手绘误差", () => {
    expect(clockVerdict(observe()).verdict).toBe("correct");
    expect(clockVerdict(observe({ sectors: { ...(rawClock().sectors as object), "1": "上", "2": "右" } })).verdict).toBe(
      "correct"
    );
  });

  it("不评指针指向的具体时间，只要求至少两根指针（用户拍板 3A，2026-11-11 再次确认维持）", () => {
    expect(clockVerdict(observe({ handCount: 3 })).verdict).toBe("correct");
    expect(clockVerdict(observe({ handCount: 1 })).verdict).toBe("incorrect");
    expect(clockVerdict(observe({ handCount: 0 })).verdict).toBe("incorrect");
  });

  it("无轮廓、数字不齐、重复、多余都判错误", () => {
    expect(clockVerdict(observe({ hasOutline: false })).verdict).toBe("incorrect");
    expect(clockVerdict(observe({ numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9] })).verdict).toBe("incorrect");
    expect(clockVerdict(observe({ numbers: [1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] })).verdict).toBe("incorrect");
    expect(clockVerdict(observe({ numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] })).verdict).toBe("incorrect");
  });

  it("数字全挤在右半边判错误（实测模型直接判对错时会误判为正确的画法）", () => {
    const crowded = observe({
      sectors: {
        "1": "右上",
        "2": "右上",
        "3": "右",
        "4": "右",
        "5": "右下",
        "6": "右下",
        "7": "右下",
        "8": "右下",
        "9": "下",
        "10": "下",
        "11": "下",
        "12": "下",
      },
    });
    expect(clockVerdict(crowded).verdict).toBe("incorrect");
  });

  it("逆时针写、整体转了角度判错误", () => {
    const base = rawClock().sectors as Record<string, string>;
    const mirrored = Object.fromEntries(
      Object.entries(base).map(([number, sector]) => [number, sector.replace("右", "#").replace("左", "右").replace("#", "左")])
    );
    expect(clockVerdict(observe({ sectors: mirrored })).verdict).toBe("incorrect");
    const rotated = observe({ sectors: { ...base, "12": "右", "3": "下", "6": "左", "9": "上" } });
    expect(clockVerdict(rotated).verdict).toBe("incorrect");
  });

  it("临界情况规则不下结论（交临界复核）：基准数字偏一格、单个数字明显错位、模型把握不足", () => {
    const base = rawClock().sectors as object;
    expect(clockVerdict(observe({ sectors: { ...base, "12": "右上" } })).verdict).toBe("unclear");
    expect(clockVerdict(observe({ sectors: { ...base, "5": "左下" } })).verdict).toBe("unclear");
    expect(clockVerdict(observe({ confidence: 0.5 })).verdict).toBe("unclear");
  });

  it("两个及以上非基准数字明显错位判错误；基准数字缺失判错误", () => {
    const base = rawClock().sectors as object;
    expect(clockVerdict(observe({ sectors: { ...base, "5": "左下", "10": "右" } })).verdict).toBe("incorrect");
    expect(clockVerdict(observe({ sectors: { ...base, "6": "未见" } })).verdict).toBe("incorrect");
  });
});

describe("createClockJudge：观察 → 判定", () => {
  it("通道返回 null 或输出不合法 → null（视为通道不可用）", async () => {
    expect(await createClockJudge(async () => null)(DRAWING)).toBeNull();
    expect(await createClockJudge(async () => ({ foo: 1 }))(DRAWING)).toBeNull();
  });

  it("只发患者画作一张图，提示词要求按实际位置报告；结论明确时不做临界复核", async () => {
    const request = vi.fn(async () => rawClock());
    const verdict = await createClockJudge(request)(DRAWING);
    expect(verdict?.verdict).toBe("correct");
    expect(request).toHaveBeenCalledTimes(1);
    const sent = (request.mock.calls[0] as unknown as [{ imageDataUrls: string[]; systemPrompt: string }])[0];
    expect(sent.imageDataUrls).toEqual([DRAWING]);
    expect(sent.systemPrompt).toContain("绝不能按正常钟表应有的样子推断");
  });

  it("规则临界 → 临界复核定分：复核带上拿不准的地方，合格/不合格直接作为结论（2026-11-11 用户拍板方案 A）", async () => {
    const borderline = rawClock({ sectors: { ...(rawClock().sectors as object), "12": "右上" } });
    const passed = sequencedRequester(borderline, { pass: true, confidence: 0.8, reason: "12 略偏右，属手绘误差" });
    const verdict = await createClockJudge(passed)(DRAWING);
    expect(verdict).toMatchObject({ verdict: "correct", confidence: 0.8 });
    expect(verdict?.reason).toContain("临界复核合格");
    expect(verdict?.reason).toContain("数字 12 在「右上」");
    expect(passed).toHaveBeenCalledTimes(2);
    expect(sentRequest(passed, 0).purpose).toBeUndefined(); // 首轮观察走观察模型
    const arbitration = sentRequest(passed, 1);
    expect(arbitration.purpose).toBe("arbitration"); // 复核走复核模型
    expect(arbitration.imageDataUrls).toEqual([DRAWING]);
    expect(arbitration.systemPrompt).toContain("复核员");
    expect(arbitration.userText).toContain("复核重点：位置临界：数字 12 在「右上」");

    const failed = sequencedRequester(borderline, { pass: false, confidence: 0.6, reason: "12 明显偏到右侧" });
    expect(await createClockJudge(failed)(DRAWING)).toMatchObject({ verdict: "incorrect", confidence: 0.6 });
  });

  it("首轮把握不足时，复核要求逐项完整核对", async () => {
    const request = sequencedRequester(rawClock({ confidence: 0.5 }), { pass: true, confidence: 0.9, reason: "齐全" });
    expect((await createClockJudge(request)(DRAWING))?.verdict).toBe("correct");
    expect(sentRequest(request, 1).userText).toContain("请按标准逐项完整核对");
  });

  it("临界复核通道失败或输出不合法 → 保留首轮的拿不准（交医生）", async () => {
    const borderline = rawClock({ sectors: { ...(rawClock().sectors as object), "5": "左下" } });
    expect((await createClockJudge(sequencedRequester(borderline, null))(DRAWING))?.verdict).toBe("unclear");
    expect((await createClockJudge(sequencedRequester(borderline, { pass: "是" }))(DRAWING))?.verdict).toBe("unclear");
  });
});

/** 按调用顺序依次返回给定输出的看图桩函数（首轮观察、临界复核） */
function sequencedRequester(...outputs: (Record<string, unknown> | null)[]) {
  let index = 0;
  return vi.fn(async (request: VisionJsonRequest) => {
    void request;
    return outputs[index++] ?? null;
  });
}

function sentRequest(requester: ReturnType<typeof sequencedRequester>, callIndex: number): VisionJsonRequest {
  return requester.mock.calls[callIndex][0];
}

describe("parseArbitration：临界复核输出校验", () => {
  it("合法输出解析；理由缺失记为空串", () => {
    expect(parseArbitration({ pass: true, confidence: 0.7, reason: " 合格 " })).toEqual({
      pass: true,
      confidence: 0.7,
      reason: "合格",
    });
    expect(parseArbitration({ pass: false, confidence: 0.4 })?.reason).toBe("");
  });

  it("形状不合法返回 null", () => {
    expect(parseArbitration(null)).toBeNull();
    expect(parseArbitration({ pass: "true", confidence: 0.7 })).toBeNull();
    expect(parseArbitration({ pass: true, confidence: 1.5 })).toBeNull();
    expect(parseArbitration({ pass: true })).toBeNull();
  });
});

/** 正确临摹的模型原始输出；overrides 覆盖个别字段构造错误画法 */
function rawPentagons(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    shapes: [
      { corners: 5, closed: true },
      { corners: 5, closed: true },
    ],
    overlapping: true,
    overlapCorners: 4,
    confidence: 0.9,
    note: "",
    ...overrides,
  };
}

function observePentagons(overrides: Record<string, unknown> = {}): PentagonObservation {
  const observation = parsePentagonObservation(rawPentagons(overrides));
  if (!observation) throw new Error("测试观察数据应合法");
  return observation;
}

describe("parsePentagonObservation：模型输出逐字段校验", () => {
  it("合法输出解析；角数写成字符串也接受；不交叠时 overlapCorners 为 null", () => {
    expect(observePentagons().shapes).toHaveLength(2);
    const stringCorners = parsePentagonObservation(
      rawPentagons({ shapes: [{ corners: "5", closed: true }, { corners: 5, closed: true }] })
    );
    expect(stringCorners?.shapes[0].corners).toBe(5);
    expect(observePentagons({ overlapping: false, overlapCorners: null }).overlapCorners).toBeNull();
  });

  it("形状不合法返回 null", () => {
    expect(parsePentagonObservation(null)).toBeNull();
    expect(parsePentagonObservation(rawPentagons({ shapes: "两个" }))).toBeNull();
    expect(parsePentagonObservation(rawPentagons({ shapes: [{ corners: 5 }] }))).toBeNull();
    expect(parsePentagonObservation(rawPentagons({ overlapping: "是" }))).toBeNull();
    expect(parsePentagonObservation(rawPentagons({ overlapCorners: "四" }))).toBeNull();
    expect(parsePentagonObservation(rawPentagons({ confidence: 2 }))).toBeNull();
  });
});

describe("pentagonVerdict：五边形临摹确定性判定（国标 WS/T 484 表 C.1 注 8）", () => {
  it("两个闭合五边形相交、交叉处为四边形 → 正确", () => {
    expect(pentagonVerdict(observePentagons()).verdict).toBe("correct");
  });

  it("图形个数不对、没闭合、角数明显不对、不相交 → 错误", () => {
    const shapesOf = (...corners: number[]) => corners.map((count) => ({ corners: count, closed: true }));
    expect(pentagonVerdict(observePentagons({ shapes: shapesOf(5) })).verdict).toBe("incorrect");
    expect(pentagonVerdict(observePentagons({ shapes: [] })).verdict).toBe("incorrect");
    expect(
      pentagonVerdict(observePentagons({ shapes: [{ corners: 5, closed: true }, { corners: 5, closed: false }] })).verdict
    ).toBe("incorrect");
    expect(pentagonVerdict(observePentagons({ shapes: shapesOf(4, 4) })).verdict).toBe("incorrect"); // 两个都不是五边形
    expect(pentagonVerdict(observePentagons({ shapes: shapesOf(4, 6) })).verdict).toBe("incorrect");
    expect(pentagonVerdict(observePentagons({ shapes: shapesOf(5, 3) })).verdict).toBe("incorrect"); // 差两个角
    expect(pentagonVerdict(observePentagons({ shapes: shapesOf(0, 0) })).verdict).toBe("incorrect"); // 画成圆
    expect(pentagonVerdict(observePentagons({ overlapping: false, overlapCorners: null })).verdict).toBe("incorrect");
    // 不相交时即使有一个只差一个角，也已确定判错，不交医生
    expect(
      pentagonVerdict(observePentagons({ shapes: shapesOf(5, 4), overlapping: false, overlapCorners: null })).verdict
    ).toBe("incorrect");
  });

  it("差一点的情况规则不下结论（交临界复核）：只差一个角、交叠区域看不清或不是四边形、模型把握不足（2026-11-11 实测模型易把画对的看错）", () => {
    const shapesOf = (...corners: number[]) => corners.map((count) => ({ corners: count, closed: true }));
    expect(pentagonVerdict(observePentagons({ shapes: shapesOf(5, 4) })).verdict).toBe("unclear"); // 交叠处的角被挡住漏数
    expect(pentagonVerdict(observePentagons({ shapes: shapesOf(6, 5) })).verdict).toBe("unclear");
    expect(pentagonVerdict(observePentagons({ overlapCorners: 3 })).verdict).toBe("unclear");
    expect(pentagonVerdict(observePentagons({ overlapCorners: 5 })).verdict).toBe("unclear");
    expect(pentagonVerdict(observePentagons({ overlapCorners: null })).verdict).toBe("unclear");
    expect(pentagonVerdict(observePentagons({ confidence: 0.5 })).verdict).toBe("unclear");
  });
});

describe("createPentagonJudge：观察 → 判定", () => {
  it("通道返回 null 或输出不合法 → null", async () => {
    expect(await createPentagonJudge(async () => null)(DRAWING)).toBeNull();
    expect(await createPentagonJudge(async () => ({ foo: 1 }))(DRAWING)).toBeNull();
  });

  it("只发患者画作（不发示例图，避免模型照示例脑补），提示词要求按实际画的报告", async () => {
    const request = vi.fn(async () => rawPentagons());
    const verdict = await createPentagonJudge(request)(DRAWING);
    expect(verdict?.verdict).toBe("correct");
    const sent = (request.mock.calls[0] as unknown as [{ imageDataUrls: string[]; systemPrompt: string }])[0];
    expect(sent.imageDataUrls).toEqual([DRAWING]);
    expect(sent.systemPrompt).toContain("绝不能按示例应有的样子推断");
  });

  it("规则临界（只差一个角）→ 临界复核按国标注 8 定分，复核仍只发患者画作", async () => {
    const borderline = rawPentagons({
      shapes: [
        { corners: 5, closed: true },
        { corners: 4, closed: true },
      ],
    });
    const passed = sequencedRequester(borderline, { pass: true, confidence: 0.75, reason: "两个五边形相交，交叉处为四边形" });
    const verdict = await createPentagonJudge(passed)(DRAWING);
    expect(verdict).toMatchObject({ verdict: "correct", confidence: 0.75 });
    expect(verdict?.reason).toContain("首轮拿不准：两个图形的角数为 5、4");
    const arbitration = sentRequest(passed, 1);
    expect(arbitration.purpose).toBe("arbitration");
    expect(arbitration.imageDataUrls).toEqual([DRAWING]);
    expect(arbitration.systemPrompt).toContain("WS/T 484—2015 表 C.1 注 8");

    const failed = sequencedRequester(rawPentagons({ overlapCorners: 3 }), { pass: false, confidence: 0.7, reason: "交叉处是三角形" });
    expect(await createPentagonJudge(failed)(DRAWING)).toMatchObject({ verdict: "incorrect" });
  });

  it("明确画错时不做临界复核", async () => {
    const request = sequencedRequester(rawPentagons({ overlapping: false, overlapCorners: null }));
    expect((await createPentagonJudge(request)(DRAWING))?.verdict).toBe("incorrect");
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("judgeDrawing：映射回标准选项", () => {
  it("正确 → 最高分选项（2 分）；错误 → 0 分选项", async () => {
    const correct = await judgeDrawing("minicog_2", clockOptions(), DRAWING, async () => ({
      verdict: "correct",
      confidence: 0.9,
      reason: "齐全",
    }));
    expect(correct).toMatchObject({ status: "matched", score: 2, method: "llm", confidence: 0.9 });
    if (correct.status !== "matched") throw new Error("应为 matched");
    expect(correct.optionLabel).toContain("画钟正确");

    const incorrect = await judgeDrawing("minicog_2", clockOptions(), DRAWING, async () => ({
      verdict: "incorrect",
      confidence: 0.95,
      reason: "数字不全",
    }));
    expect(incorrect).toMatchObject({ status: "matched", score: 0 });
    if (incorrect.status !== "matched") throw new Error("应为 matched");
    expect(incorrect.optionLabel).toContain("画钟错误或未完成");
  });

  it("拿不准或通道不可用 → unclear，交医生确认", async () => {
    const unsure = await judgeDrawing("minicog_2", clockOptions(), DRAWING, async () => ({
      verdict: "unclear",
      confidence: 0.4,
      reason: "位置临界",
    }));
    expect(unsure.status).toBe("unclear");
    const unavailable = await judgeDrawing("minicog_2", clockOptions(), DRAWING, async () => null);
    expect(unavailable).toMatchObject({ status: "unclear", method: "none" });
  });

  it("五边形临摹（mmse_30）：正确 → 1 分选项；错误 → 0 分选项", async () => {
    const question = questionById.get("mmse_30");
    if (!question?.options) throw new Error("mmse_30 应有标准选项");
    const correct = await judgeDrawing("mmse_30", question.options, DRAWING, async () => ({
      verdict: "correct",
      confidence: 0.9,
      reason: "相交",
    }));
    expect(correct).toMatchObject({ status: "matched", optionLabel: "正确复制两个相交的五边形（1分）", score: 1 });
    const incorrect = await judgeDrawing("mmse_30", question.options, DRAWING, async () => ({
      verdict: "incorrect",
      confidence: 0.9,
      reason: "不相交",
    }));
    expect(incorrect).toMatchObject({ status: "matched", optionLabel: "复制错误或未完成（0分）", score: 0 });
  });

  // 2026-11-12 回归：画图题属医护判定题，患者端可见选项为空；交卷判定若误用可见选项，
  // 不调用视觉模型就落「待医生确认计分」。锁定 service.ts 交卷链路取的 scoringOptionsOf 能映射到分值。
  it.each([
    ["minicog", "minicog_2", 2],
    ["mmse", "mmse_30", 1],
  ])("患者端时间线里的 %s 画图题：可见选项为空，判定选项仍能映射到分值", async (scaleId, questionId, score) => {
    const item = askableQuestions([scaleId]).find((candidate) => candidate.question.id === questionId);
    if (!item) throw new Error(`${questionId} 应在患者端时间线里`);
    expect(item.options).toEqual([]);

    const judge = vi.fn(async () => ({ verdict: "correct" as const, confidence: 0.9, reason: "画对了" }));
    const correct = await judgeDrawing(questionId, scoringOptionsOf(item), DRAWING, judge);
    expect(judge).toHaveBeenCalledTimes(1);
    expect(correct).toMatchObject({ status: "matched", score, method: "llm" });

    const incorrect = await judgeDrawing(questionId, scoringOptionsOf(item), DRAWING, async () => ({
      verdict: "incorrect",
      confidence: 0.9,
      reason: "画错了",
    }));
    expect(incorrect).toMatchObject({ status: "matched", score: 0 });
  });

  it("未接入判定器的画图题保持医生确认口径", async () => {
    const outcome = await judgeDrawing("unknown_drawing", clockOptions(), DRAWING);
    expect(outcome).toMatchObject({ status: "unclear", method: "none" });
  });
});

describe("extractJsonObject", () => {
  it("能从代码块或带说明文字的输出里取出 JSON 对象", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('观察结果如下：{"a":{"b":2}} 以上。')).toEqual({ a: { b: 2 } });
  });

  it("不是 JSON 对象返回 null", () => {
    expect(extractJsonObject("我认为画得不错")).toBeNull();
    expect(extractJsonObject("{坏的}")).toBeNull();
  });
});

describe("requestVisionJson：出网请求", () => {
  const saved = { ...process.env };
  const request = { systemPrompt: "系统提示", userText: "题意", imageDataUrls: [DRAWING] };
  const okResponse = () =>
    new Response(JSON.stringify({ choices: [{ message: { content: '{"hasOutline":true}' } }] }), { status: 200 });

  beforeEach(() => {
    // 模拟 .env.local 的写法：只配 DASHSCOPE_API_KEY，且等号后带空格
    process.env.DASHSCOPE_API_KEY = " test-key";
    delete process.env.VISION_API_KEY;
    delete process.env.VISION_MODEL;
    delete process.env.VISION_ARBITRATION_MODEL;
    delete process.env.VISION_API_BASE;
    delete process.env.VISION_EXTRA_BODY;
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("未配置密钥时不可用且不发请求", async () => {
    delete process.env.DASHSCOPE_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(visionAvailable()).toBe(false);
    expect(await requestVisionJson(request)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("默认走阿里百炼兼容入口，按多模态格式发图，且不带任何患者标识", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    expect(await requestVisionJson(request)).toEqual({ hasOutline: true });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    const body = JSON.parse(String(init.body)) as {
      model: string;
      enable_thinking?: boolean;
      messages: { role: string; content: unknown }[];
    };
    expect(body.model).toBe("qwen3-vl-plus");
    expect(body.enable_thinking).toBe(false);
    // 请求体只有这四个字段：没有 user 等任何患者标识
    expect(Object.keys(body).sort()).toEqual(["enable_thinking", "messages", "model", "temperature"]);
    const userContent = body.messages[1].content as { type: string; image_url?: { url: string } }[];
    expect(userContent.filter((part) => part.type === "image_url").map((part) => part.image_url?.url)).toEqual([
      DRAWING,
    ]);
  });

  it("换厂商时不附带百炼的扩展参数；VISION_API_KEY 与显式扩展参数优先", async () => {
    process.env.VISION_API_KEY = "other-key";
    process.env.VISION_API_BASE = "https://example.test/v1/";
    process.env.VISION_MODEL = "other-vision";
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await requestVisionJson(request);
    let [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.test/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer other-key");
    expect(Object.keys(JSON.parse(String(init.body)) as object).sort()).toEqual(["messages", "model", "temperature"]);

    process.env.VISION_EXTRA_BODY = '{"thinking":{"type":"disabled"}}';
    await requestVisionJson(request);
    [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect((JSON.parse(String(init.body)) as { thinking?: unknown }).thinking).toEqual({ type: "disabled" });
  });

  it("临界复核走复核模型：百炼默认 qwen3.8-max，可单独配置；换厂商未配置时沿用观察模型", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const modelOfCall = (index: number) =>
      (JSON.parse(String((fetchMock.mock.calls[index] as unknown as [string, RequestInit])[1].body)) as { model: string }).model;

    await requestVisionJson({ ...request, purpose: "arbitration" });
    expect(modelOfCall(0)).toBe("qwen3.8-max");

    process.env.VISION_ARBITRATION_MODEL = " qwen-custom ";
    await requestVisionJson({ ...request, purpose: "arbitration" });
    expect(modelOfCall(1)).toBe("qwen-custom");
    await requestVisionJson(request); // 首轮观察不受复核模型配置影响
    expect(modelOfCall(2)).toBe("qwen3-vl-plus");

    delete process.env.VISION_ARBITRATION_MODEL;
    process.env.VISION_API_BASE = "https://example.test/v1";
    process.env.VISION_MODEL = "other-vision";
    await requestVisionJson({ ...request, purpose: "arbitration" });
    expect(modelOfCall(3)).toBe("other-vision");
  });

  it("HTTP 失败、网络异常、输出不是 JSON 都返回 null（回落医生确认）", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));
    expect(await requestVisionJson(request)).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    expect(await requestVisionJson(request)).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "看不清" } }] }), { status: 200 }))
    );
    expect(await requestVisionJson(request)).toBeNull();
  });

  it("限流/服务端错误/网络中断自动重试 1 次；鉴权失败与超时不重试", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const flaky = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", flaky);
    expect(await requestVisionJson(request)).toEqual({ hasOutline: true });
    expect(flaky).toHaveBeenCalledTimes(2);

    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", offline);
    expect(await requestVisionJson(request)).toBeNull();
    expect(offline).toHaveBeenCalledTimes(2);

    const unauthorized = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", unauthorized);
    expect(await requestVisionJson(request)).toBeNull();
    expect(unauthorized).toHaveBeenCalledTimes(1);

    const timedOut = vi.fn(async () => {
      throw new DOMException("signal timed out", "TimeoutError");
    });
    vi.stubGlobal("fetch", timedOut);
    expect(await requestVisionJson(request)).toBeNull();
    expect(timedOut).toHaveBeenCalledTimes(1);
  });
});
