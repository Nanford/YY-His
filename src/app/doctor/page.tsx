/**
 * INPUT:  Prisma（患者列表及会话计数）
 * OUTPUT: 患者管理列表页
 * POS:    医生端首页。展示全部患者，入口：新建患者、患者详情。
 */
import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic"; // 本地数据库实时读取，禁用静态化

export default async function DoctorHomePage() {
  const patients = await prisma.patient.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { sessions: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">患者管理</h1>
        <Link
          href="/doctor/patients/new"
          className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700"
        >
          ＋ 新建患者
        </Link>
      </div>

      {patients.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-400">
          暂无患者，点击右上角「新建患者」开始
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">患者编号</th>
                <th className="px-4 py-3 font-medium">姓名</th>
                <th className="px-4 py-3 font-medium">性别</th>
                <th className="px-4 py-3 font-medium">年龄</th>
                <th className="px-4 py-3 font-medium">评估次数</th>
                <th className="px-4 py-3 font-medium">建档时间</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{p.code}</td>
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3">{p.gender}</td>
                  <td className="px-4 py-3">{p.age}</td>
                  <td className="px-4 py-3">{p._count.sessions}</td>
                  <td className="px-4 py-3 text-slate-500">{p.createdAt.toLocaleDateString("zh-CN")}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/doctor/patients/${p.id}`} className="text-blue-600 hover:underline">
                      详情 →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
