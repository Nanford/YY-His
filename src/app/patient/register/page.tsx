/**
 * INPUT:  路由查询参数（错误提示）
 * OUTPUT: 患者自助建档表单页（大屏适老化样式，提交至 registerPatient Server Action）
 * POS:    产品口径（2026-08-08 用户拍板：基础信息填写全字段扩展到患者端）：姓名/性别/年龄必填，
 *         其余全部选填可跳过——一、基本情况（文化程度/婚姻/居住/照护）；二、疾病与用药情况
 *         （现有诊断/既往病史/近期急性疾病/当前用药：西药·中成药·保健品）；三、人体测量与客观
 *         指标（身高/体重史/BMI 自动计算/双腿小腿围/握力/6 米步行；DXA·BIA 与握力计传感器暂不接入）。
 *         已填写的信息结构化保存，后续量表需要时直接调用，不再重复询问（system-read）。
 *         量表选择为第二步 /patient/select-scales。Demo 口径（2026-07-20）：答完一律出报告，
 *         医生检查题按 deferClinical 豁免计分。身份证/手机/住址等留给医生端补充，不在此阻塞流程。
 */
import Link from "next/link";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconArrowRight,
  IconClipboardText,
  IconGenderFemale,
  IconGenderMale,
  IconRulerMeasure,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import { registerPatient } from "@/lib/actions/patient";
import { prisma } from "@/lib/db";
import {
  CARE_SITUATIONS,
  EDUCATION_LEVELS,
  LIVING_SITUATIONS,
  MARITAL_STATUSES,
} from "@/lib/assessment/patient-intake";
import { firstQueryValue } from "@/lib/query";
import PatientMeasurementFields from "./measurement-fields";

export const dynamic = "force-dynamic";

const inputCls = "patient-input w-full";

/** 选填下拉：空值不提交（服务端按 null 处理），选项与服务端枚举共享同一常量，避免前后端口径漂移 */
function OptionalSelect({ label, name, options }: { label: string; name: string; options: readonly string[] }) {
  return (
    <label className="block space-y-2">
      <span className="text-base font-bold text-[#405a81]">{label}（选填）</span>
      <select name={name} className={inputCls} defaultValue="">
        <option value="">不清楚 / 暂不填</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

/** 选填多行文本：多项用逗号/顿号分隔（与服务端 parseTextList 口径一致） */
function OptionalTextarea({
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
    <label className="block space-y-2">
      <span className="text-base font-bold text-[#405a81]">{label}（选填）</span>
      <textarea name={name} rows={2} placeholder={placeholder} className={inputCls} />
      {hint && <span className="block text-sm leading-6 text-[#7f94b3]">{hint}</span>}
    </label>
  );
}

export default async function PatientRegisterPage({
  searchParams,
}: PageProps<"/patient/register">) {
  const error = firstQueryValue((await searchParams).error);

  // 已有档案（2026-08-08 用户拍板：建档页可直接选择已有档案继续评估，无需重复建档）：
  // 最近建档的在前；demo 无鉴权，仅列姓名/性别/年龄三项非敏感组合供本人点选。
  const existingPatients = await prisma.patient.findMany({
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { id: true, name: true, gender: true, age: true },
  });

  return (
    <main className="patient-main flex-1">
      <Link href="/patient" className="ui-button ui-button-quiet -ml-2 mb-6">
        <IconArrowLeft size={19} stroke={2} aria-hidden="true" />
        返回评估首页
      </Link>

      <section className="patient-panel overflow-hidden">
        <div className="border-b border-blue-100 bg-[#f8fbff] px-6 py-7 sm:px-9 sm:py-9">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white text-blue-600 shadow-[0_6px_16px_rgba(33,87,160,0.08)]">
              <IconUser size={26} stroke={1.9} aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-extrabold tracking-[0.1em] text-blue-700">第一步 · 建立健康档案</p>
              <h1 className="patient-display-title mt-2">新建健康档案</h1>
            </div>
          </div>
        </div>

        <div className="px-6 py-7 sm:px-9 sm:py-9">
          {error === "required" && (
            <div className="ui-alert ui-alert-danger mb-6 text-base sm:text-lg" role="alert">
              <IconAlertCircle size={23} stroke={2} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>请完整填写姓名、性别、年龄（年龄需为 1～130 之间的数字）。</span>
            </div>
          )}
          {error === "measurements" && (
            <div className="ui-alert ui-alert-danger mb-6 text-base sm:text-lg" role="alert">
              <IconAlertCircle size={23} stroke={2} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>身高体重等数据格式不对，请填合理的数字，或者留空跳过。</span>
            </div>
          )}
          {error === "profile" && (
            <div className="ui-alert ui-alert-danger mb-6 text-base sm:text-lg" role="alert">
              <IconAlertCircle size={23} stroke={2} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                部分选填内容格式不对：请核对体重（20–300kg）、小腿围（10–80cm）、握力（0–100kg）、6 米用时（1–120 秒）等数字，
                以及用药清单写法（每行一条「药名，类别，剂量，频次」，类别限 西药/中成药/保健品）；也可以全部留空跳过。
              </span>
            </div>
          )}

          {/* 选择已有档案：点选本人档案直接进入第二步量表选择，无需重复填写 */}
          {existingPatients.length > 0 && (
            <section className="mb-9 rounded-2xl border border-blue-100 bg-[#f8fbff] p-5 sm:p-6">
              <h2 className="flex items-center gap-2 text-xl font-extrabold text-[#173766]">
                <IconUsers size={23} stroke={2} className="text-blue-600" aria-hidden="true" />
                已经建档过？选择已有档案
              </h2>
              <p className="mt-1 text-base leading-7 text-[#62779a]">
                点选本人档案直接进入评估；首次使用请填写下方新档案。
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {existingPatients.map((p) => (
                  <Link
                    key={p.id}
                    href={`/patient/select-scales?patientId=${p.id}`}
                    className="rounded-2xl border border-blue-100 bg-white px-4 py-3.5 text-center transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-[0_10px_20px_rgba(23,105,232,0.10)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200"
                  >
                    <span className="block text-lg font-extrabold text-[#173766]">{p.name}</span>
                    <span className="mt-0.5 block text-sm text-[#7f94b3]">
                      {p.gender} · {p.age} 岁
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <form action={registerPatient} className="space-y-9">
            {/* 一、基本情况：姓名/性别/年龄必填，其余选填 */}
            <section className="space-y-6">
              <h2 className="flex items-center gap-2 text-xl font-extrabold text-[#173766]">
                <IconUser size={23} stroke={2} className="text-blue-600" aria-hidden="true" />
                一、基本情况
              </h2>
              <div className="space-y-6">
                <label className="block space-y-3">
                  <span className="flex items-center gap-2 text-lg font-extrabold text-[#173766]">
                    您的姓名 <span className="text-[#c23b4a]">*</span>
                  </span>
                  <input name="name" type="text" required placeholder="请输入姓名" className={inputCls} />
                </label>

                <fieldset className="space-y-3">
                  <legend className="text-lg font-extrabold text-[#173766]">
                    性别 <span className="text-[#c23b4a]">*</span>
                  </legend>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { value: "男", icon: IconGenderMale },
                      { value: "女", icon: IconGenderFemale },
                    ].map(({ value, icon: Icon }) => (
                      <label key={value} className="patient-choice gap-3">
                        <input type="radio" name="gender" value={value} required />
                        <Icon size={26} stroke={1.9} aria-hidden="true" />
                        <span>{value}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <label className="block space-y-3">
                  <span className="text-lg font-extrabold text-[#173766]">
                    年龄 <span className="text-[#c23b4a]">*</span>
                  </span>
                  <input
                    name="age"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={130}
                    required
                    placeholder="请输入年龄"
                    className={inputCls}
                  />
                </label>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <OptionalSelect label="文化程度" name="education" options={EDUCATION_LEVELS} />
                  <OptionalSelect label="婚姻状况" name="maritalStatus" options={MARITAL_STATUSES} />
                  <OptionalSelect label="居住情况" name="livingSituation" options={LIVING_SITUATIONS} />
                  <OptionalSelect label="照护情况" name="careSituation" options={CARE_SITUATIONS} />
                </div>
              </div>
            </section>

            {/* 二、疾病与用药情况（全部选填） */}
            <section className="space-y-5 border-t border-blue-100 pt-7">
              <h2 className="flex items-center gap-2 text-xl font-extrabold text-[#173766]">
                <IconClipboardText size={23} stroke={2} className="text-blue-600" aria-hidden="true" />
                二、疾病与用药情况（选填）
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <OptionalTextarea
                  label="现有诊断"
                  name="diagnoses"
                  placeholder="例如：高血压，2型糖尿病"
                  hint="多个诊断用逗号或顿号分隔"
                />
                <OptionalTextarea
                  label="既往病史"
                  name="pastHistory"
                  placeholder="例如：脑梗死，髋关节置换术"
                  hint="多项用逗号或顿号分隔"
                />
                <OptionalTextarea
                  label="近期急性疾病"
                  name="recentAcute"
                  placeholder="例如：肺部感染"
                  hint="多项用逗号或顿号分隔"
                />
                <OptionalTextarea
                  label="当前用药（西药 / 中成药 / 保健品）"
                  name="medications"
                  placeholder={"苯磺酸氨氯地平，西药，5mg，每日一次\n钙片，保健品"}
                  hint="每行一条：药名，类别，剂量，频次"
                />
              </div>
            </section>

            {/* 三、人体测量与客观指标（全部选填，BMI 自动计算） */}
            <section className="space-y-5 border-t border-blue-100 pt-7">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600">
                  <IconRulerMeasure size={22} stroke={1.9} aria-hidden="true" />
                </span>
                <div>
                  <h2 className="text-xl font-extrabold text-[#173766]">三、人体测量与客观指标（选填）</h2>
                  <p className="mt-1 text-base leading-7 text-[#62779a]">
                    不清楚可跳过；BMI 由系统自动计算。
                  </p>
                </div>
              </div>
              <PatientMeasurementFields />
            </section>

            <div className="space-y-3">
              <button type="submit" className="patient-primary-action w-full">
                下一步：选择评估内容
                <IconArrowRight size={25} stroke={2.1} aria-hidden="true" />
              </button>
              <p className="text-center text-sm leading-6 text-[#62779a]">提交后进入量表选择，再开始健康问询。</p>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
