/**
 * INPUT:  医生追溯页的会话 id、对话轮次 id 与 Range 请求头
 * OUTPUT: GET —— 受会话与轮次归属保护的本地原始录音
 * POS:    路由只导出 Next.js 允许的处理器与配置；共享文件校验位于 assessment/doctor-audio.ts。
 */
export { getDoctorAudio as GET } from "@/lib/assessment/doctor-audio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
