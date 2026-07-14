/**
 * INPUT:  路由参数 id、JSON 请求体（题目 id/输入模式/回答文本或按钮分值/录音路径）
 * OUTPUT: POST —— 提交患者回答，返回处理结论与下一步状态
 * POS:    患者端四种输入模式（语音确认/语音直答/文字/按钮）的统一提交入口。
 *         Route Handler 是不可信入口：请求体经 zod 校验，业务校验在 service 层。
 */
import { z } from "zod";
import { DialogueConflictError, submitPatientAnswer } from "@/lib/dialogue/service";

const answerSchema = z.object({
  questionId: z.string().min(1).max(64),
  mode: z.enum(["voice", "text", "button"]),
  utterance: z.string().max(2000).optional(),
  score: z.number().int().min(0).max(5).optional(),
  audioPath: z.string().max(300).optional(),
  asrRaw: z.unknown().optional(),
});

export async function POST(
  request: Request,
  context: RouteContext<"/api/patient/sessions/[id]/answer">
): Promise<Response> {
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体不是有效 JSON" }, { status: 400 });
  }
  const parsed = answerSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "请求参数无效" }, { status: 400 });
  }
  // 录音路径只允许指向本会话的录音目录，防止任意路径注入
  if (parsed.data.audioPath && !parsed.data.audioPath.startsWith(`audio-cache/recordings/${id}/`)) {
    return Response.json({ error: "录音路径无效" }, { status: 400 });
  }

  try {
    const result = await submitPatientAnswer(id, parsed.data);
    return Response.json(result);
  } catch (error) {
    if (error instanceof DialogueConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    console.error("提交回答失败：", error);
    return Response.json({ error: "提交回答失败" }, { status: 500 });
  }
}
