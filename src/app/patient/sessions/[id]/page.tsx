/**
 * INPUT:  路由参数 id、Prisma（会话与患者展示信息）
 * OUTPUT: 患者端问询页（服务端外壳，渲染 InterviewScreen 客户端组件）
 * POS:    患者姓名等展示信息在本地服务端渲染注入，不经过任何第三方接口。
 */
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { InterviewScreen } from "./interview-screen";

export const dynamic = "force-dynamic";

export default async function PatientSessionPage({
  params,
}: PageProps<"/patient/sessions/[id]">) {
  const { id } = await params;
  const session = await prisma.assessmentSession.findUnique({
    where: { id },
    include: { patient: { select: { name: true, gender: true, age: true } } },
  });
  if (!session) notFound();

  const honorific = session.patient.gender === "女" ? "奶奶" : "爷爷";
  return (
    <InterviewScreen
      sessionId={session.id}
      patientLabel={`${session.patient.name}${honorific}（${session.patient.age} 岁）`}
    />
  );
}
