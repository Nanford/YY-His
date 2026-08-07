/**
 * INPUT:  scoring-v2 新判定器（ladderScore / anyBelowThreshold / initialGateSumRange / compositeAllAny）
 *         + M10.3b-2 新增 17 量表判定配置
 * OUTPUT: 边界与黄金路径用例
 * POS:    M10.3b-2 评分回归保险；期望标签编码抄自 02 表，不反向引用实现。
 */
import { describe, expect, it } from "vitest";
import { scoreScaleV2 } from "@/lib/scoring-v2";
import { optByLabel, optByScore } from "./scoring-v2-helpers";

describe("motor_screen / sppb / braden（既有 anyYes/sumRange）", () => {
  it("运动初筛阳性", () => {
    const r = scoreScaleV2("motor_screen", {
      motor_screen_1: optByLabel("motor_screen", "motor_screen_1", "是（筛查阳性，进入SPPB评估）"),
    });
    expect(r.ok).toBe(true);
    expect(r.tags.map((t) => t.code)).toEqual(["MOTOR_SCREEN_POSITIVE"]);
  });

  it("SPPB 满分 → GOOD", () => {
    const r = scoreScaleV2("sppb", {
      sppb_1A: optByScore("sppb", "sppb_1A", 1),
      sppb_1B: optByScore("sppb", "sppb_1B", 1),
      sppb_1C: optByScore("sppb", "sppb_1C", 2),
      sppb_2: optByScore("sppb", "sppb_2", 4),
      sppb_3: optByScore("sppb", "sppb_3", 4),
    });
    expect(r.ok).toBe(true);
    expect(r.totalScore).toBe(12);
    expect(r.tags[0].code).toBe("SPPB_GOOD");
  });

  it("Braden 总分 9 → 极高风险", () => {
    const r = scoreScaleV2("braden", {
      braden_1: optByScore("braden", "braden_1", 1),
      braden_2: optByScore("braden", "braden_2", 1),
      braden_3: optByScore("braden", "braden_3", 2),
      braden_4: optByScore("braden", "braden_4", 2),
      braden_5: optByScore("braden", "braden_5", 2),
      braden_6: optByScore("braden", "braden_6", 1),
    });
    expect(r.totalScore).toBe(9);
    expect(r.tags[0].code).toBe("BRADEN_RISK_VERY_HIGH");
  });
});

describe("ladderScore：视力 / 听力", () => {
  it("vision 第一阶即可看清 → 4 分正常", () => {
    const r = scoreScaleV2("vision", {
      vision_2: optByScore("vision", "vision_2", 4),
    });
    expect(r.ok).toBe(true);
    expect(r.totalScore).toBe(4);
    expect(r.tags[0].code).toBe("VISION_NORMAL");
  });

  it("vision 连否后完全不能 → 0 分全盲", () => {
    const r = scoreScaleV2("vision", {
      vision_2: optByLabel("vision", "vision_2", "不可以（进入下一题）"),
      vision_3: optByLabel("vision", "vision_3", "不可以（进入下一题）"),
      vision_4: optByLabel("vision", "vision_4", "不可以（进入下一题）"),
      vision_5: optByScore("vision", "vision_5", 0),
    });
    expect(r.totalScore).toBe(0);
    expect(r.tags[0].code).toBe("VISION_TOTAL_BLINDNESS");
  });

  it("hearing 第二阶听清 → 3 分下降", () => {
    const r = scoreScaleV2("hearing", {
      hearing_2: optByLabel("hearing", "hearing_2", "不可以（进入下一题）"),
      hearing_3: optByScore("hearing", "hearing_3", 3),
    });
    expect(r.totalScore).toBe(3);
    expect(r.tags[0].code).toBe("HEARING_DECLINE");
  });
});

describe("anyBelowThreshold：耳语试验", () => {
  it("双侧 ≥3 词 → 阴性", () => {
    const r = scoreScaleV2("whisper", {
      whisper_3: optByScore("whisper", "whisper_3", 3),
      whisper_4: optByScore("whisper", "whisper_4", 4),
    });
    expect(r.tags[0].code).toBe("WHISPER_TEST_NEGATIVE");
  });

  it("任一侧 2 词 → 阳性", () => {
    const r = scoreScaleV2("whisper", {
      whisper_3: optByScore("whisper", "whisper_3", 4),
      whisper_4: optByScore("whisper", "whisper_4", 2),
    });
    expect(r.tags[0].code).toBe("WHISPER_TEST_POSITIVE");
  });
});

describe("home_env / visual_function / polypharmacy / pain_behavior", () => {
  it("居家环境全是 → 无单题标签", () => {
    const answers: Record<string, ReturnType<typeof optByScore>> = {};
    for (let i = 1; i <= 14; i++) {
      const id = `home_env_${i}`;
      answers[id] = optByScore("home_env", id, 1);
    }
    // 楼梯题也用「是」
    const r = scoreScaleV2("home_env", answers);
    expect(r.ok).toBe(true);
    expect(r.tags).toEqual([]);
  });

  it("居家环境第3题否 → 地面湿滑标签", () => {
    const answers: Record<string, ReturnType<typeof optByScore | typeof optByLabel>> = {};
    for (let i = 1; i <= 14; i++) {
      const id = `home_env_${i}`;
      answers[id] = optByScore("home_env", id, 1);
    }
    answers.home_env_3 = optByScore("home_env", "home_env_3", 0);
    const r = scoreScaleV2("home_env", answers);
    expect(r.tags.map((t) => t.code)).toContain("HOME_FLOOR_SLIPPERY");
  });

  it("视觉功能全否 → 总分3 良好 + 无单题标签", () => {
    const r = scoreScaleV2("visual_function", {
      visual_function_1: optByScore("visual_function", "visual_function_1", 1),
      visual_function_2: optByScore("visual_function", "visual_function_2", 1),
      visual_function_3: optByScore("visual_function", "visual_function_3", 1),
    });
    expect(r.totalScore).toBe(3);
    expect(r.tags.map((t) => t.code)).toEqual(["VISUAL_FUNCTION_GOOD"]);
  });

  it("多重用药综合判断", () => {
    const r = scoreScaleV2("polypharmacy", {
      polypharmacy_2: optByLabel("polypharmacy", "polypharmacy_2", "存在多重用药"),
    });
    expect(r.tags.map((t) => t.code)).toEqual(["POLYPHARMACY_PRESENT"]);
  });

  it("疼痛行为面部＞1 → 标签", () => {
    const r = scoreScaleV2(
      "pain_behavior",
      {
        pain_behavior_1: optByScore("pain_behavior", "pain_behavior_1", 2),
        pain_behavior_2: optByScore("pain_behavior", "pain_behavior_2", 1),
        pain_behavior_4: optByScore("pain_behavior", "pain_behavior_4", 1),
      },
      { deferClinical: true }
    );
    // pain_behavior_3 缺失 defer
    expect(r.ok).toBe(true);
    expect(r.tags.map((t) => t.code)).toContain("PAIN_BEHAVIOR_FACE");
  });
});

describe("initialGateSumRange：NRS2002", () => {
  it("初筛全否 → 仅初筛阴性，终筛不要求", () => {
    const r = scoreScaleV2("nrs2002", {
      nrs2002_初筛1: optByLabel("nrs2002", "nrs2002_初筛1", "否"),
      nrs2002_初筛2: optByLabel("nrs2002", "nrs2002_初筛2", "否"),
      nrs2002_初筛3: optByLabel("nrs2002", "nrs2002_初筛3", "否"),
      nrs2002_初筛4: optByLabel("nrs2002", "nrs2002_初筛4", "否"),
    });
    expect(r.ok).toBe(true);
    expect(r.tags.map((t) => t.code)).toEqual(["NRS2002_INITIAL_NEGATIVE"]);
    expect(r.totalScore).toBeNull();
  });

  it("初筛任一是 + 终筛 4 分 → 阳性 + 营养风险", () => {
    const r = scoreScaleV2("nrs2002", {
      nrs2002_初筛1: optByLabel("nrs2002", "nrs2002_初筛1", "是"),
      nrs2002_初筛2: optByLabel("nrs2002", "nrs2002_初筛2", "否"),
      nrs2002_初筛3: optByLabel("nrs2002", "nrs2002_初筛3", "否"),
      nrs2002_初筛4: optByLabel("nrs2002", "nrs2002_初筛4", "否"),
      nrs2002_终筛1: optByScore("nrs2002", "nrs2002_终筛1", 2),
      nrs2002_终筛2: optByScore("nrs2002", "nrs2002_终筛2", 1),
      nrs2002_终筛3: optByScore("nrs2002", "nrs2002_终筛3", 1),
    });
    expect(r.ok).toBe(true);
    expect(r.totalScore).toBe(4);
    expect(r.tags.map((t) => t.code)).toEqual([
      "NRS2002_INITIAL_POSITIVE",
      "NRS2002_NUTRITION_RISK",
    ]);
  });
});

describe("compositeAllAny：CAM / GLIM", () => {
  it("CAM 1+2+3 阳性 → 谵妄阳性", () => {
    const r = scoreScaleV2("cam", {
      cam_1: optByLabel("cam", "cam_1", "是（条目1阳性）"),
      cam_2: optByLabel("cam", "cam_2", "是（条目2阳性）"),
      cam_3: optByLabel("cam", "cam_3", "是（条目3阳性）"),
      cam_4: optByLabel("cam", "cam_4", "正常清醒（条目4阴性）"),
    });
    expect(r.tags[0].code).toBe("CAM_DELIRIUM_POSITIVE");
  });

  it("CAM 缺特征2 → 阴性", () => {
    const r = scoreScaleV2("cam", {
      cam_1: optByLabel("cam", "cam_1", "是（条目1阳性）"),
      cam_2: optByLabel("cam", "cam_2", "否（条目2阴性）"),
      cam_3: optByLabel("cam", "cam_3", "是（条目3阳性）"),
      cam_4: optByLabel("cam", "cam_4", "正常清醒（条目4阴性）"),
    });
    expect(r.tags[0].code).toBe("CAM_DELIRIUM_NEGATIVE");
  });

  it("GLIM 表现型+病因型且重度代理 → 重度", () => {
    const r = scoreScaleV2("glim", {
      glim_1: optByLabel("glim", "glim_1", "否"),
      glim_2: optByLabel("glim", "glim_2", "是：超过6个月的体重下降＞10%"),
      glim_3: optByLabel("glim", "glim_3", "不符合"),
      glim_4: optByLabel("glim", "glim_4", "不存在"),
      glim_5: optByLabel("glim", "glim_5", "能量摄入≤50%且持续＞1周"),
      glim_6: optByLabel("glim", "glim_6", "均无"),
    });
    expect(r.tags[0].code).toBe("GLIM_SEVERE_MALNUTRITION");
  });

  it("GLIM 仅表现型无病因型 → 无营养不良", () => {
    const r = scoreScaleV2("glim", {
      glim_1: optByLabel("glim", "glim_1", "是：过去6个月内体重下降＞5%"),
      glim_2: optByLabel("glim", "glim_2", "否"),
      glim_3: optByLabel("glim", "glim_3", "不符合"),
      glim_4: optByLabel("glim", "glim_4", "不存在"),
      glim_5: optByLabel("glim", "glim_5", "以上均无"),
      glim_6: optByLabel("glim", "glim_6", "均无"),
    });
    expect(r.tags[0].code).toBe("GLIM_NO_MALNUTRITION");
  });
});

describe("测量结论 anyYes：小腿围/握力/步速/DXA", () => {
  it("小腿围阳性", () => {
    const r = scoreScaleV2("calf", {
      calf_1: optByLabel("calf", "calf_1", "筛查阳性（低于性别阈值）"),
    });
    expect(r.tags[0].code).toBe("SARCOPENIA_CALF_SCREEN_POSITIVE");
  });

  it("DXA 符合界值 → 肌少症诊断", () => {
    const r = scoreScaleV2("dxa_bia", {
      dxa_bia_1: optByLabel("dxa_bia", "dxa_bia_1", "符合肌少症肌肉量界值"),
    });
    expect(r.tags[0].code).toBe("SARCOPENIA_DIAGNOSED");
  });
});
