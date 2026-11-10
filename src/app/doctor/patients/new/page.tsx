/**
 * INPUT:  医生填写的患者基础信息表单
 * OUTPUT: 新建患者页（提交至 createPatient Server Action）
 * POS:    需求文档“第一步：基础信息录入”。姓名/性别/年龄必填；
 *         测量数据（身高/体重/腹围/小腿围）供 MNA-SF F 题与体质题 9/28 换算分值。
 *         V2 扩展分区（基本情况补充/疾病与用药/测量补充，来源：Demo_v2更新说明.docx §1）
 *         全部选填，仅医生端完整表单可见，患者自助建档保持简版。
 */
import Link from "next/link";
import { ArrowLeft, CircleAlert, UserPlus, UserRound } from "lucide-react";
import { createPatient } from "@/lib/actions/doctor";
import {
  CARE_SITUATIONS,
  EDUCATION_LEVELS,
  LIVING_SITUATIONS,
  MARITAL_STATUSES,
} from "@/lib/assessment/patient-intake";
import { firstQueryValue } from "@/lib/query";
import { SectionDisclosure } from "@/components/section-disclosure";
import NoWheelNumberInput from "@/components/no-wheel-number-input";
import MeasurementSection from "./measurement-section";

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
      {type === "number" ? (
        <NoWheelNumberInput name={name} required={required} placeholder={placeholder} className={inputCls} step="any" />
      ) : (
        <input name={name} type={type} required={required} placeholder={placeholder} className={inputCls} step="any" />
      )}
    </label>
  );
}

/** 选填下拉：空值不提交（服务端按 null 处理），选项与服务端枚举共享同一常量，避免前后端口径漂移 */
function SelectField({ label, name, options }: { label: string; name: string; options: readonly string[] }) {
  return (
    <label className="ui-field">
      <span className="ui-label">{label}</span>
      <select name={name} className="ui-select" defaultValue="">
        <option value="">未填写</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextareaField({
  label,
  name,
  placeholder,
  hint,
}: {
  label: string;
  name: string;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="ui-field">
      <span className="ui-label">{label}</span>
      <textarea name={name} placeholder={placeholder} rows={3} className="ui-textarea" />
      {hint && <span className="ui-helper mt-1">{hint}</span>}
    </label>
  );
}

export default async function NewPatientPage({ searchParams }: PageProps<"/doctor/patients/new">) {
  const error = firstQueryValue((await searchParams).error);

  return (
    <div className="app-page space-y-5">
      <div className="page-heading">
        <div className="page-heading-copy">
          <h1 className="page-title">新建患者档案</h1>
          <p className="page-description">姓名、性别和年龄必填。</p>
        </div>
        <Link href="/doctor" className="ui-button ui-button-quiet">
          <ArrowLeft size={18} strokeWidth={2} aria-hidden="true" />
          返回患者管理
        </Link>
      </div>

      {error === "required" && (
        <div className="ui-alert ui-alert-danger" role="alert">
          <CircleAlert className="mt-0.5 shrink-0" size={18} strokeWidth={2} aria-hidden="true" />
          <span>请完整填写必填项：姓名、性别、年龄（年龄需为 1～130 的整数）。</span>
        </div>
      )}
      {error === "measurements" && (
        <div className="ui-alert ui-alert-danger" role="alert">
          <CircleAlert className="mt-0.5 shrink-0" size={18} strokeWidth={2} aria-hidden="true" />
          <span>测量数据格式不正确，请填写合理的正数，或留空后稍后补录。</span>
        </div>
      )}
      {error === "profile" && (
        <div className="ui-alert ui-alert-danger" role="alert">
          <CircleAlert className="mt-0.5 shrink-0" size={18} strokeWidth={2} aria-hidden="true" />
          <span>
            补充信息格式不正确：请核对数值范围（体重 20–300kg、小腿围 10–80cm、握力 0–100kg、6 米用时 1–120 秒）、
            下拉选项，以及用药清单格式（每行「药名，类别，剂量，频次」，类别限西药/中成药/保健品）；也可全部留空后稍后补录。
          </span>
        </div>
      )}

      <form action={createPatient} className="grid items-start gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        {/* §1 基本情况：姓名、性别、年龄、文化程度、婚姻、居住、照护 + 就诊标识 */}
        <section className="ui-panel overflow-hidden">
          <div className="ui-panel-heading justify-start gap-2 bg-accent/45">
            <UserRound className="size-5 text-primary" aria-hidden="true" />
            <h2 className="ui-panel-title">基本情况</h2>
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
            <div className="space-y-2 sm:col-span-2">
              <SectionDisclosure title="生活与照护" summary="选填" defaultOpen={error === "profile"}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField label="文化程度" name="education" options={EDUCATION_LEVELS} />
                  <SelectField label="婚姻状况" name="maritalStatus" options={MARITAL_STATUSES} />
                  <SelectField label="居住情况" name="livingSituation" options={LIVING_SITUATIONS} />
                  <SelectField label="照护情况" name="careSituation" options={CARE_SITUATIONS} />
                </div>
              </SectionDisclosure>
              <SectionDisclosure title="联系方式与就诊编号" summary="选填">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="手机号" name="phone" />
                  <Field label="身份证号" name="idCard" />
                  <Field label="住址" name="address" />
                  <Field label="住院号" name="admissionNo" />
                  <Field label="门诊号" name="outpatientNo" />
                </div>
              </SectionDisclosure>
            </div>
          </div>
        </section>

        <div className="space-y-4">
          <MeasurementSection />
          <SectionDisclosure title="疾病与用药情况" summary="选填" defaultOpen={error === "profile"}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextareaField
              label="现有诊断"
              name="diagnoses"
              placeholder="高血压，2型糖尿病"
              hint="多个诊断用逗号或顿号分隔"
            />
            <TextareaField
              label="既往病史"
              name="pastHistory"
              placeholder="脑梗死，髋关节置换术"
              hint="多项用逗号或顿号分隔"
            />
            <TextareaField
              label="近期急性疾病"
              name="recentAcute"
              placeholder="肺部感染"
              hint="多项用逗号或顿号分隔"
            />
            <TextareaField
              label="当前用药清单"
              name="medications"
              placeholder={"苯磺酸氨氯地平，西药，5mg，每日一次\n二甲双胍，西药，0.5g，每日两次\n钙片，保健品"}
              hint='每行一条："药名，类别，剂量，频次"（剂量/频次可省）；类别限 西药 / 中成药 / 保健品'
            />
          </div>
          </SectionDisclosure>
        </div>

        <div className="sticky bottom-3 z-10 flex justify-end rounded-xl border border-border bg-card p-3 shadow-lg shadow-blue-950/10 xl:col-span-2">
          <button type="submit" className="ui-button ui-button-primary ui-button-lg">
            <UserPlus size={19} strokeWidth={2.1} aria-hidden="true" />
            保存档案并继续
          </button>
        </div>
      </form>
    </div>
  );
}
