/**
 * INPUT:  src/lib/rules（displayOptionLabel）、data/scales-v2.json、src/lib/dialogue/prompts.ts
 * OUTPUT: 患者端选项展示文案测试（2026-09-04 修改意见 1）
 * POS:    锁定"选项里不出现评分和备注"口径：括号注解（分值/流程/阳性判定等）只服务于
 *         评分引擎与 AI 归一化，患者端按钮展示与追问播报一律剥除；
 *         全量数据校验剥除后无空串、同题内无撞名（撞名会让两个按钮长一样）。
 *         注意：提交/匹配/评分仍用原始 label（matchButtonOption 行为不变，见 answer-button-label.test.ts）。
 */
import { describe, expect, it } from "vitest";
import { displayOptionLabel, questionById } from "@/lib/rules";
import { scalesV2 } from "@/lib/rules/v2";
import { clarifyText } from "@/lib/dialogue/prompts";
import { scaleById, optionsOf } from "@/lib/rules";

describe("displayOptionLabel：剥除评分与流程备注", () => {
  it("阶梯题的分值与流程注解不展示（修改意见 1 截图原例）", () => {
    expect(displayOptionLabel("可以听清（4分，结束听力评估）")).toBe("可以听清");
    expect(displayOptionLabel("不可以（进入下一题）")).toBe("不可以");
  });

  it("各类括号注解一律剥除，答案正文保留", () => {
    expect(displayOptionLabel("可独立进食（10分）")).toBe("可独立进食");
    expect(displayOptionLabel("是（筛查阳性，进入SPPB评估）")).toBe("是");
    expect(displayOptionLabel("柔软团块，切缘清楚（容易排出）")).toBe("柔软团块，切缘清楚");
    expect(displayOptionLabel("1级：一次喝完、无呛咳且≤5秒（正常）")).toBe("1级：一次喝完、无呛咳且≤5秒");
    expect(displayOptionLabel("步速下降（＜1.0 m/s）")).toBe("步速下降");
    // 半角括号同样剥除
    expect(displayOptionLabel("是(阳性)")).toBe("是");
  });

  it("无括号注解的选项原样返回", () => {
    expect(displayOptionLabel("数个干球状便，如坚果，很难排出")).toBe("数个干球状便，如坚果，很难排出");
    expect(displayOptionLabel("是")).toBe("是");
  });
});

describe("displayOptionLabel：全量数据校验", () => {
  it("42 量表全部选项剥除后无空串、同题内无撞名", () => {
    for (const scale of scalesV2) {
      for (const item of scale.items) {
        const stripped = (item.options ?? []).map((option) => displayOptionLabel(option.label));
        for (const label of stripped) {
          expect(label.length, `${scale.id}/${item.id} 剥除后为空`).toBeGreaterThan(0);
        }
        expect(new Set(stripped).size, `${scale.id}/${item.id} 剥除后撞名`).toBe(stripped.length);
      }
    }
  });
});

describe("追问话术播报选项不带评分/备注", () => {
  it("choice 题追问文案不念「（4分，结束听力评估）」类注解", () => {
    const question = questionById.get("hearing_2");
    const scale = scaleById.get("hearing");
    if (!question || !scale) throw new Error("hearing_2 应存在");
    const text = clarifyText(question, optionsOf(scale, question));
    expect(text).toContain("可以听清");
    expect(text).not.toContain("4分");
    expect(text).not.toContain("进入下一题");
    expect(text).not.toMatch(/[（(]/);
  });
});
