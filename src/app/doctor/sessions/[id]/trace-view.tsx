/**
 * INPUT:  已脱离 Prisma 的答案追溯 DTO、关联对话录音 DTO
 * OUTPUT: 逐题作答得分（含评分方式与判定备注）、评分标准、原始文本、来源、状态、修改历史及录音存储状态
 * POS:    医生端全链路追溯视图；DTO 不包含患者身份字段、ASR 原始载荷或第三方请求数据。
 *         画图题（画钟、五边形临摹）的画作在此按 data URL 预览，来源统一标「画图交卷」。
 *         2026-11-12 用户拍板：「作答得分」与「评分标准」分开展示，得分醒目、注明 AI评分/规则判定等评分方式，
 *         折叠行也显示得分；展示口径见 src/lib/assessment/answer-scoring.ts。
 */
import { Check } from "lucide-react";
import { questionById, scaleByQuestionId, type ScaleQuestion } from "@/lib/rules";
import {
  SCORING_METHOD_LABEL,
  describeAnswerScoring,
  scoringCriteriaOf,
  type AiJudgmentRecord,
  type AnswerScoring,
  type ScoringMethod,
} from "@/lib/assessment/answer-scoring";

export type TraceAnswerSource =
  | "voice"
  | "text"
  | "button"
  | "doctor"
  | "measurement"
  | "system"
  | "multi"
  | "drawing";
export type TraceAnswerStatus = "confirmed" | "pending" | "manual" | "superseded";
export type TraceAudioStatus = "available" | "missing" | "processing" | "not_recorded";

export interface TraceEditRecordDto {
  at: string;
  field: "optionLabel" | "score" | "rawText" | "source" | "status";
  from: string | number | null;
  to: string | number | null;
  operator: "doctor" | "system";
  reason: string;
}

/** 仅包含评估作答信息，禁止在 DTO 中附加姓名、电话、证件号等身份字段。 */
export interface TraceAnswerDto {
  questionId: string;
  rawText: string | null;
  optionLabel: string | null;
  score: number | null;
  source: TraceAnswerSource;
  status: TraceAnswerStatus;
  editHistory: readonly TraceEditRecordDto[];
  /** 判定记录（方式/理由/把握度）；医生补录的答案没有 */
  aiJudgment: AiJudgmentRecord | null;
  updatedAt: Date | string;
}

/** 对话 DTO 只承载题目关联和录音状态，不接收完整对话文本及 ASR 原始返回。 */
export interface TraceDialogueTurnDto {
  id: string;
  questionId: string | null;
  role: "doctor" | "patient" | "system";
  audioPath: string | null;
  audioStatus?: TraceAudioStatus;
  createdAt: Date | string;
}

export interface TraceViewProps {
  sessionId: string;
  answers: readonly TraceAnswerDto[];
  dialogueTurns?: readonly TraceDialogueTurnDto[];
}

const SOURCE_META: Record<TraceAnswerSource, { label: string; cls: string }> = {
  voice: { label: "语音作答", cls: "border-blue-200 bg-blue-50 text-blue-700" },
  text: { label: "文字输入", cls: "border-blue-200 bg-blue-50 text-blue-700" },
  button: { label: "快捷按钮", cls: "border-slate-200 bg-slate-50 text-slate-700" },
  multi: { label: "多选作答", cls: "border-blue-200 bg-blue-50 text-blue-700" },
  // 2026-11-11 五边形临摹也走患者画板，来源文案由「画钟交卷」通用化
  drawing: { label: "画图交卷", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  doctor: { label: "医生补录", cls: "border-blue-200 bg-blue-50 text-blue-700" },
  measurement: { label: "测量换算", cls: "border-blue-200 bg-blue-50 text-blue-700" },
  system: { label: "系统读取", cls: "border-blue-200 bg-blue-50 text-blue-700" },
};

const STATUS_META: Record<TraceAnswerStatus, { label: string; cls: string }> = {
  confirmed: { label: "已确认", cls: "border-blue-200 bg-blue-50 text-blue-700" },
  pending: { label: "待确认", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  manual: { label: "待人工确认", cls: "border-red-200 bg-red-50 text-red-700" },
  superseded: { label: "已失效", cls: "border-slate-200 bg-slate-100 text-slate-500" },
};

const AUDIO_META: Record<TraceAudioStatus, { label: string; cls: string }> = {
  available: { label: "文件存在（可播放）", cls: "bg-blue-50 text-blue-700" },
  missing: { label: "文件缺失", cls: "bg-red-50 text-red-700" },
  processing: { label: "处理中", cls: "bg-amber-50 text-amber-700" },
  not_recorded: { label: "未录音", cls: "bg-slate-100 text-slate-500" },
};

const FIELD_LABEL: Record<TraceEditRecordDto["field"], string> = {
  optionLabel: "标准答案",
  score: "标准分值",
  rawText: "原始回答",
  source: "答案来源",
  status: "确认状态",
};

function formatDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN");
}

function displayValue(value: string | number | null): string {
  if (value === null || value === "") return "空";
  return String(value);
}

function audioStatusOf(turn: TraceDialogueTurnDto): TraceAudioStatus {
  return turn.audioStatus ?? (turn.audioPath ? "available" : "not_recorded");
}

function AudioRecords({
  sessionId,
  answer,
  turns,
}: {
  sessionId: string;
  answer: TraceAnswerDto;
  turns: readonly TraceDialogueTurnDto[];
}) {
  const patientTurns = turns.filter((turn) => turn.role === "patient");

  if (patientTurns.length === 0) {
    const missingVoice = answer.source === "voice";
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-500">
        <span className={`mr-2 rounded-full px-2 py-0.5 text-xs ${missingVoice ? "bg-red-50 text-red-700" : "bg-slate-100"}`}>
          {missingVoice ? "文件缺失" : "未录音"}
        </span>
        {missingVoice ? "本题答案标记为语音作答，但未找到关联的患者录音记录。" : "本题通过非语音方式作答。"}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {patientTurns.map((turn) => {
        const status = audioStatusOf(turn);
        const meta = AUDIO_META[status];
        return (
          <div key={turn.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`rounded-full px-2 py-0.5 font-medium ${meta.cls}`}>{meta.label}</span>
              <span className="text-slate-400">{formatDate(turn.createdAt)}</span>
            </div>
            {status === "available" && (
              <audio
                className="mt-2 w-full"
                controls
                preload="metadata"
                src={
                  "/api/doctor/sessions/" +
                  encodeURIComponent(sessionId) +
                  "/turns/" +
                  encodeURIComponent(turn.id) +
                  "/audio"
                }
                aria-label="播放本题患者原始录音"
              >
                您的浏览器不支持音频播放。
              </audio>
            )}
            {status === "missing" && (
              <p className="mt-1.5 text-xs leading-5 text-red-700">
                数据库保留了录音记录，但本地文件不存在或不在本会话录音目录内。
              </p>
            )}
            {status === "not_recorded" && (
              <p className="mt-1.5 text-xs leading-5 text-slate-500">本题没有保存原始录音。</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EditHistory({ history }: { history: readonly TraceEditRecordDto[] }) {
  if (history.length === 0) {
    return <p className="rounded-lg bg-white px-3 py-3 text-sm text-slate-400">标准答案生成后未发生修改。</p>;
  }

  return (
    <ol className="space-y-3 border-l border-slate-200 pl-4">
      {history.map((record, index) => (
        <li key={`${record.at}-${record.field}-${index}`} className="relative">
          <span className="absolute -left-[19px] top-1.5 size-2 rounded-full bg-blue-500 ring-4 ring-[#f8fbff]" />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <span>{formatDate(record.at)}</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
              {record.operator === "doctor" ? "医生操作" : "系统处理"}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-700">
            {FIELD_LABEL[record.field]}：
            <span className="text-slate-400 line-through">{displayValue(record.from)}</span>
            <span className="mx-1.5 text-slate-400">→</span>
            <span className="font-medium text-slate-900">{displayValue(record.to)}</span>
          </p>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">原因：{record.reason}</p>
        </li>
      ))}
    </ol>
  );
}

/** AI评分用实心蓝徽标，一眼和规则判定、患者点选、医生评分区分开 */
const METHOD_BADGE: Record<ScoringMethod, string> = {
  ai: "border-blue-600 bg-blue-600 text-white",
  rules: "border-slate-300 bg-slate-50 text-slate-700",
  patient: "border-blue-200 bg-blue-50 text-blue-700",
  doctor: "border-blue-200 bg-blue-50 text-blue-700",
  system: "border-slate-200 bg-slate-50 text-slate-600",
};

function scoreText(scoring: Extract<AnswerScoring, { kind: "scored" }>): string {
  return scoring.maxScore === null ? `${scoring.score} 分` : `${scoring.score}/${scoring.maxScore} 分`;
}

/** 折叠行上的得分胶囊：不展开就能逐题扫一遍得分与评分方式 */
function ScoreChip({ scoring }: { scoring: AnswerScoring }) {
  if (scoring.kind === "pending") {
    return <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">待评分</span>;
  }
  if (scoring.kind === "unscored") {
    return <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">不计分</span>;
  }
  return (
    <span className="inline-flex items-center overflow-hidden rounded-full border border-blue-200 text-xs font-semibold">
      <span className="bg-white px-2 py-0.5 tabular-nums text-blue-800">{scoreText(scoring)}</span>
      <span className={`border-l px-2 py-0.5 ${METHOD_BADGE[scoring.method]}`}>{SCORING_METHOD_LABEL[scoring.method]}</span>
    </span>
  );
}

/** 作答得分卡：本题实际得分（大号）+ 评分方式 + 备注（AI/规则判定写判定理由） */
function ScoreCard({ scoring }: { scoring: AnswerScoring }) {
  if (scoring.kind !== "scored") {
    const pending = scoring.kind === "pending";
    return (
      <div className={`rounded-lg border p-3 ${pending ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-white"}`}>
        <p className="text-xs font-medium text-slate-500">作答得分</p>
        <p className={`mt-1 text-2xl font-bold ${pending ? "text-amber-700" : "text-slate-500"}`}>{pending ? "待评分" : "不计分"}</p>
        <p className="mt-2 text-xs leading-5 text-slate-500">{scoring.note}</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-blue-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">作答得分</p>
        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${METHOD_BADGE[scoring.method]}`}>
          {SCORING_METHOD_LABEL[scoring.method]}
        </span>
      </div>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="text-4xl font-bold leading-none tabular-nums text-blue-700">{scoring.score}</span>
        <span className="text-base font-semibold text-blue-700">分</span>
        {scoring.maxScore !== null && <span className="ml-1 text-sm text-slate-400">/ 满分 {scoring.maxScore} 分</span>}
      </p>
      <p className="mt-3 text-xs leading-5 text-slate-600">
        <span className="font-medium text-slate-500">备注：</span>
        {scoring.note}
        {scoring.confidence !== null && (
          <span className="ml-1 text-slate-400">（模型把握度 {Math.round(scoring.confidence * 100)}%）</span>
        )}
      </p>
    </div>
  );
}

/** 评分标准卡：01 表各选项与分值，本题记录的答案打勾高亮；记录的答案不在选项里（历史数据）时单独列出 */
function ScoringCriteria({ question, optionLabel }: { question: ScaleQuestion | undefined; optionLabel: string | null }) {
  const criteria = scoringCriteriaOf(question, optionLabel);
  const unmatchedLabel = optionLabel && !criteria.some((criterion) => criterion.matched) ? optionLabel : null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs font-medium text-slate-500">评分标准</p>
      {criteria.length === 0 ? (
        <p className="mt-1 text-sm text-slate-400">本题没有选项评分标准</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {criteria.map((criterion, index) => (
            <li
              key={index}
              className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-sm ${
                criterion.matched ? "bg-blue-50 font-semibold text-blue-800" : "text-slate-600"
              }`}
            >
              <span className="mt-0.5 w-4 shrink-0" aria-hidden={!criterion.matched}>
                {criterion.matched && <Check size={16} strokeWidth={2.4} aria-label="本题答案" />}
              </span>
              <span className="min-w-0 flex-1 leading-5">{criterion.label}</span>
              <span className="shrink-0 tabular-nums">{criterion.score} 分</span>
            </li>
          ))}
        </ul>
      )}
      {unmatchedLabel && <p className="mt-2 text-xs leading-5 text-slate-500">记录的答案：{unmatchedLabel}</p>}
    </div>
  );
}

/** 逐题追溯展示，不接收也不渲染任何患者直接身份信息。 */
export function TraceView({ sessionId, answers, dialogueTurns = [] }: TraceViewProps) {
  const turnsByQuestion = new Map<string, TraceDialogueTurnDto[]>();
  for (const turn of dialogueTurns) {
    if (!turn.questionId) continue;
    const related = turnsByQuestion.get(turn.questionId) ?? [];
    related.push(turn);
    turnsByQuestion.set(turn.questionId, related);
  }

  const manualCount = answers.filter((answer) => answer.status === "manual" || answer.status === "pending").length;
  const editedCount = answers.filter((answer) => answer.editHistory.length > 0).length;

  return (
    <section id="answer-trace" className="ui-panel scroll-mt-20 overflow-hidden">
      <div className="ui-panel-heading flex-wrap bg-accent/45">
        <div>
          <h2 className="ui-panel-title">答案与采集追溯</h2>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="ui-badge">{answers.length} 道答案</span>
          <span className="ui-badge">{editedCount} 道已修改</span>
          <span className="ui-badge ui-badge-warning">{manualCount} 道待确认</span>
        </div>
      </div>

      <div className="ui-panel-body">
        {answers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-8 text-center">
            <p className="font-medium text-slate-700">暂无可追溯答案</p>
            <p className="mt-1 text-sm text-slate-500">完成采集或医生补录后，将在此显示逐题证据链。</p>
          </div>
        ) : (
          <div className="space-y-3">
            {answers.map((answer) => {
              const question = questionById.get(answer.questionId);
              const scale = scaleByQuestionId.get(answer.questionId);
              const sourceMeta = SOURCE_META[answer.source];
              const statusMeta = STATUS_META[answer.status];
              const relatedTurns = turnsByQuestion.get(answer.questionId) ?? [];
              const scoring = describeAnswerScoring({
                source: answer.source,
                score: answer.score,
                aiJudgment: answer.aiJudgment,
                question,
              });

              return (
                <details key={answer.questionId} className="group overflow-hidden rounded-xl border border-border open:border-primary/35">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3.5 transition hover:bg-slate-50">
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
                      {question?.no ?? answer.questionId}
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-semibold leading-6 text-foreground">
                      <span className="block text-xs font-normal text-muted-foreground">{scale?.name ?? "历史量表"}</span>
                      {question?.standardText ?? "按题目编号核对历史记录"}
                    </span>
                    <ScoreChip scoring={scoring} />
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${sourceMeta.cls}`}>
                      {sourceMeta.label}
                    </span>
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusMeta.cls}`}>
                      {statusMeta.label}
                    </span>
                    <span className="text-xs text-blue-700 group-open:hidden">展开 ＋</span>
                    <span className="hidden text-xs text-blue-700 group-open:inline">收起 −</span>
                  </summary>

                  <div className="space-y-5 border-t border-slate-100 bg-slate-50/60 p-4">
                    <p className="text-xs text-muted-foreground">最近更新 {formatDate(answer.updatedAt)}</p>

                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="space-y-3">
                        <ScoreCard scoring={scoring} />
                        <ScoringCriteria question={question} optionLabel={answer.optionLabel} />
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white p-3 md:col-span-2">
                        <p className="text-xs font-medium text-slate-500">原始回答文本</p>
                        {answer.rawText && /^data:image\/(png|jpeg|webp);base64,/.test(answer.rawText) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={answer.rawText} alt="患者提交的画作" className="mt-2 max-h-60 max-w-full rounded-lg object-contain" loading="lazy" />
                        ) : (
                          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 wrap-anywhere text-slate-700">
                            {answer.rawText || "未记录原始文本"}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-5 lg:grid-cols-2">
                      <div>
                        <h4 className="mb-2 text-xs font-semibold tracking-wide text-slate-600">录音记录</h4>
                        <AudioRecords sessionId={sessionId} answer={answer} turns={relatedTurns} />
                      </div>
                      <div>
                        <h4 className="mb-2 text-xs font-semibold tracking-wide text-slate-600">修改历史</h4>
                        <EditHistory history={answer.editHistory} />
                      </div>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        )}

        <p className="mt-4 text-xs leading-5 text-muted-foreground">原始回答和录音仅在本机医生端查看。</p>
      </div>
    </section>
  );
}
