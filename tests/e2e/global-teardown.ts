/**
 * INPUT:  Playwright 运行期间生成的 prisma/e2e.db
 * OUTPUT: 删除独立 E2E 数据库及其 SQLite 临时文件
 * POS:    E2E 环境回收；清理范围固定，不接触 prisma/dev.db。
 */
import { rmSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(__dirname, "../..");
const prismaDirectory = path.join(projectRoot, "prisma");
const e2eDatabasePath = path.join(prismaDirectory, "e2e.db");

export default function globalTeardown(): void {
  if (path.dirname(e2eDatabasePath) !== prismaDirectory || path.basename(e2eDatabasePath) !== "e2e.db") {
    throw new Error(`拒绝清理非预期数据库路径：${e2eDatabasePath}`);
  }

  // Playwright 会在 globalTeardown 之后才停止 webServer。Windows 无法删除仍被 Next.js
  // 持有的 SQLite 文件，因此把清理注册到测试主进程退出阶段；下一次 setup 仍会先做兜底清理。
  process.once("exit", () => {
    for (const suffix of ["", "-journal", "-shm", "-wal"]) {
      try {
        rmSync(`${e2eDatabasePath}${suffix}`, { force: true, maxRetries: 10, retryDelay: 200 });
      } catch (error) {
        // 进程异常退出时不覆盖原始测试结果；遗留文件会在下一次 globalSetup 中清理。
        console.warn(`E2E 数据库退出清理未完成：${String(error)}`);
      }
    }
  });
}
