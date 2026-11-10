/**
 * INPUT:  身份条/基本情况（report-profile）、既存问题与结果表行（report-rows）、干预方案条目（候选或已确认）
 * OUTPUT: ReportDocument —— A4 版式的下载版评估报告（屏幕上是纸张预览，打印/另存 PDF 时即成品）
 * POS:    身份条 → 基本情况与评估概览 → 既存问题 → 综合评估结果四列表 → 干预建议。
 *         外层表格的 thead 使标题与身份条在 Chromium 打印分页时重复出现。
 */
import type { ReportField } from "@/lib/assessment/report-profile";
import type { ReportRow } from "@/lib/assessment/report-rows";
import { ReportResultsTable } from "../report-results-table";
import { ReportOverview } from "../report-overview";

/** 下载版报告里的一条干预建议（只列名称，正文与素材见系统报告页） */
export interface ReportPlanEntry {
  code: string;
  name: string;
  categoryLabel: string;
  /** 03 表 100 分强制优先推荐 */
  forced: boolean;
}

interface ReportDocumentProps {
  identityItems: readonly ReportField[];
  basicInfoRows: readonly ReportField[];
  problems: readonly string[];
  scaleCount: number;
  rows: readonly ReportRow[];
  /** 5 大类固定顺序（运动干预/膳食营养/中医食养/就诊建议/其他） */
  categoryOrder: readonly string[];
  planEntries: readonly ReportPlanEntry[];
  /** 干预方案是否已经医生确认 */
  planConfirmed: boolean;
}

export function ReportDocument({
  identityItems,
  basicInfoRows,
  problems,
  scaleCount,
  rows,
  categoryOrder,
  planEntries,
  planConfirmed,
}: ReportDocumentProps) {
  return (
    <table className="report-doc">
      <thead>
        <tr>
          <td className="report-doc-cell">
            <div className="report-doc-head">
              <h1>老年综合评估报告</h1>
              <span>老年健康评估与干预系统</span>
            </div>
            <dl className="report-doc-identity">
              {identityItems.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          </td>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="report-doc-cell">
            <div className="report-doc-overview">
              <section className="report-doc-section">
                <h2>基本情况</h2>
                <dl className="report-doc-basic">
                  {basicInfoRows.map((row) => (
                    <div key={row.label}>
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              <ReportOverview scaleCount={scaleCount} problemCount={problems.length} />
            </div>

            <section className="report-doc-section">
              <h2>既存问题</h2>
              {problems.length === 0 ? (
                // 不写"无异常"：是否没有问题以下方结果表逐项结论为准（全豁免量表不得被读成正常）
                <p className="report-doc-muted">本次评估未标出需重点关注的问题，各项结论见下表。</p>
              ) : (
                <ul className="report-doc-problems">
                  {problems.map((problem) => <li key={problem}>{problem}</li>)}
                </ul>
              )}
            </section>

            <section className="report-doc-section">
              <h2>综合评估结果</h2>
              <ReportResultsTable rows={rows} />
            </section>

            <section className="report-doc-section report-doc-plan-section">
              <h2>干预建议{planConfirmed ? "（医生已确认）" : ""}</h2>
              <PlanList categoryOrder={categoryOrder} planEntries={planEntries} />
            </section>

            <p className="report-doc-footnote">
              *本报告由系统依据标准化量表结果自动生成，仅供参考，不能替代医生的诊断与处置意见；最终干预方案以医生审核意见为准，
              完整的视频、图文教程请在系统报告页查看。▲表示需要关注的结果；「部分计分」的项目含待医护测量或查看的题目，结论可能更新。
            </p>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** 干预建议：按 5 大类列出项目名称，强制优先项标注 */
function PlanList({
  categoryOrder,
  planEntries,
}: {
  categoryOrder: readonly string[];
  planEntries: readonly ReportPlanEntry[];
}) {
  if (planEntries.length === 0) {
    return <p className="report-doc-muted">本次评估暂无需要执行的干预项目。</p>;
  }
  return (
    <dl className="report-doc-basic">
      {categoryOrder.map((category) => {
        const entries = planEntries.filter((entry) => entry.categoryLabel === category);
        return (
          <div key={category}>
            <dt>{category}</dt>
            <dd>
              {entries.length === 0
                ? "本类暂无匹配干预"
                : entries.map((entry) => `${entry.name}${entry.forced ? "（优先）" : ""}`).join("、")}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
