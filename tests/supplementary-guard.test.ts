/**
 * INPUT:  src/lib/assessment/supplementary.ts（checkSupplementaryGuard 归属校验纯函数）
 * OUTPUT: 补充评估 server action 的越权/状态拦截用例
 * POS:    createSupplementarySession 此前只按入参 sessionId 查患者即建会话并切 cookie——
 *         知道他人任一会话 id 即可把本机 cookie 切到他人会话，经报告页"同患者放宽"看光
 *         对方历史报告。纯函数锁定两条拒绝路径：跨患者 cookie、源会话未出报告；
 *         以及同患者 + 已出报告（collected/confirmed）放行。不触库、不碰 cookie。
 */
import { describe, expect, it } from "vitest";
import { checkSupplementaryGuard } from "@/lib/assessment/supplementary";

describe("checkSupplementaryGuard", () => {
  it("跨患者 cookie：拒绝（forbidden），不建会话不切 cookie", () => {
    expect(
      checkSupplementaryGuard("patient-A", { patientId: "patient-B", status: "confirmed" })
    ).toEqual({ ok: false, reason: "forbidden" });
  });

  it("本机无 cookie 会话：拒绝（forbidden）", () => {
    expect(
      checkSupplementaryGuard(null, { patientId: "patient-A", status: "confirmed" })
    ).toEqual({ ok: false, reason: "forbidden" });
  });

  it("同患者但源会话进行中：拒绝（not_reported）", () => {
    expect(
      checkSupplementaryGuard("patient-A", { patientId: "patient-A", status: "in_progress" })
    ).toEqual({ ok: false, reason: "not_reported" });
  });

  it("同患者 + 已出报告（collected）：放行", () => {
    expect(
      checkSupplementaryGuard("patient-A", { patientId: "patient-A", status: "collected" })
    ).toEqual({ ok: true });
  });

  it("同患者 + 已出报告（confirmed）：放行", () => {
    expect(
      checkSupplementaryGuard("patient-A", { patientId: "patient-A", status: "confirmed" })
    ).toEqual({ ok: true });
  });
});
