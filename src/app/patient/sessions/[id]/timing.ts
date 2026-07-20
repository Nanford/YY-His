/**
 * INPUT:  语音链路事件名与可选上下文（题号、耗时等，绝不含回答内容）
 * OUTPUT: 控制台时间戳日志（[评估链路] 统一前缀，供演示现场定位延迟环节）
 * POS:    患者端语音链路埋点（来源：需求更新说明 V2.0 §2.1）——录音结束、请求发起、
 *         识别返回、标准答案确认、下一题播报均保留时间戳，用于定位录音、网络、识别
 *         服务或页面编排造成的延迟。只记事件与耗时，绝不记录回答文本（PII 红线延伸
 *         到日志）；仅客户端控制台输出，不构成任何出网请求。
 */

/** 链路事件：按一次作答的时间顺序排列 */
export type TimingEvent =
  /** 录音结束（VAD 判定说完 / 患者点"直接提交"） */
  | "recording_end"
  /** 语音识别请求发起（POST /api/asr） */
  | "asr_request"
  /** 语音识别返回 */
  | "asr_response"
  /** 答案提交请求发起（POST answer） */
  | "answer_request"
  /** 标准答案确认（归一化决策返回：confirm / markPending / markManual / clarify） */
  | "answer_confirm"
  /** 下一题播报开始（playSpeaks 起播第一条） */
  | "speak_start";

/** 打一条链路时间戳日志。detail 只放题号、耗时毫秒等非内容字段。 */
export function logTiming(event: TimingEvent, detail?: Record<string, string | number>): void {
  // ISO 墙钟用于对齐服务端/网络日志，performance.now 单调时钟用于算环节耗时
  const wall = new Date().toISOString();
  const mono = `${performance.now().toFixed(0)}ms`;
  if (detail) {
    console.info(`[评估链路] ${event} @ ${wall} (+${mono})`, detail);
  } else {
    console.info(`[评估链路] ${event} @ ${wall} (+${mono})`);
  }
}
