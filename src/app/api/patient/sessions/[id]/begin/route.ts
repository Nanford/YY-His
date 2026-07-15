/**
 * INPUT:  路由参数 id（评估会话）
 * OUTPUT: POST —— 讲解确认后进入第一题（写第一题提问轮次，幂等）
 * POS:    患者端 intro 阶段"患者说'开始'/点开始"后的入口；与 /start 分离，
 *         让"数字医生讲解 → 患者确认 → 才进入量表"成为独立一步。
 */
import { DialogueConflictError, beginPatientQuestions } from "@/lib/dialogue/service";

export async function POST(
  _request: Request,
  context: RouteContext<"/api/patient/sessions/[id]/begin">
): Promise<Response> {
  const { id } = await context.params;
  try {
    const state = await beginPatientQuestions(id);
    return Response.json(state);
  } catch (error) {
    if (error instanceof DialogueConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    console.error("进入第一题失败：", error);
    return Response.json({ error: "开始问询失败" }, { status: 500 });
  }
}
