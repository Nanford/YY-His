/**
 * INPUT:  答案修改前后快照、既有 editHistory、操作人及原因
 * OUTPUT: 追加后的逐字段修改记录
 * POS:    医生补录与系统测量换算共用的审计纯函数，保证答案变更可追溯。
 */

export interface AnswerSnapshot {
  optionLabel: string | null;
  score: number | null;
  rawText: string | null;
  source: string;
  status: string;
}

export interface AnswerEditRecord {
  at: string;
  field: keyof AnswerSnapshot;
  from: string | number | null;
  to: string | number | null;
  operator: "doctor" | "system";
  reason: string;
}

function isAnswerEditRecord(value: unknown): value is AnswerEditRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AnswerEditRecord>;
  return (
    typeof candidate.at === "string" &&
    typeof candidate.field === "string" &&
    (candidate.operator === "doctor" || candidate.operator === "system") &&
    typeof candidate.reason === "string"
  );
}

/** 数据库历史可能来自旧版本；只保留结构有效的记录，避免脏 JSON 破坏后续追加。 */
export function readAnswerEditHistory(value: unknown): AnswerEditRecord[] {
  return Array.isArray(value) ? value.filter(isAnswerEditRecord) : [];
}

export function appendAnswerEditHistory(
  history: unknown,
  previous: AnswerSnapshot,
  next: AnswerSnapshot,
  meta: Pick<AnswerEditRecord, "at" | "operator" | "reason">
): AnswerEditRecord[] {
  const appended = [...readAnswerEditHistory(history)];
  const fields: (keyof AnswerSnapshot)[] = ["optionLabel", "score", "rawText", "source", "status"];
  for (const field of fields) {
    if (previous[field] === next[field]) continue;
    appended.push({ ...meta, field, from: previous[field], to: next[field] });
  }
  return appended;
}
