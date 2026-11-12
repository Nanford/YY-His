/**
 * INPUT:  独立临时 SQLite 库、真实迁移/评分/推荐引擎、可控看图判定器
 * OUTPUT: 重新评分的持久化、版本、审计、并发和事务回滚回归结果
 * POS:    不连接演示数据库、不请求外部模型；期望得分和阈值直接取 Mini-Cog 01/02 表口径。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import type { DrawingJudge } from "@/lib/dialogue/drawing-judge";
import { questionById } from "@/lib/rules";
import { readAnswerEditHistory } from "@/lib/assessment/audit";
import { scoreAndSnapshot } from "@/lib/assessment/finalize";

// 仅替换连接入口，所有查询与事务均由真实 Prisma/SQLite 执行。
const database = vi.hoisted(() => ({ client: undefined as PrismaClient | undefined }));
vi.mock("@/lib/db", () => ({ get prisma() { return database.client; } }));
import { drawingRejudgeEligible, parseRejudgeNotice, rejudgeDrawingAnswer, rejudgeNoticeOf } from "@/lib/assessment/drawing-rejudge";

let temporaryDirectory: string;
let db: PrismaClient;
const DRAWING = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=";
const correct: DrawingJudge = async () => ({ verdict: "correct", confidence: 0.9, reason: "符合画钟标准" });
const incorrect: DrawingJudge = async () => ({ verdict: "incorrect", confidence: 0.9, reason: "未画指针" });

beforeAll(async () => {
  temporaryDirectory = mkdtempSync(path.join(tmpdir(), "his-drawing-rejudge-"));
  const factory = new PrismaBetterSqlite3({ url: `file:${path.join(temporaryDirectory, "test.db")}` });
  const migrationConnection = await factory.connect();
  try {
    const migrations = path.resolve("prisma/migrations");
    for (const entry of readdirSync(migrations, { withFileTypes: true }).filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      await migrationConnection.executeScript(readFileSync(path.join(migrations, entry.name, "migration.sql"), "utf8"));
    }
  } finally {
    await migrationConnection.dispose();
  }
  db = new PrismaClient({ adapter: factory });
  database.client = db;
});

beforeEach(async () => {
  await db.$transaction([
    db.answer.deleteMany(), db.assessmentResult.deleteMany(), db.interventionPlan.deleteMany(),
    db.assessmentSession.deleteMany(), db.patient.deleteMany(),
  ]);
});

afterAll(async () => {
  await db?.$disconnect();
  if (temporaryDirectory && path.dirname(temporaryDirectory) === path.resolve(tmpdir()) && path.basename(temporaryDirectory).startsWith("his-drawing-rejudge-")) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

/** 回忆 1 词 = 1 分；画钟暂缺，部分计分初筛阳性；画钟补得 2 分后总分 3 分转阴性。 */
async function seed(status: "in_progress" | "collected" | "confirmed" = "in_progress") {
  const recalled = questionById.get("minicog_3")!.options!.find((option) => option.score === 1)!;
  const session = await db.assessmentSession.create({
    data: {
      patient: { create: { code: "TEST-DRAWING", name: "测试档案", gender: "男", age: 75 } },
      scaleIds: ["minicog"],
      answers: { create: [
        { questionId: "minicog_2", rawText: DRAWING, source: "drawing", status: "pending" },
        { questionId: "minicog_3", rawText: "苹果", optionLabel: recalled.label, score: 1, source: "text", status: "confirmed" },
      ] },
    },
  });
  if (status !== "in_progress") {
    await db.$transaction(async (tx) => {
      await tx.assessmentSession.update({ where: { id: session.id }, data: { status: "finalizing" } });
      expect(await scoreAndSnapshot(tx, session.id, { deferClinical: true })).toEqual({ kind: "completed" });
    });
  }
  if (status === "confirmed") {
    await db.interventionPlan.updateMany({
      where: { sessionId: session.id, status: "draft" },
      data: { status: "confirmed", finalPlan: [{ code: "QT01" }], decisions: [{ action: "keep", note: "已核对" }], confirmedAt: new Date() },
    });
    await db.assessmentSession.update({ where: { id: session.id }, data: { status: "confirmed" } });
  }
  return session.id;
}

const answerOf = (sessionId: string) => db.answer.findUniqueOrThrow({ where: { sessionId_questionId: { sessionId, questionId: "minicog_2" } } });
const versionsOf = (sessionId: string) => db.assessmentSession.findUniqueOrThrow({ where: { id: sessionId }, include: { results: true, plans: true } });

describe("画图重新评分：真实持久化", () => {
  it.each([[correct, 2], [incorrect, 0]] as const)("采集中落分与修改历史，不提前出报告（%j → %s 分）", async (judge, score) => {
    const id = await seed();
    expect(await rejudgeDrawingAnswer(id, "minicog_2", judge)).toEqual({ kind: "scored", score, rescore: "none" });
    const answer = await answerOf(id);
    expect(answer).toMatchObject({ score, status: "confirmed", source: "drawing", rawText: DRAWING, aiJudgment: { method: "llm" } });
    expect(readAnswerEditHistory(answer.editHistory).map((edit) => edit.field).sort()).toEqual(["optionLabel", "score", "status"]);
    expect(readAnswerEditHistory(answer.editHistory).every((edit) => edit.operator === "system" && edit.reason.includes("AI 重新评分"))).toBe(true);
    expect(await versionsOf(id)).toMatchObject({ status: "in_progress", results: [], plans: [] });
  });

  it("已出报告：从部分计分阳性改为 3 分阴性，并替换候选方案；旧版本保留", async () => {
    const id = await seed("collected");
    const before = await versionsOf(id);
    expect(before.results[0].tags).toMatchObject([{ code: "COGNITIVE_BRIEF_SCREEN_POSITIVE", score: 1 }]);
    expect(await rejudgeDrawingAnswer(id, "minicog_2", correct)).toEqual({ kind: "scored", score: 2, rescore: "regenerated" });
    const after = await versionsOf(id);
    expect(after.status).toBe("collected");
    expect(after.completedAt).toEqual(before.completedAt);
    expect(after.results.map((result) => result.status).sort()).toEqual(["current", "superseded"]);
    const current = after.results.find((result) => result.status === "current")!;
    expect(current.tags).toMatchObject([{ code: "COGNITIVE_BRIEF_SCREEN_NEGATIVE", score: 3 }]);
    expect(current.deferred).toEqual([]);
    expect(after.plans.map((plan) => plan.status).sort()).toEqual(["draft", "superseded"]);
    expect(after.plans.find((plan) => plan.status === "draft")!.candidates).not.toEqual(before.plans[0].candidates);
  });

  it("已确认方案逐字段保留，只更新评估结果", async () => {
    const id = await seed("confirmed");
    const before = await versionsOf(id);
    expect(await rejudgeDrawingAnswer(id, "minicog_2", correct)).toMatchObject({ kind: "scored", rescore: "plan_kept" });
    const after = await versionsOf(id);
    expect(after.status).toBe("confirmed");
    expect(after.plans).toEqual(before.plans);
    expect(after.results.filter((result) => result.status === "current")).toHaveLength(1);
    expect(after.results.find((result) => result.status === "current")!.tags).toMatchObject([{ code: "COGNITIVE_BRIEF_SCREEN_NEGATIVE", score: 3 }]);
  });

  it("判定失败不编分、不重排快照；再次成功后不再接受重复评分", async () => {
    const id = await seed("collected");
    const before = await versionsOf(id);
    expect(await rejudgeDrawingAnswer(id, "minicog_2", async () => null)).toMatchObject({ kind: "unclear" });
    expect(await answerOf(id)).toMatchObject({ score: null, status: "pending", editHistory: null });
    expect(await versionsOf(id)).toEqual(before);
    expect(await rejudgeDrawingAnswer(id, "minicog_2", correct)).toMatchObject({ kind: "scored" });
    const once = await versionsOf(id);
    const judge = vi.fn(correct);
    expect(await rejudgeDrawingAnswer(id, "minicog_2", judge)).toEqual({ kind: "stale" });
    expect(judge).not.toHaveBeenCalled();
    expect(await versionsOf(id)).toEqual(once);
  });

  it("评分中会话立即返回 busy，且判定期间进入 finalizing 也不写答案", async () => {
    const id = await seed();
    await db.assessmentSession.update({ where: { id }, data: { status: "finalizing" } });
    const judge = vi.fn(correct);
    expect(await rejudgeDrawingAnswer(id, "minicog_2", judge)).toEqual({ kind: "busy" });
    expect(judge).not.toHaveBeenCalled();
    await db.assessmentSession.update({ where: { id }, data: { status: "in_progress" } });
    expect(await rejudgeDrawingAnswer(id, "minicog_2", async (drawing) => {
      await db.assessmentSession.update({ where: { id }, data: { status: "finalizing" } });
      return correct(drawing);
    })).toEqual({ kind: "busy" });
    expect((await answerOf(id)).score).toBeNull();
  });

  it("判定期间医生改答，旧 AI 结论不能覆盖", async () => {
    const id = await seed();
    const original = await answerOf(id);
    expect(await rejudgeDrawingAnswer(id, "minicog_2", async (drawing) => {
      await db.answer.update({ where: { id: original.id }, data: { source: "doctor", score: 0, status: "confirmed", optionLabel: "医生改判" } });
      return correct(drawing);
    })).toEqual({ kind: "stale" });
    expect(await answerOf(id)).toMatchObject({ source: "doctor", score: 0, optionLabel: "医生改判" });
  });

  it("判定期间同图重交仍待评分，旧版本结论也不能覆盖", async () => {
    const id = await seed();
    const original = await answerOf(id);
    expect(await rejudgeDrawingAnswer(id, "minicog_2", async (drawing) => {
      await db.answer.update({ where: { id: original.id }, data: { updatedAt: new Date(original.updatedAt.getTime() + 1000) } });
      return correct(drawing);
    })).toEqual({ kind: "stale" });
    expect((await answerOf(id)).score).toBeNull();
  });

  it("两次重评分交错返回时只接受先落库的结果，保留唯一当前版本", async () => {
    const id = await seed("collected");
    const later = await rejudgeDrawingAnswer(id, "minicog_2", async (drawing) => {
      expect(await rejudgeDrawingAnswer(id, "minicog_2", incorrect)).toMatchObject({ kind: "scored", score: 0 });
      return correct(drawing);
    });
    expect(later).toEqual({ kind: "stale" });
    expect((await answerOf(id)).score).toBe(0);
    const versions = await versionsOf(id);
    expect(versions.results).toHaveLength(2);
    expect(versions.plans.filter((plan) => plan.status === "draft")).toHaveLength(1);
  });

  it("重算快照写入中途失败时，答案、审计与旧快照全部回滚", async () => {
    const id = await seed("collected");
    const before = await versionsOf(id);
    const original = await answerOf(id);
    await db.$executeRawUnsafe('CREATE TRIGGER fail_rejudge BEFORE INSERT ON "AssessmentResult" BEGIN SELECT RAISE(ABORT, \'test failure\'); END');
    try {
      await expect(rejudgeDrawingAnswer(id, "minicog_2", correct)).rejects.toThrow();
      expect(await answerOf(id)).toEqual(original);
      expect(await versionsOf(id)).toEqual(before);
    } finally {
      await db.$executeRawUnsafe("DROP TRIGGER fail_rejudge");
    }
  });

  it("同时提交两次评分也只产生一份新快照", async () => {
    const id = await seed("collected");
    const outcomes = await Promise.all([
      rejudgeDrawingAnswer(id, "minicog_2", correct),
      rejudgeDrawingAnswer(id, "minicog_2", correct),
    ]);
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(["scored", "stale"]);
    const versions = await versionsOf(id);
    expect(versions.results).toHaveLength(2);
    expect(versions.results.filter((result) => result.status === "current")).toHaveLength(1);
    expect(versions.plans.filter((plan) => plan.status === "draft")).toHaveLength(1);
  });

  it("缺失会话或非画图题不调用模型", async () => {
    const judge = vi.fn(correct);
    expect(await rejudgeDrawingAnswer("missing-session", "minicog_2", judge)).toEqual({ kind: "stale" });
    const id = await seed();
    expect(await rejudgeDrawingAnswer(id, "minicog_3", judge)).toEqual({ kind: "stale" });
    expect(judge).not.toHaveBeenCalled();
  });
});

describe("重新评分入口与提示", () => {
  it("只有带画作的待评分绘图答案符合条件", () => {
    const candidate = { questionId: "minicog_2", source: "drawing", status: "pending", score: null, rawText: DRAWING };
    expect(drawingRejudgeEligible(candidate)).toBe(true);
    expect(drawingRejudgeEligible({ ...candidate, questionId: "mmse_30", status: "manual" })).toBe(true);
    for (const change of [{ score: 0 }, { source: "doctor" }, { status: "confirmed" }, { status: "superseded" }, { rawText: null }, { questionId: "minicog_3" }]) {
      expect(drawingRejudgeEligible({ ...candidate, ...change })).toBe(false);
    }
  });

  it("结果码正确表达报告与方案的处理结果，未知参数被忽略", () => {
    expect(rejudgeNoticeOf({ kind: "scored", score: 2, rescore: "none" })).toBe("scored");
    expect(rejudgeNoticeOf({ kind: "scored", score: 2, rescore: "regenerated" })).toBe("scored_rescored");
    expect(rejudgeNoticeOf({ kind: "scored", score: 2, rescore: "plan_kept" })).toBe("scored_plan_kept");
    expect(parseRejudgeNotice("scored_plan_kept")).toBe("scored_plan_kept");
    expect(parseRejudgeNotice("unknown")).toBeNull();
    expect(parseRejudgeNotice(undefined)).toBeNull();
  });
});
