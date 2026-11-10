/**
 * INPUT: 无（静态服务入口）
 * OUTPUT: 患者评估入口与医生工作台
 * POS: 首页仅提供两个入口，患者流程在 /patient/flow 展示。
 */
import Link from "next/link";
import { ArrowRight, HeartHandshake, HeartPulse, Stethoscope } from "lucide-react";
import * as motion from "motion/react-client";

const entrances = [
  { href: "/patient/flow", icon: HeartHandshake, label: "用户评估入口", primary: true },
  { href: "/doctor", icon: Stethoscope, label: "医生工作台", primary: false },
];

export default function HomePage() {
  return (
    <main className="grid flex-1 place-items-center bg-background px-5 py-10 sm:px-8">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl bg-card shadow-xl shadow-blue-950/5 ring-1 ring-border md:grid-cols-[1.07fr_1fr]">
        <div className="relative isolate flex min-h-64 flex-col justify-between overflow-hidden bg-[#0e3269] p-7 text-white sm:p-10 md:min-h-[28rem] md:p-12">
          <svg viewBox="0 0 480 350" className="pointer-events-none absolute right-[-5rem] bottom-[-3rem] -z-10 w-[min(100%,32rem)] text-blue-200" fill="none" aria-hidden="true">
            <circle cx="335" cy="232" r="110" stroke="currentColor" opacity=".24" />
            <circle cx="335" cy="232" r="143" stroke="currentColor" opacity=".16" />
            <circle cx="335" cy="232" r="176" stroke="currentColor" opacity=".12" />
            <path d="M0 232h156l22-30 20 30h39l37-69 34 130 32-61h140" stroke="currentColor" strokeWidth="2" opacity=".65" />
            <circle cx="335" cy="232" r="5" fill="currentColor" />
          </svg>
          <span className="grid size-14 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/25" aria-hidden="true">
            <HeartPulse className="size-7" />
          </span>
          <h1 className="max-w-[12em] text-3xl leading-snug font-bold sm:text-4xl md:text-[2.75rem]">
            老年健康智能<br className="hidden md:block" />评估与干预
          </h1>
        </div>

        <motion.nav
          aria-label="服务入口"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.24 }}
          className="flex flex-col justify-center gap-4 p-6 motion-reduce:opacity-100! sm:p-10"
        >
          {entrances.map(({ href, icon: Icon, label, primary }) => (
            <Link
              key={href}
              href={href}
              className={`group flex min-h-24 items-center gap-4 rounded-2xl border p-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring sm:p-5 ${
                primary
                  ? "border-primary bg-primary text-white hover:bg-[#1158c0]"
                  : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-accent/40"
              }`}
            >
              <span className={`grid size-12 shrink-0 place-items-center rounded-xl ${primary ? "bg-white/15" : "bg-accent text-primary"}`}>
                <Icon className="size-6" aria-hidden="true" />
              </span>
              <span className="flex-1 text-lg font-bold sm:text-xl">{label}</span>
              <ArrowRight className="size-5 shrink-0" aria-hidden="true" />
            </Link>
          ))}
        </motion.nav>
      </div>
    </main>
  );
}
