# 老年健康智能评估与干预系统 Demo（YY-Demo）

系统代替医护人员完成老年患者健康信息采集（数字医生语音对话），按标准量表确定性评分生成评估标签，再经知识图谱映射生成个体化干预方案，由医生审核确认。

核心数据流：

```
患者语音/健康信息 → 量表评估规则 → 评估标签集合 → 知识图谱映射 → 干预标签集合 → 具体干预方案（医生审核确认）
```

## 快速开始

```bash
npm install
npm run convert-rules   # 生成并校验规则数据 data/*.json
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
| `npm run convert-rules` | 医学规则 xlsx → data/*.json 转换 + 校验 |
| `npm run build` | 生产构建 |

Windows 默认使用本机 Microsoft Edge；其他系统或没有 Edge 时，首次运行前执行
`npx playwright install chromium` 安装 Playwright 自带 Chromium。

## 目录导览

- `docs/source/` — 医学规则源文件（只读，单一事实来源）
- `data/` — 结构化规则数据（题库/映射/干预方案）
- `src/lib/scoring` `src/lib/recommend` — 医学核心：确定性评分与推荐引擎（纯函数）
- `src/lib/assessment` — 测量题自动换算、答案审计与方案审核纯逻辑
- `src/lib/dialogue` — 会话状态机与回答归一化（DeepSeek + 规则兜底）
- `src/lib/providers` — DeepSeek / 火山 ASR / 豆包 TTS / 数字人 抽象与 PII 过滤
- `src/app/doctor` — 医生端；`src/app/patient` — 患者端大屏

详细协作规范与架构约束见 `AGENTS.md`（CLAUDE.md 引用同一文件）。

## 环境变量（语音功能需要，可选）

复制 `.env.example` 为 `.env.local` 并填入：`DEEPSEEK_API_KEY`、`VOLC_APP_ID`、`VOLC_ACCESS_TOKEN`、`AVATAR_MODE=sdk|fallback`，可选 `VOLC_TTS_VOICE`（豆包音色）。

密钥全部缺失时语音链路自动降级（纯字幕 + 按钮/文字作答），完整评估流程仍可演示。
