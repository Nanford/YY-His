/**
 * INPUT:  候选/最终干预方案、医生审核决定、会话标识
 * OUTPUT: 可编辑的候选方案审核表单与只读最终方案
 * POS:    医生端干预方案审核组件；完整展示执行方案、禁忌提示及删改留痕
 */
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconClipboardCheck,
  IconEdit,
  IconInfoCircle,
  IconShieldCheck,
} from "@tabler/icons-react";
import { confirmPlan, reopenSession } from "@/lib/actions/doctor";
import type { PlanDecision as ReviewPlanDecision } from "@/lib/assessment/plan-review";
import type { RecommendedIntervention } from "@/lib/recommend";
import { extractCautions } from "@/lib/recommend/cautions";
import { interventionCategories } from "@/lib/rules";

const CATEGORY_META: Record<string, { index: string }> = {
  运动干预: { index: "01" },
  膳食补充: { index: "02" },
  中医食养: { index: "03" },
};

/** 对外复用纯逻辑层的审核决定类型，避免页面与服务端契约漂移。 */
export type PlanDecision = ReviewPlanDecision;

interface InterventionCardProps {
  item: RecommendedIntervention;
  reviewing: boolean;
  decision?: PlanDecision;
}

/** 审核态提交方案全文和备注，由服务端对比原文后判定 keep / remove / adjust。 */
function InterventionCard({ item, reviewing, decision }: InterventionCardProps) {
  const cautions = extractCautions(item.plan);

  return (
    <article className="rounded-2xl border border-[#dbe7f6] bg-white p-5 shadow-[0_8px_20px_rgba(33,87,160,0.05)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-base font-extrabold text-[#173766]">{item.tag}</h4>
            {decision?.action === "adjust" && (
              <span className="ui-badge">
                <IconEdit size={13} aria-hidden="true" />
                已调整
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#6b82a4]">
            <span>评估触发：</span>
            {item.triggeredBy.length > 0 ? (
              item.triggeredBy.map((source) => (
                <span key={`${source.tag}-${source.level}`} className="ui-badge">
                  {source.tag}
                  {source.level !== "是" && `（${source.level}）`}
                </span>
              ))
            ) : (
              <span>规则映射</span>
            )}
          </div>
        </div>

        {reviewing && (
          <label className="ui-choice shrink-0 text-sm font-bold">
            <input type="checkbox" name={`keep.${item.tag}`} defaultChecked />
            纳入最终方案
          </label>
        )}
      </div>

      <div className="mt-5 space-y-4">
        {reviewing ? (
          <label className="ui-field">
            <span className="ui-label">执行方案全文</span>
            <textarea
              name={`plan.${item.tag}`}
              defaultValue={item.plan}
              aria-label={`${item.tag}执行方案全文`}
              className="ui-textarea text-sm leading-6"
            />
          </label>
        ) : (
          <div>
            <p className="ui-label">执行方案全文</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-[#4b668e]">{item.plan}</p>
          </div>
        )}

        {reviewing && (
          <label className="ui-field">
            <span className="ui-label">审核备注</span>
            <input
              type="text"
              name={`note.${item.tag}`}
              placeholder="可填写调整依据或删除原因（选填）"
              className="ui-input"
            />
          </label>
        )}

        {!reviewing && decision?.note && (
          <p className="ui-alert text-xs">
            <IconInfoCircle size={16} className="shrink-0" aria-hidden="true" />
            审核备注：{decision.note}
          </p>
        )}

        {cautions.length > 0 && (
          <aside className="ui-alert ui-alert-danger" aria-label={`${item.tag}禁忌提示`}>
            <IconAlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-bold">用前请核对</p>
              {cautions.map((caution) => (
                <p key={caution} className="mt-1 text-xs leading-5">
                  {caution}
                </p>
              ))}
            </div>
          </aside>
        )}
      </div>
    </article>
  );
}

function categoryOrder(items: readonly RecommendedIntervention[]): string[] {
  const extras = items.map((item) => item.category).filter((category) => !interventionCategories.includes(category));
  return [...interventionCategories, ...new Set(extras)];
}

function GroupedList({
  items,
  reviewing,
  decisions = [],
}: {
  items: readonly RecommendedIntervention[];
  reviewing: boolean;
  decisions?: readonly PlanDecision[];
}) {
  const decisionsByTag = new Map(decisions.map((decision) => [decision.tag, decision]));

  return (
    <div className="space-y-7">
      {categoryOrder(items).map((category) => {
        const group = items.filter((item) => item.category === category);
        if (group.length === 0) return null;
        const meta = CATEGORY_META[category];

        return (
          <section key={category} className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs font-bold tracking-[0.16em] text-blue-500">{meta?.index ?? "--"}</span>
              <h3 className="text-sm font-extrabold text-[#245286]">{category}</h3>
              <span className="ui-badge">{group.length} 项</span>
              <span className="h-px flex-1 bg-[#dbe7f6]" />
            </div>
            <div className="space-y-3">
              {group.map((item) => (
                <InterventionCard
                  key={item.tag}
                  item={item}
                  reviewing={reviewing}
                  decision={decisionsByTag.get(item.tag)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function EmptyPlan({ final }: { final: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#bcd4f5] bg-[#f8fbff] px-6 py-9 text-center">
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-blue-50 text-blue-600">
        <IconShieldCheck size={23} aria-hidden="true" />
      </span>
      <p className="mt-3 font-extrabold text-[#2b4a75]">{final ? "本次评估无最终干预项目" : "暂无候选干预方案"}</p>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#6980a3]">
        {final
          ? "评估结果未形成需执行的干预项目，或候选项目经医生审核后均未纳入；审核记录已保留。"
          : "当前评估标签未映射出候选干预项目。医生确认后，本次评估将以“无需新增干预”完成归档。"}
      </p>
    </div>
  );
}

/** 候选方案审核：允许保留、删除、改写全文并记录审核备注。 */
export function PlanReview({
  sessionId,
  candidates,
}: {
  sessionId: string;
  candidates: readonly RecommendedIntervention[];
}) {
  const hasCandidates = candidates.length > 0;

  return (
    <section className="ui-panel overflow-hidden">
      <div className="border-b border-[#dbe7f6] bg-[#f8fbff] px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="page-eyebrow">INTERVENTION REVIEW</p>
            <h2 className="mt-1 text-lg font-extrabold text-[#173766]">候选干预方案审核</h2>
          </div>
          <span className="ui-badge">{candidates.length} 项候选</span>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[#667fa5]">
          {hasCandidates
            ? "逐项核对执行方案与禁忌提示；取消勾选将删除该项，修改正文将记为调整。"
            : "当前没有候选项目，仍需由医生完成确认并形成审核记录。"}
        </p>
      </div>

      <form action={confirmPlan.bind(null, sessionId)} className="space-y-7 p-6">
        {hasCandidates ? <GroupedList items={candidates} reviewing /> : <EmptyPlan final={false} />}
        <div className="flex justify-end border-t border-[#dbe7f6] pt-5">
          <button type="submit" className="ui-button ui-button-primary ui-button-lg">
            <IconClipboardCheck size={19} aria-hidden="true" />
            {hasCandidates ? "确认最终干预方案" : "确认暂无候选方案"}
          </button>
        </div>
      </form>

      <form action={reopenSession.bind(null, sessionId)} className="border-t border-[#dbe7f6] bg-[#f8fbff] px-6 py-3">
        <button type="submit" className="ui-button ui-button-quiet min-h-0 px-0 py-1 text-sm">
          <IconArrowBackUp size={17} aria-hidden="true" />
          返回修改答案（本次评估结果将重新生成）
        </button>
      </form>
    </section>
  );
}

/** 已确认方案：允许空方案，并集中展示删除与调整决定。 */
export function FinalPlan({
  finalPlan,
  decisions,
  confirmedAt,
}: {
  finalPlan: readonly RecommendedIntervention[];
  decisions: readonly PlanDecision[];
  confirmedAt: Date | null;
}) {
  const removed = decisions.filter((decision) => decision.action === "remove");
  const adjusted = decisions.filter((decision) => decision.action === "adjust");
  const changed = [...adjusted, ...removed];

  return (
    <section className="ui-panel overflow-hidden">
      <div className="border-b border-[#dbe7f6] bg-[#eff6ff] px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="page-eyebrow">CONFIRMED PLAN</p>
            <h2 className="mt-1 text-lg font-extrabold text-[#173766]">最终干预方案</h2>
          </div>
          <div className="text-right text-xs leading-5 text-[#53729e]">
            <p className="font-extrabold text-blue-700">医生已确认</p>
            <p>{confirmedAt ? confirmedAt.toLocaleString("zh-CN") : "确认时间未记录"}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="ui-badge ui-badge-success">最终保留 {finalPlan.length} 项</span>
          <span className="ui-badge">调整 {adjusted.length} 项</span>
          <span className="ui-badge ui-badge-danger">删除 {removed.length} 项</span>
        </div>
      </div>

      <div className="space-y-7 p-6">
        {finalPlan.length > 0 ? <GroupedList items={finalPlan} reviewing={false} decisions={decisions} /> : <EmptyPlan final />}

        {changed.length > 0 && (
          <section className="ui-panel-subtle p-4" aria-label="方案审核记录">
            <h3 className="text-sm font-extrabold text-[#29496f]">方案审核记录</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {changed.map((decision) => (
                <div key={`${decision.action}-${decision.tag}`} className="rounded-xl border border-[#dbe7f6] bg-white px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className={decision.action === "adjust" ? "ui-badge" : "ui-badge ui-badge-danger"}>
                      {decision.action === "adjust" ? <IconEdit size={13} aria-hidden="true" /> : <IconAlertTriangle size={13} aria-hidden="true" />}
                      {decision.action === "adjust" ? "已调整" : "已删除"}
                    </span>
                    <span className="text-sm font-bold text-[#29496f]">{decision.tag}</span>
                  </div>
                  {decision.note && <p className="mt-2 text-xs leading-5 text-[#6b82a4]">{decision.note}</p>}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
