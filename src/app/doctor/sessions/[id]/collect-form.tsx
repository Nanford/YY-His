/**
 * INPUT:  会话勾选的量表、已保存答案（选项 label；画作 rawText）
 * OUTPUT: 量表代填表单（提交至 saveAnswers / finalizeSession）
 * POS:    M2 无语音采集路径与语音链路的兜底补录界面；M9.6/M9.7 扩展数字/多选/图片/画钟确认。
 *         条目来自 V2 题库投影——非正式问题计分条目患者端不提问，由本表单代填。
 */
import { IconArrowRight, IconDeviceFloppy } from "@tabler/icons-react";
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
  const selectedMulti = new Set(
    savedLabel ? savedLabel.split(MULTI_CHOICE_SEP).map((s) => s.trim()).filter(Boolean) : []
  );

  return (
    <div className="border-t border-[#dbe7f6] py-5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <span className="grid h-7 min-w-7 shrink-0 place-items-center rounded-lg bg-blue-50 px-1 text-xs font-extrabold text-blue-700">
          {question.no}
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-bold leading-6 text-[#29496f]">{question.standardText}</p>
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
        </div>
      </div>

      {/* 画钟预览 */}
      {question.answerType === "drawing" && savedRawText?.startsWith("data:image/") && (
        <div className="mt-3 ml-10 max-w-xs overflow-hidden rounded-xl border border-[#dbe7f6] bg-white p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={savedRawText} alt="患者画钟" className="w-full" />
          <p className="mt-1 text-center text-xs text-[#7890b1]">患者提交的画作 · 请在下方点选计分</p>
        </div>
      )}

      {/* Bristol 参照图 */}
      {question.answerType === "imageChoice" && question.imageSrc && (
        <div className="mt-3 ml-10 max-w-md overflow-hidden rounded-xl border border-[#dbe7f6] bg-white p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={question.imageSrc} alt="Bristol 参照" className="mx-auto max-h-40 object-contain" />
        </div>
      )}

      <div className="mt-4 ml-10 flex flex-wrap gap-2">
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
            <label key={option.label} className="ui-choice text-sm">
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
            <label key={option.label} className="ui-choice text-sm">
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
    <form className="space-y-6">
      {selectedScales.map((scale) => (
        <section key={scale.id} className="ui-panel overflow-hidden">
          <div className="ui-panel-heading bg-[#f8fbff]">
            <div>
              <p className="page-eyebrow">ASSESSMENT SCALE</p>
              <h2 className="ui-panel-title">{scale.name}</h2>
              {scale.answerNote && <p className="ui-helper mt-1">{scale.answerNote}</p>}
            </div>
            <span className="ui-badge">{scale.questions.length} 题</span>
          </div>
          <div className="ui-panel-body">
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

      <div className="sticky bottom-4 z-10 flex flex-wrap justify-end gap-3 rounded-2xl border border-[#dbe7f6] bg-white/95 p-3 shadow-[0_14px_30px_rgba(33,87,160,0.14)] backdrop-blur">
        <button formAction={saveAnswers.bind(null, sessionId)} className="ui-button ui-button-secondary">
          <IconDeviceFloppy size={17} aria-hidden="true" />
          保存草稿
        </button>
        <button formAction={finalizeSession.bind(null, sessionId)} className="ui-button ui-button-primary">
          完成采集，生成评估
          <IconArrowRight size={17} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
