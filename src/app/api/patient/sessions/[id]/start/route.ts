/**
 * INPUT:  路由参数 id（评估会话）
 * OUTPUT: POST —— 开始问询（写开场白与第一题提问轮次，幂等）
 * POS:    患者端"开始评估"按钮的入口；点击手势同时满足浏览器音频自动播放策略。
 */
import { DialogueConflictError, startPatientDialogue } from "@/lib/dialogue/service";

export async function POST(
  _request: Request,
  context: RouteContext<"/api/patient/sessions/[id]/start">
): Promise<Response> {
  const { id } = await context.params;
  try {
    const state = await startPatientDialogue(id);
    return Response.json(state);
  } catch (error) {
    if (error instanceof DialogueConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    console.error("开始问询失败：", error);
    return Response.json({ error: "开始问询失败" }, { status: 500 });
  }
}
