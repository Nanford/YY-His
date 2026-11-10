/**
 * INPUT:  候选/最终干预方案（积分排名结果）、医生审核决定、会话标识
 * OUTPUT: 候选方案审核表单（保留/删除/同类替换 + 备注）与只读最终方案
 * POS:    医生端干预方案审核组件。展示每项积分与积分来源明细、视频/图文教程、素材状态与审核留痕。
 *         同类替换下拉对本患者 -100 禁忌项禁用并红字标注「本患者禁止」（服务端 confirmPlan 同步硬拦截）。
 *         来源：需求更新说明 V2.0 §4.2 医生审核（保留/删除/同类替换，记录操作人/时间/原因/前后编码）、
 *         §5 干预展示、§5.3 安全提示与"初步方案→医生已确认"。
 */
import { TriangleAlert, Undo2, ArrowLeftRight, ClipboardCheck, Info, ShieldCheck, Ban } from "lucide-react";
import { confirmPlan, reopenSession } from "@/lib/actions/doctor";
import type { PlanDecision as ReviewPlanDecision } from "@/lib/assessment/plan-review";
import type { ForbiddenItemV2, PlanCandidateItemV2 } from "@/lib/recommend-v2";
import { interventionItems, scoringCategories } from "@/lib/rules";
import { InterventionVideo, InterventionImage, InterventionText } from "@/components/intervention-media";

/** 5 大类固定展示顺序与序号（来源：03 表干预方案分类 + 积分数据 categories 顺序） */
const CATEGORY_ORDER = scoringCategories.map((c) => c.label);
const CATEGORY_INDEX: Record<string, string> = Object.fromEntries(
  CATEGORY_ORDER.map((label, index) => [label, String(index + 1).padStart(2, "0")])
);

/** 各类别可选的同类替换项（编码 + 名称），按编码前缀归到大类展示标签，构建一次 */
const REPLACE_OPTIONS: Record<string, { code: string; name: string }[]> = Object.fromEntries(
  scoringCategories.map((def) => [
    def.label,
    interventionItems.filter((i) => i.code.startsWith(def.codePrefix)).map((i) => ({ code: i.code, name: i.name })),
  ])
);

/** 对外复用纯逻辑层的审核决定类型，避免页面与服务端契约漂移。 */
export type PlanDecision = ReviewPlanDecision;

/** 单个候选项的媒体教程（视频/图片/文本），素材缺失如实标注"素材待补齐" */
function MediaBlock({ item }: { item: PlanCandidateItemV2 }) {
  if (item.mediaType === "text") return <InterventionText name={item.name} content={item.content} />;
  return item.mediaType === "video" ? (
    <InterventionVideo src={item.mediaSrc ?? ""} available={item.mediaAvailable} text={item.content} />
  ) : (
    <InterventionImage src={item.mediaSrc ?? ""} available={item.mediaAvailable} name={item.name} sourceFile={null} />
  );
}

/** 积分来源明细（下钻）：每个非零贡献的评估标签及其对本项的匹配分（100=强制推荐标红） */
function ScoreDetail({ item }: { item: PlanCandidateItemV2 }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#6b82a4]">
      <span>积分来源：</span>
      {item.contributions.length > 0 ? (
        item.contributions.map((d) => (
          <span key={d.tagCode} className={d.score === 100 ? "ui-badge ui-badge-danger" : "ui-badge"}>
            {d.tagName}
            <span className="font-mono">{d.score === 100 ? "强制" : `+${d.score}`}</span>
          </span>
        ))
      ) : (
        <span>—</span>
      )}
    </div>
  );
}

interface InterventionCardProps {
  item: PlanCandidateItemV2;
  reviewing: boolean;
  decision?: PlanDecision;
  /** 本患者被 -100 禁止的干预明细（禁忌红线：替换下拉命中即禁用并标注） */
  forbidden?: readonly ForbiddenItemV2[];
}

function InterventionCard({ item, reviewing, decision, forbidden = [] }: InterventionCardProps) {
  const options = REPLACE_OPTIONS[item.categoryLabel]?.filter((o) => o.code !== item.code) ?? [];
  const forbiddenByCode = new Map(forbidden.map((f) => [f.code, f]));

  return (
    <article
      className={[
        "overflow-hidden rounded-2xl border bg-card",
        item.forced ? "border-2 border-[#c23b4a] bg-[#fff8f8]" : "border-[#dbe7f6]",
      ].join(" ")}
    >
      <div className="space-y-2 border-b border-border bg-accent/35 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-bold tracking-wide text-blue-500">{item.code}</span>
          <h4 className="text-base font-extrabold text-[#173766]">{item.name}</h4>
          <span className="ui-badge">匹配分 {item.total}</span>
          {item.forced && (
            <span className="ui-badge ui-badge-danger">
              <TriangleAlert size={13} aria-hidden="true" />
              强制优先推荐（100）
            </span>
          )}
          {decision?.action === "replace" && (
            <span className="ui-badge">
              <ArrowLeftRight size={13} aria-hidden="true" />
              替换自 {decision.fromCode}
            </span>
          )}
        </div>
        {item.forced && (
          <p className="text-xs font-semibold leading-5 text-[#c23b4a]">
            系统标记为强制优先推荐，审核时请优先保留并确认。
          </p>
        )}
      </div>

      <div className={reviewing ? "grid md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]" : "grid"}>
        <div className="min-w-0 space-y-3 p-4">
          <MediaBlock item={item} />
          <details className="rounded-lg border border-border px-3 py-2">
            <summary className="cursor-pointer text-sm font-semibold text-primary">查看匹配依据</summary>
            <div className="mt-2"><ScoreDetail item={item} /></div>
          </details>
        </div>

        {reviewing ? (
          <fieldset className="group/review min-w-0 space-y-3 border-t border-border bg-muted/45 p-4 md:border-t-0 md:border-l">
            <legend className="sr-only">{item.name}审核操作</legend>
            <p className="text-xs font-bold text-muted-foreground">审核决定</p>
            <div className="flex flex-wrap gap-1.5 text-sm font-semibold text-foreground">
              <label className="ui-choice">
                <input type="radio" name={`action.${item.code}`} value="keep" defaultChecked />
                保留
              </label>
              <label className="ui-choice">
                <input type="radio" name={`action.${item.code}`} value="remove" />
                删除
              </label>
              <label className="ui-choice">
                <input type="radio" name={`action.${item.code}`} value="replace" />
                同类替换
              </label>
            </div>

            {options.length > 0 && (
              <div className="hidden group-has-[input[value=replace]:checked]/review:block">
              <label className="ui-field">
                <span className="ui-label">替换为</span>
                <select name={`replaceWith.${item.code}`} defaultValue="" className="ui-select" aria-label={`${item.name}同类替换项`}>
                  <option value="">— 保持原项 —</option>
                  {options.map((o) => {
                    const banned = forbiddenByCode.get(o.code);
                    return (
                      <option
                        key={o.code}
                        value={o.code}
                        disabled={Boolean(banned)}
                        className={banned ? "font-bold text-red-700" : undefined}
                      >
                        {o.code}　{o.name}
                        {banned ? "（本患者禁止）" : ""}
                      </option>
                    );
                  })}
                </select>
              </label>
              </div>
            )}

            <label className="ui-field">
              <span className="ui-label">调整原因 / 审核备注</span>
              <input type="text" name={`note.${item.code}`} placeholder="删除或替换请填写原因（选填）" className="ui-input" />
            </label>
          </fieldset>
        ) : (
          decision?.note && (
            <p className="ui-alert mx-4 mb-4 text-xs">
              <Info size={16} className="shrink-0" aria-hidden="true" />
              审核备注：{decision.note}
            </p>
          )
        )}
      </div>
    </article>
  );
}

function GroupedList({
  items,
  reviewing,
  decisions = [],
  forbidden = [],
}: {
  items: readonly PlanCandidateItemV2[];
  reviewing: boolean;
  decisions?: readonly PlanDecision[];
  forbidden?: readonly ForbiddenItemV2[];
}) {
  // 最终方案的决定按"最终项编码"回填：保留→自身编码，替换→toCode
  const decisionByFinalCode = new Map<string, PlanDecision>();
  for (const d of decisions) {
    if (d.action === "keep") decisionByFinalCode.set(d.code, d);
    if (d.action === "replace" && d.toCode) decisionByFinalCode.set(d.toCode, d);
  }

  return (
    <div className="space-y-7">
      {CATEGORY_ORDER.map((category) => {
        const group = items.filter((item) => item.categoryLabel === category);
        if (group.length === 0) return null;
        return (
          <section key={category} className="space-y-3">
            <div className="flex items-center gap-3 rounded-lg bg-accent px-3 py-2">
              <span className="font-mono text-xs font-bold text-primary">{CATEGORY_INDEX[category] ?? "--"}</span>
              <h3 className="flex-1 text-sm font-bold text-foreground">{category}</h3>
              <span className="ui-badge">{group.length} 项</span>
            </div>
            <div className="space-y-3">
              {group.map((item) => (
                <InterventionCard key={item.code} item={item} reviewing={reviewing} decision={decisionByFinalCode.get(item.code)} forbidden={forbidden} />
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
        <ShieldCheck size={23} aria-hidden="true" />
      </span>
      <p className="mt-3 font-extrabold text-[#2b4a75]">{final ? "本次评估无最终干预项目" : "暂无候选干预方案"}</p>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#6980a3]">
        {final
          ? "评估结果未形成需执行的干预项目，或候选项目经医生审核后均未纳入；审核记录已保留。"
          : "当前评估标签在积分规则表中未匹配出总分大于 0 的干预项目。医生确认后，本次评估将以「无需新增干预」完成归档。"}
      </p>
    </div>
  );
}

/** 被 -100 禁止自动推荐的干预项明细（医生可见，安全决策可追溯；患者端不展示） */
function ForbiddenSection({ forbidden }: { forbidden: readonly ForbiddenItemV2[] }) {
  if (forbidden.length === 0) return null;
  return (
    // 外边距与 ui-panel-body 的 22px 内边距对齐，左缘与上方卡体内容齐平
    <section className="mx-4 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 sm:mx-5" aria-label="禁止自动推荐明细">
      <h3 className="inline-flex items-center gap-2 text-sm font-extrabold text-red-800">
        <Ban size={17} aria-hidden="true" />
        已禁止自动推荐（{forbidden.length} 项）
      </h3>
      <ul className="mt-3 space-y-2">
        {forbidden.map((item) => (
          <li key={item.code} className="text-xs leading-5 text-red-900">
            <span className="font-mono font-bold">{item.code}</span> {item.name}：
            {item.reasons
              .filter((r) => r.score === -100)
              .map((r) => r.tagName)
              .join("、")}
            触发禁止
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 候选方案审核：保留 / 删除 / 同类替换，并记录审核备注。 */
export function PlanReview({
  sessionId,
  candidates,
  forbidden = [],
}: {
  sessionId: string;
  candidates: readonly PlanCandidateItemV2[];
  forbidden?: readonly ForbiddenItemV2[];
}) {
  const hasCandidates = candidates.length > 0;

  return (
    <section id="intervention-plan" className="ui-panel scroll-mt-20">
      <div className="ui-panel-heading flex-wrap bg-[#f8fbff]">
        <div>
          <h2 className="ui-panel-title mt-1">候选干预方案审核</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#667fa5]">
            {hasCandidates
              ? "逐项核对教程、适用情况与审核决定。"
              : "当前没有候选项目，仍需由医生完成确认并形成审核记录。"}
          </p>
        </div>
        <span className="ui-badge shrink-0">{candidates.length} 项候选</span>
      </div>

      <ForbiddenSection forbidden={forbidden} />
      <form action={confirmPlan.bind(null, sessionId)} className="ui-panel-body space-y-7">
        {hasCandidates ? <GroupedList items={candidates} reviewing forbidden={forbidden} /> : <EmptyPlan final={false} />}
        <div className="sticky bottom-3 z-10 flex justify-end rounded-xl border border-border bg-card p-2.5 shadow-lg shadow-blue-950/10">
          <button type="submit" className="ui-button ui-button-primary ui-button-lg">
            <ClipboardCheck size={19} aria-hidden="true" />
            {hasCandidates ? "确认最终干预方案" : "确认暂无候选方案"}
          </button>
        </div>
      </form>

      <form action={reopenSession.bind(null, sessionId)} className="rounded-b-[inherit] border-t border-border bg-muted/50 px-5 py-3">
        <button type="submit" className="ui-button ui-button-quiet min-h-0 px-0 py-1 text-sm">
          <Undo2 size={17} aria-hidden="true" />
          返回修改答案（本次评估结果将重新生成）
        </button>
      </form>
    </section>
  );
}

/** 已确认方案：允许空方案，并集中展示删除与替换决定。 */
export function FinalPlan({
  finalPlan,
  decisions,
  confirmedAt,
}: {
  finalPlan: readonly PlanCandidateItemV2[];
  decisions: readonly PlanDecision[];
  confirmedAt: Date | null;
}) {
  const removed = decisions.filter((d) => d.action === "remove");
  const replaced = decisions.filter((d) => d.action === "replace");
  const changed = [...replaced, ...removed];

  return (
    <section id="intervention-plan" className="ui-panel scroll-mt-20 overflow-hidden">
      {/* 卡头统一走 ui-panel-heading（令牌自带内边距与底部分隔线），统计徽标收进左块 */}
      <div className="ui-panel-heading flex-wrap bg-[#eff6ff]">
        <div>
          <h2 className="ui-panel-title mt-1">最终干预方案</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="ui-badge ui-badge-success">最终保留 {finalPlan.length} 项</span>
            <span className="ui-badge">替换 {replaced.length} 项</span>
            <span className="ui-badge ui-badge-danger">删除 {removed.length} 项</span>
          </div>
        </div>
        <div className="shrink-0 text-right text-xs leading-5 text-[#53729e]">
          <p className="font-extrabold text-blue-700">医生已确认</p>
          <p>{confirmedAt ? confirmedAt.toLocaleString("zh-CN") : "确认时间未记录"}</p>
        </div>
      </div>

      <div className="ui-panel-body space-y-7">
        {finalPlan.length > 0 ? <GroupedList items={finalPlan} reviewing={false} decisions={decisions} /> : <EmptyPlan final />}

        {changed.length > 0 && (
          <section className="ui-panel-subtle p-4" aria-label="方案审核记录">
            <h3 className="text-sm font-extrabold text-[#29496f]">方案审核记录</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {changed.map((decision) => (
                <div key={`${decision.action}-${decision.code}`} className="rounded-xl border border-[#dbe7f6] bg-white px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className={decision.action === "replace" ? "ui-badge" : "ui-badge ui-badge-danger"}>
                      {decision.action === "replace" ? <ArrowLeftRight size={13} aria-hidden="true" /> : <TriangleAlert size={13} aria-hidden="true" />}
                      {decision.action === "replace" ? "已替换" : "已删除"}
                    </span>
                    <span className="text-sm font-bold text-[#29496f]">
                      {decision.action === "replace" ? `${decision.fromCode} → ${decision.toCode}` : decision.code}
                    </span>
                  </div>
                  {decision.note && <p className="mt-2 text-xs leading-5 text-[#6b82a4]">{decision.note}</p>}
                  <p className="mt-1 text-[11px] text-[#94a7c4]">
                    {decision.operator} · {new Date(decision.at).toLocaleString("zh-CN")}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
