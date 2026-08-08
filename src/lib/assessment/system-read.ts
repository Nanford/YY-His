/**
 * INPUT:  患者档案字段（身高/体重/小腿围/体重史/诊断清单）、会话勾选的量表 id 列表
 * OUTPUT: 「系统读取」条目自动作答结果（标准选项 label + 分值 + 推导依据文本）
 * POS:    M9.5：01 表「条目类型 = 系统读取」的计分条目不再问患者，由档案数据确定性推导。
 *         纯函数、无 IO，供 src/lib/assessment/finalize.ts 在评分前落库 Answer（source=system）。
 *         条目数据取 rules/v2 原生形状（ScaleItemV2.entryType 原文即「系统读取」，不经 V1 投影）。
 *         推导器清单（规则出处均为 01 表条目 + 任务拍板口径，推定处已注明）：
 *           frail_4  现有诊断 ≥5 种 → 是（数据源：diagnoses 单源；01 表复用规则写"诊断清单"，
 *                    pastHistory/recentAcute 不计入——推定，待用户确认后可扩展）
 *           frail_5  体重下降 ≥5% → 是（推定规则：baseline = max(体重史全部有效值, 当前体重)）
 *           mnasf_2  近 3 个月体重下降四档（数据源：weightHistory.m3 与当前 weightKg；
 *                    "不知道"档系统算不出，永不自动产生）
 *           mnasf_6  优先 BMI 四档，BMI 算不出回退小腿围（左右取较细，缺则旧字段 calfCm）
 *           morse_2  当前诊断 >1 个 → 15 分档（M10.3b 新增；数据源 diagnoses 单源，与 frail_4 同口径；
 *                    01 表复用规则「从病历中的当前诊断清单读取；按各量表自己的规则分别计算疾病数」）
 *           glim_1   过去 6 个月内体重下降＞5% → 是（数据源：weightHistory 的 m1/m2/m3/m6 与当前体重，
 *                    取窗口内最大下降百分比；m12 超出「6 个月内」窗口，不计入）
 *           glim_2   超过 6 个月体重下降＞10% → 是（数据源：weightHistory.m12 与当前体重，
 *                    m1~m6 不在「超过 6 个月」口径内）
 *           glim_3   低 BMI 界值（＜70 岁 BMI＜18.5 / ≥70 岁 BMI＜20）→ 符合（BMI 由身高体重算，
 *                    BMI 或年龄缺一则不答）
 *         明确不做的条目：
 *           nrs2002_终筛1（逻辑计算）——定档需「进食量占平时比例」档位（50~75%/25~50%/＜25%），
 *             档案无此数据源、初筛3 仅为是/否粒度，且本纯函数拿不到会话内其他题答案；体重史/BMI
 *             只能给出下限（进食量可再抬档），按评分确定性红线不得按下限定档。唯一可确定性推出的
 *             是重度档（BMI＜18.5 或 m1 下降＞5% 或 m3 下降＞15% 单独即 3 分封顶），但同量表终筛2
 *             仍无推导器、终筛始终阻断，自动答终筛1 解除不了阻断反而留下半截数据，故本期不做，
 *             维持医生代填 / deferClinical 豁免口径。
 *           morse_4（静脉输液）/morse_5（步态）等条目虽也可由档案推出，但口径未经用户逐条拍板，本期不做。
 */

import { scaleV2ById, type ScaleItemOptionV2, type ScaleItemV2 } from "@/lib/rules/v2";

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
  /** 现有诊断清单（字符串数组，JSON 列） */
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

/** 体重史 {m1..m12} → 有效正数体重列表（JSON 列不可信，逐值校验） */
function validWeights(weightHistory: unknown): number[] {
  if (!weightHistory || typeof weightHistory !== "object") return [];
  return Object.values(weightHistory as Record<string, unknown>)
    .map(positiveNumber)
    .filter((n): n is number => n !== null);
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
  // 来源：01 表 frail_4「5 种以上疾病 → 是」；复用规则写"从病历中的当前诊断清单读取"，
  // 按 diagnoses 单源实现（pastHistory/recentAcute 不计入——推定口径，见文件头注释）
  frail_4(patient) {
    const count = diagnosisCount(patient.diagnoses);
    if (count === null) return null;
    const yes = count >= 5;
    return {
      score: yes ? 1 : 0,
      keyword: yes ? "是" : "否",
      rawText: `现有诊断 ${count} 种（≥5 种判定为「是」）`,
    };
  },
  // 来源：01 表 frail_5「体重下降 ≥5% → 是」；推定规则：baseline = max(体重史全部有效值, 当前体重)
  frail_5(patient) {
    const current = positiveNumber(patient.weightKg);
    const history = validWeights(patient.weightHistory);
    if (current === null || history.length === 0) return null;
    const baseline = Math.max(...history, current);
    const lossPct = ((baseline - current) / baseline) * 100;
    const yes = lossPct >= 5;
    return {
      score: yes ? 1 : 0,
      keyword: yes ? "是" : "否",
      rawText: `体重下降 ${round1(lossPct)}%（峰值 ${round1(baseline)}kg → 现在 ${round1(current)}kg，≥5% 判定为「是」）`,
    };
  },
  // 来源：01 表 morse_2「超过 1 个医疗诊断（15分）」；复用规则「从病历中的当前诊断清单读取」，
  // 数据源 diagnoses 单源（与 frail_4 同口径，pastHistory/recentAcute 不计入——推定，见文件头注释）
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
    const windowWeights = ["m1", "m2", "m3", "m6"]
      .map((k) => weightAt(patient.weightHistory, k))
      .filter((n): n is number => n !== null);
    if (windowWeights.length === 0) return null;
    const baseline = Math.max(...windowWeights);
    const lossPct = ((baseline - current) / baseline) * 100;
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
  // 来源：01 表 NRS2002 初筛 1「BMI＜20.5？」；标准 NRS2002 初筛项；选项 score=null，按关键字反查
  "nrs2002_初筛1"(patient) {
    const bmi = bmiOf(patient);
    if (bmi === null) return null;
    const yes = bmi < 20.5;
    return {
      score: Number.NaN,
      keyword: yes ? "是" : "否",
      rawText: `BMI=${round1(bmi)}（＜20.5 判定为初筛「是」）`,
    };
  },
  // 来源：01 表 NRS2002 初筛 2 体重下降史；推定：近 3 月体重下降＞5% 或＞3kg → 是
  "nrs2002_初筛2"(patient) {
    const current = positiveNumber(patient.weightKg);
    const m3 = weightAt(patient.weightHistory, "m3");
    if (current === null || m3 === null) return null;
    const diff = m3 - current;
    const pct = (diff / m3) * 100;
    const yes = diff > 3 || pct > 5;
    return {
      score: Number.NaN,
      keyword: yes ? "是" : "否",
      rawText: `近3月体重变化 ${round1(diff)}kg（${round1(pct)}%）：3月前 ${round1(m3)}kg → 现在 ${round1(current)}kg`,
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
