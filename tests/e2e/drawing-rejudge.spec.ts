/**
 * INPUT:  医生追溯页、独立 E2E 数据库、关闭视觉通道的测试环境
 * OUTPUT: 重新评分入口、失败后定位提示、原始画作与既有快照保留的浏览器验收
 * POS:    实际提交 Server Action，模型通道关闭时不得伪造分值；成功重算由真实数据库集成测试覆盖。
 */
import { expect, test } from "@playwright/test";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { questionById } from "../../src/lib/rules";
import { recommendV2, toPlanCandidates } from "../../src/lib/recommend-v2";

type E2eAdapter = Awaited<ReturnType<PrismaBetterSqlite3["connect"]>>;
let db: E2eAdapter;
test.beforeAll(async () => { db = await new PrismaBetterSqlite3({ url: "file:./prisma/e2e.db" }).connect(); });
test.afterAll(async () => { await db?.dispose(); });

// Playwright 的 CommonJS 测试进程使用底层适配器，避免加载含 import.meta 的 Prisma 生成客户端。
async function query(sql: string, args: string[]) {
  const input = { sql, args, argTypes: args.map(() => ({ scalarType: "string" as const, arity: "scalar" as const })) };
  if (sql.startsWith("SELECT")) return db.queryRaw(input);
  await db.executeRaw(input);
  return { rows: [] };
}
async function versionsOf(sessionId: string) {
  return Promise.all([
    query('SELECT * FROM "AssessmentResult" WHERE "sessionId" = ? ORDER BY "id"', [sessionId]),
    query('SELECT * FROM "InterventionPlan" WHERE "sessionId" = ? ORDER BY "id"', [sessionId]),
  ]);
}

test("医生重评存档画作：失败后自动展开对应题目，可再次提交且不修改既有报告", async ({ page }) => {
  const recalled = questionById.get("minicog_3")!.options!.find((option) => option.score === 1)!;
  const drawing = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=";
  const session = { id: `e2e-rejudge-${Date.now()}` };
  const time = new Date().toISOString();
  await query('INSERT INTO "Patient" ("id", "code", "name", "gender", "age", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, 75, ?, ?)', [session.id, session.id, "重评分测试", "男", time, time]);
  await query('INSERT INTO "AssessmentSession" ("id", "patientId", "scaleIds", "status", "startedAt", "completedAt") VALUES (?, ?, ?, ?, ?, ?)', [session.id, session.id, '["minicog"]', "collected", time, time]);
  await query('INSERT INTO "Answer" ("id", "sessionId", "questionId", "source", "status", "rawText", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [session.id + "-drawing", session.id, "minicog_2", "drawing", "pending", drawing, time, time]);
  await query('INSERT INTO "Answer" ("id", "sessionId", "questionId", "source", "status", "rawText", "optionLabel", "score", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)', [session.id + "-recall", session.id, "minicog_3", "text", "confirmed", "苹果", recalled.label, time, time]);
  const tags = [{ tag: "认知功能初筛阳性", level: "", code: "COGNITIVE_BRIEF_SCREEN_POSITIVE", scaleId: "minicog", score: 1, detail: [] }];
  await query('INSERT INTO "AssessmentResult" ("id", "sessionId", "tags", "deferred", "status", "createdAt") VALUES (?, ?, ?, ?, ?, ?)', [session.id, session.id, JSON.stringify(tags), JSON.stringify([{ scaleId: "minicog", questionIds: ["minicog_2"] }]), "current", time]);
  await query('INSERT INTO "InterventionPlan" ("id", "sessionId", "candidates", "status", "createdAt") VALUES (?, ?, ?, ?, ?)', [session.id, session.id, JSON.stringify(toPlanCandidates(recommendV2(["COGNITIVE_BRIEF_SCREEN_POSITIVE"]))), "draft", time]);
  const versionsBefore = await versionsOf(session.id);

  await page.goto(`/doctor/sessions/${session.id}`);
  const trace = page.locator("#trace-minicog_2");
  await trace.locator("summary").click();
  await expect(trace.getByRole("img", { name: "患者提交的画作" })).toBeVisible();
  await expect(page.getByRole("button", { name: "AI 重新评分", exact: true })).toHaveCount(1);
  await trace.getByRole("button", { name: "AI 重新评分", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/doctor/sessions/${session.id}\\?rejudged=minicog_2&rejudge=unclear#trace-minicog_2`));
  await expect(trace).toHaveAttribute("open", "");
  await expect(trace.getByRole("status")).toContainText("AI 暂未得出评分结论");
  await expect(trace.getByRole("button", { name: "AI 重新评分", exact: true })).toBeEnabled();
  await expect(trace.getByText("待人工确认", { exact: true })).toHaveCount(0);

  const answer = (await query('SELECT "rawText", "score", "status", "editHistory", "aiJudgment" FROM "Answer" WHERE "id" = ?', [session.id + "-drawing"])).rows[0];
  expect(answer.slice(0, 4)).toEqual([drawing, null, "pending", null]);
  expect(JSON.parse(String(answer[4]))).toMatchObject({ status: "unclear", method: "none" });
  expect(await versionsOf(session.id)).toEqual(versionsBefore);

  // 已有医生分值的画作不显示 AI 重评入口，防止覆盖人工结论。
  await query('UPDATE "Answer" SET "source" = ?, "score" = 0, "status" = ? WHERE "id" = ?', ["doctor", "confirmed", session.id + "-drawing"]);
  await page.goto(`/doctor/sessions/${session.id}`);
  await page.locator("#trace-minicog_2 summary").click();
  await expect(page.getByRole("button", { name: "AI 重新评分", exact: true })).toHaveCount(0);
  await expect(page.locator("#trace-minicog_2").getByText("医生评分", { exact: true }).first()).toBeVisible();
});
