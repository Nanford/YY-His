/**
 * INPUT:  干预标签执行方案全文（data/interventions.json 的 plan 字段）
 * OUTPUT: 方案文本中包含的禁忌/注意事项句子列表
 * POS:    展示层辅助。只做文本提取供医生审核界面醒目展示，不改变方案内容本身。
 */

// 干预方案文本中的禁忌信号词。来源：干预标签_Demo.xlsx 中各方案自带的注意事项表述
// （如"肾功能异常者需由医生…""正在使用抗凝或抗血小板药物…应先由医生审核"）
const CAUTION_KEYWORDS = [
  "肾功能",
  "抗凝",
  "抗血小板",
  "出血",
  "糖尿病",
  "过敏",
  "就医",
  "停止",
  "医生审核",
  "重新评估",
  "陪同",
  "安全保护",
];

/** 从执行方案全文中提取含禁忌信号词的句子，供审核界面以警示样式展示 */
export function extractCautions(plan: string): string[] {
  return plan
    .split(/[。；]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && CAUTION_KEYWORDS.some((kw) => s.includes(kw)))
    .map((s) => `${s}。`);
}
