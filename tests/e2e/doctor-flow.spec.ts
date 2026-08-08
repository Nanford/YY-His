/**
 * INPUT:  医生端页面、独立 E2E SQLite 数据库、V2 黄金评分用例
 * OUTPUT: 新建患者到医生确认最终干预方案的端到端验收结果
 * POS:    M2 无语音完整流程回归（V2 装机后口径）：常规综合评估包（8 量表）全量代填 →
 *         16 个评估标签 → 5 大类积分候选（9 项）→ 保留/删除/同类替换审核留痕；
 *         系统读取题（frail_4/frail_5/mnasf_2/mnasf_6）由档案数据在 finalize 时自动作答；
 *         ADL 重度依赖触发 YD07 禁止推荐明细。期望值由 tmp/e2e-golden-v2.ts 探针实算复核。
 *         （来源：V2/Demo_v2更新说明.docx §2 量表工具选择、03 表积分矩阵、M9.5 系统读取）
 */
import { expect, test, type Page } from "@playwright/test";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

type E2eAdapter = Awaited<ReturnType<PrismaBetterSqlite3["connect"]>>;
let e2eAdapter: E2eAdapter | undefined;

test.beforeAll(async () => {
  e2eAdapter = await new PrismaBetterSqlite3({ url: "file:./prisma/e2e.db" }).connect();
});

test.afterAll(async () => {
  await e2eAdapter?.dispose();
  e2eAdapter = undefined;
});

/** 直接读取独立 E2E 库的版本状态，验证页面之外的“唯一当前版本”数据约束。 */
async function readVersionStatuses(
  table: "AssessmentResult" | "InterventionPlan",
  sessionId: string,
): Promise<string[]> {
  if (!e2eAdapter) throw new Error("E2E 数据库连接尚未初始化");
  const result = await e2eAdapter.queryRaw({
    sql: `SELECT "status" FROM "${table}" WHERE "sessionId" = ?`,
    args: [sessionId],
    argTypes: [{ scalarType: "string", arity: "scalar" }],
  });
  return result.rows.map((row) => String(row[0]));
}

// 场景 A 黄金期望（探针实算）：衰弱+营养不良风险+认知初筛阳性+重度依赖+工具性严重依赖
// +抑郁/焦虑两问阴性+气虚质：是（其余 8 体质否/平和质否）→ 5 大类 9 项候选，YD07 被禁止
const expectedTags = [
  "重度依赖",
  "工具性日常生活能力严重依赖",
  "衰弱",
  "营养不良风险",
  "认知功能初筛阳性",
  "抑郁两问筛查阴性",
  "焦虑两问筛查阴性",
  "气虚质",
  "平和质：否",
];
const expectedInterventions = [
  "扶椅坐站训练",
  "定时步行训练",
  "优质蛋白强化膳食",
  "高能量高蛋白少量多餐",
  "山药莲子粥",
  "老年综合诊疗建议",
  "运动与功能康复建议",
  "照护者支持方案",
  "时间地点定向训练",
];

/** 按题目 id 和选项 label 选择医生代填答案（V2 起表单按 label 提交，同分选项可区分）。 */
async function pickLabel(page: Page, questionId: string, label: string): Promise<void> {
  const option = page.locator(
    `input[type="radio"][name="answer.${questionId}"][value="${label}"]`,
  );
  await expect(option, `题目 ${questionId} 应存在选项「${label}」`).toHaveCount(1);
  await option.check();
}

/** 患者详情页「发起新评估」：切到自定义组合并勾选指定量表。 */
async function createCustomSession(page: Page, scaleIds: string[]): Promise<void> {
  const sessionForm = page.locator("form").filter({ has: page.locator('input[name="package"]') });
  await sessionForm.locator('input[name="package"][value="custom"]').check();
  for (const scaleId of scaleIds) {
    await sessionForm.locator(`input[name="scale.${scaleId}"]`).check();
  }
  await sessionForm.getByRole("button", { name: "创建评估会话", exact: true }).click();
  await expect(page).toHaveURL(/\/doctor\/sessions\/[^/?]+$/);
}

test("医生完成常规综合评估包全量代填、评估、方案调整与确认", async ({ page }) => {
  test.setTimeout(240_000);

  await page.goto("/doctor/patients/new");
  await page.locator('input[name="name"]').fill("E2E 全流程患者");
  await page.locator('select[name="gender"]').selectOption("男");
  await page.locator('input[name="age"]').fill("78");
  await page.locator('input[name="heightCm"]').fill("165");
  await page.locator('input[name="weightKg"]').fill("55");
  // V2 补充档案：2 种诊断（frail_4 系统读取 → 否）、体重史平稳（frail_5 → 否、mnasf_2 → 没有下降）
  await page.locator('textarea[name="diagnoses"]').fill("高血压、糖尿病");
  await page.locator('input[name="weightM3"]').fill("55");
  await page.locator('input[name="weightM12"]').fill("55");

  const patientForm = page.locator("form").filter({ has: page.locator('input[name="name"]') });
  await patientForm.getByRole("button", { name: "保存档案并继续", exact: true }).click();
  await expect(page).toHaveURL(/\/doctor\/patients\/[^/?]+$/);
  await expect(page.getByRole("heading", { name: /E2E 全流程患者/ })).toBeVisible();
  await expect(page.getByText("BMI：20.2", { exact: true })).toBeVisible();

  // 量表工具选择（docx §2）：默认常规综合评估包（8 量表），其余 4 预设套餐 + 自定义
  // 共 6 个 name="package" 单选；病历智能评估为独立交互入口（不占 name="package"，
  // 选中后由隐藏域按 custom + scale.* 口径提交）。直接以默认套餐提交
  const sessionForm = page.locator("form").filter({ has: page.locator('input[name="package"]') });
  await expect(sessionForm.locator('input[name="package"]')).toHaveCount(6);
  await expect(sessionForm.locator('input[name="package"][value="routine"]')).toBeChecked();
  await expect(sessionForm.getByText("常规综合评估包", { exact: true })).toBeVisible();
  await expect(sessionForm.getByText("8 个量表", { exact: true })).toBeVisible();
  await expect(sessionForm.getByText("病历智能评估", { exact: true })).toBeVisible();
  await sessionForm.getByRole("button", { name: "创建评估会话", exact: true }).click();
  await expect(page).toHaveURL(/\/doctor\/sessions\/[^/?]+$/);

  const collectionForm = page.locator("form").filter({ has: page.locator('input[name="answer.frail_1"]') });
  // 8 个量表分区（常规综合评估包：adl/iadl/frail/mnasf/minicog/depression_2q/anxiety_2q/tcm）
  await expect(collectionForm.locator(":scope > section")).toHaveCount(8);

  // ADL 全 0 分 → 重度依赖（同时触发 YD07 禁止推荐，03 表 -100 语义）
  const adlZero: Record<string, string> = {
    adl_1: "需极大帮助或完全依赖他人，或留置胃管（0分）",
    adl_2: "洗澡过程需要他人帮助（0分）",
    adl_3: "需要他人帮助（0分）",
    adl_4: "需极大帮助或完全依赖他人（0分）",
    adl_5: "完全失控（0分）",
    adl_6: "完全失控，或留置导尿管（0分）",
    adl_7: "需极大帮助或完全依赖他人（0分）",
    adl_8: "完全依赖他人（0分）",
    adl_9: "完全依赖他人（0分）",
    adl_10: "需极大帮助或完全依赖他人（0分）",
  };
  for (const [questionId, label] of Object.entries(adlZero)) await pickLabel(page, questionId, label);

  // IADL 全 0 分 → 工具性日常生活能力严重依赖
  const iadlZero: Record<string, string> = {
    iadl_1: "完全不能上街购物（0分）",
    iadl_2: "完全不能外出（0分）",
    iadl_3: "需要他人把饭菜煮好、摆好（0分）",
    iadl_4: "完全不能做家务（0分）",
    iadl_5: "所有衣物都由别人洗晒（0分）",
    iadl_6: "完全不会使用或不适用（0分）",
    iadl_7: "不能自行服药（0分）",
    iadl_8: "不能处理财务（0分）",
  };
  for (const [questionId, label] of Object.entries(iadlZero)) await pickLabel(page, questionId, label);

  // FRAIL 1+1+1=3 分 → 衰弱；frail_4/frail_5 为系统读取题，此处刻意不填，
  // 由 finalize 按档案（2 种诊断、体重平稳）自动作答为「否（0分）」
  for (const questionId of ["frail_1", "frail_2", "frail_3"]) await pickLabel(page, questionId, "是（1分）");

  // MNA-SF：手工 0+1+0+1=2 分；mnasf_2/mnasf_6 系统读取（体重没有下降 3 分、BMI 20.2 → 1 分），
  // 总分 6 ≤ 11 → 营养不良风险
  await pickLabel(page, "mnasf_1", "食量严重减少（0分）");
  await pickLabel(page, "mnasf_3", "可以下床或离开轮椅，但不能外出（1分）");
  await pickLabel(page, "mnasf_4", "是（0分）");
  await pickLabel(page, "mnasf_5", "轻度痴呆（1分）");

  // Mini-Cog：画钟 0 + 回忆 0 = 0 分 → 认知功能初筛阳性（minicog_2 为绘图操作题，医生代填计分）
  await pickLabel(page, "minicog_2", "画钟错误或未完成（0分）");
  await pickLabel(page, "minicog_3", "回忆0个词（0分）");

  // 抑郁两问 / 焦虑两问全否 → 筛查阴性
  for (const questionId of ["depression_2q_1", "depression_2q_2", "anxiety_2q_1", "anxiety_2q_2"]) {
    await pickLabel(page, questionId, "否（筛查阴性）");
  }

  // 中医体质 27 计分题：气虚质 3 题「总是（非常，5分）」（转化分 100 → 是），其余全部「没有（根本不，1分）」
  const tcmLowest = collectionForm.locator(
    'input[type="radio"][name^="answer.tcm_constitution_"][value="没有（根本不，1分）"]',
  );
  await expect(tcmLowest).toHaveCount(27);
  for (let index = 0; index < 27; index += 1) {
    await tcmLowest.nth(index).check();
  }
  for (const questionId of ["tcm_constitution_A.1-2", "tcm_constitution_A.2-2", "tcm_constitution_A.2-3"]) {
    await pickLabel(page, questionId, "总是（非常，5分）");
  }

  await collectionForm.getByRole("button", { name: /完成采集/ }).click();

  // ---------- 评估标签：7 个非体质标签 + 9 个体体质判定 = 16 个 ----------
  // 医生端布局（doctor/layout.tsx）本身是一个 <section>，filter(has:) 会把布局也算进来，
  // 导致 details 计数连追溯区一起翻倍；改从标题出发取最近的祖先 section（组件自身面板）。
  const resultSection = page.getByRole("heading", { name: /评估标签/ }).locator("xpath=ancestor::section[1]");
  await expect(resultSection.getByRole("heading", { name: "评估标签", exact: true })).toBeVisible();
  await expect(resultSection.getByText("16 个标签", { exact: true })).toBeVisible();
  await expect(resultSection.locator("details")).toHaveCount(16);
  for (const tag of expectedTags) {
    await expect(resultSection.getByText(tag, { exact: true })).toBeVisible();
  }
  const frailDetail = resultSection.locator("details").filter({ hasText: "衰弱" }).first();
  await frailDetail.locator("summary").click();
  await expect(frailDetail.getByRole("columnheader", { name: "标准答案", exact: true })).toBeVisible();
  await expect(frailDetail.locator("tbody tr").first().locator("td").nth(2)).toHaveText("是（1分）");

  // 系统读取留痕：frail_4/frail_5/mnasf_2/mnasf_6 由档案自动作答，来源徽章「系统读取」
  const traceSectionFirst = page
    .getByRole("heading", { name: "答案与采集追溯", exact: true })
    .locator("xpath=ancestor::section[1]");
  await expect(traceSectionFirst.getByText("系统读取", { exact: true })).toHaveCount(4);

  // ---------- 候选干预方案审核：5 大类 9 项，积分明细逐项下钻 ----------
  const reviewSection = page
    .getByRole("heading", { name: "候选干预方案审核", exact: true })
    .locator("xpath=ancestor::section[1]");
  await expect(reviewSection).toBeVisible();
  await expect(reviewSection.getByText("9 项候选", { exact: true })).toBeVisible();
  await expect(reviewSection.locator('input[type="radio"][name^="action."][value="keep"]')).toHaveCount(9);
  for (const intervention of expectedInterventions) {
    await expect(reviewSection.getByText(intervention, { exact: true })).toBeVisible();
  }
  for (const category of ["运动干预", "膳食营养", "中医食养", "就诊建议", "其他"]) {
    await expect(reviewSection.getByRole("heading", { name: category, exact: true })).toBeVisible();
  }
  // V2 展示形态：YD01/YD02 视频素材已就位（卡内 <video> 播放，共 2 项）；
  // SS02/SS03 膳食图片已就位（可放大查看，共 2 项）；QT12 视频未上线回退文字要点（1 项）；
  // ZY01 图片素材待补齐（1 项）；JZ/QT 文本项正文即文字卡（3 项）
  await expect(reviewSection.locator("video")).toHaveCount(2);
  await expect(reviewSection.getByRole("button", { name: /放大查看/ })).toHaveCount(2);
  await expect(reviewSection.getByText("视频教程待上线，请先参考下方动作要点", { exact: true })).toHaveCount(1);
  await expect(reviewSection.getByText("该项图文教程素材待补齐（不以其他干预图片替代）", { exact: true })).toHaveCount(1);
  await expect(reviewSection.getByText("老年综合诊疗建议 · 文字说明", { exact: true })).toBeVisible();
  await expect(reviewSection.getByText("照护者支持方案 · 文字说明", { exact: true })).toBeVisible();
  // 积分来源明细逐项下钻：9 项各有明细；JZ02 老年综合诊疗建议累加总分最高（32）
  await expect(reviewSection.getByText("积分来源：", { exact: true })).toHaveCount(9);
  await expect(reviewSection.getByText("匹配分 32", { exact: true })).toHaveCount(1);
  await expect(reviewSection.getByText("匹配分 25", { exact: true })).toHaveCount(1);

  // 禁止推荐明细（03 表 -100 语义）：ADL 重度依赖禁止 YD07 扶椅单脚站立训练
  const forbiddenSection = reviewSection.locator('section[aria-label="禁止自动推荐明细"]');
  await expect(forbiddenSection.getByText("已禁止自动推荐（1 项）", { exact: true })).toBeVisible();
  await expect(forbiddenSection.getByText("扶椅单脚站立训练", { exact: false })).toBeVisible();
  await expect(forbiddenSection.getByText(/重度依赖/)).toBeVisible();

  // V2 审核操作：YD02 同类替换为 YD03（留痕前后编码），QT12 删除（留痕原因）
  const replacedCode = "YD02";
  const replacementCode = "YD03";
  const removedCode = "QT12";
  const replaceNote = "E2E：患者无法扶椅站立，改为坐位训练";
  const removeNote = "E2E：患者认知训练暂缓";
  await reviewSection.locator(`input[name="action.${replacedCode}"][value="replace"]`).check();
  await reviewSection.locator(`select[name="replaceWith.${replacedCode}"]`).selectOption(replacementCode);
  await reviewSection.locator(`input[name="note.${replacedCode}"]`).fill(replaceNote);
  await reviewSection.locator(`input[name="action.${removedCode}"][value="remove"]`).check();
  await reviewSection.locator(`input[name="note.${removedCode}"]`).fill(removeNote);
  await reviewSection.getByRole("button", { name: /确认最终干预方案/ }).click();

  const finalSection = page.getByRole("heading", { name: /最终干预方案/ }).locator("xpath=ancestor::section[1]");
  await expect(finalSection).toBeVisible();
  await expect(finalSection.getByText("医生已确认", { exact: true })).toBeVisible();
  // 9 候选 − 1 删除 = 8 项（替换不改变总数）；替换/删除各 1 项留痕
  await expect(finalSection.getByText("最终保留 8 项", { exact: true })).toBeVisible();
  await expect(finalSection.getByText("替换 1 项", { exact: true })).toBeVisible();
  await expect(finalSection.getByText("删除 1 项", { exact: true })).toBeVisible();
  await expect(finalSection.getByRole("heading", { name: "坐位伸膝训练", exact: true })).toBeVisible();
  await expect(finalSection.getByText("替换自 YD02", { exact: true })).toBeVisible();
  const auditSection = finalSection.locator('section[aria-label="方案审核记录"]');
  await expect(auditSection.getByText("已替换", { exact: true })).toBeVisible();
  await expect(auditSection.getByText("已删除", { exact: true })).toBeVisible();
  await expect(auditSection.getByText("YD02 → YD03", { exact: true })).toBeVisible();
  await expect(auditSection.getByText("QT12", { exact: true })).toBeVisible();
  await expect(auditSection.getByText(replaceNote, { exact: true })).toBeVisible();
  await expect(auditSection.getByText(removeNote, { exact: true })).toBeVisible();
  await expect(page.locator('input[name^="action."]')).toHaveCount(0);

  await page.reload();
  await expect(finalSection.getByText("最终保留 8 项", { exact: true })).toBeVisible();
  await expect(finalSection.getByRole("heading", { name: "坐位伸膝训练", exact: true })).toBeVisible();

  // 已确认会话重新打开后修改标准答案：旧结果/方案保留，新答案必须产生逐字段审计记录。
  await page.getByRole("button", { name: /重新打开并修正答案/ }).click();
  await expect(page.getByRole("button", { name: /完成采集/ })).toBeVisible();
  await pickLabel(page, "frail_1", "否（0分）");
  await page.getByRole("button", { name: /完成采集/ }).click();

  const sessionId = new URL(page.url()).pathname.split("/").at(-1);
  if (!sessionId) throw new Error("无法从会话页面 URL 读取会话编号");

  const traceSection = page
    .getByRole("heading", { name: "答案与采集追溯", exact: true })
    .locator("xpath=ancestor::section[1]");
  const editedAnswer = traceSection.locator("details").filter({ hasText: "过去4周" });
  await editedAnswer.locator("summary").click();
  const answerEdits = editedAnswer.getByText("原因：医生代填或修改标准答案", { exact: true });
  await expect(answerEdits).toHaveCount(2); // 标准答案文本与标准分值分别留痕
  await expect(answerEdits.first()).toBeVisible();
  // frail_1 修改 1 道；另 4 道系统读取题在表单回提交时被医生原值再确认（来源 system→doctor 留痕）
  await expect(traceSection.getByText("5 道已修改", { exact: true })).toBeVisible();

  // 重评后旧快照仍在，但当前结果与待确认方案各只能有一条。
  const resultVersions = await readVersionStatuses("AssessmentResult", sessionId);
  expect(resultVersions.filter((status) => status === "current")).toHaveLength(1);
  expect(resultVersions.filter((status) => status === "superseded")).toHaveLength(1);

  const planVersionsBeforeConfirm = await readVersionStatuses("InterventionPlan", sessionId);
  expect(planVersionsBeforeConfirm.filter((status) => status === "draft")).toHaveLength(1);
  expect(planVersionsBeforeConfirm.filter((status) => status === "confirmed")).toHaveLength(0);
  expect(planVersionsBeforeConfirm.filter((status) => status === "superseded")).toHaveLength(1);

  await page.getByRole("button", { name: /确认最终干预方案/ }).click();
  await expect(page.getByText("医生已确认", { exact: true })).toBeVisible();
  const planVersionsAfterConfirm = await readVersionStatuses("InterventionPlan", sessionId);
  expect(planVersionsAfterConfirm.filter((status) => status === "confirmed")).toHaveLength(1);
  expect(planVersionsAfterConfirm.filter((status) => status === "superseded")).toHaveLength(1);
});

test("系统读取题缺失先阻断，代填后候选为空医生可确认空干预方案", async ({ page }) => {
  test.setTimeout(180_000);

  await page.goto("/doctor/patients/new");
  await page.locator('input[name="name"]').fill("E2E 空方案患者");
  await page.locator('select[name="gender"]').selectOption("女");
  await page.locator('input[name="age"]').fill("72");
  // 不填任何测量/补充档案：frail_4/frail_5 系统读取推不出，strict 路径应阻断并列出缺失
  await page.getByRole("button", { name: "保存档案并继续", exact: true }).click();
  await expect(page).toHaveURL(/\/doctor\/patients\/[^/?]+$/);

  // 自定义组合：只勾选 FRAIL + 跌倒三问
  await createCustomSession(page, ["frail", "fall_3q"]);

  const collectionForm = page.locator("form").filter({ has: page.locator('input[name="answer.frail_1"]') });
  await expect(collectionForm.locator(":scope > section")).toHaveCount(2);

  for (const questionId of ["frail_1", "frail_2", "frail_3"]) await pickLabel(page, questionId, "否（0分）");
  for (const questionId of ["fall_3q_1", "fall_3q_2", "fall_3q_3"]) {
    await pickLabel(page, questionId, "否（筛查阴性）");
  }

  // strict finalize：frail_4/frail_5（系统读取，档案无数据可推）未答 → 阻断并列出缺失题
  await collectionForm.getByRole("button", { name: /完成采集/ }).click();
  await expect(page).toHaveURL(/error=incomplete/);
  await expect(page.getByText("以下题目尚未确认，无法生成评估", { exact: false })).toBeVisible();
  await expect(page.getByText(/FRAIL量表第 4 题/)).toBeVisible();
  await expect(page.getByText(/FRAIL量表第 5 题/)).toBeVisible();

  // 医生代填系统读取题后重新提交（此前已答题目由 savedLabels 预勾选保留）
  await pickLabel(page, "frail_4", "否（0分）");
  await pickLabel(page, "frail_5", "否（0分）");
  await page.getByRole("button", { name: /完成采集/ }).click();

  // 全部阴性：无衰弱 + 跌倒风险筛查阴性，积分矩阵无匹配 → 候选为空
  const resultSection = page.getByRole("heading", { name: /评估标签/ }).locator("xpath=ancestor::section[1]");
  await expect(resultSection.getByText("2 个标签", { exact: true })).toBeVisible();
  await expect(resultSection.getByText("无衰弱", { exact: true })).toBeVisible();
  await expect(resultSection.getByText("跌倒风险筛查阴性", { exact: true })).toBeVisible();

  const reviewSection = page
    .getByRole("heading", { name: "候选干预方案审核", exact: true })
    .locator("xpath=ancestor::section[1]");
  await expect(reviewSection.getByText("暂无候选干预方案", { exact: true })).toBeVisible();
  await reviewSection.getByRole("button", { name: "确认暂无候选方案", exact: true }).click();

  const finalSection = page.getByRole("heading", { name: /最终干预方案/ }).locator("xpath=ancestor::section[1]");
  await expect(finalSection.getByText("最终保留 0 项", { exact: true })).toBeVisible();
  await expect(finalSection.getByText("本次评估无最终干预项目", { exact: true })).toBeVisible();
  await expect(finalSection.getByText("医生已确认", { exact: true })).toBeVisible();
});
