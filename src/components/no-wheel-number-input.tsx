/**
 * INPUT:  标准 input 属性（type 固定为 number）
 * OUTPUT: 禁用鼠标滚轮改值的数值输入框
 * POS:    建档表单（患者自助 / 医生端）共用。React 的 onWheel 是 passive 监听，
 *         preventDefault 无效，滚轮时失焦（blur）即可阻止数值被滚动修改（2026-08-13 用户要求）。
 */
"use client";

import type { InputHTMLAttributes } from "react";

export default function NoWheelNumberInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="number" {...props} onWheel={(e) => e.currentTarget.blur()} />;
}
