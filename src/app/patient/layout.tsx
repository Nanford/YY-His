/**
 * INPUT:  患者端子页面
 * OUTPUT: 患者端蓝白大屏布局（统一品牌、返回入口与适老化阅读基调）
 * POS:    患者端所有页面共用的精准照护工作台外壳；保留清晰服务入口，
 *         同时以大字号、充足留白和高对比度支撑自助评估与问询流程。
 *         2026-11-11 顶栏品牌改为「岐颐智护 | TCM-CARE」+ 用户提供的 logo（原「健康评估服务」）。
 */
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import "../assessment-design.css";

export default function PatientLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="patient-shell care-shell flex min-h-screen flex-col">
      <header className="border-b border-border bg-card">
        <div className="patient-topbar">
          <Link href="/patient" className="patient-brand care-brand" aria-label={`${BRAND.name}，返回患者评估首页`}>
            <BrandLogo size={40} />
            <b className="care-brand-name">{BRAND.name}</b>
            <small className="care-brand-code">{BRAND.code}</small>
          </Link>
          <Button variant="ghost" asChild className="min-h-11 gap-1.5 px-2 sm:px-3">
            <Link href="/">
              <ArrowLeft aria-hidden="true" />
              返回服务入口
            </Link>
          </Button>
        </div>
      </header>
      {children}
    </div>
  );
}
