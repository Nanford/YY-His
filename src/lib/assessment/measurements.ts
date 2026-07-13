/**
 * INPUT:  患者身高、体重、腹围、小腿围，以及本次会话勾选的量表 ID
 * OUTPUT: MNA-SF F/F替代、中医体质第 9/28 题的确定性标准答案或人工补录状态
 * POS:    M2 测量题纯逻辑层；不访问数据库和网络，供医生代填与重算流程复用。
 */

export interface PatientMeasurements {
  heightCm: number | null;
  weightKg: number | null;
  waistCm: number | null;
  calfCm: number | null;
}

export type MeasurementQuestionId = "mnasf_F" | "mnasf_F_alt" | "tcm_9" | "tcm_28";
export type MeasurementAnswerStatus = "confirmed" | "manual" | "superseded";

export interface MeasurementAnswerResolution {
  questionId: MeasurementQuestionId;
  status: MeasurementAnswerStatus;
  score: number | null;
  optionLabel: string | null;
  rawText: string | null;
  reason: string;
}

function isPositiveFinite(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** BMI 使用未舍入的实测值判档，避免展示精度反向影响医学边界。 */
export function calculateBmi(measurements: Pick<PatientMeasurements, "heightCm" | "weightKg">): number | null {
  if (!isPositiveFinite(measurements.heightCm) || !isPositiveFinite(measurements.weightKg)) return null;
  return (measurements.weightKg * 10_000) / measurements.heightCm ** 2;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function bmiRawText(patient: PatientMeasurements, bmi: number): string {
  return `身高 ${patient.heightCm} cm；体重 ${patient.weightKg} kg；BMI ${formatNumber(bmi)}`;
}

function confirmed(
  questionId: MeasurementQuestionId,
  score: number,
  optionLabel: string,
  rawText: string,
  reason: string
): MeasurementAnswerResolution {
  return { questionId, status: "confirmed", score, optionLabel, rawText, reason };
}

function unresolved(
  questionId: MeasurementQuestionId,
  status: Exclude<MeasurementAnswerStatus, "confirmed">,
  rawText: string | null,
  reason: string
): MeasurementAnswerResolution {
  return { questionId, status, score: null, optionLabel: null, rawText, reason };
}

function resolveMnasfByBmi(patient: PatientMeasurements, bmi: number): MeasurementAnswerResolution {
  // 来源：量表题目_Demo.txt 二、MNA-SF 营养评估 F 题；与 data/scales.json 的选项边界一致。
  if (bmi < 19) return confirmed("mnasf_F", 0, "BMI＜19", bmiRawText(patient, bmi), "依据身高、体重自动换算");
  if (bmi < 21) return confirmed("mnasf_F", 1, "19≤BMI＜21", bmiRawText(patient, bmi), "依据身高、体重自动换算");
  if (bmi < 23) return confirmed("mnasf_F", 2, "21≤BMI＜23", bmiRawText(patient, bmi), "依据身高、体重自动换算");
  return confirmed("mnasf_F", 3, "BMI≥23", bmiRawText(patient, bmi), "依据身高、体重自动换算");
}

function resolveMnasfByCalf(calfCm: number): MeasurementAnswerResolution {
  const rawText = `小腿围 ${calfCm} cm`;
  // 来源：量表题目_Demo.txt 二、MNA-SF 营养评估 F替代；CC＜31 cm=0，CC≥31 cm=3。
  return calfCm < 31
    ? confirmed("mnasf_F_alt", 0, "CC＜31 cm", rawText, "无法获得 BMI，依据小腿围自动换算")
    : confirmed("mnasf_F_alt", 3, "CC≥31 cm", rawText, "无法获得 BMI，依据小腿围自动换算");
}

function resolveTcmBmi(patient: PatientMeasurements, bmi: number): MeasurementAnswerResolution {
  const rawText = bmiRawText(patient, bmi);
  // 来源：量表题目_Demo.txt 四、中医体质辨识第 9 题；与 data/scales.json 的五档边界一致。
  if (bmi < 24) return confirmed("tcm_9", 1, "BMI＜24", rawText, "依据身高、体重自动换算");
  if (bmi < 25) return confirmed("tcm_9", 2, "24≤BMI＜25", rawText, "依据身高、体重自动换算");
  if (bmi < 26) return confirmed("tcm_9", 3, "25≤BMI＜26", rawText, "依据身高、体重自动换算");
  if (bmi < 28) return confirmed("tcm_9", 4, "26≤BMI＜28", rawText, "依据身高、体重自动换算");
  return confirmed("tcm_9", 5, "BMI≥28", rawText, "依据身高、体重自动换算");
}

function resolveTcmWaist(waistCm: number): MeasurementAnswerResolution {
  const rawText = `腹围 ${waistCm} cm`;
  // 来源：量表题目_Demo.txt 四、中医体质辨识第 28 题；量表按整数厘米分档，连续测量值按下一整数档起点判定。
  if (waistCm < 80) return confirmed("tcm_28", 1, "腹围＜80 cm", rawText, "依据腹围自动换算");
  if (waistCm < 86) return confirmed("tcm_28", 2, "腹围80～85 cm", rawText, "依据腹围自动换算");
  if (waistCm < 91) return confirmed("tcm_28", 3, "腹围86～90 cm", rawText, "依据腹围自动换算");
  if (waistCm <= 105) return confirmed("tcm_28", 4, "腹围91～105 cm", rawText, "依据腹围自动换算");
  return confirmed("tcm_28", 5, "腹围＞105 cm", rawText, "依据腹围自动换算");
}

/**
 * 按所选量表生成测量题答案。MNA-SF 必须在 F 与 F替代之间二选一：BMI 可用时始终优先 F。
 */
export function resolveMeasurementAnswers(
  patient: PatientMeasurements,
  selectedScaleIds: readonly string[]
): MeasurementAnswerResolution[] {
  const selected = new Set(selectedScaleIds);
  const answers: MeasurementAnswerResolution[] = [];
  const bmi = calculateBmi(patient);

  if (selected.has("mnasf")) {
    const calfCm = isPositiveFinite(patient.calfCm) ? patient.calfCm : null;
    if (bmi !== null) {
      answers.push(resolveMnasfByBmi(patient, bmi));
      answers.push(
        unresolved(
          "mnasf_F_alt",
          "superseded",
          calfCm === null ? null : `小腿围 ${calfCm} cm`,
          "BMI 可用，按规则优先使用 F 题，F替代不参与计分"
        )
      );
    } else if (calfCm !== null) {
      answers.push(unresolved("mnasf_F", "superseded", null, "BMI 不可计算，按规则改用 F替代"));
      answers.push(resolveMnasfByCalf(calfCm));
    } else {
      answers.push(unresolved("mnasf_F", "manual", null, "缺少有效的身高或体重，无法计算 BMI，待医生补录"));
      answers.push(unresolved("mnasf_F_alt", "manual", null, "BMI 不可计算且缺少有效的小腿围，待医生补录"));
    }
  }

  if (selected.has("tcm")) {
    answers.push(
      bmi === null
        ? unresolved("tcm_9", "manual", null, "缺少有效的身高或体重，无法计算 BMI，待医生补录")
        : resolveTcmBmi(patient, bmi)
    );
    answers.push(
      isPositiveFinite(patient.waistCm)
        ? resolveTcmWaist(patient.waistCm)
        : unresolved("tcm_28", "manual", null, "缺少有效的腹围，待医生补录")
    );
  }

  return answers;
}
