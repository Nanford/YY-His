/**
 * INPUT:  src/lib/assessment/report-profile.ts
 * OUTPUT: 患者报告身份条/基本情况派生口径的单测
 * POS:    锁定姓名脱敏（报告页不出现全名）与档案 Json 列的容错整理。
 */
import { describe, expect, it } from "vitest";
import {
  buildBasicInfoRows,
  buildIdentityItems,
  maskPatientName,
  type ReportProfileSource,
} from "@/lib/assessment/report-profile";

const emptyProfile: ReportProfileSource = {
  diagnoses: null,
  pastHistory: null,
  recentAcute: null,
  medications: null,
  careSituation: null,
  livingSituation: null,
};

describe("maskPatientName", () => {
  it("按性别保留首字加称谓", () => {
    expect(maskPatientName("张桂兰", "女")).toBe("张女士");
    expect(maskPatientName("王建国", "男")).toBe("王先生");
  });

  it("性别未知时遮蔽、空姓名给占位", () => {
    expect(maskPatientName("李四", "")).toBe("李**");
    expect(maskPatientName("  ", "女")).toBe("—");
  });
});

describe("buildIdentityItems", () => {
  it("输出七项且姓名不含全名", () => {
    const items = buildIdentityItems(
      { code: "P0001", name: "张桂兰", gender: "女", age: 61, heightCm: 158.5, weightKg: 43 },
      "2026/11/10 10:30:20"
    );
    expect(items.map((item) => item.label)).toEqual([
      "编号",
      "姓名",
      "性别",
      "年龄",
      "身高",
      "体重",
      "测试时间",
    ]);
    expect(items.map((item) => item.value)).toEqual([
      "P0001",
      "张女士",
      "女",
      "61岁",
      "158.5cm",
      "43kg",
      "2026/11/10 10:30:20",
    ]);
    expect(items.some((item) => item.value.includes("桂兰"))).toBe(false);
  });

  it("身高体重缺失时给占位", () => {
    const items = buildIdentityItems(
      { code: "P0002", name: "王建国", gender: "男", age: 70, heightCm: null, weightKg: null },
      "t"
    );
    expect(items[4].value).toBe("—");
    expect(items[5].value).toBe("—");
  });
});

describe("buildBasicInfoRows", () => {
  it("档案全空时三行均为未填写", () => {
    expect(buildBasicInfoRows(emptyProfile, []).map((row) => row.value)).toEqual([
      "未填写",
      "未填写",
      "未填写",
    ]);
  });

  it("病史合并去重、用药结论在前清单在后、照护带居住括注", () => {
    const rows = buildBasicInfoRows(
      {
        diagnoses: ["高血压", "糖尿病"],
        pastHistory: ["高血压", "骨质疏松"],
        recentAcute: ["肺炎"],
        medications: [{ name: "氨氯地平", category: "西药" }, { name: "二甲双胍" }],
        careSituation: "子女照护",
        livingSituation: "与子女同住",
      },
      ["存在多重用药"]
    );
    expect(rows[0]).toEqual({ label: "病史记录", value: "高血压、糖尿病、骨质疏松、肺炎" });
    expect(rows[1]).toEqual({
      label: "用药评估",
      value: "存在多重用药；当前用药 2 种：氨氯地平、二甲双胍",
    });
    expect(rows[2]).toEqual({ label: "家庭照护者", value: "子女照护（居住类型：与子女同住）" });
  });

  it("Json 列形状不符时丢弃而不抛错", () => {
    const rows = buildBasicInfoRows(
      { ...emptyProfile, diagnoses: "高血压", pastHistory: [1, "", "冠心病"], medications: [null, { name: 3 }] },
      []
    );
    expect(rows[0].value).toBe("冠心病");
    expect(rows[1].value).toBe("未填写");
  });
});
