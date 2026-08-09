/**
 * INPUT:  患者端自助建档页与报告页、独立 E2E SQLite 数据库
 * OUTPUT: 补充评估与历史记录（需求更新说明 V2.0 §3）的端到端验收结果
 * POS:    覆盖：报告可识别评估范围（新增标识）→ 患者对未完成量表发起补充评估
 *         （独立新会话、复用既有档案）→ 既有报告不被覆盖且经历史入口仍可访问
 *         （cookie 已切换到新会话，同患者历史报告互访放行）。
 *         2026-08-08 口径：createSupplementarySession 增加归属校验（本机 cookie 须与
 *         源会话同患者，且源会话已出报告）——医生代建档的大屏路径没有 cookie 会被拒，
 *         本用例走患者自助建档（默认勾 frail+fall_3q，建档即写入 cookie）满足新口径；
 *         补充评估候选为 42 个可评分量表（M10.3b-2 由 25 扩至 42）中尚未完成的 40 个。
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
  test.setTimeout(180_000);

  // ---------- 患者：自助建档（第一步）→ 第二步自选组合勾选 跌倒风险+衰弱评估（原默认两项），
  // registerPatient/startAssessment 写入本机会话 cookie ----------
  // 归属校验新口径：本机 cookie 与源会话同患者才能发起补充评估，自助建档路径天然满足
  await page.goto("/patient/register");
  await page.locator('input[name="name"]').fill("E2E 补充评估患者");
  // 性别选项渲染为大按钮样式的 label（内部 radio 视觉隐藏），点击 label 才是真实用户操作
  await page.getByText("男", { exact: true }).click();
  await page.locator('input[name="age"]').fill("80");
  await page.getByRole("button", { name: "下一步：选择评估内容", exact: true }).click();
  await expect(page).toHaveURL(/\/patient\/select-scales\?patientId=/);
  await page.getByRole("link", { name: /自选组合评估/ }).click();
  await page.getByRole("tab", { name: "临时自定义选择" }).click();
  await page.getByRole("checkbox", { name: /跌倒风险.*稳定情况/ }).check();
  await page.getByRole("checkbox", { name: /衰弱评估.*容易疲劳/ }).check();
  await page.getByRole("button", { name: /确认并进入采集/ }).click();
  await expect(page).toHaveURL(/\/patient\/sessions\/[^/?]+$/);
  const firstSessionId = new URL(page.url()).pathname.split("/").at(-1);
  if (!firstSessionId) throw new Error("无法从会话页面 URL 读取会话编号");

  // ---------- 患者：答完（量表按 01 表顺序归一化，先 fall_3q 3 题后 frail 3 题，旁白自动推进），生成报告 ----------
  await page.getByRole("button", { name: "不方便说话，改用按钮或文字作答" }).click();
  await page.getByRole("button", { name: "开始回答健康问题" }).click();
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "否（筛查阴性）", exact: true }).click();
  }
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "否（0分）", exact: true }).click();
  }
  // 2026-08-08 口径：答完自动跳转报告视图，无需点击按钮
  await expect(page.getByRole("button", { name: "查看我的评估报告", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "您的评估报告" })).toBeVisible({ timeout: 30_000 });

  // ---------- 报告可识别评估范围与生成时间：两个量表均标"新增"，有评估时间 ----------
  await expect(page.getByText("评估时间：", { exact: false })).toBeVisible();
  await expect(page.getByText("新增", { exact: true })).toHaveCount(2);

  // ---------- 发起补充评估：只列未完成量表（25 − 2 = 23 项，M10.3b 由 13 扩至 25），勾选 MNA-SF 提交 ----------
  await expect(page.getByRole("heading", { name: "还想评估更多项目？" })).toBeVisible();
  await expect(page.locator('input[type="checkbox"][name="scaleIds"]')).toHaveCount(40);
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
