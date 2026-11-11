/**
 * INPUT: 无（静态服务入口）
 * OUTPUT: 患者评估入口与医生工作台
 * POS: 首页仅提供两个入口，患者流程在 /patient/flow 展示。
 *      2026-11-11 视觉改为蓝白淡渐变（care-home*，见 assessment-design.css），去掉深藏青主视觉。
 *      2026-11-11 主视觉改为品牌展示：logo + 岐颐智护 + TCM-CARE + 中文全称 + 英文全称（全站唯一出现英文全称处）。
 */
import Link from "next/link";
import { ArrowRight, HeartHandshake, Stethoscope } from "lucide-react";
import * as motion from "motion/react-client";
import { BrandLogo } from "@/components/brand-logo";
import { BRAND } from "@/lib/brand";
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
          <BrandLogo size={104} className="care-home-logo" />
          <div>
            <h1>{BRAND.name}</h1>
            <p className="care-home-code">{BRAND.code}</p>
            <p className="care-home-fullname">{BRAND.fullNameZh}</p>
            <p className="care-home-fullname-en" lang="en">{BRAND.fullNameEn}</p>
          </div>
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
