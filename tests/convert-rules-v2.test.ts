/**
 * INPUT:  data/scales-v2.json、data/result-tags.json、data/intervention-scoring-v2.json、
 *         data/interventions-v2.json（均由 npm run convert-rules-v2 从 V2/ 只读源文件生成）
 * OUTPUT: V2 数据管线产物契约测试：标签 190 / 干预 60 / 占位标签 5、matrix 稀疏完整性
 *         （非零恰 638 条 = 600 普通 + 1 强制 + 37 禁用）、黄金向量抽样、categories 5 类、
 *         scales-v2 量表数与条目总数、interventions-v2 的 mediaType 分布
 * POS:    V2 规则数据的回归保险。源文件（V2/*.xlsx）变更后必须重跑 convert-rules-v2 并保证本测试全绿。
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

interface ResultTagsJson {
  tags: { code: string; name: string; scaleName: string; rule: string; placeholder: boolean }[];
}
interface InterventionsJson {
  interventions: {
    code: string; name: string; category: string; display: string;
    mediaType: string; content: string; mediaSrc: string | null; mediaAvailable: boolean;
  }[];
}
interface ScoringJson {
  scoreSemantics: { forced: number; forbidden: number; unrelated: number };
  categories: { key: string; label: string; codePrefix: string; count: number; mediaType: string }[];
  tags: { code: string; name: string }[];
  matrix: Record<string, Record<string, number>>;
}
interface ScalesJson {
  categories: string[];
  narrations: { id: string; row: number; entryType: string; category: string; scaleId: string | null; text: string }[];
  scales: {
    id: string; name: string; category: string; subcategory: string;
    items: {
      id: string; row: number; no: string; entryType: string; text: string;
      optionsRaw: string; options: { label: string; score: number | null }[] | null;
      variableCode: string | null; reuseRule: string | null;
    }[];
  }[];
}

function readJson<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", name), "utf-8")) as T;
}

const scalesV2 = readJson<ScalesJson>("scales-v2.json");
const resultTags = readJson<ResultTagsJson>("result-tags.json");
const scoring = readJson<ScoringJson>("intervention-scoring-v2.json");
const interventions = readJson<InterventionsJson>("interventions-v2.json");

/** 键序无关的稀疏向量相等断言 */
function expectVector(actual: Record<string, number> | undefined, expected: Record<string, number>): void {
  expect(actual).toBeDefined();
  expect(Object.keys(actual!).sort()).toEqual(Object.keys(expected).sort());
  for (const [k, v] of Object.entries(expected)) expect(actual![k]).toBe(v);
}

describe("result-tags.json（02 表：190 评估结果标签）", () => {
  it("恰 190 个标签，编码唯一", () => {
    expect(resultTags.tags).toHaveLength(190);
    expect(new Set(resultTags.tags.map((t) => t.code)).size).toBe(190);
  });

  it("占位标签恰 5 个（名称含 {score}/{count}/{clinical_type} 模板）", () => {
    const placeholders = resultTags.tags.filter((t) => t.placeholder);
    expect(placeholders.map((t) => t.code).sort()).toEqual(
      [
        "HOME_ENVIRONMENT_SCORE",
        "ICIQ_UI_SF_SCORE",
        "CONSTIPATION_CLINICAL_TYPE",
        "BEHAVIORAL_PAIN_SCORE",
        "MEDICATION_COUNT",
      ].sort(),
    );
    for (const t of placeholders) expect(t.name).toContain("{");
  });
});

describe("interventions-v2.json（04 表：60 项干预方案）", () => {
  it("恰 60 项，编码唯一，mediaType 分布 video=13 / image=27 / text=20", () => {
    expect(interventions.interventions).toHaveLength(60);
    expect(new Set(interventions.interventions.map((x) => x.code)).size).toBe(60);
    const dist: Record<string, number> = {};
    for (const x of interventions.interventions) dist[x.mediaType] = (dist[x.mediaType] ?? 0) + 1;
    // video = YD01-10 + QT09/QT12/QT14；image = SS01-10 + ZY01-10 + QT01-05/QT10/QT13；text = JZ01-15 + QT06-08/QT11/QT15
    expect(dist).toEqual({ video: 13, image: 27, text: 20 });
  });

  it("素材：V1 映射的 12 项 mediaAvailable=true 且 mediaSrc 带内容哈希，其余保持 false", () => {
    // 与 scripts/convert-rules-v2.ts 的 MEDIA_V1_SOURCE 一一对应（V1→V2 素材映射，2026-08-08 核查）
    const mapped: Record<string, string> = {
      YD01: "videos/M12.mp4", YD02: "videos/M01.mp4", YD03: "videos/M02.mp4", YD04: "videos/M03.mp4",
      YD05: "videos/M11.mp4", YD06: "videos/M09.mp4", YD09: "videos/M07.mp4",
      SS02: "D03.png", SS03: "D05.png", SS04: "D10.png", ZY02: "C08.png", ZY10: "C05.png",
    };
    const pubDir = path.join(process.cwd(), "public", "interventions");
    for (const x of interventions.interventions) {
      if (x.mediaType === "text") {
        expect(x.mediaSrc).toBeNull();
        expect(x.mediaAvailable).toBe(false);
        continue;
      }
      const base = x.mediaType === "video" ? `/interventions/videos/${x.code}.mp4` : `/interventions/${x.code}.png`;
      if (x.code in mapped) {
        // 映射成功：mediaAvailable=true，mediaSrc 附内容哈希 ?v=<md5 前 8 位>，且 V2 编码命名文件已复制就位
        expect(x.mediaAvailable).toBe(true);
        expect(x.mediaSrc).toMatch(new RegExp(`^${base.replace(/[/.]/g, "\\$&")}\\?v=[0-9a-f]{8}$`));
        expect(fs.existsSync(path.join(pubDir, base.replace("/interventions/", "")))).toBe(true);
      } else {
        // 未映射项：素材待补齐，保持原约定路径、无哈希
        expect(x.mediaAvailable).toBe(false);
        expect(x.mediaSrc).toBe(base);
      }
    }
  });
});

describe("intervention-scoring-v2.json（03 表：190×60 稀疏矩阵）", () => {
  it("categories 5 大类定义完整", () => {
    expect(scoring.categories).toEqual([
      { key: "exercise", label: "运动干预", codePrefix: "YD", count: 10, mediaType: "video" },
      { key: "diet", label: "膳食营养", codePrefix: "SS", count: 10, mediaType: "image" },
      { key: "tcmFood", label: "中医食养", codePrefix: "ZY", count: 10, mediaType: "image" },
      { key: "referral", label: "就诊建议", codePrefix: "JZ", count: 15, mediaType: "text" },
      { key: "other", label: "其他", codePrefix: "QT", count: 15, mediaType: "mixed" },
    ]);
    expect(scoring.scoreSemantics).toMatchObject({ forced: 100, forbidden: -100, unrelated: 0 });
  });

  it("tags 190 个且编码升序，与 result-tags 编码集合一致", () => {
    expect(scoring.tags).toHaveLength(190);
    const codes = scoring.tags.map((t) => t.code);
    expect([...codes].sort((a, b) => a.localeCompare(b))).toEqual(codes);
    expect(new Set(codes)).toEqual(new Set(resultTags.tags.map((t) => t.code)));
  });

  it("matrix 稀疏完整：非零恰 638 条 = 600 普通 + 1 强制(100) + 37 禁用(-100)", () => {
    let total = 0, forced = 0, forbidden = 0, normal = 0;
    for (const row of Object.values(scoring.matrix)) {
      for (const score of Object.values(row)) {
        total++;
        if (score === 100) forced++;
        else if (score === -100) forbidden++;
        else {
          normal++;
          expect(score).toBeGreaterThanOrEqual(2);
          expect(score).toBeLessThanOrEqual(10);
        }
      }
    }
    expect({ total, forced, forbidden, normal }).toEqual({ total: 638, forced: 1, forbidden: 37, normal: 600 });
  });

  it("黄金向量抽样：FRAIL_FRAIL / MORSE_FALL_RISK_HIGH / SARCOPENIA_DIAGNOSED", () => {
    expectVector(scoring.matrix.FRAIL_FRAIL, { YD01: 6, YD02: 9, SS02: 9, SS03: 8, ZY01: 6, JZ02: 8, JZ03: 7, QT15: 6 });
    expectVector(scoring.matrix.MORSE_FALL_RISK_HIGH, {
      YD02: 8, YD04: 7, YD06: 9, YD07: -100, JZ03: 9, QT01: 7, QT02: 7, QT03: 7, QT04: 7, QT05: 9,
    });
    expectVector(scoring.matrix.SARCOPENIA_DIAGNOSED, {
      YD02: 10, YD03: 8, YD04: 6, YD08: 6, SS02: 10, SS03: 8, ZY01: 5, JZ03: 9, JZ08: 7,
    });
  });

  it("CAM_DELIRIUM_POSITIVE：JZ01=100 强制，YD/SS/ZY 全 30 项 -100", () => {
    const row = scoring.matrix.CAM_DELIRIUM_POSITIVE;
    expect(row.JZ01).toBe(100);
    expect(row.JZ02).toBe(8);
    for (const prefix of ["YD", "SS", "ZY"]) {
      for (let i = 1; i <= 10; i++) expect(row[`${prefix}${String(i).padStart(2, "0")}`]).toBe(-100);
    }
    expect(Object.keys(row)).toHaveLength(34);
  });
});

describe("scales-v2.json（01 表：采集编排）", () => {
  it("42 量表 / 238 条目 / 20 旁白，一级分类固定 6 类", () => {
    expect(scalesV2.scales).toHaveLength(42);
    expect(scalesV2.scales.reduce((s, x) => s + x.items.length, 0)).toBe(238);
    expect(scalesV2.narrations).toHaveLength(20);
    expect(scalesV2.categories).toEqual(["全程", "躯体功能", "精神心理", "社会与环境", "老年综合征", "中医特色扩展"]);
  });

  it("旁白只含总开场/分类过渡/工具说明，总开场 scaleId 为 null", () => {
    for (const n of scalesV2.narrations) expect(["总开场", "分类过渡", "工具说明"]).toContain(n.entryType);
    const opening = scalesV2.narrations.find((n) => n.entryType === "总开场");
    expect(opening?.scaleId).toBeNull();
    // Lubben 开场语排在「社会与环境」分类过渡之前（已知怪癖），按位置挂载到 lubben
    expect(scalesV2.narrations.find((n) => n.row === 113)?.scaleId).toBe("lubben");
  });

  it("FRAIL 量表 5 题，第 1 题选项解析正确", () => {
    const frail = scalesV2.scales.find((s) => s.id === "frail");
    expect(frail?.name).toBe("FRAIL量表");
    expect(frail?.category).toBe("老年综合征");
    expect(frail?.items).toHaveLength(5);
    expect(frail?.items[0].id).toBe("frail_1");
    expect(frail?.items[0].row).toBe(146);
    expect(frail?.items[0].options).toEqual([
      { label: "是（1分）", score: 1 },
      { label: "否（0分）", score: 0 },
    ]);
    expect(frail?.items[0].optionsRaw).toBe("A、是（1分）；B、否（0分）");
  });
});
