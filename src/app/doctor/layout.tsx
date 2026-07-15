/**
 * INPUT:  医生端子页面
 * OUTPUT: 医生端统一工作台布局（侧边导航、信息安全提示与内容区）
 * POS:    医生端外壳；Demo 阶段无登录鉴权（本地演示），正式版需在此加入认证。
 */
import Link from "next/link";
import {
  IconActivityHeartbeat,
  IconHome2,
  IconShieldCheck,
  IconStethoscope,
  IconUsers,
} from "@tabler/icons-react";

export default function DoctorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="doctor-shell">
      <aside className="doctor-sidebar">
        <Link href="/doctor" className="doctor-brand" aria-label="返回医生工作台首页">
          <span className="doctor-brand-mark" aria-hidden="true">
            <IconActivityHeartbeat size={22} stroke={2.15} />
          </span>
          <span>
            <span className="doctor-brand-title block">精准照护工作台</span>
            <span className="doctor-brand-subtitle block">老年健康智能评估</span>
          </span>
        </Link>

        <nav className="doctor-nav" aria-label="医生端主导航">
          <Link href="/doctor" className="doctor-nav-link doctor-nav-link-active">
            <IconUsers size={19} stroke={1.9} aria-hidden="true" />
            患者管理
          </Link>
          <Link href="/" className="doctor-nav-link">
            <IconHome2 size={19} stroke={1.9} aria-hidden="true" />
            系统入口
          </Link>
        </nav>

        <div className="doctor-sidebar-footer">
          <span className="doctor-sidebar-footer-label">数据安全策略</span>
          <span className="flex items-center gap-2 text-sm font-bold text-[#1769e8]">
            <IconShieldCheck size={18} stroke={2} aria-hidden="true" />
            PII 本地化存储
          </span>
          <span className="text-xs leading-5 text-[#62779a]">评估信息全程留痕，可逐级追溯。</span>
        </div>
      </aside>

      <section className="doctor-content">
        <header className="doctor-topbar">
          <div className="doctor-topbar-note">
            <IconShieldCheck size={17} stroke={2} aria-hidden="true" />
            患者身份信息仅保存在本地数据库，云端调用只使用患者唯一编号。
          </div>
          <div className="doctor-topbar-actions">
            <div className="doctor-user" aria-label="当前为医生工作台演示模式">
              <span className="doctor-user-avatar" aria-hidden="true">
                <IconStethoscope size={18} stroke={2} />
              </span>
              <span>
                <strong className="block text-[#29486f]">医生工作台</strong>
                <span>本地演示模式</span>
              </span>
            </div>
          </div>
        </header>
        <main>{children}</main>
      </section>
    </div>
  );
}
