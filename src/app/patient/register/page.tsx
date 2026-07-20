/**
 * INPUT:  路由查询参数（错误提示）
 * OUTPUT: 患者自助建档表单页（大屏适老化样式，提交至 registerPatient Server Action）
 * POS:    产品口径（2026-07-15 修订，覆盖当日早先"固定 FRAIL+跌倒"的锁定口径）：患者自助
 *         建档只收姓名/性别/年龄（必填）+ 测量数据（选填），并可自选评估内容（四量表多选，
 *         默认勾 FRAIL+跌倒）。含舌象/测量题的量表（MNA-SF/中医体质）在选项上如实提示"这些题
 *         暂不计分，先出部分计分报告"——Demo 口径（2026-07-20）：答完一律出报告，医生检查题
 *         按 deferClinical 豁免计分，不再落 awaiting_doctor，见 registerPatient 说明。
 *         身份证/手机/住址/住院号/门诊号等留给医生后续在患者详情页补充，不在此阻塞流程。
 */
import Link from "next/link";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconArrowRight,
  IconCircleCheck,
  IconClipboardList,
  IconGenderFemale,
  IconGenderMale,
  IconRulerMeasure,
  IconStethoscope,
  IconUser,
} from "@tabler/icons-react";
import { registerPatient } from "@/lib/actions/patient";
import { scales } from "@/lib/rules";
import { firstQueryValue } from "@/lib/query";

const inputCls = "patient-input w-full";

/** 默认勾选：FRAIL+跌倒——不含观察题，能纯自助当场出报告，未改动即与旧行为一致。 */
const DEFAULT_SCALE_IDS = new Set(["frail", "fall"]);

/** 适老化短标题（量表正式名含英文缩写，老人不易懂），缺省回落量表库名称。 */
const SCALE_LABELS: Record<string, string> = {
  frail: "衰弱评估",
  mnasf: "营养评估",
  fall: "跌倒风险",
  tcm: "中医体质辨识",
};

/** 每项评估的一句大白话用途说明（非诊断表述，仅帮助老人理解选的是什么）。 */
const SCALE_SUBTITLES: Record<string, string> = {
  frail: "了解您的体力和是否容易疲劳",
  mnasf: "了解您近期的营养状况",
  fall: "了解您走路、站立的稳定情况",
  tcm: "辨识您的中医体质类型",
};

/**
 * 该量表是否含需临床观察/测量的题（舌象、BMI、腹围、小腿围等）。
 * 含则这些题在患者自助路径豁免计分（deferClinical），先出部分计分报告——据此在选项上如实提示。
 * 直接从题库派生，不硬编码量表名，量表增删/改题时自动同步。
 */
function needsClinicianAssist(questions: (typeof scales)[number]["questions"]): boolean {
  return questions.some((question) => question.measurement || question.observerAssisted);
}

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
          {error === "scales" && (
            <div className="ui-alert ui-alert-danger mb-6 text-base sm:text-lg" role="alert">
              <IconAlertCircle size={23} stroke={2} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>请至少选择一项评估内容。</span>
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

            <fieldset className="space-y-3">
              <legend className="flex items-center gap-2 text-lg font-extrabold text-[#173766]">
                <IconClipboardList size={21} stroke={2} className="text-blue-600" aria-hidden="true" />
                选择评估内容 <span className="text-[#c23b4a]">*</span>
              </legend>
              <p className="text-base leading-7 text-[#62779a]">
                默认已选可以当场出报告的两项，您也可以按需增减。
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {scales.map((scale) => {
                  const needsClinician = needsClinicianAssist(scale.questions);
                  return (
                    <label key={scale.id} className="patient-check">
                      <input
                        type="checkbox"
                        name="scaleIds"
                        value={scale.id}
                        defaultChecked={DEFAULT_SCALE_IDS.has(scale.id)}
                      />
                      <span className="min-w-0">
                        <span className="block text-lg font-extrabold leading-tight text-[#173766]">
                          {SCALE_LABELS[scale.id] ?? scale.name}
                        </span>
                        <span className="mt-1 block text-sm leading-6 text-[#62779a]">
                          {SCALE_SUBTITLES[scale.id] ?? ""}
                        </span>
                        <span
                          className={`mt-2 flex items-start gap-1.5 text-sm font-semibold leading-6 ${
                            needsClinician ? "text-[#b06a1a]" : "text-[#1f8a54]"
                          }`}
                        >
                          {needsClinician ? (
                            <IconStethoscope size={17} stroke={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                          ) : (
                            <IconCircleCheck size={17} stroke={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                          )}
                          <span>
                            {needsClinician
                              ? "含舌象、测量等需医生查看的项，这些题暂不计分，答完先出部分计分报告"
                              : "可当场生成评估报告"}
                          </span>
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

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
