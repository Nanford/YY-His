/**
 * INPUT:  会话勾选的量表、已保存答案（选项 label）
 * OUTPUT: 量表代填表单（提交至 saveAnswers / finalizeSession）
 * POS:    M2 无语音采集路径与语音链路的兜底补录界面；题面保留标准题目及数字医生话术预览。
 *         M9-B 装机：条目来自 V2 题库投影（rules/index.ts）——「条目类型 ≠ 正式问题」的计分条目
 *         （系统读取/逻辑计算/操作测试/绘图操作等）患者端不提问，由本表单代填；选项按 label 提交
 *         （IADL 等存在同分选项，按分值提交无法区分）。
 */
import { IconArrowRight, IconDeviceFloppy, IconMessageCircle } from "@tabler/icons-react";
import { optionsOf, scales, type Scale, type ScaleQuestion } from "@/lib/rules";
import { finalizeSession, saveAnswers } from "@/lib/actions/doctor";

interface Props {
  sessionId: string;
  patientId: string;
  scaleIds: string[];
  savedLabels: ReadonlyMap<string, string>;
}

function QuestionBlock({
  scale,
  question,
  savedLabel,
}: {
  scale: Scale;
  question: ScaleQuestion;
  savedLabel: string | undefined;
}) {
  return (
    <div className="border-t border-[#dbe7f6] py-5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <span className="grid h-7 min-w-7 shrink-0 place-items-center rounded-lg bg-blue-50 px-1 text-xs font-extrabold text-blue-700">
          {question.no}
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-bold leading-6 text-[#29496f]">{question.standardText}</p>
          <p className="inline-flex items-start gap-1.5 text-xs leading-5 text-[#7890b1]">
            <IconMessageCircle size={15} className="mt-0.5 shrink-0 text-blue-500" aria-hidden="true" />
            数字医生话术：{question.colloquialText}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {question.observerAssisted && (
              <span className="ui-badge">需医生评估{question.entryType ? `（${question.entryType}）` : ""}，患者端不提问</span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 ml-10 flex flex-wrap gap-2">
        {optionsOf(scale, question).map((option) => (
          <label key={option.label} className="ui-choice text-sm">
            <input
              type="radio"
              name={`answer.${question.id}`}
              value={option.label}
              defaultChecked={savedLabel === option.label}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function CollectForm({ sessionId, scaleIds, savedLabels }: Props) {
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
          <div className="ui-panel-body">{scale.questions.map((question) => (
            <QuestionBlock
              key={question.id}
              scale={scale}
              question={question}
              savedLabel={savedLabels.get(question.id)}
            />
          ))}</div>
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
