/**
 * INPUT:  医生端页面、独立 E2E SQLite 数据库、黄金评分用例
 * OUTPUT: 新建患者到医生确认最终干预方案的端到端验收结果
 * POS:    M2 无语音完整流程回归（V2 积分推荐口径）；覆盖 4 个评估标签、6 项积分候选及
 *         保留/删除/同类替换审核留痕（来源：需求更新说明 V2.0 §4.2）。
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
// V2 积分排名结果（由 src/lib/recommend 实算复核）：衰弱+存在营养不良风险+跌倒阴性+阴虚质
// 运动 M06/M12 同分 5（编码升序）；膳食 D02/D03 均 6 分；中医食养 C08=6/C01=5
const expectedInterventions = [
  "坐位抬腿踏步",
  "步行训练",
  "每日奶类补充",
  "优质蛋白加餐",
  "百合莲子羹",
  "山药大枣小米粥",
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

  // 医生端布局（doctor/layout.tsx）本身是一个 <section>，filter(has:) 会把布局也算进来，
  // 导致 details 计数连追溯区一起翻倍；改从标题出发取最近的祖先 section（组件自身面板）。
  const resultSection = page.getByRole("heading", { name: /评估标签/ }).locator("xpath=ancestor::section[1]");
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

  const reviewSection = page
    .getByRole("heading", { name: "候选干预方案审核", exact: true })
    .locator("xpath=ancestor::section[1]");
  await expect(reviewSection).toBeVisible();
  await expect(reviewSection.getByText("6 项候选", { exact: true })).toBeVisible();
  await expect(reviewSection.locator('input[type="radio"][name^="action."][value="keep"]')).toHaveCount(6);
  for (const intervention of expectedInterventions) {
    await expect(reviewSection.getByText(intervention, { exact: true })).toBeVisible();
  }
  for (const category of ["运动干预", "膳食干预", "中医食养干预"]) {
    await expect(reviewSection.getByRole("heading", { name: category, exact: true })).toBeVisible();
  }
  // V2 展示形态：运动项视频未上线回退文字要点；膳食/中医食养展示完整图文（正文即图片）
  await expect(reviewSection.getByText("视频教程待上线，请先参考下方动作要点", { exact: true })).toHaveCount(2);
  await expect(reviewSection.locator('img[alt="优质蛋白加餐图文教程"]')).toBeVisible();
  await expect(reviewSection.locator('img[alt="百合莲子羹图文教程"]')).toBeVisible();
  // 积分来源明细逐项下钻：6 项各有明细，匹配分 6 分项 ×3、5 分项 ×3
  await expect(reviewSection.getByText("积分来源：", { exact: true })).toHaveCount(6);
  await expect(reviewSection.getByText("匹配分 6", { exact: true })).toHaveCount(3);
  await expect(reviewSection.getByText("匹配分 5", { exact: true })).toHaveCount(3);

  // V2 审核操作：M06 同类替换为 M01（留痕前后编码），M12 删除（留痕原因）
  const replacedCode = "M06";
  const replacementCode = "M01";
  const removedCode = "M12";
  const replaceNote = "E2E：患者下肢耐力不足，改用上肢训练";
  const removeNote = "E2E：患者步行受限";
  await reviewSection.locator(`input[name="action.${replacedCode}"][value="replace"]`).check();
  await reviewSection.locator(`select[name="replaceWith.${replacedCode}"]`).selectOption(replacementCode);
  await reviewSection.locator(`input[name="note.${replacedCode}"]`).fill(replaceNote);
  await reviewSection.locator(`input[name="action.${removedCode}"][value="remove"]`).check();
  await reviewSection.locator(`input[name="note.${removedCode}"]`).fill(removeNote);
  await reviewSection.getByRole("button", { name: /确认最终干预方案/ }).click();

  const finalSection = page.getByRole("heading", { name: /最终干预方案/ }).locator("xpath=ancestor::section[1]");
  await expect(finalSection).toBeVisible();
  await expect(finalSection.getByText("医生已确认", { exact: true })).toBeVisible();
  // 6 候选 − 1 删除 = 5 项（替换不改变总数）；替换/删除各 1 项留痕
  await expect(finalSection.getByText("最终保留 5 项", { exact: true })).toBeVisible();
  await expect(finalSection.getByText("替换 1 项", { exact: true })).toBeVisible();
  await expect(finalSection.getByText("删除 1 项", { exact: true })).toBeVisible();
  await expect(finalSection.getByRole("heading", { name: "扶椅坐站", exact: true })).toBeVisible();
  await expect(finalSection.getByText("替换自 M06", { exact: true })).toBeVisible();
  const auditSection = finalSection.locator('section[aria-label="方案审核记录"]');
  await expect(auditSection.getByText("已替换", { exact: true })).toBeVisible();
  await expect(auditSection.getByText("已删除", { exact: true })).toBeVisible();
  await expect(auditSection.getByText("M06 → M01", { exact: true })).toBeVisible();
  await expect(auditSection.getByText("M12", { exact: true })).toBeVisible();
  await expect(auditSection.getByText(replaceNote, { exact: true })).toBeVisible();
  await expect(auditSection.getByText(removeNote, { exact: true })).toBeVisible();
  await expect(page.locator('input[name^="action."]')).toHaveCount(0);

  await page.reload();
  await expect(finalSection.getByText("最终保留 5 项", { exact: true })).toBeVisible();
  await expect(finalSection.getByRole("heading", { name: "扶椅坐站", exact: true })).toBeVisible();

  // 已确认会话重新打开后修改标准答案：旧结果/方案保留，新答案必须产生逐字段审计记录。
  await page.getByRole("button", { name: /重新打开并修正答案/ }).click();
  await expect(page.getByRole("button", { name: /完成采集/ })).toBeVisible();
  await pickScore(page, "frail_4", 1);
  await page.getByRole("button", { name: /完成采集/ }).click();

  const sessionId = new URL(page.url()).pathname.split("/").at(-1);
  if (!sessionId) throw new Error("无法从会话页面 URL 读取会话编号");

  const traceSection = page
    .getByRole("heading", { name: "答案与采集追溯", exact: true })
    .locator("xpath=ancestor::section[1]");
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
