/**
 * INPUT:  患者端建档页面、患者端问询页面（画钟画布/图片选择/数字面板）、独立 E2E SQLite 数据库
 * OUTPUT: 患者自助勾选 minicog + 便秘两表走完全程的端到端回归结果
 * POS:    第一波修复的直接回归覆盖（既有 7 用例均未触达）：
 *         ① 画钟题（minicog_2，绘图操作）交卷即落 pending，复问轮跳过、会话正常 finished
 *            并自动出报告（deferClinical 豁免画钟计分缺口，报告标「部分计分」）——
 *            此前含 minicog 的患者自助会话必卡死（状态机对 asks=1 的 pending 抛错 500）；
 *         ② 按钮/图片作答按 label 精确匹配：便秘一问答「没有便秘困扰」不得产
 *            CONSTIPATION_SCREEN_POSITIVE（同分选项按分值 find 必撞首项的旧 bug）；
 *            Bristol 图（constipation_symptom_9，imageChoice）选 4 型应记 STOOL_FORM_TYPE_4；
 *         ③ 中医平和质负向题反向计分（A.1-2/1-3/1-4 按 6−原始分）基线核查结论：
 *            重跑 tmp/e2e-golden-v2.ts 探针，场景 A 输出与 doctor-flow.spec.ts 既有期望
 *            逐项一致（16 标签、平和质：否、9 候选、YD07 禁止）——反向计分不改变该画像
 *            的判定结果，既有 e2e 期望无需修正（另见 tmp/probe-tcm-reverse.ts 健康画像
 *            探针：27 题全答、负向题 1 分 → 平和质转化分 100 → 是，反向计分已生效）。
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

async function readSession(sessionId: string): Promise<{ status: string; scaleIds: string } | null> {
  if (!e2eAdapter) throw new Error("E2E 数据库连接尚未初始化");
  const result = await e2eAdapter.queryRaw({
    sql: `SELECT "status", "scaleIds" FROM "AssessmentSession" WHERE "id" = ?`,
    args: [sessionId],
    argTypes: [{ scalarType: "string", arity: "scalar" }],
  });
  const row = result.rows[0];
  return row ? { status: String(row[0]), scaleIds: String(row[1]) } : null;
}

/** 读取当前版本评估结果快照：标签编码集合 + 被豁免计分的医生题（deferClinical 留痕） */
async function readResultSnapshot(
  sessionId: string,
): Promise<{ tagCodes: string[]; deferredQuestionIds: string[] } | null> {
  if (!e2eAdapter) throw new Error("E2E 数据库连接尚未初始化");
  const result = await e2eAdapter.queryRaw({
    sql: `SELECT "tags", "deferred" FROM "AssessmentResult" WHERE "sessionId" = ? AND "status" = 'current'`,
    args: [sessionId],
    argTypes: [{ scalarType: "string", arity: "scalar" }],
  });
  const row = result.rows[0];
  if (!row) return null;
  const tags = JSON.parse(String(row[0])) as Array<{ code: string }>;
  const deferred = JSON.parse(String(row[1])) as Array<{ questionIds: string[] }>;
  return {
    tagCodes: tags.map((tag) => tag.code),
    deferredQuestionIds: deferred.flatMap((entry) => entry.questionIds),
  };
}

test("患者自助勾选 minicog+便秘两表：画钟交卷不卡死、便秘按 label 计标签、自动出部分计分报告", async ({ page }) => {
  test.setTimeout(240_000);
  // 演示大屏视口（与修改意见截图同尺寸），供下方"画钟区域一屏展示/无滚动条"断言使用
  await page.setViewportSize({ width: 1558, height: 903 });

  // ---------- 患者：自助建档（第一步），第二步走自选组合·临时自定义勾选 认知初筛 + 便秘筛查 + 便秘症状评估 ----------
  await page.goto("/patient/register");
  await page.locator('input[name="name"]').fill("E2E 画钟便秘患者");
  await page.getByText("男", { exact: true }).click();
  await page.locator('input[name="age"]').fill("76");

  await page.getByRole("button", { name: "下一步：选择评估内容", exact: true }).click();
  await expect(page).toHaveURL(/\/patient\/select-scales\?patientId=/);
  await page.getByRole("link", { name: /自选组合评估/ }).click();
  await expect(page).toHaveURL(/\/patient\/select-scales\/custom\?patientId=/);
  await page.getByRole("tab", { name: "临时自定义选择" }).click();
  await page.getByRole("checkbox", { name: /认知初筛.*记忆和认知/ }).check();
  await page.getByRole("checkbox", { name: /便秘筛查.*便秘困扰/ }).check();
  await page.getByRole("checkbox", { name: /便秘症状评估.*大便形状/ }).check();

  await page.getByRole("button", { name: /确认并进入采集/ }).click();
  await expect(page).toHaveURL(/\/patient\/sessions\/[^/?]+$/);
  const sessionId = new URL(page.url()).pathname.split("/").at(-1);
  if (!sessionId) throw new Error("无法从会话页面 URL 读取会话编号");

  const created = await readSession(sessionId);
  expect(created?.status).toBe("in_progress");
  // 自助入口按 01 表文档顺序归一化：minicog（行52）→ constipation_1q（行157）→ constipation_symptom（行158）
  expect(JSON.parse(created?.scaleIds ?? "[]")).toEqual(["minicog", "constipation_1q", "constipation_symptom"]);

  // ---------- 患者：手动模式走完全程（共 11 题：记词指令 1 + 画钟 1 + 回忆 1 + 便秘一问 1 + 症状表 7） ----------
  // 总开场/分类过渡/工具说明旁白播报完自动推进，无需逐条点击
  await page.getByRole("button", { name: "不方便说话，改用按钮或文字作答" }).click();
  await page.getByRole("button", { name: "开始回答健康问题" }).click();

  // 第 2 题 minicog_2（绘图操作）：画板上画一笔后交卷——此前此处交卷即触发会话卡死 500。
  // 认知题改版后画钟前多一条三词指令播报（instr_minicog_words），真实 TTS 逐条生成+播放，
  // 累计时长拉长，画布等待超时应覆盖"旁白×1（narr_50，2026-09-13 起三条开场白只留这条）+ 指令播报×1"的全部播报时间。
  // 题号口径（2026-09-12）：记词指令是 01 表量表第 1 个条目，计为第 1 题，画钟因此是第 2 题
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("第 2 / 11 题", { exact: true })).toBeVisible();

  // 2026-09-04 修改意见 4/7 回归：会话页不再叠第二条顶栏（患者布局顶栏已含品牌与返回入口）；
  // 画钟区域一屏展示——画布完整落在视口内，页面本身不出现横向/纵向滚动条
  await expect(page.locator("header")).toHaveCount(1);
  const canvasBox = await canvas.boundingBox();
  const viewport = page.viewportSize();
  if (!canvasBox || !viewport) throw new Error("无法读取画布/视口尺寸");
  expect(canvasBox.y).toBeGreaterThanOrEqual(0);
  expect(canvasBox.y + canvasBox.height).toBeLessThanOrEqual(viewport.height);
  const pageOverflow = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }));
  expect(pageOverflow.x).toBeLessThanOrEqual(1);
  expect(pageOverflow.y).toBeLessThanOrEqual(1);

  const box = canvasBox;
  await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2 - 60);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "提交画作", exact: true }).click();

  // 第 3 题 minicog_3：回忆 3 个词（3 分）；画钟题落 pending 等医生计分，不再轮末复问。
  // 认知题改版（2026-08-13）：复述题不再展示选项按钮（标准答案不泄露），手动模式下文字作答，
  // 由 LLM/规则兜底识别复述词数并映射「回忆N个词」选项（e2e 答全三个词，两条通道结论一致）。
  await expect(page.getByText("第 3 / 11 题", { exact: true })).toBeVisible();
  await page.locator('input[placeholder="请输入您的回答…"]').fill("苹果、钥匙、汽车");
  await page.getByRole("button", { name: "提交", exact: true }).click();

  // 第 4 题 constipation_1q_1：点「没有便秘困扰」——label 匹配修复的回归点，不得记成筛查阳性
  // （2026-09-04 修改意见 1：按钮只展示答案文本，评分/判定注解不上屏）
  await expect(page.getByText("第 4 / 11 题", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "没有便秘困扰", exact: true }).click();

  // 第 5 题 constipation_symptom_3（数字题）：数字面板默认 0，直接确认
  await expect(page.getByText("第 5 / 11 题", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认 0 分", exact: true }).click();

  // 第 6～10 题 constipation_symptom_4～8：全部答「否」
  for (let index = 6; index <= 10; index++) {
    await expect(page.getByText(`第 ${index} / 11 题`, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "否", exact: true }).click();
  }

  // 第 11 题 constipation_symptom_9（Bristol 图片选择）：选 4 型「腊肠样或蛇状，光滑而柔软」
  await expect(page.getByText("第 11 / 11 题", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "腊肠样或蛇状，光滑而柔软", exact: true }).click();

  // ---------- 交卷后会话正常结束并自动出报告（画钟卡死修复的直接回归） ----------
  await expect(page.getByRole("button", { name: "查看我的评估报告", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await readSession(sessionId))?.status).toBe("collected");

  // 快照级断言：画钟题按 deferClinical 豁免留痕；便秘标签按所选 label 各归各位
  const snapshot = await readResultSnapshot(sessionId);
  expect(snapshot?.deferredQuestionIds).toContain("minicog_2");
  expect(snapshot?.tagCodes).toContain("COGNITIVE_BRIEF_SCREEN_NEGATIVE");
  expect(snapshot?.tagCodes).toContain("CONSTIPATION_SCREEN_NEGATIVE");
  expect(snapshot?.tagCodes).not.toContain("CONSTIPATION_SCREEN_POSITIVE");
  expect(snapshot?.tagCodes).toContain("STOOL_FORM_TYPE_4");
  expect(snapshot?.tagCodes).not.toContain("STOOL_FORM_TYPE_1");

  // ---------- 报告页：标签与「部分计分」标注患者可见（2026-08-08 口径：答完自动跳转，无需点击） ----------
  await expect(page.getByRole("heading", { name: "老年综合评估报告" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /查看完整评估结果/ }).click();
  await page.getByRole("button", { name: /本次评估项目/ }).click();
  await expect(page.getByText("认知功能初筛阴性", { exact: true })).toBeVisible();
  await expect(page.getByText("便秘筛查阴性", { exact: true })).toBeVisible();
  await expect(page.getByText("便秘筛查阳性", { exact: true })).toHaveCount(0);
  await expect(page.getByText("粪便性状4型：光滑柔软的腊肠样或蛇状便", { exact: true })).toBeVisible();
  // minicog_2 画钟计分缺口豁免 → 部分计分标注（minicog 量表分组徽章 + 页首说明）
  await expect(page.getByText("部分计分", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("以上结果为部分计分，仅供参考", { exact: false })).toBeVisible();
});
