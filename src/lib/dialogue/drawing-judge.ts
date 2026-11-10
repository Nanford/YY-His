/**
 * INPUT:  画图题条目 id 与其标准选项（src/lib/rules 的 QuestionOption）、患者画作 data URL、
 *         视觉模型看图通道（src/lib/providers/vision.ts，可注入便于测试）
 * OUTPUT: validateDrawing —— 画作数据校验；judgeDrawing —— 画图题看图判定并映射回标准选项；
 *         parseClockObservation / clockVerdict —— 画钟观察结果的校验与确定性判定（纯函数）
 * POS:    画图题（2026-11-10 用户拍板）的判定编排，分两段：
 *         ① 视觉模型只做"观察"——如实报告图里有什么（轮廓、每个数字的实际方位、指针数），不评对错；
 *         ② 对错由本文件的确定性规则根据观察结果判定，再映射回 01 表既有选项（正确项=最高分选项、
 *            错误项=0 分选项），分值仍由评分引擎按选项计算（硬约束 2：模型不参与评分和判定）。
 *         为什么不让模型直接判对错：2026-11-10 实测让模型直接判时，会把"12 个数字全挤在右半边"
 *         的画钟说成"12 在上、3 在右…分布均匀"并判正确——模型按"钟表应有的样子"脑补。
 *         改为逐个数字报告实际方位、由规则判定，脑补空间小得多，且每一步都可追溯。
 *         拿不准、临界、未配置视觉模型、调用失败 → unclear，调用方落「待医生确认计分」（原 M9.6 口径），
 *         不强行给结论（硬约束 3）。明确结论直接计分进报告、医生事后可改判（用户拍板 2A）。
 */
import type { QuestionOption } from "@/lib/rules";
import { requestVisionJson, type VisionJsonRequest } from "@/lib/providers/vision";
import type { NormalizationOutcome } from "./normalize-rules";

/** 画作 data URL 长度上限（与提交接口 schema 一致） */
const MAX_DRAWING_DATA_URL_LENGTH = 800_000;
/** 模型自报置信度低于此值视为拿不准。画图题没有追问环节，门槛比文本判定（0.6）更严 */
const MIN_CONFIDENCE = 0.7;

/** 看图判定结论 */
export interface DrawingVerdict {
  verdict: "correct" | "incorrect" | "unclear";
  confidence: number;
  reason: string;
}

/** 一道画图题的看图判定器；返回 null = 视觉通道不可用 */
export type DrawingJudge = (imageDataUrl: string) => Promise<DrawingVerdict | null>;

/** 看图通道（可注入，测试用桩函数） */
type VisionRequester = (request: VisionJsonRequest) => Promise<Record<string, unknown> | null>;

// ---------- 画钟（minicog_2） ----------

/** 八方位（顺时针，从正上方起），以钟面中心为参照 */
const SECTORS = ["上", "右上", "右", "右下", "下", "左下", "左", "左上"] as const;
type Sector = (typeof SECTORS)[number];

const CLOCK_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
/** 四个基准数字：必须落在正方位上 */
const CARDINAL_NUMBERS: ReadonlySet<number> = new Set([12, 3, 6, 9]);

/** 视觉模型对画钟的观察结果（逐字段校验后的可信形状） */
export interface ClockObservation {
  /** 是否有大致闭合的钟面轮廓 */
  hasOutline: boolean;
  /** 图中辨认出的数字（按看到的列出，重复的重复出现）——用于发现漏写、重复、多余数字 */
  numbers: number[];
  /** 1～12 每个数字实际所在方位；没看到该数字为 null */
  sectors: Record<number, Sector | null>;
  /** 从钟面中心附近伸出的指针数量 */
  handCount: number;
  confidence: number;
  note: string;
}

const CLOCK_SYSTEM_PROMPT = [
  "你是画图题的图像观察助手。图片是一位老人在触摸屏上手绘的钟表。",
  "你的任务只是如实报告图中实际看到的内容，不评价对错。",
  "",
  "特别注意：必须逐个找到数字，按它在图中的实际位置填写方位，绝不能按正常钟表应有的样子推断。",
  "老人可能把数字全挤在一侧、逆时针写、整体转了个角度、漏写或重复写，遇到这些情况要如实报告。",
  "线条抖动、不够圆、字迹歪斜属正常，不影响报告。",
  "",
  "方位以钟面中心为参照：数字在中心正上方填「上」，正右方填「右」，正下方填「下」，正左方填「左」，",
  "介于两者之间填「右上」「右下」「左下」「左上」；图中没有这个数字填「未见」。",
  "",
  "只输出一个 JSON 对象，不要输出其他文字：",
  "{",
  '  "hasOutline": 是否有大致闭合的钟面轮廓（true/false）,',
  '  "numbers": 图中能辨认出的全部数字组成的整数数组（看到几个写几个，重复的重复写）,',
  '  "sectors": {"1": 方位, "2": 方位, "3": 方位, "4": 方位, "5": 方位, "6": 方位, "7": 方位, "8": 方位, "9": 方位, "10": 方位, "11": 方位, "12": 方位},',
  '  "handCount": 从钟面中心附近向外伸出的指针线条数量（整数）,',
  '  "confidence": 你对以上观察的把握（0到1）,',
  '  "note": "简短中文说明"',
  "}",
].join("\n");

/** 来源：01 表 minicog_2 题面 */
const CLOCK_USER_TEXT =
  "患者被要求：画一个钟表，把 1 到 12 这些数字标在正确的位置，再画上指针。请观察下图并按要求报告。";

function toSector(value: unknown): Sector | null {
  return typeof value === "string" && (SECTORS as readonly string[]).includes(value) ? (value as Sector) : null;
}

/** 模型有时把整数写成字符串（"12"）：两种写法都接受，其余一律不合法 */
function toInteger(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  if (typeof value === "string" && /^\d{1,3}$/.test(value.trim())) return Number(value.trim());
  return null;
}

/** 校验模型输出的观察结果；任何字段形状不符都返回 null（模型输出不可信，不合法即视为通道失败） */
export function parseClockObservation(raw: Record<string, unknown> | null): ClockObservation | null {
  if (!raw) return null;
  const { hasOutline, numbers, sectors, handCount, confidence, note } = raw;
  if (typeof hasOutline !== "boolean") return null;
  if (!Array.isArray(numbers)) return null;
  const parsedNumbers = numbers.map(toInteger);
  if (parsedNumbers.some((value) => value === null)) return null;
  if (typeof sectors !== "object" || sectors === null || Array.isArray(sectors)) return null;
  const parsedHandCount = toInteger(handCount);
  if (parsedHandCount === null) return null;
  if (typeof confidence !== "number" || confidence < 0 || confidence > 1) return null;

  const sectorMap = sectors as Record<string, unknown>;
  const parsedSectors: Record<number, Sector | null> = {};
  for (const number of CLOCK_NUMBERS) parsedSectors[number] = toSector(sectorMap[String(number)]);
  return {
    hasOutline,
    numbers: parsedNumbers as number[],
    sectors: parsedSectors,
    handCount: parsedHandCount,
    confidence,
    note: typeof note === "string" ? note : "",
  };
}

/**
 * 钟面数字 n 应在的方位：n 点方向与正上方夹角 n×30°，就近归入八方位（每格 45°）。
 * 即 12→上，1、2→右上，3→右，4、5→右下，6→下，7、8→左下，9→左，10、11→左上。
 */
function expectedSector(number: number): Sector {
  return SECTORS[Math.round(((number % 12) * 30) / 45) % SECTORS.length];
}

/** 两个方位在八方位环上相差几格（0=相同，1=相邻） */
function sectorDistance(a: Sector, b: Sector): number {
  const diff = Math.abs(SECTORS.indexOf(a) - SECTORS.indexOf(b));
  return Math.min(diff, SECTORS.length - diff);
}

/**
 * 画钟的确定性判定（纯函数）。
 * 标准（来源：01 表 minicog_2 题面与选项「画钟正确：数字位置正确，且指针显示规定时间」）：
 * 题面只要求"标上 1 到 12、画上时针分针秒针"，并未规定时间，选项里的"规定时间"无从对照——
 * 2026-11-10 用户拍板（3A）先按现有题面判：钟面完整、数字齐全且位置正确、画了指针即为正确，
 * 不评指针指向的具体时间；该矛盾待甲方确认，若改为指定时间需同步改这里与观察提示词。
 * 判定（方位偏差按八方位的格数计）：
 *   错误 —— 无闭合轮廓 / 1～12 不齐或有重复、多余数字 / 指针不足两根 /
 *           12、3、6、9 任一偏离正方位两格及以上 / 其余数字有两个及以上偏离两格及以上；
 *   临界（交医生）—— 12、3、6、9 偏一格（如 12 在"右上"）/ 其余数字仅一个偏离两格及以上 / 模型把握不足；
 *   正确 —— 以上全部通过（其余数字偏一格属手绘正常误差，如 1 写在"上"、2 写在"右"）。
 */
export function clockVerdict(observation: ClockObservation): DrawingVerdict {
  const { confidence } = observation;
  const incorrect = (reason: string): DrawingVerdict => ({ verdict: "incorrect", confidence, reason });
  const unclear = (reason: string): DrawingVerdict => ({ verdict: "unclear", confidence, reason });

  if (confidence < MIN_CONFIDENCE) return unclear(`模型对观察结果把握不足（${confidence}）`);
  if (!observation.hasOutline) return incorrect("没有闭合的钟面轮廓");

  const sorted = [...observation.numbers].sort((a, b) => a - b);
  const complete = sorted.length === 12 && sorted.every((value, index) => value === index + 1);
  if (!complete) return incorrect(`数字不齐或有重复（看到：${sorted.join("、") || "无"}）`);
  if (observation.handCount < 2) return incorrect(`指针不足两根（看到 ${observation.handCount} 根）`);

  const misplaced: string[] = [];
  const borderline: string[] = [];
  for (const number of CLOCK_NUMBERS) {
    const actual = observation.sectors[number];
    const expected = expectedSector(number);
    if (actual === null) return incorrect(`数字 ${number} 的位置无法确认`);
    const distance = sectorDistance(actual, expected);
    const description = `数字 ${number} 在「${actual}」（应在「${expected}」）`;
    if (CARDINAL_NUMBERS.has(number)) {
      if (distance >= 2) return incorrect(description);
      if (distance === 1) borderline.push(description);
    } else if (distance >= 2) {
      misplaced.push(description);
    }
  }
  if (misplaced.length >= 2) return incorrect(`数字位置不对：${misplaced.join("；")}`);
  if (misplaced.length === 1) borderline.push(misplaced[0]);
  if (borderline.length > 0) return unclear(`位置临界：${borderline.join("；")}`);

  return { verdict: "correct", confidence, reason: "钟面轮廓闭合，1～12 齐全且方位正确，画有指针" };
}

/** 画钟判定器：视觉模型观察 → 校验 → 确定性判定 */
export function createClockJudge(request: VisionRequester = requestVisionJson): DrawingJudge {
  return async (imageDataUrl) => {
    const observation = parseClockObservation(
      await request({
        systemPrompt: CLOCK_SYSTEM_PROMPT,
        userText: CLOCK_USER_TEXT,
        imageDataUrls: [imageDataUrl],
      })
    );
    return observation ? clockVerdict(observation) : null;
  };
}

// ---------- 通用编排 ----------

/** 已接入看图判定的画图题；未列出的画图题保持"待医生确认计分" */
const DRAWING_JUDGES: ReadonlyMap<string, DrawingJudge> = new Map([["minicog_2", createClockJudge()]]);

/** 画作数据校验失败的原因（调用方映射为业务冲突错误）；通过返回 null */
export function validateDrawing(drawingDataUrl: string | undefined): string | null {
  if (!drawingDataUrl || !drawingDataUrl.startsWith("data:image/")) return "画作数据无效";
  if (drawingDataUrl.length > MAX_DRAWING_DATA_URL_LENGTH) return "画作数据过大，请简化后重试";
  return null;
}

/** 画图题的正确项（最高分选项）与错误项（0 分选项）；选项形态不符时返回 null */
function polarDrawingOptions(
  options: readonly QuestionOption[]
): { correct: QuestionOption; incorrect: QuestionOption } | null {
  const incorrect = options.find((option) => option.score === 0);
  const correct = [...options].sort((a, b) => b.score - a.score)[0];
  if (!incorrect || !correct || correct.score <= 0) return null;
  return { correct, incorrect };
}

const PENDING_REASON = "患者已提交画作，待医生确认计分";

/**
 * 画图题看图判定。
 * @param judge 该题的判定器，默认按题目 id 取已接入的判定器；测试注入桩函数
 * @returns matched = 已得出对/错并映射到标准选项；unclear = 交医生确认
 */
export async function judgeDrawing(
  questionId: string,
  options: readonly QuestionOption[],
  drawingDataUrl: string,
  judge: DrawingJudge | undefined = DRAWING_JUDGES.get(questionId)
): Promise<NormalizationOutcome> {
  const polar = polarDrawingOptions(options);
  // 未接入判定器或选项形态不符的画图题：不看图，保持医生确认口径
  if (!judge || !polar) return { status: "unclear", method: "none", reason: PENDING_REASON };

  const verdict = await judge(drawingDataUrl);
  if (!verdict) {
    return { status: "unclear", method: "none", reason: `${PENDING_REASON}（视觉模型不可用）` };
  }
  if (verdict.verdict === "unclear") {
    return { status: "unclear", method: "llm", reason: `看图无法确定，待医生确认计分：${verdict.reason}` };
  }
  const option = verdict.verdict === "correct" ? polar.correct : polar.incorrect;
  return {
    status: "matched",
    optionLabel: option.label,
    score: option.score,
    method: "llm",
    confidence: verdict.confidence,
    reason: `看图判定：${verdict.reason}`,
  };
}
