/**
 * INPUT:  JSON { emrText: string }
 * OUTPUT: { scaleIds, reason, method }
 * POS:    M10.2 病历智能评估 API；医生端粘贴病历后推荐量表。
 */
import { z } from "zod";
import { suggestScalesFromEmr } from "@/lib/assessment/emr-scale-suggest";

const bodySchema = z.object({
  emrText: z.string().min(1).max(20_000),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体不是有效 JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "病历文本无效" }, { status: 400 });
  }
  try {
    const result = await suggestScalesFromEmr(parsed.data.emrText);
    return Response.json(result);
  } catch (error) {
    console.error("病历智能推荐失败：", error);
    return Response.json({ error: "推荐失败" }, { status: 500 });
  }
}
