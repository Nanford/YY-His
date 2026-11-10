/**
 * INPUT:  医生端子页面
 * OUTPUT: 医生端统一工作台布局（侧边导航、信息安全提示与内容区）
 * POS:    医生端外壳；Demo 阶段无登录鉴权（本地演示），正式版需在此加入认证。
 */
import Link from "next/link";
import { HeartPulse, House, ShieldCheck, UsersRound } from "lucide-react";

export default function DoctorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="doctor-shell">
      <aside className="doctor-sidebar">
        <Link href="/doctor" className="doctor-brand" aria-label="返回医生工作台首页">
          <span className="doctor-brand-mark" aria-hidden="true">
            <HeartPulse size={22} />
          </span>
          <span>
            <span className="doctor-brand-title block">医生工作台</span>
            <span className="doctor-brand-subtitle block">老年健康评估</span>
          </span>
        </Link>

        <nav className="doctor-nav" aria-label="医生端主导航">
          <Link href="/doctor" className="doctor-nav-link doctor-nav-link-active">
            <UsersRound size={19} aria-hidden="true" />
            患者管理
          </Link>
          <Link href="/" className="doctor-nav-link">
            <House size={19} strokeWidth={1.9} aria-hidden="true" />
            系统入口
          </Link>
        </nav>

      </aside>

      <section className="doctor-content">
        <header className="doctor-topbar">
          <span className="hidden text-sm font-semibold text-muted-foreground sm:inline">老年健康评估与干预</span>
          <div className="doctor-topbar-note">
            <ShieldCheck size={16} aria-hidden="true" />
            身份信息仅保存在本机
          </div>
        </header>
        <main>{children}</main>
      </section>
    </div>
  );
}
