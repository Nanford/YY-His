"use client";

/**
 * INPUT:  下载文件名（不含扩展名，只含患者唯一编号，不含姓名）
 * OUTPUT: PrintReportButton —— 「下载报告」按钮：调起浏览器打印对话框，目标选「另存为 PDF」即得到 A4 报告文件
 * POS:    下载版报告的唯一交互点。零新增依赖的方案：版式由 globals.css 的 .report-doc 打印样式保证，
 *         浏览器生成的是矢量 PDF（文字可选可搜）。打印期间临时改 document.title，使另存的 PDF 默认文件名
 *         为「老年综合评估报告_编号」，结束后还原。
 *         临时方案说明：如需"一键直接落盘 PDF、不经过打印对话框"，替换路径是服务端无头浏览器出 PDF
 *         或前端 html2canvas+jsPDF（均需新增依赖，待用户拍板）。
 */
import { Download } from "lucide-react";

export function PrintReportButton({ fileName }: { fileName: string }) {
  const handleDownload = () => {
    const previousTitle = document.title;
    // afterprint 在对话框关闭（保存或取消）后触发；标题还原不依赖 print() 是否阻塞
    const restoreTitle = () => {
      document.title = previousTitle;
      window.removeEventListener("afterprint", restoreTitle);
    };
    window.addEventListener("afterprint", restoreTitle);
    document.title = fileName;
    window.print();
  };

  return (
    <button type="button" className="ui-button ui-button-primary" onClick={handleDownload}>
      <Download size={20} strokeWidth={2} aria-hidden="true" />
      下载报告（另存为 PDF）
    </button>
  );
}
