/**
 * INPUT:  患者档案字段（Patient 的身份/测量/疾病用药/照护列，Json 列按 unknown 读入）、
 *         多重用药评估量表的标签名（报告快照）
 * OUTPUT: maskPatientName —— 报告页姓名脱敏；buildIdentityItems —— 报告身份条；
 *         buildBasicInfoRows —— 报告「基本情况」区块各行
 * POS:    患者报告版式（2026-11-10 用户拍板，参考「报告输出的样式.png」）的档案侧派生口径收口，
 *         纯函数、不读库、不出网。只做展示整理，不参与评分与判定（硬约束 2）。
 *         本版不含「综合评分」与「吸烟饮酒史」：前者无医学计分规则、后者档案无此字段（均为用户拍板暂缓）。
 */

/** 档案缺失项的统一占位 */
const EMPTY_VALUE = "—";
/** 「基本情况」某行档案未填时的统一文案 */
const NOT_FILLED = "未填写";

/** 报告身份条/基本情况的一行（label 固定文案，value 已整理为可直接展示的文本） */
export interface ReportField {
  label: string;
  value: string;
}

/** 身份条所需的档案字段 */
export interface ReportIdentitySource {
  code: string;
  name: string;
  gender: string;
  age: number;
  heightCm: number | null;
  weightKg: number | null;
}

/** 「基本情况」所需的档案字段（Json 列保持 unknown，由本模块做形状守卫） */
export interface ReportProfileSource {
  diagnoses: unknown;
  pastHistory: unknown;
  recentAcute: unknown;
  medications: unknown;
  careSituation: string | null;
  livingSituation: string | null;
}

/**
 * 报告页姓名脱敏：只保留首字 + 称谓（女 → 女士、男 → 先生），如「张女士」。
 * 复姓按首字处理（Demo 口径，不做复姓词表）；性别非男/女时以「**」遮蔽。
 */
export function maskPatientName(name: string, gender: string): string {
  const firstChar = [...name.trim()][0];
  if (!firstChar) return EMPTY_VALUE;
  if (gender === "女") return `${firstChar}女士`;
  if (gender === "男") return `${firstChar}先生`;
  return `${firstChar}**`;
}

/** 去掉小数点后多余的 0（158.50 → 158.5、43 → 43） */
function formatMeasure(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return EMPTY_VALUE;
  return `${Number(value.toFixed(1))}${unit}`;
}

/** 报告身份条：编号 / 姓名（脱敏）/ 性别 / 年龄 / 身高 / 体重 / 测试时间 */
export function buildIdentityItems(source: ReportIdentitySource, assessedAtText: string): ReportField[] {
  return [
    { label: "编号", value: source.code },
    { label: "姓名", value: maskPatientName(source.name, source.gender) },
    { label: "性别", value: source.gender || EMPTY_VALUE },
    { label: "年龄", value: `${source.age}岁` },
    { label: "身高", value: formatMeasure(source.heightCm, "cm") },
    { label: "体重", value: formatMeasure(source.weightKg, "kg") },
    { label: "测试时间", value: assessedAtText },
  ];
}

/** Json 列 → 非空字符串数组（形状不符的元素丢弃，不抛错） */
function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** 当前用药 Json 列 → 药品名数组（元素形状 {name, ...}，见 patient-intake.ts 的 MedicationEntry） */
function toMedicationNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const name = (entry as { name?: unknown }).name;
    if (typeof name === "string" && name.trim().length > 0) names.push(name.trim());
  }
  return names;
}

/** 病史记录：现有诊断 + 既往病史 + 近期急性疾病，去重后顿号连接 */
function medicalHistoryText(source: ReportProfileSource): string {
  const merged = [
    ...toStringList(source.diagnoses),
    ...toStringList(source.pastHistory),
    ...toStringList(source.recentAcute),
  ];
  const unique = [...new Set(merged)];
  return unique.length > 0 ? unique.join("、") : NOT_FILLED;
}

/** 用药评估：多重用药量表结论在前（有则展示），档案用药清单在后 */
function medicationText(source: ReportProfileSource, medicationTagNames: readonly string[]): string {
  const parts: string[] = [];
  if (medicationTagNames.length > 0) parts.push(medicationTagNames.join("；"));
  const names = toMedicationNames(source.medications);
  if (names.length > 0) parts.push(`当前用药 ${names.length} 种：${names.join("、")}`);
  return parts.length > 0 ? parts.join("；") : NOT_FILLED;
}

/** 家庭照护者：照护情况为主，居住情况括注（参考图「子女，保姆（居住类型：子女同住）」） */
function caregiverText(source: ReportProfileSource): string {
  const care = source.careSituation?.trim();
  const living = source.livingSituation?.trim();
  if (care && living) return `${care}（居住类型：${living}）`;
  if (care) return care;
  if (living) return `居住类型：${living}`;
  return NOT_FILLED;
}

/**
 * 报告「基本情况」各行：病史记录 / 用药评估 / 家庭照护者。
 * @param medicationTagNames 本次报告中多重用药评估量表产出的标签名（无则传 []）
 */
export function buildBasicInfoRows(
  source: ReportProfileSource,
  medicationTagNames: readonly string[]
): ReportField[] {
  return [
    { label: "病史记录", value: medicalHistoryText(source) },
    { label: "用药评估", value: medicationText(source, medicationTagNames) },
    { label: "家庭照护者", value: caregiverText(source) },
  ];
}
