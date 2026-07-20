/**
 * INPUT:  患者端报告页、医生端建档页面、独立 E2E SQLite 数据库
 * OUTPUT: 补充评估与历史记录（需求更新说明 V2.0 §3）的端到端验收结果
 * POS:    覆盖：报告可识别评估范围（新增标识）→ 患者对未完成量表发起补充评估
 *         （独立新会话、复用既有档案）→ 既有报告不被覆盖且经历史入口仍可访问
 *         （cookie 已切换到新会话，同患者历史报告互访放行）。
 */
import { expect, test } from "@playwright/test";
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

async function readSession(sessionId: string): Promise<{ status: string; scaleIds: string; patientId: string }> {
  if (!e2eAdapter) throw new Error("E2E 数据库连接尚未初始化");
  const result = await e2eAdapter.queryRaw({
    sql: `SELECT "status", "scaleIds", "patientId" FROM "AssessmentSession" WHERE "id" = ?`,
    args: [sessionId],
    argTypes: [{ scalarType: "string", arity: "scalar" }],
  });
  const row = result.rows[0];
  if (!row) throw new Error(`会话不存在：${sessionId}`);
  return { status: String(row[0]), scaleIds: String(row[1]), patientId: String(row[2]) };
}

test("报告页可识别评估范围，患者可发起补充评估且历史报告不被覆盖", async ({ page }) => {
  test.setTimeout(120_000);

  // ---------- 医生：建档 + 只勾选 FRAIL、跌倒 ----------
  await page.goto("/doctor/patients/new");
  await page.locator('input[name="name"]').fill("E2E 补充评估患者");
  await page.locator('select[name="gender"]').selectOption("男");
  await page.locator('input[name="age"]').fill("80");
  await page.getByRole("button", { name: "创建患者档案", exact: true }).click();
  await expect(page).toHaveURL(/\/doctor\/patients\/[^/?]+$/);

  const sessionForm = page.locator("form").filter({ has: page.locator('input[name="scale.frail"]') });
  for (const scaleId of ["mnasf", "tcm"]) {
    await sessionForm.locator(`input[name="scale.${scaleId}"]`).uncheck();
  }
  await sessionForm.getByRole("button", { name: "创建评估会话", exact: true }).click();
  await expect(page).toHaveURL(/\/doctor\/sessions\/[^/?]+$/);
  const firstSessionId = new URL(page.url()).pathname.split("/").at(-1);
  if (!firstSessionId) throw new Error("无法从会话页面 URL 读取会话编号");

  // ---------- 患者：答完 FRAIL+跌倒，生成报告 ----------
  await page.goto(`/patient/sessions/${firstSessionId}`);
  await page.getByRole("button", { name: "不方便说话，改用按钮或文字作答" }).click();
  await page.getByRole("button", { name: "开始回答健康问题" }).click();
  for (let i = 0; i < 8; i++) {
    await page.getByRole("button", { name: "否", exact: true }).click();
  }
  await page.getByRole("button", { name: "查看我的评估报告", exact: true }).click();
  await expect(page.getByRole("heading", { name: "您的评估报告" })).toBeVisible();

  // ---------- 报告可识别评估范围与生成时间：两个量表均标"新增"，有评估时间 ----------
  await expect(page.getByText("评估时间：", { exact: false })).toBeVisible();
  await expect(page.getByText("新增", { exact: true })).toHaveCount(2);

  // ---------- 发起补充评估：只列未完成量表（mnasf/tcm），勾选 mnasf 提交 ----------
  await expect(page.getByRole("heading", { name: "还想评估更多项目？" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /MNA-SF/ })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /中医体质/ })).toBeVisible();
  await page.getByRole("checkbox", { name: /MNA-SF/ }).check();
  await page.getByRole("button", { name: "开始补充评估" }).click();

  // 独立新会话：URL 切到新的会话 id（与本次不同），直接落在问询开始页
  await expect(page).not.toHaveURL(new RegExp(`/patient/sessions/${firstSessionId}$`));
  await expect(page).toHaveURL(/\/patient\/sessions\/[^/?]+$/);
  const secondSessionId = new URL(page.url()).pathname.split("/").at(-1);
  if (!secondSessionId) throw new Error("无法读取补充评估会话编号");
  expect(secondSessionId).not.toBe(firstSessionId);
  await expect(
    page.getByRole("button", { name: "开始评估，数字医生会先讲解，之后用语音作答" })
  ).toBeVisible();

  // 复用既有档案：新会话属于同一患者、只含勾选量表；旧会话保持 collected 不被覆盖
  const first = await readSession(firstSessionId);
  const second = await readSession(secondSessionId);
  expect(second.patientId).toBe(first.patientId);
  expect(JSON.parse(second.scaleIds)).toEqual(["mnasf"]);
  expect(second.status).toBe("in_progress");
  expect(first.status).toBe("collected");

  // 历史报告仍可访问：cookie 已切到新会话，但同患者旧报告直接打开不被挡回首页
  await page.goto(`/patient/sessions/${firstSessionId}`);
  await expect(page.getByRole("heading", { name: "您的评估报告" })).toBeVisible();
  await expect(page.getByText("无衰弱", { exact: true })).toBeVisible();
});
