/**
 * INPUT:  tests/ 下的测试文件
 * OUTPUT: vitest 运行配置
 * POS:    测试基建。alias 与 tsconfig paths 保持一致（@ → src、@data → data），注意 @data 必须在 @ 之前（前缀匹配）。
 */
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@data": path.resolve(import.meta.dirname, "data"),
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
