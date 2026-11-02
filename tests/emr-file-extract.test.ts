/**
 * INPUT:  emr-file-extract 提取函数、V2/ 只读源文件（docx 实体）、内存构造的 xlsx
 * OUTPUT: docx/xlsx 文本提取用例
 * POS:    病历智能评估「上传文件」服务端提取的纯逻辑把关（不起服务、不出网）。
 */
import * as fs from "node:fs";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { extractDocxText, extractXlsxText } from "@/lib/assessment/emr-file-extract";

describe("extractDocxText", () => {
  it("从 V2 更新说明 docx 提取出正文段落（按行拼接、剔除空段）", () => {
    const buf = fs.readFileSync("V2/Demo_v2更新说明.docx");
    const text = extractDocxText(buf);
    expect(text.length).toBeGreaterThan(100);
    expect(text).toContain("量表");
    // 段落按换行拼接，不应残留 XML 标签
    expect(text).not.toContain("<w:");
  });

  it("非 ZIP 内容抛错（损坏文件兜底）", () => {
    expect(() => extractDocxText(Buffer.from("not a zip file"))).toThrow();
  });
});

describe("extractXlsxText", () => {
  it("逐 sheet 逐行拼接非空单元格", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["姓名", "诊断"],
        ["张某某", "高血压"],
        ["", ""],
        ["李某", null],
      ]),
      "病历"
    );
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const text = extractXlsxText(buf);
    expect(text).toContain("姓名 诊断");
    expect(text).toContain("张某某 高血压");
    expect(text).toContain("李某");
    // 全空行不产生空行
    expect(text.split("\n").every((line) => line.trim() !== "")).toBe(true);
  });
});
