<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 老年健康智能评估与干预系统 Demo

## 项目概览

**项目名称**：老年健康智能评估与干预系统 Demo（YY-Demo）

**系统品牌（2026-11-11 定）**：**岐颐智护（TCM-CARE）**——中西医结合老年综合评估与个体化干预智能辅助系统（Traditional Chinese Medicine–Integrated Closed-loop Assessment, Recommendation and Evaluation for Older Adults）。界面文案唯一来源 `src/lib/brand.ts`，logo 为用户提供的图标 `public/brand/tcm-care-logo.webp`。

**核心目标**：系统代替医护人员完成老年患者健康信息采集（数字医生语音对话），自动完成标准化评估并生成评估标签，再按积分排名推荐个体化干预方案。Demo 阶段跑通 **Demo_v2 六步主流程**：**基础信息填写 → 量表工具选择 → 数据采集 → 结果判断 → 干预匹配 → 干预展示**（来源：`V2/Demo_v2更新说明.docx`）。

**使用者**：医生（建档、量表选择、医护题代填、干预方案审核）+ 老年患者（大屏语音/点选/数字/画钟，**可自助建档并直接开始评估**；问答完成后同屏看报告与候选干预）。入口 `/doctor`、`/patient`；Demo 不做真实登录鉴权。患者自助建档：姓名/性别/年龄必填，其余全选填（2026-08-08 用户拍板扩展：基本情况七项/疾病与用药/人体测量三段式，与医生端共用 `buildV2ProfileExtensions` 校验，BMI 前端实时计算，握力计传感器与 DXA/BIA 暂不接入占位）；建档后进入第二步「量表工具选择」四方式页（`/patient/select-scales/*`：常规综合/病历智能/随访对比/自选组合，2026-08-08 设计图口径，套餐定义见 `patient-scale-packages.ts`）。Demo 口径：患者答完一律出报告，医生检查题 `deferClinical` 豁免并标注「部分计分」；答完结束语播完自动跳转报告视图（2026-08-08，免点击，按钮保留兜底）。医生完整建档见 `/doctor/patients/new`（含 V2 基本情况/疾病用药/人体测量三块），与患者入口共用 `patient-intake.ts` 校验。

**当前阶段**：Demo V2 主链路已装机（42 可评分量表）。进度事实来源 **`docs/V2-迭代任务清单.md`**。规则源只读目录 **`V2/`**（4 张 xlsx + Demo_v2更新说明.docx + figure 1.png）。

## 技术栈与外部服务（已确认，勿再更换）

| 项 | 结论 |
|---|---|
| 框架 | Next.js (App Router) + TypeScript + Prisma + SQLite + Tailwind，单一代码库 |
| 回答归一化 LLM | DeepSeek API（判断回答是否满足题意 + 解析为标准答案，JSON mode） |
| 画图题看图 | 阿里通义千问 VL（百炼 OpenAI 兼容入口，默认 `qwen3-vl-plus`，密钥 `DASHSCOPE_API_KEY`；2026-11-10 用户拍板新增）。只做图像观察，对错由确定性规则判定 |
| TTS | 豆包 TTS（火山引擎语音合成），服务端调用 + 文本哈希缓存 |
| ASR | 火山引擎 ASR（与 TTS 同平台同密钥体系） |
| 数字医生形象 | 商用数字人 SDK（首选火山引擎虚拟数字人）；`AVATAR_MODE=sdk\|fallback` 可切换降级 2D 形象 |
| 输入模式 | 语音确认 / 语音直答 / 文字 / 大按钮 / **数字 / 多选 / 图片选择 / 画钟**（M9.6） |

**V2 关键医学口径**（与任务清单「关键口径」一致；与下方旧 V1 表述冲突时以本段为准）：
- 推荐唯一来源 = `data/intervention-scoring-v2.json`（03 表）：**100 强制置顶、-100 禁止、0 忽略、2–10 累加**；5 大类各取前 2（forced 不占名额）；占位标签不进推荐。
- 中医体质 **30 题转化分**（≥40 是 / 30–39 倾向是）；**「倾向是/基本是视同正式标签进推荐」口径废止**（报告仍可标注倾向字样）。**平和质 A.1-2/1-3/1-4（易累/闷闷不乐/怕冷）为负向题，按 6−原始分 反向计分**（2026-08-08 修复，国标 CCMQ 口径；配置 `judgments-v2.json` 的 `balanced.reverseItemIds`，偏颇 8 质题目均为正向描述不反向）。
- MNA-SF 两档：12–14 未提示风险 / ≤11 营养不良风险。
- 干预编码 **YD/SS/ZY/JZ/QT**（60 项），非 V1 的 M/D/C。

## 硬约束（不可违背）

1. **PII 本地化**：姓名、身份证号、手机号、住院号、门诊号、住址等直接身份信息只能存本地 SQLite，禁止出现在任何第三方云端请求中（DeepSeek、火山均只允许携带患者唯一编号）。出网前必须经过 `src/lib/providers` 层的字段过滤，且有单元测试把关。
2. **评分确定性**：自然语言回答先归一化为标准答案/分值，再由**纯函数评分引擎**严格按《量表题目_Demo.txt》计算。大模型只做语言理解（预生成文案的选择填充、归一化回答），**绝不参与评分和判定**。
3. **禁止编造**：回答模糊 → 追问 1 次 → 仍不清标"待确认"、轮末用预生成的换说法版本复问 → 仍不清标"待人工确认"由医生补录，不得强行生成答案。
4. **全链路可追溯**：标签 → 量表得分明细 → 每题标准答案 → 原始转写/语音文件，医生可逐级下钻，修改必须留痕。
5. **干预方案必须展示正文与素材**：展示完整教程（运动视频、膳食/中医食养图片、就诊/其他文本）；**5 大类**（运动 / 膳食营养 / 中医食养 / 就诊建议 / 其他）每类原则上 1～2 项；100 强制项置顶醒目标注；素材缺失标「素材待补齐」。医患两端均须可见安全提示。
6. **评估报告生成不经医生前置审核**：问答完成即评分出报告（2026-08-13 起任何缺失/答不清的题都豁免计分并标「部分计分」，不再落 awaiting_doctor 等医生补录）；**最终干预仍须医生审核**（`draft`→`confirmed`）。

## 核心数据流（V2）

```
基础信息（档案 + 测量）
  → 量表工具选择（常规综合 / 病历智能 / 随访 / 自选组合）
  → 数据采集（语音/点选/数字/多选/画钟 + 旁白 + 系统读取 + 复用跳问）
  → data/scales-v2.json + judgments-v2.json → scoring-v2 确定性标签
  → intervention-scoring-v2.json → recommend-v2（100/-100/2–10，5 类各前 2）
  → 报告：先评估结论、后干预展示（视频/图/文）
  → 医生审核留痕 → confirmed
```

评分触发唯一实现：`src/lib/assessment/finalize.ts`（与患者 `tryAutoFinalize`、医生 `finalizeSession` 共用）。

## 业务规则文件（V2 为运行时权威）

| 路径 | 作用 |
|---|---|
| `V2/*.xlsx` + `Demo_v2更新说明.docx` | **V2 只读源**；`npm run convert-rules-v2` → data/*-v2.json |
| `data/scales-v2.json` | 42 量表 / 238 条目 / 20 旁白 |
| `data/result-tags.json` | 190 结果标签（5 占位） |
| `data/judgments-v2.json` | 42 量表判定配置（手工+校验） |
| `data/intervention-scoring-v2.json` | 推荐矩阵（编码索引） |
| `data/interventions-v2.json` | 60 干预项正文与素材 |
| `docs/source/*` | V1/V2.0 历史源（退役不删） |

**变更路径**：改 `V2/` 源 → `npm run convert-rules-v2` → 同步 judgments 手工段与测试。禁止手改医学 JSON。

### 运行时规模（V2）

- **可评分量表**：42（judgments-v2 全收录）
- **结果标签**：190（含 5 占位不自动产出）
- **干预**：60 项，5 大类，编码 YD/SS/ZY/JZ/QT

## 评分实现要点（写代码前必读）

- **FRAIL**：5 题是/否各 1 分。0 分=无衰弱；1～2 分=衰弱前期；≥3 分=衰弱。
- **MNA-SF**：A(0-2) B(0-3) C(0-2) D(0/2) E(0-2) F(0-3)，总分 0～14。12～14 正常；8～11 存在营养不良风险；0～7 营养不良。**F 题分支**：有 BMI 用 F；无 BMI 用 F替代（小腿围 CC<31cm=0 分，≥31cm=3 分），二者取其一不叠加；两者皆缺 → 该题"待人工确认"。
- **跌倒风险**：3 题任意一题"是"→ 阳性；全"否"→ 阴性。
- **中医体质**：33 题 1～5 级计分。**特殊计分题**：第 9 题按 BMI、第 28 题按腹围、第 14 题按年感冒次数、第 17 题按过敏频率取分值。8 种偏颇体质各对应 4 题，小计 ≥11 = 是；9～10 = 倾向是；≤8 = 否。**平和质**：题 1、2、4、5、13，其中 2/4/5/13 反向计分（6 − 原始分）；总分 ≥17 且其他 8 体质均 <8 → 是；总分 ≥17 且其他 8 体质均 <10 → 基本是；否则否。
- 多个偏颇体质同时命中时**全部保留**，不强制单选。
- 第 32、33 题（舌象）可由调查员/医生辅助观察填写，医生端需支持代填。

## 系统架构

### 目录结构

```
YY-Demo/
├── AGENTS.md / CLAUDE.md
├── V2/                       # V2 只读医学源（4 xlsx + docx + figure1）
├── docs/V2-迭代任务清单.md    # 进度断点唯一事实来源
├── docs/source/              # V1/V2.0 历史源（退役不删）
├── scripts/convert-rules-v2.ts
├── data/                     # scales-v2 / judgments-v2 / result-tags / intervention-scoring-v2 / interventions-v2
├── prisma/
├── public/interventions/     # YD 视频、SS/ZY 图、bristol-stool、文本类无文件
├── public/brand/             # 品牌 logo（tcm-care-logo.webp）；浏览器图标为 src/app/favicon.ico + apple-icon.png
├── src/components/           # intervention-media + v2-pipeline + brand-logo + assessment-selection
├── src/lib/brand.ts          # 品牌文案常量（岐颐智护 / TCM-CARE / 中英文全称 / logo 路径）
├── src/lib/scoring-v2/       # V2 评分引擎（纯函数）
├── src/lib/recommend-v2/     # V2 推荐引擎（100/-100/5 类）
├── src/lib/rules/v2.ts       # V2 规则读取入口；index.ts 为旧形状投影
├── src/lib/dialogue/         # 状态机 + 旁白 + 归一化 + 认知题特殊流程（cognitive-flow/judge）
├── src/lib/assessment/       # finalize / reuse / system-read / scale-packages / emr-scale-suggest
├── src/app/doctor/ · patient/ · api/
└── tests/
```

### 分层原则

- **医学核心**：`scoring-v2`、`recommend-v2`、`judgments-v2.json`——纯函数、确定性、改动必须先有测试。
- 题目文案以 01 表预生成文本为准；归一化 DeepSeek 优先、规则兜底。
- 患者端保留按钮/文字兜底；医护观察/操作测试走 CollectForm；系统读取走档案推导。

## 开发里程碑（小步迭代，每步确认后再继续）

- **M0 项目初始化**：脚手架、源文件归档、data/*.json 生成与校验、Prisma schema、CLAUDE.md。
- **M1 评分与推荐引擎**：纯逻辑 + 全量测试（V1 黄金用例：衰弱+存在营养不良风险+跌倒风险筛查阴性+阴虚质 → 8 个候选干预标签）。
- **M2 医生端 + 无语音完整流程**：表单代填跑通端到端数据流。
- **M3 患者端语音采集**：火山 ASR/豆包 TTS + DeepSeek 归一化 + 追问状态机 + 数字人。
- **M4 追溯与打磨**：下钻视图、补录留痕、TTS 预热、演示脚本。
- **M5 V2.0 更新**（需求更新说明_V2.0_20260719.md）：积分排名推荐（黄金用例 §4.3 的 M06/M12/D03/D06/C01/C08、分值 7/7/9/7/9/4 为 **V1 编码口径，已被 V2 03 表取代**；现行等价黄金用例见 `tests/recommend-v2.test.ts`，期望值由 `data/intervention-scoring-v2.json` 矩阵独立复算锁定）、运动视频与膳食/食养图片教程展示、患者补充评估与历史报告、语音链路时间戳埋点与固定浮层提示。

## 常用命令

```bash
npm run dev            # 本地开发
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm test               # vitest（评分/推荐引擎全量用例）
npm run build          # 生产构建
npm run convert-rules  # xlsx → data/*.json 转换 + 校验
npm run pack-share     # 打绿色便携包 dist/his-demo-portable.zip（需先 build + runtime/node.exe）
```

提交前必须跑 lint + test。提交信息：`[feat|fix|refactor|docs|test] 简短描述`。

## 需要用户准备的密钥（M3 前就绪即可）

`.env.local`（不入库，模板见根目录 `.env.example`）：`DEEPSEEK_API_KEY`、`VOLC_APP_ID`、`VOLC_ACCESS_TOKEN`、`AVATAR_MODE=sdk|fallback`，可选 `VOLC_TTS_VOICE`（豆包音色）。火山需开通"语音技术"（语音合成豆包音色 + 大模型录音识别极速版 volc.bigasr.auc_turbo）；虚拟数字人服务需商务开通，未就绪走降级形象。密钥全部缺失时语音链路自动降级（纯字幕 + 按钮/文字作答），完整流程仍可演示。

## 已知的坑

- 数字人 SDK 开通周期不可控（商务流程）→ Avatar 双实现，降级 2D 形象保演示，切换点收敛在患者端 Avatar 组件。
- 体质第 9 题（BMI）、第 28 题（腹围）、MNA-SF F 题（BMI）/F替代（小腿围）依赖测量数据：基础信息录入含身高/体重/腹围/小腿围选填字段，缺失时相关题目走"待人工确认"，医生补录后重算。
- 现场网络不可控 → TTS 按文本哈希预热缓存 + 文字/按钮作答兜底 + 归一化规则兜底。病历智能评估的文件/图片上传（2026-08-08）同样全本机：docx/xlsx 服务端零依赖提取（`/api/patient/emr-extract`），PDF/图片前端解析（pdfjs-dist **v3 legacy** + tesseract.js chi_sim，运行时资产本地化在 `public/vendor/`——克隆后需保留该目录，pack-share 拷 public/ 自动包含），提取文本进病历框后仍走脱敏链路出网。
- 部分干预方案自带禁忌提示（优质蛋白强化-肾功能异常、活血食养-抗凝药物、温阳食养-口干烦热、滋阴食养-糖尿病不加糖），医生审核界面必须醒目展示。V2.0 起安全提示/适宜人群随素材正文展示（图片内含温馨提示，运动项随文字要点），不再单独抽取。
- V2.0 干预素材：D01-D10/C01-C08 图片由 convert-rules 从 docs/source **palette 量化压缩**（目标单张 <600KB，quality 90→50 逐级下调至达标，超出告警不中止）后拷贝到 `public/interventions/`，并同步派生同名 **WebP**（前端 `<picture>` 优先取 WebP、回退 PNG）；图片/视频 `mediaSrc` 均附内容哈希 `?v=`，`/interventions/*` 走 immutable 长缓存（带宽受限服务器减负）；~~M01-M12 视频已就位~~（V1 残留表述，2026-08-08 修订）：V2 运行时不认 M/D/C 命名，`convert-rules-v2` 按 `<YD/SS/ZY编码>.mp4/.png` 检测。2026-08-08 经名称+正文逐条比对（图片逐张目检）完成 12 项 V1→V2 映射复制（视频 YD01–YD06/YD09、图片 SS02/SS03/SS04/ZY02/ZY10，映射表见 `scripts/convert-rules-v2.ts` 的 `MEDIA_V1_SOURCE`），`mediaAvailable=true` 且 `mediaSrc` 附内容哈希 `?v=`；其余 48 项仍 `mediaAvailable=false` 显示「素材待补齐」，新素材按 V2 编码命名放入 `public/interventions/`（视频放 `videos/` 子目录）后**重跑 `npm run convert-rules-v2`** 即自动就位并刷新哈希，无需改代码。运动卡片直接播放视频（16:9 卡内播放），播放失败仍回退动作文字要点。
- 绿色便携包（2026-07-20，`scripts/pack-share.mjs`，产物与便携 Node 均 gitignore）：`output: "standalone"` 构建 + 手工补 `public/` 与 `.next/static` + 打包期预迁移空 `dev.db`（收件机无 prisma CLI）+ `runtime/node.exe`（win-x64）+ 一键启动 bat（3000 被占用自动回退 3200，2026-08-09 增补），zip 约 150~200MB。**红线：绝不打包真实 `.env.local`**（密钥外发即泄露），只带 `.env.example` 空值模板；localhost 属安全上下文，麦克风可用。
- V2.0 补充评估（§3）：患者在报告页可对**尚未完成的量表**发起补充评估（`createSupplementarySession`，独立新会话、复用档案与测量数据、cookie 切换）；复评既有量表属医生授权，由医生在患者详情页"发起新评估"勾选。报告页展示评估时间 + 各量表"新增/复评"标识 + 历史报告入口；历史报告互访按"同患者"放宽 cookie 数据隔离（`src/app/patient/sessions/[id]/page.tsx`）。派生口径（哪些量表已完成/新增还是复评）收敛在 `src/lib/assessment/supplementary.ts`，有单测。
- V2.0 语音链路（§2.1/§2.2）：录音结束/ASR 请求与返回/答案提交/标准答案确认/播报开始均有 `logTiming` 时间戳埋点（`timing.ts`，只记事件与耗时、绝不记回答内容，输出在本机控制台）；标准答案确认后**不再弹"已记录"提示**（2026-08-08 设计口径起不再累积回答气泡——主区只展示当前题，点选态与进入下一题即反馈），例外提示（网络异常/麦克风失败/识别失败/待确认）走**固定定位浮层**，不占用主内容流、不引起界面跳动。~~每页六步进度条（2026-08-08）~~（v2.1 已撤销，见下条）；问询主区只展示当前这一条问题/旁白（`CurrentPrompt`），不留聊天记录。
- **v2.1 界面精简**（2026-08-09，`v2.1修改思路.pptx`）：①首页**两层展示**——第一层 `/` 只保留服务入口（用户评估入口/医生工作台），六步流程导航移至第二层 `/patient/flow`（同时删除"完成上一步后自动解锁…""后续步骤将在完成本步后解锁"两行说明）；两页均按适老化重排——首页居中大字号单栏 + 两个大入口卡片；`/patient/flow` 六步**横向统一卡片、无解锁/锁定之分、不可点击、仅展示**（复用 `V2DemoPipeline` unlockedStep=6 不传 links，`flow-pipeline-lg` 放大样式；解锁追踪 `pipeline-progress` 保留但流程页不再读取）；②患者流程各页**不再内嵌 `PatientFlowProgress` 六步进度条**（组件已删除），建档页副标题说明同步删除；③量表选择各页副标题**去掉"姓名+爷爷/奶奶"称呼**，只留操作指引；④问询页删除数字医生头像下方的旁白复述文本（主区 `CurrentPrompt` 不变）；⑤报告页干预卡片**删除"· 文字说明 / 视频教程待上线"占位条**，正文由灰蓝改为主文字色 `--ink`（图片"素材待补齐"标注保留，硬约束 5 不变）；⑥**补充评估两层展示**（`supplementary-section.tsx`）：报告页第一层仅「补充评估」大按钮，点击展开第二层量表勾选清单，提交报错回跳时默认展开。
- **患者报告口径更新（2026-08-11 用户拍板）**：问答完成即出报告与干预方案，患者端**不再呈现「初步方案·医生确认中」等待中间态**（原 2026-07-14「方案状态必须醒目区分」口径废止）；医生端 draft→confirmed 审核流程与禁忌提示保留不变。
- 47 题全量演示过长 → 会话创建时可勾选量表，演示默认只跑 FRAIL+跌倒。**患者自助量表选择（2026-08-08 设计图改版）：建档后进入 `/patient/select-scales` 方式选择 + routine/emr/followup/custom 四个方式页**——常规综合 3 预设包（标准包 12 项，分组与设计图一致；门诊简版 7/住院入院 9 为推定清单待甲方确认；**2026-09-14 用户拍板：门诊简版为默认推荐+默认选中**，`routine/page.tsx` 的 `recommended` 与 `routine-form.tsx` 初始选中都以它为准）、病历智能（`/api/patient/emr-suggest`，`EmrSuggestResult.keywords` 风险词 chips + 可补充池）、随访对比（患者端可复评既有量表，走 startAssessment 新建会话，报告页 scaleScopes 自动标「复评」；与 V2.0 §3 医生授权口径并行）、自选组合（4 系统预设包 + 机构预设包占位禁用 + 42 量表自定义树）。套餐统一收敛在 `src/lib/assessment/patient-scale-packages.ts`（项数/可评分模块加载断言），与医生端 SCALE_PACKAGES 相互独立。语音问询流程（`state-machine.ts` 的 `askableQuestions`）恒跳过 `measurement`（BMI/腹围/小腿围，由建档测量数据换算）与 `observerAssisted`（舌象、面色晦黯、神经心理等需临床观察）两类题。**Demo 口径（2026-07-20 拍板，覆盖此前"落 `awaiting_doctor` 等医生补录"的优雅降级）**：患者自助答完一律出报告——这两类医生题缺失时按 `deferClinical` 豁免计分（`scoreAll`/`scoreAndSnapshot` 传参，评分引擎 `partitionMissing` 只豁免这两类、~~普通问答题缺失仍阻断~~【2026-08-13 起废止，见下条】），各体质小计/总分按已答题目累加、阈值不变，被豁免题随快照存 `AssessmentResult.deferred`，报告页标注"部分计分·仅供参考"；观察题仍只由医护判断（患者端不问不答），医生端 `CollectForm` 补录 + 手动"完成采集"的严格路径（strict，不豁免）保持不变。注意豁免的医学失真：痰湿质 4 题中 3 题是医生题（9/28/32）、血瘀质 2 题（24/33）、MNA-SF 缺 E/F 时总分上限 9，相关"是/营养正常"判定在纯自助下实际不可达——正式版必须恢复医生补录口径。**全豁免守卫（2026-08-08）**：某量表计分条目全部被 deferClinical 豁免（零条已答，如纯测量量表 calf/grip/gait_speed/dxa_bia 自助路径）时不产出任何标签（`scoreScaleV2` 统一入口 `guardFullyDeferred`），杜绝"零证据伪造阴性"；报告页对这类量表显示"需医护测量后评定"而非"无异常"。
- 2026-08-08 审计修复轮要点（五路审计 + 全量修复）：①按钮/图片作答改按 **label 精确匹配**（`matchButtonOption`，旧 score 匹配在同分选项上张冠李戴——便秘筛查恒假阳性、Bristol 恒 1 型，属医学级 bug）；②画钟交卷 pending 在状态机复问轮跳过（此前含 minicog 会话必卡死 500）；③医生「同类替换」对快照 forbidden（-100）项 UI 禁用 + `confirmPlan` 服务端硬拦截；④`createSupplementarySession` 校验 cookie 归属同患者 + 源会话已出报告（堵跨患者越权）；⑤PII 值级防线接线：DeepSeek 归一化口述与 emr 病历文本出网前对患者姓名做**替换式脱敏**（不 throw，患者自报姓名是合法场景），`piiValues` 兜底扫描；⑥多选题不开放语音/文字作答（单选归一化会丢多选语义），只保留点选。
- 语音联调状态（2026-07-14 真实密钥验证）：**TTS 已通**（v3 单向流式 `/api/v3/tts/unidirectional`，资源 `seed-tts-2.0`，uranus 系列音色，逐行 JSON 流拼接音频）；**DeepSeek 归一化已通**（口语命中/模糊追问均正确）；**ASR 已通**（2026-07-14 补开通后复测，`volc.bigasr.auc_turbo` 拿真实录音直连与经 `/api/asr` 路由全链路复测均返回正确转写文本）；流式识别 `volc.bigasr.sauc.*` 与端到端实时语音大模型 `volc.speech.dialog` 尚未使用（`volc.speech.dialog` 已确认账号授权，WebSocket 握手返回 101，但产品化前需先定音口径，见下一条）。**2026-09-14 复测告警：该账号 ASR（volc.bigasr.auc_turbo）与 TTS（volc.seedtts.default / seed-tts-2.0）双双 45000030 not granted（授权失效/资源包到期），需在火山控制台重新开通后语音链路才恢复**；代码侧已兜底——TTS 播报从"一次失败永久静默"改为 60s 冷却熔断（`interview-screen.tsx` 的 `ttsBrokenUntilRef`，服务恢复后自动复播，缓存音频不受影响），TTS 的 45000030 按 `unavailable` 归类、开通指引落服务端日志（ASR 侧提示则按用户拍板保留患者端可见，见下条）。
- 归一化编排原则：DeepSeek 通道可用时其结论（含 unclear）即最终结论，**规则不得复核推翻**——"我没听明白"这类表达会被关键词规则误判成"否"；规则兜底只在模型通道失败（无密钥/网络/超时）时启用。
- **2026-08-13 认知题与交互修复轮（用户拍板）**：①建档表单（患者自助 + 医生端）数值输入框禁用鼠标滚轮改值（共享组件 `src/components/no-wheel-number-input.tsx`，onWheel 失焦实现——React onWheel 是 passive 监听，preventDefault 无效）；②视力/听力阶梯题采集层跳题——此前只有评分层 `ladder-score.ts` 认"命中即停"，患者仍被问完全部阶梯题；现由 `state-machine.computeLadderSkips` 从已确认答案派生跳过集合（命中有分"可以（结束）"选项 → 后续阶梯题不再提问，答"不可以"继续下一题），答案落库后必须在事务内即时重算（快照是事务开始时装载的，不重算则本次提交后的 nextStep 仍返回被跳过的题——2026-08-13 修复"答了可以还继续问"），医生改答后自动失效；题干中的 01 表流程注解（"可以（结束）、不可以（2）"等）与题号前缀（"2、"等）由 `rules/index.ts` 的 `stripBranchAnnotations` 在投影层剥除，不展示不播报（评分引擎读 scales-v2.json 原文，不受影响）；vision_2 原文 1-1/1-2 双分支合并为单一问句（`QUESTION_TEXT_OVERRIDES`，一次只问一个问题，戴镜口径由前置旁白 narr_30 交代）；每个量表开场由数字医生点名（`buildTimeline`：有锚定旁白则在首条前拼"下面是「量表短名」。"（2026-09-13 起，原"接下来进行"句式精简），无则注入虚拟旁白 `scale_intro_<scaleId>`；短名由 `rules/index.ts` 的 `shortScaleName` 生成——去"简易/简版"、书面后缀归一，如"听力简易评估表"→"听力评估"，仅用于播报/展示，报告页仍用原始名称）【2026-09-13 当日起废止：开场/过渡不再念量表名，见下条】；③**minicog/MMSE 认知题改版**（配置收敛在 `src/lib/dialogue/cognitive-flow.ts`，词表/连减期望值/目标句从 scales-v2 条目解析 + 加载断言）：minicog_1 与 MMSE 三词改为**指令播报**（虚拟旁白 instr_*，复用 narration 机制插在指定题前）；MMSE 立即复述（mmse_11~13）与延迟回忆（mmse_19~21）改为**组回答**——一次复述由 LLM（规则兜底）识别命中词、一次给组内 3 题记分（组目标题不单独提问，trigger mmse_11 虽为记忆指令仍向患者提问）；MMSE 定向（1~10）/连减（14~18）/原文复述（24）与 minicog_3 改为**自由回答题**（`ScaleQuestion.responseMode="free"`，不展示选项按钮杜绝答案泄露，追问话术不念选项），LLM 判定（`deepseek.ts` 的 `judgeAnswerByDeepSeek`/`judgeWordsByDeepSeek`，独立 prompt）只把回答**映射回既有标准选项**（正确/错误、回忆 N 个词），评分引擎与医学 JSON 零改动（硬约束 2 不破）；地点定向参考答案来自 `MMSE_LOCATION`（环境变量 `MMSE_PLACE_PROVINCE/CITY/NAME/DEPARTMENT/FLOOR` 覆盖，演示前按场地设置）；无密钥时 `judge-rules.ts` 规则兜底（中文数字/日期/词表子串），拿不准一律走追问→待人工确认；④语音作答按钮**恒定尺寸重构**（`answer-input.tsx` VoiceButton）：删除录音/识别中的大号监听面板（voice-listen-hero/声波动画已移除），三态共用同一按钮外壳只换麦克风图标颜色（绿=等待说话、红=正在听），"我说完了"兜底按钮改放固定高度槽位 visibility 切换（上文兜底口径不变），界面不再跳动；⑤**患者自助一律出报告（当日追加拍板，覆盖 2026-07-20「普通问答题待人工确认仍阻断」）**：`partitionMissingV2` 在 deferClinical 下对**全部**缺失条目豁免（不再按条目类型区分），答不清转 manual 的普通问答题也按部分计分先出报告，`awaiting_doctor` 仅作评分异常兜底；MMSE 缺文化程度不再阻断——四档界值结论一致才出标签（>23 正常 / ≤17 减退 / 18~23 分歧不出标签，见 `threshold-by-education.ts`）；strict（医生端）路径不变。顺带修复：tcm-constitution 的 ok 分支此前硬编码 `deferred: []/partial: false`，豁免条目从未落快照（「部分计分」标注对中医体质静默失效），已修正。
- 患者语音作答免按钮（2026-07-14 扩展为全程免动手）：`wav-recorder.ts` 内置能量阈值 VAD（开麦后前 300ms 采环境噪音自适应定阈值，说话满 300ms 计入"说话"防误触发，静音持续 1500ms 判定"说完了"自动提交，20s 硬顶兜底）。这是近似方案而非语义理解，老年患者语气停顿长，阈值不可能对所有人调到完美，`answer-input.tsx` 的 `VoiceButton` 因此在录音全程保留弱化样式的手动"我说完了，直接提交"按钮兜底，不是可选项。若后续要换更稳的方案（如接入端到端实时语音大模型的内置 VAD），需求先确认清楚"数字医生是否可以自由对话"这条医学口径（会放开量表原文措辞这条硬约束），不是纯技术选型。VAD 档位可经 `WavRecorder.start(stream, vad, config?)` 覆盖：**答题不传 config，行为与既有一致**；**intro 语音确认**（讲解播完说"好的/开始"进第一题）走独立的 `CONSENT_VAD_CONFIG` 宽进档（更短 minSpeech 150ms、更低门槛 ×2、更快说完判定 700ms、更早超时 4s，并加**门槛上限**兜住"讲解一结束就抢答、说话落进 300ms 校准窗把门槛顶到够不着"这一漏判成因）。确认监听超时**不再静默死锁**：自动重新听 + 提示患者"没听清就点『开始』" + 「开始」大按钮始终兜底（2026-07-15 修：此前一次 8s 无声超时后就再也不听，反复说"好的/开始"无反应）。`VoiceActivityDetector` 已导出并有纯状态机单测（`tests/wav-recorder-vad.test.ts`）锁"只放宽确认、不动答题"。
  麦克风流的申请与单次录音生命周期是分离的（`requestMicStream()` vs `WavRecorder.start(stream, vad)`）：患者在"开始评估"画面选"🎤 语音问答（推荐，默认）"这一下点击里申请一次麦克风，流由 `interview-screen.tsx` 持有跨题复用——同一权限一旦被允许，同页面后续再申请不需要新手势也不会弹窗，这是能做到"播报完自动开始听"而不必每题都点一次的前提。每题播报（`playSpeaks`）结束后 `interview-screen.tsx` 置 `readyForVoice=true` 驱动 `VoiceButton` 自动开始录音；"语音直答（免确认）"在语音模式下默认勾选（2026-07-14 与用户确认，尽量减少动手），手动模式（"👆 手动选择作答"）完全不出现语音入口、不申请麦克风，尊重患者选择。语音授权被拒绝时静默降级为手动模式，不阻塞流程。**ASR 未开通提示口径（2026-09-14 用户拍板，当日先隐藏后恢复）**：火山 45000030（资源未开通）按 `upstream` 处理，`/api/asr` 把「语音识别服务未开通：请在火山引擎控制台开通…」原文下发，患者端浮层**直接展示该技术提示**（便于演示现场发现服务未开通），不做整程静默降级。
- 端到端实时语音大模型（RealtimeAPI，`volc.speech.dialog`）评估结论（2026-07-14）：事件 `ChatTTSText`（500）文档定义为"客户端指定文本合成音频"，可覆盖模型自身闲聊回复，理论上兼容"问题必须是量表原文"这条硬约束；但协议只保证"必须在收到 `ASREnded` 之后发送"这个时序，没有"关闭模型自动回复"的配置开关，未做过真实网络下的双方案联调，不能断定绝无双重出声。当前患者端免提方案未采用这条路径，改用上面这条"极速版 ASR + 客户端 VAD"，零新增授权依赖、无时序契约风险。
- Windows PowerShell 的文本管道（`Get-Content | Set-Content`）会把 UTF-8 中文按 GBK 误读导致乱码：改代码/文档一律用编辑工具做精确替换，禁止用 shell 管道改写含中文的文件。
- **2026-09-04 患者端措辞与界面修复轮（修改意见_20260904.docx，7 条）**：①选项展示/播报剥除括号注解——01 表选项 label 里的评分（"（4分，结束听力评估）"）、流程备注（"（进入下一题）"）、判定备注（"（筛查阳性）"）只服务评分引擎与 AI 归一化，患者端按钮与追问话术一律展示 `displayOptionLabel`（`src/lib/rules/index.ts`，剥除全部括号注；42 量表 734 选项全量校验无空串无撞名，`tests/display-option-label.test.ts`）；DTO 里 `label`（提交/匹配/评分用，不动）与 `displayLabel`（展示用）并行下发；②认知类量表患者端不出现"智力"措辞——`shortScaleName` 加显式覆盖：简易智力评估量表→「认知功能筛查」、简易智力状态检查量表（MMSE）→「详细的认知功能评价」（报告页仍用原始名称）；③认知指令播报（instr_minicog_words/instr_mmse_words）**记忆词只播报不上屏**（`InstructionBroadcast.displayText`，加载断言防泄露）且**语速放慢**（`speechRate=-30`，TTS 路由新增 `rate` 参数，`synthesizeSpeech` 支持 speechRate，缓存键含语速）；④mmse_24 复述题目标句"瑞雪兆丰年"不上屏（`displayTextOverride`，从题面派生+断言；`PatientPromptDto.displayText`）；⑤画钟画布展示尺寸按视口封顶（`.drawing-canvas`，max-height min(38vh,480px)，内部坐标仍 480×480 按比例换算）、会话页不再叠第二条顶栏（患者布局顶栏已含品牌与返回入口，`PatientSessionTopbar` 已删）、主舞台高度按真实顶栏重算（100dvh−124px）、作答区上限放宽至 min(58vh,34rem)、头像 max-w-full+aspect-square 防横向溢出——采集界面常态无滚动条（overflow-y:auto 仅作极端兜底）。
- **2026-09-12 开场白/过渡句简化 + 降级模式认知指令修复**：①开场白/结束语精简（`prompts.ts` 的 OPENING_TEXT/CLOSING_TEXT）；20 条旁白（总开场/分类过渡/工具说明）文案经 `prompts.ts` 的 `NARRATION_TEXT_OVERRIDES` 在 `buildTimeline` 编排层替换（01 表只读源与 scales-v2.json 不动，与 QUESTION_TEXT_OVERRIDES 同一先例）；②修复"认知初筛缺第一题"——代码本就会念三个词（instr_minicog_words 插在画钟题前），但 TTS 关闭/失败时旁白 2ms 闪过自动推进、记忆词又不上屏，患者永远拿不到词；现 `playSpeaks` 返回是否真正播出，旁白**仅在实际播出后才自动推进**，未播出（TTS 关闭/失败、刷新后无手势未重播）时停在原地展示**完整文案**（含记忆词/复述句，mmse_24 同口径），患者点「继续」推进（已播出过的旁白点「继续」直接推进不重播，未播出才先补播再推进，全程 submitting 锁防连点）；重播出声后回到 displayText 不上屏口径（`interview-screen.tsx` 的 narrationUnspoken/promptUnspoken）。③修复旁白音频级联闪切（同日"三个词没播"的根因）：患者点「继续」等操作会触发重复 /advance，后续旁白音频被下一条 playAudio 接管（supersede）时旧链按"已播完"resolve，自动推进沿旁白链级联——每条音频只播几十毫秒就被切断；现 `playAudio` resolve 区分自然播完（true）/被接管（false），被切断不算播出、不自动推进、也不续播剩余文本（防反切新链），旧链异步收尾经 stateRef 校验"界面仍在本步骤"才允许上屏兜底文案。④题号口径：minicog 记词指令是 01 表量表第 1 个条目，`InstructionBroadcast.countsAsProgress`（仅 minicog，MMSE 三词指令属 mmse_11~13 题组不单列）→ `progressOf` 传入 timeline 时计入 total/answered，患者端呈现"第 1 题记词 → 第 2 题画钟 → 第 3 题复述"（e2e 题号断言同步 +1、总数 10→11）。
- **2026-09-13 开场白/过渡句再精简（用户拍板）**：在 2026-09-12 轮基础上进一步缩短——`OPENING_TEXT`/`CLOSING_TEXT` 去敬语去重复提示；`NARRATION_TEXT_OVERRIDES` 中 narr_3/4/24/30/39/45/50/113/121 共 9 条再压短（安全提示"不舒服就马上停下"、戴镜/戴助听器口径保留）；量表点名句式"接下来进行「XX」。"→"下面是「XX」。"（`state-machine.ts` introPrefix）；机制不变（编排层替换，01 表源与 scales-v2.json 不动），文本哈希变化后音频自动重新合成。**2026-09-13 当日追加拍板（覆盖点名句式与已删的 `SCALE_INTRO_OVERRIDES` 方案）**：量表题目之前的开场白/过渡句**不再播报量表名称**，改用日常交流的话、减少专业名词——有锚定旁白的量表直接播旁白本身（`NARRATION_TEXT_OVERRIDES` 已是口语过渡句），无锚定旁白的量表有专题过渡句用专题句（`prompts.ts` 的 `SCALE_TRANSITION_OVERRIDES`，按 scaleId 配置，2026-09-13 当日追加拍板"量表题目之前要简要说明内容"后 25 个无锚定量表已全部配齐，如 mnasf → "下面问问您的营养情况。"、frail → "下面问问您平时容不容易累，走路、爬楼费不费劲。"），否则从 `SCALE_TRANSITION_TEXTS` 过渡句池轮换注入一条虚拟旁白（`scale_intro_<scaleId>`，如"好的，我们接着聊。"）；患者端无题可问的量表（纯测量/医护观察：calf/grip/gait_speed/dxa_bia/glim/cam/sppb/whisper/water_swallow/polypharmacy/pain_behavior/braden）整个跳过——过渡句和锚定旁白都不播，避免"说了要测却没有下文"；`shortScaleName` 及其"智力"措辞覆盖保留在 `rules/index.ts` 但患者端播报/展示面已不再使用。**2026-09-13 当日再追加拍板（开场白整条删除）**：认知初筛（minicog）开始前连播的三条开场白只保留 narr_50「下面问问您的记忆和心情。」——总开场 narr_3 与工具说明 narr_51 经编排层整条删除（`prompts.ts` 的 `NARRATION_SUPPRESSED_IDS`，`buildTimeline` 过滤不进时间线；01 表源与 scales-v2.json 不动）；narr_3 是全会话总开场，删除后所有会话开场仅由 intro 讲解（OPENING_TEXT）承担；记词指令 `instr_minicog_words` 是 01 表第 1 个条目（第 1 题），不在开场白之列，保留不动。**2026-09-14 过渡句语境省略（用户拍板"门诊简版包啰嗦过渡句删除"）**：专题过渡句按会话量表语境整条省略（`prompts.ts` 的 `SCALE_TRANSITION_CONTEXT_SKIP` + `scaleTransitionSkipped`，`buildTimeline` 虚拟过渡分支生效）——depression_2q「下面问问您最近的心情。」在 minicog 同会话时与 narr_50「记忆和心情」重复 → 省略；ais「下面再细问一下您睡觉的情况。」以 sleep_1q 为前题，会话无 sleep_1q 时没头没尾 → 省略（睡眠疼痛包 sleep_1q+ais 同会话时保留）。
- **2026-09-15 首页/流程页极简 + 过渡句调整（修改.docx，4 条）**：①首页 `/` 删除除「老年健康智能评估与干预」「用户评估入口」「医生工作台」以外的全部文字（"医疗信息本地安全保存"徽标、"标准化采集/个体化评估与干预"主标语、说明段、入口卡片副标题），居中单栏重排保持极简风（`src/app/page.tsx`）；②第二层 `/patient/flow` 删除除六步名称以外的全部文字（页头"服务流程/按顺序完成六步评估/从填写基础信息开始…"、「共 6 步」徽标、步骤描述、页内"返回首页"链接——顶栏"返回服务入口"保留），六步卡片只留编号+标题（`V2DemoPipeline` 复用既有 `hideDescriptions`），「开始第一步：填写基础信息」按钮改为「开始」；③情绪筛查（焦虑）anxiety_2q 的专题过渡句「下面问问您最近会不会紧张、担心。」整条删除——新增 `prompts.ts` 的 `SCALE_TRANSITION_SUPPRESSED_IDS` + `scaleTransitionSuppressed`（`buildTimeline` 虚拟过渡分支生效，不回退轮换池，直接开问；与语境省略 SCALE_TRANSITION_CONTEXT_SKIP 并列），`SCALE_TRANSITION_OVERRIDES` 中 anxiety_2q 条目同步移除；④frail 专题过渡句「下面问问您平时容不容易累，走路、爬楼费不费劲。」改为「下面问问您最近的活动情况。」（覆盖 2026-09-13 轮示例文案）；文本哈希变化后 TTS 音频自动重新合成，01 表源与 scales-v2.json 不动。

- **2026-11-10 患者报告版式改版（用户拍板，参考 `报告输出的样式.png`，分两步）**：**X-Age 是第三方品牌，任何页面/报告/水印都不得出现**（用户当日更正）；报告分「预览报告」与「下载报告」两个面。**预览报告**（`/patient/sessions/[id]`，大屏适老化字号）——页头「老年综合评估报告」+「下载报告」按钮，身份条展示编号/**脱敏姓名**（首字+女士/先生，报告页不再出现全名与"爷爷/奶奶"称呼）/性别/年龄/身高/体重/测试时间，新增「基本情况」（病史记录=现有诊断+既往史+近期急性疾病去重；用药评估=多重用药量表标签+档案用药清单；家庭照护者=照护情况+居住类型）与「既存问题」（全部异常标签平铺胶囊，无异常则整块不渲染）；档案侧派生口径收敛在 `src/lib/assessment/report-profile.ts`（纯函数，有单测）。**本版不做**：「综合评分」（无医学计分规则，禁止自造公式）、「吸烟饮酒史」（档案无此字段）。范围只限患者端，医生端结果页不变。**下载报告**（`/patient/sessions/[id]/report`，A4 版式与参考图一致，`report-document.tsx` + `globals.css` 的 `.report-doc*`/`@page`/`@media print`）——页头与身份条每页重复（外层 table 的 thead）、基本情况、既存问题、「综合评估结果」四列表（评估内容/评估结果/正常范围/提示，异常▲标红）、干预建议清单（只列名称，完整教程在预览页；硬约束 5）；下载方式为**浏览器打印对话框「另存为 PDF」**（`print-button.tsx`，零新增依赖、矢量 PDF，文件名「老年综合评估报告_编号」不含姓名；如要"一键落盘不弹对话框"需新增依赖，待拍板）。结果表派生口径在 `src/lib/assessment/report-rows.ts`：评估结果只对有总分口径的判定类型（sumRange/thresholdByEducation/ladderScore）显示总分，阴阳性类量表显示「—」；正常范围取该量表正常档标签在 02 表的 `rule` 原文（不自造数值范围；居家环境筛查/疼痛行为评估无正常档标签显示「—」）；中医体质按体质拆行（转化分 + 该体质「否」档规则）；零标签量表占行并注明「需医护测量后评定/本次未得出结论」。**异常判定改为按标签编码显式分级**（`src/lib/assessment/tag-severity.ts`：正常档 50 个、记录性 16 个显式列出，其余为异常；`tests/tag-severity.test.ts` 锁定完整异常清单，02 表增删标签会使测试失败强制归类；旧的标签名关键词正则只留作历史快照兜底）——分级为工程侧整理，**待甲方医学确认**（如「平和质：否」「粪便性状 N 型」「NRS2002 初筛阳性」归记录性，Morse 低风险、Braden 19～23 分、平和质基本是归正常）。数据隔离校验抽到 `src/app/patient/sessions/[id]/session-access.ts` 供两个页面共用。

- **2026-11-10 画图题视觉模型看图判定（用户拍板：阿里通义千问 VL；模型结论直接计分、医生事后可改判；画钟按现有题面判、不评指针时间）**：第一步画钟（`minicog_2`）已落地，临摹五边形（`mmse_30`，目前仍是医护操作题、患者端不出题、项目内无示例图）待做。链路：患者交卷 → `service.ts` 的 `drawingOutcome` → `src/lib/dialogue/drawing-judge.ts` → `src/lib/providers/vision.ts`（OpenAI 兼容多模态，`DASHSCOPE_API_KEY`/`VISION_API_KEY`、`VISION_MODEL`、`VISION_API_BASE`、`VISION_EXTRA_BODY`；走默认百炼入口时自动 `enable_thinking=false`，不关时实测单次 15～30 秒且频繁超时）。**关键设计：模型只"观察"不"判对错"**——让模型逐个报告 1～12 每个数字的实际方位（八方位）、轮廓、指针数，对错由 `clockVerdict` 纯函数判定并映射回 01 表选项（正确=最高分选项、错误=0 分选项），评分引擎与医学 JSON 零改动（硬约束 2）。起因是实测让模型直接判对错时，会把"12 个数字全挤在右半边"的画钟脑补成"12 在上、3 在右、分布均匀"并判正确；改为逐数字报告方位后，7 张合成图（标准/挤一侧/无指针/空白/逆时针/缺数字/整体旋转）在 qwen3-vl-plus、qwen3.5-plus、qwen3.6-plus、qwen3.7-plus、qwen3.8-flash、qwen3.8-max 六个模型上全部判对，单次约 3～5 秒。判定口径：无轮廓/数字不齐或重复/指针不足两根/12、3、6、9 偏两格及以上/两个及以上其他数字偏两格及以上 → 错误；基准数字偏一格、单个数字明显错位、模型置信度 <0.7 → 临界交医生；未配密钥/调用失败/输出不合法 → 回落原口径（pending 待医生确认、报告标「部分计分」）。出网只有图片与提示词，不带患者编号/姓名。**已知限制**：验证用的是程序生成的合成图（印刷体数字），未用真实老人手写样本验证，上线前需用真实画作抽检；01 表选项写"指针显示规定时间"但题面未规定时间，该矛盾待甲方确认（若改为指定时间需改 `drawing-judge.ts` 的观察提示词与判定）。E2E（`playwright.config.ts`）把视觉密钥置空，回归用例走兜底路径且不出网。

- **2026-11-11 选择页视觉精修（用户给参考图拍板，起因见会议纪要「认知评估系统功能优化讨论」：界面密、杂、不够简洁）**：中间试过 iOS 列表式改版（左右分栏、开关行）被用户否决，**保留原页面结构（三套餐卡片横排 + 分组带 + 量表方块 + 底部提交栏）只精修视觉**。用户口径：①目标设备为 **PC 16:9**，基本无手机访问；②**蓝白单色、简洁明亮**，不要多彩色块（唯一保留的暖色是「需医护协助」琥珀标签，参考图如此）。实现只改 `src/app/assessment-design.css`（令牌在 `.care-shell`：`--care-ink`/`--care-selected-fill` 等）——选中态由整块实色改为淡蓝渐变 + 柔和蓝色投影，未选为白底细边；分组带淡渐变 + 细边、圆角加大；图标改细线条（CSS `stroke-width: 1.6`）；提交按钮蓝色渐变 + 投影；`--care-rule` 调淡为 `#e1e8f2`（报告页分割线同步变淡）。因样式挂在共享组件 `assessment-selection.tsx` 的类上，**四个量表选择方式页、医生端发起评估表单、报告页补充评估清单同步生效**，组件与交互零改动（全选/清除、按组全选清除、显示项目说明均保留；按组全选清除随后经用户拍板删除，见本条末）。同日追加**矮屏适配**：用户反馈 1366 下「确认并开始评估」底栏压住第二组。底栏改为不透明白底 + 向上柔影（不再半透明叠在卡片上）；`@media (min-width:900px) and (max-height:1000px)` 收紧顶栏、标题、套餐卡、分组标签列与方块的纵向尺寸（浏览器实际可视高：1366×768≈650px、1920×1080≈950px，故阈值取 1000px），门诊简版在 1366×768 视口一屏放下；内容更长（如标准包）时底栏作为浮层吸底属预期行为。同日**全站铺开第 1 批（患者端评估前各页 + 首页）**：用户确认「按 1920 版风格修改整个项目」。①统一内容框：`.care-shell` 新增 `--care-frame:1440px`/`--care-gutter`，患者端顶栏与 `.patient-main`（问询页 `.patient-main-interview` 除外）共用，品牌标与页面标题左缘对齐，各页去掉 `max-w-[66rem]` 等自带宽度；②新增通用卡片语言（均在 `assessment-design.css`）：`care-card`/`care-card-link`/`care-icon-chip`/`care-card-title`/`care-card-text`/`care-band`/`care-toggle-card`/`care-primary-button`/`care-action-row`；③首页 `/` 去掉深藏青主视觉，改淡蓝渐变（`care-home*`，页面内单独挂 `care-shell` 并 import 样式）；`/patient` 改大卡片入口；`/patient/flow` 六步宽屏一行横排带连线；方式选择页四卡一行；建档页去外层面板、必填项放淡蓝分组带；自选组合预设套餐卡、病历/随访页面板换为同款令牌。`PatientPageHeading` 的 `icon` 在 plain 模式下改为可选。医生端侧栏为 sticky 100vh，整页截图中「背景不到底」是截图假象，未改。随后用户反馈流程页「一横过去」不合适、要以序号为主并讲究**整齐、对称、比例**（且要求其他页同样遵守）：流程页先改为序号节点 + 连线 + 居中步骤卡（`.care-stepper*`，已被下述第三版取代、样式已删除）；用户随后给出工作台样稿（`code_artifact (1).html`）要求借鉴其设计思路但文字更少，第三版改为**「采集阶段 1–3」「决策阶段 4–6」两条淡蓝分组带左右对称、各含三张等宽等高步骤卡（卡内只有左上角序号 + 图标 + 步骤名），两带之间一个箭头圆钮对齐卡片中线，下方整宽蓝色渐变启动区（仅「开始健康评估」一行标题 + 白色「开始」按钮）**（`.care-flow*`，`v2-pipeline.tsx` 按阶段分组渲染）；样稿中的阶段说明、步骤副标题与描述、「点击进入此环节」、搜索框等一律不采用；`/patient` 只有一个入口时改横向长卡占满整行（`.care-entry-card[data-wide]`）；方式卡说明固定两行高、标题区贴底，四卡标题同一水平线；建档页两栏等宽、均为淡蓝面板、面板标题同高（`.care-panel-title`）。后续各页改版都按此口径：对称、等宽等高、同一水平线。同日用户拍板**删除各分组的「全选本组 / 清除本组」**，只保留页面级「全选 / 清除已选」：`AssessmentBulkActions` 去掉 `group` 参数、`ScaleGroup` 去掉 `actions` 插槽；病历智能页原先只有分组级按钮，改为标题栏一组页面级按钮（覆盖「优先推荐 + 可补充项目」）；医生端发起评估的自定义组合同步删除。
- **2026-11-11 品牌嵌入（用户拍板：品牌名与全称取自项目建设方案封面，logo 用用户提供的图标，展示位置按样稿确认）**：品牌文案统一引用 `src/lib/brand.ts` 的 `BRAND`，logo 用 `src/components/brand-logo.tsx`（普通 `<img>` 而非 next/image——便携包 standalone 无 sharp）。展示位置：①首页 `/` 主视觉（大 logo + 岐颐智护 + TCM-CARE + 中文全称 + 英文全称）；②患者端顶栏（logo + 岐颐智护 | TCM-CARE，原 HeartPulse 图标与"老年健康评估"文字已替换）；③医生端侧栏（logo + 岐颐智护 / 医生工作台）、顶栏左侧为中文全称；④下载报告 A4（`report-document.tsx`）页眉右侧为 logo + 岐颐智护 TCM-CARE（用 div/b/small 而非 span，避开 globals.css 的 `.report-doc-head span` 灰色小字规则），新增 tfoot 页脚「岐颐智护 · 中文全称」，打印时随 thead 每页重复；⑤预览报告页底部品牌行（**页头不重复品牌**——正上方患者顶栏已有，与样稿第 4 项的差异已告知用户）；⑥浏览器标签：根布局 metadata 标题「岐颐智护 TCM-CARE」（`layout.tsx` 为字面量，与 `BRAND` 重复，后续可改为引用常量）、`favicon.ico`（16/32/48/64 多尺寸）与 `apple-icon.png`（180）由用户 logo 生成；⑦便携包启动提示与使用说明标题（`scripts/pack-share.mjs`）。报告 h1「老年综合评估报告」保留不变（e2e 依赖）。logo 叶片为绿色，属品牌资产，作为蓝白单色口径的例外（与「需医护协助」琥珀标签同属允许的非蓝色）。样式在 `assessment-design.css` 的 `care-home-logo`/`care-home-code`/`care-home-fullname*`/`care-brand*`/`care-report-brand`/`report-doc-brand`/`report-doc-brandline`。

## 高风险区域（改动前格外小心）

- `src/lib/scoring-v2`、`src/lib/recommend-v2`、`data/judgments-v2.json`、`data/*-v2.json`：医学正确性，测试先行。
- `src/lib/providers` 出网路径：PII 过滤合规红线。
- 中医转化分、湿热质性别 N/A、MMSE 文化分层、CAM/GLIM 组合判定：易写错。

## 项目特定规范

- 注释用中文；实现业务规则处必须注明出处，如 `// 来源：量表题目_Demo.txt 五、平和质判定规则`。
- 有业务含义的源文件写 INPUT/OUTPUT/POS 文件头注释。
- 更新文档用精确替换，不整文件覆盖；目录内容变化时同步更新目录说明。
