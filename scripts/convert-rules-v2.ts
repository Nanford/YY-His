/**
 * INPUT:  V2/ 只读医学源文件（V2 迭代规则唯一事实来源，禁止修改）：
 *           - 01_评估采集规则表.xlsx（sheet「最终量表汇总」，采集编排：42 量表 + 开场白/分类过渡/工具说明）
 *           - 02_结果标签判定表.xlsx（sheet「结果标签判定规则」，190 个评估结果标签及判定规则）
 *           - 03_标签干预匹配表.xlsx（sheet「四列精简版」，190 标签 × 60 干预 = 11400 条完整笛卡尔积）
 *           - 04_干预方案信息表.xlsx（sheet「干预方案信息表」，60 项干预方案正文与展示形式）
 *           - figure 1.png（Bristol 大便性状 7 型图，便秘症状评估表第 9 题的展示素材）
 * OUTPUT: data/scales-v2.json（采集编排：narrations + scales/items，选项尽力解析，原文全保留）
 *         data/result-tags.json（190 标签：编码/中文名/所属量表/判定规则/占位标记）
 *         data/intervention-scoring-v2.json（编码索引稀疏矩阵，仅存非零分；未出现的对视为 0）
 *         data/interventions-v2.json（60 项干预：编码/名称/正文/展示形式/素材 URL/素材可用性；
 *           素材检测顺序：public/interventions/ 下 V2 编码命名文件优先，缺失时按 MEDIA_V1_SOURCE
 *           表把内容明确对应的 V1 素材复制为 V2 编码命名；检测到的素材 mediaSrc 附内容哈希 ?v=）
 *         public/interventions/bristol-stool.png（palette 量化压缩，目标 <600KB）+ bristol-stool.webp
 * POS:    V2 规则数据层的唯一生成与校验入口。医学规则变更只能改 V2/ 源文件后重跑本脚本
 *         （npm run convert-rules-v2）；校验失败即退出非零码，禁止产出不完整数据。
 *         与 V1/V2.0 的 scripts/convert-rules.ts 完全独立，互不改写对方产物。
 *         另校验手工整理的 data/judgments-v2.json（02 表判定规则配置，只校验不生成）：
 *         量表/标签编码/条目 id 与 options 引用完整性、区间不重叠且全覆盖、中医 27 题分组一致性、
 *         thresholdByEducation 四档界值单调递增与文化程度映射覆盖、perQuestionTags 规则引用完整性
 *         （M10.3b 起每量表 judgments 为 1～N 份数组，逐份校验；占位标签禁止自动产出）。
 *         分值语义（来源：03 表列说明）：100=强制推荐、-100=禁用、0=无关、2～10=普通匹配强度（1 不出现）。
 */
import * as XLSX from "xlsx";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import sharp from "sharp";
import { EDUCATION_BANDS } from "../src/lib/scoring-v2/education";

const ROOT = path.resolve(__dirname, "..");
const V2_DIR = path.join(ROOT, "V2");
const DATA_DIR = path.join(ROOT, "data");
const PUBLIC_INTERVENTIONS_DIR = path.join(ROOT, "public", "interventions");

const COLLECTION_XLSX = path.join(V2_DIR, "01_评估采集规则表.xlsx");
const RESULT_TAG_XLSX = path.join(V2_DIR, "02_结果标签判定表.xlsx");
const MATCH_XLSX = path.join(V2_DIR, "03_标签干预匹配表.xlsx");
const INTERVENTION_XLSX = path.join(V2_DIR, "04_干预方案信息表.xlsx");
const BRISTOL_PNG = path.join(V2_DIR, "figure 1.png");

const GENERATED_AT = new Date().toISOString();

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/** 读取 xlsx 指定 sheet 为二维数组（空单元格为 null），并剥掉全空行 */
function readSheet(file: string, sheetName: string): unknown[][] {
  const wb = XLSX.readFile(file);
  const ws = wb.Sheets[sheetName];
  if (!ws) fail(`找不到 sheet「${sheetName}」：${file}（实际 sheet：${wb.SheetNames.join("、")}）`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];
  return rows.filter((r) => r.some((c) => c !== null && String(c).trim() !== ""));
}

/** 单元格归一化为去空白字符串；null/undefined → "" */
function cell(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

/** 可空字符串：空 → null */
function nullable(v: string): string | null {
  return v === "" ? null : v;
}

/** 文件内容 md5 前 8 位，作为静态素材缓存版本号：内容不变则 URL 不变，可安全 immutable 长缓存（对齐 scripts/convert-rules.ts） */
function contentHash(file: string): string {
  return crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex").slice(0, 8);
}

// ============================================================================
// A. 01_评估采集规则表 → data/scales-v2.json
// ============================================================================

// 条目类型全集（来源：01 表「条目类型」列实际取值）
const ENTRY_TYPES = [
  "总开场", "分类过渡", "工具说明", "正式问题", "系统读取", "逻辑计算", "操作测试",
  "记忆指令", "绘图操作", "图片识别", "操作指令", "医护观察", "医护核对", "医护评估", "设备/人工测量",
] as const;
const NARRATION_TYPES = new Set(["总开场", "分类过渡", "工具说明"]);

// 一级分类固定顺序（来源：01 表「一级分类」列；Demo_v2更新说明 §2(3) 写作"中医特色评估"）
const CATEGORIES = ["全程", "躯体功能", "精神心理", "社会与环境", "老年综合征", "中医特色评估"];
// 01 表原始值 → 展示用名称（docx 口径与表格文案不一致时在此映射）
const CATEGORY_DISPLAY_MAP: Record<string, string> = {
  "中医特色扩展": "中医特色评估",
};

// 量表名 → 量表 id（脚本内手工维护；01 表出现的每个量表名必须恰好在表中）。
// 值：[id, 期望条目数]（条目数从 01 表数出，防漏行硬校验）；整场评估为总开场占位，不成量表。
const SCALE_MAP: Record<string, [string | null, number]> = {
  "整场评估": [null, 0],
  "基本日常生活活动能力评估量表": ["adl", 10],
  "工具性日常生活活动能力量表": ["iadl", 8],
  "运动功能初筛": ["motor_screen", 1],
  "简易体能状况量表（SPPB）": ["sppb", 5],
  "视力简易评估表": ["vision", 5],
  "视觉功能简易评估表": ["visual_function", 3],
  "听力简易评估表": ["hearing", 5],
  "耳语试验": ["whisper", 4],
  "简易智力评估量表": ["minicog", 3],
  "简易智力状态检查量表（MMSE）": ["mmse", 30],
  "抑郁两问筛查": ["depression_2q", 2],
  "简版老年抑郁量表（GDS-15）": ["gds15", 15],
  "焦虑两问筛查": ["anxiety_2q", 2],
  "广泛性焦虑障碍量表（GAD-7）": ["gad7", 7],
  "Lubben社会网络量表": ["lubben", 6],
  "居家环境筛查表": ["home_env", 14],
  "跌倒风险三问筛查": ["fall_3q", 3],
  "Morse老年人跌倒风险评估表": ["morse", 6],
  "FRAIL量表": ["frail", 5],
  "尿失禁两问筛查": ["ui_2q", 2],
  "国际尿失禁咨询委员会尿失禁问卷简表（ICIQ-UI SF）": ["iciq", 4],
  "便秘一问筛查": ["constipation_1q", 1],
  "便秘症状评估表": ["constipation_symptom", 9],
  "睡眠障碍一问筛查": ["sleep_1q", 1],
  "阿森斯失眠量表（AIS）": ["ais", 8],
  "慢性疼痛一问筛查": ["pain_1q", 1],
  "慢性疼痛数字评定量表（NRS）": ["pain_nrs", 1],
  "慢性疼痛行为评估量表": ["pain_behavior", 4],
  "压力性损伤初步筛查": ["pressure_screen", 2],
  "压力性损伤风险评估量表": ["braden", 6],
  "多重用药评估": ["polypharmacy", 2],
  "吞咽障碍初筛": ["dysphagia_screen", 5],
  "洼田饮水试验": ["water_swallow", 1],
  "营养风险筛查2002（NRS 2002）": ["nrs2002", 7],
  "微型营养评定简表（MNA-SF）": ["mnasf", 6],
  "全球领导人营养不良倡议标准（GLIM）": ["glim", 6],
  "小腿围测量": ["calf", 1],
  "握力测量": ["grip", 1],
  "6米步速测试": ["gait_speed", 1],
  "DXA或BIA肌肉量测量": ["dxa_bia", 1],
  "谵妄评估（CAM）": ["cam", 4],
  "中医体质辨识": ["tcm_constitution", 30],
};

interface ParsedOption {
  label: string;
  score: number | null;
}

/**
 * 尽力解析「预设答案」为选项序列；解不出返回 null（调用方告警，原文已在 optionsRaw 保留）。
 * 支持：「A、xx（10分）；B、yy（5分）」「是（1分）/否（0分）」以外的字母前缀序列、
 * 引导语结尾为「：」的前缀（如「可多选：」「优先按BMI：」）；分值取选项文本中第一处「N分」。
 * M10.3b 补充：括号内无分值时，尝试取 label 前导「N分：」作为分值
 * （目前仅 pain_nrs_1 的 11 个选项是这种写法，已探查无其他条目受影响）。
 */
/**
 * 为无法按 A、B 列表解析的条目补齐确定性选项（M10.3b-2）。
 * 仅覆盖评分/代填必需条目；开放式用药清单等仍保持 options=null。
 */
function syntheticOptionsFor(itemId: string, optionsRaw: string): ParsedOption[] | null {
  if (itemId === "cam_1") {
    // 来源：01 表 cam_1「问题1/2 任一是 → 条目1阳性」；合并为单题是/否供 CAM 组合判定
    return [
      { label: "是（条目1阳性）", score: null },
      { label: "否（条目1阴性）", score: null },
    ];
  }
  if (itemId === "whisper_3" || itemId === "whisper_4") {
    // 来源：01 表「正确复述词数 4/3/2/1/0；少于 3 个词该侧阳性」
    return [4, 3, 2, 1, 0].map((n) => ({ label: `正确复述${n}个词`, score: n }));
  }
  if (itemId === "calf_1") {
    return [
      { label: "筛查阳性（低于性别阈值）", score: null },
      { label: "筛查阴性（达到性别阈值）", score: null },
    ];
  }
  if (itemId === "grip_1") {
    return [
      { label: "握力下降（低于性别阈值）", score: null },
      { label: "握力正常（达到性别阈值）", score: null },
    ];
  }
  if (itemId === "gait_speed_1") {
    return [
      { label: "步速下降（＜1.0 m/s）", score: null },
      { label: "步速正常（≥1.0 m/s）", score: null },
    ];
  }
  if (itemId === "dxa_bia_1") {
    return [
      { label: "符合肌少症肌肉量界值", score: null },
      { label: "未达肌少症肌肉量界值", score: null },
    ];
  }
  // M9.6：ICIQ Q3 生活质量影响分 0～10
  if (itemId === "iciq_3") {
    return Array.from({ length: 11 }, (_, n) => ({
      label: n === 0 ? "0分（无任何影响）" : n === 10 ? "10分（影响极重）" : `${n}分`,
      score: n,
    }));
  }
  // M9.6：便秘症状 Q3 每周排便次数（＜3 次为低频率阳性）
  if (itemId === "constipation_symptom_3") {
    return [0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({
      label: n === 7 ? "7次及以上" : `${n}次`,
      score: n,
    }));
  }
  // 词数类：optionsRaw 含「4个／3个」等
  if (/4个/.test(optionsRaw) && /0个/.test(optionsRaw) && /复述/.test(optionsRaw)) {
    return [4, 3, 2, 1, 0].map((n) => ({ label: `正确复述${n}个词`, score: n }));
  }
  return null;
}

function parseOptions(raw: string): ParsedOption[] | null {
  if (!raw) return null;
  // 定位第一个选项起点（大写字母 + 顿号/点），之前只允许引导语（须以「：」结尾）
  const startMatch = /[A-Z][、.]/.exec(raw);
  if (!startMatch) return null;
  const prefix = raw.slice(0, startMatch.index).trim();
  if (prefix !== "" && !prefix.endsWith("：") && !prefix.endsWith(":")) return null;
  const body = raw.slice(startMatch.index);
  // 按「选项起点前瞻」切分而非仅按分号：01 表存在「D、xx（3分）。无法获得BMI时按小腿围：E、…」
  // 这类句号后接第二段引导语的写法（如 mnasf_6），仅按分号切会把后段引导语吞进前一项 label
  const segments = body.split(/(?=[A-Z][、.])/).map((s) => s.trim()).filter((s) => s !== "");
  if (segments.length === 0) return null;
  const options: ParsedOption[] = [];
  for (const seg of segments) {
    const m = /^([A-Z])[、.]\s*(.+)$/.exec(seg);
    if (!m) return null;
    let label = m[2].trim();
    // 剥掉段末的过渡引导语（「。……：」），只保留选项正文；再去掉段末残留的分号/句号
    label = label.replace(/。[^。]*：$/, "").replace(/[；;。]\s*$/, "").trim();
    // 分值：选项文本第一处括号内的「N分」（支持「（根本不，1分）」「（4分，结束评估）」等写法）
    let score: number | null = null;
    const paren = /（([^（）]*?)）/.exec(label);
    if (paren) {
      const scoreMatch = /(-?\d+(?:\.\d+)?)\s*分/.exec(paren[1]);
      if (scoreMatch) score = Number(scoreMatch[1]);
    }
    // 括号内无分值时退而取 label 前导「N分：」（如 pain_nrs_1 的「0分：无疼痛」…「10分：…」）
    if (score === null) {
      const leading = /^(\d+(?:\.\d+)?)\s*分[：:]/.exec(label);
      if (leading) score = Number(leading[1]);
    }
    options.push({ label, score });
  }
  return options;
}

interface Narration {
  id: string;
  row: number;
  entryType: string;
  category: string;
  scaleId: string | null;
  text: string;
}

interface ScaleItem {
  id: string;
  row: number;
  no: string;
  entryType: string;
  text: string;
  optionsRaw: string;
  options: ParsedOption[] | null;
  variableCode: string | null;
  reuseRule: string | null;
}

interface Scale {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  items: ScaleItem[];
}

function buildScalesV2(): { json: unknown; scaleNames: string[] } {
  const rows = readSheet(COLLECTION_XLSX, "最终量表汇总");
  // 表头硬校验（行 2），防源文件结构漂移静默出错
  const header = rows[2].map(cell);
  if (header[0] !== "一级分类" || header[3] !== "题号" || header[4] !== "条目类型" || header[8] !== "复用规则") {
    fail(`01 表表头不符预期：${header.join(" | ")}`);
  }
  const data = rows.slice(3);
  if (data.length !== 258) fail(`01 表数据行数 ${data.length} ≠ 258（行 3～260）`);

  const narrations: Narration[] = [];
  const scales: Scale[] = [];
  const scaleById = new Map<string, Scale>();
  const seenScaleNames = new Set<string>();
  const unparsedOptionRows: string[] = [];
  // 合并单元格痕迹：一级分类/二级分类/量表名列为空 = 与上一行相同（前向填充）
  let lastCategory = "", lastSubcategory = "", lastScaleName = "";

  for (let i = 0; i < data.length; i++) {
    const row = i + 3; // xlsx 行号（与 tmp/v2-01 dump 行号一致）
    const r = data[i];
    const categoryRaw = cell(r[0]), subRaw = cell(r[1]), scaleRaw = cell(r[2]);
    if (categoryRaw) lastCategory = CATEGORY_DISPLAY_MAP[categoryRaw] ?? categoryRaw;
    if (subRaw) lastSubcategory = subRaw;
    if (scaleRaw) lastScaleName = scaleRaw;
    const no = cell(r[3]);
    const entryType = cell(r[4]);
    const text = cell(r[5]);
    const optionsRaw = cell(r[6]);
    const variableCode = nullable(cell(r[7]));
    const reuseRule = nullable(cell(r[8]));

    if (!ENTRY_TYPES.includes(entryType as (typeof ENTRY_TYPES)[number])) {
      fail(`01 表行 ${row}：未知条目类型「${entryType}」`);
    }
    if (!CATEGORIES.includes(lastCategory)) {
      fail(`01 表行 ${row}：未知一级分类「${lastCategory}」`);
    }
    if (!(lastScaleName in SCALE_MAP)) {
      fail(`01 表行 ${row}：量表名「${lastScaleName}」不在 SCALE_MAP 中`);
    }
    seenScaleNames.add(lastScaleName);
    const [scaleId] = SCALE_MAP[lastScaleName];

    if (NARRATION_TYPES.has(entryType)) {
      // 总开场/分类过渡/工具说明 → narrations；工具说明挂当前量表，其余 scaleId=null
      const isTool = entryType === "工具说明";
      if (isTool && scaleId === null) fail(`01 表行 ${row}：工具说明挂在非量表「${lastScaleName}」上`);
      narrations.push({
        id: `narr_${row}`,
        row,
        entryType,
        category: lastCategory,
        scaleId: isTool ? scaleId : null,
        text,
      });
      continue;
    }

    if (scaleId === null) fail(`01 表行 ${row}：非旁白条目挂在「整场评估」上`);
    let scale = scaleById.get(scaleId);
    if (!scale) {
      scale = { id: scaleId, name: lastScaleName, category: lastCategory, subcategory: lastSubcategory, items: [] };
      scaleById.set(scaleId, scale);
      scales.push(scale);
    } else if (scale.items.length > 0 && scale.items[scale.items.length - 1].row !== row - 1) {
      fail(`01 表行 ${row}：量表「${lastScaleName}」条目不连续（上一条目在行 ${scale.items[scale.items.length - 1].row}）`);
    }
    let options = parseOptions(optionsRaw);
    // M10.3b-2：若干条目 optionsRaw 非 A/B 列表形式（词数记录/是否叙述/测量结论），
    // 为可评分与医生代填补齐确定性选项（label 供判定匹配；医学阈值仍写在 label 文案内）
    if (options === null) {
      options = syntheticOptionsFor(`${scaleId}_${no}`, optionsRaw);
    }
    if (optionsRaw && options === null) unparsedOptionRows.push(`行 ${row}（${scaleId}_${no}）`);
    scale.items.push({
      id: `${scaleId}_${no}`,
      row,
      no,
      entryType,
      text,
      optionsRaw,
      options,
      variableCode,
      reuseRule,
    });
  }

  // 量表名 ↔ id 双向核对 + 条目数硬校验
  for (const [name, [id, expected]] of Object.entries(SCALE_MAP)) {
    if (id === null) continue; // 整场评估占位
    if (!seenScaleNames.has(name)) fail(`SCALE_MAP 中的量表「${name}」未在 01 表出现`);
    const scale = scaleById.get(id);
    if (!scale) fail(`量表「${name}」无任何条目`);
    if (scale.items.length !== expected) {
      fail(`量表「${name}」条目数 ${scale.items.length} ≠ 期望 ${expected}`);
    }
  }

  if (narrations.length !== 20) fail(`旁白条数 ${narrations.length} ≠ 20`);
  const totalItems = scales.reduce((s, x) => s + x.items.length, 0);
  if (totalItems !== 238) fail(`条目总数 ${totalItems} ≠ 238`);

  if (unparsedOptionRows.length > 0) {
    console.warn(`⚠ ${unparsedOptionRows.length} 行预设答案未能解析为选项（options=null，原文保留在 optionsRaw）：`);
    for (const r of unparsedOptionRows) console.warn(`  - ${r}`);
  }

  return {
    json: {
      generatedFrom: "V2/01_评估采集规则表.xlsx",
      generatedAt: GENERATED_AT,
      categories: CATEGORIES,
      narrations,
      scales,
    },
    scaleNames: scales.map((s) => s.name),
  };
}

// ============================================================================
// B. 02_结果标签判定表 → data/result-tags.json
// ============================================================================

// 02 表量表名 → 01 表量表名 的显式差异映射（仅当两表写法不一致时登记；不允许静默跳过）
const SCALE_NAME_ALIASES: Record<string, string> = {};

const PLACEHOLDER_CODES = [
  "HOME_ENVIRONMENT_SCORE", "ICIQ_UI_SF_SCORE", "CONSTIPATION_CLINICAL_TYPE",
  "BEHAVIORAL_PAIN_SCORE", "MEDICATION_COUNT",
];

interface ResultTag {
  code: string;
  name: string;
  scaleName: string;
  rule: string;
  placeholder: boolean;
}

function buildResultTags(scaleNames01: string[]): { json: unknown; tags: ResultTag[] } {
  const rows = readSheet(RESULT_TAG_XLSX, "结果标签判定规则");
  const header = rows[1].map(cell);
  if (header[0] !== "评估量表/工具" || header[2] !== "结果标签编码") {
    fail(`02 表表头不符预期：${header.join(" | ")}`);
  }
  const data = rows.slice(2);
  if (data.length !== 190) fail(`02 表标签数 ${data.length} ≠ 190`);

  const names01 = new Set(scaleNames01);
  const tags: ResultTag[] = [];
  const codes = new Set<string>();
  const scaleNames02 = new Set<string>();

  for (let i = 0; i < data.length; i++) {
    const row = i + 2;
    const scaleName = cell(data[i][0]);
    const name = cell(data[i][1]);
    const code = cell(data[i][2]);
    const rule = cell(data[i][3]);
    if (!scaleName || !name || !code) fail(`02 表行 ${row}：量表名/标签名/编码有空值`);
    scaleNames02.add(scaleName);
    if (codes.has(code)) fail(`02 表行 ${row}：标签编码重复「${code}」`);
    codes.add(code);
    tags.push({ code, name, scaleName, rule, placeholder: name.includes("{") });
  }

  // 02 表量表名集合 ↔ 01 表量表名集合互相核对（显式别名映射处理写法差异，对不上即报错列出）
  const unmatched02 = [...scaleNames02].filter((n) => !names01.has(n) && !(n in SCALE_NAME_ALIASES));
  if (unmatched02.length > 0) fail(`02 表量表名无法映射到 01 表：${unmatched02.join("、")}`);
  const mapped02 = new Set([...scaleNames02].map((n) => (n in SCALE_NAME_ALIASES ? SCALE_NAME_ALIASES[n] : n)));
  const missingIn02 = [...names01].filter((n) => !mapped02.has(n));
  if (missingIn02.length > 0) fail(`01 表量表在 02 表无对应标签：${missingIn02.join("、")}`);
  // scaleName 统一改写为 01 表写法（映射后两表同名）
  for (const t of tags) if (t.scaleName in SCALE_NAME_ALIASES) t.scaleName = SCALE_NAME_ALIASES[t.scaleName];

  const placeholders = tags.filter((t) => t.placeholder);
  if (placeholders.length !== 5) fail(`占位标签数 ${placeholders.length} ≠ 5`);
  const phCodes = placeholders.map((t) => t.code).sort();
  if (JSON.stringify(phCodes) !== JSON.stringify([...PLACEHOLDER_CODES].sort())) {
    fail(`占位标签编码集合不符：${phCodes.join("、")}`);
  }

  return {
    json: { generatedFrom: "V2/02_结果标签判定表.xlsx", generatedAt: GENERATED_AT, tags },
    tags,
  };
}

// ============================================================================
// C. 04_干预方案信息表 → data/interventions-v2.json
// ============================================================================

// 编码前缀 → 03 表第 4 列分类值（无「干预」二字后缀；亦作 04 表干预大类）
const MATCH_CATEGORY_LABEL: Record<string, string> = {
  YD: "运动", SS: "膳食营养", ZY: "中医食养", JZ: "就诊建议", QT: "其他",
};

const MEDIA_TYPE_BY_DISPLAY: Record<string, string> = { 视频: "video", 图片: "image", 文本: "text" };

/**
 * V1/V2.0 素材 → V2 编码映射（2026-08-08 人工核查，来源：data/intervention-scoring.json 的
 * M/D/C 干预名称与正文 vs V2/04_干预方案信息表.xlsx 的 YD/SS/ZY 名称与正文，图片另逐张目检确认）。
 * 仅收录名称与正文明确对应的项；对应不上的一律不映射（保持 mediaAvailable=false，前端显示「素材待补齐」）。
 * 值为 public/interventions/ 下的相对路径；复制不移动，V1 文件退役不删。
 *   运动视频：M01 扶椅坐站→YD02、M02 坐位伸膝→YD03、M03 扶椅提踵→YD04、M07 墙壁俯卧撑→YD09、
 *             M09 脚跟对脚尖站立→YD06、M11 原地踏步（扶椅交替抬腿）→YD05、M12 步行训练→YD01
 *   膳食图片：D03 优质蛋白加餐→SS02、D05 少量多餐→SS03、D10 口服营养补充→SS04
 *   食养图片：C08 百合莲子羹→ZY02、C05 赤小豆冬瓜汤→ZY10
 */
const MEDIA_V1_SOURCE: Record<string, string> = {
  YD01: "videos/M12.mp4",
  YD02: "videos/M01.mp4",
  YD03: "videos/M02.mp4",
  YD04: "videos/M03.mp4",
  YD05: "videos/M11.mp4",
  YD06: "videos/M09.mp4",
  YD09: "videos/M07.mp4",
  SS02: "D03.png",
  SS03: "D05.png",
  SS04: "D10.png",
  ZY02: "C08.png",
  ZY10: "C05.png",
};

/**
 * 定位干预素材文件：V2 编码命名文件优先；缺失时按 MEDIA_V1_SOURCE 把 V1 素材复制为 V2 编码命名
 * （图片同步复制 .webp 派生）。返回 public/interventions/ 下的相对路径，无素材返回 null。
 */
function resolveMediaFile(code: string, mediaType: string): string | null {
  if (mediaType === "text") return null;
  const rel = mediaType === "video" ? `videos/${code}.mp4` : `${code}.png`;
  const target = path.join(PUBLIC_INTERVENTIONS_DIR, rel);
  if (fs.existsSync(target)) return rel;
  const v1Rel = MEDIA_V1_SOURCE[code];
  if (!v1Rel) return null;
  const v1File = path.join(PUBLIC_INTERVENTIONS_DIR, v1Rel);
  if (!fs.existsSync(v1File)) {
    console.warn(`⚠ ${code} 映射的 V1 素材 ${v1Rel} 不存在，保持 mediaAvailable=false`);
    return null;
  }
  fs.copyFileSync(v1File, target);
  const v1Webp = v1File.replace(/\.png$/, ".webp");
  if (mediaType === "image" && fs.existsSync(v1Webp)) {
    fs.copyFileSync(v1Webp, target.replace(/\.png$/, ".webp"));
  }
  return rel;
}

interface Intervention {
  code: string;
  name: string;
  category: string;
  display: string;
  mediaType: string;
  content: string;
  mediaSrc: string | null;
  mediaAvailable: boolean;
}

function buildInterventionsV2(): { json: unknown; interventions: Intervention[] } {
  const rows = readSheet(INTERVENTION_XLSX, "干预方案信息表");
  const header = rows[2].map(cell);
  if (header[0] !== "干预方案标签" || header[1] !== "名称" || header[3] !== "展示形式") {
    fail(`04 表表头不符预期：${header.join(" | ")}`);
  }
  const data = rows.slice(3);
  if (data.length !== 60) fail(`04 表干预项数 ${data.length} ≠ 60`);

  const interventions: Intervention[] = [];
  const codes = new Set<string>();
  for (let i = 0; i < data.length; i++) {
    const row = i + 3;
    const code = cell(data[i][0]);
    const name = cell(data[i][1]);
    const content = cell(data[i][2]);
    const display = cell(data[i][3]);
    if (!/^(YD|SS|ZY|JZ|QT)\d{2}$/.test(code)) fail(`04 表行 ${row}：干预编码格式异常「${code}」`);
    if (codes.has(code)) fail(`04 表行 ${row}：干预编码重复「${code}」`);
    codes.add(code);
    const mediaType = MEDIA_TYPE_BY_DISPLAY[display];
    if (!mediaType) fail(`04 表行 ${row}：未知展示形式「${display}」`);
    if (!name || !content) fail(`04 表行 ${row}：名称/具体内容有空值`);
    const prefix = code.slice(0, 2);
    // mediaSrc：video → videos/<编码>.mp4；image → <编码>.png；text → null。
    // 素材缺失时仍指向约定路径（mediaAvailable=false，前端回退「素材待补齐」）；
    // 素材文件检测含 V1→V2 映射复制（见 resolveMediaFile）；检测到的素材附内容哈希 ?v=，
    // 配合 next.config.ts 对 /interventions/* 的 immutable 长缓存（内容变则 URL 变）。
    const mediaFile = resolveMediaFile(code, mediaType);
    const baseSrc =
      mediaType === "video" ? `/interventions/videos/${code}.mp4`
      : mediaType === "image" ? `/interventions/${code}.png`
      : null;
    const mediaSrc =
      mediaFile !== null ? `${baseSrc}?v=${contentHash(path.join(PUBLIC_INTERVENTIONS_DIR, mediaFile))}` : baseSrc;
    const mediaAvailable = mediaFile !== null;
    interventions.push({
      code,
      name,
      category: MATCH_CATEGORY_LABEL[prefix],
      display,
      mediaType,
      content,
      mediaSrc,
      mediaAvailable,
    });
  }
  return {
    json: { generatedFrom: "V2/04_干预方案信息表.xlsx", generatedAt: GENERATED_AT, interventions },
    interventions,
  };
}

// ============================================================================
// D. 03_标签干预匹配表 → data/intervention-scoring-v2.json
// ============================================================================

const EXPECTED_DATA_ROWS = 11400; // 190 标签 × 60 干预
const VALID_SCORES = new Set([-100, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 100]);

// 黄金向量（从 03 表逐项提取，生成期自校验必须精确相等）
const GOLDEN_VECTORS: Record<string, Record<string, number>> = {
  FRAIL_FRAIL: { YD01: 6, YD02: 9, SS02: 9, SS03: 8, ZY01: 6, JZ02: 8, JZ03: 7, QT15: 6 },
  FRAIL_PREFRAIL: { YD01: 7, YD02: 7, SS02: 7, SS03: 5, ZY01: 5, JZ02: 5, JZ03: 5, QT15: 3 },
  MNA_SF_MALNUTRITION_RISK: { SS02: 7, SS03: 8, SS04: 7, ZY01: 5, JZ02: 5, JZ08: 8 },
  GLIM_SEVERE_MALNUTRITION: { SS02: 9, SS03: 10, SS04: 9, ZY01: 5, JZ02: 5, JZ08: 10 },
  MORSE_FALL_RISK_HIGH: { YD02: 8, YD04: 7, YD06: 9, YD07: -100, JZ03: 9, QT01: 7, QT02: 7, QT03: 7, QT04: 7, QT05: 9 },
  ADL_DEPENDENCE_SEVERE: { YD02: 9, YD03: 7, YD07: -100, YD10: 7, JZ02: 7, JZ03: 8, QT05: 7, QT15: 7 },
  SARCOPENIA_DIAGNOSED: { YD02: 10, YD03: 8, YD04: 6, YD08: 6, SS02: 10, SS03: 8, ZY01: 5, JZ03: 9, JZ08: 7 },
  TCM_QI_DEFICIENCY_YES: { YD01: 4, SS02: 4, ZY01: 9 },
  HOME_FLOOR_SLIPPERY: { QT02: 10, QT05: 3 },
  POLYPHARMACY_PRESENT: { JZ02: 5, JZ14: 9, QT10: 8 },
  CAM_DELIRIUM_POSITIVE: { JZ01: 100, JZ02: 8, QT12: 5, QT15: 8 },
};
// CAM 谵妄额外禁用 YD/SS/ZY 全部 30 项（-100）
const CAM_FORBIDDEN_PREFIXES = ["YD", "SS", "ZY"];
// YD07（扶椅单脚站立训练）对 7 个标签禁用（-100）
const YD07_FORBIDDEN_TAGS = [
  "ADL_DEPENDENCE_SEVERE", "SPPB_POOR", "VISION_BLIND", "VISION_TOTAL_BLINDNESS",
  "VISUAL_FIELD_DEFECT_SYMPTOM", "FALL_UNSTEADY_STANDING_WALKING", "MORSE_FALL_RISK_HIGH",
];

function buildScoringV2(
  tags: ResultTag[],
  interventions: Intervention[],
): { json: unknown; nonzeroCount: number } {
  const rows = readSheet(MATCH_XLSX, "四列精简版");
  const header = rows[2].map(cell);
  if (header[0] !== "评估结果标签" || header[1] !== "干预方案标签" || header[2] !== "匹配度评分" || header[3] !== "干预方案分类") {
    fail(`03 表表头不符预期：${header.join(" | ")}`);
  }
  const data = rows.slice(3);
  if (data.length !== EXPECTED_DATA_ROWS) fail(`03 表数据行数 ${data.length} ≠ ${EXPECTED_DATA_ROWS}`);

  const tagCodes = new Set(tags.map((t) => t.code));
  const itemCodes = new Set(interventions.map((x) => x.code));
  const seenPairs = new Set<string>();
  const categoryByItem = new Map<string, string>();
  const matrix: Record<string, Record<string, number>> = {};
  const seenTags = new Set<string>();
  const seenItems = new Set<string>();
  let forcedCount = 0;
  let forbiddenCount = 0;
  let nonzeroCount = 0;
  const forcedPairs: string[] = [];
  const forbiddenPairs: string[] = [];

  for (let i = 0; i < data.length; i++) {
    const row = i + 3;
    // 03 表「评估结果标签」列直接为结果标签编码（表头列说明已声明），无需中文名映射
    const tagCode = cell(data[i][0]);
    const itemCode = cell(data[i][1]);
    const scoreRaw = cell(data[i][2]);
    const matchCategory = cell(data[i][3]);
    const score = Number(scoreRaw);
    if (!Number.isInteger(score) || !VALID_SCORES.has(score)) {
      fail(`03 表行 ${row}：分值非法「${scoreRaw}」（合法值：-100/0/2~10/100）`);
    }
    if (!tagCodes.has(tagCode)) fail(`03 表行 ${row}：标签编码「${tagCode}」不在 02 表 190 编码中`);
    if (!itemCodes.has(itemCode)) fail(`03 表行 ${row}：干预编码「${itemCode}」不在 04 表 60 编码中`);
    const pair = `${tagCode}→${itemCode}`;
    if (seenPairs.has(pair)) fail(`03 表行 ${row}：标签-干预对重复 ${pair}`);
    seenPairs.add(pair);
    seenTags.add(tagCode);
    seenItems.add(itemCode);
    // 03 表第 4 列分类与编码前缀推导分类交叉校验，且同一干预项全表分类一致
    const prefix = itemCode.slice(0, 2);
    if (matchCategory !== MATCH_CATEGORY_LABEL[prefix]) {
      fail(`03 表行 ${row}：分类「${matchCategory}」与编码前缀 ${prefix} 推导「${MATCH_CATEGORY_LABEL[prefix]}」不一致`);
    }
    if (categoryByItem.has(itemCode) && categoryByItem.get(itemCode) !== matchCategory) {
      fail(`03 表行 ${row}：干预项 ${itemCode} 分类前后不一致`);
    }
    categoryByItem.set(itemCode, matchCategory);

    if (score !== 0) {
      (matrix[tagCode] ??= {})[itemCode] = score;
      nonzeroCount++;
      if (score === 100) { forcedCount++; forcedPairs.push(pair); }
      if (score === -100) { forbiddenCount++; forbiddenPairs.push(pair); }
    }
  }

  // 完整笛卡尔积：190 × 60 无缺无重
  if (seenTags.size !== 190) fail(`03 表实际标签数 ${seenTags.size} ≠ 190`);
  if (seenItems.size !== 60) fail(`03 表实际干预数 ${seenItems.size} ≠ 60`);
  if (seenPairs.size !== EXPECTED_DATA_ROWS) fail(`03 表标签-干预对 ${seenPairs.size} ≠ ${EXPECTED_DATA_ROWS}`);
  const missingTags = tags.filter((t) => !seenTags.has(t.code)).map((t) => t.code);
  if (missingTags.length > 0) fail(`02 表标签未在 03 表出现：${missingTags.join("、")}`);
  const missingItems = interventions.filter((x) => !seenItems.has(x.code)).map((x) => x.code);
  if (missingItems.length > 0) fail(`04 表干预未在 03 表出现：${missingItems.join("、")}`);

  // 分值语义硬校验：100 恰 1 条且为 CAM_DELIRIUM_POSITIVE→JZ01；-100 恰 37 条
  if (forcedCount !== 1 || forcedPairs[0] !== "CAM_DELIRIUM_POSITIVE→JZ01") {
    fail(`100 分（强制）条目异常：${forcedPairs.join("、") || "无"}`);
  }
  const expectedForbidden = new Set<string>([
    ...CAM_FORBIDDEN_PREFIXES.flatMap((p) =>
      Array.from({ length: 10 }, (_, i) => `CAM_DELIRIUM_POSITIVE→${p}${String(i + 1).padStart(2, "0")}`)),
    ...YD07_FORBIDDEN_TAGS.map((t) => `${t}→YD07`),
  ]);
  if (forbiddenCount !== expectedForbidden.size) {
    fail(`-100 分（禁用）条数 ${forbiddenCount} ≠ ${expectedForbidden.size}`);
  }
  const extraForbidden = forbiddenPairs.filter((p) => !expectedForbidden.has(p));
  if (extraForbidden.length > 0) fail(`-100 分条目超出预期集合：${extraForbidden.join("、")}`);

  // 黄金向量生成期自校验（稀疏矩阵非零项必须精确相等，键序无关）
  const sameVector = (a: Record<string, number>, b: Record<string, number>): boolean => {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => b[k] === a[k]);
  };
  for (const [tag, expected] of Object.entries(GOLDEN_VECTORS)) {
    const actual = { ...(matrix[tag] ?? {}) };
    // CAM 额外补全 30 条禁用项后再比对
    if (tag === "CAM_DELIRIUM_POSITIVE") {
      for (const p of CAM_FORBIDDEN_PREFIXES) {
        for (let i = 1; i <= 10; i++) expected[`${p}${String(i).padStart(2, "0")}`] = -100;
      }
    }
    if (!sameVector(actual, expected)) {
      fail(`黄金向量不符 ${tag}：实际 ${JSON.stringify(actual)} ≠ 期望 ${JSON.stringify(expected)}`);
    }
  }

  // tags 编码升序
  const sortedTags = [...tags].sort((a, b) => a.code.localeCompare(b.code));
  const sortedMatrix: Record<string, Record<string, number>> = {};
  for (const t of sortedTags) if (matrix[t.code]) sortedMatrix[t.code] = matrix[t.code];

  return {
    json: {
      generatedFrom: "V2/03_标签干预匹配表.xlsx",
      generatedAt: GENERATED_AT,
      scoreSemantics: {
        forced: 100,
        forbidden: -100,
        unrelated: 0,
        normalMin: 2,
        normalMax: 10,
        note: "matrix 稀疏存储，未出现的对视为 0",
      },
      categories: [
        { key: "exercise", label: "运动干预", codePrefix: "YD", count: 10, mediaType: "video" },
        { key: "diet", label: "膳食营养", codePrefix: "SS", count: 10, mediaType: "image" },
        { key: "tcmFood", label: "中医食养", codePrefix: "ZY", count: 10, mediaType: "image" },
        { key: "referral", label: "就诊建议", codePrefix: "JZ", count: 15, mediaType: "text" },
        { key: "other", label: "其他", codePrefix: "QT", count: 15, mediaType: "mixed" },
      ],
      tags: sortedTags.map((t) => ({ code: t.code, name: t.name })),
      matrix: sortedMatrix,
    },
    nonzeroCount,
  };
}

// ============================================================================
// E. figure 1.png → public/interventions/bristol-stool.png（+ webp 派生）
// ============================================================================

const IMAGE_TARGET_BYTES = 600 * 1024;

async function compressBristol(): Promise<{ pngBytes: number; webpBytes: number }> {
  fs.mkdirSync(PUBLIC_INTERVENTIONS_DIR, { recursive: true });
  const out = path.join(PUBLIC_INTERVENTIONS_DIR, "bristol-stool.png");
  // palette 量化压缩，quality 逐级下调直到达标（写法对齐 scripts/convert-rules.ts 的图片压缩段）
  let bytes = 0;
  for (const quality of [90, 80, 70, 60, 50]) {
    await sharp(BRISTOL_PNG).png({ palette: true, quality, compressionLevel: 9 }).toFile(out);
    bytes = fs.statSync(out).size;
    if (bytes <= IMAGE_TARGET_BYTES) break;
  }
  if (bytes > IMAGE_TARGET_BYTES) {
    console.warn(`⚠ bristol-stool.png 压缩后 ${(bytes / 1024).toFixed(0)}KB 仍超 600KB 目标（告警不中止）`);
  }
  await sharp(BRISTOL_PNG).webp({ quality: 90 }).toFile(path.join(PUBLIC_INTERVENTIONS_DIR, "bristol-stool.webp"));
  const webpBytes = fs.statSync(path.join(PUBLIC_INTERVENTIONS_DIR, "bristol-stool.webp")).size;
  return { pngBytes: bytes, webpBytes };
}

// ============================================================================
// F. data/judgments-v2.json 校验（02 表判定规则的手工整理，本脚本只校验不生成）
// ============================================================================

// MVP 42 量表（M10.3b-2：01 表全部可评分量表均须收录判定配置）
const MVP_JUDGMENT_SCALE_IDS = [
  "adl", "iadl", "motor_screen", "sppb", "vision", "visual_function", "hearing", "whisper",
  "minicog", "mmse", "depression_2q", "gds15", "anxiety_2q", "gad7", "lubben", "home_env",
  "fall_3q", "morse", "frail", "ui_2q", "iciq", "constipation_1q", "constipation_symptom",
  "sleep_1q", "ais", "pain_1q", "pain_nrs", "pain_behavior", "pressure_screen", "braden",
  "polypharmacy", "dysphagia_screen", "water_swallow", "nrs2002", "mnasf", "glim",
  "calf", "grip", "gait_speed", "dxa_bia", "cam", "tcm_constitution",
];

// 中医偏颇体质分组题数定义（来源：02 表 + 01 表题目归属；湿热质含 A.6-3/A.6-4 性别互斥两题故为 4）
const TCM_BIASED_EXPECTED_COUNT: Record<string, number> = {
  qi_deficiency: 3, yang_deficiency: 3, yin_deficiency: 3, phlegm_dampness: 3,
  damp_heat: 4, blood_stasis: 3, qi_stagnation: 3, special_constitution: 4,
};

interface JudgmentEntry {
  type: string;
  scoredItemIds?: string[];
  ranges?: { tagCode: string; min: number; max: number }[];
  yesLabels?: string[];
  positiveTagCode?: string;
  negativeTagCode?: string;
  thresholds?: Record<string, number>;
  balanced?: { questionIds: string[]; reverseItemIds?: string[]; tagCodes: Record<string, string> };
  biased?: { key: string; questionIds: string[]; tagCodes: Record<string, string> }[];
  educationThresholds?: Record<string, number>;
  normalTagCode?: string;
  declineTagCode?: string;
  rules?: { itemId: string; whenLabel: string; tagCode: string }[];
  /** ladderScore */
  stepItemIds?: string[];
  /** anyBelowThreshold */
  threshold?: number;
  /** initialGateSumRange */
  initialItemIds?: string[];
  initialPositiveTagCode?: string;
  initialNegativeTagCode?: string;
  finalScoredItemIds?: string[];
  finalRanges?: { tagCode: string; min: number; max: number }[];
  /** compositeAllAny */
  groups?: { anyOf: { itemId: string; labels: string[] }[] }[];
  severeWhen?: { anyOf: { itemId: string; labels: string[] }[] };
  severeTagCode?: string;
}

interface JudgmentFile {
  scales: {
    scaleId: string;
    /** M10.3b 起为数组（1～N 份判定，引擎依次执行并合并结果） */
    judgments: JudgmentEntry[];
  }[];
}

function validateJudgmentsV2(scales: Scale[], tags: ResultTag[]): number {
  const file = path.join(DATA_DIR, "judgments-v2.json");
  if (!fs.existsSync(file)) fail("缺少 data/judgments-v2.json（02 表判定规则的手工整理文件）");
  const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as JudgmentFile;
  const scaleById = new Map(scales.map((s) => [s.id, s]));
  const tagCodes = new Set(tags.map((t) => t.code));
  const seenScaleIds = new Set<string>();

  const checkTag = (scaleId: string, code: string | undefined, what: string): void => {
    if (!code || !tagCodes.has(code)) fail(`judgments-v2：量表 ${scaleId} 的 ${what}「${code ?? "缺失"}」不在 02 表 190 编码内`);
    // 占位标签（{score}/{count}/{clinical_type} 5 个）只供展示模板，禁止由判定配置自动产出
    if (tags.find((t) => t.code === code)?.placeholder) {
      fail(`judgments-v2：量表 ${scaleId} 的 ${what}「${code}」是占位标签，不允许自动产出`);
    }
  };
  /** 条目必须属于该量表且有可解析 options；requireScoredOptions 时所有选项必须带分值 */
  const checkItem = (scale: Scale, itemId: string, requireScoredOptions: boolean): void => {
    const item = scale.items.find((i) => i.id === itemId);
    if (!item) fail(`judgments-v2：条目 ${itemId} 不属于量表 ${scale.id}`);
    if (item.options === null) fail(`judgments-v2：条目 ${itemId} 无可解析 options（optionsRaw 未解析）`);
    if (requireScoredOptions && item.options.some((o) => o.score === null)) {
      fail(`judgments-v2：sumRange 计分条目 ${itemId} 存在无分选项（score=null）`);
    }
  };

  for (const { scaleId, judgments } of parsed.scales) {
    if (seenScaleIds.has(scaleId)) fail(`judgments-v2：量表 ${scaleId} 判定配置重复`);
    seenScaleIds.add(scaleId);
    const scale = scaleById.get(scaleId);
    if (!scale) fail(`judgments-v2：量表 ${scaleId} 不存在于 scales-v2.json`);
    if (!Array.isArray(judgments) || judgments.length === 0) {
      fail(`judgments-v2：量表 ${scaleId} judgments 缺失或为空数组（M10.3b 起每量表 1～N 份判定配置）`);
    }

    for (const judgment of judgments) {
    if (judgment.type === "sumRange") {
      const ids = judgment.scoredItemIds ?? [];
      if (ids.length === 0) fail(`judgments-v2：量表 ${scaleId} scoredItemIds 为空`);
      let maxPossible = 0;
      for (const id of ids) {
        checkItem(scale, id, true);
        const item = scale.items.find((i) => i.id === id)!;
        maxPossible += Math.max(...item.options!.map((o) => o.score!));
      }
      const ranges = [...(judgment.ranges ?? [])].sort((a, b) => a.min - b.min);
      if (ranges.length === 0) fail(`judgments-v2：量表 ${scaleId} ranges 为空`);
      for (const r of ranges) {
        checkTag(scaleId, r.tagCode, "区间标签");
        if (r.min > r.max) fail(`judgments-v2：量表 ${scaleId} 区间 [${r.min},${r.max}] min>max`);
      }
      // 区间必须连续不重叠且恰好覆盖 [0, 满分]（豁免计分时总分可能落在任意中间值）
      if (ranges[0].min !== 0) fail(`judgments-v2：量表 ${scaleId} 区间未从 0 开始`);
      for (let i = 1; i < ranges.length; i++) {
        if (ranges[i].min !== ranges[i - 1].max + 1) {
          fail(`judgments-v2：量表 ${scaleId} 区间 [${ranges[i - 1].min},${ranges[i - 1].max}] 与 [${ranges[i].min},${ranges[i].max}] 重叠或断档`);
        }
      }
      if (ranges[ranges.length - 1].max !== maxPossible) {
        fail(`judgments-v2：量表 ${scaleId} 区间上限 ${ranges[ranges.length - 1].max} ≠ 满分 ${maxPossible}`);
      }
    } else if (judgment.type === "anyYes") {
      const ids = judgment.scoredItemIds ?? [];
      if (ids.length === 0) fail(`judgments-v2：量表 ${scaleId} scoredItemIds 为空`);
      const yesLabels = judgment.yesLabels ?? [];
      if (yesLabels.length === 0) fail(`judgments-v2：量表 ${scaleId} yesLabels 为空`);
      // M10.3b 放宽：不同条目的阳性选项文案可不同（如 pressure_screen 的「是（筛查阳性）」与
      // 「发现皮肤异常（筛查阳性）」）——每个 yesLabel 须至少是某一个计分条目的合法选项，
      // 且每个计分条目须至少含一个 yesLabel（否则该题永不能触发阳性，配置必有误）。
      const allLabels = new Set(ids.flatMap((id) => scale.items.find((i) => i.id === id)?.options?.map((o) => o.label) ?? []));
      for (const id of ids) {
        checkItem(scale, id, false);
        const labels = scale.items.find((i) => i.id === id)!.options!.map((o) => o.label);
        if (!yesLabels.some((y) => labels.includes(y))) {
          fail(`judgments-v2：量表 ${scaleId} 条目 ${id} 的选项中不含任何 yesLabel`);
        }
      }
      for (const y of yesLabels) {
        if (!allLabels.has(y)) fail(`judgments-v2：量表 ${scaleId} 的 yesLabel「${y}」不是任何计分条目的合法选项`);
      }
      checkTag(scaleId, judgment.positiveTagCode, "阳性标签");
      checkTag(scaleId, judgment.negativeTagCode, "阴性标签");
    } else if (judgment.type === "perQuestionTags") {
      // 单题标签判定（M10.3b）：itemId 存在且 options 可解析、whenLabel 是该条目合法选项、tagCode 在 190 内
      const rules = judgment.rules ?? [];
      if (rules.length === 0) fail(`judgments-v2：量表 ${scaleId} perQuestionTags rules 为空`);
      const seenRules = new Set<string>();
      for (const rule of rules) {
        checkItem(scale, rule.itemId, false);
        const labels = scale.items.find((i) => i.id === rule.itemId)!.options!.map((o) => o.label);
        if (!labels.includes(rule.whenLabel)) {
          fail(`judgments-v2：量表 ${scaleId} 条目 ${rule.itemId} 的选项中无 whenLabel「${rule.whenLabel}」`);
        }
        checkTag(scaleId, rule.tagCode, `条目 ${rule.itemId} 单题标签`);
        const key = `${rule.itemId}::${rule.whenLabel}::${rule.tagCode}`;
        if (seenRules.has(key)) fail(`judgments-v2：量表 ${scaleId} perQuestionTags 规则重复（${key}）`);
        seenRules.add(key);
      }
    } else if (judgment.type === "tcmConstitutionV2") {
      const t = judgment.thresholds ?? {};
      for (const key of ["biasedYesMin", "biasedTendencyMin", "balancedMin", "othersMaxForYes", "othersMaxForBasically"]) {
        if (typeof t[key] !== "number") fail(`judgments-v2：量表 ${scaleId} thresholds.${key} 缺失或不是数字`);
      }
      if (!(t.biasedTendencyMin < t.biasedYesMin)) fail(`judgments-v2：量表 ${scaleId} 偏颇阈值 tendencyMin 必须 < yesMin`);
      if (!(t.othersMaxForYes < t.othersMaxForBasically)) fail(`judgments-v2：量表 ${scaleId} 平和阈值 othersMaxForYes 必须 < othersMaxForBasically`);
      const balanced = judgment.balanced;
      if (!balanced || balanced.questionIds.length !== 4) fail(`judgments-v2：量表 ${scaleId} 平和质必须恰 4 题`);
      // 平和质负向题反向计分声明（来源：国标 CCMQ）：必须全部落在平和质组 questionIds 内
      for (const id of balanced.reverseItemIds ?? []) {
        if (!balanced.questionIds.includes(id)) {
          fail(`judgments-v2：量表 ${scaleId} 平和质 reverseItemIds「${id}」不在 questionIds 内`);
        }
      }
      for (const code of Object.values(balanced.tagCodes)) checkTag(scaleId, code, "平和质标签");
      const biased = judgment.biased ?? [];
      if (biased.length !== 8) fail(`judgments-v2：量表 ${scaleId} 偏颇体质必须恰 8 组`);
      const seenKeys = new Set<string>();
      for (const b of biased) {
        if (seenKeys.has(b.key)) fail(`judgments-v2：量表 ${scaleId} 偏颇体质 key 重复「${b.key}」`);
        seenKeys.add(b.key);
        const expected = TCM_BIASED_EXPECTED_COUNT[b.key];
        if (expected === undefined) fail(`judgments-v2：量表 ${scaleId} 未知偏颇体质 key「${b.key}」`);
        if (b.questionIds.length !== expected) fail(`judgments-v2：量表 ${scaleId} 体质 ${b.key} 题数 ${b.questionIds.length} ≠ 定义 ${expected}`);
        for (const code of Object.values(b.tagCodes)) checkTag(scaleId, code, `体质 ${b.key} 标签`);
      }
      // 27 个计分题全覆盖：平和+偏颇分组并集 = 量表内全部有可解析 options 的条目（30 题 − 3 纯复用行）
      const allQ = [...balanced.questionIds, ...biased.flatMap((b) => b.questionIds)];
      for (const id of allQ) checkItem(scale, id, false);
      const scoredSet = new Set(scale.items.filter((i) => i.options !== null).map((i) => i.id));
      if (new Set(allQ).size !== scoredSet.size || ![...scoredSet].every((id) => allQ.includes(id))) {
        fail(`judgments-v2：量表 ${scaleId} 分组并集 ≠ 27 个计分题全集`);
      }
    } else if (judgment.type === "thresholdByEducation") {
      // MMSE 按文化程度分层判定（来源：02 表；四档枚举映射见 src/lib/scoring-v2/education.ts）
      const ids = judgment.scoredItemIds ?? [];
      if (ids.length === 0) fail(`judgments-v2：量表 ${scaleId} scoredItemIds 为空`);
      let maxPossible = 0;
      for (const id of ids) {
        checkItem(scale, id, true);
        const item = scale.items.find((i) => i.id === id)!;
        maxPossible += Math.max(...item.options!.map((o) => o.score!));
      }
      const th = judgment.educationThresholds ?? {};
      const bands = ["illiterate", "primary", "secondary", "college"] as const;
      for (const b of bands) {
        if (typeof th[b] !== "number") fail(`judgments-v2：量表 ${scaleId} educationThresholds.${b} 缺失或不是数字`);
        // 界值必须落在 [0, 满分) 内，否则该档永判正常或永判减退
        if (th[b] < 0 || th[b] >= maxPossible) {
          fail(`judgments-v2：量表 ${scaleId} educationThresholds.${b}=${th[b]} 超出 [0, 满分 ${maxPossible}) 范围`);
        }
      }
      if (!(th.illiterate < th.primary && th.primary < th.secondary && th.secondary < th.college)) {
        fail(`judgments-v2：量表 ${scaleId} 四档界值必须单调递增（illiterate < primary < secondary < college）`);
      }
      // education 映射必须覆盖 Patient.education 全枚举（EDUCATION_LEVELS），且映射目标恰为四档 key。
      // EDUCATION_LEVELS 定义在 patient-intake.ts（依赖 Prisma，脚本不引入），此处枚举值与其保持一致
      // 由 tests/scoring-v2-mmse.test.ts 的映射覆盖用例双侧把守。
      const EDUCATION_LEVELS = ["文盲", "小学", "初中", "高中中专技校", "大专及以上"];
      for (const level of EDUCATION_LEVELS) {
        if (!(level in EDUCATION_BANDS)) {
          fail(`judgments-v2：education 映射（scoring-v2/education.ts）未覆盖文化程度枚举「${level}」`);
        }
      }
      for (const [level, band] of Object.entries(EDUCATION_BANDS)) {
        if (!(bands as readonly string[]).includes(band)) {
          fail(`judgments-v2：education 映射「${level}」→「${band}」不是合法四档 key`);
        }
      }
      checkTag(scaleId, judgment.normalTagCode, "正常标签");
      checkTag(scaleId, judgment.declineTagCode, "减退标签");
    } else if (judgment.type === "ladderScore") {
      // 阶梯计分（视力/听力）：step 条目须可解析；ranges 覆盖 [0, 阶梯最大有分值]
      const steps = judgment.stepItemIds ?? [];
      if (steps.length === 0) fail(`judgments-v2：量表 ${scaleId} stepItemIds 为空`);
      let maxStep = 0;
      for (const id of steps) {
        checkItem(scale, id, false);
        const item = scale.items.find((i) => i.id === id)!;
        const scored = item.options!.map((o) => o.score).filter((s): s is number => s !== null);
        if (scored.length === 0) fail(`judgments-v2：量表 ${scaleId} 阶梯条目 ${id} 无任何有分值选项`);
        maxStep = Math.max(maxStep, ...scored);
      }
      const ranges = [...(judgment.ranges ?? [])].sort((a, b) => a.min - b.min);
      if (ranges.length === 0) fail(`judgments-v2：量表 ${scaleId} ladderScore ranges 为空`);
      for (const r of ranges) {
        checkTag(scaleId, r.tagCode, "阶梯区间标签");
        if (r.min > r.max) fail(`judgments-v2：量表 ${scaleId} 阶梯区间 [${r.min},${r.max}] min>max`);
      }
      if (ranges[0].min !== 0) fail(`judgments-v2：量表 ${scaleId} 阶梯区间未从 0 开始`);
      for (let i = 1; i < ranges.length; i++) {
        if (ranges[i].min !== ranges[i - 1].max + 1) {
          fail(`judgments-v2：量表 ${scaleId} 阶梯区间断档或重叠`);
        }
      }
      if (ranges[ranges.length - 1].max !== maxStep) {
        fail(`judgments-v2：量表 ${scaleId} 阶梯区间上限 ${ranges[ranges.length - 1].max} ≠ 最大有分值 ${maxStep}`);
      }
    } else if (judgment.type === "anyBelowThreshold") {
      const ids = judgment.scoredItemIds ?? [];
      if (ids.length === 0) fail(`judgments-v2：量表 ${scaleId} scoredItemIds 为空`);
      if (typeof judgment.threshold !== "number") fail(`judgments-v2：量表 ${scaleId} threshold 缺失`);
      for (const id of ids) checkItem(scale, id, true);
      checkTag(scaleId, judgment.positiveTagCode, "阳性标签");
      checkTag(scaleId, judgment.negativeTagCode, "阴性标签");
    } else if (judgment.type === "initialGateSumRange") {
      const initIds = judgment.initialItemIds ?? [];
      const finalIds = judgment.finalScoredItemIds ?? [];
      const yesLabels = judgment.yesLabels ?? [];
      if (initIds.length === 0) fail(`judgments-v2：量表 ${scaleId} initialItemIds 为空`);
      if (finalIds.length === 0) fail(`judgments-v2：量表 ${scaleId} finalScoredItemIds 为空`);
      if (yesLabels.length === 0) fail(`judgments-v2：量表 ${scaleId} yesLabels 为空`);
      for (const id of initIds) checkItem(scale, id, false);
      let maxPossible = 0;
      for (const id of finalIds) {
        checkItem(scale, id, true);
        const item = scale.items.find((i) => i.id === id)!;
        maxPossible += Math.max(...item.options!.map((o) => o.score!));
      }
      const allLabels = new Set(
        initIds.flatMap((id) => scale.items.find((i) => i.id === id)?.options?.map((o) => o.label) ?? [])
      );
      for (const y of yesLabels) {
        if (!allLabels.has(y)) fail(`judgments-v2：量表 ${scaleId} 的 yesLabel「${y}」不是初筛条目合法选项`);
      }
      checkTag(scaleId, judgment.initialPositiveTagCode, "初筛阳性标签");
      checkTag(scaleId, judgment.initialNegativeTagCode, "初筛阴性标签");
      const ranges = [...(judgment.finalRanges ?? [])].sort((a, b) => a.min - b.min);
      if (ranges.length === 0) fail(`judgments-v2：量表 ${scaleId} finalRanges 为空`);
      for (const r of ranges) {
        checkTag(scaleId, r.tagCode, "终筛区间标签");
        if (r.min > r.max) fail(`judgments-v2：量表 ${scaleId} 终筛区间 [${r.min},${r.max}] min>max`);
      }
      if (ranges[0].min !== 0) fail(`judgments-v2：量表 ${scaleId} 终筛区间未从 0 开始`);
      for (let i = 1; i < ranges.length; i++) {
        if (ranges[i].min !== ranges[i - 1].max + 1) {
          fail(`judgments-v2：量表 ${scaleId} 终筛区间断档或重叠`);
        }
      }
      if (ranges[ranges.length - 1].max !== maxPossible) {
        fail(`judgments-v2：量表 ${scaleId} 终筛区间上限 ${ranges[ranges.length - 1].max} ≠ 满分 ${maxPossible}`);
      }
    } else if (judgment.type === "compositeAllAny") {
      const groups = judgment.groups ?? [];
      if (groups.length === 0) fail(`judgments-v2：量表 ${scaleId} composite groups 为空`);
      const checkAnyOf = (anyOf: { itemId: string; labels: string[] }[] | undefined, what: string): void => {
        if (!anyOf || anyOf.length === 0) fail(`judgments-v2：量表 ${scaleId} ${what} anyOf 为空`);
        for (const rule of anyOf!) {
          checkItem(scale, rule.itemId, false);
          if (!rule.labels || rule.labels.length === 0) {
            fail(`judgments-v2：量表 ${scaleId} ${what} 条目 ${rule.itemId} labels 为空`);
          }
          const labels = scale.items.find((i) => i.id === rule.itemId)!.options!.map((o) => o.label);
          for (const lab of rule.labels) {
            if (!labels.includes(lab)) {
              fail(`judgments-v2：量表 ${scaleId} ${what} 条目 ${rule.itemId} 无 label「${lab}」`);
            }
          }
        }
      };
      for (let i = 0; i < groups.length; i++) checkAnyOf(groups[i].anyOf, `groups[${i}]`);
      checkTag(scaleId, judgment.positiveTagCode, "组合阳性标签");
      checkTag(scaleId, judgment.negativeTagCode, "组合阴性标签");
      if (judgment.severeWhen || judgment.severeTagCode) {
        if (!judgment.severeWhen || !judgment.severeTagCode) {
          fail(`judgments-v2：量表 ${scaleId} severeWhen 与 severeTagCode 须同时配置`);
        }
        checkAnyOf(judgment.severeWhen!.anyOf, "severeWhen");
        checkTag(scaleId, judgment.severeTagCode, "重度标签");
      }
    } else {
      fail(`judgments-v2：量表 ${scaleId} 未知判定类型「${judgment.type}」`);
    }
    }
  }

  for (const id of MVP_JUDGMENT_SCALE_IDS) {
    if (!seenScaleIds.has(id)) fail(`judgments-v2：MVP 量表 ${id} 未收录判定配置`);
  }
  return parsed.scales.length;
}

// ============================================================================
// main
// ============================================================================

function writeJson(file: string, data: unknown): void {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

async function main(): Promise<void> {
  const scales = buildScalesV2();
  const scaleCount = (scales.json as { scales: Scale[] }).scales.length;
  const narrationCount = (scales.json as { narrations: Narration[] }).narrations.length;
  const itemCount = (scales.json as { scales: Scale[] }).scales.reduce((s, x) => s + x.items.length, 0);

  const resultTags = buildResultTags(scales.scaleNames);
  const interventions = buildInterventionsV2();
  const scoring = buildScoringV2(resultTags.tags, interventions.interventions);
  const bristol = await compressBristol();
  const judgmentScaleCount = validateJudgmentsV2(
    (scales.json as { scales: Scale[] }).scales,
    resultTags.tags,
  );

  writeJson(path.join(DATA_DIR, "scales-v2.json"), scales.json);
  writeJson(path.join(DATA_DIR, "result-tags.json"), resultTags.json);
  writeJson(path.join(DATA_DIR, "intervention-scoring-v2.json"), scoring.json);
  writeJson(path.join(DATA_DIR, "interventions-v2.json"), interventions.json);

  const mediaDist = interventions.interventions.reduce<Record<string, number>>((acc, x) => {
    acc[x.mediaType] = (acc[x.mediaType] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`✓ data/scales-v2.json：${scaleCount} 量表 / ${itemCount} 条目 / ${narrationCount} 旁白`);
  console.log(`✓ data/result-tags.json：${resultTags.tags.length} 标签（占位 ${resultTags.tags.filter((t) => t.placeholder).length} 个）`);
  console.log(`✓ data/intervention-scoring-v2.json：190 标签 × 60 干预 = 11400 对校验通过，稀疏矩阵非零 ${scoring.nonzeroCount} 条（强制 1 / 禁用 37）`);
  console.log(`✓ data/interventions-v2.json：60 项（video=${mediaDist.video ?? 0} / image=${mediaDist.image ?? 0} / text=${mediaDist.text ?? 0}），素材已就位 ${interventions.interventions.filter((x) => x.mediaAvailable).length}/60`);
  console.log(`✓ public/interventions/bristol-stool.png：${(bristol.pngBytes / 1024).toFixed(0)}KB + .webp ${(bristol.webpBytes / 1024).toFixed(0)}KB`);
  console.log(`✓ data/judgments-v2.json：${judgmentScaleCount} 个量表判定配置校验通过（MVP ${MVP_JUDGMENT_SCALE_IDS.length} 量表齐全）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
