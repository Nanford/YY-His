/**
 * INPUT:  会话勾选的量表、已保存答案（选项 label；画作 rawText）
 * OUTPUT: 量表代填表单（提交至 saveAnswers / finalizeSession）
 * POS:    M2 无语音采集路径与语音链路的兜底补录界面；M9.6/M9.7 扩展数字/多选/图片/画钟确认。
 *         条目来自 V2 题库投影——非正式问题计分条目患者端不提问，由本表单代填。
 *         2026-11-11 看图识物题（MMSE 命名）改为患者端出题，本表单展示同一张图片供核对与改判。
 */
import { ArrowRight, ClipboardList, Save } from "lucide-react";
import { MULTI_CHOICE_SEP, optionsOf, scales, type Scale, type ScaleQuestion } from "@/lib/rules";
import { finalizeSession, saveAnswers } from "@/lib/actions/doctor";

interface Props {
  sessionId: string;
  patientId: string;
  scaleIds: string[];
  /** 已保存的选项 label（多选为 MULTI_CHOICE_SEP 拼接） */
  savedLabels: ReadonlyMap<string, string>;
  /** 画钟等 rawText（data URL），供医生确认时预览 */
  savedRawTexts?: ReadonlyMap<string, string>;
}

function QuestionBlock({
  scale,
  question,
  savedLabel,
  savedRawText,
}: {
  scale: Scale;
  question: ScaleQuestion;
  savedLabel: string | undefined;
  savedRawText: string | undefined;
}) {
  const options = optionsOf(scale, question);
  const hasVisualAnswer = question.answerType === "drawing" || question.answerType === "imageChoice";
  const selectedMulti = new Set(
    savedLabel ? savedLabel.split(MULTI_CHOICE_SEP).map((s) => s.trim()).filter(Boolean) : []
  );

  return (
    <div className={`border-t border-border px-4 py-4 first:border-t-0 sm:px-5 ${
      hasVisualAnswer ? "" : "grid gap-2 @min-[46rem]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @min-[46rem]:items-start"
    }`}>
      <div className="flex items-start gap-3">
        <span className="grid h-7 min-w-7 shrink-0 place-items-center rounded-lg bg-blue-50 px-1 text-xs font-extrabold text-blue-700">
          {question.no}
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p id={`question-${question.id}`} className="text-sm font-bold leading-6 text-foreground">{question.standardText}</p>
          {question.colloquialText && question.colloquialText !== question.standardText && (
            <details className="text-xs text-muted-foreground">
              <summary className="w-fit cursor-pointer font-medium text-primary">查看问询话术</summary>
              <p className="mt-1 leading-5">{question.colloquialText}</p>
            </details>
          )}
          <div className="flex flex-wrap gap-1.5">
            {question.observerAssisted && (
              <span className="ui-badge">
                需医生评估{question.entryType ? `（${question.entryType}）` : ""}，患者端不提问
              </span>
            )}
            {question.answerType === "drawing" && (
              <span className="ui-badge ui-badge-warning">画钟：请对照画作确认计分</span>
            )}
            {question.answerType === "multiChoice" && <span className="ui-badge">可多选</span>}
            {question.answerType === "number" && <span className="ui-badge">数字题</span>}
          </div>
          {/* 看图识物（MMSE 命名）：患者端展示的图片，医生代填/改判时对照 */}
          {question.imageSrc && question.answerType !== "imageChoice" && (
            <div className="w-fit overflow-hidden rounded-xl border border-[#dbe7f6] bg-white p-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={question.imageSrc} alt="患者端展示的图片" className="size-20" />
            </div>
          )}
        </div>
      </div>

      {/* 画钟预览 */}
      {question.answerType === "drawing" && savedRawText?.startsWith("data:image/") && (
        <div className="mt-3 ml-10 max-w-xs overflow-hidden rounded-xl border border-[#dbe7f6] bg-white p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={savedRawText} alt="患者画钟" className="w-full" />
          {/* 2026-11-10：画图题先由视觉模型看图判定，已有结论时医生核对即可，可在下方改判 */}
          <p className="mt-1 text-center text-xs text-[#7890b1]">
            {savedLabel
              ? "患者提交的画作 · 已有判定（下方已选中），请核对，可改判"
              : "患者提交的画作 · 请在下方点选计分"}
          </p>
        </div>
      )}

      {/* Bristol 参照图 */}
      {question.answerType === "imageChoice" && question.imageSrc && (
        <div className="mt-3 ml-10 max-w-md overflow-hidden rounded-xl border border-[#dbe7f6] bg-white p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={question.imageSrc} alt="Bristol 参照" className="mx-auto max-h-40 object-contain" />
        </div>
      )}

      <div role="group" aria-labelledby={`question-${question.id}`} className={`flex flex-wrap gap-2 sm:ml-10 ${
        hasVisualAnswer ? "mt-3" : "@min-[46rem]:ml-2"
      }`}>
        {question.answerType === "number" ? (
          <label className="flex items-center gap-2 text-sm font-bold text-[#29496f]">
            分值
            <input
              type="number"
              name={`answer.${question.id}`}
              min={question.numberMin ?? 0}
              max={question.numberMax ?? 10}
              defaultValue={
                savedLabel
                  ? options.find((o) => o.label === savedLabel)?.score ?? question.numberMin ?? 0
                  : undefined
              }
              className="ui-input w-28"
              // 用 data-number-options 让提交时映射到 label——表单直接存 score 时由服务端反查
              data-number-question={question.id}
            />
            <span className="text-xs font-normal text-[#7890b1]">
              （{question.numberMin ?? 0}～{question.numberMax ?? 10}）
            </span>
          </label>
        ) : question.answerType === "multiChoice" ? (
          options.map((option) => (
            <label key={option.label} className="ui-choice min-h-10 rounded-lg px-3 text-sm">
              <input
                type="checkbox"
                name={`answer.${question.id}`}
                value={option.label}
                defaultChecked={selectedMulti.has(option.label)}
              />
              <span>{option.label}</span>
            </label>
          ))
        ) : (
          options.map((option) => (
            <label key={option.label} className="ui-choice min-h-10 rounded-lg px-3 text-sm">
              <input
                type="radio"
                name={`answer.${question.id}`}
                value={option.label}
                defaultChecked={savedLabel === option.label}
              />
              <span>{option.label}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

export function CollectForm({ sessionId, scaleIds, savedLabels, savedRawTexts }: Props) {
  const selectedScales = scales.filter((scale) => scaleIds.includes(scale.id));

  return (
    <form className="space-y-4">
      {selectedScales.map((scale, index) => (
        <section key={scale.id} id={`collect-${scale.id}`} className="ui-panel scroll-mt-20 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-border bg-accent/45 px-4 py-3 sm:px-5">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-card font-mono text-sm font-bold text-primary" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="ui-panel-title">{scale.name}</h2>
              {scale.answerNote && <p className="ui-helper mt-1">{scale.answerNote}</p>}
            </div>
            <span className="ui-badge">{scale.questions.length} 题</span>
          </div>
          <div className="@container">
            {scale.questions.map((question) => (
              <QuestionBlock
                key={question.id}
                scale={scale}
                question={question}
                savedLabel={savedLabels.get(question.id)}
                savedRawText={savedRawTexts?.get(question.id)}
              />
            ))}
          </div>
        </section>
      ))}

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-border bg-card p-2.5 shadow-lg shadow-blue-950/10">
        <span className="mr-auto inline-flex items-center gap-2 px-2 text-sm font-semibold text-muted-foreground">
          <ClipboardList className="size-4 text-primary" aria-hidden="true" /> {selectedScales.length} 个量表
        </span>
        <button formAction={saveAnswers.bind(null, sessionId)} className="ui-button ui-button-secondary">
          <Save size={17} aria-hidden="true" />
          保存草稿
        </button>
        <button formAction={finalizeSession.bind(null, sessionId)} className="ui-button ui-button-primary">
          完成采集，生成评估
          <ArrowRight size={17} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
