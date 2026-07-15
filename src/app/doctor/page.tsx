/**
 * INPUT:  Prisma（患者列表及会话计数）
 * OUTPUT: 患者管理列表页
 * POS:    医生端首页。展示全部患者，入口：新建患者、患者详情。
 */
import Link from "next/link";
import {
  IconArrowRight,
  IconClipboardText,
  IconPlus,
  IconUsersGroup,
} from "@tabler/icons-react";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic"; // 本地数据库实时读取，禁用静态化

export default async function DoctorHomePage() {
  const patients = await prisma.patient.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { sessions: true } } },
  });
  const assessmentCount = patients.reduce((total, patient) => total + patient._count.sessions, 0);

  return (
    <div className="app-page space-y-6 u-stagger">
      <div className="page-heading">
        <div className="page-heading-copy">
          <p className="page-eyebrow">PATIENT CARE DESK</p>
          <h1 className="page-title">患者管理</h1>
          <p className="page-description">集中管理患者档案、评估进度与后续照护记录。</p>
        </div>
        <Link href="/doctor/patients/new" className="ui-button ui-button-primary ui-button-lg">
          <IconPlus size={19} stroke={2.2} aria-hidden="true" />
          新建患者
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="ui-panel-subtle flex items-center gap-4 px-5 py-4">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-blue-600 shadow-[0_5px_14px_rgba(33,87,160,0.08)]">
            <IconUsersGroup size={23} stroke={1.9} aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-bold text-[#405a81]">已建档患者</p>
            <p className="mt-0.5 text-2xl font-extrabold tracking-[-0.03em] text-[#102a56]">{patients.length}</p>
          </div>
        </div>
        <div className="ui-panel-subtle flex items-center gap-4 px-5 py-4">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-blue-600 shadow-[0_5px_14px_rgba(33,87,160,0.08)]">
            <IconClipboardText size={23} stroke={1.9} aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-bold text-[#405a81]">累计评估会话</p>
            <p className="mt-0.5 text-2xl font-extrabold tracking-[-0.03em] text-[#102a56]">{assessmentCount}</p>
          </div>
        </div>
      </div>

      {patients.length === 0 ? (
        <section className="ui-panel px-6 py-14 text-center sm:px-10">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-blue-50 text-blue-600">
            <IconUsersGroup size={31} stroke={1.75} aria-hidden="true" />
          </span>
          <h2 className="mt-5 text-lg font-extrabold text-[#173766]">暂无患者档案</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#62779a]">建立患者档案后，即可发起标准化健康评估与干预方案审核。</p>
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
              <p className="mt-1 text-xs text-[#62779a]">按建档时间由近及远排列</p>
            </div>
            <span className="ui-badge">共 {patients.length} 位</span>
          </div>
          <table className="ui-table">
            <thead>
              <tr>
                <th>患者编号</th>
                <th>姓名</th>
                <th>性别</th>
                <th>年龄</th>
                <th>评估次数</th>
                <th>建档时间</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {patients.map((patient) => (
                <tr key={patient.id}>
                  <td className="font-mono text-xs text-[#557198]">{patient.code}</td>
                  <td className="font-bold text-[#173766]">{patient.name}</td>
                  <td>{patient.gender}</td>
                  <td>{patient.age}</td>
                  <td>
                    <span className="ui-badge">{patient._count.sessions} 次评估</span>
                  </td>
                  <td className="text-[#62779a]">{patient.createdAt.toLocaleDateString("zh-CN")}</td>
                  <td className="text-right">
                    <Link href={`/doctor/patients/${patient.id}`} className="ui-button ui-button-quiet">
                      查看详情
                      <IconArrowRight size={17} stroke={2} aria-hidden="true" />
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
