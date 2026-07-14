/**
 * INPUT:  即将发往第三方云端（DeepSeek / 火山）的请求 payload（任意 JSON 结构）
 * OUTPUT: assertPiiSafe（字段级深度校验）、piiSafeJsonFetch（强制过滤后出网的 fetch 包装）
 * POS:    合规红线：AGENTS.md 硬约束 1 "PII 本地化"。所有出网请求必须经过本层，
 *         患者直接身份信息字段禁止出网，患者标识只允许使用唯一编号 code。
 */

/** 出网 payload 中禁止出现的字段名（归一化后精确匹配：小写 + 去掉 _ 和 -） */
// 来源：AGENTS.md 硬约束 1 —— 姓名、身份证号、手机号、住院号、门诊号、住址等直接身份信息禁止出网
const FORBIDDEN_FIELD_NAMES = new Set([
  // 姓名类
  "name",
  "patientname",
  "realname",
  "fullname",
  // 证件类
  "idcard",
  "idcardno",
  "idno",
  "identitycard",
  "identityno",
  // 联系方式类
  "phone",
  "phoneno",
  "phonenumber",
  "mobile",
  "mobileno",
  "tel",
  "telephone",
  // 地址类
  "address",
  "homeaddress",
  "addr",
  // 就诊号类
  "admissionno",
  "admissionnumber",
  "outpatientno",
  "outpatientnumber",
  "hospitalno",
  "inpatientno",
  "medicalrecordno",
]);

/** 字段名归一化：大小写与分隔符差异不能绕过过滤（如 id_card / IdCard / id-card） */
function normalizeFieldName(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

export class PiiViolationError extends Error {
  /** 违规字段在 payload 中的路径，如 "user.patient_name"，便于测试与排障定位 */
  readonly path: string;

  constructor(path: string, detail: string) {
    super(`出网请求被 PII 过滤层拦截（${detail}）：${path}`);
    this.name = "PiiViolationError";
    this.path = path;
  }
}

export interface PiiGuardOptions {
  /**
   * 已知的 PII 明文值（如患者姓名、手机号）。调用方若持有患者对象，应把敏感值传入，
   * 由本层做值级兜底扫描 —— 防止 PII 被塞进白名单字段（如 text）后出网。
   */
  piiValues?: readonly string[];
}

/**
 * 深度校验出网 payload：
 * 1. 字段级 —— 任何层级出现禁用字段名即抛错（主防线，字段过滤有单元测试把关）；
 * 2. 值级 —— 字符串值中包含调用方声明的 PII 明文亦抛错（兜底防线）。
 * 校验失败抛 PiiViolationError，请求不会发出。
 */
export function assertPiiSafe(payload: unknown, options: PiiGuardOptions = {}): void {
  const piiValues = (options.piiValues ?? []).filter((value) => value && value.trim().length > 0);
  walk(payload, "$", piiValues);
}

function walk(node: unknown, path: string, piiValues: readonly string[]): void {
  if (typeof node === "string") {
    for (const value of piiValues) {
      if (node.includes(value)) {
        throw new PiiViolationError(path, "字符串值包含已登记的患者敏感信息");
      }
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => walk(item, `${path}[${index}]`, piiValues));
    return;
  }
  if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const childPath = `${path}.${key}`;
      if (FORBIDDEN_FIELD_NAMES.has(normalizeFieldName(key))) {
        throw new PiiViolationError(childPath, "字段名属于禁止出网的直接身份信息");
      }
      walk(value, childPath, piiValues);
    }
  }
  // 数字/布尔/null/undefined 无泄漏面，直接放行
}

export interface PiiSafeFetchInit {
  method: "POST" | "GET";
  headers?: Record<string, string>;
  /** JSON 请求体：出网前强制经过 assertPiiSafe，再序列化发送 */
  jsonBody?: unknown;
  signal?: AbortSignal;
  guard?: PiiGuardOptions;
}

/**
 * 所有第三方云端调用的唯一出网通道：先过 PII 过滤，再 fetch。
 * 禁止 provider 各自直接调用 fetch 出网（保证过滤层不可绕过）。
 */
export async function piiSafeJsonFetch(url: string, init: PiiSafeFetchInit): Promise<Response> {
  if (init.jsonBody !== undefined) {
    assertPiiSafe(init.jsonBody, init.guard);
  }
  return fetch(url, {
    method: init.method,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
    body: init.jsonBody === undefined ? undefined : JSON.stringify(init.jsonBody),
    signal: init.signal,
  });
}
