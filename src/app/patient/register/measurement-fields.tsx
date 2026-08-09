/**
 * INPUT:  无（表单字段直接提交，name 与 buildV2ProfileExtensions/parseMeasurements 对齐）
 * OUTPUT: 患者自助建档页「人体测量与客观指标」区块（客户端组件，用于 BMI 实时计算）
 * POS:    基础信息填写口径（2026-08-08 用户拍板扩展到患者端）：身高/体重（现在及 1/2/3/6/12 月前）/
 *         BMI（自动计算）/腹围/小腿围（双腿）/握力（传感器暂不接入，测试后填入）/6 米步行；
 *         DXA/BIA 身体成分暂不接入，仅占位提示。全部选填，字段与医生端同一校验（patient-intake.ts）。
 */
"use client";

import { useMemo, useState } from "react";

const inputCls = "patient-input w-full";

function Field({
  label,
  name,
  placeholder,
  unit,
  hint,
}: {
  label: string;
  name: string;
  placeholder?: string;
  unit?: string;
  hint?: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-base font-bold text-[#405a81]">
        {label}
        {unit && <span className="ml-1 font-normal text-[#8ba0bd]">（{unit}）</span>}
      </span>
      <input name={name} type="number" step="any" placeholder={placeholder ?? "选填"} className={inputCls} />
      {hint && <span className="block text-sm leading-6 text-[#7f94b3]">{hint}</span>}
    </label>
  );
}

function formatBmi(heightCm: string, weightKg: string): string {
  const h = parseFloat(heightCm);
  const w = parseFloat(weightKg);
  if (!h || !w || h <= 0 || w <= 0) return "—";
  return (w / (h / 100) ** 2).toFixed(1);
}

export default function PatientMeasurementFields() {
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const bmiText = useMemo(() => formatBmi(heightCm, weightKg), [heightCm, weightKg]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block space-y-2">
          <span className="text-base font-bold text-[#405a81]">身高（cm）</span>
          <input
            name="heightCm"
            type="number"
            step="any"
            placeholder="选填，例如 165"
            className={inputCls}
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
          />
        </label>
        <label className="block space-y-2">
          <span className="text-base font-bold text-[#405a81]">体重（现在）（kg）</span>
          <input
            name="weightKg"
            type="number"
            step="any"
            placeholder="选填，例如 60"
            className={inputCls}
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
          />
        </label>
        <Field label="腹围" name="waistCm" unit="cm" />
        <div className="flex items-end rounded-2xl border border-blue-100 bg-white px-4 py-3">
          <span className="text-base font-bold text-[#405a81]">BMI（自动计算）：</span>
          <span className="ml-2 text-xl font-extrabold text-blue-600">{bmiText}</span>
          <span className="ml-2 text-sm text-[#7f94b3]">kg/m²</span>
        </div>
      </div>

      <div>
        <p className="text-base font-bold text-[#405a81]">历史体重（kg，记不清可留空）</p>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Field label="1 月前" name="weightM1" unit="kg" />
          <Field label="2 月前" name="weightM2" unit="kg" />
          <Field label="3 月前" name="weightM3" unit="kg" />
          <Field label="6 月前" name="weightM6" unit="kg" />
          <Field label="12 月前" name="weightM12" unit="kg" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="小腿围（左）" name="calfLeftCm" unit="cm" />
        <Field label="小腿围（右）" name="calfRightCm" unit="cm" />
        <Field
          label="握力"
          name="gripStrengthKg"
          unit="kg"
          hint="用握力计测后填入读数"
        />
        <Field label="6 米步行用时" name="gaitSpeed6mSec" unit="秒" hint="在医护看护下测走后填入" />
      </div>

      <div className="rounded-2xl border border-dashed border-[#c8d8ec] bg-white px-4 py-3">
        <p className="text-base font-bold text-[#62779a]">身体成分分析（DXA 或 BIA）</p>
        <p className="mt-1 text-sm leading-6 text-[#7f94b3]">暂不接入；接入后由设备自动读取肌肉量与体脂数据</p>
      </div>
    </div>
  );
}
