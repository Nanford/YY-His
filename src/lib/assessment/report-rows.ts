/**
 * INPUT:  本次会话量表 id 列表、评估标签快照（AssessmentResult.tags）、被豁免计分量表（deferred）、
 *         02 表结果标签（rule 原文）与 judgments-v2 判定类型（src/lib/rules/v2）、tag-severity 展示分级
 * OUTPUT: buildReportRows —— 报告「综合评估结果」表的行（评估内容 / 评估结果 / 正常范围 / 提示）；
 *         listExistingProblems —— 「既存问题」清单
 * POS:    下载版报告（2026-11-10，参考「报告输出的样式.png」）的结果表派生口径，纯函数。
 *         只整理展示，不重新评分：评估结果取快照里的量表总分/体质转化分，正常范围取该量表
 *         正常档标签在 02 表的判定规则原文（不自造数值范围），提示取标签名。
 */
import { judgmentByScaleId, resultTagsV2, scaleV2ById, tagV2ByCode } from "@/lib/rules/v2";
import type { AssessmentTag } from "./report-types";
import { isAbnormalTag, isNormalTagCode } from "./tag-severity";

const EMPTY_VALUE = "—";

/** 中医体质标签级别后缀的展示文案（与患者报告页一致） */
const LEVEL_SUFFIX: Record<string, string> = { 是: "", 倾向是: "（倾向）", 基本是: "（基本符合）" };

/** 有单一总分的判定类型：只有这些量表的「评估结果」列展示分数（阴阳性类量表总分无意义，显示占位） */
const SCORE_JUDGMENT_TYPES: ReadonlySet<string> = new Set(["sumRange", "thresholdByEducation", "ladderScore"]);

/** 「提示」列的一条提示（异常项在页面上加▲标红） */
export interface ReportHint {
  text: string;
  abnormal: boolean;
}

/** 结果表的一行 */
export interface ReportRow {
  key: string;
  /** 序号（从 1 起，中医体质各体质行连续编号） */
  no: number;
  /** 评估内容：量表名；中医体质为「量表名·体质名」 */
  title: string;
  /** 评估结果：总分/转化分文本，无分数口径时为占位 */
  resultText: string;
  /** 正常范围：02 表正常档标签的判定规则原文 */
  normalRange: string;
  hints: ReportHint[];
  /** 行级备注：部分计分 / 需医护测量后评定 / 未得出结论 */
  note: string | null;
}

/** 报告页用到的被豁免量表最小形状（AssessmentResult.deferred 元素） */
export interface DeferredScaleRef {
  scaleId: string;
}

function tagLabel(tag: AssessmentTag): string {
  return `${tag.tag}${LEVEL_SUFFIX[tag.level] ?? ""}`;
}

/** 分数文本：最多 1 位小数，去掉多余的 0 */
function formatScore(score: number): string {
  return String(Number(score.toFixed(1)));
}

/** 提示列：异常在前，同级保持快照原顺序 */
function toHints(tags: readonly AssessmentTag[]): ReportHint[] {
  const hints = tags.map((tag) => ({ text: tagLabel(tag), abnormal: isAbnormalTag(tag) }));
  return [...hints.filter((hint) => hint.abnormal), ...hints.filter((hint) => !hint.abnormal)];
}

/** 量表是否有单一总分口径 */
function hasTotalScore(scaleId: string): boolean {
  return (judgmentByScaleId.get(scaleId)?.judgments ?? []).some((judgment) =>
    SCORE_JUDGMENT_TYPES.has(judgment.type)
  );
}

/** 量表是否为中医体质（每个体质独立转化分，按体质拆行） */
function isConstitutionScale(scaleId: string): boolean {
  return (judgmentByScaleId.get(scaleId)?.judgments ?? []).some(
    (judgment) => judgment.type === "tcmConstitutionV2"
  );
}

/** 量表正常范围：该量表全部正常档标签的 02 表规则原文，分号连接；无正常档（或历史量表）给占位 */
function scaleNormalRange(scaleName: string): string {
  const rules = resultTagsV2
    .filter((tag) => tag.scaleName === scaleName && isNormalTagCode(tag.code))
    .map((tag) => tag.rule);
  return rules.length > 0 ? rules.join("；") : EMPTY_VALUE;
}

/**
 * 单个体质的正常范围：偏颇体质取「否」档规则（转化分＜30），平和质取「是」档规则。
 * 标签编码形如 TCM_QI_DEFICIENCY_TENDENCY，去掉级别后缀即体质前缀（来源：result-tags.json 编码规律）。
 */
function constitutionNormalRange(tagCode: string): string {
  const prefix = tagCode.replace(/_(YES|NO|TENDENCY|BASICALLY)$/, "");
  const referenceCode = prefix === "TCM_BALANCED" ? `${prefix}_YES` : `${prefix}_NO`;
  return tagV2ByCode.get(referenceCode)?.rule ?? EMPTY_VALUE;
}

/** 行级备注：零标签时说明原因，部分计分如实标注（Demo 口径 deferClinical） */
function rowNote(hasTags: boolean, deferred: boolean): string | null {
  if (!hasTags) return deferred ? "需医护测量后评定" : "本次未得出结论";
  return deferred ? "部分计分，仅供参考" : null;
}

/**
 * 生成结果表行：按会话量表顺序逐个量表一行；中医体质按体质拆成多行。
 * @param scaleIds 本次会话量表 id（决定行顺序；无标签的量表也占一行，避免"没列出=没问题"的误读）
 */
export function buildReportRows(
  scaleIds: readonly string[],
  tags: readonly AssessmentTag[],
  deferredScales: readonly DeferredScaleRef[]
): ReportRow[] {
  const deferredIds = new Set(deferredScales.map((entry) => entry.scaleId));
  const rows: Omit<ReportRow, "no">[] = [];

  for (const scaleId of scaleIds) {
    const scaleName = scaleV2ById.get(scaleId)?.name ?? scaleId;
    const scaleTags = tags.filter((tag) => tag.scaleId === scaleId);
    const deferred = deferredIds.has(scaleId);

    if (isConstitutionScale(scaleId) && scaleTags.length > 0) {
      for (const tag of scaleTags) {
        rows.push({
          key: `${scaleId}-${tag.code}`,
          // 标签名「气虚质」或「气虚质：否」，冒号前即体质名
          title: `${scaleName}·${tag.tag.split("：")[0]}`,
          resultText: formatScore(tag.score),
          normalRange: constitutionNormalRange(tag.code),
          hints: toHints([tag]),
          note: rowNote(true, deferred),
        });
      }
      continue;
    }

    rows.push({
      key: scaleId,
      title: scaleName,
      resultText:
        scaleTags.length > 0 && hasTotalScore(scaleId) ? formatScore(scaleTags[0].score) : EMPTY_VALUE,
      normalRange: scaleNormalRange(scaleName),
      hints: toHints(scaleTags),
      note: rowNote(scaleTags.length > 0, deferred),
    });
  }

  return rows.map((row, index) => ({ ...row, no: index + 1 }));
}

/** 既存问题：全部异常标签的展示名，按快照顺序、去重 */
export function listExistingProblems(tags: readonly AssessmentTag[]): string[] {
  return [...new Set(tags.filter(isAbnormalTag).map(tagLabel))];
}
