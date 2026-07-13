-- 评估结果采用“当前快照 + 历史快照”模型，重评时不物理删除旧结论。
ALTER TABLE "AssessmentResult" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'current';

-- 采集中会话不应保留“当前结果”；旧结果仍作为历史快照保存。
UPDATE "AssessmentResult"
SET "status" = 'superseded'
WHERE NOT EXISTS (
  SELECT 1
  FROM "AssessmentSession" AS "session"
  WHERE "session"."id" = "AssessmentResult"."sessionId"
    AND "session"."status" IN ('collected', 'confirmed')
);

-- 兼容升级前可能存在的多条结果：按落库时间及 SQLite 行序保留唯一的当前快照。
UPDATE "AssessmentResult" AS "older"
SET "status" = 'superseded'
WHERE "older"."status" = 'current'
  AND EXISTS (
  SELECT 1
  FROM "AssessmentResult" AS "newer"
  WHERE "newer"."sessionId" = "older"."sessionId"
    AND "newer"."status" = 'current'
    AND (
      "newer"."createdAt" > "older"."createdAt"
      OR (
        "newer"."createdAt" = "older"."createdAt"
        AND "newer".rowid > "older".rowid
      )
  )
);

-- 旧流程重开已确认会话时可能遗留多条 confirmed。按会话状态只保留最新的有效方案：
-- collected 对应 draft，confirmed 对应 confirmed，采集中会话不保留活动方案。
UPDATE "InterventionPlan"
SET "status" = 'superseded'
WHERE "status" IN ('draft', 'confirmed')
  AND NOT EXISTS (
    SELECT 1
    FROM "AssessmentSession" AS "session"
    WHERE "session"."id" = "InterventionPlan"."sessionId"
      AND (
        ("session"."status" = 'collected' AND "InterventionPlan"."status" = 'draft')
        OR ("session"."status" = 'confirmed' AND "InterventionPlan"."status" = 'confirmed')
      )
  );

UPDATE "InterventionPlan" AS "older"
SET "status" = 'superseded'
WHERE "older"."status" IN ('draft', 'confirmed')
  AND EXISTS (
    SELECT 1
    FROM "InterventionPlan" AS "newer"
    WHERE "newer"."sessionId" = "older"."sessionId"
      AND "newer"."status" = "older"."status"
      AND (
        "newer"."createdAt" > "older"."createdAt"
        OR (
          "newer"."createdAt" = "older"."createdAt"
          AND "newer".rowid > "older".rowid
        )
      )
  );

CREATE INDEX "AssessmentResult_sessionId_status_idx"
ON "AssessmentResult"("sessionId", "status");

CREATE INDEX "InterventionPlan_sessionId_status_idx"
ON "InterventionPlan"("sessionId", "status");

-- SQLite 触发器补足 Prisma schema 无法表达的“每会话仅一个活动版本”约束。
CREATE TRIGGER "AssessmentResult_one_current_insert"
BEFORE INSERT ON "AssessmentResult"
WHEN NEW."status" = 'current'
  AND EXISTS (
    SELECT 1 FROM "AssessmentResult"
    WHERE "sessionId" = NEW."sessionId" AND "status" = 'current'
  )
BEGIN
  SELECT RAISE(ABORT, 'assessment result current version already exists');
END;

CREATE TRIGGER "AssessmentResult_one_current_update"
BEFORE UPDATE OF "sessionId", "status" ON "AssessmentResult"
WHEN NEW."status" = 'current'
  AND EXISTS (
    SELECT 1 FROM "AssessmentResult"
    WHERE "sessionId" = NEW."sessionId" AND "status" = 'current' AND "id" <> OLD."id"
  )
BEGIN
  SELECT RAISE(ABORT, 'assessment result current version already exists');
END;

CREATE TRIGGER "InterventionPlan_one_active_insert"
BEFORE INSERT ON "InterventionPlan"
WHEN NEW."status" IN ('draft', 'confirmed')
  AND EXISTS (
    SELECT 1 FROM "InterventionPlan"
    WHERE "sessionId" = NEW."sessionId" AND "status" IN ('draft', 'confirmed')
  )
BEGIN
  SELECT RAISE(ABORT, 'intervention plan active version already exists');
END;

CREATE TRIGGER "InterventionPlan_one_active_update"
BEFORE UPDATE OF "sessionId", "status" ON "InterventionPlan"
WHEN NEW."status" IN ('draft', 'confirmed')
  AND EXISTS (
    SELECT 1 FROM "InterventionPlan"
    WHERE "sessionId" = NEW."sessionId"
      AND "status" IN ('draft', 'confirmed')
      AND "id" <> OLD."id"
  )
BEGIN
  SELECT RAISE(ABORT, 'intervention plan active version already exists');
END;
