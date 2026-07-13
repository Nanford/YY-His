/**
 * INPUT:  会话勾选的量表、已保存答案、患者测量数据
 * OUTPUT: 量表代填表单（提交至 saveAnswers / finalizeSession）
 * POS:    M2 无语音采集路径 + 语音链路的兜底与补录界面。
 *         题面展示标准题目，附数字医生口语话术预览（M3 播报用的同一套文案）。
 */
import Link from "next/link";
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
    <div className="py-4 border-t border-slate-100 first:border-t-0">
      <div className="flex items-start gap-2">
        <span className="shrink-0 rounded bg-slate-100 text-slate-500 text-xs px-1.5 py-0.5 mt-0.5">
          {question.no}
        </span>
        <div className="space-y-1 flex-1">
          <p className="text-sm font-medium leading-relaxed">{question.standardText}</p>
          <p className="text-xs text-slate-400">🗣️ 数字医生话术：{question.colloquialText}</p>
          {question.observerAssisted && (
            <span className="inline-block rounded bg-purple-50 text-purple-600 text-xs px-1.5 py-0.5">
              可由医生辅助观察填写
            </span>
          )}
          {question.altOf && (
            <span className="inline-block rounded bg-slate-100 text-slate-500 text-xs px-1.5 py-0.5">
              替代题：仅当无法获得 BMI 时填写（与 F 题二选一，优先 F）
            </span>
          )}
        </div>
      </div>
      {measurement ? (
        <div className="mt-2 ml-8">
          {measurement.status === "confirmed" && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              <span className="font-medium">系统按本地测量值换算：</span>
              {measurement.optionLabel}（{measurement.score} 分）
              {measurement.rawText && <span className="ml-2 text-xs text-green-700">{measurement.rawText}</span>}
            </div>
          )}
          {measurement.status === "superseded" && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
              本题本次不参与计分：{measurement.reason}
            </div>
          )}
          {measurement.status === "manual" && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <p>待人工确认：{measurement.reason}</p>
              <Link href={`/doctor/patients/${patientId}`} className="mt-1 inline-block font-medium text-blue-700 hover:underline">
                前往患者页补录测量数据 →
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-2 ml-8 flex flex-wrap gap-2">
          {optionsOf(scale, question).map((opt) => (
            <label
              key={opt.label}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm cursor-pointer hover:bg-blue-50 has-checked:border-blue-500 has-checked:bg-blue-50"
            >
              <input
                type="radio"
                name={`answer.${question.id}`}
                value={opt.score}
                defaultChecked={savedScore === opt.score}
                className="accent-blue-600"
              />
              {opt.label}
              <span className="text-xs text-slate-400">（{opt.score}分）</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function CollectForm({ sessionId, patientId, scaleIds, savedScores, patient }: Props) {
  const selectedScales = scales.filter((s) => scaleIds.includes(s.id));
  const measurementByQuestionId = new Map<string, MeasurementAnswerResolution>(
    resolveMeasurementAnswers(patient, scaleIds).map((answer) => [answer.questionId, answer])
  );
  return (
    <form className="space-y-6">
      {selectedScales.map((scale) => (
        <section key={scale.id} className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="font-semibold">{scale.name}</h2>
          {scale.answerNote && <p className="text-xs text-slate-400 mt-1">{scale.answerNote}</p>}
          <div className="mt-3">
            {scale.questions.map((q) => (
              <QuestionBlock
                key={q.id}
                scale={scale}
                question={q}
                savedScore={savedScores.get(q.id)}
                patientId={patientId}
                measurement={measurementByQuestionId.get(q.id)}
              />
            ))}
          </div>
        </section>
      ))}

      <div className="sticky bottom-0 bg-white/90 backdrop-blur border-t border-slate-200 -mx-6 px-6 py-3 flex justify-end gap-3">
        <button
          formAction={saveAnswers.bind(null, sessionId)}
          className="rounded-lg border border-slate-300 px-5 py-2 text-sm hover:bg-slate-50"
        >
          保存草稿
        </button>
        <button
          formAction={finalizeSession.bind(null, sessionId)}
          className="rounded-lg bg-blue-600 text-white px-5 py-2 text-sm font-medium hover:bg-blue-700"
        >
          完成采集，生成评估 →
        </button>
      </div>
    </form>
  );
}
