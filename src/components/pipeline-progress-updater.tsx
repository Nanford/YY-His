/**
 * INPUT:  目标解锁步骤 step（1～6）、可选当前患者 patientId
 * OUTPUT: 无渲染，仅在客户端 mount 时更新 localStorage 流程进度
 * POS:    嵌入流程关键页面（建档完成、进入问询、查看报告），让首页流程导航
 *         按顺序解锁；同时记录患者 id，使首页第二步"量表选择"可直接跳转。
 *         不渲染任何 DOM，不影响页面布局。
 */
"use client";

import { useEffect } from "react";
import { unlockStep, setPipelinePatientId, type PipelineStep } from "@/lib/pipeline-progress";

interface Props {
  step: PipelineStep;
  patientId?: string;
}

export function PipelineProgressUpdater({ step, patientId }: Props) {
  useEffect(() => {
    unlockStep(step);
    if (patientId) setPipelinePatientId(patientId);
  }, [step, patientId]);
  return null;
}
