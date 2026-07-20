/**
 * INPUT:  患者端建档+问询页面、fixtures/patient-answer-fake-mic.wav（伪造麦克风注入素材）、
 *         独立 E2E SQLite 数据库
 * OUTPUT: 语音模式下"播报完自动开始听 → VAD 自动判断说完 → 免确认自动提交 → 自动进入
 *         下一题"全程不点任何按钮的端到端验收结果
 * POS:    覆盖"启动采集时默认语音模式，问完题自动开始听、免确认默认打开"这条产品口径
 *         （2026-07-14 与用户确认）。此前语音链路（TTS/ASR/VAD）只在开发过程中用临时脚本
 *         手工验证过、没有沉淀为自动化回归——这个用例补上这个缺口。
 *         fixtures/patient-answer-fake-mic.wav 是开发者本人的测试录音（"是的是的"）+ 程序
 *         合成的静音尾巴，通过 Chrome --use-file-for-fake-audio-capture 注入作为假麦克风
 *         输入，不含任何患者数据。
 */
import { expect, test } from "@playwright/test";
import path from "node:path";

const FIXTURE_PATH = path.join(__dirname, "fixtures", "patient-answer-fake-mic.wav");

test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${FIXTURE_PATH}`],
  },
  permissions: ["microphone"],
});

test("语音模式下播报完自动开始听，免确认自动提交并进入下一题，全程不点任何按钮", async ({ page }) => {
  test.setTimeout(90_000);

  // ---------- 患者自助建档（固定 FRAIL+跌倒预设，全程不经过医生端） ----------
  await page.goto("/patient/register");
  await page.locator('input[name="name"]').fill("E2E 语音自动模式患者");
  await page.getByText("男", { exact: true }).click();
  await page.locator('input[name="age"]').fill("70");
  await page.getByRole("button", { name: "开始评估", exact: true }).click();

  await expect(page).toHaveURL(/\/patient\/sessions\/[^/?]+$/);
  const sessionId = new URL(page.url()).pathname.split("/").at(-1);
  if (!sessionId) throw new Error("无法从会话页面 URL 读取会话编号");

  // ---------- 选语音模式：大按钮"开始评估"（aria-label 描述了完整流程），这一下点击同时完成
  // 开始评估 + 麦克风授权，之后全程不再点任何按钮 ----------
  await page.getByRole("button", { name: "开始评估，数字医生会先讲解，之后用语音作答" }).click();

  // 首次进入会先播报一段开场白再问第一题，真实 TTS 是顺序调用，两段话都要等，给足时间
  const listening = page.getByText("请开始说话", { exact: false }).or(page.getByText("正在听您说话", { exact: false }));
  await expect(listening).toBeVisible({ timeout: 40_000 });

  // 免确认默认开：转写成功后应直接推进到下一题，不应停在"您说的是..."确认面板等待点击
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/patient/sessions/${sessionId}/state`);
        const body = (await response.json()) as { progress?: { answered?: number } };
        return body.progress?.answered ?? 0;
      },
      { timeout: 20_000, message: "等待第一题免确认自动提交" }
    )
    .toBeGreaterThanOrEqual(1);
  await expect(page.getByText("您说的是：")).toHaveCount(0);

  // 第二题播报完也应再次自动开始听——证明自动听的机制会为每一题重新触发，不是只有第一题生效
  await expect(listening).toBeVisible({ timeout: 20_000 });
});
