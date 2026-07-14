/**
 * INPUT:  题目定义（口语版/复问版文案来自 data/scales.json，预生成 + 人工可审）
 * OUTPUT: 开场白/结束语常量、追问与轮末复问话术拼装函数
 * POS:    数字医生全部播报文案的唯一出处。固定模板 + 预生成文案拼装，
 *         现场不让 LLM 自由发挥（AGENTS.md：保证不改变医学含义）。
 *         注意：播报文本会发往火山 TTS，禁止拼入患者姓名等 PII（硬约束 1）。
 */
import type { QuestionOption, ScaleQuestion } from "@/lib/rules";

/** 开场白：不称呼姓名（文本出网做 TTS，且统一文案可命中哈希缓存） */
export const OPENING_TEXT =
  "您好！我是您的健康评估数字医生。接下来我会问您几个关于日常生活和身体状况的问题，" +
  "您放松，用平时说话的方式回答就可以。如果没听清，可以让我再说一遍。我们现在开始。";

/**
 * 结束语：问答全部完成后播报。是否已生成报告、还是需要医生协助补充信息，
 * 由患者端界面在此之后另行展示，不在这句固定播报里预判结果。
 */
export const CLOSING_TEXT = "好的，今天的问题都问完了，非常感谢您的耐心配合！";

/** 按题型给出作答提示，帮助患者第二次回答时命中标准选项 */
function optionsHint(question: ScaleQuestion, options: QuestionOption[]): string {
  switch (question.answerType) {
    case "boolean":
      return '您回答"是"或者"不是"就可以。';
    case "likert5":
      // 来源：量表题目_Demo.txt "一般回答选项：1～5级"（没有/很少/有时/经常/总是）
      return '您可以用"没有、很少、有时、经常、总是"这样的说法回答。';
    case "choice":
      return `您可以从这几个里面选：${options.map((option) => option.label).join("、")}。`;
  }
}

/**
 * 追问话术（第 1 次回答模糊后使用）：重复口语版题干 + 作答提示。
 * 来源：AGENTS.md 硬约束 3 "回答模糊 → 追问 1 次"。
 */
export function clarifyText(question: ScaleQuestion, options: QuestionOption[]): string {
  return `不好意思，我没有完全听清您的意思。再请教您一次：${question.colloquialText}${optionsHint(question, options)}`;
}

/**
 * 轮末复问话术（追问后仍不清，全部题目问完后使用）：预生成的换说法版本（retryText）。
 * 来源：AGENTS.md 硬约束 3 "轮末用预生成的换说法版本复问"。
 */
export function recheckText(question: ScaleQuestion): string {
  return `刚才有一道题我想再和您确认一下。${question.retryText}`;
}
