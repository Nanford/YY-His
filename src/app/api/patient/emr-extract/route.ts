/**
 * INPUT:  multipart/form-data（file 字段：.docx / .xlsx / .xls，≤10MB）
 * OUTPUT: { text } —— 提取的病历纯文本（截断至 8000 字符）
 * POS:    病历智能评估「上传文件」服务端提取（2026-08-08）。全程本机处理、不出网；
 *         文本回前端病历框后，「智能解析」仍走既有脱敏链路（硬约束 1 不变）。
 *         txt/md 前端直读、PDF/图片前端本地解析，不经过本路由。
 */
import { extractDocxText, extractXlsxText } from "@/lib/assessment/emr-file-extract";

const MAX_FILE_SIZE = 30 * 1024 * 1024;
const MAX_TEXT_LENGTH = 8000;

export async function POST(request: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "请求体不是有效的表单" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "缺少上传文件" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return Response.json({ error: "文件超过 30MB，请换更小的文件" }, { status: 413 });
  }
  const name = (file.name || "").toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());
  try {
    let text: string;
    if (name.endsWith(".docx")) {
      text = extractDocxText(buf);
    } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      text = extractXlsxText(buf);
    } else {
      return Response.json({ error: "仅支持 docx / xlsx / xls 文件（文本、PDF、图片也可直接上传）" }, { status: 415 });
    }
    if (!text.trim()) {
      return Response.json({ error: "没有从文件里读到文字内容" }, { status: 422 });
    }
    return Response.json({ text: text.slice(0, MAX_TEXT_LENGTH) });
  } catch (error) {
    console.error("病历文件提取失败：", error);
    return Response.json({ error: "文件解析失败，请确认文件未损坏" }, { status: 500 });
  }
}
