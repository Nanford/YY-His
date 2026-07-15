/**
 * INPUT:  患者建档表单字段（FormData）、Prisma（患者编号唯一性校验）
 * OUTPUT: patientIdentitySchema / measurementsSchema / parseMeasurements /
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
