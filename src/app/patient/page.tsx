/**
 * INPUT:  Prisma（采集中的评估会话列表）
 * OUTPUT: 患者端入口页：新患者自助建档，或从列表选择已有评估会话继续
 * POS:    演示动线：患者可自助建档直接开始评估（/patient/register），
 *         也可以选择医生已创建好的会话继续未完成的问询。
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
        <p className="text-slate-400 text-lg">第一次来？自己建个档案就能开始；已经建过档的请在下面选择您的会话</p>
      </div>

      <Link
        href="/patient/register"
        className="rounded-3xl bg-emerald-600 hover:bg-emerald-500 text-white text-2xl font-bold px-12 py-6 shadow-xl transition"
      >
        + 我是新患者，开始建档
      </Link>

      {sessions.length === 0 ? (
        <p className="text-slate-400 text-xl mt-6">当前没有进行中的评估，点击上方按钮建档即可开始。</p>
      ) : (
        <div className="w-full max-w-3xl space-y-4">
          <h2 className="text-slate-400 text-lg text-center">或继续已有的评估会话</h2>
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
