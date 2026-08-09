/**
 * INPUT:  上传的病历文件内容（docx / xlsx / xls，Buffer）
 * OUTPUT: 提取的纯文本（段落/单元格按行拼接）
 * POS:    病历智能评估「上传文件」的服务端提取层（2026-08-08）。全程本机处理、不出网；
 *         提取文本交给前端回填病历框，后续「智能解析」仍走既有脱敏链路（emr-scale-suggest）。
 *         docx 复用 scripts/read-docx.ts 的零依赖 ZIP 解析（改为 Buffer 输入）；
 *         xlsx 用项目既有 xlsx 依赖。txt/md 由前端直接读，PDF/图片由前端本地解析，不经过本层。
 */
import * as zlib from "node:zlib";
import * as XLSX from "xlsx";

/** 从 docx（ZIP 容器，Buffer）中取出 word/document.xml 原始 XML 文本 */
function readDocumentXmlFromBuffer(buf: Buffer): string {
  // 1) 从尾部回扫定位 EOCD（结尾中央目录记录），签名 0x06054b50
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("未找到 ZIP EOCD 记录，文件可能损坏");

  const cdCount = buf.readUInt16LE(eocd + 10); // 中央目录条目数
  let off = buf.readUInt32LE(eocd + 16); // 中央目录起始偏移

  // 2) 遍历中央目录，找到 word/document.xml 条目
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error("中央目录签名错误");
    const method = buf.readUInt16LE(off + 10); // 压缩方法：0=存储，8=deflate
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);

    if (name === "word/document.xml") {
      // 本地文件头的 name/extra 长度可能与中央目录不同，必须以本地头为准
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const comp = buf.subarray(dataStart, dataStart + compSize);
      const xml = method === 0 ? comp : zlib.inflateRawSync(comp);
      return xml.toString("utf8");
    }
    off += 46 + nameLen + extraLen + commLen;
  }
  throw new Error("ZIP 内未找到 word/document.xml");
}

/** 提取 docx 正文：每个 <w:p> 内的 <w:t> 拼接为一段，剔除空段后按行拼接 */
export function extractDocxText(buf: Buffer): string {
  const xml = readDocumentXmlFromBuffer(buf);
  return xml
    .split(/<w:p[ >]/)
    .map((p) =>
      Array.from(p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g))
        .map((m) => m[1])
        .join("")
        .trim()
    )
    .filter((t) => t.length > 0)
    .join("\n");
}

/** 提取 xlsx/xls 文本：逐 sheet 逐行把非空单元格用空格拼接，行按换行拼接 */
export function extractXlsxText(buf: Buffer): string {
  const workbook = XLSX.read(buf, { type: "buffer" });
  const lines: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
    });
    for (const row of rows) {
      const line = row.map((cell) => String(cell ?? "").trim()).filter(Boolean).join(" ");
      if (line) lines.push(line);
    }
  }
  return lines.join("\n");
}
