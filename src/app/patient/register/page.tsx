/**
 * INPUT:  路由查询参数（错误提示）
 * OUTPUT: 患者自助建档表单页（大屏适老化样式，提交至 registerPatient Server Action）
 * POS:    产品口径（2026-07-14 与用户确认）：患者自助建档只收姓名/性别/年龄（必填）+
 *         测量数据（选填），量表固定 FRAIL+跌倒 预设，提交后直接进入问询界面。
 *         身份证/手机/住址/住院号/门诊号等留给医生后续在患者详情页补充，不在此阻塞流程。
 */
import { registerPatient } from "@/lib/actions/patient";
import { firstQueryValue } from "@/lib/query";

const inputCls =
  "w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-xl text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none";

export default async function PatientRegisterPage({
  searchParams,
}: PageProps<"/patient/register">) {
  const error = firstQueryValue((await searchParams).error);

  return (
    <main className="flex-1 flex flex-col items-center px-6 py-10 gap-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl md:text-4xl font-bold">新建健康档案</h1>
        <p className="text-slate-400 text-lg">只需要填姓名、性别、年龄就可以开始，其他信息可以先不填</p>
      </div>

      {error === "required" && (
        <div className="w-full max-w-xl rounded-xl bg-red-500/15 border border-red-400/50 text-red-100 px-5 py-3 text-lg text-center">
          请完整填写姓名、性别、年龄（年龄需为 1～130 之间的数字）。
        </div>
      )}
      {error === "measurements" && (
        <div className="w-full max-w-xl rounded-xl bg-red-500/15 border border-red-400/50 text-red-100 px-5 py-3 text-lg text-center">
          身高体重等数据格式不对，请填合理的数字，或者留空跳过。
        </div>
      )}

      <form action={registerPatient} className="w-full max-w-xl space-y-6">
        <div className="rounded-2xl bg-slate-800/70 border border-slate-700 p-6 space-y-5">
          <label className="block space-y-2">
            <span className="text-slate-300 text-lg">
              您的姓名 <span className="text-red-400">*</span>
            </span>
            <input name="name" type="text" required placeholder="请输入姓名" className={inputCls} />
          </label>

          <div className="space-y-2">
            <span className="text-slate-300 text-lg">
              性别 <span className="text-red-400">*</span>
            </span>
            <div className="grid grid-cols-2 gap-3">
              {["男", "女"].map((option) => (
                <label
                  key={option}
                  className="flex items-center justify-center rounded-xl border border-slate-600 bg-slate-800 py-4 text-xl text-white cursor-pointer transition has-checked:border-sky-400 has-checked:bg-sky-500/20"
                >
                  <input type="radio" name="gender" value={option} required className="sr-only" />
                  {option}
                </label>
              ))}
            </div>
          </div>

          <label className="block space-y-2">
            <span className="text-slate-300 text-lg">
              年龄 <span className="text-red-400">*</span>
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

        <div className="rounded-2xl bg-slate-800/40 border border-slate-700 p-6 space-y-4">
          <p className="text-slate-400 text-base">以下选填，不清楚可以跳过，医生会在需要时帮您补上</p>
          <div className="grid grid-cols-2 gap-4">
            <label className="block space-y-1.5">
              <span className="text-slate-400 text-sm">身高（cm）</span>
              <input name="heightCm" type="number" step="any" placeholder="选填" className={inputCls} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-slate-400 text-sm">体重（kg）</span>
              <input name="weightKg" type="number" step="any" placeholder="选填" className={inputCls} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-slate-400 text-sm">腹围（cm）</span>
              <input name="waistCm" type="number" step="any" placeholder="选填" className={inputCls} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-slate-400 text-sm">小腿围（cm）</span>
              <input name="calfCm" type="number" step="any" placeholder="选填" className={inputCls} />
            </label>
          </div>
        </div>

        <button
          type="submit"
          className="w-full rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-2xl font-bold px-10 py-5 shadow-xl transition"
        >
          开始评估 →
        </button>
      </form>
    </main>
  );
}
