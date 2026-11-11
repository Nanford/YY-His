/**
 * INPUT:  医生端子页面
 * OUTPUT: 医生端统一工作台布局（侧边导航、信息安全提示与内容区）
 * POS:    医生端外壳；Demo 阶段无登录鉴权（本地演示），正式版需在此加入认证。
 *         2026-11-11 侧栏品牌改为 logo +「岐颐智护 / 医生工作台」，顶栏左侧显示系统中文全称。
 */
import Link from "next/link";
import { House, ShieldCheck, UsersRound } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { BRAND } from "@/lib/brand";
import "../assessment-design.css";

export default function DoctorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="doctor-shell care-shell">
      <aside className="doctor-sidebar">
        <Link href="/doctor" className="doctor-brand" aria-label="返回医生工作台首页">
          <BrandLogo size={40} className="shrink-0" />
          <span>
            <span className="doctor-brand-title block">{BRAND.name}</span>
            <span className="doctor-brand-subtitle block">医生工作台</span>
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
          <span className="hidden text-sm font-semibold text-muted-foreground sm:inline">{BRAND.fullNameZh}</span>
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
