<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 老年健康智能评估与干预系统 Demo

## 项目概览

**项目名称**：老年健康智能评估与干预系统 Demo（YY-Demo）

**核心目标**：系统代替医护人员完成老年患者健康信息采集（数字医生语音对话），自动完成标准化评估并生成评估标签，再按积分排名推荐个体化干预方案。Demo 阶段跑通 **Demo_v2 六步主流程**：**基础信息填写 → 量表工具选择 → 数据采集 → 结果判断 → 干预匹配 → 干预展示**（来源：`V2/Demo_v2更新说明.docx`）。

**使用者**：医生（建档、量表选择、医护题代填、干预方案审核）+ 老年患者（大屏语音/点选/数字/画钟，**可自助建档并直接开始评估**；问答完成后同屏看报告与候选干预）。入口 `/doctor`、`/patient`；Demo 不做真实登录鉴权。患者自助建档：姓名/性别/年龄必填 + 测量选填 + 可评分量表多选（默认 `fall_3q`+`frail`）。Demo 口径：患者答完一律出报告，医生检查题 `deferClinical` 豁免并标注「部分计分」。医生完整建档见 `/doctor/patients/new`（含 V2 基本情况/疾病用药/人体测量三块），与患者入口共用 `patient-intake.ts` 校验。

**当前阶段**：Demo V2 主链路已装机（42 可评分量表）。进度事实来源 **`docs/V2-迭代任务清单.md`**。规则源只读目录 **`V2/`**（4 张 xlsx + Demo_v2更新说明.docx + figure 1.png）。

## 技术栈与外部服务（已确认，勿再更换）

| 项 | 结论 |
|---|---|
| 框架 | Next.js (App Router) + TypeScript + Prisma + SQLite + Tailwind，单一代码库 |
| 回答归一化 LLM | DeepSeek API（判断回答是否满足题意 + 解析为标准答案，JSON mode） |
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
6. **评估报告生成不经医生前置审核**：问答完成即评分出报告；**最终干预仍须医生审核**（`draft`→`confirmed`）。`deferClinical`：系统/医护类缺失豁免计分并标「部分计分」；普通问答题「待人工确认」仍阻断。

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
├── src/components/           # intervention-media + v2-pipeline
├── src/lib/scoring-v2/       # V2 评分引擎（纯函数）
├── src/lib/recommend-v2/     # V2 推荐引擎（100/-100/5 类）
├── src/lib/rules/v2.ts       # V2 规则读取入口；index.ts 为旧形状投影
├── src/lib/dialogue/         # 状态机 + 旁白 + 归一化
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
- 现场网络不可控 → TTS 按文本哈希预热缓存 + 文字/按钮作答兜底 + 归一化规则兜底。
- 部分干预方案自带禁忌提示（优质蛋白强化-肾功能异常、活血食养-抗凝药物、温阳食养-口干烦热、滋阴食养-糖尿病不加糖），医生审核界面必须醒目展示。V2.0 起安全提示/适宜人群随素材正文展示（图片内含温馨提示，运动项随文字要点），不再单独抽取。
- V2.0 干预素材：D01-D10/C01-C08 图片由 convert-rules 从 docs/source **palette 量化压缩**（目标单张 <600KB，quality 90→50 逐级下调至达标，超出告警不中止）后拷贝到 `public/interventions/`，并同步派生同名 **WebP**（前端 `<picture>` 优先取 WebP、回退 PNG）；图片/视频 `mediaSrc` 均附内容哈希 `?v=`，`/interventions/*` 走 immutable 长缓存（带宽受限服务器减负）；~~M01-M12 视频已就位~~（V1 残留表述，2026-08-08 修订）：V2 运行时不认 M/D/C 命名，`convert-rules-v2` 按 `<YD/SS/ZY编码>.mp4/.png` 检测。2026-08-08 经名称+正文逐条比对（图片逐张目检）完成 12 项 V1→V2 映射复制（视频 YD01–YD06/YD09、图片 SS02/SS03/SS04/ZY02/ZY10，映射表见 `scripts/convert-rules-v2.ts` 的 `MEDIA_V1_SOURCE`），`mediaAvailable=true` 且 `mediaSrc` 附内容哈希 `?v=`；其余 48 项仍 `mediaAvailable=false` 显示「素材待补齐」，新素材按 V2 编码命名放入 `public/interventions/`（视频放 `videos/` 子目录）后**重跑 `npm run convert-rules-v2`** 即自动就位并刷新哈希，无需改代码。运动卡片直接播放视频（16:9 卡内播放），播放失败仍回退动作文字要点。
- 绿色便携包（2026-07-20，`scripts/pack-share.mjs`，产物与便携 Node 均 gitignore）：`output: "standalone"` 构建 + 手工补 `public/` 与 `.next/static` + 打包期预迁移空 `dev.db`（收件机无 prisma CLI）+ `runtime/node.exe`（win-x64）+ 一键启动 bat，zip 约 150MB。**红线：绝不打包真实 `.env.local`**（密钥外发即泄露），只带 `.env.example` 空值模板；localhost 属安全上下文，麦克风可用。
- V2.0 补充评估（§3）：患者在报告页可对**尚未完成的量表**发起补充评估（`createSupplementarySession`，独立新会话、复用档案与测量数据、cookie 切换）；复评既有量表属医生授权，由医生在患者详情页"发起新评估"勾选。报告页展示评估时间 + 各量表"新增/复评"标识 + 历史报告入口；历史报告互访按"同患者"放宽 cookie 数据隔离（`src/app/patient/sessions/[id]/page.tsx`）。派生口径（哪些量表已完成/新增还是复评）收敛在 `src/lib/assessment/supplementary.ts`，有单测。
- V2.0 语音链路（§2.1/§2.2）：录音结束/ASR 请求与返回/答案提交/标准答案确认/播报开始均有 `logTiming` 时间戳埋点（`timing.ts`，只记事件与耗时、绝不记回答内容，输出在本机控制台）；标准答案确认后**不再弹"已记录"提示**（患者回答气泡即反馈），例外提示（网络异常/麦克风失败/识别失败/待确认）走**固定定位浮层**，不占用主内容流、不引起界面跳动。
- 47 题全量演示过长 → 会话创建时可勾选量表，演示默认只跑 FRAIL+跌倒。**患者自助建档可自选量表（2026-08-08 口径：42 个可评分量表全开放多选，默认仍勾 FRAIL+跌倒三问）**——不再固定锁死。语音问询流程（`state-machine.ts` 的 `askableQuestions`）恒跳过 `measurement`（BMI/腹围/小腿围，由建档测量数据换算）与 `observerAssisted`（舌象、面色晦黯、神经心理等需临床观察）两类题。**Demo 口径（2026-07-20 拍板，覆盖此前"落 `awaiting_doctor` 等医生补录"的优雅降级）**：患者自助答完一律出报告——这两类医生题缺失时按 `deferClinical` 豁免计分（`scoreAll`/`scoreAndSnapshot` 传参，评分引擎 `partitionMissing` 只豁免这两类、普通问答题缺失仍阻断），各体质小计/总分按已答题目累加、阈值不变，被豁免题随快照存 `AssessmentResult.deferred`，报告页标注"部分计分·仅供参考"；观察题仍只由医护判断（患者端不问不答），医生端 `CollectForm` 补录 + 手动"完成采集"的严格路径（strict，不豁免）保持不变。注意豁免的医学失真：痰湿质 4 题中 3 题是医生题（9/28/32）、血瘀质 2 题（24/33）、MNA-SF 缺 E/F 时总分上限 9，相关"是/营养正常"判定在纯自助下实际不可达——正式版必须恢复医生补录口径。**全豁免守卫（2026-08-08）**：某量表计分条目全部被 deferClinical 豁免（零条已答，如纯测量量表 calf/grip/gait_speed/dxa_bia 自助路径）时不产出任何标签（`scoreScaleV2` 统一入口 `guardFullyDeferred`），杜绝"零证据伪造阴性"；报告页对这类量表显示"需医护测量后评定"而非"无异常"。
- 2026-08-08 审计修复轮要点（五路审计 + 全量修复）：①按钮/图片作答改按 **label 精确匹配**（`matchButtonOption`，旧 score 匹配在同分选项上张冠李戴——便秘筛查恒假阳性、Bristol 恒 1 型，属医学级 bug）；②画钟交卷 pending 在状态机复问轮跳过（此前含 minicog 会话必卡死 500）；③医生「同类替换」对快照 forbidden（-100）项 UI 禁用 + `confirmPlan` 服务端硬拦截；④`createSupplementarySession` 校验 cookie 归属同患者 + 源会话已出报告（堵跨患者越权）；⑤PII 值级防线接线：DeepSeek 归一化口述与 emr 病历文本出网前对患者姓名做**替换式脱敏**（不 throw，患者自报姓名是合法场景），`piiValues` 兜底扫描；⑥多选题不开放语音/文字作答（单选归一化会丢多选语义），只保留点选。
- 语音联调状态（2026-07-14 真实密钥验证）：**TTS 已通**（v3 单向流式 `/api/v3/tts/unidirectional`，资源 `seed-tts-2.0`，uranus 系列音色，逐行 JSON 流拼接音频）；**DeepSeek 归一化已通**（口语命中/模糊追问均正确）；**ASR 已通**（2026-07-14 补开通后复测，`volc.bigasr.auc_turbo` 拿真实录音直连与经 `/api/asr` 路由全链路复测均返回正确转写文本）；流式识别 `volc.bigasr.sauc.*` 与端到端实时语音大模型 `volc.speech.dialog` 尚未使用（`volc.speech.dialog` 已确认账号授权，WebSocket 握手返回 101，但产品化前需先定音口径，见下一条）。
- 归一化编排原则：DeepSeek 通道可用时其结论（含 unclear）即最终结论，**规则不得复核推翻**——"我没听明白"这类表达会被关键词规则误判成"否"；规则兜底只在模型通道失败（无密钥/网络/超时）时启用。
- 患者语音作答免按钮（2026-07-14 扩展为全程免动手）：`wav-recorder.ts` 内置能量阈值 VAD（开麦后前 300ms 采环境噪音自适应定阈值，说话满 300ms 计入"说话"防误触发，静音持续 1500ms 判定"说完了"自动提交，20s 硬顶兜底）。这是近似方案而非语义理解，老年患者语气停顿长，阈值不可能对所有人调到完美，`answer-input.tsx` 的 `VoiceButton` 因此在录音全程保留弱化样式的手动"我说完了，直接提交"按钮兜底，不是可选项。若后续要换更稳的方案（如接入端到端实时语音大模型的内置 VAD），需求先确认清楚"数字医生是否可以自由对话"这条医学口径（会放开量表原文措辞这条硬约束），不是纯技术选型。VAD 档位可经 `WavRecorder.start(stream, vad, config?)` 覆盖：**答题不传 config，行为与既有一致**；**intro 语音确认**（讲解播完说"好的/开始"进第一题）走独立的 `CONSENT_VAD_CONFIG` 宽进档（更短 minSpeech 150ms、更低门槛 ×2、更快说完判定 700ms、更早超时 4s，并加**门槛上限**兜住"讲解一结束就抢答、说话落进 300ms 校准窗把门槛顶到够不着"这一漏判成因）。确认监听超时**不再静默死锁**：自动重新听 + 提示患者"没听清就点『开始』" + 「开始」大按钮始终兜底（2026-07-15 修：此前一次 8s 无声超时后就再也不听，反复说"好的/开始"无反应）。`VoiceActivityDetector` 已导出并有纯状态机单测（`tests/wav-recorder-vad.test.ts`）锁"只放宽确认、不动答题"。
  麦克风流的申请与单次录音生命周期是分离的（`requestMicStream()` vs `WavRecorder.start(stream, vad)`）：患者在"开始评估"画面选"🎤 语音问答（推荐，默认）"这一下点击里申请一次麦克风，流由 `interview-screen.tsx` 持有跨题复用——同一权限一旦被允许，同页面后续再申请不需要新手势也不会弹窗，这是能做到"播报完自动开始听"而不必每题都点一次的前提。每题播报（`playSpeaks`）结束后 `interview-screen.tsx` 置 `readyForVoice=true` 驱动 `VoiceButton` 自动开始录音；"语音直答（免确认）"在语音模式下默认勾选（2026-07-14 与用户确认，尽量减少动手），手动模式（"👆 手动选择作答"）完全不出现语音入口、不申请麦克风，尊重患者选择。语音授权被拒绝时静默降级为手动模式，不阻塞流程。
- 端到端实时语音大模型（RealtimeAPI，`volc.speech.dialog`）评估结论（2026-07-14）：事件 `ChatTTSText`（500）文档定义为"客户端指定文本合成音频"，可覆盖模型自身闲聊回复，理论上兼容"问题必须是量表原文"这条硬约束；但协议只保证"必须在收到 `ASREnded` 之后发送"这个时序，没有"关闭模型自动回复"的配置开关，未做过真实网络下的双方案联调，不能断定绝无双重出声。当前患者端免提方案未采用这条路径，改用上面这条"极速版 ASR + 客户端 VAD"，零新增授权依赖、无时序契约风险。
- Windows PowerShell 的文本管道（`Get-Content | Set-Content`）会把 UTF-8 中文按 GBK 误读导致乱码：改代码/文档一律用编辑工具做精确替换，禁止用 shell 管道改写含中文的文件。

## 高风险区域（改动前格外小心）

- `src/lib/scoring-v2`、`src/lib/recommend-v2`、`data/judgments-v2.json`、`data/*-v2.json`：医学正确性，测试先行。
- `src/lib/providers` 出网路径：PII 过滤合规红线。
- 中医转化分、湿热质性别 N/A、MMSE 文化分层、CAM/GLIM 组合判定：易写错。

## 项目特定规范

- 注释用中文；实现业务规则处必须注明出处，如 `// 来源：量表题目_Demo.txt 五、平和质判定规则`。
- 有业务含义的源文件写 INPUT/OUTPUT/POS 文件头注释。
- 更新文档用精确替换，不整文件覆盖；目录内容变化时同步更新目录说明。
