# data/ — 结构化医学规则（程序运行时依据）

**这个目录是干什么的**：存放程序运行使用的结构化规则数据，是 `docs/source/` 医学源文件的机器可读形态。

**依赖**：`docs/source/` 四份只读源文件；`scripts/convert-rules.ts` 转换与校验脚本。

**产出**：评分引擎、推荐引擎、对话引擎的全部规则输入。

| 文件 | 来源 | 生成方式 |
|---|---|---|
| `scales.json` | 量表题目_Demo.txt | 手工整理（标准题面/选项/判定规则照抄源文件；口语化与复问文案为预生成话术，可人工审校） |
| `tag-mapping.json` | 评估标签-干预标签知识图谱映射表_Demo.xlsx | `npm run convert-rules` 自动生成，**禁止手改** |
| `interventions.json` | 干预标签_Demo.xlsx | `npm run convert-rules` 自动生成，**禁止手改** |

**医学规则变更的唯一路径**：改 `docs/source/` 源文件 → 重跑 `npm run convert-rules`（scales.json 同步手工更新）→ 跑 `npm test`。

## V2 迭代数据（V2/ 源文件 → `npm run convert-rules-v2`）

V2 迭代的规则源文件在 `V2/`（只读，禁止修改），由 `scripts/convert-rules-v2.ts` 生成以下四个 JSON，**禁止手改**；变更路径：改 V2/ 源文件 → 重跑 `npm run convert-rules-v2` → 跑 `tests/convert-rules-v2.test.ts`。

| 文件 | 来源 | schema 契约摘要 |
|---|---|---|
| `scales-v2.json` | V2/01_评估采集规则表.xlsx | `categories`（6 个一级分类）；`narrations[]`（总开场/分类过渡/工具说明，含 row/类别/挂载量表 scaleId/文案）；`scales[]`（42 量表：id/name/category/subcategory + `items[]`：id/row/题号/条目类型/题干/optionsRaw 原文/options 尽力解析（含分值，解不出为 null）/信息变量编码/复用规则），共 238 条目 |
| `result-tags.json` | V2/02_结果标签判定表.xlsx | `tags[]` 190 个：code（唯一）/name/scaleName（已统一为 01 表写法）/rule 判定规则原文/placeholder（名称含 `{score}` 等模板，恰 5 个） |
| `intervention-scoring-v2.json` | V2/03_标签干预匹配表.xlsx | `scoreSemantics`（100=强制、-100=禁用、0=无关、2~10=普通匹配）；`categories`（5 大类：exercise/diet/tcmFood/referral/other）；`tags[]` 190 编码升序；`matrix` 稀疏存储（只存非零，未出现的对视为 0，非零恰 638 条） |
| `interventions-v2.json` | V2/04_干预方案信息表.xlsx | `interventions[]` 60 项：code/name/category/display/mediaType（video=13/image=27/text=20）/content 正文全文/mediaSrc（video→`videos/<编码>.mp4`，image→`<编码>.png`，text→null）/mediaAvailable（按 public/ 下文件实际存在与否） |
| `judgments-v2.json` | V2/02_结果标签判定表.xlsx 判定规则 | **手工整理**（配对照测试 `tests/scoring-v2-*.test.ts`，变更必须同步本文件与测试），`npm run convert-rules-v2` 只校验不生成。`scales[]`：**42 量表全量**判定配置——`sumRange` / `anyYes` / `tcmConstitutionV2` / `thresholdByEducation` / `perQuestionTags` / `ladderScore`（视力听力阶梯）/ `anyBelowThreshold`（耳语）/ `initialGateSumRange`（NRS2002）/ `compositeAllAny`（CAM/GLIM）。每量表 `judgments` 为 1～N 份数组。禁止绕过 02 表直接改医学内容 |

另产出 `public/interventions/bristol-stool.png`（V2/figure 1.png palette 量化压缩，<600KB）+ `bristol-stool.webp`（便秘症状评估表第 9 题展示素材）。

## V1/V2.0 历史数据（待退役）

`tag-mapping.json`、`interventions.json`、`intervention-scoring.json` 为 V1/V2.0 历史数据，**M8 推荐引擎切换到 V2 数据后退役**（标记不删，保留可追溯）。
