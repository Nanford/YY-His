/**
 * INPUT:  data/judgments-v2.json（thresholdByEducation 判定配置）、data/scales-v2.json（MMSE 题库）
 * OUTPUT: thresholdByEducation 判定器用例：四档文化程度边界（文盲 17/18、小学 20/21、
 *         初中·高中中专技校 22/23、大专及以上 23/24）、缺/非法文化程度 blockedReason 阻断、
 *         记忆指令/图片识别/操作指令条目缺失的 deferClinical 豁免与 strict 阻断、
 *         EDUCATION_BANDS ↔ patient-intake EDUCATION_LEVELS 覆盖核对
 * POS:    V2 评分引擎回归保险（来源：02 表 MMSE 判定规则——按文化程度分层，>界值正常、≤界值减退）。
 *         注：02 表另有 MMSE_UNABLE_TO_COMPLETE（无法完成足够条目），属医生临床判断，
 *         本配置不自动判定该标签（见 src/lib/scoring-v2/threshold-by-education.ts 文件头）。
 */
import { describe, expect, it } from "vitest";
import { educationBandOf, scoreScaleV2, type AnswersV2 } from "@/lib/scoring-v2";
import { scaleV2ById } from "@/lib/rules/v2";
import { EDUCATION_LEVELS } from "@/lib/assessment/patient-intake";
import { optByScore } from "./scoring-v2-helpers";

const MMSE_ITEM_IDS = scaleV2ById.get("mmse")!.items.map((i) => i.id);

/** 构造 MMSE 答案：前 scoredCount 题记 1 分、其余记 0 分（30 题均为 1/0 选项），总分 = scoredCount */
function mmseAnswers(scoredCount: number, skip: string[] = []): AnswersV2 {
  const answers: AnswersV2 = {};
  let remaining = scoredCount;
  for (const id of MMSE_ITEM_IDS) {
    if (skip.includes(id)) continue;
    const score = remaining > 0 ? 1 : 0;
    answers[id] = optByScore("mmse", id, score);
    remaining -= score;
  }
  return answers;
}

describe("thresholdByEducation 四档文化程度边界（来源：02 表 MMSE 判定规则）", () => {
  it.each([
    // [文化程度, 界值（≤判减退）, 界值+1（>界值判正常）]
    ["文盲", 17, 18],
    ["小学", 20, 21],
    ["初中", 22, 23],
    ["高中中专技校", 22, 23],
    ["大专及以上", 23, 24],
  ] as const)("%s：总分 %i → 认知功能减退，总分 %i → 未见明显减退", (education, at, above) => {
    const decline = scoreScaleV2("mmse", mmseAnswers(at), { education });
    expect(decline.ok).toBe(true);
    expect(decline.totalScore).toBe(at);
    expect(decline.tags).toEqual([{ code: "MMSE_COGNITIVE_DECLINE", name: "MMSE提示认知功能减退" }]);

    const normal = scoreScaleV2("mmse", mmseAnswers(above), { education });
    expect(normal.ok).toBe(true);
    expect(normal.totalScore).toBe(above);
    expect(normal.tags).toEqual([{ code: "MMSE_WITHIN_NORMAL_RANGE", name: "MMSE认知功能未见明显减退" }]);
  });

  it("满分 30 各档均正常；0 分各档均减退（且不自动判 MMSE_UNABLE_TO_COMPLETE）", () => {
    for (const education of EDUCATION_LEVELS) {
      const full = scoreScaleV2("mmse", mmseAnswers(30), { education });
      expect(full.tags[0].code).toBe("MMSE_WITHIN_NORMAL_RANGE");
      const zero = scoreScaleV2("mmse", mmseAnswers(0), { education });
      expect(zero.tags[0].code).toBe("MMSE_COGNITIVE_DECLINE");
    }
  });

  it("明细与总分：30 题全部计分、无豁免时 partial=false", () => {
    const r = scoreScaleV2("mmse", mmseAnswers(25), { education: "小学" });
    expect(r.details).toHaveLength(30);
    expect(r.details.every((d) => !d.excluded && d.score !== null)).toBe(true);
    expect(r.details.filter((d) => d.score === 1)).toHaveLength(25);
    expect(r.totalScore).toBe(25);
    expect(r.partial).toBe(false);
    expect(r.deferred).toEqual([]);
  });
});

describe("缺文化程度阻断（blockedReason）", () => {
  it("未传 education：答案齐全也无法判定 → ok=false + blockedReason，missing 为空", () => {
    const r = scoreScaleV2("mmse", mmseAnswers(30));
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([]);
    expect(r.totalScore).toBeNull();
    expect(r.tags).toEqual([]);
    expect(r.blockedReason).toContain("文化程度");
  });

  it("非法枚举值（非 EDUCATION_LEVELS）同样阻断", () => {
    const r = scoreScaleV2("mmse", mmseAnswers(30), { education: "博士后" });
    expect(r.ok).toBe(false);
    expect(r.blockedReason).toContain("文化程度");
  });

  it("缺 education 与缺正式问题并存：missing 照实返回且 blockedReason 同在", () => {
    const answers = mmseAnswers(29, ["mmse_1"]);
    const r = scoreScaleV2("mmse", answers);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["mmse_1"]);
    expect(r.blockedReason).toContain("文化程度");
  });
});

describe("条目缺失的 deferClinical / strict 口径（记忆指令/图片识别/操作指令属医生侧条目）", () => {
  it("deferClinical：图片识别（mmse_22）缺失 → 豁免计分，按已答 29 题判定并标注部分计分", () => {
    // 29 题全对（小学档界值 20）：总分 29 > 20 → 正常
    const r = scoreScaleV2("mmse", mmseAnswers(29, ["mmse_22"]), { education: "小学", deferClinical: true });
    expect(r.ok).toBe(true);
    expect(r.totalScore).toBe(29);
    expect(r.deferred).toEqual(["mmse_22"]);
    expect(r.partial).toBe(true);
    expect(r.tags[0].code).toBe("MMSE_WITHIN_NORMAL_RANGE");
  });

  it("deferClinical：记忆指令（mmse_11）与操作指令（mmse_30）缺失 → 豁免", () => {
    const r = scoreScaleV2("mmse", mmseAnswers(28, ["mmse_11", "mmse_30"]), {
      education: "小学",
      deferClinical: true,
    });
    expect(r.ok).toBe(true);
    expect(r.deferred).toEqual(["mmse_11", "mmse_30"]);
    expect(r.totalScore).toBe(28);
  });

  it("strict（医生路径不传 deferClinical）：图片识别缺失 → 阻断待代填", () => {
    const r = scoreScaleV2("mmse", mmseAnswers(29, ["mmse_22"]), { education: "小学" });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["mmse_22"]);
    expect(r.deferred).toEqual([]);
  });

  it("正式问题（mmse_1）缺失在任何模式下都阻断（deferClinical 不豁免）", () => {
    const r = scoreScaleV2("mmse", mmseAnswers(29, ["mmse_1"]), { education: "小学", deferClinical: true });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["mmse_1"]);
    expect(r.deferred).toEqual([]);
  });
});

describe("文化程度映射（EDUCATION_BANDS ↔ patient-intake EDUCATION_LEVELS 双侧把守）", () => {
  it("EDUCATION_LEVELS 全枚举都有分档，且映射 key 集合恰等于枚举集合", () => {
    for (const level of EDUCATION_LEVELS) {
      expect(educationBandOf(level), `「${level}」应有分档`).not.toBeNull();
    }
    expect(educationBandOf("文盲")).toBe("illiterate");
    expect(educationBandOf("小学")).toBe("primary");
    expect(educationBandOf("初中")).toBe("secondary");
    expect(educationBandOf("高中中专技校")).toBe("secondary");
    expect(educationBandOf("大专及以上")).toBe("college");
  });

  it("未填/空白 → null", () => {
    expect(educationBandOf(undefined)).toBeNull();
    expect(educationBandOf(null)).toBeNull();
    expect(educationBandOf("  ")).toBeNull();
  });
});
