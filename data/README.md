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
