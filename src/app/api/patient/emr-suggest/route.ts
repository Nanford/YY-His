/**
 * INPUT:  JSON { emrText: string, patientId?: string }
 * OUTPUT: { scaleIds, reason, keywords, method }
 * POS:    患者端病历智能评估 API（2026-08-08 设计图·病历智能评估方式页）。
 *         与 /api/doctor/emr-suggest 同一引擎（suggestScalesFromEmr）；
 *         patientId 仅用于本地查档案姓名做病历值级脱敏（硬约束 1），不出网。
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { suggestScalesFromEmr } from "@/lib/assessment/emr-scale-suggest";

const bodySchema = z.object({
  emrText: z.string().min(1).max(20_000),
  patientId: z.string().min(1).optional(),
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
    // 病历自由文本常含患者姓名：取档案姓名交给 redactEmrText 做值级替换脱敏
    let patientName: string | undefined;
    if (parsed.data.patientId) {
      const patient = await prisma.patient.findUnique({
        where: { id: parsed.data.patientId },
        select: { name: true },
      });
      patientName = patient?.name;
    }
    const result = await suggestScalesFromEmr(parsed.data.emrText, patientName);
    return Response.json(result);
  } catch (error) {
    console.error("病历智能推荐失败：", error);
    return Response.json({ error: "推荐失败" }, { status: 500 });
  }
}
