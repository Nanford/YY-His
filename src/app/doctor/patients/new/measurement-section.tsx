/**
 * INPUT:  无（表单字段直接提交）
 * OUTPUT: 医生建档页"人体测量与客观指标"区块（客户端组件，用于 BMI 实时计算）
 * POS:    Demo_v2更新说明 §1：身高/体重/腹围/小腿围/BMI（自动计算）/体重史/握力/步速；
 *         DXA/BIA、握力计传感器、自动动作测试暂不接入，仅作占位提示。
 */
"use client";

import { useMemo, useState } from "react";
import { IconRulerMeasure } from "@tabler/icons-react";

const inputCls = "ui-input";

function Field({
  label,
  name,
  required,
  type = "text",
  placeholder,
  unit,
  readOnly,
}: {
  label: string;
  name: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
  unit?: string;
  readOnly?: boolean;
}) {
  return (
    <label className="ui-field">
      <span className="ui-label">
        {label}
        {required && <span className="ui-required">*</span>}
        {unit && <span className="ml-1 font-normal text-[#8ba0bd]">（{unit}）</span>}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className={inputCls}
        step="any"
        readOnly={readOnly}
      />
    </label>
  );
}

function formatBmi(heightCm: string, weightKg: string): string {
  const h = parseFloat(heightCm);
  const w = parseFloat(weightKg);
  if (!h || !w || h <= 0 || w <= 0) return "—";
  const bmi = w / (h / 100) ** 2;
  return bmi.toFixed(1);
}

export default function MeasurementSection() {
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const bmiText = useMemo(() => formatBmi(heightCm, weightKg), [heightCm, weightKg]);

  return (
    <section className="border-t border-[#dbe7f6] bg-[#f8fbff]">
      <div className="ui-panel-heading bg-transparent">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-blue-600 shadow-[0_4px_12px_rgba(33,87,160,0.07)]">
            <IconRulerMeasure size={21} stroke={1.9} aria-hidden="true" />
          </span>
          <div>
            <h2 className="ui-panel-title">三、人体测量与客观指标</h2>
            <p className="mt-1 text-xs text-[#62779a]">
              身高、体重（现在及 1/2/3/6/12 月前）可填，BMI 由系统自动计算；小腿围、握力、步速可现场测量后填入；DXA/BIA、握力计传感器、自动动作测试暂不接入
            </p>
          </div>
        </div>
        <span className="ui-badge">测量指标</span>
      </div>
      <div className="ui-panel-body space-y-5">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <label className="ui-field">
            <span className="ui-label">身高（cm）</span>
            <input
              name="heightCm"
              type="number"
              className={inputCls}
              step="any"
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
              placeholder="例如 165"
            />
          </label>
          <label className="ui-field">
            <span className="ui-label">体重（现在）（kg）</span>
            <input
              name="weightKg"
              type="number"
              className={inputCls}
              step="any"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              placeholder="例如 60"
            />
          </label>
          <Field label="腹围" name="waistCm" type="number" unit="cm" />
          <Field label="小腿围（兼容旧字段）" name="calfCm" type="number" unit="cm" />
        </div>
        <div className="rounded-xl border border-[#dbe7f6] bg-white px-4 py-3">
          <span className="text-sm font-bold text-[#29496f]">BMI（自动计算）：</span>
          <span className="ml-2 text-lg font-extrabold text-blue-600">{bmiText}</span>
          <span className="ml-2 text-xs text-[#7f94b3]">kg/m²</span>
        </div>
        <div>
          <p className="ui-label mb-2">历史体重（kg）</p>
          <div className="grid gap-5 sm:grid-cols-3 lg:grid-cols-5">
            <Field label="1 月前" name="weightM1" type="number" unit="kg" />
            <Field label="2 月前" name="weightM2" type="number" unit="kg" />
            <Field label="3 月前" name="weightM3" type="number" unit="kg" />
            <Field label="6 月前" name="weightM6" type="number" unit="kg" />
            <Field label="12 月前" name="weightM12" type="number" unit="kg" />
          </div>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="小腿围-左" name="calfLeftCm" type="number" unit="cm" />
          <Field label="小腿围-右" name="calfRightCm" type="number" unit="cm" />
          <Field label="握力（握力计传感器暂不接入，测试后手工填入）" name="gripStrengthKg" type="number" unit="kg" />
          <Field label="6 米步行用时" name="gaitSpeed6mSec" type="number" unit="秒" />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="rounded-xl border border-dashed border-[#c8d8ec] bg-[#f8fbff] px-4 py-3">
            <p className="text-sm font-bold text-[#62779a]">身体成分分析（DXA 或 BIA）</p>
            <p className="mt-1 text-xs text-[#7f94b3]">暂不接入；接入后由设备自动读取肌肉量与体脂数据</p>
          </div>
          <div className="rounded-xl border border-dashed border-[#c8d8ec] bg-[#f8fbff] px-4 py-3">
            <p className="text-sm font-bold text-[#62779a]">自动动作测试（SPPB / 洼田饮水 / 耳语试验等）</p>
            <p className="mt-1 text-xs text-[#7f94b3]">暂不接入；评估时由医护现场操作后代填</p>
          </div>
        </div>
      </div>
    </section>
  );
}
