/**
 * INPUT:  医生填写的患者基础信息表单
 * OUTPUT: 新建患者页（提交至 createPatient Server Action）
 * POS:    需求文档“第一步：基础信息录入”。姓名/性别/年龄必填；
 *         测量数据（身高/体重/腹围/小腿围）供 MNA-SF F 题与体质题 9/28 换算分值。
 *         V2 扩展分区（基本情况补充/疾病与用药/测量补充，来源：Demo_v2更新说明.docx §1）
 *         全部选填，仅医生端完整表单可见，患者自助建档保持简版。
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
import {
  CARE_SITUATIONS,
  EDUCATION_LEVELS,
  LIVING_SITUATIONS,
  MARITAL_STATUSES,
} from "@/lib/assessment/patient-intake";
import { firstQueryValue } from "@/lib/query";
import { V2DemoPipeline } from "@/components/v2-pipeline";

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
      <textarea name={name} placeholder={placeholder} rows={3} className={inputCls} />
      {hint && <span className="ui-helper mt-1">{hint}</span>}
    </label>
  );
}

export default async function NewPatientPage({ searchParams }: PageProps<"/doctor/patients/new">) {
  const error = firstQueryValue((await searchParams).error);

  return (
    <div className="app-page-narrow space-y-6">
      <div className="page-heading">
        <div className="page-heading-copy">
          <p className="page-eyebrow">基础信息填写</p>
          <h1 className="page-title">新建患者档案</h1>
          <p className="page-description">
            请填写基本情况、疾病与用药、人体测量等信息。已填写内容将自动用于后续评估，无需重复询问。
          </p>
        </div>
        <Link href="/doctor" className="ui-button ui-button-quiet">
          <IconArrowLeft size={18} stroke={2} aria-hidden="true" />
          返回患者管理
        </Link>
      </div>

      <V2DemoPipeline current={1} compact />

      <div className="v2-section-banner">
        <div>
          <strong>填写说明</strong>
          <p>
            姓名、性别、年龄为必填；文化程度、婚姻、居住、照护、诊断用药与测量指标为选填，可稍后补录。
          </p>
        </div>
        <span className="ui-badge">下一步：选择评估量表</span>
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
      {error === "profile" && (
        <div className="ui-alert ui-alert-danger" role="alert">
          <IconAlertCircle className="mt-0.5 shrink-0" size={18} stroke={2} aria-hidden="true" />
          <span>
            补充信息格式不正确：请核对数值范围（体重 20–300kg、小腿围 10–80cm、握力 0–100kg、6 米用时 1–120 秒）、
            下拉选项，以及用药清单格式（每行「药名，类别，剂量，频次」，类别限西药/中成药/保健品）；也可全部留空后稍后补录。
          </span>
        </div>
      )}

      <div className="ui-alert" role="note">
        <IconLock className="mt-0.5 shrink-0" size={18} stroke={2} aria-hidden="true" />
        <span>以下信息为医疗敏感信息，仅保存在本地数据库。系统调用云端 AI 时将使用患者唯一编号替代全部身份信息。</span>
      </div>

      <form action={createPatient} className="ui-panel overflow-hidden">
        {/* §1 基本情况：姓名、性别、年龄、文化程度、婚姻、居住、照护 + 就诊标识 */}
        <section>
          <div className="ui-panel-heading">
            <div>
              <h2 className="ui-panel-title">一、基本情况</h2>
              <p className="mt-1 text-xs text-[#62779a]">
                姓名、性别、年龄必填；文化程度、婚姻状况、居住情况、照护情况选填
              </p>
            </div>
            <span className="ui-badge">基本情况</span>
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
            <SelectField label="文化程度" name="education" options={EDUCATION_LEVELS} />
            <SelectField label="婚姻状况" name="maritalStatus" options={MARITAL_STATUSES} />
            <SelectField label="居住情况" name="livingSituation" options={LIVING_SITUATIONS} />
            <SelectField label="照护情况" name="careSituation" options={CARE_SITUATIONS} />
            <Field label="手机号" name="phone" placeholder="选填" />
            <Field label="身份证号" name="idCard" placeholder="选填" />
            <Field label="住址" name="address" placeholder="选填" />
            <Field label="住院号" name="admissionNo" placeholder="选填" />
            <Field label="门诊号" name="outpatientNo" placeholder="选填" />
          </div>
        </section>

        <section className="border-t border-[#dbe7f6]">
          <div className="ui-panel-heading">
            <div>
              <h2 className="ui-panel-title">二、疾病与用药情况</h2>
              <p className="mt-1 text-xs text-[#62779a]">
                现有诊断、既往病史、近期急性疾病；当前西药 / 中成药 / 保健品（结构化后供系统读取题复用）
              </p>
            </div>
            <span className="ui-badge">疾病用药</span>
          </div>
          <div className="ui-panel-body grid gap-5 sm:grid-cols-2">
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
        </section>

        {/* §1 人体测量与客观指标：身高体重 BMI、体重史、小腿围、握力、步速；DXA/BIA 暂不接入 */}
        <section className="border-t border-[#dbe7f6] bg-[#f8fbff]">
          <div className="ui-panel-heading bg-transparent">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-blue-600 shadow-[0_4px_12px_rgba(33,87,160,0.07)]">
                <IconRulerMeasure size={21} stroke={1.9} aria-hidden="true" />
              </span>
              <div>
                <h2 className="ui-panel-title">三、人体测量与客观指标</h2>
                <p className="mt-1 text-xs text-[#62779a]">
                  身高、体重（现在及 1/2/3/6/12 月前）可填，BMI 由系统自动计算；小腿围、握力、步速可现场测量后填入
                </p>
              </div>
            </div>
            <span className="ui-badge">测量指标</span>
          </div>
          <div className="ui-panel-body space-y-5">
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="身高" name="heightCm" type="number" unit="cm" />
              <Field label="体重（现在）" name="weightKg" type="number" unit="kg" />
              <Field label="腹围" name="waistCm" type="number" unit="cm" />
              <Field label="小腿围（兼容旧字段）" name="calfCm" type="number" unit="cm" />
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
              <Field label="握力（手工填入）" name="gripStrengthKg" type="number" unit="kg" />
              <Field label="6 米步行用时" name="gaitSpeed6mSec" type="number" unit="秒" />
            </div>
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#dbe7f6] px-[22px] py-4">
          <p className="text-xs leading-5 text-[#7f94b3]">
            保存后将进入患者详情，可继续选择评估量表并开始采集。
          </p>
          <button type="submit" className="ui-button ui-button-primary ui-button-lg">
            <IconUserPlus size={19} stroke={2.1} aria-hidden="true" />
            保存档案并继续
          </button>
        </div>
      </form>
    </div>
  );
}
