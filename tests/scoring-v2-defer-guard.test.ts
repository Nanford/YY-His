/**
 * INPUT:  src/lib/scoring-v2（scoreScaleV2/scoreAllV2 统一入口的全豁免守卫）、V2 规则数据
 * OUTPUT: A3 全豁免守卫的单元测试
 * POS:    锁「零条已答计分条目（全部缺失且全部 deferClinical 豁免）的量表不产标签」口径——
 *         患者自助勾纯测量量表（calf/grip/gait_speed/dxa_bia 等）时可问题数为 0，会话直接
 *         finished，全部计分条目走豁免；此时 anyYes=false、总分 0 不得产出「肌肉力量未下降」
 *         「SPPB 最差档」类伪造标签。部分已答量表不受影响，deferred 快照与 partial 标注照旧。
 */
import { describe, expect, it } from "vitest";
import { scoreAllV2, scoreScaleV2 } from "@/lib/scoring-v2";
import { optByLabel, optByScore } from "./scoring-v2-helpers";

describe("A3 全豁免守卫：零条已答计分条目 → 不产任何标签", () => {
  it.each(["calf", "grip", "gait_speed", "dxa_bia"])(
    "纯测量量表 %s 全部缺失且全部 deferClinical 豁免 → 零标签（anyYes 不出伪造阴性）",
    (scaleId) => {
      const result = scoreScaleV2(scaleId, {}, { deferClinical: true });
      expect(result.ok).toBe(true); // 豁免后不阻断，但不得产标签
      expect(result.tags).toEqual([]);
      expect(result.missing).toEqual([]);
      expect(result.deferred.length).toBeGreaterThan(0); // deferred 快照照旧
      expect(result.partial).toBe(true); // 报告页「部分计分」标注照旧
    }
  );

  it("sumRange：sppb（全操作测试）全豁免 → 零标签（总分 0 不得映射最低档 SPPB_POOR）", () => {
    const result = scoreScaleV2("sppb", {}, { deferClinical: true });
    expect(result.ok).toBe(true);
    expect(result.tags).toEqual([]);
    expect(result.deferred).toEqual(["sppb_1A", "sppb_1B", "sppb_1C", "sppb_2", "sppb_3"]);
    expect(result.partial).toBe(true);
  });

  it("anyBelowThreshold：whisper（全操作测试）全豁免 → 零标签", () => {
    const result = scoreScaleV2("whisper", {}, { deferClinical: true });
    expect(result.tags).toEqual([]);
    expect(result.deferred.length).toBeGreaterThan(0);
    expect(result.partial).toBe(true);
  });

  it("compositeAllAny：cam（全医护观察）全豁免 → 零标签（不出 CAM 假阴性）", () => {
    const result = scoreScaleV2("cam", {}, { deferClinical: true });
    expect(result.tags).toEqual([]);
    expect(result.deferred.length).toBe(4);
    expect(result.partial).toBe(true);
  });

  it("initialGateSumRange：nrs2002 初筛门控全缺 → 不得出初筛假阴性", () => {
    // 初筛1/2/4（系统读取）豁免、初筛3（正式问题）仍阻断：ok=false 且零标签
    const result = scoreScaleV2("nrs2002", {}, { deferClinical: true });
    expect(result.ok).toBe(false);
    expect(result.tags).toEqual([]);
    expect(result.missing).toContain("nrs2002_初筛3");
    expect(result.deferred).toEqual(
      expect.arrayContaining(["nrs2002_初筛1", "nrs2002_初筛2", "nrs2002_初筛4"])
    );
  });

  it("scoreAllV2 批量入口同样应用守卫", () => {
    const results = scoreAllV2(["grip", "calf", "sppb"], {}, { deferClinical: true });
    for (const result of results) {
      expect(result.tags).toEqual([]);
      expect(result.partial).toBe(true);
    }
  });
});

describe("A3 守卫不误伤：有已答计分条目 → 正常产标签", () => {
  it("anyYes：grip 已答阳性 → 正常产 GRIP_STRENGTH_LOW", () => {
    const result = scoreScaleV2(
      "grip",
      { grip_1: optByLabel("grip", "grip_1", "握力下降（低于性别阈值）") },
      { deferClinical: true }
    );
    expect(result.tags.map((t) => t.code)).toEqual(["GRIP_STRENGTH_LOW"]);
    expect(result.partial).toBe(false);
  });

  it("anyYes：grip 已答阴性 → 正常产 GRIP_STRENGTH_NORMAL（真实作答，非伪造）", () => {
    const result = scoreScaleV2(
      "grip",
      { grip_1: optByLabel("grip", "grip_1", "握力正常（达到性别阈值）") },
      { deferClinical: true }
    );
    expect(result.tags.map((t) => t.code)).toEqual(["GRIP_STRENGTH_NORMAL"]);
  });

  it("ladderScore：vision 阶梯中途命中分档 → 正常产标签（后续阶梯题 excluded 不触发守卫）", () => {
    const result = scoreScaleV2(
      "vision",
      {
        vision_1: optByLabel("vision", "vision_1", "不需要（直接继续评估）"),
        vision_2: optByScore("vision", "vision_2", 4),
      },
      { deferClinical: true }
    );
    expect(result.ok).toBe(true);
    expect(result.totalScore).toBe(4);
    expect(result.tags.map((t) => t.code)).toEqual(["VISION_NORMAL"]);
  });

  it("sumRange：frail 部分已答（frail_4/5 系统读取豁免）→ 按已答题计分正常产标签", () => {
    const result = scoreScaleV2(
      "frail",
      {
        frail_1: optByScore("frail", "frail_1", 0),
        frail_2: optByScore("frail", "frail_2", 0),
        frail_3: optByScore("frail", "frail_3", 0),
      },
      { deferClinical: true }
    );
    // 既定 deferClinical 口径：豁免条目不计分、阈值不变、按已答题计分（部分计分报告）
    expect(result.ok).toBe(true);
    expect(result.totalScore).toBe(0);
    expect(result.tags.map((t) => t.code)).toEqual(["FRAIL_NONE"]);
    expect(result.deferred).toEqual(["frail_4", "frail_5"]);
    expect(result.partial).toBe(true);
  });
});
