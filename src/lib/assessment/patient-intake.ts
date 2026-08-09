/**
 * INPUT:  患者建档表单字段（FormData）、Prisma（患者编号唯一性校验）
 * OUTPUT: patientIdentitySchema / measurementsSchema / parseMeasurements /
 *         buildV2ProfileExtensions（V2 基础信息扩展，docx §1）/
 *         generatePatientCode / textOrNull / numberOrNull —— 患者档案创建的共享校验与工具
 * POS:    医生代录入（src/lib/actions/doctor.ts）与患者自助建档
 *         （src/lib/actions/patient.ts）共用同一套规则，避免两条入口的校验逻辑漂移。
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { scales } from "@/lib/rules";

/** 患者本机"记住我的会话"cookie 名（数据隔离用：患者首页据此只显示自己的会话） */
export const PATIENT_SESSION_COOKIE = "yy_patient_session";

export function textOrNull(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "" ? null : trimmed;
}

export function numberOrNull(formData: FormData, key: string): number | null {
  const raw = textOrNull(formData, key);
  if (raw === null) return null;
  return Number(raw);
}

export const patientIdentitySchema = z.object({
  name: z.string().trim().min(1).max(50),
  gender: z.enum(["男", "女"]),
  age: z.number().int().min(1).max(130),
});

export const measurementsSchema = z.object({
  heightCm: z.number().positive().max(300).nullable(),
  weightKg: z.number().positive().max(500).nullable(),
  waistCm: z.number().positive().max(300).nullable(),
  calfCm: z.number().positive().max(200).nullable(),
});

export type Measurements = z.infer<typeof measurementsSchema>;

export function parseMeasurements(formData: FormData): Measurements | null {
  const parsed = measurementsSchema.safeParse({
    heightCm: numberOrNull(formData, "heightCm"),
    weightKg: numberOrNull(formData, "weightKg"),
    waistCm: numberOrNull(formData, "waistCm"),
    calfCm: numberOrNull(formData, "calfCm"),
  });
  return parsed.success ? parsed.data : null;
}

// ---------- V2 基础信息扩展（来源：V2/Demo_v2更新说明.docx §1 基础信息填写）----------
// 全部选填；医生端完整表单与患者自助建档（2026-08-08 起同字段）共用本解析。
// 结构化落库后供"系统读取"题（FRAIL Q4Q5、MNA-SF、NRS2002、GLIM、Morse 等）直接调用（M9.5 装机）。

/** 文化程度枚举：MMSE 判定分层（thresholdByEducation，M10）要用 */
export const EDUCATION_LEVELS = ["文盲", "小学", "初中", "高中中专技校", "大专及以上"] as const;
export const MARITAL_STATUSES = ["未婚", "已婚", "丧偶", "离异", "其他"] as const;
export const LIVING_SITUATIONS = ["独居", "与配偶同住", "与子女同住", "与配偶及子女同住", "养老机构", "其他"] as const;
export const CARE_SITUATIONS = ["自我照护", "配偶照护", "子女照护", "保姆或护工", "机构照护", "其他"] as const;
/** 用药类别（docx §1：当前使用的西药、中成药和保健品） */
export const MEDICATION_CATEGORIES = ["西药", "中成药", "保健品"] as const;

export type MedicationCategory = (typeof MEDICATION_CATEGORIES)[number];

export interface MedicationEntry {
  name: string;
  category: MedicationCategory;
  dose?: string;
  frequency?: string;
}

/** 历史体重 kg（现在体重沿用 Patient.weightKg，不入本对象） */
export interface WeightHistory {
  m1: number | null;
  m2: number | null;
  m3: number | null;
  m6: number | null;
  m12: number | null;
}

/** V2 扩展字段的落库形状：标量一律给值（缺省 null）；Json 字段缺省时键缺省（Prisma Json? 不接受顶层 null） */
export interface V2ProfileExtensions {
  education: string | null;
  maritalStatus: string | null;
  livingSituation: string | null;
  careSituation: string | null;
  diagnoses?: string[];
  pastHistory?: string[];
  recentAcute?: string[];
  medications?: MedicationEntry[];
  weightHistory?: WeightHistory;
  calfLeftCm: number | null;
  calfRightCm: number | null;
  gripStrengthKg: number | null;
  gaitSpeed6mSec: number | null;
}

const optionalEnum = (values: readonly string[]) =>
  z
    .string()
    .refine((value): value is string => values.includes(value))
    .nullable();

/** 数值范围与表单提示一致：体重 20–300kg、小腿围 10–80cm、握力 0–100kg、6 米用时 1–120s */
const weightKgSchema = z.number().min(20).max(300).nullable();
const v2MeasurementsSchema = z.object({
  weightHistory: z.object({
    m1: weightKgSchema,
    m2: weightKgSchema,
    m3: weightKgSchema,
    m6: weightKgSchema,
    m12: weightKgSchema,
  }),
  calfLeftCm: z.number().min(10).max(80).nullable(),
  calfRightCm: z.number().min(10).max(80).nullable(),
  gripStrengthKg: z.number().min(0).max(100).nullable(),
  gaitSpeed6mSec: z.number().min(1).max(120).nullable(),
});

const v2ProfileSchema = v2MeasurementsSchema.extend({
  education: optionalEnum(EDUCATION_LEVELS),
  maritalStatus: optionalEnum(MARITAL_STATUSES),
  livingSituation: optionalEnum(LIVING_SITUATIONS),
  careSituation: optionalEnum(CARE_SITUATIONS),
});

/** 逗号/顿号/分号/换行分隔的文本 → 字符串数组；空输入 → null（不落库） */
function parseTextList(raw: string | null): string[] | null {
  if (raw === null) return null;
  const items = raw
    .split(/[,，、;；\n]+/)
    .map((item) => item.trim())
    .filter((item) => item !== "");
  return items.length > 0 ? items : null;
}

/**
 * 用药清单简式解析：每行一条"药名,类别[,剂量,频次]"（逗号支持中英文），
 * 类别必须是 西药/中成药/保健品 之一（docx §1 的三分类）。医生表单按同格式提交。
 * 空输入 → null；任一行格式或类别非法 → "invalid"（调用方整体拒绝）。
 */
function parseMedications(raw: string | null): MedicationEntry[] | null | "invalid" {
  if (raw === null) return null;
  const lines = raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length === 0) return null;
  const entries: MedicationEntry[] = [];
  for (const line of lines) {
    const parts = line.split(/[,，]/).map((part) => part.trim());
    const [name, category, dose, frequency, ...extra] = parts;
    if (!name || !category || extra.length > 0) return "invalid";
    if (!(MEDICATION_CATEGORIES as readonly string[]).includes(category)) return "invalid";
    const entry: MedicationEntry = { name, category: category as MedicationCategory };
    if (dose) entry.dose = dose;
    if (frequency) entry.frequency = frequency;
    entries.push(entry);
  }
  return entries;
}

/**
 * 解析医生端完整建档表单的 V2 扩展字段（全部选填；空表单 → 全 null/键缺省，合法）。
 * 任一项非法（枚举外、数值越界、用药行格式错）→ 整体返回 null，调用方回退错误提示，
 * 与 parseMeasurements 同一契约，避免部分字段入库部分丢失。
 */
export function buildV2ProfileExtensions(formData: FormData): V2ProfileExtensions | null {
  const base = v2ProfileSchema.safeParse({
    education: textOrNull(formData, "education"),
    maritalStatus: textOrNull(formData, "maritalStatus"),
    livingSituation: textOrNull(formData, "livingSituation"),
    careSituation: textOrNull(formData, "careSituation"),
    weightHistory: {
      m1: numberOrNull(formData, "weightM1"),
      m2: numberOrNull(formData, "weightM2"),
      m3: numberOrNull(formData, "weightM3"),
      m6: numberOrNull(formData, "weightM6"),
      m12: numberOrNull(formData, "weightM12"),
    },
    calfLeftCm: numberOrNull(formData, "calfLeftCm"),
    calfRightCm: numberOrNull(formData, "calfRightCm"),
    gripStrengthKg: numberOrNull(formData, "gripStrengthKg"),
    gaitSpeed6mSec: numberOrNull(formData, "gaitSpeed6mSec"),
  });
  if (!base.success) return null;
  const medications = parseMedications(textOrNull(formData, "medications"));
  if (medications === "invalid") return null;

  const { weightHistory, ...rest } = base.data;
  const result: V2ProfileExtensions = { ...rest };
  const diagnoses = parseTextList(textOrNull(formData, "diagnoses"));
  if (diagnoses) result.diagnoses = diagnoses;
  const pastHistory = parseTextList(textOrNull(formData, "pastHistory"));
  if (pastHistory) result.pastHistory = pastHistory;
  const recentAcute = parseTextList(textOrNull(formData, "recentAcute"));
  if (recentAcute) result.recentAcute = recentAcute;
  if (medications) result.medications = medications;
  if (Object.values(weightHistory).some((value) => value !== null)) {
    result.weightHistory = weightHistory;
  }
  return result;
}

/** 自助建档可选量表的固定顺序（取自量表库顺序，保证与题库一致，量表增删时自动同步）。 */
export const SELF_SELECTABLE_SCALE_IDS: readonly string[] = scales.map((scale) => scale.id);

/**
 * 从建档表单解析患者勾选的量表（多选 checkbox，name="scaleIds"）。
 * 校验：每项都在量表库内、至少 1 项；去重后按量表库顺序归一化，
 * 使问询与展示顺序稳定，不受勾选先后影响。空选或含未知量表 → null（调用方回退错误提示）。
 * 与 parseMeasurements/patientIdentitySchema 一样是医患两条入口共用的校验，避免逻辑漂移。
 */
export function parseScaleSelection(formData: FormData): string[] | null {
  const selected = new Set(
    formData
      .getAll("scaleIds")
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value !== "")
  );
  if (selected.size === 0) return null;
  for (const id of selected) {
    if (!SELF_SELECTABLE_SCALE_IDS.includes(id)) return null;
  }
  return SELF_SELECTABLE_SCALE_IDS.filter((id) => selected.has(id));
}

/** 生成可读的患者唯一编号，如 P20260714-X3F9。出网调用只允许携带此编号（PII 红线） */
export async function generatePatientCode(): Promise<string> {
  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉易混淆的 I/O/0/1
  for (let attempt = 0; attempt < 5; attempt++) {
    let suffix = "";
    for (let i = 0; i < 4; i++) {
      suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    const code = `P${ymd}-${suffix}`;
    const exists = await prisma.patient.findUnique({ where: { code } });
    if (!exists) return code;
  }
  throw new Error("患者编号生成失败，请重试");
}
