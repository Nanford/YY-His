/**
 * INPUT:  Prisma（患者档案与评估会话）、路由参数 id
 * OUTPUT: 患者详情页：档案信息、测量数据维护、评估会话列表与创建
 * POS:    医生端患者主页。发起评估按 V2/Demo_v2更新说明.docx §2 量表工具选择：
 *         常规综合评估包（默认）/ 系统预设套餐 / 自定义组合 / 随访对比复评（表单见 session-create-form.tsx）。
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconArrowRight,
  IconCalendarClock,
  IconDeviceFloppy,
  IconLock,
  IconRulerMeasure,
  IconShieldCheck,
  IconUserCircle,
} from "@tabler/icons-react";
import { prisma } from "@/lib/db";
import { scaleById } from "@/lib/rules";
import { createSession, updateMeasurements } from "@/lib/actions/doctor";
import { SCALE_PACKAGES, SCORABLE_SCALE_IDS } from "@/lib/assessment/scale-packages";
import { scaleV2ById } from "@/lib/rules/v2";
import type { MedicationEntry, WeightHistory } from "@/lib/assessment/patient-intake";
import { firstQueryValue } from "@/lib/query";
import SessionCreateForm, { type ScaleGroup } from "./session-create-form";
import { V2DemoPipeline } from "@/components/v2-pipeline";

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

  // V2 扩展字段（docx §1，全部选填）：空则不显示。Json 字段读取侧按类型断言还原。
  const diagnoses = (patient.diagnoses as string[] | null) ?? [];
  const pastHistory = (patient.pastHistory as string[] | null) ?? [];
  const recentAcute = (patient.recentAcute as string[] | null) ?? [];
  const medications = (patient.medications as MedicationEntry[] | null) ?? [];
  const weightHistory = patient.weightHistory as WeightHistory | null;
  const weightHistoryEntries: [string, number][] = weightHistory
    ? (
        [
          ["1 月前", weightHistory.m1],
          ["2 月前", weightHistory.m2],
          ["3 月前", weightHistory.m3],
          ["6 月前", weightHistory.m6],
          ["12 月前", weightHistory.m12],
        ] as [string, number | null][]
      ).filter((entry): entry is [string, number] => entry[1] !== null)
    : [];
  // 6 米步速 = 6m / 用时（秒），由程序换算，不单独落库
  const gaitSpeed = patient.gaitSpeed6mSec ? (6 / patient.gaitSpeed6mSec).toFixed(2) : null;

  // 「发起评估」表单数据（docx §2 量表工具选择）：
  // 自定义组合按 01 表一级分类分组，只列已配判定（judgments-v2）的可评分量表，组内保持 01 表文档顺序
  const scaleGroups: ScaleGroup[] = [];
  for (const scaleId of SCORABLE_SCALE_IDS) {
    const scaleV2 = scaleV2ById.get(scaleId);
    const scale = scaleById.get(scaleId);
    if (!scaleV2 || !scale) continue;
    let group = scaleGroups.find((g) => g.category === scaleV2.category);
    if (!group) {
      group = { category: scaleV2.category, scales: [] };
      scaleGroups.push(group);
    }
    group.scales.push({ id: scaleId, name: scale.name, questionCount: scale.questions.length });
  }
  // 随访对比复评（docx §2(3)）：最近一次已出报告（collected/confirmed）会话的量表范围
  const lastReported = patient.sessions.find(
    (session) => session.status === "collected" || session.status === "confirmed"
  );
  const followup = lastReported
    ? {
        dateLabel: lastReported.startedAt.toLocaleDateString("en-CA"),
        scaleCount: (lastReported.scaleIds as string[]).length,
      }
    : null;
  const hasBasicExtras =
    patient.education || patient.maritalStatus || patient.livingSituation || patient.careSituation;
  const hasDiseaseExtras =
    diagnoses.length > 0 || pastHistory.length > 0 || recentAcute.length > 0 || medications.length > 0;
  const hasMeasureExtras =
    weightHistoryEntries.length > 0 ||
    patient.calfLeftCm != null ||
    patient.calfRightCm != null ||
    patient.gripStrengthKg != null ||
    patient.gaitSpeed6mSec != null;

  return (
    <div className="app-page space-y-6">
      <div className="page-heading">
        <div className="page-heading-copy">
          <p className="page-eyebrow">DEMO V2 · 患者主页</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="page-title">{patient.name}</h1>
            <span className="ui-badge font-mono">{patient.code}</span>
          </div>
          <p className="page-description">
            ① 档案与测量在此维护；② 下方发起评估完成量表工具选择；采集后进入 ③～⑥ 判定与干预审核。
          </p>
        </div>
        <Link href="/doctor" className="ui-button ui-button-quiet">
          <IconArrowLeft size={18} stroke={2} aria-hidden="true" />
          返回列表
        </Link>
      </div>

      <V2DemoPipeline current={2} compact />

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

      {/* V2 补充档案（docx §1）：仅在已填写时显示 */}
      {(hasBasicExtras || hasDiseaseExtras || hasMeasureExtras) && (
        <section className="ui-panel overflow-hidden">
          <div className="ui-panel-heading">
            <div>
              <h2 className="ui-panel-title">补充档案（V2）</h2>
              <p className="mt-1 text-xs text-[#62779a]">基本情况、疾病与用药、测量补充；后续量表将直接调用，不再重复询问</p>
            </div>
            <span className="ui-badge">结构化存档</span>
          </div>
          <div className="ui-panel-body space-y-6">
            {hasBasicExtras && (
              <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                {patient.education && (
                  <div>
                    <dt className="text-xs font-bold text-[#62779a]">文化程度</dt>
                    <dd className="mt-1.5 font-semibold text-[#173766]">{patient.education}</dd>
                  </div>
                )}
                {patient.maritalStatus && (
                  <div>
                    <dt className="text-xs font-bold text-[#62779a]">婚姻状况</dt>
                    <dd className="mt-1.5 font-semibold text-[#173766]">{patient.maritalStatus}</dd>
                  </div>
                )}
                {patient.livingSituation && (
                  <div>
                    <dt className="text-xs font-bold text-[#62779a]">居住情况</dt>
                    <dd className="mt-1.5 font-semibold text-[#173766]">{patient.livingSituation}</dd>
                  </div>
                )}
                {patient.careSituation && (
                  <div>
                    <dt className="text-xs font-bold text-[#62779a]">照护情况</dt>
                    <dd className="mt-1.5 font-semibold text-[#173766]">{patient.careSituation}</dd>
                  </div>
                )}
              </dl>
            )}
            {hasDiseaseExtras && (
              <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
                {diagnoses.length > 0 && (
                  <div>
                    <dt className="text-xs font-bold text-[#62779a]">现有诊断</dt>
                    <dd className="mt-1.5 font-semibold text-[#173766]">{diagnoses.join("、")}</dd>
                  </div>
                )}
                {pastHistory.length > 0 && (
                  <div>
                    <dt className="text-xs font-bold text-[#62779a]">既往病史</dt>
                    <dd className="mt-1.5 font-semibold text-[#173766]">{pastHistory.join("、")}</dd>
                  </div>
                )}
                {recentAcute.length > 0 && (
                  <div>
                    <dt className="text-xs font-bold text-[#62779a]">近期急性疾病</dt>
                    <dd className="mt-1.5 font-semibold text-[#173766]">{recentAcute.join("、")}</dd>
                  </div>
                )}
                {medications.length > 0 && (
                  <div>
                    <dt className="text-xs font-bold text-[#62779a]">当前用药</dt>
                    <dd className="mt-1.5 font-semibold text-[#173766]">
                      {medications
                        .map(
                          (med) =>
                            `${med.name}（${[med.category, med.dose, med.frequency].filter(Boolean).join("，")}）`
                        )
                        .join("；")}
                    </dd>
                  </div>
                )}
              </dl>
            )}
            {hasMeasureExtras && (
              <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                {weightHistoryEntries.length > 0 && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-bold text-[#62779a]">历史体重</dt>
                    <dd className="mt-1.5 font-semibold text-[#173766]">
                      {weightHistoryEntries.map(([label, value]) => `${label} ${value}kg`).join("，")}
                    </dd>
                  </div>
                )}
                {(patient.calfLeftCm != null || patient.calfRightCm != null) && (
                  <div>
                    <dt className="text-xs font-bold text-[#62779a]">小腿围（左 / 右）</dt>
                    <dd className="mt-1.5 font-semibold text-[#173766]">
                      {patient.calfLeftCm ?? "—"} cm / {patient.calfRightCm ?? "—"} cm
                    </dd>
                  </div>
                )}
                {patient.gripStrengthKg != null && (
                  <div>
                    <dt className="text-xs font-bold text-[#62779a]">握力</dt>
                    <dd className="mt-1.5 font-semibold text-[#173766]">{patient.gripStrengthKg} kg</dd>
                  </div>
                )}
                {patient.gaitSpeed6mSec != null && (
                  <div>
                    <dt className="text-xs font-bold text-[#62779a]">6 米步行</dt>
                    <dd className="mt-1.5 font-semibold text-[#173766]">
                      {patient.gaitSpeed6mSec} 秒（{gaitSpeed} m/s）
                    </dd>
                  </div>
                )}
              </dl>
            )}
          </div>
        </section>
      )}

      {/* 新建评估会话（docx §2 量表工具选择：套餐 / 自定义组合 / 随访复评） */}
      <SessionCreateForm
        packages={SCALE_PACKAGES}
        groups={scaleGroups}
        followup={followup}
        action={createSession.bind(null, patient.id)}
      />

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
