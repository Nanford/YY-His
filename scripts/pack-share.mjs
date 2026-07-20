/**
 * INPUT:  .next/standalone（需先跑 npm run build）、runtime/node.exe（便携 Node 运行时，不入库）、
 *         public/、prisma/schema.prisma + migrations、.env.example
 * OUTPUT: dist/share/（绿色便携包目录）与 dist/his-demo-portable.zip
 * POS:    把 demo 打成可分享的免安装包：standalone 服务 + 便携 Node + 预迁移 SQLite + 一键启动 bat。
 *         红线：绝不打包真实 .env.local（密钥随包外发即泄露），只带空值模板；
 *         收件人填了密钥才有语音链路，缺密钥自动降级为字幕 + 按钮/文字，流程完整可演示。
 * 用法:   npm run build → node scripts/pack-share.mjs
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = path.join(ROOT, "dist");
const PKG_DIR = path.join(DIST_DIR, "share");
const ZIP_PATH = path.join(DIST_DIR, "his-demo-portable.zip");

function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true });
}

// ---- 前置检查 ----
if (!fs.existsSync(path.join(ROOT, ".next", "standalone", "server.js"))) {
  console.error("缺少 .next/standalone/server.js，请先运行 npm run build");
  process.exit(1);
}
if (!fs.existsSync(path.join(ROOT, "runtime", "node.exe"))) {
  console.error("缺少 runtime/node.exe（便携 Node 运行时，win-x64），请先放入后再打包");
  process.exit(1);
}

// ---- 干净重建 dist/share ----
fs.rmSync(PKG_DIR, { recursive: true, force: true });
fs.rmSync(ZIP_PATH, { force: true });
fs.mkdirSync(PKG_DIR, { recursive: true });

// 1) standalone 服务本体（含被追踪的 node_modules 与 better-sqlite3 原生模块）
copyDir(path.join(ROOT, ".next", "standalone"), PKG_DIR);
// 2) 静态资源与公共素材（standalone 不含这两块，按 Next 官方约定手工补）
copyDir(path.join(ROOT, ".next", "static"), path.join(PKG_DIR, ".next", "static"));
copyDir(path.join(ROOT, "public"), path.join(PKG_DIR, "public"));
// 3) storage 空目录（TTS 缓存与录音，运行时自动写）
fs.mkdirSync(path.join(PKG_DIR, "storage", "audio-cache"), { recursive: true });

// 4) 预迁移的空 SQLite 库：收件人机器上没有 prisma CLI，库文件必须在打包期建好
fs.mkdirSync(path.join(PKG_DIR, "prisma"), { recursive: true });
copyDir(path.join(ROOT, "prisma", "migrations"), path.join(PKG_DIR, "prisma", "migrations"));
fs.copyFileSync(path.join(ROOT, "prisma", "schema.prisma"), path.join(PKG_DIR, "prisma", "schema.prisma"));
execSync("npx prisma migrate deploy", {
  cwd: ROOT,
  env: { ...process.env, DATABASE_URL: "file:./dist/share/prisma/dev.db" },
  stdio: "inherit",
});

// 5) 便携 Node 与密钥模板（只带空值模板，真实 .env.local 绝不入包）
fs.copyFileSync(path.join(ROOT, "runtime", "node.exe"), path.join(PKG_DIR, "node.exe"));
fs.copyFileSync(path.join(ROOT, ".env.example"), path.join(PKG_DIR, ".env.local"));
fs.appendFileSync(path.join(PKG_DIR, ".env.local"), "\n# 便携包数据库位置（相对启动目录，勿改）\nDATABASE_URL=file:./prisma/dev.db\n", "utf8");

// 6) 一键启动：后台起服务、4 秒后自动开浏览器；关闭黑窗口即停止
fs.writeFileSync(
  path.join(PKG_DIR, "启动.bat"),
  [
    "@echo off",
    "chcp 65001 >nul",
    "cd /d %~dp0",
    "set DATABASE_URL=file:./prisma/dev.db",
    "echo 正在启动老年健康智能评估系统，浏览器稍后会自动打开 http://localhost:3000",
    "echo 请保持本窗口打开，关闭即停止服务。",
    'start "" cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:3000"',
    "node.exe server.js",
    "",
  ].join("\r\n"),
  "utf8"
);

// 7) 使用说明
fs.writeFileSync(
  path.join(PKG_DIR, "使用说明.txt"),
  [
    "老年健康智能评估与干预系统 Demo · 绿色便携包",
    "",
    "【启动】双击 启动.bat，浏览器自动打开 http://localhost:3000（患者端 /patient，医生端 /doctor）。",
    "【停止】关闭启动时的黑色命令行窗口即可。",
    "【语音】未配置密钥时自动降级为字幕 + 按钮/文字作答，全流程可演示；",
    "       需要语音对话时，用记事本打开 .env.local 填入 DEEPSEEK_API_KEY 与火山 VOLC_APP_ID / VOLC_ACCESS_TOKEN 后重启。",
    "【麦克风】localhost 属于浏览器安全上下文，授权弹窗允许后即可录音。",
    "【数据】患者信息只存本包 prisma/dev.db（SQLite），不上传任何云端；删除本目录即彻底卸载。",
    "",
  ].join("\r\n"),
  "utf8"
);

// 8) 打 zip（Compress-Archive 对中文文件名兼容，包内路径均为 ASCII）
execFileSync(
  "powershell",
  ["-NoProfile", "-Command", `Compress-Archive -Path '${PKG_DIR}\\*' -DestinationPath '${ZIP_PATH}' -Force`],
  { stdio: "inherit" }
);

const mb = (fs.statSync(ZIP_PATH).size / 1048576).toFixed(0);
console.log(`✓ 便携包已生成：${path.relative(ROOT, ZIP_PATH)}（${mb}MB），解压后双击 启动.bat 即用`);
