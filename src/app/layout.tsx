/**
 * INPUT:  全站子页面
 * OUTPUT: 中文语言环境、系统字体栈与全局蓝白基础容器
 * POS:    App Router 根布局；不依赖外网字体，避免演示现场因网络导致版式漂移
 */
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "岐颐智护 TCM-CARE",
  description: "中西医结合老年综合评估与个体化干预智能辅助系统",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning：仅消除浏览器扩展（如沉浸式翻译注入
    // data-immersive-translate-page-theme）改写 <html> 属性导致的水合告警；
    // 只作用于 <html> 自身属性，不掩盖子树内任何真实水合不一致。
    <html lang="zh-CN" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
