/**
 * INPUT:  全站子页面
 * OUTPUT: 根布局（中文语言环境、系统字体栈）
 * POS:    全局布局。不用 Google Fonts——演示现场网络不可控，系统字体对中文更稳。
 */
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "老年健康智能评估与干预系统 Demo",
  description: "智能化健康信息采集、标准化评估与个体化干预方案推荐",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
