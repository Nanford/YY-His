/**
 * INPUT:  医生粘贴的病历文本（可能含 PII）、可评分量表清单、DeepSeek（可选）
 * OUTPUT: suggestScalesFromEmr —— 建议的量表 id 列表 + 简短理由（无密钥时规则兜底）
 * POS:    M10.2 病历智能评估：出网前必须经 piiSafeJsonFetch；病历正文只作本地规则匹配，
 *         发给 DeepSeek 的内容经脱敏（身份证/手机号等替换为占位），且禁止携带姓名等 PII 字段名。
 */
import { SCORABLE_SCALE_IDS } from "@/lib/assessment/scale-packages";
import { scales } from "@/lib/rules";
import { deepseekAvailable } from "@/lib/providers/deepseek";
import { piiSafeJsonFetch } from "@/lib/providers/pii-filter";

export interface EmrSuggestResult {
  scaleIds: string[];
  /** 本地规则或模型给出的简短中文说明（不含 PII） */
  reason: string;
  method: "deepseek" | "rules";
}

/** 关键词 → 量表 id（规则兜底，无密钥/模型失败时用） */
const KEYWORD_SCALE_HINTS: { keywords: string[]; scaleIds: string[] }[] = [
  { keywords: ["衰弱", "乏力", "疲乏", "FRAIL"], scaleIds: ["frail", "adl", "iadl"] },
  { keywords: ["营养", "体重下降", "消瘦", "MNA", "GLIM"], scaleIds: ["mnasf", "nrs2002", "glim"] },
  { keywords: ["跌倒", "摔跤", "Morse"], scaleIds: ["fall_3q", "morse"] },
  { keywords: ["认知", "记忆", "痴呆", "MMSE", "Mini-Cog", "谵妄", "CAM"], scaleIds: ["minicog", "mmse", "cam"] },
  { keywords: ["抑郁", "情绪低落", "GDS"], scaleIds: ["depression_2q", "gds15"] },
  { keywords: ["焦虑", "GAD"], scaleIds: ["anxiety_2q", "gad7"] },
  { keywords: ["失眠", "睡眠", "AIS"], scaleIds: ["sleep_1q", "ais"] },
  { keywords: ["便秘"], scaleIds: ["constipation_1q", "constipation_symptom"] },
  { keywords: ["尿失禁", "漏尿", "ICIQ"], scaleIds: ["ui_2q", "iciq"] },
  { keywords: ["疼痛"], scaleIds: ["pain_1q", "pain_nrs"] },
  { keywords: ["吞咽", "呛咳"], scaleIds: ["dysphagia_screen", "water_swallow"] },
  { keywords: ["压疮", "压伤", "Braden"], scaleIds: ["pressure_screen", "braden"] },
  { keywords: ["多重用药", "用药"], scaleIds: ["polypharmacy"] },
  { keywords: ["中医", "体质"], scaleIds: ["tcm_constitution"] },
  { keywords: ["视力", "眼"], scaleIds: ["vision", "visual_function"] },
  { keywords: ["听力", "耳聋"], scaleIds: ["hearing", "whisper"] },
  { keywords: ["肌少", "握力", "步速", "小腿围"], scaleIds: ["calf", "grip", "gait_speed", "dxa_bia", "sppb"] },
];

const SCORABLE = new Set(SCORABLE_SCALE_IDS);

/** 本地脱敏：身份证 15/18 位、手机号、常见住院号长数字串 → 占位，不把原文出网 */
export function redactEmrText(text: string): string {
  return text
    .replace(/\b\d{17}[\dXx]\b/g, "[身份证号已脱敏]")
    .replace(/\b1[3-9]\d{9}\b/g, "[手机号已脱敏]")
    .replace(/\b\d{8,14}\b/g, "[号码已脱敏]");
}

/** 纯规则建议：关键词命中并集，保持 01 表可评分顺序 */
export function suggestScalesByRules(emrText: string): EmrSuggestResult {
  const hit = new Set<string>();
  for (const rule of KEYWORD_SCALE_HINTS) {
    if (rule.keywords.some((kw) => emrText.includes(kw))) {
      for (const id of rule.scaleIds) {
        if (SCORABLE.has(id)) hit.add(id);
      }
    }
  }
  // 无命中时给常规综合评估包核心子集，避免空推荐
  if (hit.size === 0) {
    for (const id of ["frail", "fall_3q", "mnasf", "minicog", "depression_2q", "anxiety_2q"]) {
      if (SCORABLE.has(id)) hit.add(id);
    }
  }
  const scaleIds = SCORABLE_SCALE_IDS.filter((id) => hit.has(id));
  return {
    scaleIds,
    reason: hit.size
      ? `根据病历关键词匹配到 ${scaleIds.length} 个量表（规则兜底）`
      : "未识别到明确线索，已给出常规筛查组合",
    method: "rules",
  };
}

/**
 * 病历智能推荐量表。优先 DeepSeek；失败/无密钥回落规则。
 * 出网 payload 仅含 redactedText + 量表清单（id/name），字段名经 PII 白名单语义安全。
 */
export async function suggestScalesFromEmr(emrText: string): Promise<EmrSuggestResult> {
  const trimmed = emrText.trim();
  if (trimmed.length < 8) {
    return { scaleIds: [], reason: "病历内容过短，请粘贴更完整的病史摘要", method: "rules" };
  }
  const rules = suggestScalesByRules(trimmed);
  if (!deepseekAvailable()) return rules;

  const catalog = scales
    .filter((s) => SCORABLE.has(s.id))
    .map((s) => ({ id: s.id, title: s.name })); // 字段名避 name/patient 等敏感词

  const redactedText = redactEmrText(trimmed).slice(0, 4000);
  const system = [
    "你是老年综合评估量表推荐助手。根据脱敏后的病历摘要，从给定量表清单中选出最合适的量表 id。",
    "只输出 JSON：{\"scaleIds\":string[],\"reason\":string}。",
    "scaleIds 必须全部来自给定清单；reason 为简短中文、不得包含姓名/身份证/手机号。",
    "优先覆盖：衰弱、营养、跌倒、认知、情绪；有明确专科线索再加专科量表。",
  ].join("\n");

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const response = await piiSafeJsonFetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      jsonBody: {
        model: "deepseek-chat",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: JSON.stringify({
              requestId: "emr-suggest",
              redactedText,
              catalog,
            }),
          },
        ],
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) return rules;
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return rules;
    const parsed = JSON.parse(content) as { scaleIds?: unknown; reason?: unknown };
    if (!Array.isArray(parsed.scaleIds)) return rules;
    const ids = parsed.scaleIds
      .filter((id): id is string => typeof id === "string" && SCORABLE.has(id));
    const ordered = SCORABLE_SCALE_IDS.filter((id) => ids.includes(id));
    if (ordered.length === 0) return rules;
    return {
      scaleIds: ordered,
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : "模型根据病历推荐",
      method: "deepseek",
    };
  } catch {
    return rules;
  }
}
