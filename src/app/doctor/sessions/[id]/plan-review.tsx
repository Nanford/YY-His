/**
 * INPUT:  候选/最终干预方案（积分排名结果）、医生审核决定、会话标识
 * OUTPUT: 候选方案审核表单（保留/删除/同类替换 + 备注）与只读最终方案
 * POS:    医生端干预方案审核组件。展示每项积分与积分来源明细、视频/图文教程、素材状态与审核留痕。
 *         来源：需求更新说明 V2.0 §4.2 医生审核（保留/删除/同类替换，记录操作人/时间/原因/前后编码）、
 *         §5 干预展示、§5.3 安全提示与"初步方案→医生已确认"。
 */
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconArrowsExchange,
  IconClipboardCheck,
  IconInfoCircle,
  IconShieldCheck,
} from "@tabler/icons-react";
import { confirmPlan, reopenSession } from "@/lib/actions/doctor";
import type { PlanDecision as ReviewPlanDecision } from "@/lib/assessment/plan-review";
import type { RecommendedIntervention } from "@/lib/recommend";
import { interventionItemByCode, interventionItems, scoringCategories } from "@/lib/rules";
import { InterventionVideo, InterventionImage } from "@/components/intervention-media";

/** 三大类固定展示顺序与序号 */
const CATEGORY_ORDER = scoringCategories.map((c) => c.label);
const CATEGORY_INDEX: Record<string, string> = { 运动干预: "01", 膳食干预: "02", 中医食养干预: "03" };

/** 各类别可选的同类替换项（编码 + 名称），构建一次 */
const REPLACE_OPTIONS: Record<string, { code: string; name: string }[]> = Object.fromEntries(
  CATEGORY_ORDER.map((cat) => [cat, interventionItems.filter((i) => i.category === cat).map((i) => ({ code: i.code, name: i.name }))])
);

/** 对外复用纯逻辑层的审核决定类型，避免页面与服务端契约漂移。 */
export type PlanDecision = ReviewPlanDecision;

/** 单个候选项的媒体教程（视频/图文），医生端图片显示原始文件名 */
function MediaBlock({ item }: { item: RecommendedIntervention }) {
  const available = interventionItemByCode.get(item.code)?.mediaAvailable ?? false;
  return item.mediaType === "video" ? (
    <InterventionVideo src={item.mediaSrc} available={available} text={item.text} />
  ) : (
    <InterventionImage src={item.mediaSrc} available={available} name={item.name} sourceFile={item.sourceFile} showSourceFile />
  );
}

/** 积分来源明细（下钻）：每个贡献 >0 的评估标签及其对本项的匹配分 */
function ScoreDetail({ item }: { item: RecommendedIntervention }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#6b82a4]">
      <span>积分来源：</span>
      {item.matchDetail.length > 0 ? (
        item.matchDetail.map((d) => (
          <span key={`${d.tag}-${d.level}`} className="ui-badge">
            {d.tag}
            {d.level !== "是" && `（${d.level}）`}
            <span className="font-mono">+{d.score}</span>
          </span>
        ))
      ) : (
        <span>—</span>
      )}
    </div>
  );
}

interface InterventionCardProps {
  item: RecommendedIntervention;
  reviewing: boolean;
  decision?: PlanDecision;
}

function InterventionCard({ item, reviewing, decision }: InterventionCardProps) {
  const options = REPLACE_OPTIONS[item.category]?.filter((o) => o.code !== item.code) ?? [];

  return (
    <article className="rounded-2xl border border-[#dbe7f6] bg-white p-5 shadow-[0_8px_20px_rgba(33,87,160,0.05)]">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-bold tracking-wide text-blue-500">{item.code}</span>
          <h4 className="text-base font-extrabold text-[#173766]">{item.name}</h4>
          <span className="ui-badge">匹配分 {item.score}</span>
          {decision?.action === "replace" && (
            <span className="ui-badge">
              <IconArrowsExchange size={13} aria-hidden="true" />
              替换自 {decision.fromCode}
            </span>
          )}
        </div>
        <ScoreDetail item={item} />
      </div>

      <div className="mt-4">
        <MediaBlock item={item} />
      </div>

      {reviewing ? (
        <fieldset className="mt-5 space-y-4 border-t border-[#eef3fb] pt-4">
          <legend className="sr-only">{item.name}审核操作</legend>
          <div className="flex flex-wrap gap-4 text-sm font-bold text-[#29496f]">
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
            <label className="ui-field">
              <span className="ui-label">替换为（选择「同类替换」时生效）</span>
              <select name={`replaceWith.${item.code}`} defaultValue="" className="ui-input" aria-label={`${item.name}同类替换项`}>
                <option value="">— 保持原项 —</option>
                {options.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.code}　{o.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="ui-field">
            <span className="ui-label">调整原因 / 审核备注</span>
            <input type="text" name={`note.${item.code}`} placeholder="删除或替换请填写原因（选填）" className="ui-input" />
          </label>
        </fieldset>
      ) : (
        decision?.note && (
          <p className="ui-alert mt-4 text-xs">
            <IconInfoCircle size={16} className="shrink-0" aria-hidden="true" />
            审核备注：{decision.note}
          </p>
        )
      )}
    </article>
  );
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
  // 最终方案的决定按"最终项编码"回填：保留→自身编码，替换→toCode
  const decisionByFinalCode = new Map<string, PlanDecision>();
  for (const d of decisions) {
    if (d.action === "keep") decisionByFinalCode.set(d.code, d);
    if (d.action === "replace" && d.toCode) decisionByFinalCode.set(d.toCode, d);
  }

  return (
    <div className="space-y-7">
      {CATEGORY_ORDER.map((category) => {
        const group = items.filter((item) => item.category === category);
        if (group.length === 0) return null;
        return (
          <section key={category} className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs font-bold tracking-[0.16em] text-blue-500">{CATEGORY_INDEX[category] ?? "--"}</span>
              <h3 className="text-sm font-extrabold text-[#245286]">{category}</h3>
              <span className="ui-badge">{group.length} 项</span>
              <span className="h-px flex-1 bg-[#dbe7f6]" />
            </div>
            <div className="space-y-3">
              {group.map((item) => (
                <InterventionCard key={item.code} item={item} reviewing={reviewing} decision={decisionByFinalCode.get(item.code)} />
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
          : "当前评估标签在积分规则表中未匹配出总分大于 0 的干预项目。医生确认后，本次评估将以「无需新增干预」完成归档。"}
      </p>
    </div>
  );
}

/** 候选方案审核：保留 / 删除 / 同类替换，并记录审核备注。 */
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
            ? "逐项核对积分来源与教程内容；可保留、删除或在同类别中替换。每类最多 2 项、总数不超过 6 项。"
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

/** 已确认方案：允许空方案，并集中展示删除与替换决定。 */
export function FinalPlan({
  finalPlan,
  decisions,
  confirmedAt,
}: {
  finalPlan: readonly RecommendedIntervention[];
  decisions: readonly PlanDecision[];
  confirmedAt: Date | null;
}) {
  const removed = decisions.filter((d) => d.action === "remove");
  const replaced = decisions.filter((d) => d.action === "replace");
  const changed = [...replaced, ...removed];

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
          <span className="ui-badge">替换 {replaced.length} 项</span>
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
                <div key={`${decision.action}-${decision.code}`} className="rounded-xl border border-[#dbe7f6] bg-white px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className={decision.action === "replace" ? "ui-badge" : "ui-badge ui-badge-danger"}>
                      {decision.action === "replace" ? <IconArrowsExchange size={13} aria-hidden="true" /> : <IconAlertTriangle size={13} aria-hidden="true" />}
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
