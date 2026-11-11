/**
 * INPUT: 无（静态服务入口）
 * OUTPUT: 患者评估入口与医生工作台
 * POS: 首页仅提供两个入口，患者流程在 /patient/flow 展示。
 *      2026-11-11 视觉改为蓝白淡渐变（care-home*，见 assessment-design.css），去掉深藏青主视觉。
 */
import Link from "next/link";
import { ArrowRight, HeartHandshake, HeartPulse, Stethoscope } from "lucide-react";
import * as motion from "motion/react-client";
import "./assessment-design.css";

const entrances = [
  { href: "/patient/flow", icon: HeartHandshake, label: "用户评估入口", primary: true },
  { href: "/doctor", icon: Stethoscope, label: "医生工作台", primary: false },
];

export default function HomePage() {
  return (
    // care-shell 提供与患者端/医生端一致的配色令牌；首页不经过子布局，故在此单独挂载
    <main className="care-shell care-home">
      <div className="care-home-panel">
        <div className="care-home-hero">
          <svg viewBox="0 0 480 350" className="care-home-art" fill="none" aria-hidden="true">
            <circle cx="335" cy="232" r="110" stroke="currentColor" opacity=".12" />
            <circle cx="335" cy="232" r="143" stroke="currentColor" opacity=".08" />
            <circle cx="335" cy="232" r="176" stroke="currentColor" opacity=".06" />
            <path d="M0 232h156l22-30 20 30h39l37-69 34 130 32-61h140" stroke="currentColor" strokeWidth="1.6" opacity=".35" />
            <circle cx="335" cy="232" r="5" fill="currentColor" opacity=".5" />
          </svg>
          <span className="care-icon-chip" aria-hidden="true">
            <HeartPulse />
          </span>
          <h1>
            老年健康智能<br className="hidden md:block" />评估与干预
          </h1>
        </div>

        <motion.nav
          aria-label="服务入口"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.24 }}
          className="care-home-nav motion-reduce:opacity-100!"
        >
          {entrances.map(({ href, icon: Icon, label, primary }) => (
            <Link key={href} href={href} className="care-card care-card-link care-home-entry" data-primary={primary || undefined}>
              <span className="care-icon-chip" aria-hidden="true">
                <Icon />
              </span>
              <span className="care-card-title">{label}</span>
              <ArrowRight aria-hidden="true" />
            </Link>
          ))}
        </motion.nav>
      </div>
    </main>
  );
}
