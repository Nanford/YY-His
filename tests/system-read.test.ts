/**
 * INPUT:  src/lib/assessment/system-read.ts（M9.5 系统读取推导）、data/scales-v2.json（选项 label 事实来源）
 * OUTPUT: 已实现系统读取/设备测量条目的推导规则，以及 V2/01 表全量覆盖分类校验。
 *         覆盖三类：已实现、需医护/设备、待口径；缺乏明确医学口径的 FRAIL/NRS2002 条目不自动作答。
 * POS:    系统读取自动作答的回归保险（确定性红线：label 必须命中规则数据，分值边界锁死）。
 */
import { describe, expect, it } from "vitest";
import { scalesV2 } from "@/lib/rules/v2";
import {
  resolveSystemReadAnswers,
  SYSTEM_READ_COVERAGE,
  validateSystemReadCoverage,
  type PatientLike,
  type SystemReadAnswer,
} from "@/lib/assessment/system-read";

const ALL_SCALES = ["frail", "mnasf"] as const;

function resolve(patient: PatientLike, existing?: ReadonlySet<string>): SystemReadAnswer[] {
  return resolveSystemReadAnswers(patient, ALL_SCALES, existing ? { existing } : undefined);
}

function byQuestion(answers: SystemReadAnswer[], questionId: string): SystemReadAnswer | undefined {
  return answers.find((a) => a.questionId === questionId);
}

/** 规则数据反查：该条目 options 中必须存在这个 label（全链路确定性红线的守门口径） */
function optionLabels(questionId: string): string[] {
  for (const scale of scalesV2) {
    const item = scale.items.find((i) => i.id === questionId);
    if (item?.options) return item.options.map((o) => o.label);
  }
  throw new Error(`测试数据异常：找不到条目 ${questionId} 的选项`);
}

describe("SYSTEM_READ_COVERAGE：V2/01 表覆盖与分类", () => {
  it("每个系统读取/设备测量条目均有且只有一个注册项，且规则字段一致", () => {
    const validation = validateSystemReadCoverage();
    expect(validation.ok, JSON.stringify(validation)).toBe(true);
    expect(new Set(SYSTEM_READ_COVERAGE.map((entry) => entry.questionId)).size).toBe(SYSTEM_READ_COVERAGE.length);
    expect(SYSTEM_READ_COVERAGE.some((entry) => entry.status === "implemented")).toBe(true);
    expect(SYSTEM_READ_COVERAGE.some((entry) => entry.status === "needsClinicalOrDevice")).toBe(true);
    expect(SYSTEM_READ_COVERAGE.some((entry) => entry.status === "pendingDefinition")).toBe(true);
  });

  it("未拍板条目不因存在同名字段而自动作答", () => {
    const patient: PatientLike = {
      age: 75,
      heightCm: 160,
      weightKg: 45,
      weightHistory: { m1: 48, m3: 50, m6: 52, m12: 56 },
      diagnoses: ["高血压", "糖尿病", "冠心病", "慢阻肺", "白内障"],
    };
    const answers = resolveSystemReadAnswers(patient, ["frail", "nrs2002", "morse", "glim"]);
    expect(answers.map((answer) => answer.questionId)).not.toEqual(
      expect.arrayContaining(["frail_4", "frail_5", "nrs2002_初筛1", "nrs2002_初筛2", "nrs2002_初筛4", "glim_6"])
    );
  });
});

describe("mnasf_6：BMI 四档（优先按 BMI）", () => {
  // 身高 100cm 时 BMI 数值 == 体重数值，便于直接写边界
  it.each([
    [18.9, 0, "BMI＜19（0分）"],
    [19, 1, "19≤BMI＜21（1分）"],
    [21, 2, "21≤BMI＜23（2分）"],
    [23, 3, "BMI≥23（3分）"],
  ])("BMI=%s → %s 分档", (weightKg, score, label) => {
    const answer = byQuestion(resolve({ heightCm: 100, weightKg }), "mnasf_6");
    expect(answer).toBeDefined();
    expect(answer!.score).toBe(score);
    expect(answer!.optionLabel).toBe(label);
    expect(answer!.rawText).toContain("BMI=");
  });
});

describe("mnasf_6：BMI 算不出时回退小腿围", () => {
  it("双腿取较细，<31cm → 0 分档", () => {
    const answer = byQuestion(resolve({ weightKg: 66, calfLeftCm: 29.5, calfRightCm: 31.5 }), "mnasf_6");
    expect(answer).toBeDefined();
    expect(answer!.score).toBe(0);
    expect(answer!.rawText).toContain("29.5");
    expect(answer!.optionLabel).toBe("＜31 cm（0分）");
  });

  it("双腿取较细，≥31cm → 3 分档（label 精确取「≥31 cm（3分）」）", () => {
    const answer = byQuestion(resolve({ weightKg: 66, calfLeftCm: 33, calfRightCm: 32 }), "mnasf_6");
    expect(answer!.score).toBe(3);
    expect(answer!.optionLabel).toBe("≥31 cm（3分）");
    expect(answer!.rawText).toContain("32.0");
  });

  it("双腿缺失回退旧字段 calfCm", () => {
    const answer = byQuestion(resolve({ calfCm: 30 }), "mnasf_6");
    expect(answer!.score).toBe(0);
    expect(answer!.rawText).toContain("30.0");
  });

  it("BMI 与小腿围全缺 → 不答", () => {
    expect(byQuestion(resolve({}), "mnasf_6")).toBeUndefined();
    expect(byQuestion(resolve({ heightCm: 170 }), "mnasf_6")).toBeUndefined();
  });
});

describe("frail_5：规则未明确，不自动推导", () => {
  it("即使已有体重史，也保留给医护补录/待口径处理", () => {
    expect(byQuestion(resolve({ weightKg: 95, weightHistory: { m3: 100 } }), "frail_5")).toBeUndefined();
  });
});

describe("mnasf_2：近 3 个月体重下降四档", () => {
  it("下降 3.0kg → 2 分档（1～3kg）", () => {
    const answer = byQuestion(resolve({ weightKg: 100, weightHistory: { m3: 103 } }), "mnasf_2");
    expect(answer!.score).toBe(2);
    expect(answer!.optionLabel).toBe("体重下降1～3 kg（2分）");
  });

  it("下降 3.1kg → 0 分档（＞3kg）", () => {
    const answer = byQuestion(resolve({ weightKg: 100, weightHistory: { m3: 103.1 } }), "mnasf_2");
    expect(answer!.score).toBe(0);
    expect(answer!.optionLabel).toBe("体重下降＞3 kg（0分）");
  });

  it("下降 0.5kg → 3 分档（无下降）", () => {
    const answer = byQuestion(resolve({ weightKg: 100, weightHistory: { m3: 100.5 } }), "mnasf_2");
    expect(answer!.score).toBe(3);
    expect(answer!.optionLabel).toBe("体重没有下降（3分）");
  });

  it("体重上升（diff 为负）→ 3 分档", () => {
    const answer = byQuestion(resolve({ weightKg: 100, weightHistory: { m3: 99 } }), "mnasf_2");
    expect(answer!.score).toBe(3);
  });

  it("m3 缺失 → 不答；「不知道（1分）」档永不自动产生", () => {
    expect(byQuestion(resolve({ weightKg: 100, weightHistory: { m1: 103 } }), "mnasf_2")).toBeUndefined();
    const answer = byQuestion(resolve({ weightKg: 100, weightHistory: { m3: 104 } }), "mnasf_2");
    expect(answer!.optionLabel).not.toBe("不知道（1分）");
  });
});

describe("frail_4：规则未明确，不自动推导", () => {
  it("即使已有诊断清单，也不套用未在 01 表写明的疾病数阈值", () => {
    expect(
      byQuestion(resolve({ diagnoses: ["高血压", "糖尿病", "冠心病", "骨质疏松", "慢阻肺"] }), "frail_4")
    ).toBeUndefined();
  });
});

describe("morse_2：当前诊断 >1 个 → 15 分档（M10.3b 新增，与 frail_4 同 diagnoses 单源口径）", () => {
  const resolveMorse = (patient: PatientLike): SystemReadAnswer[] =>
    resolveSystemReadAnswers(patient, ["morse"]);

  it("1 种诊断 → 0 分档「无或仅1个医疗诊断（0分）」", () => {
    const answer = byQuestion(resolveMorse({ diagnoses: ["高血压"] }), "morse_2");
    expect(answer).toBeDefined();
    expect(answer!.score).toBe(0);
    expect(answer!.optionLabel).toBe("无或仅1个医疗诊断（0分）");
    expect(answer!.rawText).toContain("1 种");
  });

  it("2 种诊断 → 15 分档「超过1个医疗诊断（15分）」", () => {
    const answer = byQuestion(resolveMorse({ diagnoses: ["高血压", "糖尿病"] }), "morse_2");
    expect(answer!.score).toBe(15);
    expect(answer!.optionLabel).toBe("超过1个医疗诊断（15分）");
  });

  it("空诊断清单 → 0 分档；diagnoses 缺失 → 不答", () => {
    expect(byQuestion(resolveMorse({ diagnoses: [] }), "morse_2")!.score).toBe(0);
    expect(byQuestion(resolveMorse({}), "morse_2")).toBeUndefined();
  });

  it("morse_4（静脉输液）/morse_5（步态）无推导器，不产出（口径未拍板，留医生代填）", () => {
    const answers = resolveMorse({ diagnoses: ["高血压", "糖尿病"] });
    expect(byQuestion(answers, "morse_4")).toBeUndefined();
    expect(byQuestion(answers, "morse_5")).toBeUndefined();
  });
});

describe("glim_1/glim_2/glim_3：GLIM 体重史与低 BMI 界值（01 表「系统读取」）", () => {
  const resolveGlim = (patient: PatientLike, existing?: ReadonlySet<string>): SystemReadAnswer[] =>
    resolveSystemReadAnswers(patient, ["glim"], existing ? { existing } : undefined);

  describe("glim_1：过去6个月内体重下降＞5% → 是", () => {
    it("6 月前 100kg → 现在 94kg（下降 6%）→ 是", () => {
      const answer = byQuestion(resolveGlim({ weightKg: 94, weightHistory: { m6: 100 } }), "glim_1");
      expect(answer).toBeDefined();
      expect(answer!.optionLabel).toBe("是：过去6个月内体重下降＞5%");
      expect(answer!.score).toBe(1); // 无分合成选项哨兵：「是」→1
      expect(answer!.rawText).toContain("6.0%");
    });

    it("恰降 5%（100→95）→ 否（01 表口径为＞5%，等于不算）", () => {
      const answer = byQuestion(
        resolveGlim({ weightKg: 95, weightHistory: { m1: 100, m2: 100, m3: 100, m6: 100 } }),
        "glim_1"
      );
      expect(answer!.optionLabel).toBe("否");
      expect(answer!.score).toBe(0);
    });

    it("窗口内任一时点超 5% 即判「是」（取 m1/m2/m3/m6 最大下降）", () => {
      const answer = byQuestion(
        resolveGlim({ weightKg: 96, weightHistory: { m1: 97, m2: 102, m3: 98 } }),
        "glim_1"
      );
      expect(answer!.optionLabel).toBe("是：过去6个月内体重下降＞5%");
      expect(answer!.rawText).toContain("102.0");
    });

    it("仅 m12 体重（超出 6 个月窗口）→ 不答", () => {
      expect(byQuestion(resolveGlim({ weightKg: 90, weightHistory: { m12: 100 } }), "glim_1")).toBeUndefined();
    });

    it("缺当前体重或缺体重史 → 不答", () => {
      expect(byQuestion(resolveGlim({ weightHistory: { m3: 100 } }), "glim_1")).toBeUndefined();
      expect(byQuestion(resolveGlim({ weightKg: 66, weightHistory: {} }), "glim_1")).toBeUndefined();
      expect(byQuestion(resolveGlim({ weightKg: 66 }), "glim_1")).toBeUndefined();
    });
  });

  describe("glim_2：超过6个月的体重下降＞10% → 是", () => {
    it("12 月前 100kg → 现在 89kg（下降 11%）→ 是", () => {
      const answer = byQuestion(resolveGlim({ weightKg: 89, weightHistory: { m12: 100 } }), "glim_2");
      expect(answer!.optionLabel).toBe("是：超过6个月的体重下降＞10%");
      expect(answer!.score).toBe(1);
      expect(answer!.rawText).toContain("11.0%");
    });

    it("恰降 10%（100→90）→ 否（01 表口径为＞10%，等于不算）", () => {
      const answer = byQuestion(resolveGlim({ weightKg: 90, weightHistory: { m12: 100 } }), "glim_2");
      expect(answer!.optionLabel).toBe("否");
      expect(answer!.score).toBe(0);
    });

    it("m12 缺失（仅 m6，不足「超过 6 个月」）→ 不答", () => {
      expect(byQuestion(resolveGlim({ weightKg: 85, weightHistory: { m6: 100 } }), "glim_2")).toBeUndefined();
    });

    it("缺当前体重 → 不答", () => {
      expect(byQuestion(resolveGlim({ weightHistory: { m12: 100 } }), "glim_2")).toBeUndefined();
    });
  });

  describe("glim_3：低 BMI 界值（＜70 岁 BMI＜18.5 / ≥70 岁 BMI＜20）", () => {
    // 身高 100cm 时 BMI 数值 == 体重数值，便于直接写边界
    it("65 岁 BMI 18.4 → 符合低BMI界值", () => {
      const answer = byQuestion(resolveGlim({ age: 65, heightCm: 100, weightKg: 18.4 }), "glim_3");
      expect(answer!.optionLabel).toBe("符合低BMI界值：＜70岁且BMI＜18.5 kg/m²，或≥70岁且BMI＜20 kg/m²");
      expect(answer!.score).toBe(1); // 哨兵：^符合 命中→1（「不符合」不被误判）
      expect(answer!.rawText).toContain("18.5");
    });

    it("65 岁 BMI 恰 18.5 → 不符合（界值为＜18.5）", () => {
      const answer = byQuestion(resolveGlim({ age: 65, heightCm: 100, weightKg: 18.5 }), "glim_3");
      expect(answer!.optionLabel).toBe("不符合");
      expect(answer!.score).toBe(0);
    });

    it("69 岁 BMI 19 → 不符合（＜70 岁界值 18.5，不按高龄档）", () => {
      const answer = byQuestion(resolveGlim({ age: 69, heightCm: 100, weightKg: 19 }), "glim_3");
      expect(answer!.optionLabel).toBe("不符合");
    });

    it("70 岁 BMI 19.9 → 符合低BMI界值（≥70 岁界值 20）", () => {
      const answer = byQuestion(resolveGlim({ age: 70, heightCm: 100, weightKg: 19.9 }), "glim_3");
      expect(answer!.optionLabel).toBe("符合低BMI界值：＜70岁且BMI＜18.5 kg/m²，或≥70岁且BMI＜20 kg/m²");
    });

    it("70 岁 BMI 恰 20 → 不符合", () => {
      const answer = byQuestion(resolveGlim({ age: 70, heightCm: 100, weightKg: 20 }), "glim_3");
      expect(answer!.optionLabel).toBe("不符合");
    });

    it("缺年龄或缺身高/体重 → 不答", () => {
      expect(byQuestion(resolveGlim({ heightCm: 100, weightKg: 18 }), "glim_3")).toBeUndefined();
      expect(byQuestion(resolveGlim({ age: 80, weightKg: 18 }), "glim_3")).toBeUndefined();
      expect(byQuestion(resolveGlim({ age: 80, heightCm: 100 }), "glim_3")).toBeUndefined();
    });
  });

  it("existing（已有 confirmed 人工答案）命中的 glim 题跳过，不覆盖", () => {
    const patient: PatientLike = {
      age: 75,
      heightCm: 160,
      weightKg: 45,
      weightHistory: { m3: 50, m12: 56 },
    };
    const answers = resolveGlim(patient, new Set(["glim_1", "glim_3"]));
    expect(byQuestion(answers, "glim_1")).toBeUndefined();
    expect(byQuestion(answers, "glim_3")).toBeUndefined();
    expect(byQuestion(answers, "glim_2")).toBeDefined();
  });

  it("产出的 glim optionLabel 全部能在规则数据该条目 options 中精确查到", () => {
    const answers = resolveGlim({ age: 75, heightCm: 160, weightKg: 45, weightHistory: { m3: 50, m12: 56 } });
    expect(answers.length).toBeGreaterThan(0);
    for (const answer of answers) {
      expect(optionLabels(answer.questionId)).toContain(answer.optionLabel);
    }
  });
});

describe("通用行为", () => {
  const fullPatient: PatientLike = {
    heightCm: 170,
    weightKg: 66,
    weightHistory: { m1: 68, m3: 70 },
    diagnoses: ["高血压", "糖尿病", "冠心病", "骨质疏松", "慢阻肺", "白内障"],
  };

  it("产出的 optionLabel 全部能在规则数据该条目 options 中精确查到", () => {
    const answers = resolve(fullPatient);
    expect(answers.length).toBeGreaterThan(0);
    for (const answer of answers) {
      expect(optionLabels(answer.questionId)).toContain(answer.optionLabel);
    }
  });

  it("existing（已有 confirmed 人工答案）命中的题目跳过，不产出", () => {
    const answers = resolve(fullPatient, new Set(["frail_4", "mnasf_6"]));
    expect(byQuestion(answers, "frail_4")).toBeUndefined();
    expect(byQuestion(answers, "mnasf_6")).toBeUndefined();
    expect(byQuestion(answers, "frail_5")).toBeUndefined();
    expect(byQuestion(answers, "mnasf_2")).toBeDefined();
  });

  it("scaleIds 只覆盖勾选量表；逻辑计算条目（mnasf_3 等）不产出", () => {
    const answers = resolveSystemReadAnswers(fullPatient, ["frail"]);
    expect(answers.every((a) => a.questionId.startsWith("frail_"))).toBe(true);
    const mnasfAnswers = resolveSystemReadAnswers(fullPatient, ["mnasf"]);
    expect(byQuestion(mnasfAnswers, "mnasf_3")).toBeUndefined();
  });
});
