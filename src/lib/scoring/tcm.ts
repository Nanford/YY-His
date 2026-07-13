/**
 * INPUT:  中医体质辨识 33 题标准答案（1～5 分值）
 * OUTPUT: 体质评估标签集合（可多标签并存），级别：是 / 倾向是 / 基本是
 * POS:    中医体质辨识评分器。纯函数，规则来源：量表题目_Demo.txt"四、中医体质辨识"与"五、中医体质判定规则"。
 */
import { scaleById, type TcmJudgment } from "@/lib/rules";
import { collectScores } from "./common";
import type { AnswersByQuestionId, AssessmentTag, QuestionScoreDetail, ScaleScoreResult } from "./types";

export function scoreTcm(answers: AnswersByQuestionId): ScaleScoreResult {
  const scale = scaleById.get("tcm")!;
  const judgment = scale.judgment as TcmJudgment;
  const { missing, details } = collectScores(scale, scale.questions, answers);
  if (missing.length > 0) {
    return { scaleId: scale.id, scaleName: scale.name, ok: false, missing, tags: [] };
  }

  const detailByNo = new Map(details.map((d) => [Number(d.no), d]));
  const tags: AssessmentTag[] = [];

  // ---- 8 种偏颇体质：对应 4 题得分相加，≥11 是；9～10 倾向是；≤8 否 ----
  // 多个偏颇体质同时命中时全部保留（需求文档：不强制只能选择一个）
  const biasedSums = new Map<string, number>();
  const { yesMin, tendencyMin, tendencyMax } = judgment.biasedThresholds;
  for (const rule of judgment.biased) {
    const ruleDetails = rule.questionNos.map((no) => pickDetail(detailByNo, no));
    const sum = ruleDetails.reduce((acc, d) => acc + d.effectiveScore, 0);
    biasedSums.set(rule.tag, sum);
    if (sum >= yesMin) {
      tags.push({ tag: rule.tag, level: "是", scaleId: scale.id, score: sum, detail: ruleDetails });
    } else if (sum >= tendencyMin && sum <= tendencyMax) {
      tags.push({ tag: rule.tag, level: "倾向是", scaleId: scale.id, score: sum, detail: ruleDetails });
    }
  }

  // ---- 平和质：题 1/2/4/5/13，其中 2/4/5/13 反向计分（6−原始分） ----
  const pingheDetails = judgment.pinghe.questionNos.map((no) =>
    toPingheDetail(pickDetail(detailByNo, no), judgment.pinghe.reverseNos.includes(no))
  );
  const pingheTotal = pingheDetails.reduce((acc, d) => acc + d.effectiveScore, 0);
  const maxBiasedSum = Math.max(...biasedSums.values());
  // 判定：总分≥17 且其他8体质均＜8 → 是；总分≥17 且其他8体质均＜10 → 基本是；其他 → 否
  if (pingheTotal >= judgment.pinghe.totalMin) {
    if (maxBiasedSum < judgment.pinghe.othersMaxForYes) {
      tags.push({ tag: judgment.pinghe.tag, level: "是", scaleId: scale.id, score: pingheTotal, detail: pingheDetails });
    } else if (maxBiasedSum < judgment.pinghe.othersMaxForBasicYes) {
      tags.push({ tag: judgment.pinghe.tag, level: "基本是", scaleId: scale.id, score: pingheTotal, detail: pingheDetails });
    }
  }

  return { scaleId: scale.id, scaleName: scale.name, ok: true, missing: [], tags };
}

function pickDetail(detailByNo: ReadonlyMap<number, QuestionScoreDetail>, no: number): QuestionScoreDetail {
  const detail = detailByNo.get(no);
  if (!detail) {
    throw new Error(`体质判定引用的题号 ${no} 无得分记录（规则数据异常）`);
  }
  return detail;
}

// 平和质反向计分：effectiveScore = 6 − rawScore（来源：量表题目_Demo.txt 平和质判定规则）
function toPingheDetail(base: QuestionScoreDetail, reversed: boolean): QuestionScoreDetail {
  if (!reversed) {
    return { ...base };
  }
  return { ...base, reversed: true, effectiveScore: 6 - base.rawScore };
}
