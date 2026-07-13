/**
 * INPUT:  Prisma（患者档案与评估会话）、路由参数 id
 * OUTPUT: 患者详情页：档案信息、测量数据维护、评估会话列表与创建
 * POS:    医生端患者主页。创建评估会话时可勾选量表（需求：会话可只跑部分量表，默认全选）。
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { scales } from "@/lib/rules";
import { createSession, updateMeasurements } from "@/lib/actions/doctor";
import { firstQueryValue } from "@/lib/query";

export const dynamic = "force-dynamic";

const SESSION_STATUS_META: Record<string, { label: string; cls: string }> = {
  in_progress: { label: "采集中", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  collected: { label: "待审核", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  confirmed: { label: "已确认", cls: "bg-green-50 text-green-700 border-green-200" },
};

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

export default async function PatientDetailPage({
  params,
  searchParams,
}: PageProps<"/doctor/patients/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const error = firstQueryValue(query.error);
  const saved = firstQueryValue(query.saved);
  const patient = await prisma.patient.findUnique({
    where: { id },
    include: { sessions: { orderBy: { startedAt: "desc" } } },
  });
  if (!patient) notFound();

  const bmi =
    patient.heightCm && patient.weightKg
      ? (patient.weightKg / (patient.heightCm / 100) ** 2).toFixed(1)
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {patient.name}
          <span className="ml-3 text-sm font-mono font-normal text-slate-500">{patient.code}</span>
        </h1>
        <Link href="/doctor" className="text-sm text-slate-500 hover:text-blue-600">
          ← 返回列表
        </Link>
      </div>

      {error === "no-scale" && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
          请至少勾选一个评估量表。
        </div>
      )}
      {error === "measurements" && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
          测量数据格式不正确，请填写合理的正数，或留空后再保存。
        </div>
      )}
      {saved === "measurements" && (
        <div className="rounded-lg bg-green-50 border border-green-200 text-green-700 px-4 py-3 text-sm">
          测量数据已保存；采集中的会话已同步更新相关测量题答案。
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* 档案信息 */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
          <h2 className="font-semibold">档案信息</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">性别 / 年龄</dt>
            <dd>
              {patient.gender} / {patient.age} 岁
            </dd>
            <dt className="text-slate-500">手机号</dt>
            <dd>{patient.phone ?? "—"}</dd>
            <dt className="text-slate-500">住院号 / 门诊号</dt>
            <dd>
              {patient.admissionNo ?? "—"} / {patient.outpatientNo ?? "—"}
            </dd>
            <dt className="text-slate-500">住址</dt>
            <dd>{patient.address ?? "—"}</dd>
          </dl>
          <p className="text-xs text-slate-400 pt-2 border-t border-slate-100">
            身份信息仅存本地；出网调用一律使用患者编号 {patient.code}。
          </p>
        </div>

        {/* 测量数据 */}
        <form
          action={updateMeasurements.bind(null, patient.id)}
          className="rounded-xl border border-slate-200 bg-white p-6 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">测量数据</h2>
            {bmi && <span className="text-sm text-slate-500">BMI：{bmi}</span>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm space-y-1">
              <span className="text-slate-600">身高（cm）</span>
              <input name="heightCm" type="number" step="any" defaultValue={patient.heightCm ?? ""} className={inputCls} />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-slate-600">体重（kg）</span>
              <input name="weightKg" type="number" step="any" defaultValue={patient.weightKg ?? ""} className={inputCls} />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-slate-600">腹围（cm）</span>
              <input name="waistCm" type="number" step="any" defaultValue={patient.waistCm ?? ""} className={inputCls} />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-slate-600">小腿围（cm）</span>
              <input name="calfCm" type="number" step="any" defaultValue={patient.calfCm ?? ""} className={inputCls} />
            </label>
          </div>
          <div className="flex justify-end">
            <button className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-50">保存</button>
          </div>
        </form>
      </div>

      {/* 新建评估会话 */}
      <form action={createSession.bind(null, patient.id)} className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <h2 className="font-semibold">发起新评估</h2>
        <div className="flex flex-wrap gap-4">
          {scales.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50 cursor-pointer">
              <input type="checkbox" name={`scale.${s.id}`} defaultChecked className="accent-blue-600" />
              {s.name}
              <span className="text-xs text-slate-400">（{s.questions.length} 题）</span>
            </label>
          ))}
        </div>
        <div className="flex justify-end">
          <button className="rounded-lg bg-blue-600 text-white px-5 py-2 text-sm font-medium hover:bg-blue-700">
            创建评估会话
          </button>
        </div>
      </form>

      {/* 会话历史 */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <h2 className="font-semibold px-6 py-4 border-b border-slate-100">评估记录</h2>
        {patient.sessions.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-400">暂无评估记录</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className="px-6 py-2.5 font-medium">发起时间</th>
                <th className="px-6 py-2.5 font-medium">量表</th>
                <th className="px-6 py-2.5 font-medium">状态</th>
                <th className="px-6 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {patient.sessions.map((s) => {
                const meta = SESSION_STATUS_META[s.status] ?? { label: s.status, cls: "bg-slate-50" };
                return (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="px-6 py-3">{s.startedAt.toLocaleString("zh-CN")}</td>
                    <td className="px-6 py-3 text-slate-500">{(s.scaleIds as string[]).length} 个量表</td>
                    <td className="px-6 py-3">
                      <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs ${meta.cls}`}>{meta.label}</span>
                    </td>
                    <td className="px-6 py-3 text-right">
                      <Link href={`/doctor/sessions/${s.id}`} className="text-blue-600 hover:underline">
                        进入 →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
