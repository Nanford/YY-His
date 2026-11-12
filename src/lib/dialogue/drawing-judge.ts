/**
 * INPUT:  画图题条目 id 与其标准选项（src/lib/rules 的 QuestionOption）、患者画作 data URL、
 *         视觉模型看图通道（src/lib/providers/vision.ts，可注入便于测试）
 * OUTPUT: validateDrawing —— 画作数据校验；judgeDrawing —— 画图题看图判定并映射回标准选项；
 *         hasDrawingJudge —— 该题是否已接入看图判定；
 *         parseClockObservation / clockVerdict —— 画钟观察结果的校验与确定性判定（纯函数）；
 *         parsePentagonObservation / pentagonVerdict —— 五边形临摹（MMSE mmse_30）的同类纯函数；
 *         parseArbitration —— 临界复核输出的校验（纯函数）
 * POS:    画图题（2026-11-10 用户拍板）的判定编排，分两段：
 *         ① 视觉模型只做"观察"——如实报告图里有什么（轮廓、每个数字的实际方位、指针数），不评对错；
 *         ② 对错由本文件的确定性规则根据观察结果判定，再映射回 01 表既有选项（正确项=最高分选项、
 *            错误项=0 分选项），分值仍由评分引擎按选项计算（硬约束 2：模型不参与评分和判定）。
 *         为什么不让模型直接判对错：2026-11-10 实测让模型直接判时，会把"12 个数字全挤在右半边"
 *         的画钟说成"12 在上、3 在右…分布均匀"并判正确——模型按"钟表应有的样子"脑补。
 *         改为逐个数字报告实际方位、由规则判定，脑补空间小得多，且每一步都可追溯。
 *         明确结论直接计分进报告、医生事后可改判（用户拍板 2A）。
 *         2026-11-11：MMSE 五边形临摹（mmse_30）接入同一套两段式判定；画钟维持原口径（见 clockVerdict）。
 *         2026-11-11 用户拍板（方案 A，画图不再等医生确认）：规则判为临界/模型把握不足时，追加一次
 *         「临界复核」——带上判定标准与拿不准的地方，请更强的复核模型（默认 qwen3.8-max，见 vision.ts）
 *         再看一遍，直接给出合格/不合格并计分，
 *         理由标「临界复核」供医生事后核对改判。这是硬约束 2/3 在画图题上的例外：明确的情况仍由规则判，
 *         只有规则拿不准的才由模型定。
 *         2026-11-12 用户拍板（选项 A，画图题一律 AI 评分）：复核走「复核链」——复核模型失败或输出不合法时
 *         换首轮观察模型按同一标准再复核一次；首轮观察本身失败（调用失败/输出不合法）时不再直接交医生，
 *         改由复核链对照判定标准完整判一次。整条链共用 JUDGE_BUDGET_MS 截止时刻，患者最多等的时长与改动前相同。
 *         视觉模型未配置、或复核链全部失败 → 仍落「待评分」（没有模型结论不编分，硬约束 3），
 *         医生可在追溯页点「AI 重新评分」用存档画作重跑（src/lib/assessment/drawing-rejudge.ts）。
 */
import type { QuestionOption } from "@/lib/rules";
import { requestVisionJson, type VisionJsonRequest } from "@/lib/providers/vision";
import type { NormalizationOutcome } from "./normalize-rules";

/** 画作 data URL 长度上限（与提交接口 schema 一致） */
const MAX_DRAWING_DATA_URL_LENGTH = 800_000;
/** 模型自报置信度低于此值视为拿不准。画图题没有追问环节，门槛比文本判定（0.6）更严 */
const MIN_CONFIDENCE = 0.7;
/**
 * 一道画图题整条判定链（首轮观察、瞬时重试、复核与备用模型）共用 60 秒预算，
 * 防止多次 30 秒调用串行累加，延长患者交卷等待时间。
 */
const JUDGE_BUDGET_MS = 60_000;

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

// ---------- 临界复核（各题共用） ----------

/** 临界复核的输出格式说明（拼在各题复核提示词末尾） */
const ARBITRATION_OUTPUT_LINES = [
  "只输出一个 JSON 对象，不要输出其他文字：",
  "{",
  '  "pass": 合格写 true，不合格写 false,',
  '  "confidence": 你对这个结论的把握（0到1）,',
  '  "reason": "简短中文理由，指出决定结论的地方"',
  "}",
] as const;

/** 临界复核结论（逐字段校验后的可信形状） */
export interface ArbitrationResult {
  pass: boolean;
  confidence: number;
  reason: string;
}

/** 校验临界复核的模型输出；形状不符返回 null（视为复核失败，保留首轮的拿不准） */
export function parseArbitration(raw: Record<string, unknown> | null): ArbitrationResult | null {
  if (!raw) return null;
  const { pass, confidence, reason } = raw;
  if (typeof pass !== "boolean") return null;
  if (typeof confidence !== "number" || confidence < 0 || confidence > 1) return null;
  return { pass, confidence, reason: typeof reason === "string" ? reason.trim() : "" };
}

/** 按复核重点发一次复核请求；purpose 选模型（arbitration = 复核模型，observation = 首轮观察模型） */
type ArbitrationRequester = (
  focus: string,
  purpose: "arbitration" | "observation"
) => Promise<Record<string, unknown> | null>;

/**
 * 复核链（2026-11-12 方案 A）：优先调用复核模型，失败或输出不合法时换首轮模型按同一标准复核。
 * 备用模型的判定准确率与主复核模型不同，因此理由标注「备用模型」，保留供医生核对改判的依据。
 * @returns 两个模型都没给出合法结论时返回 null
 */
async function arbitrate(
  focus: string,
  requestArbitration: ArbitrationRequester
): Promise<{ result: ArbitrationResult; backup: boolean } | null> {
  for (const purpose of ["arbitration", "observation"] as const) {
    const result = parseArbitration(await requestArbitration(focus, purpose));
    if (result) return { result, backup: purpose === "observation" };
  }
  return null;
}

/** 复核结论 → 判定结论；不设置信度门槛（用户口径是画图不再等医生），置信度随结论落库供医生核对 */
function arbitratedVerdict(
  settled: { result: ArbitrationResult; backup: boolean },
  stage: string,
  context: string
): DrawingVerdict {
  const { result, backup } = settled;
  return {
    verdict: result.pass ? "correct" : "incorrect",
    confidence: result.confidence,
    reason: `${stage}${backup ? "（备用模型）" : ""}${result.pass ? "合格" : "不合格"}：${result.reason || "（模型未给理由）"}（${context}）`,
  };
}

/**
 * 首轮规则判为临界时做临界复核（2026-11-11 用户拍板方案 A），明确的结论原样返回。
 * 复核链全部失败 → 返回首轮的 unclear（judgeDrawing 落「待评分」）。
 * @param firstConfidence 首轮观察的置信度：把握不足时请模型逐项完整核对，否则只看拿不准的那一处
 */
async function settleBorderline(
  verdict: DrawingVerdict,
  firstConfidence: number,
  requestArbitration: ArbitrationRequester
): Promise<DrawingVerdict> {
  if (verdict.verdict !== "unclear") return verdict;
  const focus =
    firstConfidence < MIN_CONFIDENCE ? "第一轮看图把握不足，请按标准逐项完整核对" : verdict.reason;
  const settled = await arbitrate(focus, requestArbitration);
  return settled ? arbitratedVerdict(settled, "临界复核", `首轮拿不准：${verdict.reason}`) : verdict;
}

/**
 * 首轮观察失败（调用失败或输出不合法）时，改由复核链对照判定标准完整判一次（2026-11-12 用户拍板选项 A）。
 * 视觉模型未配置时复核链同样拿不到结果，返回 null（judgeDrawing 落「待评分」）。
 */
async function settleWithoutObservation(requestArbitration: ArbitrationRequester): Promise<DrawingVerdict | null> {
  const settled = await arbitrate("第一轮看图没有得出结果，请按标准逐项完整核对", requestArbitration);
  return settled ? arbitratedVerdict(settled, "完整复核", "首轮看图未得出结果") : null;
}

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
 * 2026-11-11 用户再次确认维持原口径（规定时间以后可能改为随机给出，届时再加判指针指向）。
 * 判定（方位偏差按八方位的格数计）：
 *   错误 —— 无闭合轮廓 / 1～12 不齐或有重复、多余数字 / 指针不足两根 /
 *           12、3、6、9 任一偏离正方位两格及以上 / 其余数字有两个及以上偏离两格及以上；
 *   临界（交临界复核）—— 12、3、6、9 偏一格（如 12 在"右上"）/ 其余数字仅一个偏离两格及以上 / 模型把握不足；
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

/*
 * 画钟临界复核的判定标准：与 clockVerdict 同一口径（不评指针时间），把规则里"临界"的那条线
 * （正常手绘误差 vs 位置不对）交给模型对着原图再判一次。
 */
const CLOCK_ARBITRATION_PROMPT = [
  "你是画图题的复核员。图片是一位老人在触摸屏上手绘的钟表。第一轮看图在个别地方拿不准，",
  "请你按下面的标准，对照图中实际画的内容，给出合格或不合格的结论。",
  "",
  "合格必须同时满足：",
  "1. 有大致闭合的钟面轮廓；",
  "2. 1 到 12 都写了，没有漏写、重复或多余的数字；",
  "3. 数字按顺时针排列，12、3、6、9 分别大致在钟面的正上、正右、正下、正左，其余数字在各自应在的位置附近；",
  "4. 至少画了两根从钟面中心附近伸出的指针（不评价指针指向几点）。",
  "线条抖动、不够圆、字迹歪斜、数字间距略不均匀属正常手绘误差，不算不合格；",
  "数字整体挤在一侧、逆时针排列、整体转了一个角度，都属于不合格。",
  "",
  "必须按图中实际看到的判断，绝不能按正常钟表应有的样子推断。",
  "",
  ...ARBITRATION_OUTPUT_LINES,
].join("\n");

/** 画钟判定器：视觉模型观察 → 校验 → 确定性判定；规则拿不准时临界复核，首轮失败时由复核链完整判定 */
export function createClockJudge(request: VisionRequester = requestVisionJson): DrawingJudge {
  return async (imageDataUrl) => {
    const deadline = Date.now() + JUDGE_BUDGET_MS;
    const requestArbitration: ArbitrationRequester = (focus, purpose) =>
      request({
        systemPrompt: CLOCK_ARBITRATION_PROMPT,
        userText: `${CLOCK_USER_TEXT}\n复核重点：${focus}`,
        imageDataUrls: [imageDataUrl],
        purpose,
        deadline,
      });
    const observation = parseClockObservation(
      await request({
        systemPrompt: CLOCK_SYSTEM_PROMPT,
        userText: CLOCK_USER_TEXT,
        imageDataUrls: [imageDataUrl],
        deadline,
      })
    );
    if (!observation) return settleWithoutObservation(requestArbitration);
    return settleBorderline(clockVerdict(observation), observation.confidence, requestArbitration);
  };
}

// ---------- 五边形临摹（mmse_30） ----------

/** 视觉模型对临摹图形的观察结果（逐字段校验后的可信形状） */
export interface PentagonObservation {
  /** 画了的每个独立图形：实际的角（顶点）数、是否基本闭合 */
  shapes: { corners: number; closed: boolean }[];
  /** 两个图形是否有交叠（边互相穿过） */
  overlapping: boolean;
  /** 两个图形交叠部分本身的角数；不交叠为 null */
  overlapCorners: number | null;
  confidence: number;
  note: string;
}

/*
 * 观察提示词不出现"五边形""四边形"等应有答案，防模型顺着说（早先版本写了"交叠部分可能不是四个角"，
 * 实测模型报交叠区角数几乎全是 4）。2026-11-11 用合成图实测过两种问法（qwen3-vl-plus，12 张）：
 * 直接报角数、逐点列顶点坐标，都是 10/12，错的都是把画对的看错——参照图里尖角插进另一个图形的那个角被漏数、
 * 坐标点不准。逐点列坐标更慢（约 7 秒/次 vs 约 4 秒）且不更准，故用直接报角数，判定从严兜底（见 pentagonVerdict）。
 */
const PENTAGON_SYSTEM_PROMPT = [
  "你是画图题的图像观察助手。图片是一位老人在触摸屏上照着示例图临摹的线条图形。",
  "你的任务只是如实报告图中实际画了什么，不评价对错，也绝不能按示例应有的样子推断。",
  "",
  "数角的方法：分别沿着每个图形自己的线条完整走一圈，数线条明显转向、形成角的地方。",
  "两个图形交叠时，伸进另一个图形里面的那段线条和那里的角同样属于它自己，必须一并数上，",
  "不能因为和另一个图形的线交叉就漏数，也不能把两个图形的线条接起来当成一个图形。",
  "线条抖动、边不够直属正常：小的抖动和毛刺不算角；圆和弧线没有角。起笔和收笔之间的小缺口算闭合。",
  "",
  "交叠部分：如果两个图形的边互相穿过、有一块区域同时在两个图形里面，沿这块区域的边界走一圈，数它本身有几个角。",
  "",
  "只输出一个 JSON 对象，不要输出其他文字：",
  "{",
  '  "shapes": [{"corners": 这个图形的角数（整数，圆或无法辨认的曲线写 0）, "closed": 是否基本闭合（true/false）}, ...（画了几个图形写几项）],',
  '  "overlapping": 两个图形是否有交叠（true/false；不足两个图形写 false）,',
  '  "overlapCorners": 交叠区域的角数（整数；不交叠写 null）,',
  '  "confidence": 你对以上观察的把握（0到1）,',
  '  "note": "简短中文说明"',
  "}",
].join("\n");

/** 来源：01 表 mmse_30 题面（示例图不发给模型，避免模型按示例脑补） */
const PENTAGON_USER_TEXT = "患者被要求：照着屏幕上的示例图，在白板上画一个一样的图形。请观察下图并按要求报告。";

function toShape(value: unknown): { corners: number; closed: boolean } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { corners, closed } = value as Record<string, unknown>;
  const parsedCorners = toInteger(corners);
  if (parsedCorners === null || typeof closed !== "boolean") return null;
  return { corners: parsedCorners, closed };
}

/** 校验模型输出的观察结果；任何字段形状不符都返回 null（视为通道失败） */
export function parsePentagonObservation(raw: Record<string, unknown> | null): PentagonObservation | null {
  if (!raw) return null;
  const { shapes, overlapping, overlapCorners, confidence, note } = raw;
  if (!Array.isArray(shapes)) return null;
  const parsedShapes = shapes.map(toShape);
  if (parsedShapes.some((shape) => shape === null)) return null;
  if (typeof overlapping !== "boolean") return null;
  const parsedOverlap = overlapCorners === null ? null : toInteger(overlapCorners);
  if (overlapCorners !== null && parsedOverlap === null) return null;
  if (typeof confidence !== "number" || confidence < 0 || confidence > 1) return null;
  return {
    shapes: parsedShapes as { corners: number; closed: boolean }[],
    overlapping,
    overlapCorners: parsedOverlap,
    confidence,
    note: typeof note === "string" ? note : "",
  };
}

/** 来源：国标 WS/T 484—2015 表 C.1 注 8（两个五边形） */
const PENTAGON_CORNERS = 5;
/** 来源：同上（交叉处形成 1 个小四边形） */
const OVERLAP_CORNERS = 4;

/**
 * 五边形临摹的确定性判定（纯函数）。
 * 标准（来源：国标 WS/T 484—2015 表 C.1 注 8「只有绘出两个五边形的图案，交叉处形成 1 个小四边形，
 * 才算对」，与 01 表 mmse_30 选项「正确复制两个相交的五边形」一致）：
 *   错误 —— 图形不是两个 / 有图形没闭合 / 角数明显不对（两个都不是 5 个角，或有一个差 2 个及以上）/ 两个图形不交叠；
 *   临界（交临界复核）—— 模型把握不足 / 交叠时只有一个图形差 1 个角 / 交叠区域看不清或看成不是四个角；
 *   正确 —— 两个闭合的五边形交叠，交叠处是四边形。
 * 从严的理由（2026-11-11 合成图实测，见观察提示词处注释）：模型出错集中在把画对的看错——交叠处被另一个图形
 * 挡住的角漏数（报成 5、4）、交叠区角数说不准；这类"差一点"不由规则直接判，交临界复核再看一遍，
 * 避免规则把画对的直接判成 0 分。
 */
export function pentagonVerdict(observation: PentagonObservation): DrawingVerdict {
  const { confidence, shapes } = observation;
  const incorrect = (reason: string): DrawingVerdict => ({ verdict: "incorrect", confidence, reason });
  const unclear = (reason: string): DrawingVerdict => ({ verdict: "unclear", confidence, reason });

  if (confidence < MIN_CONFIDENCE) return unclear(`模型对观察结果把握不足（${confidence}）`);
  if (shapes.length !== 2) return incorrect(`画了 ${shapes.length} 个图形（应为两个相交的五边形）`);
  if (shapes.some((shape) => !shape.closed)) return incorrect("有图形没有闭合");

  const corners = shapes.map((shape) => shape.corners);
  const cornerGaps = corners.map((count) => Math.abs(count - PENTAGON_CORNERS));
  const cornerText = `两个图形的角数为 ${corners.join("、")}`;
  if (cornerGaps.every((gap) => gap > 0) || cornerGaps.some((gap) => gap >= 2)) {
    return incorrect(`${cornerText}（应均为 5）`);
  }
  if (!observation.overlapping) return incorrect("两个图形没有交叠");
  if (cornerGaps.some((gap) => gap === 1)) {
    return unclear(`${cornerText}，与五边形只差一个角，可能是交叠处被挡住的角漏数了`);
  }
  if (observation.overlapCorners === null) return unclear("两个五边形有交叠，但交叠区域的形状看不清");
  if (observation.overlapCorners !== OVERLAP_CORNERS) {
    return unclear(`交叠处看成 ${observation.overlapCorners} 个角的图形（应为四边形）`);
  }
  return { verdict: "correct", confidence, reason: "两个闭合的五边形相交，交叉处形成四边形" };
}

/*
 * 五边形临摹的临界复核标准：复核要判对错，只能把国标注 8 的标准原文告诉模型（观察阶段刻意不提"五边形"）。
 * 示例图不发：2026-11-11 实测（参照图渲染成 PNG 先发、画作后发，qwen3-vl-plus，4 张临界图）附了示例图
 * 结论一张没变——照参照图画对的临摹仍被看成"五边形 + 矩形"判不合格；真正起作用的是换复核模型
 * （qwen3.8-max，见 vision.ts 的 DEFAULT_ARBITRATION_MODEL）。不发也免得给模型"看着像就合格"的捷径。
 */
const PENTAGON_ARBITRATION_PROMPT = [
  "你是画图题的复核员。图片是一位老人在触摸屏上照着示例图临摹的线条图形。第一轮看图在个别地方拿不准，",
  "请你按下面的标准，对照图中实际画的内容，给出合格或不合格的结论。",
  "",
  "合格必须同时满足（来源：国家卫生行业标准 WS/T 484—2015 表 C.1 注 8）：",
  "1. 画了两个各自闭合的图形，每个都是五边形（有五个角）；",
  "2. 两个图形互相交叉，交叉处形成一个四边形（有四个角的小区域）。",
  "",
  "数角时沿着每个图形自己的线条完整走一圈：伸进另一个图形里面的那段线条和那里的角同样属于它自己，必须数上。",
  "线条抖动、边不够直、起笔和收笔之间的小缺口属正常手绘误差。",
  "必须按图中实际看到的判断，不能因为整体看着差不多就判合格。",
  "",
  ...ARBITRATION_OUTPUT_LINES,
].join("\n");

/**
 * 五边形临摹判定器：只发患者画作（不发示例图），观察 → 校验 → 确定性判定；
 * 规则拿不准时临界复核，首轮失败时由复核链完整判定
 */
export function createPentagonJudge(request: VisionRequester = requestVisionJson): DrawingJudge {
  return async (imageDataUrl) => {
    const deadline = Date.now() + JUDGE_BUDGET_MS;
    const requestArbitration: ArbitrationRequester = (focus, purpose) =>
      request({
        systemPrompt: PENTAGON_ARBITRATION_PROMPT,
        userText: `${PENTAGON_USER_TEXT}\n复核重点：${focus}`,
        imageDataUrls: [imageDataUrl],
        purpose,
        deadline,
      });
    const observation = parsePentagonObservation(
      await request({
        systemPrompt: PENTAGON_SYSTEM_PROMPT,
        userText: PENTAGON_USER_TEXT,
        imageDataUrls: [imageDataUrl],
        deadline,
      })
    );
    if (!observation) return settleWithoutObservation(requestArbitration);
    return settleBorderline(pentagonVerdict(observation), observation.confidence, requestArbitration);
  };
}

// ---------- 通用编排 ----------

/** 已接入看图判定的画图题；未列出的画图题保持"待医生确认计分" */
const DRAWING_JUDGES: ReadonlyMap<string, DrawingJudge> = new Map([
  ["minicog_2", createClockJudge()],
  ["mmse_30", createPentagonJudge()],
]);

/** 该题是否已接入看图判定（追溯页「AI 重新评分」只对这些题开放） */
export function hasDrawingJudge(questionId: string): boolean {
  return DRAWING_JUDGES.has(questionId);
}

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
/** 视觉模型没给出结论时的提示：画图题一律 AI 评分（2026-11-12），指向重跑入口而不是等医生 */
const RETRY_HINT = "可在医生端追溯页点「AI 重新评分」重试";

/**
 * 画图题看图判定。
 * @param judge 该题的判定器，默认按题目 id 取已接入的判定器；测试注入桩函数
 * @returns matched = 已得出对/错（含临界复核、复核链给出的）并映射到标准选项；
 *          unclear = 视觉模型未配置或复核链全部失败，落「待评分」等重跑
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
    return {
      status: "unclear",
      method: "none",
      reason: `AI 看图未得出结论（视觉模型未配置，或首轮与复核调用均失败），${RETRY_HINT}`,
    };
  }
  if (verdict.verdict === "unclear") {
    // 走到这里说明首轮拿不准、复核模型与备用模型也都没给出合法结论（通道失败/输出不合法）
    return {
      status: "unclear",
      method: "llm",
      reason: `AI 看图未得出结论（临界复核未给出结论），${RETRY_HINT}；首轮拿不准：${verdict.reason}`,
    };
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
