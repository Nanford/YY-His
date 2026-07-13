/**
 * INPUT:  prisma/migrations、DATABASE_URL=file:./prisma/e2e.db
 * OUTPUT: 仅供本次 Playwright 运行使用的空白数据库及完整表结构
 * POS:    E2E 隔离边界；先删除明确命名的 e2e.db，再执行 Prisma 迁移。
 */
import { execFileSync } from "node:child_process";
import { closeSync, openSync, rmSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(__dirname, "../..");
const prismaDirectory = path.join(projectRoot, "prisma");
const e2eDatabasePath = path.join(prismaDirectory, "e2e.db");
const e2eDatabaseUrl = "file:./prisma/e2e.db";

/** 只允许清理 prisma/e2e.db 及 SQLite 同名临时文件，避免误碰开发数据库。 */
function removeE2eDatabaseFiles(): void {
  if (path.dirname(e2eDatabasePath) !== prismaDirectory || path.basename(e2eDatabasePath) !== "e2e.db") {
    throw new Error(`拒绝清理非预期数据库路径：${e2eDatabasePath}`);
  }

  for (const suffix of ["", "-journal", "-shm", "-wal"]) {
    rmSync(`${e2eDatabasePath}${suffix}`, { force: true, maxRetries: 5, retryDelay: 100 });
  }
}

export default function globalSetup(): void {
  removeE2eDatabaseFiles();
  // Prisma 7 的 Windows schema engine 无法在此环境中直接创建 SQLite 文件，先建立空容器再迁移。
  closeSync(openSync(e2eDatabasePath, "wx"));
  process.env.DATABASE_URL = e2eDatabaseUrl;

  // 直接调用项目内 Prisma CLI，避免 npx 在测试机上临时下载不同版本。
  const prismaCli = path.join(projectRoot, "node_modules", "prisma", "build", "index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: e2eDatabaseUrl },
    stdio: "inherit",
  });
}
