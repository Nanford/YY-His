/**
 * INPUT:  src/lib/actions/doctor.ts confirmPlan（同类替换入口）、data/intervention-scoring-v2.json
 *         （MORSE_FALL_RISK_HIGH → YD07 为 -100 禁止；YD02/YD04/YD06 为普通匹配，同类可替换）
 * OUTPUT: 禁忌红线回归用例——替换目标命中会话快照 forbidden 时服务端硬拦截且原因透出；
 *         非被禁同类项正常替换落库（prisma/next 全部 mock，不触真实数据库）
 * POS:    「同类替换不得引入 -100 禁忌项」的服务端保险（页面层下拉禁用见 plan-review.tsx）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recommendV2, toPlanCandidates } from "@/lib/recommend-v2";

// prisma / next 运行时全部 mock：confirmPlan 是 Server Action，测试只锁定其校验与落库参数
const mocks = vi.hoisted(() => ({
  findSession: vi.fn(),
  findPlan: vi.fn(),
  findResult: vi.fn(),
  updatePlan: vi.fn(),
  updateSession: vi.fn(),
  transaction: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    assessmentSession: { findUnique: mocks.findSession, updateMany: mocks.updateSession },
    interventionPlan: { findFirstOrThrow: mocks.findPlan, updateMany: mocks.updatePlan },
    assessmentResult: { findFirst: mocks.findResult },
    $transaction: mocks.transaction,
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { confirmPlan } from "@/lib/actions/doctor";

const SESSION_ID = "session-forbidden-test";
/** 与运行时同口径：由真实推荐引擎生成候选快照（含 forbidden 明细），不手造医学数据 */
const SNAPSHOT = toPlanCandidates(recommendV2(["MORSE_FALL_RISK_HIGH"]));
const FORBIDDEN_YD07 = SNAPSHOT.forbidden.find((f) => f.code === "YD07");

function replaceForm(fromCode: string, toCode: string): FormData {
  const formData = new FormData();
  formData.set(`action.${fromCode}`, "replace");
  formData.set(`replaceWith.${fromCode}`, toCode);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findSession.mockResolvedValue({ status: "collected" });
  mocks.findPlan.mockResolvedValue({ id: "plan-1", candidates: SNAPSHOT });
  mocks.findResult.mockResolvedValue({ tags: [{ code: "MORSE_FALL_RISK_HIGH" }] });
  mocks.updatePlan.mockResolvedValue({ count: 1 });
  mocks.updateSession.mockResolvedValue({ count: 1 });
  // 与生产一致：事务回调直接在同一 mock 客户端上执行
  mocks.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      interventionPlan: { updateMany: mocks.updatePlan },
      assessmentSession: { updateMany: mocks.updateSession },
    })
  );
  // Next 的 redirect 以抛错中断执行；mock 成可识别的标记错误
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
});

describe("confirmPlan：同类替换禁忌红线（-100 禁止项硬拦截）", () => {
  it("夹具自检：快照含候选 YD06，且 YD07 因「跌倒高风险」被 -100 禁止", () => {
    expect(SNAPSHOT.items.some((item) => item.code === "YD06")).toBe(true);
    expect(FORBIDDEN_YD07).toBeDefined();
    expect(FORBIDDEN_YD07!.reasons.some((r) => r.score === -100 && r.tagName === "跌倒高风险")).toBe(true);
  });

  it("替换为被禁项 YD07 → 拒绝，错误文案透出禁忌说明与禁止原因，且不落库", async () => {
    await expect(confirmPlan(SESSION_ID, replaceForm("YD06", "YD07"))).rejects.toThrow(
      /该干预对本患者为禁忌项（-100），不能替换入方案：YD07/
    );
    // forbidden 原因随错误透出（03 表 MORSE_FALL_RISK_HIGH → YD07 = -100）
    await expect(confirmPlan(SESSION_ID, replaceForm("YD06", "YD07"))).rejects.toThrow(/跌倒高风险触发禁止/);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.updatePlan).not.toHaveBeenCalled();
  });

  it("替换为非被禁同类项 YD04 → 正常确认，finalPlan 含 YD04 且决策留痕 YD06 → YD04", async () => {
    await expect(confirmPlan(SESSION_ID, replaceForm("YD06", "YD04"))).rejects.toThrow(
      `NEXT_REDIRECT:/doctor/sessions/${SESSION_ID}`
    );
    expect(mocks.updatePlan).toHaveBeenCalledTimes(1);
    const updateArgs = mocks.updatePlan.mock.calls[0][0] as {
      data: { status: string; finalPlan: { code: string }[]; decisions: { action: string; fromCode?: string; toCode?: string }[] };
    };
    expect(updateArgs.data.status).toBe("confirmed");
    expect(updateArgs.data.finalPlan.some((item) => item.code === "YD04")).toBe(true);
    expect(updateArgs.data.finalPlan.some((item) => item.code === "YD06")).toBe(false);
    expect(
      updateArgs.data.decisions.some((d) => d.action === "replace" && d.fromCode === "YD06" && d.toCode === "YD04")
    ).toBe(true);
  });
});
