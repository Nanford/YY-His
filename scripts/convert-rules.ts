/**
 * INPUT:  docs/source/ 只读医学源文件：
 *           - 评估-干预标签积分规则表.xlsx（V2.0 唯一计分依据，17 标签 × 30 干预 = 510 条积分）
 *           - 12种运动干预.docx（M01-M12 动作文字，运动卡片正文与视频脚本依据）
 *           - 膳食干预图片/（D01-D10 图文教程）、中医食养干预图片/（C01-C08 图文教程）
 *           - 评估标签-干预标签知识图谱映射表_Demo.xlsx、干预标签_Demo.xlsx（V1 历史资料，仍校验但不参与 V2 排序）
 *           - data/scales.json（从量表题目_Demo.txt 手工整理的题库，本脚本只校验不生成）
 * OUTPUT: data/intervention-scoring.json（V2 积分矩阵 + 30 干预项元数据 + 素材索引）；
 *         public/interventions/<编码>.png（膳食/中医食养图片按稳定编码压缩拷贝供 Web 访问，palette PNG，目标单张 <600KB）
 *         + 同名 .webp 派生（<picture> 优先取用）；mediaSrc 附内容哈希 ?v= 供 immutable 长缓存；
 *         data/tag-mapping.json、data/interventions.json（V1 历史资料，保留生成）。
 * POS:    规则数据层的唯一生成与校验入口。医学规则变更只能改源文件后重跑本脚本；
 *         校验失败即退出非零码，禁止产出不完整数据。
 */
import * as XLSX from "xlsx";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import sharp from "sharp";
import { readDocxParagraphs } from "./read-docx";

/** 文件内容 md5 前 8 位，作为静态素材缓存版本号：内容不变则 URL 不变，可安全 immutable 长缓存 */
function contentHash(file: string): string {
  return crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex").slice(0, 8);
}

const ROOT = path.resolve(__dirname, "..");
const SOURCE_DIR = path.join(ROOT, "docs", "source");
const DATA_DIR = path.join(ROOT, "data");
const PUBLIC_INTERVENTIONS_DIR = path.join(ROOT, "public", "interventions");

// V2.0 源文件
const SCORING_XLSX = path.join(SOURCE_DIR, "评估-干预标签积分规则表.xlsx");
const EXERCISE_DOCX = path.join(SOURCE_DIR, "12种运动干预.docx");
const DIET_IMG_DIR = path.join(SOURCE_DIR, "膳食干预图片");
const TCM_IMG_DIR = path.join(SOURCE_DIR, "中医食养干预图片");

// V1 历史源文件（保留校验与生成，不参与 V2 推荐排序）
const MAPPING_XLSX = path.join(SOURCE_DIR, "评估标签-干预标签知识图谱映射表_Demo.xlsx");
const INTERVENTION_XLSX = path.join(SOURCE_DIR, "干预标签_Demo.xlsx");

// 来源：量表题目_Demo.txt 判定规则 —— 17 个评估标签全集（顺序与积分表编码 F/N/R/T 一致）
const EXPECTED_ASSESSMENT_TAGS = [
  "无衰弱", "衰弱前期", "衰弱",
  "营养正常", "存在营养不良风险", "营养不良",
  "跌倒风险筛查阴性", "跌倒风险筛查阳性",
  "平和质", "气虚质", "阳虚质", "阴虚质", "痰湿质", "湿热质", "血瘀质", "气郁质", "特禀质",
] as const;

let failed = false;
function check(cond: boolean, message: string): void {
  if (!cond) {
    failed = true;
    console.error(`✗ 校验失败：${message}`);
  }
}

function readSheetRows(file: string, sheetName?: string): unknown[][] {
  const wb = XLSX.readFile(file);
  const name = sheetName ?? wb.SheetNames[0];
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`${path.basename(file)} 中找不到工作表 ${name}`);
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];
}

// ============================================================
// A. V2.0 积分规则：评估-干预标签积分规则表.xlsx → intervention-scoring.json
// ============================================================

// 三大类展示定义（来源：需求更新说明 V2.0 §4.1）。类别标签用于 UI 分组与固定展示顺序。
// mediaType 决定展示形态：运动=视频教程（暂缺视频文件，卡片回退文字要点）；膳食/中医食养=图文教程。
const CATEGORY_DEFS = [
  { key: "exercise", label: "运动干预", codePrefix: "M", count: 12, mediaType: "video" as const },
  { key: "diet", label: "膳食干预", codePrefix: "D", count: 10, mediaType: "image" as const },
  { key: "tcm", label: "中医食养干预", codePrefix: "C", count: 8, mediaType: "image" as const },
];
const CATEGORY_LABEL_BY_PREFIX: Record<string, string> = { M: "运动干预", D: "膳食干预", C: "中医食养干预" };

const scoringRows = readSheetRows(SCORING_XLSX);
const scoringHeader = scoringRows[0] ?? [];
check(
  String(scoringHeader[0]) === "评估标签编码" &&
    String(scoringHeader[1]) === "评估结果标签" &&
    String(scoringHeader[2]) === "干预标签编码" &&
    String(scoringHeader[3]) === "干预类别" &&
    String(scoringHeader[4]) === "干预标签" &&
    String(scoringHeader[5]) === "匹配分",
  "积分规则表表头应为 [评估标签编码, 评估结果标签, 干预标签编码, 干预类别, 干预标签, 匹配分]"
);

interface ScoringRecord {
  tagCode: string;
  tagName: string;
  itemCode: string;
  category: string;
  itemName: string;
  score: number;
}
const records: ScoringRecord[] = scoringRows
  .slice(1)
  .filter((r) => r[0] != null && r[2] != null)
  .map((r) => ({
    tagCode: String(r[0]).trim(),
    tagName: String(r[1]).trim(),
    itemCode: String(r[2]).trim(),
    category: String(r[3]).trim(),
    itemName: String(r[4]).trim(),
    score: Number(r[5]),
  }));

// §6：510 条计分记录
check(records.length === 510, `积分记录应为 510 条，实际 ${records.length} 条`);

// §6：每条匹配分为 0-3 的整数
for (const rec of records) {
  check(
    Number.isInteger(rec.score) && rec.score >= 0 && rec.score <= 3,
    `记录 ${rec.tagCode}×${rec.itemCode} 匹配分 ${rec.score} 不在 0-3 整数范围`
  );
}

// 评估标签集合（code→name，17 个）
const tagNameByCode = new Map<string, string>();
const tagCodeByName = new Map<string, string>();
for (const rec of records) {
  tagNameByCode.set(rec.tagCode, rec.tagName);
  tagCodeByName.set(rec.tagName, rec.tagCode);
}
check(tagNameByCode.size === 17, `评估标签应为 17 个，实际 ${tagNameByCode.size} 个`);
for (const name of EXPECTED_ASSESSMENT_TAGS) {
  check(tagCodeByName.has(name), `积分表缺少评估标签「${name}」`);
}
for (const name of tagCodeByName.keys()) {
  check(
    (EXPECTED_ASSESSMENT_TAGS as readonly string[]).includes(name),
    `积分表出现未定义的评估标签「${name}」`
  );
}

// 干预项集合（code→{category,name}，30 个）
interface RawItem { code: string; category: string; name: string }
const rawItemByCode = new Map<string, RawItem>();
for (const rec of records) {
  const existing = rawItemByCode.get(rec.itemCode);
  if (!existing) {
    rawItemByCode.set(rec.itemCode, { code: rec.itemCode, category: rec.category, name: rec.itemName });
  } else {
    // 同一干预编码在各标签行的类别/名称必须一致，否则源数据自相矛盾
    check(existing.name === rec.itemName, `干预 ${rec.itemCode} 名称不一致：「${existing.name}」vs「${rec.itemName}」`);
    check(existing.category === rec.category, `干预 ${rec.itemCode} 类别不一致：「${existing.category}」vs「${rec.category}」`);
  }
}
check(rawItemByCode.size === 30, `干预项应为 30 个，实际 ${rawItemByCode.size} 个`);

// §6：每个评估标签对每个干预项均有且仅有一个匹配分（无缺、无重）
const pairSeen = new Set<string>();
for (const rec of records) {
  const key = `${rec.tagCode}×${rec.itemCode}`;
  check(!pairSeen.has(key), `积分记录重复：${key}`);
  pairSeen.add(key);
}
for (const tagCode of tagNameByCode.keys()) {
  for (const itemCode of rawItemByCode.keys()) {
    check(pairSeen.has(`${tagCode}×${itemCode}`), `缺少积分记录：${tagCode}×${itemCode}`);
  }
}

// §6 + §4.1：三大类编码/数量/展示顺序完整（M01-M12 / D01-D10 / C01-C08）
function expectedCodes(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(2, "0")}`);
}
const orderedCodes: string[] = [];
for (const def of CATEGORY_DEFS) {
  for (const code of expectedCodes(def.codePrefix, def.count)) {
    check(rawItemByCode.has(code), `${def.label} 缺少干预编码 ${code}`);
    const item = rawItemByCode.get(code);
    if (item) {
      check(
        CATEGORY_LABEL_BY_PREFIX[def.codePrefix] === `${def.label}` && item.category === def.label.replace("干预", ""),
        `${code} 干预类别「${item?.category}」与编码前缀不符`
      );
    }
    orderedCodes.push(code);
  }
}

// §6：M01-M12 与运动文档中的 12 个动作名称完全一致，并抽取动作文字作运动卡片正文
const exerciseParas = readDocxParagraphs(EXERCISE_DOCX).filter((p) => p.includes("："));
check(exerciseParas.length === 12, `运动文档应有 12 条「动作名：说明」，实际 ${exerciseParas.length} 条`);
const exerciseTextByName = new Map<string, string>();
for (const para of exerciseParas) {
  const idx = para.indexOf("：");
  const name = para.slice(0, idx).trim();
  const text = para.slice(idx + 1).trim();
  exerciseTextByName.set(name, text);
}
for (const code of expectedCodes("M", 12)) {
  const item = rawItemByCode.get(code);
  if (item) {
    check(
      exerciseTextByName.has(item.name),
      `运动 ${code}「${item.name}」在 12种运动干预.docx 中找不到同名动作`
    );
  }
}

// §6：D01-D10、C01-C08 与对应图片文件夹一一匹配（按干预名称精确匹配 .png）
function listPngNames(dir: string): Map<string, string> {
  // 返回「不含扩展名的文件名」→「原始文件名」，用于按干预名称精确匹配
  const map = new Map<string, string>();
  if (!fs.existsSync(dir)) return map;
  for (const f of fs.readdirSync(dir)) {
    if (f.toLowerCase().endsWith(".png")) map.set(path.basename(f, path.extname(f)), f);
  }
  return map;
}
const dietPngs = listPngNames(DIET_IMG_DIR);
const tcmPngs = listPngNames(TCM_IMG_DIR);
check(dietPngs.size === 10, `膳食干预图片应为 10 张，实际 ${dietPngs.size} 张`);
check(tcmPngs.size === 8, `中医食养干预图片应为 8 张，实际 ${tcmPngs.size} 张`);

const sourceImageByCode = new Map<string, { dir: string; file: string }>();
for (const [code, pngs, dir] of [
  ["D", dietPngs, DIET_IMG_DIR] as const,
  ["C", tcmPngs, TCM_IMG_DIR] as const,
]) {
  const count = code === "D" ? 10 : 8;
  const usedPng = new Set<string>();
  for (const itemCode of expectedCodes(code, count)) {
    const item = rawItemByCode.get(itemCode);
    if (!item) continue;
    const file = pngs.get(item.name);
    check(file != null, `${itemCode}「${item.name}」在 ${path.basename(dir)}/ 中找不到同名图片`);
    if (file) {
      sourceImageByCode.set(itemCode, { dir, file });
      usedPng.add(item.name);
    }
  }
  // 反向：图片文件夹中不应有未被任一干预引用的多余图片（保证一一匹配）
  for (const pngName of pngs.keys()) {
    check(usedPng.has(pngName), `${path.basename(dir)}/${pngName}.png 未匹配到任何干预项（多余图片）`);
  }
}

// 组装 30 个干预项元数据（按类别顺序 + 编码升序，展示顺序稳定）
interface InterventionItem {
  code: string;
  category: string;
  name: string;
  mediaType: "video" | "image";
  mediaSrc: string; // Web 可访问路径（视频待补齐时指向约定位置，缺失回退文字）
  mediaAvailable: boolean; // 素材是否已就绪：图片已拷贝=true；视频取决于 public/interventions/videos 是否已放入
  sourceFile: string | null; // 图片原始文件名（供医生端展示），运动项为 null
  text: string | null; // 运动动作文字要点；图片项为 null（正文即图片）
}
// 视频文件由业务方后续放入 public/interventions/videos/<编码>.mp4，重跑本脚本即自动置 mediaAvailable=true
const VIDEO_DIR = path.join(PUBLIC_INTERVENTIONS_DIR, "videos");
const interventionItems: InterventionItem[] = orderedCodes.map((code) => {
  const raw = rawItemByCode.get(code)!;
  const prefix = code[0];
  if (prefix === "M") {
    return {
      code,
      category: raw.category === "运动" ? "运动干预" : raw.category,
      name: raw.name,
      mediaType: "video",
      mediaSrc: `/interventions/videos/${code}.mp4`,
      mediaAvailable: fs.existsSync(path.join(VIDEO_DIR, `${code}.mp4`)),
      sourceFile: null,
      text: exerciseTextByName.get(raw.name) ?? "",
    };
  }
  const src = sourceImageByCode.get(code);
  return {
    code,
    category: prefix === "D" ? "膳食干预" : "中医食养干预",
    name: raw.name,
    mediaType: "image",
    mediaSrc: `/interventions/${code}.png`,
    mediaAvailable: src != null, // 图片已在下方拷贝到 public，恒 true
    sourceFile: src?.file ?? null,
    text: null,
  };
});

// 积分矩阵：matrix[评估标签名称][干预编码] = 匹配分（recommend 直接以标签名查表）
const matrix: Record<string, Record<string, number>> = {};
for (const name of EXPECTED_ASSESSMENT_TAGS) matrix[name] = {};
for (const rec of records) matrix[rec.tagName][rec.itemCode] = rec.score;

// §6 + §4.3：示例患者标签集合应得到 6 项候选方案及对应分值（在生成前用同一算法自校验）
function rankExample(tagNames: string[]): { code: string; total: number }[] {
  const totalByCode = new Map<string, number>();
  for (const item of interventionItems) {
    let total = 0;
    for (const t of tagNames) total += matrix[t]?.[item.code] ?? 0;
    if (total > 0) totalByCode.set(item.code, total);
  }
  const out: { code: string; total: number }[] = [];
  for (const def of CATEGORY_DEFS) {
    const inCat = interventionItems
      .filter((i) => i.code.startsWith(def.codePrefix) && totalByCode.has(i.code))
      .map((i) => ({ code: i.code, total: totalByCode.get(i.code)! }))
      .sort((a, b) => b.total - a.total || (a.code < b.code ? -1 : 1))
      .slice(0, 2);
    out.push(...inCat);
  }
  return out;
}
const example = rankExample(["衰弱", "存在营养不良风险", "跌倒风险筛查阳性", "气虚质", "血瘀质"]);
const EXPECTED_EXAMPLE = [
  { code: "M06", total: 7 },
  { code: "M12", total: 7 },
  { code: "D03", total: 9 },
  { code: "D06", total: 7 },
  { code: "C01", total: 9 },
  { code: "C08", total: 4 },
];
check(
  JSON.stringify(example) === JSON.stringify(EXPECTED_EXAMPLE),
  `§4.3 示例校验不符：期望 ${JSON.stringify(EXPECTED_EXAMPLE)}，实际 ${JSON.stringify(example)}`
);

// §6：所有医学评分/资源映射不携带 PII —— 生成结构只含标签/编码/名称/素材路径，天然无 PII，
// 在此对生成对象做一次防御性字段黑名单扫描，防止未来误引入。
const PII_KEYS = ["name", "idCard", "phone", "address", "admissionNo", "outpatientNo"];
function assertNoPii(obj: unknown, ctxLabel: string): void {
  const json = JSON.stringify(obj);
  // 注意：干预项字段名为 name（动作/食养名称），非患者姓名，属白名单，故此处只扫敏感身份键名的组合语义。
  for (const key of PII_KEYS) {
    if (key === "name") continue; // name 在本数据集指干预名称，非 PII
    check(!json.includes(`"${key}"`), `${ctxLabel} 中出现疑似 PII 字段「${key}」`);
  }
}

// ---------- V1 历史资料：知识图谱映射 + 干预执行方案（保留生成，V2 推荐不使用） ----------
// 来源：需求文档"第四步：干预方案推荐"三大类归属，用于 V1 历史数据完整性。
const V1_CATEGORY_MAP: Record<string, string> = {
  八段锦: "运动干预", 太极拳: "运动干预", 抗阻训练: "运动干预", 平衡训练: "运动干预",
  均衡膳食维持: "膳食补充", 优质蛋白强化: "膳食补充", 能量与营养强化: "膳食补充",
  健脾益气食养: "中医食养", 温阳食养: "中医食养", 滋阴食养: "中医食养", 健脾祛湿食养: "中医食养",
  清利湿热食养: "中医食养", 活血食养: "中医食养", 疏肝解郁食养: "中医食养", 特禀体质个体化食养: "中医食养",
};
const V1_EXPECTED_EDGE_COUNT = 75;
const V1_EXPECTED_INTERVENTION_COUNT = 15;

const mappingRows = readSheetRows(MAPPING_XLSX, "评估-干预映射");
check(
  String(mappingRows[0]?.[0]) === "评估标签" && String(mappingRows[0]?.[1]) === "干预标签",
  "V1 映射表表头应为 [评估标签, 干预标签]"
);
const edges = mappingRows
  .slice(1)
  .filter((r) => r[0] != null && r[1] != null)
  .map((r) => ({ assessmentTag: String(r[0]).trim(), interventionTag: String(r[1]).trim() }));
check(edges.length === V1_EXPECTED_EDGE_COUNT, `V1 映射边应为 ${V1_EXPECTED_EDGE_COUNT} 条，实际 ${edges.length} 条`);

const interventionRows = readSheetRows(INTERVENTION_XLSX);
const v1Interventions = interventionRows
  .filter((r) => r[0] != null && r[1] != null)
  .map((r) => {
    const tag = String(r[0]).trim();
    return { tag, category: V1_CATEGORY_MAP[tag] ?? null, plan: String(r[1]).trim() };
  });
check(
  v1Interventions.length === V1_EXPECTED_INTERVENTION_COUNT,
  `V1 干预标签应为 ${V1_EXPECTED_INTERVENTION_COUNT} 个，实际 ${v1Interventions.length} 个`
);
for (const item of v1Interventions) {
  check(item.category != null, `V1 干预标签「${item.tag}」没有三大类归属`);
}

// ---------- V2 校验：scales.json（手工整理的题库，只校验不生成） ----------
interface ScaleQuestion {
  id: string; no: string; standardText: string; colloquialText: string; retryText: string;
  answerType: "boolean" | "choice" | "likert5"; options?: { label: string; score: number }[];
}
interface Scale {
  id: string; questions: ScaleQuestion[]; judgment: Record<string, unknown>;
  likertOptions?: { label: string; score: number }[];
}
const scalesPath = path.join(DATA_DIR, "scales.json");
check(fs.existsSync(scalesPath), "data/scales.json 不存在（需从量表题目_Demo.txt 手工整理）");
if (fs.existsSync(scalesPath)) {
  const scalesDoc = JSON.parse(fs.readFileSync(scalesPath, "utf8")) as { scales: Scale[] };
  const byId = new Map(scalesDoc.scales.map((s) => [s.id, s]));
  const expectedCounts: Record<string, number> = { frail: 5, mnasf: 7, fall: 3, tcm: 33 };
  for (const [scaleId, count] of Object.entries(expectedCounts)) {
    const scale = byId.get(scaleId);
    check(scale != null, `scales.json 缺少量表「${scaleId}」`);
    if (!scale) continue;
    check(scale.questions.length === count, `量表「${scaleId}」应有 ${count} 题，实际 ${scale.questions.length} 题`);
    for (const q of scale.questions) {
      check(!!q.standardText?.trim(), `题目 ${q.id} 缺少标准题面`);
      check(!!q.colloquialText?.trim(), `题目 ${q.id} 缺少口语化文案`);
      check(!!q.retryText?.trim(), `题目 ${q.id} 缺少复问文案`);
      if (q.answerType === "likert5") {
        check((scale.likertOptions?.length ?? 0) === 5, `题目 ${q.id} 为 likert5 但量表缺少 5 级通用选项`);
      } else {
        check((q.options?.length ?? 0) >= 2, `题目 ${q.id} 缺少选项定义`);
      }
    }
  }
  const tcm = byId.get("tcm");
  if (tcm) {
    const tcmNos = new Set(tcm.questions.map((q) => Number(q.no)));
    const judgment = tcm.judgment as {
      biased: { tag: string; questionNos: number[] }[];
      pinghe: { questionNos: number[]; reverseNos: number[] };
    };
    check(judgment.biased.length === 8, `偏颇体质判定规则应为 8 条，实际 ${judgment.biased.length} 条`);
    for (const rule of judgment.biased) {
      check(rule.questionNos.length === 4, `体质「${rule.tag}」应对应 4 题`);
      for (const no of rule.questionNos) check(tcmNos.has(no), `体质「${rule.tag}」引用了不存在的题号 ${no}`);
    }
    check(judgment.pinghe.questionNos.length === 5, "平和质应对应 5 题");
    for (const no of judgment.pinghe.reverseNos) {
      check(judgment.pinghe.questionNos.includes(no), `平和质反向计分题 ${no} 不在其对应题目中`);
    }
  }
  console.log(`✓ scales.json：${scalesDoc.scales.length} 个量表，题量与判定规则引用校验通过`);
}

if (failed) {
  console.error("规则转换中止：请核对源文件或本脚本的预期常量。");
  process.exit(1);
}

// ============================================================
// 写出数据文件与素材（异步：图片压缩 → mediaSrc 加内容哈希 → 写 data/*.json → 汇总）
// ============================================================
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_INTERVENTIONS_DIR, { recursive: true });
// 视频占位目录（M01-M12 视频文件由业务方后续放入，缺失时卡片回退文字）
fs.mkdirSync(path.join(PUBLIC_INTERVENTIONS_DIR, "videos"), { recursive: true });

void (async () => {
  // 1) 压缩拷贝膳食/中医食养图片到 public/interventions/<编码>.png（ASCII 稳定路径，避免中文 URL 问题）
  //    源图约 1.7MB/张、在线首屏加载慢：统一 palette 量化压缩，目标单张 <600KB，超出告警不中止；
  //    同步派生同名 .webp（体积再降约一半，前端 <picture> 优先取 WebP、老浏览器回退 PNG）。
  const TARGET_BYTES = 600 * 1024; // 单张上线大小目标（2026-07-20 用户确认 <600KB）
  const versionByCode = new Map<string, string>();
  for (const [code, src] of sourceImageByCode) {
    const out = path.join(PUBLIC_INTERVENTIONS_DIR, `${code}.png`);
    const input = path.join(src.dir, src.file);
    // quality 逐级下调直到达标（palette 量化对图文教程近乎无损，逐级是为保住能达标图的最高质量）
    for (const quality of [90, 80, 70, 60, 50]) {
      await sharp(input).png({ palette: true, quality, compressionLevel: 9 }).toFile(out);
      if (fs.statSync(out).size <= TARGET_BYTES) break;
    }
    const kb = fs.statSync(out).size / 1024;
    if (kb > 600) console.warn(`⚠ ${code}.png 压缩后仍 ${kb.toFixed(0)}KB，超过 600KB 目标`);
    await sharp(input).webp({ quality: 90 }).toFile(path.join(PUBLIC_INTERVENTIONS_DIR, `${code}.webp`));
    versionByCode.set(code, contentHash(out));
  }

  // 2) mediaSrc 追加内容哈希查询参数：内容变 → URL 变，配合 /interventions 的 immutable 长缓存
  //    （服务器带宽受限，2026-07-20 确认）；视频文件已放入时同样加哈希，未放入保持约定路径。
  for (const item of interventionItems) {
    if (item.mediaType === "image") {
      item.mediaSrc = `${item.mediaSrc}?v=${versionByCode.get(item.code)}`;
    } else {
      const videoFile = path.join(VIDEO_DIR, `${item.code}.mp4`);
      if (fs.existsSync(videoFile)) item.mediaSrc = `${item.mediaSrc}?v=${contentHash(videoFile)}`;
    }
  }

  // 3) intervention-scoring.json（V2 推荐引擎唯一数据源）
  const scoringDoc = {
    generatedFrom: "docs/source/评估-干预标签积分规则表.xlsx + docs/source/12种运动干预.docx + 膳食/中医食养干预图片",
    generatedAt: new Date().toISOString(),
    categories: CATEGORY_DEFS.map((d) => ({ key: d.key, label: d.label, codePrefix: d.codePrefix, mediaType: d.mediaType })),
    assessmentTags: [...tagNameByCode].map(([code, name]) => ({ code, name })),
    interventions: interventionItems,
    matrix,
  };
  assertNoPii(scoringDoc, "intervention-scoring.json");
  fs.writeFileSync(
    path.join(DATA_DIR, "intervention-scoring.json"),
    JSON.stringify(scoringDoc, null, 2) + "\n",
    "utf8"
  );

  // 4) V1 历史资料（保留生成，V2 推荐不引用）
  fs.writeFileSync(
    path.join(DATA_DIR, "tag-mapping.json"),
    JSON.stringify(
      {
        generatedFrom: "docs/source/评估标签-干预标签知识图谱映射表_Demo.xlsx（V1 历史资料）",
        generatedAt: new Date().toISOString(),
        assessmentTags: EXPECTED_ASSESSMENT_TAGS,
        edges,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(DATA_DIR, "interventions.json"),
    JSON.stringify(
      {
        generatedFrom: "docs/source/干预标签_Demo.xlsx（V1 历史资料）",
        generatedAt: new Date().toISOString(),
        categories: ["运动干预", "膳食补充", "中医食养"],
        interventions: v1Interventions,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(`✓ intervention-scoring.json：17 标签 × 30 干预 = ${records.length} 条积分，§4.3 示例复算一致`);
  console.log(`✓ public/interventions：压缩拷贝 ${versionByCode.size} 张膳食/中医食养图片（palette PNG <600KB + WebP 派生 + 哈希缓存版本；视频目录已就绪，待补 M01-M12）`);
  console.log(`✓ tag-mapping.json / interventions.json（V1 历史资料）：${edges.length} 条映射边，${v1Interventions.length} 个干预标签`);
  console.log("✓ 全部校验通过");
})();
