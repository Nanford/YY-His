# 老年健康智能评估与干预系统 Demo（YY-Demo）

系统通过数字医生语音、按钮、数字、图片和绘图等方式采集老年患者健康信息，按标准量表确定性评分生成结果标签，再依据 V2 积分矩阵推荐个体化干预方案，由医生审核确认。

核心数据流：

```
基础信息 → 量表选择 → 数据采集 → 确定性评分与结果标签 → V2 积分推荐 → 干预展示与医生审核
```

## 快速开始

```bash
npm install
npm run convert-rules-v2 # 从 V2 只读源生成并校验运行时规则
npx prisma migrate dev  # 初始化本地 SQLite
npm run dev             # http://localhost:3000
```

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 本地开发 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint |
| `npm test` | vitest（评分/推荐引擎全量用例） |
| `npm run test:e2e` | Playwright 医生端完整流程验收（独立 `prisma/e2e.db`，运行后自动清理） |
| `npm run prisma:generate` | 生成 Prisma Client（安装、构建前会自动执行） |
| `npm run convert-rules-v2` | V2 医学规则 xlsx → data/*-v2.json 转换 + 校验 |
| `npm run convert-rules` | 生成 V1 历史规则数据，仅用于兼容与追溯 |
| `npm run build` | 生产构建 |

Windows 默认使用本机 Microsoft Edge；其他系统或没有 Edge 时，首次运行前执行
`npx playwright install chromium` 安装 Playwright 自带 Chromium。

## 目录导览

- `V2/` — V2 医学规则只读源文件，运行时规则的事实来源
- `docs/source/` — V1/V2.0 历史规则源，退役保留
- `data/` — V2 结构化规则数据及历史兼容数据
- `src/lib/scoring-v2` `src/lib/recommend-v2` — V2 医学核心：确定性评分与积分推荐引擎（纯函数）
- `src/lib/assessment` — 测量题自动换算、答案审计与方案审核纯逻辑
- `src/lib/dialogue` — 会话状态机与回答归一化（DeepSeek + 规则兜底）
- `src/lib/providers` — DeepSeek / 火山 ASR / 豆包 TTS / 数字人 抽象与 PII 过滤
- `src/app/doctor` — 医生端；`src/app/patient` — 患者端大屏

详细协作规范与架构约束见 `AGENTS.md`（CLAUDE.md 引用同一文件）。

## 环境变量（语音功能需要，可选）

复制 `.env.example` 为 `.env.local` 并填入：`DEEPSEEK_API_KEY`、`VOLC_APP_ID`、`VOLC_ACCESS_TOKEN`、`AVATAR_MODE=sdk|fallback`，可选 `VOLC_TTS_VOICE`（豆包音色）。

密钥全部缺失时语音链路自动降级（纯字幕 + 按钮/文字作答），完整评估流程仍可演示。
