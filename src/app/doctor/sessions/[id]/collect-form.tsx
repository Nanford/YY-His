/**
 * INPUT:  会话勾选的量表、已保存答案、患者测量数据
 * OUTPUT: 量表代填表单（提交至 saveAnswers / finalizeSession）
 * POS:    M2 无语音采集路径与语音链路的兜底补录界面；题面保留标准题目及数字医生话术预览
 */
import Link from "next/link";
import { IconArrowRight, IconDeviceFloppy, IconMessageCircle, IconRulerMeasure } from "@tabler/icons-react";
import { optionsOf, scales, type Scale, type ScaleQuestion } from "@/lib/rules";
import { finalizeSession, saveAnswers } from "@/lib/actions/doctor";
import {
  resolveMeasurementAnswers,
  type MeasurementAnswerResolution,
  type PatientMeasurements,
} from "@/lib/assessment/measurements";

interface Props {
  sessionId: string;
  patientId: string;
  scaleIds: string[];
  savedScores: ReadonlyMap<string, number>;
  patient: PatientMeasurements;
}

function QuestionBlock({
  scale,
  question,
  savedScore,
  patientId,
  measurement,
}: {
  scale: Scale;
  question: ScaleQuestion;
  savedScore: number | undefined;
  patientId: string;
  measurement?: MeasurementAnswerResolution;
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
            {question.observerAssisted && <span className="ui-badge">可由医生辅助观察填写</span>}
            {question.altOf && <span className="ui-badge">替代题：仅当无法获得 BMI 时填写（与 F 题二选一，优先 F）</span>}
          </div>
        </div>
      </div>

      {measurement ? (
        <div className="mt-3 ml-10">
          {measurement.status === "confirmed" && (
            <div className="ui-alert text-sm">
              <IconRulerMeasure size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                <strong>系统按本地测量值换算：</strong>
                {measurement.optionLabel}（{measurement.score} 分）
                {measurement.rawText && <span className="ml-2 text-xs">{measurement.rawText}</span>}
              </span>
            </div>
          )}
          {measurement.status === "superseded" && <div className="ui-alert text-sm">本题本次不参与计分：{measurement.reason}</div>}
          {measurement.status === "manual" && (
            <div className="ui-alert ui-alert-warning text-sm">
              <div>
                <p>待人工确认：{measurement.reason}</p>
                <Link href={`/doctor/patients/${patientId}`} className="mt-1 inline-flex items-center gap-1 font-bold text-blue-700 hover:text-blue-800">
                  前往患者页补录测量数据
                  <IconArrowRight size={15} aria-hidden="true" />
                </Link>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 ml-10 flex flex-wrap gap-2">
          {optionsOf(scale, question).map((option) => (
            <label key={option.label} className="ui-choice text-sm">
              <input
                type="radio"
                name={`answer.${question.id}`}
                value={option.score}
                defaultChecked={savedScore === option.score}
              />
              <span>{option.label}</span>
              <span className="text-xs text-[#8498b5]">（{option.score} 分）</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function CollectForm({ sessionId, patientId, scaleIds, savedScores, patient }: Props) {
  const selectedScales = scales.filter((scale) => scaleIds.includes(scale.id));
  const measurementByQuestionId = new Map<string, MeasurementAnswerResolution>(
    resolveMeasurementAnswers(patient, scaleIds).map((answer) => [answer.questionId, answer])
  );

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
              savedScore={savedScores.get(question.id)}
              patientId={patientId}
              measurement={measurementByQuestionId.get(question.id)}
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
