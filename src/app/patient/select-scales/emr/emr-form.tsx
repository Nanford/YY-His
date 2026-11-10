/**
 * INPUT:  可评分量表目录（适老化标签）、患者 id、startAssessment action
 * OUTPUT: 患者端「病历智能评估」表单（客户端交互组件）
 * POS:    2026-08-08 设计图·病历智能评估：粘贴病历/诊断 → POST /api/patient/emr-suggest
 *         → 风险关键词 chips + 推荐重点（默认全选）+ 可补充（按需勾选）+ 系统判断说明；
 *         确认后提交 name="scaleIds" 建会话。病历文本只在服务端脱敏后出网，前端不触碰。
 */
"use client";

import { useMemo, useRef, useState } from "react";
import { CircleAlert, ClipboardList, FileSearch, Sparkles, Upload } from "lucide-react";
import { AssessmentSubmitBar, ScaleDetailsToggle, ScaleGroup, ScaleOption } from "@/components/assessment-selection";
import { SectionDisclosure } from "@/components/section-disclosure";

export interface EmrScaleItem {
  id: string;
  label: string;
  subtitle: string;
}

interface Props {
  patientId: string;
  catalog: readonly EmrScaleItem[];
  /** 「可补充」推荐池（展示时剔除已被推荐的量表） */
  supplementIds: readonly string[];
  error: string | null;
  action: (formData: FormData) => Promise<void>;
}

interface SuggestResult {
  scaleIds?: string[];
  reason?: string;
  keywords?: string[];
  error?: string;
}

const MAX_LEN = 2000;
const MAX_UPLOAD_SIZE = 30 * 1024 * 1024;

/** 上传文件按扩展名分流：文本前端直读；docx/xlsx 走服务端提取；PDF/图片前端本地解析（均不出网） */
const TEXT_EXTS = [".txt", ".md", ".csv", ".log"];
const SERVER_EXTS = [".docx", ".xlsx", ".xls"];
const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".bmp"];

function extOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx).toLowerCase() : "";
}

/** PDF 文本提取（pdfjs-dist v3 legacy 构建，兼容演示机旧版浏览器内核；worker 走本地 /vendor，现场无网也能用） */
async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.js");
  pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdf/pdf.worker.min.js";
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join("")
        .trim()
    );
  }
  return pages.filter(Boolean).join("\n");
}

/** 图片 OCR（tesseract.js 中文包，worker/core/语言包全部本地 /vendor，识别不出网） */
async function extractImageText(file: File): Promise<string> {
  const tesseract = await import("tesseract.js");
  const worker = await tesseract.createWorker("chi_sim", tesseract.OEM.LSTM_ONLY, {
    workerPath: "/vendor/ocr/worker.min.js",
    corePath: "/vendor/ocr/",
    langPath: "/vendor/ocr/",
    gzip: false,
  });
  try {
    const { data } = await worker.recognize(file);
    return data.text.trim();
  } finally {
    await worker.terminate();
  }
}

export default function EmrForm({ patientId, catalog, supplementIds, error, action }: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const [emrText, setEmrText] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [loading, setLoading] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [reason, setReason] = useState<string | null>(null);
  /** 本次解析推荐的量表（推荐重点区列出，勾选状态由 checked 控制） */
  const [recommended, setRecommended] = useState<readonly EmrScaleItem[]>([]);
  /** 可补充区（推荐池剔除已推荐），勾选状态同样由 checked 控制 */
  const [supplements, setSupplements] = useState<readonly EmrScaleItem[]>([]);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [fetchError, setFetchError] = useState<string | null>(null);
  /** 上传文件解析状态（成功/进行中/失败原因均在此如实反馈） */
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** 上传病历文件/图片：本机提取文字后追加进病历框（超限截断）；任何一步失败只提示、不动已有内容 */
  const handleUpload = async (file: File) => {
    if (file.size > MAX_UPLOAD_SIZE) {
      setUploadStatus(`「${file.name}」超过 30MB，请换更小的文件`);
      return;
    }
    const ext = extOf(file.name);
    setUploading(true);
    setUploadStatus(`正在读取「${file.name}」…`);
    try {
      let text = "";
      if (TEXT_EXTS.includes(ext)) {
        text = await file.text();
      } else if (SERVER_EXTS.includes(ext)) {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/patient/emr-extract", { method: "POST", body });
        const data = (await res.json()) as { text?: string; error?: string };
        if (!res.ok || !data.text) throw new Error(data.error ?? "文件解析失败");
        text = data.text;
      } else if (ext === ".pdf") {
        setUploadStatus(`正在解析 PDF「${file.name}」…`);
        text = await extractPdfText(file);
      } else if (IMAGE_EXTS.includes(ext)) {
        setUploadStatus(`正在识别图片「${file.name}」中的文字（首次识别需要加载，稍慢）…`);
        text = await extractImageText(file);
      } else {
        throw new Error("不支持的文件类型（可传 txt / docx / xlsx / pdf / 图片）");
      }
      if (!text.trim()) throw new Error("没有读到文字内容，请换更清晰的文件");
      setEmrText((prev) => {
        const joined = prev.trim() ? `${prev.trim()}\n${text.trim()}` : text.trim();
        return joined.slice(0, MAX_LEN);
      });
      setUploadStatus(`「${file.name}」已提取文字并填入病历框（超长部分已截断），可继续编辑`);
    } catch (err) {
      setUploadStatus(err instanceof Error ? `「${file.name}」：${err.message}` : `「${file.name}」读取失败`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const catalogById = useMemo(() => new Map(catalog.map((s) => [s.id, s])), [catalog]);

  const runSuggest = async () => {
    setLoading(true);
    setFetchError(null);
    setAnalyzed(false);
    try {
      const text = diagnosis.trim() ? `${emrText.trim()}\n主要诊断：${diagnosis.trim()}` : emrText.trim();
      const res = await fetch("/api/patient/emr-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emrText: text, patientId }),
      });
      const data = (await res.json()) as SuggestResult;
      if (!res.ok) {
        setFetchError(data.error ?? "解析失败，请稍后重试");
        return;
      }
      const ids = data.scaleIds ?? [];
      const toItems = (list: readonly string[]) =>
        list.map((id) => catalogById.get(id)).filter((s): s is EmrScaleItem => Boolean(s));
      setRecommended(toItems(ids));
      setSupplements(toItems(supplementIds.filter((id) => !ids.includes(id))));
      setChecked(new Set(ids)); // 推荐重点默认全选（设计图：已为您预选）
      setKeywords(data.keywords ?? []);
      setReason(data.reason ?? null);
      setAnalyzed(true);
    } catch {
      setFetchError("网络异常，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  const toggle = (scaleId: string, on: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(scaleId);
      else next.delete(scaleId);
      return next;
    });
  };

  const renderScaleCheck = (scale: EmrScaleItem) => (
    <ScaleOption key={scale.id} title={scale.label} description={scale.subtitle}
      name="scaleIds" value={scale.id} checked={checked.has(scale.id)} showDetails={showDetails}
      onChange={(e) => toggle(scale.id, e.target.checked)} />
  );

  return (
    <form action={action} className="space-y-7">
      <input type="hidden" name="mode" value="emr" />
      {error === "scales" && (
        <div className="ui-alert ui-alert-danger text-base sm:text-lg" role="alert">
          <CircleAlert size={23} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>请至少保留一项推荐项目。</span>
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        {/* 左栏：病历与诊断输入 */}
        <section className="space-y-4 rounded-2xl border border-border bg-muted/35 p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-lg font-extrabold text-[#173766]">
            <ClipboardList size={22} strokeWidth={1.9} className="text-blue-600" aria-hidden="true" />
            导入病历
          </h2>
          <label className="block">
            <span className="text-base font-bold text-foreground">病历内容</span>
            <textarea
              value={emrText}
              onChange={(e) => setEmrText(e.target.value.slice(0, MAX_LEN))}
              rows={7}
              className="patient-input mt-1.5 w-full"
              placeholder="例如：患者，82岁，近3个月体重下降约4kg，夜间睡眠差……"
            />
            <span className="mt-1 block text-right text-sm text-[#7f94b3]">
              {emrText.length}/{MAX_LEN}
            </span>
          </label>

          {/* 上传病历文件/图片（2026-08-08）：本机提取文字后填入上方病历框，不出网 */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.csv,.log,.docx,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp,.bmp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUpload(file);
              }}
            />
            <button
              type="button"
              className="ui-button ui-button-secondary w-full border-dashed"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={20} aria-hidden="true" />
              {uploading ? "正在读取文件…" : "上传病历文件或图片"}
            </button>
            <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
              支持文本、Word、Excel、PDF 和图片。原始文件在本机读取。
            </p>
            {uploadStatus && (
              <p className="mt-1.5 text-sm font-bold leading-6 text-[#405a81]" role="status">
                {uploadStatus}
              </p>
            )}
          </div>

          <label className="block">
            <span className="text-base font-bold text-[#29496f]">主要诊断</span>
            <input
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              className="patient-input mt-2 w-full"
              placeholder="例如：高血压；2型糖尿病"
            />
          </label>
          <button
            type="button"
            className="ui-button ui-button-primary ui-button-lg w-full"
            disabled={loading || emrText.trim().length < 8}
            onClick={() => void runSuggest()}
          >
            <Sparkles size={20} aria-hidden="true" />
            {loading ? "智能解析中…" : "智能解析"}
          </button>
          {fetchError && <p className="text-sm font-bold text-red-600">{fetchError}</p>}
        </section>

        {/* 右栏：系统推荐评估项目 */}
        <section className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold">推荐评估项目</h2>
            {analyzed && <ScaleDetailsToggle checked={showDetails} onChange={(e) => setShowDetails(e.target.checked)} />}
          </div>

          {!analyzed && (
            <div className="grid min-h-56 place-content-center justify-items-center gap-3 rounded-2xl border border-dashed border-input bg-card p-6 text-center text-muted-foreground">
              <FileSearch className="size-8 text-primary" aria-hidden="true" />
              <p>完成病历解析后，可在此勾选推荐项目。</p>
            </div>
          )}

          {analyzed && (
            <>
              {(keywords.length > 0 || reason) && (
                <SectionDisclosure title="查看推荐依据">
                  {keywords.length > 0 && <>
                  <p className="text-sm font-extrabold tracking-wide text-[#62779a]">提取的风险关键词</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {keywords.map((kw) => (
                      <span
                        key={kw}
                        className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-bold text-blue-700"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                  </>}
                  {reason && <p className="mt-3 text-sm text-muted-foreground">{reason}</p>}
                </SectionDisclosure>
              )}

              {/* 推荐重点（默认全选，可手动增减） */}
              <ScaleGroup title="优先推荐" count={recommended.length}>{recommended.map(renderScaleCheck)}</ScaleGroup>

              {/* 可补充池（按需勾选） */}
              {supplements.length > 0 && (
                <SectionDisclosure title="可补充项目" summary={`${supplements.length} 项`}>
                  <div className="grid gap-2 sm:grid-cols-2">{supplements.map(renderScaleCheck)}</div>
                </SectionDisclosure>
              )}
            </>
          )}
        </section>
      </div>

      <AssessmentSubmitBar count={checked.size} label="确认推荐项目" disabled={!analyzed} />
    </form>
  );
}
