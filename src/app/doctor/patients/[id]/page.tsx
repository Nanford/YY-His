/**
 * INPUT:  Prisma（患者档案与评估会话）、路由参数 id
 * OUTPUT: 患者详情页：档案信息、测量数据维护、评估会话列表与创建
 * POS:    医生端患者主页。创建评估会话时可勾选量表（需求：会话可只跑部分量表，默认全选）。
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconArrowRight,
  IconCalendarClock,
  IconClipboardText,
  IconDeviceFloppy,
  IconFileAnalytics,
  IconLock,
  IconRulerMeasure,
  IconShieldCheck,
  IconUserCircle,
} from "@tabler/icons-react";
import { prisma } from "@/lib/db";
import { scaleById, scales } from "@/lib/rules";
import { createSession, updateMeasurements } from "@/lib/actions/doctor";
import { firstQueryValue } from "@/lib/query";

export const dynamic = "force-dynamic";

const SESSION_STATUS_META: Record<string, { label: string; cls: string }> = {
  in_progress: { label: "采集中", cls: "ui-badge" },
  collected: { label: "待审核", cls: "ui-badge ui-badge-warning" },
  confirmed: { label: "已确认", cls: "ui-badge ui-badge-success" },
};

const inputCls = "ui-input";

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
    <div className="app-page space-y-6">
      <div className="page-heading">
        <div className="page-heading-copy">
          <p className="page-eyebrow">PATIENT PROFILE</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="page-title">{patient.name}</h1>
            <span className="ui-badge font-mono">{patient.code}</span>
          </div>
          <p className="page-description">患者档案、测量数据与评估记录集中留存，可随时追溯核验。</p>
        </div>
        <Link href="/doctor" className="ui-button ui-button-quiet">
          <IconArrowLeft size={18} stroke={2} aria-hidden="true" />
          返回列表
        </Link>
      </div>

      {error === "no-scale" && (
        <div className="ui-alert ui-alert-danger" role="alert">
          <IconAlertCircle className="mt-0.5 shrink-0" size={18} stroke={2} aria-hidden="true" />
          <span>请至少勾选一个评估量表。</span>
        </div>
      )}
      {error === "measurements" && (
        <div className="ui-alert ui-alert-danger" role="alert">
          <IconAlertCircle className="mt-0.5 shrink-0" size={18} stroke={2} aria-hidden="true" />
          <span>测量数据格式不正确，请填写合理的正数，或留空后再保存。</span>
        </div>
      )}
      {saved === "measurements" && (
        <div className="ui-alert border-[#bee7dc] bg-[#e9f8f4] text-[#0f705e]" role="status">
          <IconShieldCheck className="mt-0.5 shrink-0" size={18} stroke={2} aria-hidden="true" />
          <span>测量数据已保存；采集中的会话已同步更新相关测量题答案。</span>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        {/* 档案信息 */}
        <section className="ui-panel overflow-hidden">
          <div className="ui-panel-heading">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-600">
                <IconUserCircle size={21} stroke={1.9} aria-hidden="true" />
              </span>
              <div>
                <h2 className="ui-panel-title">档案信息</h2>
                <p className="mt-1 text-xs text-[#62779a]">本地医疗敏感信息</p>
              </div>
            </div>
            <span className="ui-badge">已建档</span>
          </div>
          <div className="ui-panel-body">
            <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-bold text-[#62779a]">性别 / 年龄</dt>
                <dd className="mt-1.5 font-semibold text-[#173766]">
                  {patient.gender} / {patient.age} 岁
                </dd>
              </div>
              <div>
                <dt className="text-xs font-bold text-[#62779a]">手机号</dt>
                <dd className="mt-1.5 font-semibold text-[#173766]">{patient.phone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold text-[#62779a]">住院号 / 门诊号</dt>
                <dd className="mt-1.5 font-semibold text-[#173766]">
                  {patient.admissionNo ?? "—"} / {patient.outpatientNo ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-bold text-[#62779a]">住址</dt>
                <dd className="mt-1.5 font-semibold text-[#173766]">{patient.address ?? "—"}</dd>
              </div>
            </dl>
            <div className="mt-6 flex items-start gap-2 border-t border-[#dbe7f6] pt-4 text-xs leading-5 text-[#62779a]">
              <IconLock className="mt-0.5 shrink-0 text-blue-600" size={16} stroke={2} aria-hidden="true" />
              <p>身份信息仅存本地；出网调用一律使用患者编号 {patient.code}。</p>
            </div>
          </div>
        </section>

        {/* 测量数据 */}
        <form action={updateMeasurements.bind(null, patient.id)} className="ui-panel overflow-hidden">
          <div className="ui-panel-heading">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-600">
                <IconRulerMeasure size={21} stroke={1.9} aria-hidden="true" />
              </span>
              <div>
                <h2 className="ui-panel-title">测量数据</h2>
                <p className="mt-1 text-xs text-[#62779a]">用于量表自动换算</p>
              </div>
            </div>
            {bmi && <span className="ui-badge">BMI：{bmi}</span>}
          </div>
          <div className="ui-panel-body space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="ui-field">
                <span className="ui-label">身高（cm）</span>
                <input name="heightCm" type="number" step="any" defaultValue={patient.heightCm ?? ""} className={inputCls} />
              </label>
              <label className="ui-field">
                <span className="ui-label">体重（kg）</span>
                <input name="weightKg" type="number" step="any" defaultValue={patient.weightKg ?? ""} className={inputCls} />
              </label>
              <label className="ui-field">
                <span className="ui-label">腹围（cm）</span>
                <input name="waistCm" type="number" step="any" defaultValue={patient.waistCm ?? ""} className={inputCls} />
              </label>
              <label className="ui-field">
                <span className="ui-label">小腿围（cm）</span>
                <input name="calfCm" type="number" step="any" defaultValue={patient.calfCm ?? ""} className={inputCls} />
              </label>
            </div>
            <div className="flex justify-end">
              <button className="ui-button ui-button-secondary" type="submit">
                <IconDeviceFloppy size={17} stroke={2} aria-hidden="true" />
                保存
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* 新建评估会话 */}
      <form action={createSession.bind(null, patient.id)} className="ui-panel overflow-hidden">
        <div className="ui-panel-heading">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-600">
              <IconFileAnalytics size={21} stroke={1.9} aria-hidden="true" />
            </span>
            <div>
              <h2 className="ui-panel-title">发起新评估</h2>
              <p className="mt-1 text-xs text-[#62779a]">勾选本次需要执行的评估量表</p>
            </div>
          </div>
          <span className="ui-badge">默认全选</span>
        </div>
        <div className="ui-panel-body">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {scales.map((scale) => (
              <label key={scale.id} className="ui-choice">
                <input type="checkbox" name={`scale.${scale.id}`} defaultChecked />
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">{scale.name}</span>
                  <span className="mt-0.5 block text-xs font-normal text-[#7f94b3]">{scale.questions.length} 题</span>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-5 flex justify-end">
            <button className="ui-button ui-button-primary ui-button-lg" type="submit">
              <IconClipboardText size={19} stroke={2.1} aria-hidden="true" />
              创建评估会话
            </button>
          </div>
        </div>
      </form>

      {/* 会话历史 */}
      <section className="ui-table-wrap">
        <div className="ui-panel-heading">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-600">
              <IconCalendarClock size={21} stroke={1.9} aria-hidden="true" />
            </span>
            <div>
              <h2 className="ui-panel-title">评估记录</h2>
              <p className="mt-1 text-xs text-[#62779a]">每次采集、评分与方案审核均保留记录</p>
            </div>
          </div>
          <span className="ui-badge">{patient.sessions.length} 条记录</span>
        </div>
        {patient.sessions.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-blue-600">
              <IconCalendarClock size={23} stroke={1.9} aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-bold text-[#405a81]">暂无评估记录</p>
            <p className="mt-1 text-xs text-[#7f94b3]">创建评估会话后，记录将显示在这里。</p>
          </div>
        ) : (
          <table className="ui-table">
            <thead>
              <tr>
                <th>发起时间</th>
                <th>量表</th>
                <th>状态</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {patient.sessions.map((session) => {
                const meta = SESSION_STATUS_META[session.status] ?? { label: session.status, cls: "ui-badge" };
                return (
                  <tr key={session.id}>
                    <td>{session.startedAt.toLocaleString("zh-CN")}</td>
                    {/* V2.0 §3：评估范围需可识别（量表名称），新旧结果按时间分别展示可下钻 */}
                    <td className="text-[#62779a]">
                      {(session.scaleIds as string[]).map((scaleId) => scaleById.get(scaleId)?.name ?? scaleId).join("、")}
                    </td>
                    <td>
                      <span className={meta.cls}>{meta.label}</span>
                    </td>
                    <td className="text-right">
                      <Link href={`/doctor/sessions/${session.id}`} className="ui-button ui-button-quiet">
                        进入
                        <IconArrowRight size={17} stroke={2} aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
