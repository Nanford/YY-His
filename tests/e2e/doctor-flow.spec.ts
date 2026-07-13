/**
 * INPUT:  医生端页面、独立 E2E SQLite 数据库、黄金评分用例
 * OUTPUT: 新建患者到医生确认最终干预方案的端到端验收结果
 * POS:    M2 无语音完整流程回归；覆盖 4 个评估标签、8 个候选方案及审核留痕。
 */
import { expect, test, type Page } from "@playwright/test";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

type E2eAdapter = Awaited<ReturnType<PrismaBetterSqlite3["connect"]>>;
let e2eAdapter: E2eAdapter | undefined;

test.beforeAll(async () => {
  e2eAdapter = await new PrismaBetterSqlite3({ url: "file:./prisma/e2e.db" }).connect();
});

test.afterAll(async () => {
  await e2eAdapter?.dispose();
  e2eAdapter = undefined;
});

/** 直接读取独立 E2E 库的版本状态，验证页面之外的“唯一当前版本”数据约束。 */
async function readVersionStatuses(
  table: "AssessmentResult" | "InterventionPlan",
  sessionId: string,
): Promise<string[]> {
  if (!e2eAdapter) throw new Error("E2E 数据库连接尚未初始化");
  const result = await e2eAdapter.queryRaw({
    sql: `SELECT "status" FROM "${table}" WHERE "sessionId" = ?`,
    args: [sessionId],
    argTypes: [{ scalarType: "string", arity: "scalar" }],
  });
  return result.rows.map((row) => String(row[0]));
}

const expectedTags = ["衰弱", "存在营养不良风险", "跌倒风险筛查阴性", "阴虚质"];
const expectedInterventions = [
  "八段锦",
  "太极拳",
  "抗阻训练",
  "平衡训练",
  "均衡膳食维持",
  "优质蛋白强化",
  "能量与营养强化",
  "滋阴食养",
];

/** 按题号和标准分值选择医生代填答案，同时校验测试数据与当前题库仍然一致。 */
async function pickScore(page: Page, questionId: string, score: number): Promise<void> {
  const option = page.locator(
    `input[type="radio"][name="answer.${questionId}"][value="${score}"]`,
  );
  await expect(option, `题目 ${questionId} 应存在分值 ${score} 的选项`).toHaveCount(1);
  await option.check();
}

test("医生完成全量代填、评估、方案调整与确认", async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto("/doctor/patients/new");
  await page.locator('input[name="name"]').fill("E2E 全流程患者");
  await page.locator('select[name="gender"]').selectOption("男");
  await page.locator('input[name="age"]').fill("78");
  await page.locator('input[name="heightCm"]').fill("165");
  await page.locator('input[name="weightKg"]').fill("55");
  await page.locator('input[name="waistCm"]').fill("85");
  await page.locator('input[name="calfCm"]').fill("32");

  const patientForm = page.locator("form").filter({ has: page.locator('input[name="name"]') });
  await patientForm.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/doctor\/patients\/[^/?]+$/);
  await expect(page.getByRole("heading", { name: /E2E 全流程患者/ })).toBeVisible();
  await expect(page.getByText("BMI：20.2", { exact: true })).toBeVisible();

  const sessionForm = page.locator("form").filter({ has: page.locator('input[name="scale.frail"]') });
  await expect(sessionForm.locator('input[type="checkbox"][name^="scale."]')).toHaveCount(4);
  await sessionForm.getByRole("button", { name: "创建评估会话", exact: true }).click();
  await expect(page).toHaveURL(/\/doctor\/sessions\/[^/?]+$/);

  // 来源：量表题目_Demo.txt。FRAIL 3 分，判定为“衰弱”。
  for (const [index, score] of [1, 1, 1, 0, 0].entries()) {
    await pickScore(page, `frail_${index + 1}`, score);
  }

  // MNA-SF 的 A-E 合计 9 分；F 题由 BMI 20.2 自动换算为 1 分，总分 10 分。
  for (const [questionId, score] of [
    ["mnasf_A", 1],
    ["mnasf_B", 2],
    ["mnasf_C", 2],
    ["mnasf_D", 2],
    ["mnasf_E", 2],
  ] as const) {
    await pickScore(page, questionId, score);
  }

  // 三道跌倒筛查题全部为否，判定为“跌倒风险筛查阴性”。
  for (let index = 1; index <= 3; index += 1) {
    await pickScore(page, `fall_${index}`, 0);
  }

  // 中医体质第 9、28 题由 BMI/腹围自动换算；阴虚质四题合计 11 分。
  const yinDeficiencyScores = new Map([
    [10, 3],
    [21, 3],
    [26, 3],
    [31, 2],
  ]);
  for (let number = 1; number <= 33; number += 1) {
    if (number === 9 || number === 28) continue;
    await pickScore(page, `tcm_${number}`, yinDeficiencyScores.get(number) ?? 1);
  }

  const collectionForm = page.locator("form").filter({ has: page.locator('input[name="answer.frail_1"]') });
  await collectionForm.getByRole("button", { name: /完成采集/ }).click();

  const resultSection = page.locator("section").filter({ has: page.getByRole("heading", { name: /评估标签/ }) });
  await expect(resultSection.getByRole("heading", { name: "评估标签", exact: true })).toBeVisible();
  await expect(resultSection.getByText("4 个标签", { exact: true })).toBeVisible();
  await expect(resultSection.locator("details")).toHaveCount(4);
  for (const tag of expectedTags) {
    await expect(resultSection.getByText(tag, { exact: true })).toBeVisible();
  }
  const frailDetail = resultSection.locator("details").filter({ hasText: "衰弱" }).first();
  await frailDetail.locator("summary").click();
  await expect(frailDetail.getByRole("columnheader", { name: "标准答案", exact: true })).toBeVisible();
  await expect(frailDetail.locator("tbody tr").first().locator("td").nth(2)).toHaveText("是");

  const reviewSection = page.locator("section").filter({
    has: page.getByRole("heading", { name: "候选干预方案审核", exact: true }),
  });
  await expect(reviewSection).toBeVisible();
  await expect(reviewSection.getByText("8 项候选", { exact: true })).toBeVisible();
  await expect(reviewSection.locator('input[type="checkbox"][name^="keep."]')).toHaveCount(8);
  for (const intervention of expectedInterventions) {
    await expect(reviewSection.getByText(intervention, { exact: true })).toBeVisible();
  }
  for (const category of ["运动干预", "膳食补充", "中医食养"]) {
    await expect(reviewSection.getByRole("heading", { name: category, exact: true })).toBeVisible();
  }
  await expect(reviewSection.getByText(/枸杞.*银耳/)).toBeVisible();
  await expect(reviewSection.locator('aside[aria-label="优质蛋白强化禁忌提示"]')).toContainText("肾功能");

  const adjustedTag = "八段锦";
  const removedTag = "太极拳";
  const adjustedPlan = reviewSection.locator(`textarea[name="plan.${adjustedTag}"]`);
  const originalPlan = await adjustedPlan.inputValue();
  const adjustmentText = "E2E 调整：每次练习后记录耐受情况。";
  await adjustedPlan.fill(`${originalPlan}\n${adjustmentText}`);
  await reviewSection.locator(`input[name="note.${adjustedTag}"]`).fill("结合患者耐力调整并留痕");
  await reviewSection.locator(`input[name="keep.${removedTag}"]`).uncheck();
  await reviewSection.getByRole("button", { name: /确认最终干预方案/ }).click();

  const finalSection = page.locator("section").filter({ has: page.getByRole("heading", { name: /最终干预方案/ }) });
  await expect(finalSection).toBeVisible();
  await expect(finalSection.getByText("医生已确认", { exact: true })).toBeVisible();
  await expect(finalSection.getByText("最终保留 7 项", { exact: true })).toBeVisible();
  await expect(finalSection.getByText("调整 1 项", { exact: true })).toBeVisible();
  await expect(finalSection.getByText("删除 1 项", { exact: true })).toBeVisible();
  await expect(finalSection.getByText(adjustmentText, { exact: false })).toBeVisible();
  const auditSection = finalSection.locator('section[aria-label="方案审核记录"]');
  await expect(auditSection.getByText("已调整", { exact: true })).toBeVisible();
  await expect(auditSection.getByText("已删除", { exact: true })).toBeVisible();
  await expect(auditSection.getByText(adjustedTag, { exact: true })).toBeVisible();
  await expect(auditSection.getByText(removedTag, { exact: true })).toBeVisible();
  await expect(page.locator('textarea[name^="plan."]')).toHaveCount(0);

  await page.reload();
  await expect(finalSection.getByText("最终保留 7 项", { exact: true })).toBeVisible();
  await expect(finalSection.getByText(adjustmentText, { exact: false })).toBeVisible();

  // 已确认会话重新打开后修改标准答案：旧结果/方案保留，新答案必须产生逐字段审计记录。
  await page.getByRole("button", { name: /重新打开并修正答案/ }).click();
  await expect(page.getByRole("button", { name: /完成采集/ })).toBeVisible();
  await pickScore(page, "frail_4", 1);
  await page.getByRole("button", { name: /完成采集/ }).click();

  const sessionId = new URL(page.url()).pathname.split("/").at(-1);
  if (!sessionId) throw new Error("无法从会话页面 URL 读取会话编号");

  const traceSection = page.locator("section").filter({
    has: page.getByRole("heading", { name: "答案与采集追溯", exact: true }),
  });
  const editedAnswer = traceSection.locator("details").filter({ hasText: "医生曾经告诉你存在5种以上" });
  await editedAnswer.locator("summary").click();
  const answerEdits = editedAnswer.getByText("原因：医生代填或修改标准答案", { exact: true });
  await expect(answerEdits).toHaveCount(2); // 标准答案文本与标准分值分别留痕
  await expect(answerEdits.first()).toBeVisible();
  await expect(traceSection.getByText("1 道已修改", { exact: true })).toBeVisible();

  // 重评后旧快照仍在，但当前结果与待确认方案各只能有一条。
  const resultVersions = await readVersionStatuses("AssessmentResult", sessionId);
  expect(resultVersions.filter((status) => status === "current")).toHaveLength(1);
  expect(resultVersions.filter((status) => status === "superseded")).toHaveLength(1);

  const planVersionsBeforeConfirm = await readVersionStatuses("InterventionPlan", sessionId);
  expect(planVersionsBeforeConfirm.filter((status) => status === "draft")).toHaveLength(1);
  expect(planVersionsBeforeConfirm.filter((status) => status === "confirmed")).toHaveLength(0);
  expect(planVersionsBeforeConfirm.filter((status) => status === "superseded")).toHaveLength(1);

  await page.getByRole("button", { name: /确认最终干预方案/ }).click();
  await expect(page.getByText("医生已确认", { exact: true })).toBeVisible();
  const planVersionsAfterConfirm = await readVersionStatuses("InterventionPlan", sessionId);
  expect(planVersionsAfterConfirm.filter((status) => status === "confirmed")).toHaveLength(1);
  expect(planVersionsAfterConfirm.filter((status) => status === "superseded")).toHaveLength(1);
});

test("无评估标签时医生可确认空干预方案", async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto("/doctor/patients/new");
  await page.locator('input[name="name"]').fill("E2E 空方案患者");
  await page.locator('select[name="gender"]').selectOption("女");
  await page.locator('input[name="age"]').fill("72");
  await page.locator('input[name="heightCm"]').fill("160");
  await page.locator('input[name="weightKg"]').fill("55");
  await page.locator('input[name="waistCm"]').fill("82");
  await page.getByRole("button", { name: "创建患者档案", exact: true }).click();

  const sessionForm = page.locator("form").filter({ has: page.locator('input[name="scale.tcm"]') });
  for (const scaleId of ["frail", "mnasf", "fall"]) {
    await sessionForm.locator(`input[name="scale.${scaleId}"]`).uncheck();
  }
  await sessionForm.getByRole("button", { name: "创建评估会话", exact: true }).click();

  // 全部偏颇体质小计均低于 9，同时平和质反向计分总分低于 17，因此合法地产生 0 个体质标签。
  const pingheOverrides = new Map([
    [2, 3],
    [4, 2],
    [5, 2],
    [13, 2],
  ]);
  for (let number = 1; number <= 33; number += 1) {
    if (number === 9 || number === 28) continue;
    await pickScore(page, `tcm_${number}`, pingheOverrides.get(number) ?? 1);
  }
  await page.getByRole("button", { name: /完成采集/ }).click();

  await expect(page.getByText("0 个标签", { exact: true })).toBeVisible();
  await expect(page.getByText("当前没有触发评估标签", { exact: true })).toBeVisible();
  await expect(page.getByText("暂无候选干预方案", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认暂无候选方案", exact: true }).click();

  await expect(page.getByText("最终保留 0 项", { exact: true })).toBeVisible();
  await expect(page.getByText("本次评估无最终干预项目", { exact: true })).toBeVisible();
  await expect(page.getByText("医生已确认", { exact: true })).toBeVisible();
});
