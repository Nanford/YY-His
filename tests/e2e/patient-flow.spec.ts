/**
 * INPUT:  患者端大屏页面、医生端页面、独立 E2E SQLite 数据库
 * OUTPUT: 患者自助完成问答后自动生成评估报告与候选方案的端到端验收结果
 * POS:    覆盖"评估内容不需要医生先确认，问答完成即生成报告"这条产品口径
 *         （2026-07-14 与用户确认）：全程不触碰医生端 CollectForm/finalizeSession，
 *         报告由患者问答自动触发生成；医生端候选方案审核仍并行可用、互不阻塞。
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

async function readSessionStatus(sessionId: string): Promise<string> {
  if (!e2eAdapter) throw new Error("E2E 数据库连接尚未初始化");
  const result = await e2eAdapter.queryRaw({
    sql: `SELECT "status" FROM "AssessmentSession" WHERE "id" = ?`,
    args: [sessionId],
    argTypes: [{ scalarType: "string", arity: "scalar" }],
  });
  return String(result.rows[0]?.[0]);
}

/** 患者端每题只有一个"是"/一个"否"按钮同屏显示，点击后客户端自动推进下一题。 */
async function answerNo(page: Page): Promise<void> {
  await page.getByRole("button", { name: "否", exact: true }).click();
}

test("患者自助答完 FRAIL+跌倒后自动生成报告，医生端候选方案并行可审核", async ({ page }) => {
  test.setTimeout(120_000);

  // ---------- 医生：建档 + 只勾选 FRAIL、跌倒（不需要测量数据） ----------
  await page.goto("/doctor/patients/new");
  await page.locator('input[name="name"]').fill("E2E 患者自助流程");
  await page.locator('select[name="gender"]').selectOption("女");
  await page.locator('input[name="age"]').fill("76");
  await page.getByRole("button", { name: "创建患者档案", exact: true }).click();
  await expect(page).toHaveURL(/\/doctor\/patients\/[^/?]+$/);

  const sessionForm = page.locator("form").filter({ has: page.locator('input[name="scale.frail"]') });
  for (const scaleId of ["mnasf", "tcm"]) {
    await sessionForm.locator(`input[name="scale.${scaleId}"]`).uncheck();
  }
  await sessionForm.getByRole("button", { name: "创建评估会话", exact: true }).click();
  await expect(page).toHaveURL(/\/doctor\/sessions\/[^/?]+$/);
  const sessionId = new URL(page.url()).pathname.split("/").at(-1);
  if (!sessionId) throw new Error("无法从会话页面 URL 读取会话编号");
  await expect(page.getByRole("link", { name: /打开患者端采集大屏/ })).toBeVisible();

  // ---------- 患者：大屏自助问答，全程不经过医生端表单 ----------
  // 走手动作答路径：这条用例验证的是按钮驱动的问答闭环，语音自动模式另有专门的 e2e 覆盖
  await page.goto(`/patient/sessions/${sessionId}`);
  await page.getByRole("button", { name: "不方便说话，改用按钮或文字作答" }).click();
  // 数字医生先讲解（intro），点「开始」进入第一题
  await page.getByRole("button", { name: "开始回答健康问题" }).click();

  // FRAIL 5 题 + 跌倒 3 题，全部boolean"是/否"，同屏只有一组按钮
  for (let i = 0; i < 8; i++) {
    await answerNo(page);
  }

  await expect(page.getByRole("button", { name: "查看我的评估报告", exact: true })).toBeVisible({ timeout: 15_000 });

  // 报告生成全程未经过医生任何操作：直接核实 DB 状态
  await expect.poll(() => readSessionStatus(sessionId)).toBe("collected");

  await page.getByRole("button", { name: "查看我的评估报告", exact: true }).click();
  await expect(page.getByRole("heading", { name: "您的评估报告" })).toBeVisible();
  await expect(page.getByText("无衰弱", { exact: true })).toBeVisible();
  await expect(page.getByText("跌倒风险筛查阴性", { exact: true })).toBeVisible();
  await expect(page.getByText("初步方案", { exact: false })).toBeVisible();
  await expect(page.getByText("医生确认中", { exact: false })).toBeVisible();
  // V2 积分候选：无衰弱+跌倒阴性 → 运动 M12 步行训练(5)/M11(3)、膳食 D07 营养餐盘(4)/D01、中医食养 C08/C01
  await expect(page.getByRole("heading", { name: "步行训练", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "营养餐盘", exact: true })).toBeVisible();
  await expect(page.getByText("视频教程待上线，请先参考下方动作要点").first()).toBeVisible();
  await expect(page.locator('img[alt="营养餐盘图文教程"]')).toBeVisible();
  // 未确认的问询开始入口不应再出现（报告态与问询态互斥）
  await expect(page.getByRole("button", { name: "不方便说话，改用按钮或文字作答" })).toHaveCount(0);

  // ---------- 医生：能看到患者已自助生成的评估与候选方案，并行审核确认 ----------
  await page.goto(`/doctor/sessions/${sessionId}`);
  await expect(page.getByText("患者已可在大屏上直接看到", { exact: false })).toBeVisible();
  const resultSection = page.getByRole("heading", { name: /评估标签/ }).locator("xpath=ancestor::section[1]");
  await expect(resultSection.getByText("2 个标签", { exact: true })).toBeVisible();
  const reviewSection = page
    .getByRole("heading", { name: "候选干预方案审核", exact: true })
    .locator("xpath=ancestor::section[1]");
  await expect(reviewSection).toBeVisible();
  await reviewSection.getByRole("button", { name: /确认最终干预方案/ }).click();
  await expect(page.getByText("医生已确认", { exact: true })).toBeVisible();

  // ---------- 患者端刷新后应看到"医生已确认"而非"初步方案" ----------
  await page.goto(`/patient/sessions/${sessionId}`);
  await expect(page.getByText("医生已确认", { exact: false })).toBeVisible();
  await expect(page.getByText("初步方案", { exact: false })).toHaveCount(0);
});
