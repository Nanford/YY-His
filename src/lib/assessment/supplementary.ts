/**
 * INPUT:  患者全部会话的最小信息（状态 / 量表范围 / 发起时间），随访对比另加各会话当次报告的标签快照
 * OUTPUT: 补充评估派生信息：已完成量表集合、本次报告各量表的"新增 / 复评"标识、量表是否需医生协助、
 *         复评量表与上次报告的对比（标签新增/消失/保留、总分升降）
 * POS:    补充评估与历史记录（来源：需求更新说明 V2.0 §3）的纯逻辑层——页面与 Server Action
 *         不各自判断"哪些量表已完成 / 本次是新增还是复评"，收敛在此避免口径漂移。
 */
import { scaleById } from "@/lib/rules";
import { judgmentsV2 } from "@/lib/rules/v2";

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

/** 补充评估归属校验结果：forbidden=本机 cookie 不属于源会话患者（越权）；not_reported=源会话未出报告 */
export type SupplementaryGuardResult =
  | { ok: true }
  | { ok: false; reason: "forbidden" | "not_reported" };

/**
 * 补充评估发起前的归属与状态校验（server action createSupplementarySession 调用，防越权）。
 * 只认本机 PATIENT_SESSION_COOKIE 对应会话的 patientId 与源会话一致，且源会话已出报告
 * （collected/confirmed，与"已完成量表"同一口径），否则拒绝——知道别人会话 id 不能
 * 替别人建会话并把本机 cookie 切过去（cookie 是一切患者端数据隔离的依据）。
 * cookie 会话缺失按越权处理（患者端正常流程必有建档时写入的 cookie）。
 */
export function checkSupplementaryGuard(
  cookieSessionPatientId: string | null,
  source: { patientId: string; status: string }
): SupplementaryGuardResult {
  if (!cookieSessionPatientId || cookieSessionPatientId !== source.patientId) {
    return { ok: false, reason: "forbidden" };
  }
  if (!REPORTED_STATUSES.has(source.status)) {
    return { ok: false, reason: "not_reported" };
  }
  return { ok: true };
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

/** 参与随访对比的标签最小形状（AssessmentResult.tags 快照元素的子集，结构化兼容 AssessmentTag） */
export interface ComparableTag {
  /** 02 表结果标签编码（集合比对以此为准） */
  code: string;
  /** 标签展示名（中医体质已拆去级别后缀） */
  tag: string;
  /** 判定级别（是 / 倾向是 / 基本是），展示徽章用 */
  level: string;
  scaleId: string;
  /** 判定所依据的得分：量表总分；中医体质为该体质转化分 */
  score: number;
}

/** 含当次报告标签快照的会话信息（随访对比的输入，在 SessionScaleInfo 上附加快照） */
export interface SessionSnapshotInfo extends SessionScaleInfo {
  tags: readonly ComparableTag[];
}

/** 标签集合变化中的一项（按 02 表编码比对后保留展示名与级别） */
export interface TagChange {
  code: string;
  tag: string;
  level: string;
}

/** 单个复评量表的随访对比结果（来源：Demo_v2 步骤 2「随访对比评估」） */
export interface ScaleComparison {
  scaleId: string;
  /** 对比基准会话的发起时间（同患者最近一次包含该量表、且早于本次发起的已出报告会话） */
  previousStartedAt: Date;
  /**
   * 上次 / 本次该量表总分。快照只在标签上留存判定得分（见 finalize.ts toAssessmentTags）：
   * 同量表全部标签得分一致时视为量表总分；中医体质（各体质转化分不同）或零标签量表为 null，
   * 报告页只展示标签变化、不展示数值升降。
   */
  previousScore: number | null;
  currentScore: number | null;
  /** 本次新增的标签（上次无、本次有） */
  added: TagChange[];
  /** 本次消失的标签（上次有、本次无） */
  removed: TagChange[];
  /** 两次均命中的标签 */
  kept: TagChange[];
}

/** 从某会话快照取该量表的标签（按编码去重，同编码保留首条） */
function scaleTagsOf(tags: readonly ComparableTag[], scaleId: string): Map<string, ComparableTag> {
  const map = new Map<string, ComparableTag>();
  for (const tag of tags) {
    if (tag.scaleId === scaleId && !map.has(tag.code)) map.set(tag.code, tag);
  }
  return map;
}

/**
 * 量表总分派生：同量表标签得分唯一时取之，否则 null（见 ScaleComparison.previousScore 注）。
 * 中医体质（tcmConstitutionV2）按评分引擎口径无单一总分（ScaleScoreResultV2.totalScore 恒为 null），
 * 其标签 score 是各体质转化分，即使本次只命中一种体质也不能当总分展示——按 judgments 配置判定。
 */
function deriveScaleScore(scaleId: string, tags: Map<string, ComparableTag>): number | null {
  const entry = judgmentsV2.find((j) => j.scaleId === scaleId);
  if (entry?.judgments.some((j) => j.type === "tcmConstitutionV2")) return null;
  const scores = new Set([...tags.values()].map((tag) => tag.score));
  return scores.size === 1 ? [...scores][0] : null;
}

/**
 * 复评量表的随访对比（Demo_v2 步骤 2）：对每个"复评"量表，找同患者最近一次包含该量表、
 * 早于本次发起且已出报告（collected/confirmed，与 scaleScopes 同一口径）的会话作为对比基准，
 * 比对标签集合（新增/消失/保留）与总分升降。新增量表与无可用基准的量表不产对比。
 */
export function scaleComparisons(
  sessionStartedAt: Date,
  current: { scaleIds: readonly string[]; tags: readonly ComparableTag[] },
  otherSessions: readonly SessionSnapshotInfo[]
): ScaleComparison[] {
  const earlier = otherSessions.filter(
    (s) => REPORTED_STATUSES.has(s.status) && s.startedAt.getTime() < sessionStartedAt.getTime()
  );
  const comparisons: ScaleComparison[] = [];
  for (const scaleId of current.scaleIds) {
    // 对比基准 = 最近一次包含该量表的更早已出报告会话（多次复评时与上一次比，而非与最早一次比）
    const base = earlier
      .filter((s) => s.scaleIds.includes(scaleId))
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
    if (!base) continue; // 新增量表无对比
    const previous = scaleTagsOf(base.tags, scaleId);
    const currentTags = scaleTagsOf(current.tags, scaleId);
    const toChange = (tag: ComparableTag): TagChange => ({ code: tag.code, tag: tag.tag, level: tag.level });
    comparisons.push({
      scaleId,
      previousStartedAt: base.startedAt,
      previousScore: deriveScaleScore(scaleId, previous),
      currentScore: deriveScaleScore(scaleId, currentTags),
      added: [...currentTags.values()].filter((tag) => !previous.has(tag.code)).map(toChange),
      removed: [...previous.values()].filter((tag) => !currentTags.has(tag.code)).map(toChange),
      kept: [...currentTags.values()].filter((tag) => previous.has(tag.code)).map(toChange),
    });
  }
  return comparisons;
}

/**
 * 该量表是否含需医生评估/系统读取的计分条目（V2 条目类型 ≠ 正式问题，如 FRAIL 疾病/体重、MNA-SF 活动能力等）。
 * 含则这些条目在患者自助路径豁免计分（deferClinical，Demo 口径），先出部分计分报告——
 * 补充评估选项上据此如实提示。直接从题库投影派生（与建档页同一口径），不硬编码量表名。
 */
export function scaleNeedsClinician(scaleId: string): boolean {
  const scale = scaleById.get(scaleId);
  if (!scale) return false;
  return scale.questions.some((question) => question.observerAssisted);
}
