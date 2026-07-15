/**
 * INPUT:  路由查询参数（错误提示）
 * OUTPUT: 患者自助建档表单页（大屏适老化样式，提交至 registerPatient Server Action）
 * POS:    产品口径（2026-07-14 与用户确认）：患者自助建档只收姓名/性别/年龄（必填）+
 *         测量数据（选填），量表固定 FRAIL+跌倒 预设，提交后直接进入问询界面。
 *         身份证/手机/住址/住院号/门诊号等留给医生后续在患者详情页补充，不在此阻塞流程。
 */
import Link from "next/link";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconArrowRight,
  IconGenderFemale,
  IconGenderMale,
  IconRulerMeasure,
  IconUser,
} from "@tabler/icons-react";
import { registerPatient } from "@/lib/actions/patient";
import { firstQueryValue } from "@/lib/query";

const inputCls = "patient-input w-full";

export default async function PatientRegisterPage({
  searchParams,
}: PageProps<"/patient/register">) {
  const error = firstQueryValue((await searchParams).error);

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
              <p className="patient-display-copy max-w-2xl">
                只需要填写姓名、性别和年龄就可以开始，其他信息可以先不填。
              </p>
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

          <form action={registerPatient} className="space-y-7">
            <div className="space-y-6">
              <label className="block space-y-3">
                <span className="flex items-center gap-2 text-lg font-extrabold text-[#173766]">
                  <IconUser size={21} stroke={2} className="text-blue-600" aria-hidden="true" />
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
            </div>

            <section className="ui-panel-subtle p-5 sm:p-6" aria-labelledby="optional-measurements-title">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-blue-600 shadow-[0_5px_12px_rgba(33,87,160,0.07)]">
                  <IconRulerMeasure size={22} stroke={1.9} aria-hidden="true" />
                </span>
                <div>
                  <h2 id="optional-measurements-title" className="text-lg font-extrabold text-[#173766]">
                    测量数据（选填）
                  </h2>
                  <p className="mt-1 text-base leading-7 text-[#62779a]">以下选填，不清楚可以跳过，医生会在需要时帮您补上</p>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block space-y-2">
                  <span className="text-base font-bold text-[#405a81]">身高（cm）</span>
                  <input name="heightCm" type="number" step="any" placeholder="选填" className={inputCls} />
                </label>
                <label className="block space-y-2">
                  <span className="text-base font-bold text-[#405a81]">体重（kg）</span>
                  <input name="weightKg" type="number" step="any" placeholder="选填" className={inputCls} />
                </label>
                <label className="block space-y-2">
                  <span className="text-base font-bold text-[#405a81]">腹围（cm）</span>
                  <input name="waistCm" type="number" step="any" placeholder="选填" className={inputCls} />
                </label>
                <label className="block space-y-2">
                  <span className="text-base font-bold text-[#405a81]">小腿围（cm）</span>
                  <input name="calfCm" type="number" step="any" placeholder="选填" className={inputCls} />
                </label>
              </div>
            </section>

            <div className="space-y-3">
              <button type="submit" className="patient-primary-action w-full">
                开始评估
                <IconArrowRight size={25} stroke={2.1} aria-hidden="true" />
              </button>
              <p className="text-center text-sm leading-6 text-[#62779a]">提交后将直接进入健康问询。</p>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
