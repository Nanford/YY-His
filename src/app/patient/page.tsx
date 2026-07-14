/**
 * INPUT:  Prisma（采集中的评估会话列表）
 * OUTPUT: 患者端入口页：选择要进入的评估会话
 * POS:    演示动线：医生创建会话后，大屏在此选择患者进入问询。
 */
import Link from "next/link";
import { prisma } from "@/lib/db";
import { scaleById } from "@/lib/rules";

export const dynamic = "force-dynamic";

export default async function PatientHomePage() {
  const sessions = await prisma.assessmentSession.findMany({
    where: { status: "in_progress" },
    include: { patient: { select: { name: true, gender: true, age: true, code: true } } },
    orderBy: { startedAt: "desc" },
    take: 20,
  });

  return (
    <main className="flex-1 flex flex-col items-center px-6 py-10 gap-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl md:text-4xl font-bold">患者评估大屏</h1>
        <p className="text-slate-400 text-lg">请选择您的评估会话，或请医生协助选择</p>
      </div>

      {sessions.length === 0 ? (
        <p className="text-slate-400 text-xl mt-10">
          当前没有进行中的评估。请医生先在医生工作台创建评估会话。
        </p>
      ) : (
        <div className="w-full max-w-3xl grid gap-4">
          {sessions.map((session) => {
            const scaleNames = (session.scaleIds as string[])
              .map((scaleId) => scaleById.get(scaleId)?.name ?? scaleId)
              .join("、");
            return (
              <Link
                key={session.id}
                href={`/patient/sessions/${session.id}`}
                className="rounded-2xl bg-slate-800/80 border border-slate-700 hover:border-sky-400 transition px-6 py-5 flex items-center justify-between"
              >
                <div>
                  <div className="text-2xl font-semibold">
                    {session.patient.name}
                    <span className="ml-3 text-slate-400 text-lg">
                      {session.patient.gender} · {session.patient.age} 岁
                    </span>
                  </div>
                  <div className="text-slate-400 mt-1">
                    <span className="font-mono mr-3">{session.patient.code}</span>
                    {scaleNames}
                  </div>
                </div>
                <span className="text-sky-300 text-xl">进入 →</span>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
