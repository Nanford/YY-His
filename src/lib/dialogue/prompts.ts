/**
 * INPUT:  题目定义（口语版/复问版文案来自 data/scales-v2.json，预生成 + 人工可审）
 * OUTPUT: 开场白/结束语常量、旁白文案简化覆盖、追问与轮末复问话术拼装函数
 * POS:    数字医生全部播报文案的唯一出处。固定模板 + 预生成文案拼装，
 *         现场不让 LLM 自由发挥（AGENTS.md：保证不改变医学含义）。
 *         注意：播报文本会发往火山 TTS，禁止拼入患者姓名等 PII（硬约束 1）。
 */
import { displayOptionLabel, type QuestionOption, type ScaleQuestion } from "@/lib/rules";
import type { NarrationV2 } from "@/lib/rules/v2";
import { isFreeResponseItem, spokenTextOverride } from "./cognitive-flow";

/**
 * 开场白（讲解 + 征求"开始"）：数字医生先说明本次评估的内容，末尾以一句"好吗？您说声
 * '开始'就行"征求患者口头确认——患者应答后才进入第一题（intro 阶段，见 service.ts）。
 * 不称呼姓名（文本出网做 TTS，且统一文案可命中哈希缓存）。
 */
export const OPENING_TEXT =
  "您好，我是数字医生。下面问您几个问题，没听清可以让我重复。准备好就说“开始”。";

/**
 * 结束语：问答全部完成后播报。是否已生成报告、还是需要医生协助补充信息，
 * 由患者端界面在此之后另行展示，不在这句固定播报里预判结果。
 */
export const CLOSING_TEXT = "问题都问完了，谢谢配合！";

/**
 * 量表切换过渡句池（2026-09-13 用户拍板：量表题目之前的开场白/过渡句不播报量表名称，
 * 用日常交流的话、减少专业名词）。有锚定旁白的量表直接播旁白本身（已是口语过渡句）；
 * 无锚定旁白的量表在首题前从这里按顺序轮换取一句注入，避免每段都重复同一句话。
 */
export const SCALE_TRANSITION_TEXTS: readonly string[] = [
  "好的，我们接着聊。",
  "接下来再了解几个方面。",
  "我们继续，还有几个问题。",
];

/**
 * 无锚定旁白量表的专题过渡句（2026-09-13 用户拍板：量表题目之前要简要说明内容，
 * 示例：mnasf → "下面问问您的营养情况。"）：用日常交流的话点出接下来聊哪方面，
 * 不出现量表名称/英文缩写等专业名词。未配置的量表回退到 SCALE_TRANSITION_TEXTS 轮换池。
 * 纯测量/医护观察量表（calf/grip/gait_speed/dxa_bia 等）在患者端无题可问，
 * buildTimeline 整体跳过，不会播到这些句子。
 */
export const SCALE_TRANSITION_OVERRIDES: ReadonlyMap<string, string> = new Map([
  ["iadl", "下面问问您平时做饭、买东西、打电话这些日常事的情况。"],
  ["motor_screen", "下面看看您平时活动、起身走路方不方便。"],
  ["visual_function", "下面再问问您看东西清不清楚。"],
  ["depression_2q", "下面问问您最近的心情。"],
  ["gds15", "下面再仔细问问您最近的心情。"],
  ["gad7", "下面再细问一下您最近紧张、担心的情况。"],
  ["morse", "下面再了解一下您起身、走路稳不稳。"],
  ["frail", "下面问问您最近的活动情况。"],
  ["ui_2q", "下面问问您平时小便憋不憋得住。"],
  ["iciq", "下面再细问一下小便方面的情况。"],
  ["constipation_1q", "下面问问您平时大便顺不顺。"],
  ["constipation_symptom", "下面再细问一下大便的情况。"],
  ["sleep_1q", "下面问问您晚上睡得好不好。"],
  ["ais", "下面再细问一下您睡觉的情况。"],
  ["pain_1q", "下面问问您身上有没有经常疼的地方。"],
  ["pain_nrs", "下面请您说说疼得厉害不厉害。"],
  ["pressure_screen", "下面看看您有没有久卧久坐、皮肤压红压破的情况。"],
  ["dysphagia_screen", "下面问问您吃饭喝水咽得顺不顺。"],
  ["nrs2002", "下面问问您最近吃饭和体重变化的情况。"],
  ["mnasf", "下面问问您的营养情况。"],
  ["glim", "下面再了解一下您的饭量、体重和身上肌肉的情况。"],
  ["grip", "下面测一下您手的力气，请配合医护人员。"],
  ["gait_speed", "下面请您走几步，测一下走路的快慢。"],
  ["dxa_bia", "下面用仪器测一下肌肉情况，请配合医护人员。"],
  ["cam", "下面由医护人员观察了解一些情况，请您配合。"],
]);

/**
 * 专题过渡句的语境省略（2026-09-14 用户拍板"门诊简版包啰嗦过渡句删除"）：
 * 过渡句是否突兀取决于同会话有没有关联量表，满足条件时该量表的过渡句整条不播。
 * - depression_2q「下面问问您最近的心情。」：minicog 在会话时其锚定旁白 narr_50 已说
 *   「下面问问您的记忆和心情。」，再播即重复 → conflictsWith minicog；
 * - ais「下面再细问一下您睡觉的情况。」：「再细问」以 sleep_1q 为前题，会话无 sleep_1q
 *   时没头没尾 → requires sleep_1q。
 */
export const SCALE_TRANSITION_CONTEXT_SKIP: ReadonlyMap<
  string,
  { conflictsWith?: string; requires?: string }
> = new Map([
  ["depression_2q", { conflictsWith: "minicog" }],
  ["ais", { requires: "sleep_1q" }],
]);

/** 该量表的专题过渡句在本次会话量表集合下是否应省略（来源：SCALE_TRANSITION_CONTEXT_SKIP） */
export function scaleTransitionSkipped(scaleId: string, sessionScaleIds: readonly string[]): boolean {
  const rule = SCALE_TRANSITION_CONTEXT_SKIP.get(scaleId);
  if (!rule) return false;
  if (rule.requires) return !sessionScaleIds.includes(rule.requires);
  if (rule.conflictsWith) return sessionScaleIds.includes(rule.conflictsWith);
  return false;
}

/**
 * 过渡句整条删除（2026-09-15 修改.docx ③：情绪筛查（焦虑）量表的开场白删掉）：
 * 与语境省略（SCALE_TRANSITION_CONTEXT_SKIP）不同，这些量表在任何会话下都不播
 * 过渡句、也不回退到轮换池，直接开问。
 */
const SCALE_TRANSITION_SUPPRESSED_IDS: ReadonlySet<string> = new Set(["anxiety_2q"]);

/** 该量表的过渡句是否被整条删除（来源：SCALE_TRANSITION_SUPPRESSED_IDS） */
export function scaleTransitionSuppressed(scaleId: string): boolean {
  return SCALE_TRANSITION_SUPPRESSED_IDS.has(scaleId);
}

/**
 * 旁白文案简化覆盖（2026-09-12 用户要求：开场白、过渡句改简单一些）。
 * 01 表原文案保留在 data/scales-v2.json（只读医学源不改），播报/展示时在编排层替换；
 * 只简化措辞、缩短句子，流程含义不变（安全提示如"不舒服就马上停下"保留）。
 */
const NARRATION_TEXT_OVERRIDES: ReadonlyMap<string, string> = new Map([
  // （总开场 narr_3 与工具说明 narr_51 已于 2026-09-13 编排层删除，见下方 NARRATION_SUPPRESSED_IDS）
  // 分类过渡
  ["narr_4", "先问您的生活和身体情况。"],
  ["narr_50", "下面问问您的记忆和心情。"],
  ["narr_114", "下面问问您和家人朋友的来往，还有家里住着方不方便、安不安全。"],
  ["narr_136", "下面问几个老年人常见的健康问题。"],
  ["narr_230", "最后问问您平时的身体感觉。"],
  // 工具说明
  ["narr_24", "下面做几个动作：站一站、走几步、从椅子上站起。不舒服就马上停下。"],
  ["narr_30", "下面问看东西的情况。戴眼镜就按戴镜时回答。"],
  ["narr_39", "下面问听声音的情况。戴助听器就按戴时回答。"],
  ["narr_45", "下面做个听力小测试，请重复您听到的词。"],
  ["narr_55", "下面会问时间、地点、记忆和计算的问题。"],
  ["narr_113", "下面问您和家人朋友来往多不多，见面、打电话、发微信都算。"],
  ["narr_121", "下面问您在家走路、洗澡、上下台阶是否方便安全。"],
  ["narr_178", "这一部分由医护人员观察记录，您不用回答。"],
  ["narr_185", "这一部分由医护人员评估记录，您不用回答。"],
  ["narr_192", "下面核对一下您正在吃的药，西药、中成药、保健品都算。"],
  ["narr_200", "下面按医护人员说的喝几小口温水，呛咳或不舒服就马上停下。"],
  ["narr_221", "下面要量小腿、握力、走路速度等，请按医护人员说的配合。"],
]);

/** 旁白播报/展示文案：有简化覆盖用覆盖，否则用 01 表原文（来源：NARRATION_TEXT_OVERRIDES） */
export function narrationText(narration: NarrationV2): string {
  return NARRATION_TEXT_OVERRIDES.get(narration.id) ?? narration.text;
}

/**
 * 编排层删除的旁白（2026-09-13 用户拍板：认知初筛（minicog）开始前连播的三条开场白
 * 只保留 narr_50「下面问问您的记忆和心情。」，其余两条删除——总开场 narr_3 与
 * 工具说明 narr_51；01 表只读源与 scales-v2.json 不动，与 NARRATION_TEXT_OVERRIDES 同一先例）。
 * narr_3 是全会话总开场，删除后各会话开场由 intro 讲解（OPENING_TEXT）承担。
 */
const NARRATION_SUPPRESSED_IDS: ReadonlySet<string> = new Set(["narr_3", "narr_51"]);

/** 该旁白是否已被编排层删除（删除 = 不进时间线、不播报不上屏） */
export function narrationSuppressed(narrationId: string): boolean {
  return NARRATION_SUPPRESSED_IDS.has(narrationId);
}

/** 按题型给出作答提示，帮助患者第二次回答时命中标准选项 */
function optionsHint(question: ScaleQuestion, options: QuestionOption[]): string {
  // 2026-09-04 修改意见 1：播报选项时同样剥除评分/流程备注（不念"（4分，结束）"给患者听）
  const displayLabels = (list: QuestionOption[]) => list.map((option) => displayOptionLabel(option.label));
  switch (question.answerType) {
    case "boolean":
      return '您回答"是"或者"不是"就可以。';
    case "likert5":
      // 来源：量表题目_Demo.txt "一般回答选项：1～5级"（没有/很少/有时/经常/总是）
      return '您可以用"没有、很少、有时、经常、总是"这样的说法回答。';
    case "number":
      return `您可以说一个${question.numberMin ?? 0}到${question.numberMax ?? 10}之间的数字。`;
    case "multiChoice":
      return `可以多选，选项有：${displayLabels(options).join("、")}。`;
    case "imageChoice":
    case "choice":
      return `您可以从这几个里面选：${displayLabels(options).join("、")}。`;
    case "drawing":
      return "请在白板上画好后提交，医生会帮您确认。";
  }
}

/**
 * 追问话术（第 1 次回答模糊后使用）：重复口语版题干 + 作答提示。
 * 来源：AGENTS.md 硬约束 3 "回答模糊 → 追问 1 次"。
 * 自由回答题（认知题改版）：不念选项（标准答案不能泄露），题干用组提问文案覆盖。
 */
export function clarifyText(question: ScaleQuestion, options: QuestionOption[]): string {
  const base = spokenTextOverride(question.id) ?? question.colloquialText;
  const hint = isFreeResponseItem(question.id)
    ? "请直接说出您的答案就可以。"
    : optionsHint(question, options);
  return `不好意思，我没有完全听清您的意思。再请教您一次：${base}${hint}`;
}

/**
 * 轮末复问话术（追问后仍不清，全部题目问完后使用）：预生成的换说法版本（retryText）。
 * 来源：AGENTS.md 硬约束 3 "轮末用预生成的换说法版本复问"。
 */
export function recheckText(question: ScaleQuestion): string {
  const base = spokenTextOverride(question.id) ?? question.retryText;
  return `刚才有一道题我想再和您确认一下。${base}`;
}
