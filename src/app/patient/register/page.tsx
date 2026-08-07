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

/** 默认勾选：FRAIL+跌倒三问——纯患者自答题，能纯自助当场出报告，与旧默认行为一致。 */
const DEFAULT_SCALE_IDS = new Set(["frail", "fall_3q"]);

/** 适老化短标题（量表正式名含英文缩写，老人不易懂），缺省回落量表库名称。 */
const SCALE_LABELS: Record<string, string> = {
  frail: "衰弱评估",
  mnasf: "营养评估",
  fall_3q: "跌倒风险",
  tcm_constitution: "中医体质辨识",
  adl: "日常生活能力",
  iadl: "工具性日常活动",
  minicog: "认知初筛",
  mmse: "认知功能评估",
  depression_2q: "情绪筛查（抑郁）",
  gds15: "抑郁情绪评估",
  anxiety_2q: "情绪筛查（焦虑）",
  gad7: "焦虑情绪评估",
  ais: "睡眠情况评估",
  lubben: "亲友支持评估",
  morse: "跌倒风险详评",
  ui_2q: "漏尿筛查",
  iciq: "漏尿情况评估",
  constipation_1q: "便秘筛查",
  constipation_symptom: "便秘症状评估",
  sleep_1q: "失眠筛查",
  pain_1q: "慢性疼痛筛查",
  pain_nrs: "疼痛程度评分",
  pressure_screen: "压伤风险筛查",
  dysphagia_screen: "吞咽障碍筛查",
  water_swallow: "洼田饮水试验",
  motor_screen: "运动功能初筛",
  sppb: "简易体能状况",
  vision: "视力评估",
  visual_function: "视觉功能评估",
  hearing: "听力评估",
  whisper: "耳语试验",
  home_env: "居家环境筛查",
  pain_behavior: "疼痛行为观察",
  braden: "压伤风险详评",
  polypharmacy: "多重用药评估",
  nrs2002: "营养风险筛查",
  glim: "营养不良诊断",
  calf: "小腿围测量",
  grip: "握力测量",
  gait_speed: "步速测试",
  dxa_bia: "肌肉量测量",
  cam: "谵妄评估",
};

/** 每项评估的一句大白话用途说明（非诊断表述，仅帮助老人理解选的是什么）。 */
const SCALE_SUBTITLES: Record<string, string> = {
  frail: "了解您的体力和是否容易疲劳",
  mnasf: "了解您近期的营养状况",
  fall_3q: "了解您走路、站立的稳定情况",
  tcm_constitution: "辨识您的中医体质类型",
  adl: "了解您吃饭、穿衣、如厕等自理能力",
  iadl: "了解您购物、做饭、服药等生活能力",
  minicog: "初步了解记忆和认知情况",
  mmse: "全面了解您的记忆、计算和反应情况",
  depression_2q: "了解您最近两周的情绪状态",
  gds15: "更细致地了解您的情绪状态",
  anxiety_2q: "了解您最近两周是否容易紧张担心",
  gad7: "详细了解您最近两周的紧张担心程度",
  ais: "了解您最近一个月的睡眠情况",
  lubben: "了解您和家人朋友的来往与可获得的帮助",
  morse: "结合疾病、输液、步态等情况细评跌倒风险",
  ui_2q: "了解您最近一个月有没有漏尿",
  iciq: "详细了解漏尿的次数、量和常见情形",
  constipation_1q: "了解您平时有没有便秘困扰",
  constipation_symptom: "详细了解便秘时的排便情况和大便形状",
  sleep_1q: "了解您最近一个月有没有失眠困扰",
  pain_1q: "了解您有没有反反复复超过3个月的疼痛",
  pain_nrs: "给您现在最主要的疼痛打个分",
  pressure_screen: "了解您是否长期卧床、皮肤有没有异常",
  dysphagia_screen: "了解您吃饭喝水时有没有呛咳、残留等情况",
  water_swallow: "在医护人员看护下喝少量温水，观察吞咽情况",
  motor_screen: "了解您走远路、上楼梯是否困难",
  sppb: "在医护指导下做平衡、走路和起坐测试",
  vision: "了解您看东西清楚不清楚",
  visual_function: "了解看东西是否吃力、有暗影或变形",
  hearing: "了解您听别人说话清楚不清楚",
  whisper: "在医护指导下做轻声复述听力测试",
  home_env: "了解家里地面、灯光、扶手等安全情况",
  pain_behavior: "由医护人员观察疼痛相关的表情与动作",
  braden: "由医护人员评估皮肤压伤风险",
  polypharmacy: "由医护人员核对您正在吃的药是否合适",
  nrs2002: "结合体重、进食和疾病评估营养风险",
  glim: "结合体重、肌肉量和疾病评估营养不良",
  calf: "测量小腿围，了解肌肉量初筛情况",
  grip: "测量握力，了解手部力量",
  gait_speed: "测量走 6 米的速度，了解走路能力",
  dxa_bia: "根据仪器测得的肌肉量做肌少症判断",
  cam: "由医护人员判断是否有谵妄表现",
};

/**
 * 该量表是否含需医生评估/系统读取的计分条目（V2 条目类型 ≠ 正式问题）。
 * 含则这些条目在患者自助路径豁免计分（deferClinical），先出部分计分报告——据此在选项上如实提示。
 * 直接从题库投影派生，不硬编码量表名，量表增删/改题时自动同步。
 */
function needsClinicianAssist(questions: (typeof scales)[number]["questions"]): boolean {
  return questions.some((question) => question.observerAssisted);
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
