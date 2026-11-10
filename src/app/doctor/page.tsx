/**
 * INPUT: 患者档案、评估会话和待审核数量
 * OUTPUT: 医生工作台的档案总览与评估入口
 * POS: 医生端首页，列表为发起评估的主要入口。
 */
import Link from "next/link";
import { ArrowUpRight, ClipboardCheck, ClipboardList, FolderOpen, Plus, UsersRound } from "lucide-react";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function DoctorHomePage() {
  const [patients, pendingReview] = await Promise.all([
    prisma.patient.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, code: true, gender: true, age: true, _count: { select: { sessions: true } } },
    }),
    prisma.assessmentSession.count({ where: { status: "collected" } }),
  ]);
  const metrics = [
    { label: "已建档患者", value: patients.length, icon: UsersRound },
    {
      label: "累计评估会话",
      value: patients.reduce((total, patient) => total + patient._count.sessions, 0),
      icon: ClipboardList,
    },
    { label: "待审核干预方案", value: pendingReview, icon: ClipboardCheck },
  ];

  return (
    <div className="app-page space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="page-title">患者管理</h1>
        <Button asChild className="min-h-11 gap-2 px-4 font-semibold">
          <Link href="/doctor/patients/new">
            <Plus aria-hidden="true" />
            新建患者档案
          </Link>
        </Button>
      </header>

      <div className="doctor-metrics grid grid-cols-3">
        {metrics.map(({ label, value, icon: Icon }) => (
          <Card key={label} className="gap-0 rounded-none bg-transparent p-2.5 ring-0 sm:p-5">
            <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-primary sm:size-11 sm:rounded-xl">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <dl>
                <dt className="text-xs font-medium text-muted-foreground sm:text-sm">{label}</dt>
                <dd className="mt-1 text-2xl leading-none font-bold tabular-nums sm:text-3xl">{value}</dd>
              </dl>
            </div>
          </Card>
        ))}
      </div>

      <Card className="gap-0 p-0 ring-border" aria-labelledby="patient-list-title">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
          <h2 id="patient-list-title" className="text-base font-bold">患者档案</h2>
          <Badge variant="secondary" className="px-2.5">共 {patients.length} 位</Badge>
        </div>
        {patients.length === 0 ? (
          <div className="grid justify-items-center gap-3 px-5 py-16 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-muted text-primary">
              <FolderOpen className="size-6" aria-hidden="true" />
            </span>
            <p className="font-semibold">暂无患者档案</p>
            <p className="text-sm text-muted-foreground">建档后可在患者详情中发起评估。</p>
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-muted/60">
              <TableRow>
                <TableHead className="pl-4 sm:pl-6">姓名</TableHead>
                <TableHead className="hidden md:table-cell">档案编号</TableHead>
                <TableHead className="hidden md:table-cell">性别 / 年龄</TableHead>
                <TableHead className="hidden md:table-cell">评估次数</TableHead>
                <TableHead className="pr-4 text-right sm:pr-6">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {patients.map((patient) => (
                <TableRow key={patient.id} className="h-16">
                  <TableCell className="pl-4 font-semibold whitespace-normal break-words sm:pl-6">
                    {patient.name}
                    <span className="mt-1 block text-xs font-normal text-muted-foreground md:hidden">
                      {patient.gender} · {patient.age} 岁 · 评估 {patient._count.sessions} 次
                    </span>
                    <span className="mt-0.5 block font-mono text-xs font-normal text-muted-foreground md:hidden">
                      {patient.code}
                    </span>
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">{patient.code}</TableCell>
                  <TableCell className="hidden md:table-cell">{patient.gender} · {patient.age} 岁</TableCell>
                  <TableCell className="hidden tabular-nums md:table-cell">{patient._count.sessions}</TableCell>
                  <TableCell className="pr-3 text-right sm:pr-5">
                    <Button variant="ghost" asChild className="min-h-9 gap-2 text-primary">
                      <Link href={`/doctor/patients/${patient.id}`}>
                        查看详情 <ArrowUpRight aria-hidden="true" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
