/**
 * INPUT:  自由回答题配置（cognitive-flow.FREE_ANSWER_ITEMS）、患者原始回答、当前时间
 * OUTPUT: judgeByRules / matchWordsByRules —— 无 DeepSeek 密钥时的确定性规则兜底判定
 * POS:    认知题自由回答的兜底通道（对应 normalize-rules.ts 之于归一化）。
 *         原则与归一化一致：拿不准一律 unclear（走追问→待确认→待人工确认），
 *         绝不强行编造结论（AGENTS.md 硬约束 3）；LLM 通道的结论规则不复核。
 */
import type { FreeAnswerSpec, MmseLocation } from "./cognitive-flow";
import { MMSE_LOCATION } from "./cognitive-flow";

export type RuleVerdict = "correct" | "incorrect" | "unclear";

const CN_DIGIT_VALUES: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const CN_DIGIT_CHARS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 提取回答中的第一个数字（阿拉伯数字优先，其次中文数字：九十三=93、一百=100、二零二六=2026） */
export function extractFirstNumber(text: string): number | null {
  const arabic = text.match(/\d+/);
  if (arabic) return Number(arabic[0]);
  const run = text.match(/[零一二两三四五六七八九十百千]+/);
  if (!run) return null;
  return parseChineseNumber(run[0]);
}

function parseChineseNumber(s: string): number | null {
  if (!s) return null;
  if (!/[十百千]/.test(s)) {
    // 逐位序列（年份读法：二零二六 → 2026）
    let out = "";
    for (const ch of s) {
      const digit = CN_DIGIT_VALUES[ch];
      if (digit === undefined) return null;
      out += String(digit);
    }
    return Number(out);
  }
  // 十/百/千 组合读法（九十三 → 93）
  let total = 0;
  let section = 0;
  for (const ch of s) {
    const digit = CN_DIGIT_VALUES[ch];
    if (digit !== undefined) {
      section = digit;
    } else if (ch === "十") {
      total += (section || 1) * 10;
      section = 0;
    } else if (ch === "百") {
      total += (section || 1) * 100;
      section = 0;
    } else if (ch === "千") {
      total += (section || 1) * 1000;
      section = 0;
    } else {
      return null;
    }
  }
  return total + section;
}

/** 当前季节（春 3-5 月 / 夏 6-8 / 秋 9-11 / 冬 12-2） */
function seasonOf(date: Date): string {
  const month = date.getMonth() + 1;
  if (month >= 3 && month <= 5) return "春";
  if (month >= 6 && month <= 8) return "夏";
  if (month >= 9 && month <= 11) return "秋";
  return "冬";
}

function normalizeText(s: string): string {
  return s.replace(/[\s，。,.、？?!！~～]/g, "");
}

/** 时间定向题判定：能提取到对应字段才下结论（对/错），提取不到 → unclear */
function judgeDatePart(part: "year" | "season" | "month" | "day" | "weekday", utterance: string, now: Date): RuleVerdict {
  const text = normalizeText(utterance);
  if (part === "year") {
    const year = now.getFullYear();
    const cnYear = String(year).split("").map((d) => CN_DIGIT_CHARS[Number(d)]).join("");
    if (text.includes(String(year)) || text.includes(cnYear)) return "correct";
    const mentioned = extractFirstNumber(text);
    return mentioned !== null && String(mentioned).length === 4 ? "incorrect" : "unclear";
  }
  if (part === "season") {
    const match = text.match(/[春夏秋冬]/);
    if (!match) return "unclear";
    return match[0] === seasonOf(now) ? "correct" : "incorrect";
  }
  if (part === "month") {
    const match = text.match(/(\d{1,2}|[一二两三四五六七八九十]+)月/);
    if (!match) return "unclear";
    const value = extractFirstNumber(match[1]);
    if (value === null) return "unclear";
    return value === now.getMonth() + 1 ? "correct" : "incorrect";
  }
  if (part === "day") {
    const match = text.match(/(\d{1,2}|[一二两三四五六七八九十]+)[日号]/);
    if (!match) return "unclear";
    const value = extractFirstNumber(match[1]);
    if (value === null) return "unclear";
    // MMSE 惯例：日期允许 ±1 天
    return Math.abs(value - now.getDate()) <= 1 ? "correct" : "incorrect";
  }
  // weekday
  const match = text.match(/(?:星期|礼拜)([一二三四五六天日])/);
  if (!match) return "unclear";
  const map: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  return map[match[1]] === now.getDay() ? "correct" : "incorrect";
}

/** 地点定向题判定：命中配置位置（允许去掉省/市/楼等后缀的核心词）判对；否则保守 unclear 走追问 */
function judgePlace(part: keyof MmseLocation, utterance: string): RuleVerdict {
  const expected = normalizeText(mmseLocationValue(part));
  if (!expected) return "unclear";
  const text = normalizeText(utterance);
  if (text.includes(expected)) return "correct";
  const core = expected.replace(/(省|市|区|县|楼|层|科|病区|医院|院)$/g, "");
  if (core.length >= 2 && text.includes(core)) return "correct";
  return "unclear";
}

function mmseLocationValue(part: keyof MmseLocation): string {
  return MMSE_LOCATION[part];
}

/** 命名回答里的口头框架（"这是一块…吧"），剥掉后剩下的才是患者说出的名称 */
const NAMING_FILLERS =
  /(我觉得|我看|好像|应该|可能|大概|这个|那个|这是|那是|它是|就是|叫做|叫|是|一个|一块|一只|一支|一根|一把|个|块|只|支|根|把|吧|啊|呀|嘛|呢|的|了|哦|吗)/g;

const CANNOT_NAME = /(不知道|不认识|不清楚|说不上来|说不出|叫不出|不晓得|想不起)/;

/**
 * 看图识物判定（MMSE 命名题）：
 * - 说出标准名称或同义说法 → 对。两个字以上的说法子串命中即可（"这是手表吧"）；
 *   单字说法（"表"）须剥掉口头框架后整句就是这个字，避免"表示""代表"之类误命中；
 * - "不是手表"这类否定 → unclear（交追问，不硬判）；
 * - 说成别的东西（nearMisses）或明确说认不出 → 错（MMSE：其他答案或不能回答计 0 分）；
 * - 其余拿不准 → unclear。
 */
function judgeNaming(spec: Extract<FreeAnswerSpec, { kind: "naming" }>, text: string): RuleVerdict {
  const accepted = [spec.target, ...spec.synonyms];
  if (accepted.some((name) => text.includes(`不是${name}`))) return "unclear";
  if (accepted.some((name) => name.length >= 2 && text.includes(name))) return "correct";
  if (accepted.includes(text.replace(NAMING_FILLERS, ""))) return "correct";
  if (spec.nearMisses.some((name) => text.includes(name))) return "incorrect";
  if (CANNOT_NAME.test(text)) return "incorrect";
  return "unclear";
}

/**
 * 自由回答题规则兜底判定（DeepSeek 通道失败时启用）：
 * - exactNumber：提取到数字即比对（说错数字是有效错误回答，判 incorrect）；
 * - verbatim：完整包含目标句判对；长度足够但不含判错；明显没说完判 unclear；
 * - datePart/place/naming：如上。
 */
export function judgeByRules(spec: FreeAnswerSpec, utterance: string, now: Date = new Date()): RuleVerdict {
  const text = normalizeText(utterance);
  if (!text) return "unclear";
  switch (spec.kind) {
    case "exactNumber": {
      const value = extractFirstNumber(text);
      if (value === null) return "unclear";
      return value === spec.expected ? "correct" : "incorrect";
    }
    case "verbatim": {
      const target = normalizeText(spec.target);
      if (text.includes(target)) return "correct";
      return text.length >= target.length ? "incorrect" : "unclear";
    }
    case "datePart":
      return judgeDatePart(spec.part, utterance, now);
    case "place":
      return judgePlace(spec.part, utterance);
    case "naming":
      return judgeNaming(spec, text);
    case "wordCount":
      // 词计数走 matchWordsByRules（本函数不处理）
      return "unclear";
  }
}

/**
 * 词复述规则兜底：返回患者复述中命中的目标词（子串匹配）。
 * 患者明确表示"不知道/不记得/忘了"→ 命中空集（0 个词是有效回答，MMSE/minicog 均计 0 分）；
 * 无法判断（答非所问/要求重复）→ null（unclear，走追问流程）。
 */
export function matchWordsByRules(words: readonly string[], utterance: string): string[] | null {
  const text = normalizeText(utterance);
  if (!text) return null;
  if (/(没听清|再说一遍|你说什么|什么意思)/.test(text)) return null;
  const matched = words.filter((word) => text.includes(normalizeText(word)));
  if (matched.length > 0) return matched;
  if (/(不知道|不记得|记不清|忘了|想不起)/.test(text)) return [];
  return null;
}
