/**
 * INPUT:  量表库 scales
 * OUTPUT: 患者自助量表选择的展示标签、说明与临床辅助提示
 * POS:    患者端量表选择页（/patient/select-scales）专用；从量表题目属性派生，
 *         量表增删/改题时自动同步。
 */
import { scales } from "@/lib/rules";

/** 默认勾选：FRAIL+跌倒三问——纯患者自答题，能纯自助跑完直接出完整报告。 */
export const DEFAULT_SCALE_IDS = new Set(["frail", "fall_3q"]);

/** 适老化短标题（量表正式名含英文缩写，老人不易懂），缺省回落量表库名称。 */
export const SCALE_LABELS: Record<string, string> = {
  frail: "衰弱评估",
  mnasf: "营养评估",
  fall_3q: "跌倒风险",
  tcm_constitution: "中医体质辨识",
  adl: "日常生活能力",
  iadl: "工具性日常活动",
  minicog: "认知初筛",
  mmse: "认知功能评估",
  depression_2q: "情绪筛查（抑郁）",
  gds15: "抑郁情绪评估",
  anxiety_2q: "情绪筛查（焦虑）",
  gad7: "焦虑情绪评估",
  ais: "睡眠情况评估",
  lubben: "亲友支持评估",
  morse: "跌倒风险详评",
  ui_2q: "漏尿筛查",
  iciq: "漏尿情况评估",
  constipation_1q: "便秘筛查",
  constipation_symptom: "便秘症状评估",
  sleep_1q: "失眠筛查",
  pain_1q: "慢性疼痛筛查",
  pain_nrs: "疼痛程度评分",
  pressure_screen: "压伤风险筛查",
  dysphagia_screen: "吞咽障碍筛查",
  water_swallow: "洼田饮水试验",
  motor_screen: "运动功能初筛",
  sppb: "简易体能状况",
  vision: "视力评估",
  visual_function: "视觉功能评估",
  hearing: "听力评估",
  whisper: "耳语试验",
  home_env: "居家环境筛查",
  pain_behavior: "疼痛行为观察",
  braden: "压伤风险详评",
  polypharmacy: "多重用药评估",
  nrs2002: "营养风险筛查",
  glim: "营养不良诊断",
  calf: "小腿围测量",
  grip: "握力测量",
  gait_speed: "步速测试",
  dxa_bia: "肌肉量测量",
  cam: "谵妄评估",
};

/** 每项评估的一句大白话用途说明（非诊断表述，仅帮助老人理解选的是什么）。 */
export const SCALE_SUBTITLES: Record<string, string> = {
  frail: "了解您的体力和是否容易疲劳",
  mnasf: "了解您近期的营养状况",
  fall_3q: "了解您走路、站立的稳定情况",
  tcm_constitution: "辨识您的中医体质类型",
  adl: "了解您吃饭、穿衣、如厕等自理能力",
  iadl: "了解您购物、做饭、服药等生活能力",
  minicog: "初步了解记忆和认知情况",
  mmse: "全面了解您的记忆、计算和反应情况",
  depression_2q: "了解您最近两周的情绪状态",
  gds15: "更细致地了解您的情绪状态",
  anxiety_2q: "了解您最近两周是否容易紧张担心",
  gad7: "详细了解您最近两周的紧张担心程度",
  ais: "了解您最近一个月的睡眠情况",
  lubben: "了解您和家人朋友的来往与可获得的帮助",
  morse: "结合疾病、输液、步态等情况细评跌倒风险",
  ui_2q: "了解您最近一个月有没有漏尿",
  iciq: "详细了解漏尿的次数、量和常见情形",
  constipation_1q: "了解您平时有没有便秘困扰",
  constipation_symptom: "详细了解便秘时的排便情况和大便形状",
  sleep_1q: "了解您最近一个月有没有失眠困扰",
  pain_1q: "了解您有没有反反复复超过3个月的疼痛",
  pain_nrs: "给您现在最主要的疼痛打个分",
  pressure_screen: "了解您是否长期卧床、皮肤有没有异常",
  dysphagia_screen: "了解您吃饭喝水时有没有呛咳、残留等情况",
  water_swallow: "在医护人员看护下喝少量温水，观察吞咽情况",
  motor_screen: "了解您走远路、上楼梯是否困难",
  sppb: "在医护指导下做平衡、走路和起坐测试",
  vision: "了解您看东西清楚不清楚",
  visual_function: "了解看东西是否吃力、有暗影或变形",
  hearing: "了解您听别人说话清楚不清楚",
  whisper: "在医护指导下做轻声复述听力测试",
  home_env: "了解家里地面、灯光、扶手等安全情况",
  pain_behavior: "由医护人员观察疼痛相关的表情与动作",
  braden: "由医护人员评估皮肤压伤风险",
  polypharmacy: "由医护人员核对您正在吃的药是否合适",
  nrs2002: "结合体重、进食和疾病评估营养风险",
  glim: "结合体重、肌肉量和疾病评估营养不良",
  calf: "测量小腿围，了解肌肉量初筛情况",
  grip: "测量握力，了解手部力量",
  gait_speed: "测量走 6 米的速度，了解走路能力",
  dxa_bia: "根据仪器测得的肌肉量做肌少症判断",
  cam: "由医护人员判断是否有谵妄表现",
};

/**
 * 该量表是否含需医生评估/系统读取的计分条目（V2 条目类型 ≠ 正式问题）。
 * 含则这些条目在患者自助路径豁免计分（deferClinical），先出部分计分报告——据此在选项上如实提示。
 */
export function needsClinicianAssist(questions: (typeof scales)[number]["questions"]): boolean {
  return questions.some((question) => question.observerAssisted);
}
