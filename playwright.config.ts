/**
 * INPUT:  tests/e2e 下的 Playwright 用例、独立 SQLite 数据库环境变量
 * OUTPUT: 端口 3100 上的串行端到端测试运行配置
 * POS:    M2 医生端完整流程的浏览器验收入口；严禁连接 prisma/dev.db。
 */
import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";

const projectRoot = __dirname;
const e2eDatabaseUrl = "file:./prisma/e2e.db";
const edgeRoots = [process.env["PROGRAMFILES(X86)"], process.env.PROGRAMFILES].filter(
  (value): value is string => Boolean(value)
);
const useSystemEdge =
  process.platform === "win32" &&
  edgeRoots.some((root) => existsSync(path.join(root, "Microsoft", "Edge", "Application", "msedge.exe")));

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: "http://127.0.0.1:3100",
    // Windows 演示机复用已安装的 Chromium Edge；其他环境使用 Playwright 自带 Chromium。
    channel: useSystemEdge ? "msedge" : undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    cwd: projectRoot,
    // 先用不访问数据库的首页探活，再由 globalSetup 建库；避免探活请求提前连接空数据库。
    url: "http://127.0.0.1:3100/",
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      DATABASE_URL: e2eDatabaseUrl,
      // 画图题看图判定在 E2E 中关闭（空值优先于 .env.local，Next 不覆盖已存在的环境变量）：
      // 回归用例断言的是"画钟交卷落待医生确认、报告标部分计分"的兜底路径，且 E2E 不应出网调视觉模型
      DASHSCOPE_API_KEY: "",
      VISION_API_KEY: "",
    },
  },
});
