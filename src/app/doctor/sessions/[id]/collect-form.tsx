/**
 * INPUT:  会话勾选的量表、已保存答案、患者测量数据
 * OUTPUT: 量表代填表单（提交至 saveAnswers / finalizeSession）
 * POS:    M2 无语音采集路径 + 语音链路的兜底与补录界面。
 *         题面展示标准题目，附数字医生口语话术预览（M3 播报用的同一套文案）。
 */
import { optionsOf, scales, type Scale, type ScaleQuestion } from "@/lib/rules";
import { finalizeSession, saveAnswers } from "@/lib/actions/doctor";

interface PatientMeasurements {
  heightCm: number | null;
  weightKg: number | null;
  waistCm: number | null;
  calfCm: number | null;
}

interface Props {
  sessionId: string;
  scaleIds: string[];
  savedScores: ReadonlyMap<string, number>;
  patient: PatientMeasurements;
}

/** 测量数据提示：告诉医生该题应依据的实测值，缺失时给出补录指引 */
function measurementHint(q: ScaleQuestion, p: PatientMeasurements): string | null {
  if (q.measurement === "bmi") {
    if (p.heightCm && p.weightKg) {
      const bmi = (p.weightKg / (p.heightCm / 100) ** 2).toFixed(1);
      return `当前测量：身高 ${p.heightCm} cm，体重 ${p.weightKg} kg → BMI ${bmi}`;
    }
    return "未录入身高/体重，请在患者页补录后按 BMI 选档（MNA-SF 可改用 F替代）";
  }
  if (q.measurement === "waist") {
    return p.waistCm ? `当前测量：腹围 ${p.waistCm} cm` : "未录入腹围，请在患者页补录后选档";
  }
  if (q.measurement === "calf") {
    return p.calfCm ? `当前测量：小腿围 ${p.calfCm} cm` : "未录入小腿围（仅当无法获得 BMI 时需要）";
  }
  return null;
}

function QuestionBlock({
  scale,
  question,
  savedScore,
  patient,
}: {
  scale: Scale;
  question: ScaleQuestion;
  savedScore: number | undefined;
  patient: PatientMeasurements;
}) {
  const hint = measurementHint(question, patient);
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
          {hint && <p className="text-xs text-blue-600">{hint}</p>}
        </div>
      </div>
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
    </div>
  );
}

export function CollectForm({ sessionId, scaleIds, savedScores, patient }: Props) {
  const selectedScales = scales.filter((s) => scaleIds.includes(s.id));
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
                patient={patient}
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
