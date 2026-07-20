/**
 * INPUT:  患者全部会话的最小信息（状态 / 量表范围 / 发起时间）
 * OUTPUT: 补充评估派生信息：已完成量表集合、本次报告各量表的"新增 / 复评"标识、量表是否需医生协助
 * POS:    补充评估与历史记录（来源：需求更新说明 V2.0 §3）的纯逻辑层——页面与 Server Action
 *         不各自判断"哪些量表已完成 / 本次是新增还是复评"，收敛在此避免口径漂移。
 */
import { scaleById } from "@/lib/rules";

/** 会话最小信息（Prisma AssessmentSession 行的子集，纯逻辑层不依赖 Prisma 类型） */
export interface SessionScaleInfo {
  status: string;
  scaleIds: readonly string[];
  startedAt: Date;
}

/** 已出报告（评估完成）的会话状态：collected=采集完成待审方案 / confirmed=方案已确认 */
const REPORTED_STATUSES = new Set(["collected", "confirmed"]);

/**
 * 患者已完成评估的量表集合。
 * 患者自助补充评估只能从未完成的量表中选；对既有量表的复评属"医生授权"（V2.0 §3），
 * 由医生端发起，不走患者自助入口。
 */
export function completedScaleIds(sessions: readonly SessionScaleInfo[]): Set<string> {
  const done = new Set<string>();
  for (const session of sessions) {
    if (!REPORTED_STATUSES.has(session.status)) continue;
    for (const id of session.scaleIds) done.add(id);
  }
  return done;
}

/** 量表范围标识：new=本次新增评估 / repeat=对既有量表的复评 */
export type ScaleScope = "new" | "repeat";

export interface ScaleScopeEntry {
  scaleId: string;
  scope: ScaleScope;
}

/**
 * 本次报告每个量表的范围标识：在本次会话发起之前已有完成记录 → 复评，否则 → 新增。
 * 报告页据此明确展示，避免把不同时间的评估结论误认为同一次采集结果（V2.0 §3）。
 * otherSessions 不含本次会话自身；发起时间相同的并列情形按"非更早"处理（保守标新增）。
 */
export function scaleScopes(
  sessionStartedAt: Date,
  sessionScaleIds: readonly string[],
  otherSessions: readonly SessionScaleInfo[]
): ScaleScopeEntry[] {
  const earlierDone = completedScaleIds(
    otherSessions.filter((s) => s.startedAt.getTime() < sessionStartedAt.getTime())
  );
  return sessionScaleIds.map((scaleId) => ({
    scaleId,
    scope: earlierDone.has(scaleId) ? "repeat" : "new",
  }));
}

/**
 * 该量表是否含需临床观察/测量的题（舌象、BMI、腹围、小腿围等）。
 * 含则患者自助答完会先落"需要医生协助"，由医生补录后出完整报告——补充评估选项上据此如实提示。
 * 直接从题库派生（与建档页 needsClinicianAssist 同一口径），不硬编码量表名。
 */
export function scaleNeedsClinician(scaleId: string): boolean {
  const scale = scaleById.get(scaleId);
  if (!scale) return false;
  return scale.questions.some((question) => question.measurement || question.observerAssisted);
}
