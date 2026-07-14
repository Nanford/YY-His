/**
 * INPUT:  患者端子页面
 * OUTPUT: 患者端大屏布局（深色、全屏、大字体基调）
 * POS:    患者端与医生端视觉分界：大屏演示用深色高对比主题，无导航干扰。
 */
export default function PatientLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-slate-900 via-slate-900 to-slate-800 text-slate-100">
      {children}
    </div>
  );
}
