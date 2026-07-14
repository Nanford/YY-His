/**
 * INPUT:  无
 * OUTPUT: 系统入口页（医生端 / 患者端大屏入口）
 * POS:    首页导航：医生工作台 + 患者评估大屏两个入口。
 */
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-10 p-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">老年健康智能评估与干预系统</h1>
        <p className="text-slate-500">智能化信息采集 · 标准化评估 · 个体化干预方案推荐（Demo）</p>
      </div>
      <div className="grid gap-6 sm:grid-cols-2 w-full max-w-2xl">
        <Link
          href="/doctor"
          className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm hover:shadow-md hover:border-blue-300 transition text-center space-y-2"
        >
          <div className="text-4xl">🩺</div>
          <div className="text-xl font-semibold">医生工作台</div>
          <p className="text-sm text-slate-500">患者录入 · 评估管理 · 干预方案审核</p>
        </Link>
        <Link
          href="/patient"
          className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm hover:shadow-md hover:border-blue-300 transition text-center space-y-2"
        >
          <div className="text-4xl">🗣️</div>
          <div className="text-xl font-semibold">患者评估大屏</div>
          <p className="text-sm text-slate-500">数字医生语音问询 · 大字体大按钮作答</p>
        </Link>
      </div>
    </main>
  );
}
