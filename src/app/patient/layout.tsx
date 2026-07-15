/**
 * INPUT:  患者端子页面
 * OUTPUT: 患者端蓝白大屏布局（统一品牌、返回入口与适老化阅读基调）
 * POS:    患者端所有页面共用的精准照护工作台外壳；保留清晰服务入口，
 *         同时以大字号、充足留白和高对比度支撑自助评估与问询流程。
 */
import Link from "next/link";
import { IconArrowLeft, IconHeartRateMonitor } from "@tabler/icons-react";

export default function PatientLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="patient-shell flex min-h-screen flex-col">
      <header className="border-b border-blue-100 bg-white/90 backdrop-blur">
        <div className="patient-topbar">
          <Link href="/patient" className="patient-brand" aria-label="返回患者评估首页">
            <span className="doctor-brand-mark" aria-hidden="true">
              <IconHeartRateMonitor size={23} stroke={2.1} />
            </span>
            <span>
              <span className="block leading-tight">健康评估服务</span>
              <span className="mt-0.5 block text-xs font-semibold tracking-[0.08em] text-[#7891b5]">
                精准照护工作台
              </span>
            </span>
          </Link>
          <Link href="/" className="ui-button ui-button-quiet shrink-0">
            <IconArrowLeft size={19} stroke={2} aria-hidden="true" />
            返回服务入口
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
