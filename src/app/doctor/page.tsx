/**
 * INPUT:  Prisma（患者列表及会话计数）
 * OUTPUT: 患者管理列表页 + Demo V2 主流程提示
 * POS:    医生端首页。展示全部患者；流程对齐 Demo_v2 §1 建档 → §2 选量表 → 采集/审核。
 */
import Link from "next/link";
import {
  IconArrowRight,
  IconClipboardText,
  IconPlus,
  IconUsersGroup,
} from "@tabler/icons-react";
import { prisma } from "@/lib/db";
import { V2DemoPipeline } from "@/components/v2-pipeline";

export const dynamic = "force-dynamic";

export default async function DoctorHomePage() {
  const patients = await prisma.patient.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { sessions: true } } },
  });
  const assessmentCount = patients.reduce((total, patient) => total + patient._count.sessions, 0);
  const pendingReview = await prisma.assessmentSession.count({
    where: { status: "collected" },
  });

  return (
    <div className="app-page space-y-6 u-stagger">
      <div className="page-heading">
        <div className="page-heading-copy">
          <p className="page-eyebrow">DEMO V2 · 医生工作台</p>
          <h1 className="page-title">患者管理</h1>
          <p className="page-description">
            按《Demo_v2更新说明》主流程：先完成基础信息填写，再在患者详情发起量表工具选择与采集审核。
          </p>
        </div>
        <Link href="/doctor/patients/new" className="ui-button ui-button-primary ui-button-lg">
          <IconPlus size={19} stroke={2.2} aria-hidden="true" />
          ① 新建患者档案
        </Link>
      </div>

      <V2DemoPipeline current={1} compact />

      <div className="v2-section-banner">
        <div>
          <strong>医生端在本流程中的职责</strong>
          <p>
            <b>① 基础信息</b>完整建档（含疾病用药与测量）；
            <b> ② 量表工具选择</b>（常规综合 / 病历智能 / 随访 / 自选组合）；
            医护题与系统读取结果在采集页代填；
            <b> ⑤ 干预匹配审核</b>（删留/替换，留痕后确认）。
          </p>
        </div>
        <Link href="/doctor/patients/new" className="ui-button ui-button-secondary shrink-0">
          从建档开始
          <IconArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="ui-panel-subtle flex items-center gap-4 px-5 py-4">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-blue-600 shadow-[0_5px_14px_rgba(33,87,160,0.08)]">
            <IconUsersGroup size={23} stroke={1.9} aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-bold text-[#405a81]">已建档患者</p>
            <p className="mt-0.5 text-2xl font-extrabold tracking-[-0.03em] text-[#102a56]">
              {patients.length}
            </p>
          </div>
        </div>
        <div className="ui-panel-subtle flex items-center gap-4 px-5 py-4">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-blue-600 shadow-[0_5px_14px_rgba(33,87,160,0.08)]">
            <IconClipboardText size={23} stroke={1.9} aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-bold text-[#405a81]">累计评估会话</p>
            <p className="mt-0.5 text-2xl font-extrabold tracking-[-0.03em] text-[#102a56]">
              {assessmentCount}
            </p>
          </div>
        </div>
        <div className="ui-panel-subtle flex items-center gap-4 px-5 py-4">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-amber-700 shadow-[0_5px_14px_rgba(33,87,160,0.08)]">
            <IconClipboardText size={23} stroke={1.9} aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-bold text-[#405a81]">待审核干预方案</p>
            <p className="mt-0.5 text-2xl font-extrabold tracking-[-0.03em] text-[#102a56]">
              {pendingReview}
            </p>
          </div>
        </div>
      </div>

      {patients.length === 0 ? (
        <section className="ui-panel px-6 py-14 text-center sm:px-10">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-blue-50 text-blue-600">
            <IconUsersGroup size={31} stroke={1.75} aria-hidden="true" />
          </span>
          <h2 className="mt-5 text-lg font-extrabold text-[#173766]">暂无患者档案</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#62779a]">
            先完成 Demo V2 第 ① 步「基础信息填写」，再在患者详情发起第 ② 步「量表工具选择」。
          </p>
          <Link href="/doctor/patients/new" className="ui-button ui-button-primary mt-6">
            <IconPlus size={18} stroke={2.2} aria-hidden="true" />
            新建患者
          </Link>
        </section>
      ) : (
        <section className="ui-table-wrap">
          <div className="ui-panel-heading">
            <div>
              <h2 className="ui-panel-title">患者档案</h2>
              <p className="mt-1 text-xs text-[#62779a]">点击详情 → 发起评估（量表工具选择）</p>
            </div>
            <span className="ui-badge">共 {patients.length} 位</span>
          </div>
          <table className="ui-table">
            <thead>
              <tr>
                <th scope="col">姓名</th>
                <th scope="col">编号</th>
                <th scope="col">性别/年龄</th>
                <th scope="col">评估次数</th>
                <th scope="col" className="text-right">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {patients.map((patient) => (
                <tr key={patient.id}>
                  <td className="font-extrabold text-[#173766]">{patient.name}</td>
                  <td className="font-mono text-xs text-[#6b82a4]">{patient.code}</td>
                  <td>
                    {patient.gender} · {patient.age} 岁
                  </td>
                  <td>{patient._count.sessions}</td>
                  <td className="text-right">
                    <Link
                      href={`/doctor/patients/${patient.id}`}
                      className="ui-button ui-button-secondary ui-button-sm"
                    >
                      详情 / 发起评估
                      <IconArrowRight size={15} aria-hidden="true" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
