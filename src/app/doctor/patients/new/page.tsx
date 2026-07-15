/**
 * INPUT:  医生填写的患者基础信息表单
 * OUTPUT: 新建患者页（提交至 createPatient Server Action）
 * POS:    需求文档“第一步：基础信息录入”。姓名/性别/年龄必填；
 *         测量数据（身高/体重/腹围/小腿围）供 MNA-SF F 题与体质题 9/28 换算分值。
 */
import Link from "next/link";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconLock,
  IconRulerMeasure,
  IconUserPlus,
} from "@tabler/icons-react";
import { createPatient } from "@/lib/actions/doctor";
import { firstQueryValue } from "@/lib/query";

const inputCls = "ui-input";

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
    <label className="ui-field">
      <span className="ui-label">
        {label}
        {required && <span className="ui-required">*</span>}
        {unit && <span className="ml-1 font-normal text-[#8ba0bd]">（{unit}）</span>}
      </span>
      <input name={name} type={type} required={required} placeholder={placeholder} className={inputCls} step="any" />
    </label>
  );
}

export default async function NewPatientPage({ searchParams }: PageProps<"/doctor/patients/new">) {
  const error = firstQueryValue((await searchParams).error);

  return (
    <div className="app-page-narrow space-y-6">
      <div className="page-heading">
        <div className="page-heading-copy">
          <p className="page-eyebrow">PATIENT INTAKE</p>
          <h1 className="page-title">新建患者</h1>
          <p className="page-description">完成基础档案录入后，可立即为患者发起标准化健康评估。</p>
        </div>
        <Link href="/doctor" className="ui-button ui-button-quiet">
          <IconArrowLeft size={18} stroke={2} aria-hidden="true" />
          返回患者管理
        </Link>
      </div>

      {error === "required" && (
        <div className="ui-alert ui-alert-danger" role="alert">
          <IconAlertCircle className="mt-0.5 shrink-0" size={18} stroke={2} aria-hidden="true" />
          <span>请完整填写必填项：姓名、性别、年龄（年龄需为 1～130 的整数）。</span>
        </div>
      )}
      {error === "measurements" && (
        <div className="ui-alert ui-alert-danger" role="alert">
          <IconAlertCircle className="mt-0.5 shrink-0" size={18} stroke={2} aria-hidden="true" />
          <span>测量数据格式不正确，请填写合理的正数，或留空后稍后补录。</span>
        </div>
      )}

      <div className="ui-alert" role="note">
        <IconLock className="mt-0.5 shrink-0" size={18} stroke={2} aria-hidden="true" />
        <span>以下信息为医疗敏感信息，仅保存在本地数据库。系统调用云端 AI 时将使用患者唯一编号替代全部身份信息。</span>
      </div>

      <form action={createPatient} className="ui-panel overflow-hidden">
        <section>
          <div className="ui-panel-heading">
            <div>
              <h2 className="ui-panel-title">基础信息</h2>
              <p className="mt-1 text-xs text-[#62779a]">带 <span className="text-[#c23b4a]">*</span> 的字段为必填项</p>
            </div>
            <span className="ui-badge">患者档案</span>
          </div>
          <div className="ui-panel-body grid gap-5 sm:grid-cols-2">
            <Field label="姓名" name="name" required placeholder="张三" />
            <label className="ui-field">
              <span className="ui-label">
                性别<span className="ui-required">*</span>
              </span>
              <select name="gender" required className="ui-select" defaultValue="">
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
        </section>

        <section className="border-t border-[#dbe7f6] bg-[#f8fbff]">
          <div className="ui-panel-body">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-blue-600 shadow-[0_4px_12px_rgba(33,87,160,0.07)]">
                <IconRulerMeasure size={21} stroke={1.9} aria-hidden="true" />
              </span>
              <div>
                <h2 className="ui-panel-title">测量数据（建议现场测量）</h2>
                <p className="ui-helper mt-1">用于营养评估 BMI 计分与中医体质第 9/28 题换算；缺失时相关题目需医生补录。</p>
              </div>
            </div>
            <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="身高" name="heightCm" type="number" unit="cm" />
              <Field label="体重" name="weightKg" type="number" unit="kg" />
              <Field label="腹围" name="waistCm" type="number" unit="cm" />
              <Field label="小腿围" name="calfCm" type="number" unit="cm" />
            </div>
          </div>
        </section>

        <div className="flex justify-end border-t border-[#dbe7f6] px-[22px] py-4">
          <button type="submit" className="ui-button ui-button-primary ui-button-lg">
            <IconUserPlus size={19} stroke={2.1} aria-hidden="true" />
            创建患者档案
          </button>
        </div>
      </form>
    </div>
  );
}
