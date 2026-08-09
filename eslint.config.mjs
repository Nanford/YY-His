import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 便携包产物与便携 Node 运行时（pack-share 生成，含第三方打包代码）
    "dist/**",
    "runtime/**",
    // e2e 运行产物（playwright 报告/trace 查看器为第三方打包 JS，非项目源码）
    "playwright-report/**",
    "test-results/**",
    // 本地化的第三方运行时资产（tesseract.js worker/core、pdfjs worker，npm 包拷贝而来）
    "public/vendor/**",
  ]),
]);

export default eslintConfig;
