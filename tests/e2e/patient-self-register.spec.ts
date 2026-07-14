/**
 * INPUT:  患者端建档页面、患者端问询页面、医生端页面、独立 E2E SQLite 数据库
 * OUTPUT: 患者自助建档 → 自助完成评估 → 仍进入医生审核队列 的端到端验收结果
 * POS:    覆盖"医患要可以自己建立档案，不是单独只能医护人员才可以"这条产品口径
 *         （2026-07-14 与用户确认）。核心不变量：自助建档不能绕过医生对干预方案的
 *         唯一审核关卡——自助生成的候选方案必须和医生录入的一样，停在 draft 等待确认。
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

async function readPatientCreatedBy(sessionId: string): Promise<{ status: string; scaleIds: string } | null> {
  if (!e2eAdapter) throw new Error("E2E 数据库连接尚未初始化");
  const result = await e2eAdapter.queryRaw({
    sql: `SELECT "status", "scaleIds" FROM "AssessmentSession" WHERE "id" = ?`,
    args: [sessionId],
    argTypes: [{ scalarType: "string", arity: "scalar" }],
  });
  const row = result.rows[0];
  return row ? { status: String(row[0]), scaleIds: String(row[1]) } : null;
}

test("患者全程自助建档并完成评估，仍需医生审核方案才能最终确认", async ({ page }) => {
  test.setTimeout(120_000);

  // ---------- 患者：自助建档，全程不经过医生端任何页面 ----------
  await page.goto("/patient");
  await page.getByRole("link", { name: "+ 我是新患者，开始建档" }).click();
  await expect(page).toHaveURL(/\/patient\/register$/);

  await page.locator('input[name="name"]').fill("E2E 自助建档患者");
  // 性别选项渲染为大按钮样式的 label（内部 radio 视觉隐藏），点击 label 才是真实用户操作
  await page.getByText("女", { exact: true }).click();
  await page.locator('input[name="age"]').fill("81");
  // 测量数据全部留空，验证选填字段真的可以跳过
  await page.getByRole("button", { name: "开始评估 →" }).click();

  // 提交后应直接落到该患者的问询会话页，无需医生创建任何东西
  await expect(page).toHaveURL(/\/patient\/sessions\/[^/?]+$/);
  const sessionId = new URL(page.url()).pathname.split("/").at(-1);
  if (!sessionId) throw new Error("无法从会话页面 URL 读取会话编号");

  const created = await readPatientCreatedBy(sessionId);
  expect(created?.status).toBe("in_progress");
  expect(JSON.parse(created?.scaleIds ?? "[]")).toEqual(["frail", "fall"]);

  // ---------- 患者：直接开始并答完（固定预设 FRAIL+跌倒，无测量/观察题缺口） ----------
  // 走"手动选择作答"：这条用例验证的是自助建档闭环本身，语音自动模式另有专门的 e2e 覆盖
  await page.getByRole("button", { name: "👆 手动选择作答" }).click();
  for (let i = 0; i < 8; i++) {
    await page.getByRole("button", { name: "否", exact: true }).click();
  }
  await expect(page.getByRole("button", { name: "查看我的评估报告 →" })).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await readPatientCreatedBy(sessionId))?.status).toBe("collected");

  // ---------- 核心不变量：自助建档不能绕过医生审核关卡 ----------
  // 医生端在此之前完全没有介入过这条会话，但应该能在患者列表里看到这个自助建档的患者，
  // 并在会话页看到"待审核"状态与候选方案——干预方案必须医生审核确认，这一关没有被跳过。
  await page.goto("/doctor");
  await expect(page.getByRole("cell", { name: "E2E 自助建档患者" })).toBeVisible();

  await page.goto(`/doctor/sessions/${sessionId}`);
  await expect(page.getByText("待审核", { exact: true })).toBeVisible();
  await expect(page.getByText("患者已可在大屏上直接看到", { exact: false })).toBeVisible();
  const reviewSection = page.locator("section").filter({
    has: page.getByRole("heading", { name: "候选干预方案审核", exact: true }),
  });
  await expect(reviewSection).toBeVisible();
  await reviewSection.getByRole("button", { name: /确认最终干预方案|确认暂无候选方案/ }).click();
  await expect(page.getByText("医生已确认", { exact: true })).toBeVisible();

  // 医生确认后，患者端刷新应看到"医生已确认"——闭环完整
  await page.goto(`/patient/sessions/${sessionId}`);
  await expect(page.getByText("医生已确认", { exact: false })).toBeVisible();
});

test("必填字段缺失时给出提示，不会静默创建残缺档案", async ({ page }) => {
  await page.goto("/patient/register");
  await page.locator('input[name="name"]').fill("只填了名字");
  // 不选性别、不填年龄，浏览器原生 required 会拦截提交；去掉 required 属性绕过前端校验，
  // 验证服务端 Server Action 自身的兜底校验（不可信输入的红线）。性别是两个同名 radio，
  // required 加在了两个选项上，必须都摘掉才能让原生校验放行空提交。
  await page.evaluate(() => {
    document.querySelectorAll('input[name="gender"]').forEach((el) => el.removeAttribute("required"));
    document.querySelector('input[name="age"]')?.removeAttribute("required");
  });
  await page.getByRole("button", { name: "开始评估 →" }).click();

  await expect(page).toHaveURL(/\/patient\/register\?error=required$/);
  await expect(page.getByText("请完整填写姓名、性别、年龄", { exact: false })).toBeVisible();
});
