/**
 * INPUT:  路由参数 id（评估会话）
 * OUTPUT: GET —— 患者端问询当前状态（阶段/当前题/能力开关/进度）
 * POS:    患者端大屏的状态查询接口（只读，不写轮次）。
 */
import { DialogueConflictError, getPatientDialogueState } from "@/lib/dialogue/service";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/patient/sessions/[id]/state">
): Promise<Response> {
  const { id } = await context.params;
  try {
    const state = await getPatientDialogueState(id);
    return Response.json(state);
  } catch (error) {
    if (error instanceof DialogueConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    console.error("查询问询状态失败：", error);
    return Response.json({ error: "查询问询状态失败" }, { status: 500 });
  }
}
