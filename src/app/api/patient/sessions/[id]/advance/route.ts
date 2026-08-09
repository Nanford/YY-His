/**
 * INPUT:  路由参数 id（评估会话）
 * OUTPUT: POST —— 旁白播报完成后的推进（写 system 轮次标记已播报，返回下一旁白/下一题/收尾，幂等）
 * POS:    M9.2 采集编排（总开场/分类过渡/工具说明）的患者端推进入口：旁白只播报不需作答，
 *         前端播完自动调本路由；旁白轮次只在这里写入，保证一条旁白恰好落库一次。
 */
import { DialogueConflictError, advancePatientNarration } from "@/lib/dialogue/service";

export async function POST(
  request: Request,
  context: RouteContext<"/api/patient/sessions/[id]/advance">
): Promise<Response> {
  const { id } = await context.params;
  try {
    const body = (await request.json().catch(() => null)) as { stepId?: unknown } | null;
    if (typeof body?.stepId !== "string" || body.stepId.length < 1 || body.stepId.length > 128) {
      return Response.json({ error: "播报步骤参数无效" }, { status: 400 });
    }
    const state = await advancePatientNarration(id, body.stepId);
    return Response.json(state);
  } catch (error) {
    if (error instanceof DialogueConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    console.error("旁白推进失败：", error);
    return Response.json({ error: "旁白推进失败" }, { status: 500 });
  }
}
