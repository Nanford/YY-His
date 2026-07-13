/**
 * INPUT:  docs/source/评估标签-干预标签知识图谱映射表_Demo.xlsx、docs/source/干预标签_Demo.xlsx（只读医学源文件）、
 *         data/scales.json（从量表题目_Demo.txt 手工整理的题库，本脚本只校验不生成）
 * OUTPUT: data/tag-mapping.json（75 条评估→干预映射边）、data/interventions.json（15 个干预标签+执行方案全文+三大类分类）
 * POS:    规则数据层的唯一生成与校验入口。医学规则变更只能改源文件后重跑本脚本；校验失败即退出非零码，禁止产出不完整数据。
 */
import * as XLSX from "xlsx";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const SOURCE_DIR = path.join(ROOT, "docs", "source");
const DATA_DIR = path.join(ROOT, "data");

const MAPPING_XLSX = path.join(SOURCE_DIR, "评估标签-干预标签知识图谱映射表_Demo.xlsx");
const INTERVENTION_XLSX = path.join(SOURCE_DIR, "干预标签_Demo.xlsx");

// 来源：量表题目_Demo.txt 判定规则 —— 17 个评估标签全集
const EXPECTED_ASSESSMENT_TAGS = [
  "无衰弱", "衰弱前期", "衰弱",
  "营养正常", "存在营养不良风险", "营养不良",
  "跌倒风险筛查阴性", "跌倒风险筛查阳性",
  "平和质", "气虚质", "阳虚质", "阴虚质", "痰湿质", "湿热质", "血瘀质", "气郁质", "特禀质",
] as const;

// 来源：需求文档"第四步：干预方案推荐"——最终干预方案按运动干预/膳食补充/中医食养三大类展示。
// 分类归属不在 xlsx 中，依据需求文档正文的列举关系在此固化。
const CATEGORY_MAP: Record<string, string> = {
  八段锦: "运动干预",
  太极拳: "运动干预",
  抗阻训练: "运动干预",
  平衡训练: "运动干预",
  均衡膳食维持: "膳食补充",
  优质蛋白强化: "膳食补充",
  能量与营养强化: "膳食补充",
  健脾益气食养: "中医食养",
  温阳食养: "中医食养",
  滋阴食养: "中医食养",
  健脾祛湿食养: "中医食养",
  清利湿热食养: "中医食养",
  活血食养: "中医食养",
  疏肝解郁食养: "中医食养",
  特禀体质个体化食养: "中医食养",
};

const EXPECTED_EDGE_COUNT = 75; // 来源：映射表"说明与来源"sheet：75 条知识图谱边
const EXPECTED_INTERVENTION_COUNT = 15;

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
  if (!ws) {
    throw new Error(`${path.basename(file)} 中找不到工作表 ${name}`);
  }
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];
}

// ---------- 1. 评估标签 → 干预标签映射 ----------
const mappingRows = readSheetRows(MAPPING_XLSX, "评估-干预映射");
check(
  String(mappingRows[0]?.[0]) === "评估标签" && String(mappingRows[0]?.[1]) === "干预标签",
  "映射表表头应为 [评估标签, 干预标签]"
);

const edges = mappingRows
  .slice(1)
  .filter((r) => r[0] != null && r[1] != null)
  .map((r) => ({
    assessmentTag: String(r[0]).trim(),
    interventionTag: String(r[1]).trim(),
  }));

check(edges.length === EXPECTED_EDGE_COUNT, `映射边应为 ${EXPECTED_EDGE_COUNT} 条，实际 ${edges.length} 条`);

const edgeKeys = new Set(edges.map((e) => `${e.assessmentTag}→${e.interventionTag}`));
check(edgeKeys.size === edges.length, "映射边存在重复");

const assessmentTagsInMapping = new Set(edges.map((e) => e.assessmentTag));
for (const tag of EXPECTED_ASSESSMENT_TAGS) {
  check(assessmentTagsInMapping.has(tag), `评估标签「${tag}」在映射表中没有任何干预映射`);
}
for (const tag of assessmentTagsInMapping) {
  check(
    (EXPECTED_ASSESSMENT_TAGS as readonly string[]).includes(tag),
    `映射表出现未定义的评估标签「${tag}」`
  );
}

// ---------- 2. 干预标签 → 执行方案全文 ----------
const interventionRows = readSheetRows(INTERVENTION_XLSX);
const interventions = interventionRows
  .filter((r) => r[0] != null && r[1] != null)
  .map((r) => {
    const tag = String(r[0]).trim();
    return {
      tag,
      category: CATEGORY_MAP[tag] ?? null,
      plan: String(r[1]).trim(),
    };
  });

check(
  interventions.length === EXPECTED_INTERVENTION_COUNT,
  `干预标签应为 ${EXPECTED_INTERVENTION_COUNT} 个，实际 ${interventions.length} 个`
);

for (const item of interventions) {
  check(item.category != null, `干预标签「${item.tag}」没有三大类归属（CATEGORY_MAP 需更新）`);
  check(item.plan.length > 20, `干预标签「${item.tag}」执行方案文本异常（过短）`);
}

// 映射表与干预表的引用完整性：每条边指向的干预标签必须有执行方案，反之每个干预都被引用
const interventionTagSet = new Set(interventions.map((i) => i.tag));
for (const edge of edges) {
  check(
    interventionTagSet.has(edge.interventionTag),
    `映射边「${edge.assessmentTag}→${edge.interventionTag}」指向的干预标签没有执行方案`
  );
}
const referencedInterventions = new Set(edges.map((e) => e.interventionTag));
for (const tag of interventionTagSet) {
  check(referencedInterventions.has(tag), `干预标签「${tag}」未被任何评估标签引用`);
}

// ---------- 3. 校验 data/scales.json（手工整理的题库） ----------
// 来源：量表题目_Demo.txt —— 题量、判定规则引用完整性在此把关，防止手工整理出错
interface ScaleQuestion {
  id: string;
  no: string;
  standardText: string;
  colloquialText: string;
  retryText: string;
  answerType: "boolean" | "choice" | "likert5";
  options?: { label: string; score: number }[];
}
interface Scale {
  id: string;
  questions: ScaleQuestion[];
  judgment: Record<string, unknown>;
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
    check(
      scale.questions.length === count,
      `量表「${scaleId}」应有 ${count} 题（含替代题），实际 ${scale.questions.length} 题`
    );
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

  // 中医体质判定规则引用完整性：8 偏颇体质 × 4 题 + 平和质 5 题（含 4 题反向）
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
      for (const no of rule.questionNos) {
        check(tcmNos.has(no), `体质「${rule.tag}」引用了不存在的题号 ${no}`);
      }
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

// ---------- 4. 写出 data/*.json ----------
fs.mkdirSync(DATA_DIR, { recursive: true });

fs.writeFileSync(
  path.join(DATA_DIR, "tag-mapping.json"),
  JSON.stringify(
    {
      generatedFrom: "docs/source/评估标签-干预标签知识图谱映射表_Demo.xlsx",
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
      generatedFrom: "docs/source/干预标签_Demo.xlsx",
      generatedAt: new Date().toISOString(),
      categories: ["运动干预", "膳食补充", "中医食养"],
      interventions,
    },
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(`✓ tag-mapping.json：${edges.length} 条映射边，${assessmentTagsInMapping.size} 个评估标签`);
console.log(`✓ interventions.json：${interventions.length} 个干预标签，三大类分类完整`);
console.log("✓ 全部校验通过");
