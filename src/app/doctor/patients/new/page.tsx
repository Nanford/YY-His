/**
 * INPUT:  医生填写的患者基础信息表单
 * OUTPUT: 新建患者页（提交至 createPatient Server Action）
 * POS:    需求文档"第一步：基础信息录入"。姓名/性别/年龄必填；
 *         测量数据（身高/体重/腹围/小腿围）供 MNA-SF F 题与体质题 9/28 换算分值。
 */
import { createPatient } from "@/lib/actions/doctor";

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

function Field({
  label,
  name,
  required,
  type = "text",
  placeholder,
  unit,
}: {
  label: string;
  name: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
  unit?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-slate-600">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
        {unit && <span className="text-slate-400 ml-1">（{unit}）</span>}
      </span>
      <input name={name} type={type} required={required} placeholder={placeholder} className={inputCls} step="any" />
    </label>
  );
}

export default async function NewPatientPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">新建患者</h1>

      {error === "required" && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
          请完整填写必填项：姓名、性别、年龄（年龄需为 1～130 的整数）。
        </div>
      )}

      <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 text-sm">
        ⚠️ 以下信息为医疗敏感信息，仅保存在本地数据库。系统调用云端 AI 时将使用患者唯一编号替代全部身份信息。
      </div>

      <form action={createPatient} className="rounded-xl border border-slate-200 bg-white p-6 space-y-6">
        <div>
          <h2 className="font-semibold mb-3">基本信息</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="姓名" name="name" required placeholder="张三" />
            <label className="block space-y-1">
              <span className="text-sm text-slate-600">
                性别<span className="text-red-500 ml-0.5">*</span>
              </span>
              <select name="gender" required className={inputCls} defaultValue="">
                <option value="" disabled>
                  请选择
                </option>
                <option value="男">男</option>
                <option value="女">女</option>
              </select>
            </label>
            <Field label="年龄" name="age" required type="number" placeholder="75" />
            <Field label="手机号" name="phone" placeholder="选填" />
            <Field label="身份证号" name="idCard" placeholder="选填" />
            <Field label="住址" name="address" placeholder="选填" />
            <Field label="住院号" name="admissionNo" placeholder="选填" />
            <Field label="门诊号" name="outpatientNo" placeholder="选填" />
          </div>
        </div>

        <div>
          <h2 className="font-semibold mb-1">测量数据（建议现场测量）</h2>
          <p className="text-xs text-slate-500 mb-3">
            用于营养评估 BMI 计分与中医体质第 9/28 题换算；缺失时相关题目需医生补录。
          </p>
          <div className="grid sm:grid-cols-4 gap-4">
            <Field label="身高" name="heightCm" type="number" unit="cm" />
            <Field label="体重" name="weightKg" type="number" unit="kg" />
            <Field label="腹围" name="waistCm" type="number" unit="cm" />
            <Field label="小腿围" name="calfCm" type="number" unit="cm" />
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="submit"
            className="rounded-lg bg-blue-600 text-white px-6 py-2 text-sm font-medium hover:bg-blue-700"
          >
            创建患者档案
          </button>
        </div>
      </form>
    </div>
  );
}
