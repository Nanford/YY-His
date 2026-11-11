export function ReportOverview({ scaleCount, problemCount }: {
  scaleCount: number;
  problemCount: number;
}) {
  return (
    <section className="care-report-section care-report-summary">
      <h2>评估概览</h2>
      <dl className="care-report-counts">
        <div>
          <dt>本次评估</dt>
          <dd>{scaleCount}<small>项</small></dd>
        </div>
        <div data-attention={problemCount > 0 ? "" : undefined}>
          <dt>需关注</dt>
          <dd>{problemCount}<small>条</small></dd>
        </div>
      </dl>
    </section>
  );
}
