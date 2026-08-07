/**
 * INPUT:  tcmConstitutionV2 判定配置（judgments-v2.json）、条目标准答案
 * OUTPUT: 中医体质 9 种体质判定结果（每体质必落一档：是/倾向是/否，平和质是/基本是/否）
 * POS:    V2 评分引擎判定器之一。
 *         来源：02 表「中医体质辨识」27 条判定规则；转化分公式（原始分合计−适用题数）/（适用题数×4）×100
 *         按国标推定（任务清单「待拍板」节已登记）；湿热质 A.6-3/A.6-4 性别互斥题按不适用剔出分母。
 */
import type { ScaleV2, TcmConstitutionJudgmentV2 } from "@/lib/rules/v2";
import { excludedDetail, partitionMissingV2, resolveAnswerScore, tagResult } from "./common";
import type {
  AnswersV2,
  ConstitutionScoreDetail,
  ItemScoreDetail,
  ScaleScoreResultV2,
  ScoreOptionsV2,
} from "./types";

/** 浮点转化分比较容差（41.666…/33.333… 等循环小数与阈值 40/30/60 比较时防精度误判） */
const EPS = 1e-9;
const ge = (a: number, b: number): boolean => a >= b - EPS;
const lt = (a: number, b: number): boolean => a < b - EPS;

/** 转化分 = (原始分合计 − 适用题数) / (适用题数 × 4) × 100 */
function transformedScore(rawSum: number, applicableCount: number): number {
  if (applicableCount === 0) {
    throw new Error("体质适用题数为 0，无法计算转化分（答案数据异常）");
  }
  return ((rawSum - applicableCount) / (applicableCount * 4)) * 100;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

export function scoreTcmConstitution(
  scale: ScaleV2,
  judgment: TcmConstitutionJudgmentV2,
  answers: AnswersV2,
  opts: ScoreOptionsV2
): ScaleScoreResultV2 {
  const scoredIds = new Set([...judgment.balanced.questionIds, ...judgment.biased.flatMap((b) => b.questionIds)]);
  const details: ItemScoreDetail[] = [];
  const missingIds: string[] = [];
  // 条目 id → 得分（仅已答且适用的计分题）
  const scoreByItemId = new Map<string, number>();

  for (const item of scale.items) {
    if (!scoredIds.has(item.id)) {
      // 纯复用行（A.2-1/A.3-3/A.8-1，直接复用同变量题目答案，不重复提问也不单独计分）
      details.push(excludedDetail(item));
      continue;
    }
    const answer = answers[item.id];
    if (answer === undefined) {
      missingIds.push(item.id);
      details.push({ itemId: item.id, no: item.no, text: item.text, answerLabel: null, score: null, excluded: false });
      continue;
    }
    const resolved = resolveAnswerScore(item, answer);
    if (resolved.na) {
      // 不适用（如湿热质性别互斥题）：从「适用题数」剔除，不计原始分
      details.push({
        itemId: item.id, no: item.no, text: item.text,
        answerLabel: resolved.answerLabel, score: null, excluded: true,
      });
      continue;
    }
    scoreByItemId.set(item.id, resolved.score!);
    details.push({
      itemId: item.id, no: item.no, text: item.text,
      answerLabel: resolved.answerLabel, score: resolved.score, excluded: false,
    });
  }

  // 中医 27 个计分题均为正式问题，缺失一律阻断（无 deferClinical 豁免）；保留分组逻辑与引擎口径一致
  const { blocking, deferred } = partitionMissingV2(scale, missingIds, opts.deferClinical ?? false);
  const ok = blocking.length === 0;
  if (!ok) {
    return { scaleId: scale.id, ok, missing: blocking, deferred, totalScore: null, tags: [], details, partial: false };
  }

  const t = judgment.thresholds;
  /** 单体质原始分合计 / 适用题数 / 转化分 */
  const statOf = (questionIds: string[]): { rawSum: number; n: number; score: number } => {
    let rawSum = 0;
    let n = 0;
    for (const id of questionIds) {
      const s = scoreByItemId.get(id);
      if (s !== undefined) {
        rawSum += s;
        n++;
      }
    }
    return { rawSum, n, score: transformedScore(rawSum, n) };
  };

  const constitutions: ConstitutionScoreDetail[] = [];
  // 先算 8 种偏颇体质（平和质判定依赖其他 8 种转化分）
  const biasedScores: number[] = [];
  const biasedDetails = judgment.biased.map((b) => {
    const { rawSum, n, score } = statOf(b.questionIds);
    biasedScores.push(score);
    // 来源：02 表「转化分≥40分=是／30～39分=倾向是／＜30分=否」
    const tagCode = ge(score, t.biasedYesMin) ? b.tagCodes.yes : ge(score, t.biasedTendencyMin) ? b.tagCodes.tendency : b.tagCodes.no;
    return { key: b.key, rawSum, applicableCount: n, transformedScore: round1(score), tagCode };
  });

  const b = statOf(judgment.balanced.questionIds);
  const allBelow = (max: number): boolean => biasedScores.every((s) => lt(s, max));
  // 来源：02 表「平和质转化分≥60分且其他8种均＜30分=是；≥60且其他均＜40（不满足是）=基本是；否则=否」
  const balancedTag = ge(b.score, t.balancedMin) && allBelow(t.othersMaxForYes)
    ? judgment.balanced.tagCodes.yes
    : ge(b.score, t.balancedMin) && allBelow(t.othersMaxForBasically)
      ? judgment.balanced.tagCodes.basically
      : judgment.balanced.tagCodes.no;
  const balancedDetail: ConstitutionScoreDetail = {
    key: "balanced",
    rawSum: b.rawSum,
    applicableCount: b.n,
    transformedScore: round1(b.score),
    tagCode: balancedTag,
  };

  constitutions.push(balancedDetail, ...biasedDetails);
  return {
    scaleId: scale.id,
    ok: true,
    missing: [],
    deferred: [],
    totalScore: null,
    tags: constitutions.map((c) => tagResult(c.tagCode)),
    details,
    partial: false,
    constitutions,
  };
}
