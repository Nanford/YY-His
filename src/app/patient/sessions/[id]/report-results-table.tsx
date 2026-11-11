/**
 * INPUT:  由报告规则派生的结果行
 * OUTPUT: 评估内容、结果、正常范围和提示四列表
 * POS:    屏幕预览和 A4 报告共用，异常与部分计分使用同一快照。
 */
import type { ReportRow } from "@/lib/assessment/report-rows";

export function ReportResultsTable({ rows, screen = false }: {
  rows: readonly ReportRow[];
  screen?: boolean;
}) {
  return (
    <table role={screen ? "table" : undefined} className={screen ? "report-doc-results report-results-screen" : "report-doc-results"}>
      <thead role={screen ? "rowgroup" : undefined}>
        <tr role={screen ? "row" : undefined}>
          <th scope="col" className="col-title">评估内容</th>
          <th scope="col" className="col-result">评估结果</th>
          <th scope="col" className="col-range">正常范围</th>
          <th scope="col" className="col-hint">提示</th>
        </tr>
      </thead>
      <tbody role={screen ? "rowgroup" : undefined}>
        {rows.map((row) => (
          <tr key={row.key} role={screen ? "row" : undefined}>
            <th scope="row" className="col-title">{row.no}. {row.title}</th>
            <td className="col-result">
              {screen && <span className="report-cell-label" aria-hidden="true">评估结果</span>}
              {row.resultText}
            </td>
            <td className="col-range">
              {screen && <span className="report-cell-label" aria-hidden="true">正常范围</span>}
              {row.normalRange}
            </td>
            <td className="col-hint">
              {screen && <span className="report-cell-label" aria-hidden="true">提示</span>}
              {row.hints.map((hint) => (
                <span key={hint.text} className={hint.abnormal ? "hint is-abnormal" : "hint"}>
                  {hint.abnormal && <span aria-label="需关注">▲ </span>}
                  <span>{hint.text}</span>
                </span>
              ))}
              {row.note && <span className="hint is-note">{row.note}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
