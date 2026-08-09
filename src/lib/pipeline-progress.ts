/**
 * INPUT:  浏览器 localStorage
 * OUTPUT: Demo V2 六步主流程在入口页的解锁进度
 * POS:    来源：V2/Demo_v2更新说明.docx 总体流程
 *         首页流程导航按顺序解锁：完成第 N 步后才可进入第 N+1 步。
 *         仅用于入口页导航状态，不影响实际业务流；数据只存本地，不进入任何出网请求。
 */

const STEP_KEY = "yy-demo:pipeline-progress";
const PATIENT_KEY = "yy-demo:pipeline-patient-id";

export type PipelineStep = 1 | 2 | 3 | 4 | 5 | 6;

export function getUnlockedStep(): PipelineStep {
  if (typeof window === "undefined") return 1;
  const raw = window.localStorage.getItem(STEP_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : 1;
  if (Number.isNaN(parsed)) return 1;
  return (Math.max(1, Math.min(6, parsed)) as PipelineStep) || 1;
}

export function unlockStep(step: PipelineStep): void {
  if (typeof window === "undefined") return;
  const current = getUnlockedStep();
  if (step > current) {
    window.localStorage.setItem(STEP_KEY, String(step));
  }
}

export function setPipelinePatientId(patientId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PATIENT_KEY, patientId);
}

export function getPipelinePatientId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(PATIENT_KEY);
}

export function resetProgress(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STEP_KEY);
  window.localStorage.removeItem(PATIENT_KEY);
}
