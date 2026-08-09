/**
 * INPUT:  候选/最终干预方案（积分排名结果）、医生审核决定、会话标识
 * OUTPUT: 候选方案审核表单（保留/删除/同类替换 + 备注）与只读最终方案
 * POS:    医生端干预方案审核组件。展示每项积分与积分来源明细、视频/图文教程、素材状态与审核留痕。
 *         同类替换下拉对本患者 -100 禁忌项禁用并红字标注「本患者禁止」（服务端 confirmPlan 同步硬拦截）。
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
  IconBan,
} from "@tabler/icons-react";
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

function sourceFileName(mediaSrc: string | null): string | null {
  if (!mediaSrc) return null;
  const pathPart = mediaSrc.split(/[?#]/, 1)[0];
  const fileName = pathPart.split("/").pop();
  if (!fileName) return null;
  try {
    return decodeURIComponent(fileName);
  } catch {
    return fileName;
  }
}

/** 对外复用纯逻辑层的审核决定类型，避免页面与服务端契约漂移。 */
export type PlanDecision = ReviewPlanDecision;

/** 单个候选项的媒体教程（视频/图片/文本），素材缺失如实标注"素材待补齐" */
function MediaBlock({ item }: { item: PlanCandidateItemV2 }) {
  if (item.mediaType === "text") return <InterventionText name={item.name} content={item.content} />;
  const fileName = sourceFileName(item.mediaSrc);
  const media = item.mediaType === "video" ? (
    <InterventionVideo src={item.mediaSrc ?? ""} available={item.mediaAvailable} text={item.content} />
  ) : (
    <InterventionImage
      src={item.mediaSrc ?? ""}
      available={item.mediaAvailable}
      name={item.name}
      sourceFile={fileName}
    />
  );
  return (
    <div className="space-y-2">
      {media}
      {fileName && <p className="text-xs text-[var(--ink-faint,#6b82a4)]">素材源文件：{fileName}</p>}
    </div>
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
        "rounded-2xl border bg-white p-5 shadow-[0_8px_20px_rgba(33,87,160,0.05)]",
        item.forced ? "border-2 border-[#c23b4a] bg-[#fff8f8]" : "border-[#dbe7f6]",
      ].join(" ")}
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-bold tracking-wide text-blue-500">{item.code}</span>
          <h4 className="text-base font-extrabold text-[#173766]">{item.name}</h4>
          <span className="ui-badge">匹配分 {item.total}</span>
          {item.forced && (
            <span className="ui-badge ui-badge-danger">
              <IconAlertTriangle size={13} aria-hidden="true" />
              强制优先推荐（100）
            </span>
          )}
          {decision?.action === "replace" && (
            <span className="ui-badge">
              <IconArrowsExchange size={13} aria-hidden="true" />
              替换自 {decision.fromCode}
            </span>
          )}
        </div>
        {item.forced && (
          <p className="text-xs font-semibold leading-5 text-[#c23b4a]">
            系统标记为强制优先推荐，审核时请优先保留并确认。
          </p>
        )}
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
          )}

          <label className="ui-field">
            <span className="ui-label">调整原因 / 审核备注</span>
            <input type="text" name={`note.${item.code}`} placeholder="删除或替换必须填写明确审核理由；保留可不填" className="ui-input" />
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
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs font-bold tracking-[0.16em] text-blue-500">{CATEGORY_INDEX[category] ?? "--"}</span>
              <h3 className="text-sm font-extrabold text-[#245286]">{category}</h3>
              <span className="ui-badge">{group.length} 项</span>
              <span className="h-px flex-1 bg-[#dbe7f6]" />
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

/** 被 -100 禁止自动推荐的干预项明细（医生可见，安全决策可追溯；患者端不展示） */
function ForbiddenSection({ forbidden }: { forbidden: readonly ForbiddenItemV2[] }) {
  if (forbidden.length === 0) return null;
  return (
    <section className="mx-6 mb-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4" aria-label="禁止自动推荐明细">
      <h3 className="inline-flex items-center gap-2 text-sm font-extrabold text-red-800">
        <IconBan size={17} aria-hidden="true" />
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
            ? "逐项核对积分来源与教程内容；可保留、删除或在同类别中替换。运动/膳食营养/中医食养/就诊建议/其他五类，每类最多 2 项。"
            : "当前没有候选项目，仍需由医生完成确认并形成审核记录。"}
        </p>
      </div>

      <form action={confirmPlan.bind(null, sessionId)} className="space-y-7 p-6">
        {hasCandidates ? <GroupedList items={candidates} reviewing forbidden={forbidden} /> : <EmptyPlan final={false} />}
        <div className="flex justify-end border-t border-[#dbe7f6] pt-5">
          <button type="submit" className="ui-button ui-button-primary ui-button-lg">
            <IconClipboardCheck size={19} aria-hidden="true" />
            {hasCandidates ? "确认最终干预方案" : "确认暂无候选方案"}
          </button>
        </div>
      </form>

      <ForbiddenSection forbidden={forbidden} />

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
  finalPlan: readonly PlanCandidateItemV2[];
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
