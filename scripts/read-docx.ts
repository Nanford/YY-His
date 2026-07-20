/**
 * INPUT:  .docx 文件路径（docs/source/12种运动干预.docx 等只读医学源文件）
 * OUTPUT: 文档正文段落文本数组（按 <w:p> 段落切分，剔除空段）
 * POS:    转换脚本的 docx 读取工具。零第三方依赖：docx 本质是 ZIP，
 *         用 Node 内置 zlib 解 word/document.xml 后正则抽 <w:t> 文本，
 *         避免为一次性构建引入 jszip/mammoth 依赖。仅供 scripts/ 使用。
 */
import * as fs from "node:fs";
import * as zlib from "node:zlib";

/** 从 docx（ZIP 容器）中取出 word/document.xml 原始 XML 文本 */
function readDocumentXml(file: string): string {
  const buf = fs.readFileSync(file);

  // 1) 从尾部回扫定位 EOCD（结尾中央目录记录），签名 0x06054b50
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`${file}：未找到 ZIP EOCD 记录，文件可能损坏`);

  const cdCount = buf.readUInt16LE(eocd + 10); // 中央目录条目数
  let off = buf.readUInt32LE(eocd + 16); // 中央目录起始偏移

  // 2) 遍历中央目录，找到 word/document.xml 条目
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error(`${file}：中央目录签名错误`);
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
  throw new Error(`${file}：ZIP 内未找到 word/document.xml`);
}

/** 读取 docx 正文，返回非空段落文本数组（每个 <w:p> 内的 <w:t> 拼接为一段） */
export function readDocxParagraphs(file: string): string[] {
  const xml = readDocumentXml(file);
  return xml
    .split(/<w:p[ >]/)
    .map((p) =>
      Array.from(p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g))
        .map((m) => m[1])
        .join("")
        .trim()
    )
    .filter((t) => t.length > 0);
}
