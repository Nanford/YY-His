/**
 * INPUT:  患者档案字段（身高/体重/小腿围/体重史/诊断清单）、会话勾选的量表 id 列表
 * OUTPUT: 「系统读取」条目自动作答结果 + SYSTEM_READ_COVERAGE 覆盖注册表
 * POS:    纯函数、无 IO；评分前由 finalize.ts 落库 Answer（source=system）。
 *         覆盖注册表直接对应 V2/01 表的「系统读取」「设备/人工测量」条目，
 *         明确区分已实现、需医护/设备和待口径，未拍板的医学规则不进入 DERIVERS。
 *         只有「implemented」条目允许自动作答；其余条目交由医护/设备路径或待口径处理。
 */

import { scaleV2ById, scalesV2, type ScaleItemOptionV2, type ScaleItemV2 } from "@/lib/rules/v2";

/** 推导所需的患者档案字段；结构类型而非 Prisma 类型，便于纯函数测试 */
export interface PatientLike {
  /** 性别（Patient.gender：男/女）；小腿围/握力性别分层阈值需要 */
  gender?: string | null;
  /** 年龄（岁）；NRS2002 终筛年龄加分需要 */
  age?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  /** 小腿围（V1 旧字段，V2 双腿字段缺失时回退） */
  calfCm?: number | null;
  calfLeftCm?: number | null;
  calfRightCm?: number | null;
  gripStrengthKg?: number | null;
  /** 6 米步行用时（秒）；步速 m/s = 6 / 用时 */
  gaitSpeed6mSec?: number | null;
  /** 历史体重 kg：{m1, m2, m3, m6, m12}（JSON 列，运行期逐值校验） */
  weightHistory?: unknown;
  /** 现有诊断清单（字符串数组，JSON 列）；仅用于已有明确疾病数阈值的条目 */
  diagnoses?: unknown;
}

export interface SystemReadAnswer {
  questionId: string;
  optionLabel: string;
  score: number;
  /** 推导依据（全链路可追溯硬约束：标签 → 得分 → 标准答案 → 原始依据逐级下钻） */
  rawText: string;
}

/** 取正数测量值；非法/非正一律视为缺失（0cm 身高、负体重都不是医学数据） */
function positiveNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 体重史指定键（如 m3）→ 有效体重，缺失返回 null */
function weightAt(weightHistory: unknown, key: string): number | null {
  if (!weightHistory || typeof weightHistory !== "object") return null;
  return positiveNumber((weightHistory as Record<string, unknown>)[key]);
}

/** 诊断清单 → 有效诊断数（非字符串项剔除） */
function diagnosisCount(diagnoses: unknown): number | null {
  if (!Array.isArray(diagnoses)) return null;
  return diagnoses.filter((d) => typeof d === "string" && d.trim().length > 0).length;
}

function round1(n: number): string {
  return n.toFixed(1);
}

/**
 * 按分值（+可选关键字）从规则数据反查选项，返回精确 label——不硬编码 label 字符串。
 * 查不到对应分值的选项、或同分多选项且关键字无法唯一命中，均为规则数据异常，宁可抛错。
 * 同分多选项需传关键字唯一命中（如 mnasf_6 的 0 分档有「BMI＜19」与小腿围「＜31 cm」两个选项）。
 */
function pickOption(item: ScaleItemV2, score: number, keyword?: string): ScaleItemOptionV2 {
  if (!item.options) {
    throw new Error(`条目 ${item.id} 无可解析选项（optionsRaw 未解析），系统读取无法反查 label`);
  }
  // score 为哨兵 NaN 时仅按关键字在全选项中反查（测量结论合成选项 score=null）
  if (!Number.isFinite(score) && keyword) {
    const hit = item.options.filter((o) => o.label.includes(keyword));
    if (hit.length === 1) return hit[0];
    if (hit.length === 0) throw new Error(`条目 ${item.id} 无含关键字「${keyword}」的选项`);
    throw new Error(`条目 ${item.id} 按关键字「${keyword}」命中多个选项（规则数据异常）`);
  }
  const scored = item.options.filter((o) => o.score === score);
  if (keyword) {
    const hit = scored.filter((o) => o.label.includes(keyword));
    if (hit.length === 1) return hit[0];
    if (hit.length > 1) {
      throw new Error(`条目 ${item.id} 的 ${score} 分选项按关键字「${keyword}」命中多个（规则数据异常）`);
    }
  }
  if (scored.length === 1) return scored[0];
  if (scored.length === 0) {
    throw new Error(`条目 ${item.id} 无 ${score} 分选项（规则数据异常）`);
  }
  throw new Error(`条目 ${item.id} 的 ${score} 分选项不唯一且未指定可命中的关键字（规则数据异常）`);
}

function finerCalfCm(patient: PatientLike): number | null {
  const legs = [positiveNumber(patient.calfLeftCm), positiveNumber(patient.calfRightCm)].filter(
    (n): n is number => n !== null
  );
  return legs.length > 0 ? Math.min(...legs) : positiveNumber(patient.calfCm);
}

function bmiOf(patient: PatientLike): number | null {
  const height = positiveNumber(patient.heightCm);
  const weight = positiveNumber(patient.weightKg);
  if (height === null || weight === null) return null;
  return weight / (height / 100) ** 2;
}

/** 单条推导结果；null 表示档案数据不足、本条目不产出（交由医生补录或 deferClinical 豁免） */
type Derivation = { score: number; keyword?: string; rawText: string } | null;

/** 各「系统读取」条目的推导器（key = 01 表条目 id） */
const DERIVERS: Record<string, (patient: PatientLike) => Derivation> = {
  // 来源：01 表 morse_2「超过 1 个医疗诊断（15分）」；只读取当前诊断清单，
  // 不把既往史/近期急性病史混入“当前诊断”变量。
  morse_2(patient) {
    const count = diagnosisCount(patient.diagnoses);
    if (count === null) return null;
    const many = count > 1;
    return {
      score: many ? 15 : 0,
      rawText: `现有诊断 ${count} 种（>1 个判定为「超过1个医疗诊断（15分）」档）`,
    };
  },
  // 来源：01 表 mnasf_2 近 3 个月体重下降四档；数据源 weightHistory.m3 与当前体重。
  // 「不知道（1分）」档只有患者自述才知道"不知道"，系统算不出就不答，永不自动产生。
  mnasf_2(patient) {
    const current = positiveNumber(patient.weightKg);
    const m3 = weightAt(patient.weightHistory, "m3");
    if (current === null || m3 === null) return null;
    const diff = m3 - current;
    const rawText = `近3月体重下降 ${round1(diff)}kg（3月前 ${round1(m3)}kg → 现在 ${round1(current)}kg）`;
    if (diff > 3) return { score: 0, keyword: "＞3", rawText };
    if (diff >= 1) return { score: 2, keyword: "1～3", rawText };
    return { score: 3, keyword: "没有下降", rawText };
  },
  // 来源：01 表 mnasf_6「优先按 BMI …无法获得 BMI 时按小腿围」；
  // 小腿围 V2 双腿口径取较细（calfLeftCm/calfRightCm 有效值取小），缺则回退旧字段 calfCm
  mnasf_6(patient) {
    const height = positiveNumber(patient.heightCm);
    const weight = positiveNumber(patient.weightKg);
    if (height !== null && weight !== null) {
      const bmi = weight / (height / 100) ** 2;
      const rawText = `BMI=${round1(bmi)}（身高 ${round1(height)}cm、体重 ${round1(weight)}kg）`;
      if (bmi < 19) return { score: 0, keyword: "BMI＜19", rawText };
      if (bmi < 21) return { score: 1, keyword: "19≤BMI", rawText };
      if (bmi < 23) return { score: 2, keyword: "21≤BMI", rawText };
      return { score: 3, keyword: "BMI≥23", rawText };
    }
    const legs = [positiveNumber(patient.calfLeftCm), positiveNumber(patient.calfRightCm)].filter(
      (n): n is number => n !== null
    );
    const calf = legs.length > 0 ? Math.min(...legs) : positiveNumber(patient.calfCm);
    if (calf === null) return null;
    const source =
      legs.length > 0 ? `双腿取较细 ${round1(calf)}cm` : `小腿围 ${round1(calf)}cm`;
    if (calf < 31) {
      return { score: 0, keyword: "＜31", rawText: `BMI 无法计算，按小腿围：${source}＜31cm` };
    }
    return { score: 3, keyword: "≥31", rawText: `BMI 无法计算，按小腿围：${source}≥31cm` };
  },
  // 来源：01 表 glim_1「是：过去6个月内体重下降＞5%」；选项 score=null，按关键字反查。
  // 数据源：weightHistory 的 m1/m2/m3/m6 与当前体重，取窗口内最大下降百分比；
  // m12 超出「6 个月内」窗口不计入（12 月前的体重无法证明下降发生在近 6 个月内）。
  glim_1(patient) {
    const current = positiveNumber(patient.weightKg);
    if (current === null) return null;
    const windowKeys = ["m1", "m2", "m3", "m6"];
    const windowWeights = windowKeys
      .map((key) => weightAt(patient.weightHistory, key))
      .filter((n): n is number => n !== null);
    if (windowWeights.length === 0) return null;
    const baseline = Math.max(...windowWeights);
    const lossPct = ((baseline - current) / baseline) * 100;
    // 已有任一时间点足以证明阳性；判定阴性则必须确认四个窗口点均有值，避免缺失值制造阴性。
    if (lossPct <= 5 && windowWeights.length !== windowKeys.length) return null;
    const yes = lossPct > 5;
    return {
      score: Number.NaN,
      keyword: yes ? "是" : "否",
      rawText: `过去6个月内最大体重下降 ${round1(lossPct)}%（窗口内峰值 ${round1(baseline)}kg → 现在 ${round1(current)}kg，＞5% 判定为「是」）`,
    };
  },
  // 来源：01 表 glim_2「是：超过6个月的体重下降＞10%」；选项 score=null，按关键字反查。
  // 数据源：weightHistory.m12 与当前体重（体重史中唯一「超过 6 个月」的时点）。
  glim_2(patient) {
    const current = positiveNumber(patient.weightKg);
    const m12 = weightAt(patient.weightHistory, "m12");
    if (current === null || m12 === null) return null;
    const lossPct = ((m12 - current) / m12) * 100;
    const yes = lossPct > 10;
    return {
      score: Number.NaN,
      keyword: yes ? "是" : "否",
      rawText: `超过6个月体重下降 ${round1(lossPct)}%（12月前 ${round1(m12)}kg → 现在 ${round1(current)}kg，＞10% 判定为「是」）`,
    };
  },
  // 来源：01 表 glim_3「符合低BMI界值：＜70岁且BMI＜18.5 kg/m²，或≥70岁且BMI＜20 kg/m²」；
  // 复用当前 BMI（身高体重换算）与年龄，缺一则不答；选项 score=null，按关键字反查
  glim_3(patient) {
    const bmi = bmiOf(patient);
    const age = positiveNumber(patient.age);
    if (bmi === null || age === null) return null;
    const threshold = age >= 70 ? 20 : 18.5;
    const meet = bmi < threshold;
    return {
      score: Number.NaN,
      keyword: meet ? "符合低BMI界值" : "不符合",
      rawText: `年龄 ${age} 岁、BMI=${round1(bmi)}（界值 ${threshold} kg/m²，低于界值判定为「符合」）`,
    };
  },
  // 来源：01 表 NRS2002 终筛 3 年龄加分；≥70 岁加 1 分（选项有分值 0/1）
  "nrs2002_终筛3"(patient) {
    const age = positiveNumber(patient.age);
    if (age === null) return null;
    const senior = age >= 70;
    return {
      score: senior ? 1 : 0,
      keyword: senior ? "≥70" : "＜70",
      rawText: `年龄 ${age} 岁（≥70 加 1 分）`,
    };
  },
  // 来源：02 表小腿围男＜34 / 女＜33 cm；合成选项关键字「阳性/阴性」
  calf_1(patient) {
    const calf = finerCalfCm(patient);
    if (calf === null) return null;
    if (patient.gender !== "男" && patient.gender !== "女") return null;
    const threshold = patient.gender === "男" ? 34 : 33;
    const positive = calf < threshold;
    return {
      score: Number.NaN,
      keyword: positive ? "阳性" : "阴性",
      rawText: `${patient.gender}性小腿围 ${round1(calf)}cm（阈值 ${threshold}cm）`,
    };
  },
  // 来源：02 表握力男＜28 / 女＜18 kg
  grip_1(patient) {
    const grip = positiveNumber(patient.gripStrengthKg);
    if (grip === null) return null;
    if (patient.gender !== "男" && patient.gender !== "女") return null;
    const threshold = patient.gender === "男" ? 28 : 18;
    const low = grip < threshold;
    return {
      score: Number.NaN,
      keyword: low ? "下降" : "正常",
      rawText: `${patient.gender}性握力 ${round1(grip)}kg（阈值 ${threshold}kg）`,
    };
  },
  // 来源：02 表 6 米步速＜1.0 m/s；档案存 6 米用时秒 → 步速 = 6/秒
  gait_speed_1(patient) {
    const sec = positiveNumber(patient.gaitSpeed6mSec);
    if (sec === null) return null;
    const mps = 6 / sec;
    const low = mps < 1.0;
    return {
      score: Number.NaN,
      keyword: low ? "下降" : "正常",
      rawText: `6米用时 ${round1(sec)}秒 → 步速 ${round1(mps)} m/s（阈值 1.0 m/s）`,
    };
  },
};

export type SystemReadCoverageStatus = "implemented" | "needsClinicalOrDevice" | "pendingDefinition";

export interface SystemReadCoverageEntry {
  questionId: string;
  entryType: "系统读取" | "设备/人工测量";
  variableCode: string | null;
  status: SystemReadCoverageStatus;
  /** 来源于 01 表或现有字段边界的原因；不以“尚未写代码”作为分类理由。 */
  reason: string;
}

interface CoverageDefinition {
  questionId: string;
  entryType: "系统读取" | "设备/人工测量";
  variableCode: string;
  status: SystemReadCoverageStatus;
  reason: string;
}

/**
 * V2/01 表「系统读取」「设备/人工测量」条目注册表。
 * 来源：V2/01_评估采集规则表.xlsx；只把现有 Patient 字段和表内明确阈值同时具备的条目标为 implemented。
 */
const COVERAGE_DEFINITIONS: readonly CoverageDefinition[] = [
  {
    questionId: "morse_2",
    entryType: "系统读取",
    variableCode: "DIAGNOSIS_LIST_CURRENT",
    status: "implemented",
    reason: "01 表明确为“超过1个医疗诊断”；现有 diagnoses 为当前诊断清单，按 Morse 自身阈值计分。",
  },
  {
    questionId: "morse_4",
    entryType: "系统读取",
    variableCode: "IV_THERAPY_CURRENT",
    status: "needsClinicalOrDevice",
    reason: "01 表要求护理记录或当前治疗医嘱中的静脉输液/静脉通路；当前 Patient 没有该字段。",
  },
  {
    questionId: "morse_5",
    entryType: "系统读取",
    variableCode: "GAIT_CLINICAL_STATUS",
    status: "needsClinicalOrDevice",
    reason: "01 表要求医护观察、SPPB 或6米步速结果后确认三档步态；现有6米用时没有被授权直接映射到三档 Morse 步态。",
  },
  {
    questionId: "frail_4",
    entryType: "系统读取",
    variableCode: "DIAGNOSIS_LIST_CURRENT",
    status: "pendingDefinition",
    reason: "01 表只给出诊断清单变量和是/否选项，未给出疾病数阈值；不沿用未经本表确认的推定阈值。",
  },
  {
    questionId: "frail_5",
    entryType: "系统读取",
    variableCode: "WEIGHT_HISTORY_1_2_3_6M",
    status: "pendingDefinition",
    reason: "01 表只给出体重史变量和是/否选项，未明确体重下降时间窗、基线选择及阈值。",
  },
  {
    questionId: "nrs2002_初筛1",
    entryType: "系统读取",
    variableCode: "BMI_CURRENT",
    status: "pendingDefinition",
    reason: "01 表未在该条目给出 BMI 阳性界值；不能仅凭常见 NRS2002 口径替代 V2 规则定义。",
  },
  {
    questionId: "nrs2002_初筛2",
    entryType: "系统读取",
    variableCode: "WEIGHT_HISTORY_1_2_3_6M",
    status: "pendingDefinition",
    reason: "01 表未明确体重史判定为“是”的百分比、公斤数和时间窗组合。",
  },
  {
    questionId: "nrs2002_初筛4",
    entryType: "系统读取",
    variableCode: "NRS2002_初筛4",
    status: "pendingDefinition",
    reason: "01 表标为系统/病历读取但没有题干、数据字段或判定定义；任务清单也标记为待拍板。",
  },
  {
    questionId: "nrs2002_终筛3",
    entryType: "系统读取",
    variableCode: "AGE_YEARS",
    status: "implemented",
    reason: "01 表明确年龄＜70/≥70两档；Patient.age 是现有必填字段。",
  },
  {
    questionId: "mnasf_2",
    entryType: "系统读取",
    variableCode: "WEIGHT_HISTORY_1_2_3_6M",
    status: "implemented",
    reason: "01 表明确＞3kg、1～3kg、无下降和不知道四档；当前体重与3个月前体重可确定前三档，不伪造“不知道”。",
  },
  {
    questionId: "mnasf_6",
    entryType: "系统读取",
    variableCode: "BMI_OR_CALF_CIRCUMFERENCE",
    status: "implemented",
    reason: "01 表明确 BMI 四档及 BMI 缺失时小腿围两档；现有身高、体重和双侧/兼容小腿围字段足够。",
  },
  {
    questionId: "glim_1",
    entryType: "系统读取",
    variableCode: "WEIGHT_HISTORY_1_2_3_6M",
    status: "implemented",
    reason: "01 表明确过去6个月体重下降＞5%；使用当前体重与1/2/3/6个月体重，缺少全部对照点时不生成否定结论。",
  },
  {
    questionId: "glim_2",
    entryType: "系统读取",
    variableCode: "WEIGHT_HISTORY_1_2_3_6M",
    status: "implemented",
    reason: "01 表明确超过6个月体重下降＞10%；现有12个月体重史与当前体重可确定该项。",
  },
  {
    questionId: "glim_3",
    entryType: "系统读取",
    variableCode: "BMI_CURRENT_AND_AGE",
    status: "implemented",
    reason: "01 表明确＜70岁 BMI＜18.5、≥70岁 BMI＜20；现有年龄、身高和体重可确定计算。",
  },
  {
    questionId: "glim_4",
    entryType: "系统读取",
    variableCode: "MUSCLE_MASS_INDEX",
    status: "needsClinicalOrDevice",
    reason: "01 表明确要求 DXA/BIA/去脂体质指数结果；当前 Patient 没有肌肉量测量字段，只能等待设备结果或医护录入。",
  },
  {
    questionId: "glim_6",
    entryType: "系统读取",
    variableCode: "GLIM_6",
    status: "pendingDefinition",
    reason: "01 表只列急性疾病/慢性炎症四档，没有现有字段到两类炎症证据的确定性映射。",
  },
  {
    questionId: "calf_1",
    entryType: "设备/人工测量",
    variableCode: "CALF_CIRCUMFERENCE_BILATERAL",
    status: "implemented",
    reason: "01 表明确男＜34、女＜33；现有双侧小腿围/兼容字段可复用已录入测量值。",
  },
  {
    questionId: "grip_1",
    entryType: "设备/人工测量",
    variableCode: "GRIP_1",
    status: "implemented",
    reason: "01 表明确男＜28kg、女＜18kg；现有 gripStrengthKg 是医护录入的测量结果。",
  },
  {
    questionId: "gait_speed_1",
    entryType: "设备/人工测量",
    variableCode: "GAIT6M_1",
    status: "implemented",
    reason: "01 表明确6米用时换算步速并按1.0m/s判定；现有 gaitSpeed6mSec 可确定换算。",
  },
  {
    questionId: "dxa_bia_1",
    entryType: "设备/人工测量",
    variableCode: "MUSCLE_MASS_INDEX",
    status: "needsClinicalOrDevice",
    reason: "01 表要求记录测量方法和肌肉量指数；当前系统没有 DXA/BIA 原始结果或方法字段。",
  },
];

const ITEM_INDEX: ReadonlyMap<string, { item: ScaleItemV2; scaleId: string }> = new Map(
  scalesV2.flatMap((scale) => scale.items.map((item) => [item.id, { item, scaleId: scale.id }] as const))
);

export const SYSTEM_READ_COVERAGE: readonly SystemReadCoverageEntry[] = COVERAGE_DEFINITIONS.map((definition) => ({
  questionId: definition.questionId,
  entryType: definition.entryType,
  variableCode: ITEM_INDEX.get(definition.questionId)?.item.variableCode ?? null,
  status: definition.status,
  reason: definition.reason,
}));

export interface SystemReadCoverageValidation {
  ok: boolean;
  expectedQuestionIds: string[];
  registeredQuestionIds: string[];
  missing: string[];
  extra: string[];
  invalidEntryTypes: string[];
  variableMismatches: string[];
  implementedWithoutDeriver: string[];
}

/** 对照运行时 V2 规则做覆盖校验，阻止新增系统/测量条目悄悄落入“未实现”。 */
export function validateSystemReadCoverage(): SystemReadCoverageValidation {
  const expected = scalesV2.flatMap((scale) =>
    scale.items
      .filter((item) => item.entryType === "系统读取" || item.entryType === "设备/人工测量")
      .map((item) => item.id)
  );
  const registered = COVERAGE_DEFINITIONS.map((definition) => definition.questionId);
  const expectedSet = new Set(expected);
  const registeredSet = new Set(registered);
  const missing = expected.filter((id) => !registeredSet.has(id));
  const extra = registered.filter((id) => !expectedSet.has(id));
  const invalidEntryTypes: string[] = [];
  const variableMismatches: string[] = [];
  for (const definition of COVERAGE_DEFINITIONS) {
    const hit = ITEM_INDEX.get(definition.questionId);
    if (!hit) {
      invalidEntryTypes.push(`${definition.questionId}:规则条目不存在`);
      continue;
    }
    if (hit.item.entryType !== definition.entryType) {
      invalidEntryTypes.push(`${definition.questionId}:${hit.item.entryType}≠${definition.entryType}`);
    }
    if (hit.item.variableCode !== definition.variableCode) {
      variableMismatches.push(`${definition.questionId}:${hit.item.variableCode}≠${definition.variableCode}`);
    }
  }
  const implementedWithoutDeriver = COVERAGE_DEFINITIONS
    .filter((definition) => definition.status === "implemented" && !DERIVERS[definition.questionId])
    .map((definition) => definition.questionId);
  return {
    ok:
      missing.length === 0 &&
      extra.length === 0 &&
      invalidEntryTypes.length === 0 &&
      variableMismatches.length === 0 &&
      implementedWithoutDeriver.length === 0,
    expectedQuestionIds: expected,
    registeredQuestionIds: registered,
    missing,
    extra,
    invalidEntryTypes,
    variableMismatches,
    implementedWithoutDeriver,
  };
}

const SYSTEM_READ_COVERAGE_BY_ID = new Map(SYSTEM_READ_COVERAGE.map((entry) => [entry.questionId, entry]));

/** 允许系统推导的条目类型：系统读取 + 可由档案直接换算的设备测量项 */
const SYSTEM_DERIVABLE_ENTRY_TYPES: ReadonlySet<string> = new Set(["系统读取", "设备/人工测量"]);

/**
 * 推导指定量表集合内全部可由档案数据直接推出的「系统读取/测量」条目答案。
 * - 只处理已有推导器的计分条目；逻辑计算类（mnasf_3/mnasf_5/nrs2002_终筛1 等）需跨题综合或缺
 *   数据源，不在本函数覆盖（终筛1 不做推导的具体理由见文件头注释）。
 * - 档案数据不足推不出的条目不产出（严格路径仍会阻断评分，由医生补档案或代填）。
 * - existing：已有 confirmed 人工答案的题目 id 集合，命中即跳过（系统读取不覆盖人工答案）。
 */
export function resolveSystemReadAnswers(
  patient: PatientLike,
  scaleIds: readonly string[],
  opts?: { existing?: ReadonlySet<string> }
): SystemReadAnswer[] {
  const out: SystemReadAnswer[] = [];
  for (const scaleId of scaleIds) {
    const scale = scaleV2ById.get(scaleId);
    if (!scale) continue;
    for (const item of scale.items) {
      if (!SYSTEM_DERIVABLE_ENTRY_TYPES.has(item.entryType)) continue;
      if (opts?.existing?.has(item.id)) continue;
      // 覆盖注册表是“是否允许自动推导”的唯一闸门；需医护/设备或待口径条目不得因存在同名代码而误答。
      if (SYSTEM_READ_COVERAGE_BY_ID.get(item.id)?.status !== "implemented") continue;
      const derive = DERIVERS[item.id];
      if (!derive) continue;
      const derived = derive(patient);
      if (!derived) continue;
      const option = pickOption(item, derived.score, derived.keyword);
      out.push({
        questionId: item.id,
        optionLabel: option.label,
        // 无分合成选项（测量结论）落库 score 用 0/1 哨兵：阳性/符合类关键字→1，否则 0
        // （^符合 锚定开头，避免 glim_3 否定关键字「不符合」误判为 1）
        score:
          option.score ??
          (derived.keyword && /阳性|下降|是|^符合/.test(derived.keyword) ? 1 : 0),
        rawText: derived.rawText,
      });
    }
  }
  return out;
}
