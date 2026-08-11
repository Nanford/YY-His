/**
 * INPUT:  患者端大屏页面、医生端页面、独立 E2E SQLite 数据库
 * OUTPUT: 患者自助完成问答后自动生成评估报告与候选方案的端到端验收结果
 * POS:    覆盖"评估内容不需要医生先确认，问答完成即生成报告"这条产品口径
 *         （2026-07-14 与用户确认）：全程不触碰医生端 CollectForm/finalizeSession，
 *         报告由患者问答自动触发生成；医生端候选方案审核仍并行可用、互不阻塞。
 *         V2 装机后口径：默认自定义 frail+fall_3q（6 道患者自答题，frail_4/frail_5 系统读取
 *         按 deferClinical 豁免并标注"部分计分"）；采集编排含总开场 narr_3 与 fall_3q 前的
 *         老年综合征过渡 narr_136（旁白播完自动推进，不需作答）；候选方案按 5 大类分组、
 *         含文本类干预文字卡。期望值由 tmp/e2e-golden-v2.ts 探针实算复核。
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

/** 患者端每题同屏只有一组大按钮（选项即按钮），点击后客户端自动推进下一题。 */
async function answer(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: label, exact: true }).click();
}

test("患者自助答完 FRAIL+跌倒后自动生成报告，医生端候选方案并行可审核", async ({ page }) => {
  test.setTimeout(180_000);

  // ---------- 医生：建档 + 自定义组合只勾选 FRAIL、跌倒三问（不需要测量数据） ----------
  await page.goto("/doctor/patients/new");
  await page.locator('input[name="name"]').fill("E2E 患者自助流程");
  await page.locator('select[name="gender"]').selectOption("女");
  await page.locator('input[name="age"]').fill("76");
  await page.getByRole("button", { name: "保存档案并继续", exact: true }).click();
  await expect(page).toHaveURL(/\/doctor\/patients\/[^/?]+$/);

  const sessionForm = page.locator("form").filter({ has: page.locator('input[name="package"]') });
  await sessionForm.locator('input[name="package"][value="custom"]').check();
  await sessionForm.locator('input[name="scale.frail"]').check();
  await sessionForm.locator('input[name="scale.fall_3q"]').check();
  await sessionForm.getByRole("button", { name: "创建评估会话", exact: true }).click();
  await expect(page).toHaveURL(/\/doctor\/sessions\/[^/?]+$/);
  const sessionId = new URL(page.url()).pathname.split("/").at(-1);
  if (!sessionId) throw new Error("无法从会话页面 URL 读取会话编号");
  await expect(page.getByRole("link", { name: /打开患者端采集大屏/ })).toBeVisible();

  // ---------- 患者：大屏自助问答，全程不经过医生端表单 ----------
  // 走手动作答路径：这条用例验证的是按钮驱动的问答闭环，语音自动模式另有专门的 e2e 覆盖
  await page.goto(`/patient/sessions/${sessionId}`);
  await page.getByRole("button", { name: "不方便说话，改用按钮或文字作答" }).click();
  // 量表 id 按 01 表文档顺序归一化（fall_3q 在 frail 之前），点「开始」进入采集编排：
  // 总开场 narr_3 → 老年综合征过渡 narr_136 → fall_3q 3 题 → frail 3 题；旁白播完自动推进。
  await page.getByRole("button", { name: "开始回答健康问题" }).click();
  // 衰弱前期（仅 frail_1 答是）+ 跌倒风险筛查阳性（仅 fall_3q_1 答是）
  await answer(page, "是（筛查阳性）");
  await answer(page, "否（筛查阴性）");
  await answer(page, "否（筛查阴性）");
  await answer(page, "是（1分）");
  await answer(page, "否（0分）");
  await answer(page, "否（0分）");

  // 2026-08-08 口径：答完自动出报告——结束语播完自动跳转，无需点击（按钮仅兜底）
  await expect(page.getByRole("button", { name: "查看我的评估报告", exact: true })).toBeVisible({ timeout: 20_000 });

  // 报告生成全程未经过医生任何操作：直接核实 DB 状态
  await expect.poll(() => readSessionStatus(sessionId)).toBe("collected");

  await expect(page.getByRole("heading", { name: "您的评估报告" })).toBeVisible({ timeout: 30_000 });
  // 评估范围与时间（V2.0 §3）：两个量表均标"新增"；frail 系统读取题豁免 → "部分计分"如实标注
  await expect(page.getByText("评估时间：", { exact: false })).toBeVisible();
  await expect(page.getByText("新增", { exact: true })).toHaveCount(2);
  await expect(page.getByText("部分计分", { exact: true })).toBeVisible();
  await expect(page.getByText("有 2 道需医生查看的题暂未计分", { exact: false })).toBeVisible();
  // V2 标签（fall_3q 的 perQuestionTags 明细标签同步产出：fall_3q_1 是 → 过去一年有跌倒史）
  await expect(page.getByText("衰弱前期", { exact: true })).toBeVisible();
  await expect(page.getByText("跌倒风险筛查阳性", { exact: true })).toBeVisible();
  await expect(page.getByText("过去一年有跌倒史", { exact: true })).toBeVisible();
  // 候选草案标识
  await expect(page.getByText("初步方案", { exact: false })).toBeVisible();
  await expect(page.getByText("医生确认中", { exact: false })).toBeVisible();
  // V2 积分候选（探针实算）：5 大类分组齐全，每类前 2
  for (const category of ["运动干预", "膳食营养", "中医食养", "就诊建议", "其他"]) {
    await expect(page.getByRole("heading", { name: category, exact: true })).toBeVisible();
  }
  for (const intervention of [
    "扶椅坐站训练",
    "前后脚站立训练",
    "优质蛋白强化膳食",
    "高能量高蛋白少量多餐",
    "山药莲子粥",
    "运动与功能康复建议",
    "老年综合诊疗建议",
    "辅助器具评估",
    "居家通道清理",
  ]) {
    await expect(page.getByRole("heading", { name: intervention, exact: true })).toBeVisible();
  }
  // 展示形态：YD02/YD06 视频素材已就位（卡内 <video> 播放，2 项）；SS02/SS03 膳食图片已就位
  // （可放大查看，2 项）；文本类干预直接展示正文（JZ 两项）
  await expect(page.locator("video")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /放大查看/ })).toHaveCount(2);
  await expect(page.getByText("适用场景：多问题共存", { exact: false })).toBeVisible();
  // 未确认的问询开始入口不应再出现（报告态与问询态互斥）
  await expect(page.getByRole("button", { name: "不方便说话，改用按钮或文字作答" })).toHaveCount(0);

  // ---------- 医生：能看到患者已自助生成的评估与候选方案，并行审核确认 ----------
  await page.goto(`/doctor/sessions/${sessionId}`);
  await expect(page.getByText("患者已可在大屏上直接看到", { exact: false })).toBeVisible();
  const resultSection = page.getByRole("heading", { name: /评估标签/ }).locator("xpath=ancestor::section[1]");
  await expect(resultSection.getByText("3 个标签", { exact: true })).toBeVisible();
  const reviewSection = page
    .getByRole("heading", { name: "候选干预方案审核", exact: true })
    .locator("xpath=ancestor::section[1]");
  await expect(reviewSection).toBeVisible();
  await expect(reviewSection.getByText("9 项候选", { exact: true })).toBeVisible();
  await reviewSection.getByRole("button", { name: /确认最终干预方案/ }).click();
  await expect(page.getByText("医生已确认", { exact: true })).toBeVisible();

  // ---------- 患者端刷新后应看到"医生已确认"而非"初步方案" ----------
  await page.goto(`/patient/sessions/${sessionId}`);
  await expect(page.getByText("医生已确认", { exact: false })).toBeVisible();
  await expect(page.getByText("初步方案", { exact: false })).toHaveCount(0);
});
