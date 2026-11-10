/**
 * INPUT:  src/lib/assessment/report-rows.ts、现行规则数据（经 rules/v2）
 * OUTPUT: 下载版报告「综合评估结果」表行与「既存问题」清单的单测
 * POS:    锁定展示派生口径：分数只在有总分口径的量表展示、正常范围取 02 表规则原文、
 *         零标签量表如实说明原因、中医体质按体质拆行。
 */
import { describe, expect, it } from "vitest";
import { buildReportRows, listExistingProblems } from "@/lib/assessment/report-rows";
import type { AssessmentTag, TagLevel } from "@/lib/assessment/report-types";
import { scalesV2, tagV2ByCode } from "@/lib/rules/v2";

function makeTag(scaleId: string, code: string, score: number, level: TagLevel = "是", tag?: string): AssessmentTag {
  return { scaleId, code, score, level, tag: tag ?? tagV2ByCode.get(code)?.name ?? code, detail: [] };
}

describe("buildReportRows", () => {
  it("有总分口径的量表展示总分、正常范围取正常档规则原文、异常提示置顶", () => {
    const rows = buildReportRows(
      ["frail", "fall_3q"],
      [
        makeTag("frail", "FRAIL_FRAIL", 3),
        makeTag("fall_3q", "FALL_HISTORY_1Y", 0),
        makeTag("fall_3q", "FALL_SCREEN_POSITIVE", 0),
      ],
      []
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      no: 1,
      title: "FRAIL量表",
      resultText: "3",
      normalRange: tagV2ByCode.get("FRAIL_NONE")?.rule,
      hints: [{ text: "衰弱", abnormal: true }],
      note: null,
    });
    // 阴阳性类量表没有总分口径：评估结果占位，不展示无意义的 0
    expect(rows[1]).toMatchObject({
      no: 2,
      resultText: "—",
      normalRange: tagV2ByCode.get("FALL_SCREEN_NEGATIVE")?.rule,
    });
    expect(rows[1].hints.map((hint) => hint.text)).toEqual(["过去一年有跌倒史", "跌倒风险筛查阳性"]);
  });

  it("正常结论不标异常；部分计分如实备注", () => {
    const rows = buildReportRows(
      ["minicog"],
      [makeTag("minicog", "COGNITIVE_BRIEF_SCREEN_NEGATIVE", 3)],
      [{ scaleId: "minicog" }]
    );
    expect(rows[0].hints).toEqual([{ text: "认知功能初筛阴性", abnormal: false }]);
    expect(rows[0].note).toBe("部分计分，仅供参考");
    expect(rows[0].resultText).toBe("3");
  });

  it("零标签量表占一行并说明原因，不伪造结论", () => {
    const rows = buildReportRows(["grip", "mmse"], [], [{ scaleId: "grip" }]);
    expect(rows[0]).toMatchObject({ resultText: "—", hints: [], note: "需医护测量后评定" });
    expect(rows[1]).toMatchObject({ resultText: "—", hints: [], note: "本次未得出结论" });
  });

  it("中医体质按体质拆行，转化分保留 1 位小数，正常范围取对应体质的规则", () => {
    const rows = buildReportRows(
      ["tcm_constitution"],
      [
        makeTag("tcm_constitution", "TCM_QI_DEFICIENCY_TENDENCY", 33.333, "倾向是", "气虚质"),
        makeTag("tcm_constitution", "TCM_YANG_DEFICIENCY_NO", 12.5, "是", "阳虚质：否"),
        makeTag("tcm_constitution", "TCM_BALANCED_NO", 50, "是", "平和质：否"),
      ],
      []
    );
    expect(rows.map((row) => row.title)).toEqual([
      "中医体质辨识·气虚质",
      "中医体质辨识·阳虚质",
      "中医体质辨识·平和质",
    ]);
    expect(rows.map((row) => row.no)).toEqual([1, 2, 3]);
    expect(rows[0]).toMatchObject({
      resultText: "33.3",
      normalRange: tagV2ByCode.get("TCM_QI_DEFICIENCY_NO")?.rule,
      hints: [{ text: "气虚质（倾向）", abnormal: true }],
    });
    expect(rows[1].hints).toEqual([{ text: "阳虚质：否", abnormal: false }]);
    expect(rows[2].normalRange).toBe(tagV2ByCode.get("TCM_BALANCED_YES")?.rule);
    expect(rows[2].hints[0].abnormal).toBe(false);
  });

  it("现行量表除两个只产出问题条目的量表外，都能取到正常范围", () => {
    const rows = buildReportRows(
      scalesV2.map((scale) => scale.id),
      [],
      []
    );
    // 居家环境筛查/疼痛行为评估在 02 表里只有逐条问题标签，没有"正常档"标签，正常范围如实占位
    expect(rows.filter((row) => row.normalRange === "—").map((row) => row.title)).toEqual([
      "居家环境筛查表",
      "慢性疼痛行为评估量表",
    ]);
  });

  it("历史量表 id 不在现行规则内时退化为占位而不抛错", () => {
    const rows = buildReportRows(["fall"], [makeTag("fall", "LEGACY", 1, "是", "跌倒风险筛查阳性")], []);
    expect(rows[0]).toMatchObject({ title: "fall", resultText: "—", normalRange: "—" });
    expect(rows[0].hints).toEqual([{ text: "跌倒风险筛查阳性", abnormal: true }]);
  });
});

describe("listExistingProblems", () => {
  it("只列异常标签，带级别后缀并去重", () => {
    expect(
      listExistingProblems([
        makeTag("frail", "FRAIL_FRAIL", 3),
        makeTag("ais", "AIS_NO_SLEEP_DISORDER", 0),
        makeTag("tcm_constitution", "TCM_YIN_DEFICIENCY_TENDENCY", 35, "倾向是", "阴虚质"),
        makeTag("frail", "FRAIL_FRAIL", 3),
      ])
    ).toEqual(["衰弱", "阴虚质（倾向）"]);
  });
});
