/**
 * INPUT:  src/generated/prisma（prisma generate 产物）、DATABASE_URL 环境变量
 * OUTPUT: prisma —— 全局唯一的 PrismaClient 实例
 * POS:    数据库访问的唯一入口。所有 Route Handler / Server Component 一律从这里拿客户端，
 *         禁止各处自行 new PrismaClient（开发热更新会导致连接泄漏）。
 */
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Prisma 7 必须显式提供 driver adapter；路径与 prisma.config.ts 保持一致
    adapter: new PrismaBetterSqlite3({
      url: process.env.DATABASE_URL ?? "file:./prisma/dev.db",
    }),
  });

// 开发环境下缓存到 globalThis，避免 Next.js 热更新时重复创建连接
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
