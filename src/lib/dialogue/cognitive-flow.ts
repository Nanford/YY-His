/**
 * INPUT:  src/lib/rules/v2 的 scalesV2（只读引用条目文本/选项，医学内容仍以 V2 源为唯一权威）
 * OUTPUT: INSTRUCTION_BROADCASTS / WORD_RECALL_GROUPS / FREE_ANSWER_ITEMS / MMSE_LOCATION / SCREEN_STIMULI
 *         及配套查询辅助（组目标判定、播报文案覆盖、词表/期望值解析、看图题图片与可问性）
 * POS:    认知评估（minicog / MMSE）特殊流程的声明式配置（2026-08-13 用户拍板）：
 *         1. 三词记忆先由数字医生播报（不需作答），再采集复述；
 *         2. 复述/定向/计算/原文复述题不向患者展示选项（答案不能出现在按钮上），
 *            患者自由回答，由 LLM（规则兜底）把回答映射回既有标准选项——
 *            评分引擎与选项数据零改动（AGENTS.md 硬约束 2：LLM 只做语言理解）。
 *         3. 看图识物（2026-11-11）：MMSE 命名题屏幕出图、患者说出名称，同样按自由回答题判定。
 *         词表/连减期望值/目标句均从 scales-v2.json 条目解析，加载时断言引用条目存在
 *         （仿 src/lib/assessment/patient-scale-packages.ts 的加载断言风格）。
 */
import { scalesV2, type ScaleItemV2 } from "@/lib/rules/v2";

// ---------- 基础工具 ----------

function itemOf(scaleId: string, itemId: string): ScaleItemV2 {
  const scale = scalesV2.find((s) => s.id === scaleId);
  const item = scale?.items.find((i) => i.id === itemId);
  if (!item) throw new Error(`cognitive-flow 配置引用了不存在的条目：${scaleId}/${itemId}`);
  return item;
}

/** 从"第一个词是：皮球"形态的指令文本解析目标词 */
function wordAfterColon(text: string): string {
  const match = text.match(/词是：\s*([^，。；\s]+)/);
  if (!match) throw new Error(`无法从记忆指令解析目标词：${text}`);
  return match[1];
}

/** 从 1 分选项 label（如「回答93（1分）」）解析期望数字 */
function expectedNumberOf(item: ScaleItemV2): number {
  const correct = item.options?.find((o) => o.score === 1);
  const match = correct?.label.match(/(\d+)/);
  if (!match) throw new Error(`无法从选项解析期望数字：${item.id}`);
  return Number(match[1]);
}

/** 从选项 label（如「完整准确复述"瑞雪兆丰年"（1分）」）解析目标句 */
function quotedTargetOf(item: ScaleItemV2): string {
  const correct = item.options?.find((o) => o.score === 1);
  const match = correct?.label.match(/[“"](.+?)[”"]/);
  if (!match) throw new Error(`无法从选项解析目标句：${item.id}`);
  return match[1];
}

/** 各条目 1 分选项（"正确"项）与 0 分选项（"错误"项），判定映射用 */
export function polarOptionsOf(itemId: string): { correct: string; incorrect: string } {
  const item = scalesV2.flatMap((s) => s.items).find((i) => i.id === itemId);
  const correct = item?.options?.find((o) => o.score === 1)?.label;
  const incorrect = item?.options?.find((o) => o.score === 0)?.label;
  if (!correct || !incorrect) throw new Error(`条目 ${itemId} 缺少 1/0 分极性选项`);
  return { correct, incorrect };
}

// ---------- 三词词表（从条目文本解析） ----------

/** MMSE 三词（皮球/国旗/树木），来源：mmse_11/12/13 条目文本 */
export const MMSE_WORDS: readonly string[] = ["mmse_11", "mmse_12", "mmse_13"].map((id) =>
  wordAfterColon(itemOf("mmse", id).text)
);

/** minicog 三词（苹果/钥匙/汽车），来源：minicog_1 条目文本"——苹果、钥匙、汽车。" */
export const MINICOG_WORDS: readonly string[] = (() => {
  const text = itemOf("minicog", "minicog_1").text;
  const match = text.match(/——(.+?)。?\s*$/);
  if (!match) throw new Error(`无法从 minicog_1 解析三词：${text}`);
  return match[1].split("、");
})();

// ---------- 指令播报（只播报、不需作答，复用旁白机制） ----------

/**
 * 记忆词/目标句指令的放慢语速（2026-09-04 修改意见 3：三个词播报太快）。
 * 豆包 TTS speech_rate 取值 [-50,100]（0=常速，全局默认 -10 ≈ 0.9 倍速，见 volc-tts.ts），
 * 指令播报再放慢到 -30，让老年患者听清每一个词。
 */
export const INSTRUCTION_SPEECH_RATE = -30;

export interface InstructionBroadcast {
  /** 虚拟旁白 id（system 轮次 questionId 用，前缀 instr_ 与 01 表旁白 narr_ 区分） */
  id: string;
  scaleId: string;
  /** 插入到该题之前 */
  beforeItemId: string;
  /** 播报文案（TTS 朗读，含记忆词/目标句） */
  text: string;
  /**
   * 屏幕展示文案（2026-09-04 修改意见 3：记忆词只播报、不上屏，否则患者照屏读答案）。
   * 加载断言保证 displayText 不含任何记忆词。
   */
  displayText: string;
  /** 播报语速（豆包 speech_rate，见 INSTRUCTION_SPEECH_RATE） */
  speechRate: number;
  /**
   * 是否计入题号进度（2026-09-12 用户口径）：minicog_1「记忆指令」是 01 表里量表的第 1 个
   * 条目（第 1 题记词 → 第 2 题画钟 → 第 3 题复述），患者端题号应把它算上；
   * MMSE 三词指令是 mmse_11~13 题组的一部分（非独立条目），不计。
   */
  countsAsProgress?: boolean;
}

export const INSTRUCTION_BROADCASTS: readonly InstructionBroadcast[] = [
  {
    // 来源：minicog_1（记忆指令，不计分）——三个词必须先播报，患者端此前整条被投影丢弃。
    // 文案按 2026-08-13 用户口径调整：本环节只播报不采集（立即复述不计分、不留口），
    // 故去掉原文中"请您马上把这三个词重复一遍"的应答要求；词表仍从 minicog_1 文本解析。
    id: "instr_minicog_words",
    scaleId: "minicog",
    beforeItemId: "minicog_2",
    text: `接下来我说三个词，请您听清楚并记住，过一会儿我还会再问您。——${MINICOG_WORDS.join("、")}。`,
    displayText: "接下来我说三个词，请您听清楚并记住，过一会儿我还会再问您。",
    speechRate: INSTRUCTION_SPEECH_RATE,
    countsAsProgress: true,
  },
  {
    // 来源：mmse_11/12/13 条目文本拼装——计算题开始前播报三个词并请患者记住
    id: "instr_mmse_words",
    scaleId: "mmse",
    beforeItemId: "mmse_11",
    text: [
      itemOf("mmse", "mmse_11").text,
      itemOf("mmse", "mmse_12").text,
      itemOf("mmse", "mmse_13").text,
      "请您记住这三个词，过一会儿我还会请您再说一遍。",
    ].join("。"),
    // 展示文案剥掉"第N个词是：X"句（2026-09-04 修改意见 3 同口径：记忆词不上屏）
    displayText:
      itemOf("mmse", "mmse_11").text.replace(/\s*第一个词是：.+$/, "") +
      "请您记住这三个词，过一会儿我还会请您再说一遍。",
    speechRate: INSTRUCTION_SPEECH_RATE,
  },
];

// 加载断言：指令播报的展示文案绝不能泄露记忆词（患者照屏读答案会使记忆测试失效）
for (const broadcast of INSTRUCTION_BROADCASTS) {
  const words = broadcast.scaleId === "minicog" ? MINICOG_WORDS : MMSE_WORDS;
  for (const word of words) {
    if (broadcast.displayText.includes(word)) {
      throw new Error(`指令播报 ${broadcast.id} 的展示文案泄露了记忆词「${word}」`);
    }
  }
}

/** 题目 id → 其前应插入的指令播报 */
export const instructionBeforeItem: ReadonlyMap<string, InstructionBroadcast> = new Map(
  INSTRUCTION_BROADCASTS.map((b) => [b.beforeItemId, b])
);

// ---------- 组回答（一次复述给多题记分） ----------

export interface WordRecallGroup {
  /** 患者端实际提问的条目 id（其余目标题不单独提问） */
  triggerItemId: string;
  /** 一次回答同时记分的全部条目 id */
  targetItemIds: readonly string[];
  words: readonly string[];
  /** 组提问文案（覆盖 trigger 题面播报/展示，不再逐词分问） */
  promptText: string;
}

export const WORD_RECALL_GROUPS: readonly WordRecallGroup[] = [
  {
    // MMSE 立即复述（mmse_11~13，共 3 分）：播报三词后立即复述，LLM 识别命中词逐一计分
    triggerItemId: "mmse_11",
    targetItemIds: ["mmse_11", "mmse_12", "mmse_13"],
    words: MMSE_WORDS,
    promptText: "请您把刚才说的三个词重复一遍，能说几个说几个。",
  },
  {
    // MMSE 延迟回忆（mmse_19~21）：题面取 mmse_19 去掉"请说出第1个词"的逐词分问尾巴
    triggerItemId: "mmse_19",
    targetItemIds: ["mmse_19", "mmse_20", "mmse_21"],
    words: MMSE_WORDS,
    promptText: itemOf("mmse", "mmse_19").text.replace(/请说出第\d+个词[。]?$/, ""),
  },
];

/** 组目标（非 trigger）题目 id 集合：不单独向患者提问 */
export const GROUP_NON_TRIGGER_IDS: ReadonlySet<string> = new Set(
  WORD_RECALL_GROUPS.flatMap((g) => g.targetItemIds.filter((id) => id !== g.triggerItemId))
);

/** 组 trigger 题目 id → 组配置 */
export const wordRecallGroupByTrigger: ReadonlyMap<string, WordRecallGroup> = new Map(
  WORD_RECALL_GROUPS.map((g) => [g.triggerItemId, g])
);

// ---------- 自由回答题（不展示选项，LLM 判后映射既有选项） ----------

export type FreeAnswerSpec =
  | { kind: "datePart"; part: "year" | "season" | "month" | "day" | "weekday" }
  | { kind: "place"; part: keyof MmseLocation }
  | { kind: "exactNumber"; expected: number }
  | { kind: "verbatim"; target: string }
  | { kind: "wordCount"; words: readonly string[] }
  | {
      kind: "naming";
      /** 标准名称（从 1 分选项解析，如「手表」） */
      target: string;
      /** 同样算对的说法（工程侧整理，待甲方医学确认） */
      synonyms: readonly string[];
      /** 明确说成别的东西（判错）；仅供规则兜底用，LLM 通道另按判定标准理解 */
      nearMisses: readonly string[];
    };

export interface MmseLocation {
  province: string;
  city: string;
  place: string;
  department: string;
  floor: string;
}

/**
 * MMSE 地点定向题（mmse_6~10）的"正确答案"（2026-08-13 用户拍板：配置机构位置）。
 * 演示场地变更时用环境变量覆盖（演示前按现场设置）；默认值为演示占位。
 */
export const MMSE_LOCATION: MmseLocation = {
  province: process.env.MMSE_PLACE_PROVINCE ?? "广东省",
  city: process.env.MMSE_PLACE_CITY ?? "广州市",
  place: process.env.MMSE_PLACE_NAME ?? "医院",
  department: process.env.MMSE_PLACE_DEPARTMENT ?? "老年医学科",
  floor: process.env.MMSE_PLACE_FLOOR ?? "三楼",
};

// ---------- 看图识物（屏幕出图、患者说出名称） ----------

export interface ScreenStimulus {
  itemId: string;
  /** 患者屏幕上展示的图片（public 路径，自绘线稿，不含任何文字） */
  imageSrc: string;
  spec: Extract<FreeAnswerSpec, { kind: "naming" }>;
}

/**
 * MMSE 命名题（mmse_22 手表 / mmse_23 铅笔，01 表条目类型「图片识别」）。
 * 2026-11-11 用户拍板（会议纪要「认知评估系统功能优化讨论」：屏幕题不展示就没有价值）：
 * 由医生代填改为患者端出题——屏幕展示图片，患者说出名称，按自由回答题判定后映射回既有 1/0 分选项，
 * 评分引擎与医学 JSON 零改动（硬约束 2）。
 * 判定口径：「手表」另认「表、腕表、钟表、电子表」；「铅笔」只认含「铅笔」的说法，只说「笔」或说成
 * 其他笔判错（01 表选项写的是回答"铅笔"）。同义词范围为工程侧整理，待甲方医学确认。
 */
export const SCREEN_STIMULI: readonly ScreenStimulus[] = [
  {
    itemId: "mmse_22",
    imageSrc: "/cognitive/naming-watch.svg",
    spec: {
      kind: "naming",
      target: "手表",
      synonyms: ["表", "腕表", "钟表", "电子表"],
      nearMisses: ["闹钟", "钟", "手环", "手镯", "手链"],
    },
  },
  {
    itemId: "mmse_23",
    imageSrc: "/cognitive/naming-pencil.svg",
    spec: {
      kind: "naming",
      target: "铅笔",
      synonyms: [],
      nearMisses: ["笔", "筷子", "棍子"],
    },
  },
];

// 加载断言：标准名称必须与 01 表 1 分选项原文一致（01 表改了名称而图片、同义词没跟着改时立即报错）
for (const stimulus of SCREEN_STIMULI) {
  const sourceTarget = quotedTargetOf(itemOf("mmse", stimulus.itemId));
  if (stimulus.spec.target !== sourceTarget) {
    throw new Error(`看图识物 ${stimulus.itemId} 的 01 表标准名称为「${sourceTarget}」，与配置「${stimulus.spec.target}」不符`);
  }
}

const screenStimulusById: ReadonlyMap<string, ScreenStimulus> = new Map(
  SCREEN_STIMULI.map((stimulus) => [stimulus.itemId, stimulus])
);

/** 该题在患者屏幕上展示的图片；非看图题返回 null */
export function screenImageOf(itemId: string): string | null {
  return screenStimulusById.get(itemId)?.imageSrc ?? null;
}

/**
 * 01 表条目类型不是「正式问题」、但已改为患者端出题的条目（投影层据此不标 observerAssisted）。
 * 目前只有看图识物两题。
 */
export function isPatientScreenItem(itemId: string): boolean {
  return screenStimulusById.has(itemId);
}

export const FREE_ANSWER_ITEMS: ReadonlyMap<string, FreeAnswerSpec> = new Map<string, FreeAnswerSpec>([
  // MMSE 时间定向（mmse_1~5）：参考答案由系统日期运行时生成
  ["mmse_1", { kind: "datePart", part: "year" }],
  ["mmse_2", { kind: "datePart", part: "season" }],
  ["mmse_3", { kind: "datePart", part: "month" }],
  ["mmse_4", { kind: "datePart", part: "day" }],
  ["mmse_5", { kind: "datePart", part: "weekday" }],
  // MMSE 地点定向（mmse_6~10）：参考答案来自 MMSE_LOCATION
  ["mmse_6", { kind: "place", part: "province" }],
  ["mmse_7", { kind: "place", part: "city" }],
  ["mmse_8", { kind: "place", part: "place" }],
  ["mmse_9", { kind: "place", part: "department" }],
  ["mmse_10", { kind: "place", part: "floor" }],
  // MMSE 连减 7（mmse_14~18）：期望值从各题 1 分选项解析（93/86/79/72/65）
  ...(["mmse_14", "mmse_15", "mmse_16", "mmse_17", "mmse_18"] as const).map(
    (id): [string, FreeAnswerSpec] => [id, { kind: "exactNumber", expected: expectedNumberOf(itemOf("mmse", id)) }]
  ),
  // MMSE 看图识物（mmse_22/23）：屏幕出图，患者说出名称（配置见 SCREEN_STIMULI）
  ...SCREEN_STIMULI.map((stimulus): [string, FreeAnswerSpec] => [stimulus.itemId, stimulus.spec]),
  // MMSE 原文复述（mmse_24）：目标句从 1 分选项解析（瑞雪兆丰年）
  ["mmse_24", { kind: "verbatim", target: quotedTargetOf(itemOf("mmse", "mmse_24")) }],
  // minicog 画钟后复述（minicog_3）：LLM 数出回忆词数 → 映射"回忆N个词"选项
  ["minicog_3", { kind: "wordCount", words: MINICOG_WORDS }],
]);

// ---------- 查询辅助 ----------

/**
 * 题目屏幕展示文案覆盖（2026-09-04 修改意见 6：MMSE 原文复述题的目标句"瑞雪兆丰年"不上屏，
 * 否则患者照屏朗读、复述测试失效；播报仍念完整题面）。
 * 展示文案 = 题面截到目标句之前；从条目文本派生并加载断言不含目标句。
 * 仅 mmse_24 这类"目标内容写在题面里"的自由回答题需要；其余题展示与播报同文（返回 null）。
 */
const QUESTION_DISPLAY_TEXT: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  const mmse24 = itemOf("mmse", "mmse_24");
  const target = quotedTargetOf(mmse24);
  const cut = mmse24.text.lastIndexOf("：");
  if (cut < 0 || !mmse24.text.slice(cut).includes(target)) {
    throw new Error(`无法从 mmse_24 题面剥离复述目标句：${mmse24.text}`);
  }
  const display = `${mmse24.text.slice(0, cut)}。`;
  if (display.includes(target)) throw new Error(`mmse_24 展示文案仍含目标句：${display}`);
  map.set("mmse_24", display);
  return map;
})();

/** 题目屏幕展示文案覆盖；返回 null 表示展示与播报同文 */
export function displayTextOverride(itemId: string): string | null {
  return QUESTION_DISPLAY_TEXT.get(itemId) ?? null;
}

/** 该题是否自由回答（不展示选项按钮）：free 题或组 trigger 题 */
export function isFreeResponseItem(itemId: string): boolean {
  return FREE_ANSWER_ITEMS.has(itemId) || wordRecallGroupByTrigger.has(itemId);
}

/** 播报/展示文案覆盖：组 trigger 题用组提问文案，其余返回 null（调用方用题面原文） */
export function spokenTextOverride(itemId: string): string | null {
  return wordRecallGroupByTrigger.get(itemId)?.promptText ?? null;
}
