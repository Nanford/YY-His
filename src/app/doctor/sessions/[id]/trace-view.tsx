/**
 * INPUT:  已脱离 Prisma 的答案追溯 DTO、关联对话录音 DTO
 * OUTPUT: 逐题标准答案、原始文本、来源、状态、修改历史及录音存储状态
 * POS:    医生端全链路追溯视图；DTO 不包含患者身份字段、ASR 原始载荷或第三方请求数据。
 */
import { questionById, scaleByQuestionId } from "@/lib/rules";

export type TraceAnswerSource = "voice" | "text" | "button" | "doctor" | "measurement";
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
  answers: readonly TraceAnswerDto[];
  dialogueTurns?: readonly TraceDialogueTurnDto[];
}

const SOURCE_META: Record<TraceAnswerSource, { label: string; cls: string }> = {
  voice: { label: "语音作答", cls: "border-blue-200 bg-blue-50 text-blue-700" },
  text: { label: "文字输入", cls: "border-cyan-200 bg-cyan-50 text-cyan-700" },
  button: { label: "快捷按钮", cls: "border-slate-200 bg-slate-50 text-slate-700" },
  doctor: { label: "医生补录", cls: "border-violet-200 bg-violet-50 text-violet-700" },
  measurement: { label: "测量换算", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
};

const STATUS_META: Record<TraceAnswerStatus, { label: string; cls: string }> = {
  confirmed: { label: "已确认", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  pending: { label: "待确认", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  manual: { label: "待人工确认", cls: "border-red-200 bg-red-50 text-red-700" },
  superseded: { label: "已失效", cls: "border-slate-200 bg-slate-100 text-slate-500" },
};

const AUDIO_META: Record<TraceAudioStatus, { label: string; cls: string }> = {
  available: { label: "文件已保存", cls: "bg-emerald-50 text-emerald-700" },
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
  answer,
  turns,
}: {
  answer: TraceAnswerDto;
  turns: readonly TraceDialogueTurnDto[];
}) {
  const patientTurns = turns.filter((turn) => turn.role === "patient");

  if (patientTurns.length === 0) {
    const missingVoice = answer.source === "voice";
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-500">
        <span className={`mr-2 rounded-full px-2 py-0.5 text-xs ${missingVoice ? "bg-red-50 text-red-700" : "bg-slate-100"}`}>
          {missingVoice ? "关联录音缺失" : "未录音"}
        </span>
        {missingVoice ? "未找到与本题关联的患者录音记录。" : "本题通过非语音方式作答。"}
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
            <p className="mt-1.5 break-all font-mono text-xs leading-5 text-slate-600">
              {turn.audioPath ?? "无录音文件路径"}
            </p>
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
          <span className="absolute -left-[19px] top-1.5 size-2 rounded-full bg-blue-500 ring-4 ring-slate-50" />
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

/** 逐题追溯展示，不接收也不渲染任何患者直接身份信息。 */
export function TraceView({ answers, dialogueTurns = [] }: TraceViewProps) {
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
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-950 px-6 py-5 text-white">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-wider text-slate-400">AUDIT TRACE</p>
            <h2 className="mt-1 text-lg font-semibold">答案与采集追溯</h2>
            <p className="mt-1 text-sm leading-6 text-slate-300">逐题核对标准化结果、原始回答、修改记录与录音存储状态。</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1">{answers.length} 道答案</span>
            <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1">{editedCount} 道已修改</span>
            <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1">{manualCount} 道待确认</span>
          </div>
        </div>
      </div>

      <div className="p-6">
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

              return (
                <details key={answer.questionId} className="group overflow-hidden rounded-xl border border-slate-200 open:shadow-md">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3.5 transition hover:bg-slate-50">
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
                      {question?.no ?? answer.questionId}
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-medium leading-6 text-slate-800">
                      {question?.standardText ?? "题目规则已更新，请按题目编号核对历史记录"}
                    </span>
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
                    <p className="text-xs text-slate-500">
                      所属量表：{scale?.name ?? "历史量表"} · 最近更新：{formatDate(answer.updatedAt)}
                    </p>

                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <p className="text-xs font-medium text-slate-500">标准答案</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">{answer.optionLabel ?? "待确认"}</p>
                        <p className="mt-1 text-xs text-slate-400">标准分值：{answer.score ?? "—"}</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white p-3 md:col-span-2">
                        <p className="text-xs font-medium text-slate-500">原始回答文本</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                          {answer.rawText || "未记录原始文本"}
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-5 lg:grid-cols-2">
                      <div>
                        <h4 className="mb-2 text-xs font-semibold tracking-wide text-slate-600">录音记录</h4>
                        <AudioRecords answer={answer} turns={relatedTurns} />
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

        <p className="mt-4 text-xs leading-5 text-slate-400">
          本视图不主动拼接患者基础身份字段；原始回答可能包含患者自主陈述的信息，仅限本地医生端查看。
        </p>
      </div>
    </section>
  );
}
