/**
 * INPUT:  医生端子页面
 * OUTPUT: 医生端统一布局（顶栏导航）
 * POS:    医生端外壳。Demo 阶段无登录鉴权（本地演示），正式版需在此加认证。
 */
import Link from "next/link";

export default function DoctorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex flex-col">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/doctor" className="font-semibold text-lg">
            🩺 医生工作台
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/doctor" className="text-slate-600 hover:text-blue-600">
              患者管理
            </Link>
            <Link href="/" className="text-slate-400 hover:text-blue-600">
              返回首页
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
