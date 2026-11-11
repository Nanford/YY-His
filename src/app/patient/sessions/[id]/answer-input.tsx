/**
 * INPUT:  当前题目 DTO、能力开关（asr）、语音模式与已持有的麦克风流、提交回调
 * OUTPUT: AnswerInput —— 患者作答区（四种输入模式：大按钮 / 文字 / 语音确认 / 语音直答）
 * POS:    患者端输入模式的统一实现。语音链路任何一环不可用时按钮/文字始终可用
 *         （AGENTS.md：四种输入模式并存 + 兜底）。mode="voice" 时语音为主，播报完
 *         由父组件（interview-screen.tsx）通过 autoStart 驱动自动开始听，免去
 *         每题都要患者手动点一次的问题；mode="manual" 时完全不出现语音入口，
 *         尊重患者在开始画面的选择。
 *         2026-11-11 视觉精修：根容器与题干同列（.care-interview-column）；单选大按钮网格
 *         .care-option-grid 等高、奇数个时末项居中（样式在 assessment-design.css）。
 *         2026-11-11 看图识物：题目带配图（MMSE 命名题）时图片置于作答控件之上（.care-stimulus）。
 *         2026-11-11 画图题通用化：作答提示取题目配置（drawingHint）；临摹题（MMSE 五边形）参照图
 *         与画板并排（.drawing-stage）。
 *         2026-11-11 画板改版：画板放大（工具列移到右侧、参照图缩为画板 2/3）、画笔/橡皮切换；
 *         交卷改两步——「画好了」锁定并拍下 480 快照，「确认提交」才把快照交给视觉模型。
 */
"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowRight, Check, Eraser, Keyboard, LoaderCircle, Lock, Mic, Pencil, RefreshCw, Send, Undo2, Volume2 } from "lucide-react";
import type { PatientPromptDto } from "@/lib/dialogue/service";
import { RecorderError, WavRecorder, type VadStopReason } from "./wav-recorder";
import { logTiming } from "./timing";

export interface VoiceAnswer {
  text: string;
  audioPath?: string;
  asrRaw?: unknown;
}

interface AnswerInputProps {
  prompt: PatientPromptDto;
  sessionId: string;
  asrEnabled: boolean;
  /** 患者在开始画面的选择：语音为主 / 只用手动 */
  mode: "voice" | "manual";
  /** mode="voice" 且麦克风授权成功时非空；由父组件持有，跨题复用，本组件不申请也不释放 */
  micStream: MediaStream | null;
  /** 本题播报已结束，语音模式下应自动开始听；每次挂载只消费一次 */
  autoStart: boolean;
  disabled: boolean;
  /** 大按钮/图片选择：提交选中选项的完整 label（同分选项靠 label 区分，服务端按 label 精确匹配） */
  onSubmitOption: (label: string) => void;
  /** number 题数字面板：分值唯一，提交分值 */
  onSubmitButton: (score: number) => void;
  onSubmitText: (text: string) => void;
  onSubmitVoice: (answer: VoiceAnswer) => void;
  /** M9.6 多选 */
  onSubmitMulti: (labels: string[]) => void;
  /** M9.6 画钟交卷 */
  onSubmitDrawing: (dataUrl: string) => void;
  onSubmitAcknowledge: () => void;
  onNotice: (message: string) => void;
}

export function AnswerInput(props: AnswerInputProps) {
  const [textOpen, setTextOpen] = useState(false);
  const [pendingVoice, setPendingVoice] = useState<VoiceAnswer | null>(null);
  /** 语音直答：转写完成后免确认直接提交。语音模式默认开（尽量免动手），手动模式无意义但保持一致初值 */
  const [directVoice, setDirectVoice] = useState(props.mode === "voice");
  const voiceActive = props.mode === "voice" && props.asrEnabled && props.micStream !== null;
  const answerType = props.prompt.answerType;
  /** 自由回答题（2026-08-13 认知题改版）：不展示选项按钮（标准答案不泄露），语音/文字自由作答 */
  const freeAnswer = answerType === "freeText";
  // 数字/多选/图片/画钟题以专用控件为主；仅 number 题保留语音/文字兜底（分值唯一不会歧义）。
  // 多选题不出语音/文字入口：归一化只返回单个选项会丢多选语义（图片/画钟题本就走专用控件）
  const specialType =
    answerType === "number" ||
    answerType === "multiChoice" ||
    answerType === "imageChoice" ||
    answerType === "drawing" ||
    answerType === "acknowledge";
  const showVoiceTextFallback = !specialType || answerType === "number";
  /** 看图识物题（MMSE 命名，2026-11-11）的屏幕图片；Bristol 参照图、临摹参照图由各自面板展示 */
  const stimulusSrc = answerType === "imageChoice" || answerType === "drawing" ? undefined : props.prompt.imageSrc;

  const handleTranscript = (answer: VoiceAnswer) => {
    if (directVoice) {
      props.onSubmitVoice(answer);
    } else {
      setPendingVoice(answer);
    }
  };

  // 切题时的状态重置由父组件的 key（questionId+attempt）触发整体重挂载完成

  /** 语音模式：监听区置顶作主视觉；选项/专用控件作兜底，避免大按钮把声波挤成角落小控件 */
  const voicePrimary = voiceActive && !pendingVoice && showVoiceTextFallback;

  const specialOrOptions = pendingVoice ? (
    <TranscriptConfirm
      transcript={pendingVoice.text}
      disabled={props.disabled}
      onConfirm={() => {
        props.onSubmitVoice(pendingVoice);
        setPendingVoice(null);
      }}
      onRetry={() => setPendingVoice(null)}
    />
  ) : answerType === "number" ? (
    <NumberInputPanel
      prompt={props.prompt}
      disabled={props.disabled}
      onSelect={props.onSubmitButton}
    />
  ) : answerType === "multiChoice" ? (
    <MultiChoicePanel
      prompt={props.prompt}
      disabled={props.disabled}
      onSubmit={props.onSubmitMulti}
    />
  ) : answerType === "imageChoice" ? (
    <ImageChoicePanel
      prompt={props.prompt}
      disabled={props.disabled}
      onSelect={props.onSubmitOption}
    />
  ) : answerType === "drawing" ? (
    <DrawingPanel
      disabled={props.disabled}
      onSubmit={props.onSubmitDrawing}
      hint={props.prompt.drawingHint}
      referenceSrc={props.prompt.imageSrc}
    />
  ) : answerType === "acknowledge" ? (
    <AcknowledgementPanel disabled={props.disabled} onSubmit={props.onSubmitAcknowledge} />
  ) : freeAnswer ? (
    // 自由回答题：选项区只放作答提示，标准答案不出现在患者屏幕上
    <p className="rounded-2xl border border-blue-100 bg-blue-50/60 px-6 py-4 text-center text-lg font-semibold text-[var(--ink-muted)]">
      {voiceActive ? "请直接说出您的答案，说完稍停片刻会自动提交。" : "请在下方输入您的答案后提交。"}
    </p>
  ) : (
    <OptionButtons
      prompt={props.prompt}
      disabled={props.disabled}
      onSelect={props.onSubmitOption}
      compact={voicePrimary}
    />
  );

  return (
    // 与题干同一内容列（.care-interview-column），题干左缘与选项左缘对齐
    <div className="care-interview-column mx-auto w-full space-y-4">
      {/* 看图识物：图片在作答控件之上，先看图再作答；alt 不写物品名称，避免读屏泄露答案 */}
      {stimulusSrc && (
        <figure className="care-stimulus">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={stimulusSrc} alt="题目图片" />
        </figure>
      )}
      {voicePrimary && props.micStream && (
        <VoiceButton
          micStream={props.micStream}
          autoStart={props.autoStart}
          sessionId={props.sessionId}
          disabled={props.disabled}
          onTranscript={handleTranscript}
          onNotice={props.onNotice}
        />
      )}

      {!pendingVoice && voicePrimary && (
        <p className="voice-fallback-label">
          {freeAnswer ? "不方便说话时，也可用下方文字输入回答" : "不方便说话时，也可点选下方选项"}
        </p>
      )}

      {specialOrOptions}

      {/* 自由回答题在纯手动模式下直接展开文字输入（无语音入口时这是唯一作答途径） */}
      {!pendingVoice && showVoiceTextFallback && (textOpen || (freeAnswer && !voiceActive)) && (
        <TextPanel
          disabled={props.disabled}
          onSubmit={(text) => {
            props.onSubmitText(text);
            setTextOpen(false);
          }}
        />
      )}

      {showVoiceTextFallback && (
        <div className="flex flex-wrap items-center justify-center gap-2.5 pt-0.5">
          {!voicePrimary && voiceActive && props.micStream && !pendingVoice && (
            <VoiceButton
              micStream={props.micStream}
              autoStart={props.autoStart}
              sessionId={props.sessionId}
              disabled={props.disabled}
              onTranscript={handleTranscript}
              onNotice={props.onNotice}
            />
          )}
          <button
            type="button"
            onClick={() => setTextOpen((open) => !open)}
            disabled={props.disabled}
            className="ui-button ui-button-secondary min-h-[48px] px-4 text-base"
            // 纯手动模式的自由回答题文字面板恒展开，切换按钮无意义
            style={freeAnswer && !voiceActive ? { display: "none" } : undefined}
          >
            <Keyboard size={20} strokeWidth={1.8} aria-hidden="true" />
            <span>文字输入</span>
          </button>
          {voiceActive && (
            <label className="ui-choice min-h-[48px] rounded-[14px] px-3.5 text-sm sm:text-base">
              <input
                type="checkbox"
                checked={directVoice}
                onChange={(event) => setDirectVoice(event.target.checked)}
                className="h-4 w-4"
              />
              说完直接提交
            </label>
          )}
        </div>
      )}
    </div>
  );
}

function AcknowledgementPanel({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="patient-panel space-y-4 p-6 text-center">
      <p className="text-lg leading-7 text-[var(--ink-muted)]">
        完成刚才的操作后，点击下面按钮继续；是否完成正确由医护确认。
      </p>
      <button
        type="button"
        disabled={disabled}
        onClick={onSubmit}
        className="ui-button ui-button-primary ui-button-lg"
      >
        <Check size={22} strokeWidth={2} aria-hidden="true" />
        <span>我已完成，请继续</span>
      </button>
    </div>
  );
}

/** 大按钮快捷作答：按钮展示 displayLabel（剥除评分/备注，2026-09-04 修改意见 1），
 *  提交仍用完整 label（同分选项靠 label 区分，服务端按 label 精确匹配）；语音为主时 compact 略收高度 */
function OptionButtons({
  prompt,
  disabled,
  onSelect,
  compact = false,
}: {
  prompt: PatientPromptDto;
  disabled: boolean;
  onSelect: (label: string) => void;
  /** 语音主视觉模式下作兜底，按钮略矮、字号略收 */
  compact?: boolean;
}) {
  const twoColumns = prompt.options.length > 2;
  return (
    // care-option-grid：各选项等高、奇数个时末项居中（样式见 assessment-design.css）
    <div
      className={["care-option-grid grid", twoColumns ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2"].join(" ")}
      data-compact={compact ? "" : undefined}
    >
      {prompt.options.map((option) => (
        <button
          key={option.label}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(option.label)}
          className={[
            "patient-choice patient-choice-single w-full justify-between text-left sm:justify-center sm:text-center",
            compact
              ? "min-h-[64px] px-4 py-3 text-[clamp(18px,1.8vw,24px)]"
              : "min-h-[80px]",
          ].join(" ")}
        >
          <span>{option.displayLabel}</span>
          <ArrowRight size={compact ? 22 : 26} strokeWidth={1.7} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

/** M9.6 数字输入：大号数字步进 + 滑条（适老化） */
function NumberInputPanel({
  prompt,
  disabled,
  onSelect,
}: {
  prompt: PatientPromptDto;
  disabled: boolean;
  onSelect: (score: number) => void;
}) {
  const min = prompt.numberMin ?? 0;
  const max = prompt.numberMax ?? 10;
  const [value, setValue] = useState(min);
  return (
    <div className="patient-panel space-y-5 p-6 text-center">
      <p className="text-lg font-semibold text-[var(--ink-muted)]">请选择一个数字（{min}～{max}）</p>
      <p className="text-6xl font-black tabular-nums text-[var(--brand-strong)]">{value}</p>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(Number(e.target.value))}
        className="mx-auto block w-full max-w-md accent-[var(--brand)]"
        aria-label={`选择 ${min} 到 ${max} 的数字`}
      />
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          disabled={disabled || value <= min}
          className="ui-button ui-button-secondary ui-button-lg"
          onClick={() => setValue((v) => Math.max(min, v - 1))}
        >
          −1
        </button>
        <button
          type="button"
          disabled={disabled || value >= max}
          className="ui-button ui-button-secondary ui-button-lg"
          onClick={() => setValue((v) => Math.min(max, v + 1))}
        >
          +1
        </button>
        <button
          type="button"
          disabled={disabled}
          className="ui-button ui-button-primary ui-button-lg"
          onClick={() => onSelect(value)}
        >
          <Check size={22} strokeWidth={2} aria-hidden="true" />
          <span>确认 {value} 分</span>
        </button>
      </div>
    </div>
  );
}

/** M9.6 多选大按钮 */
function MultiChoicePanel({
  prompt,
  disabled,
  onSubmit,
}: {
  prompt: PatientPromptDto;
  disabled: boolean;
  onSubmit: (labels: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (label: string) => {
    setSelected((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );
  };
  return (
    <div className="space-y-4">
      <p className="text-center text-base font-semibold text-[var(--ink-muted)]">可多选，选完后点确认</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {prompt.options.map((option) => {
          const on = selected.includes(option.label);
          return (
            <button
              key={option.label}
              type="button"
              disabled={disabled}
              onClick={() => toggle(option.label)}
              className={[
                "patient-choice min-h-[72px] w-full text-left",
                on ? "ring-2 ring-[var(--brand)] bg-[var(--surface-blue)]" : "",
              ].join(" ")}
              aria-pressed={on}
            >
              <span className="mr-2 inline-block w-6 text-center font-black text-[var(--brand)]">
                {on ? "✓" : "○"}
              </span>
              {/* 展示剥除评分/备注（2026-09-04 修改意见 1）；选中与提交仍用完整 label */}
              <span>{option.displayLabel}</span>
            </button>
          );
        })}
      </div>
      <div className="flex justify-center">
        <button
          type="button"
          disabled={disabled || selected.length === 0}
          className="ui-button ui-button-primary ui-button-lg"
          onClick={() => onSubmit(selected)}
        >
          <Check size={22} strokeWidth={2} aria-hidden="true" />
          <span>确认所选（{selected.length}）</span>
        </button>
      </div>
    </div>
  );
}

/** M9.6 图片选择（Bristol 等）：上方参照图 + 下方大按钮（按 label 提交） */
function ImageChoicePanel({
  prompt,
  disabled,
  onSelect,
}: {
  prompt: PatientPromptDto;
  disabled: boolean;
  onSelect: (label: string) => void;
}) {
  return (
    <div className="space-y-4">
      {prompt.imageSrc && (
        <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={prompt.imageSrc}
            alt="大便分型参照图"
            className="mx-auto max-h-[280px] w-auto object-contain"
          />
          <p className="mt-2 text-center text-sm text-[var(--ink-faint)]">请对照上图选择最像的一型</p>
        </div>
      )}
      <OptionButtons prompt={prompt} disabled={disabled} onSelect={onSelect} />
    </div>
  );
}

/** 未配置提示的画图题兜底文案（正常情况下画图题都在 cognitive-flow.PATIENT_DRAWING_TASKS 配了提示） */
const DEFAULT_DRAWING_HINT = "请在白板上按题目要求作画，画完后点「画好了」";

/** 画板内部分辨率：展示边长最大 640px（assessment-design.css），内部取 720 让放大后的笔迹不发虚 */
const DRAWING_CANVAS_SIZE = 720;
/** 交给视觉模型的图片边长：与改版前画板一致（480），模型输入尺寸和 data URL 体积都不变 */
const DRAWING_EXPORT_SIZE = 480;
const PEN_COLOR = "#1e3a5f";
/** 720 画布上 4.5px，缩到 480 导出后约 3px，与改版前笔迹粗细一致，视觉模型此前的测试结论仍适用 */
const PEN_WIDTH = 4.5;
/** 橡皮直径按屏幕像素定，与 CSS 里 28px 的圆形光标等大，按下时再换算到画布坐标——所见即所擦 */
const ERASER_SCREEN_DIAMETER = 28;
/** 空白判定阈值：任一像素红色通道低于此值即算有笔迹（橡皮擦过的边缘会留下接近白色的抗锯齿像素） */
const INK_CHANNEL_THRESHOLD = 235;

type DrawingTool = "pen" | "eraser";

interface CanvasPoint {
  x: number;
  y: number;
}

/** 锁定时拍下的画作：dataUrl 是缩到 480 的 PNG；blank 用于提示患者交的是空白画板 */
interface LockedDrawing {
  dataUrl: string;
  blank: boolean;
}

/** 画板铺白底：导出的 PNG 没有透明像素，视觉模型看到的是白纸蓝黑线 */
function fillCanvasWhite(canvas: HTMLCanvasElement | null): void {
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/** 画板上是否一笔都没留下（画了又全部擦掉也算空白） */
function isCanvasBlank(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx) return true;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < data.length; index += 4) {
    if (data[index] < INK_CHANNEL_THRESHOLD) return false;
  }
  return true;
}

/** 交给视觉模型的快照：缩到 480×480 的 PNG；离屏画布拿不到 2D 上下文时退回原尺寸（720 线稿 PNG 仍远低于体积上限） */
function exportDrawingSnapshot(canvas: HTMLCanvasElement): string {
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = DRAWING_EXPORT_SIZE;
  exportCanvas.height = DRAWING_EXPORT_SIZE;
  const ctx = exportCanvas.getContext("2d");
  if (!ctx) return canvas.toDataURL("image/png");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, DRAWING_EXPORT_SIZE, DRAWING_EXPORT_SIZE);
  return exportCanvas.toDataURL("image/png");
}

/** 屏幕坐标换算到画布内部坐标（画布展示尺寸随视口变，内部固定 720） */
function toCanvasPoint(event: ReactPointerEvent<HTMLCanvasElement>): CanvasPoint {
  const canvas = event.currentTarget;
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

/** 按当前工具设置笔触：画笔是固定粗细的深蓝线；橡皮是白色粗线（画板本就是白底，导出无需处理透明） */
function applyBrush(ctx: CanvasRenderingContext2D, tool: DrawingTool, canvas: HTMLCanvasElement): void {
  const screenToCanvas = canvas.width / canvas.getBoundingClientRect().width;
  ctx.strokeStyle = tool === "pen" ? PEN_COLOR : "#ffffff";
  ctx.lineWidth = tool === "pen" ? PEN_WIDTH : ERASER_SCREEN_DIAMETER * screenToCanvas;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

function strokeSegment(ctx: CanvasRenderingContext2D, from: CanvasPoint, to: CanvasPoint): void {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

/**
 * 画板笔触：画笔/橡皮两种工具。interactive=false（已锁定或交卷中）时不响应任何指针输入。
 * 每次移动只描「上一点→当前点」一小段（圆头圆角拼接无缝），不反复重描整条路径，长笔画也不卡。
 */
function useDrawingStrokes(interactive: boolean) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastPointRef = useRef<CanvasPoint | null>(null);
  const [tool, setTool] = useState<DrawingTool>("pen");

  useEffect(() => fillCanvasWhite(canvasRef.current), []);

  const endStroke = () => {
    lastPointRef.current = null;
  };

  const strokeHandlers = {
    onPointerDown: (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = event.currentTarget;
      const ctx = canvas.getContext("2d");
      if (!interactive || !ctx) return;
      applyBrush(ctx, tool, canvas);
      const point = toCanvasPoint(event);
      // 原地描一段零长度线：点一下也留下圆点（画钟的圆心）或擦掉一小块
      strokeSegment(ctx, point, point);
      lastPointRef.current = point;
      canvas.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const from = lastPointRef.current;
      const ctx = event.currentTarget.getContext("2d");
      if (!interactive || !from || !ctx) return;
      const point = toCanvasPoint(event);
      strokeSegment(ctx, from, point);
      lastPointRef.current = point;
    },
    onPointerUp: endStroke,
    onPointerCancel: endStroke,
  };

  const clearCanvas = () => {
    fillCanvasWhite(canvasRef.current);
    setTool("pen");
  };

  return { canvasRef, tool, setTool, strokeHandlers, clearCanvas };
}

/** 画板上方的提示：作画时是题目提示；锁定后告诉患者下一步点哪个按钮 */
function drawingStatusHint(hint: string, locked: LockedDrawing | null, submitting: boolean): string {
  if (!locked) return hint;
  if (submitting) return "正在识别画作，请稍候…";
  if (locked.blank) return "画板上还没有画任何内容。确定这样提交请点「确认提交」，要画请点「返回修改」";
  return "画作已锁定。确认无误请点「确认提交」，还要修改请点「返回修改」";
}

/**
 * M9.6 画图画板（画钟、五边形临摹）：画笔/橡皮作画 →「画好了」锁定画作 →「确认提交」交给视觉模型看图判定
 * （临界的由模型复核定分，视觉通道不可用才交医生）。锁定只拦截输入、不卸载 <canvas>：globals.css 的画板 flex 收缩链靠
 * :has(.drawing-canvas) 生效，卸掉画布整页布局会塌。空白画板也允许提交（不会画的患者不能卡死在这一题），
 * 锁定时会明确提示「还没有画任何内容」，两步确认足以防误触。
 */
function DrawingPanel({
  disabled,
  onSubmit,
  hint,
  referenceSrc,
}: {
  disabled: boolean;
  onSubmit: (dataUrl: string) => void;
  hint?: string;
  /** 临摹参照图：有则以画板 2/3 的边长排在画板左边 */
  referenceSrc?: string;
}) {
  const [locked, setLocked] = useState<LockedDrawing | null>(null);
  const { canvasRef, tool, setTool, strokeHandlers, clearCanvas } = useDrawingStrokes(!disabled && !locked);

  const lockDrawing = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setLocked({ dataUrl: exportDrawingSnapshot(canvas), blank: isCanvasBlank(canvas) });
  };

  return (
    <div className="drawing-panel space-y-3">
      <p aria-live="polite" className="text-center text-base font-semibold text-[var(--ink-muted)]">
        {drawingStatusHint(hint ?? DEFAULT_DRAWING_HINT, locked, disabled)}
      </p>
      {/* 舞台按剩余空间自适应（assessment-design.css .drawing-stage），参照图 + 画板 + 工具列一屏放得下、不出滚动条 */}
      <div className="drawing-stage">
        {referenceSrc && (
          <figure className="drawing-reference">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={referenceSrc} alt="临摹参照图" />
          </figure>
        )}
        <div className="drawing-board" data-locked={locked ? "true" : undefined}>
          <canvas
            ref={canvasRef}
            width={DRAWING_CANVAS_SIZE}
            height={DRAWING_CANVAS_SIZE}
            aria-label="画板"
            data-tool={tool}
            className="drawing-canvas touch-none rounded-2xl border-2 border-[var(--brand)] bg-white shadow-sm"
            {...strokeHandlers}
          />
        </div>
        <DrawingTools
          tool={tool}
          locked={locked !== null}
          disabled={disabled}
          onToolChange={setTool}
          onClear={clearCanvas}
          onLock={lockDrawing}
          onUnlock={() => setLocked(null)}
          onConfirm={() => locked && onSubmit(locked.dataUrl)}
        />
      </div>
    </div>
  );
}

/** 画板右侧工具列：作画时是 画笔/橡皮/清空重画 + 画好了；锁定后换成 锁定状态 + 返回修改/确认提交 */
function DrawingTools(props: {
  tool: DrawingTool;
  locked: boolean;
  disabled: boolean;
  onToolChange: (tool: DrawingTool) => void;
  onClear: () => void;
  onLock: () => void;
  onUnlock: () => void;
  onConfirm: () => void;
}) {
  if (props.locked) {
    return (
      <div className="drawing-tools">
        <p className="drawing-lock-status">
          <Lock size={19} strokeWidth={2} aria-hidden="true" />
          <span>画作已锁定</span>
        </p>
        <div className="drawing-tools-commit">
          <button type="button" disabled={props.disabled} className="ui-button ui-button-secondary ui-button-lg" onClick={props.onUnlock}>
            <Undo2 size={21} strokeWidth={1.9} aria-hidden="true" />
            <span>返回修改</span>
          </button>
          <button type="button" disabled={props.disabled} className="ui-button ui-button-primary ui-button-lg" onClick={props.onConfirm}>
            {props.disabled ? (
              <LoaderCircle size={21} strokeWidth={1.9} className="animate-spin" aria-hidden="true" />
            ) : (
              <Send size={21} strokeWidth={1.9} aria-hidden="true" />
            )}
            <span>{props.disabled ? "正在识别…" : "确认提交"}</span>
          </button>
        </div>
      </div>
    );
  }

  const toolButton = (value: DrawingTool, label: string, icon: ReactNode) => (
    <button
      type="button"
      aria-pressed={props.tool === value}
      disabled={props.disabled}
      className="drawing-tool ui-button ui-button-secondary ui-button-lg"
      onClick={() => props.onToolChange(value)}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <div className="drawing-tools">
      <div role="group" aria-label="画板工具" className="drawing-tools-group">
        {toolButton("pen", "画笔", <Pencil size={21} strokeWidth={1.9} aria-hidden="true" />)}
        {toolButton("eraser", "橡皮", <Eraser size={21} strokeWidth={1.9} aria-hidden="true" />)}
        <button type="button" disabled={props.disabled} className="ui-button ui-button-secondary ui-button-lg" onClick={props.onClear}>
          <RefreshCw size={21} strokeWidth={1.9} aria-hidden="true" />
          <span>清空重画</span>
        </button>
      </div>
      <div className="drawing-tools-commit">
        <button type="button" disabled={props.disabled} className="ui-button ui-button-primary ui-button-lg" onClick={props.onLock}>
          <Check size={21} strokeWidth={1.9} aria-hidden="true" />
          <span>画好了</span>
        </button>
      </div>
    </div>
  );
}

/** 语音转写确认面板（语音转文字确认模式） */
function TranscriptConfirm({
  transcript,
  disabled,
  onConfirm,
  onRetry,
}: {
  transcript: string;
  disabled: boolean;
  onConfirm: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="patient-panel border-[var(--brand)] bg-[var(--surface-blue)] p-6 text-center">
      <div className="mb-3 flex items-center justify-center gap-2 text-lg font-semibold text-[var(--brand-strong)]">
        <Volume2 size={22} strokeWidth={1.8} aria-hidden="true" />
        <p>您说的是：</p>
      </div>
      <p className="text-2xl font-bold leading-relaxed text-[var(--ink)]">“{transcript}”</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={onConfirm}
          className="ui-button ui-button-primary ui-button-lg"
        >
          <Check size={22} strokeWidth={2} aria-hidden="true" />
          <span>对，就这么答</span>
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onRetry}
          className="ui-button ui-button-secondary ui-button-lg"
        >
          <RefreshCw size={21} strokeWidth={1.9} aria-hidden="true" />
          <span>重新说</span>
        </button>
      </div>
    </div>
  );
}

/** 文字输入面板 */
function TextPanel({ disabled, onSubmit }: { disabled: boolean; onSubmit: (text: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        if (trimmed) {
          onSubmit(trimmed);
          setValue("");
        }
      }}
    >
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="请输入您的回答…"
        maxLength={200}
        className="patient-input flex-1"
      />
      <button
        type="submit"
        disabled={disabled || value.trim().length === 0}
        className="ui-button ui-button-primary ui-button-lg shrink-0"
      >
        <Send size={21} strokeWidth={1.9} aria-hidden="true" />
        <span>提交</span>
      </button>
    </form>
  );
}

/** 声波可视化已随 2026-08-13 语音按钮恒定尺寸重构移除（三态只换图标颜色与文字） */
/**
 * 录音按钮：语音模式下播报一结束就自动开始（autoStart 由父组件在 TTS 播完后置 true），
 * 声音活动检测（VAD）判断患者说完了自动上传 /api/asr 转写，全程不用患者动手。
 * VAD 是能量阈值近似方案，老年患者停顿可能导致误判，因此录音中始终保留弱化样式的
 * 手动兜底按钮（见 wav-recorder.ts 头注释）。麦克风流由父组件持有传入，本组件只在
 * 这条已授权的流上开关录音，不重新申请权限（不会再弹授权弹窗）。
 *
 * 2026-08-13 用户要求：播报结束后按钮不再整体替换成大号监听面板（界面跳动），
 * 三态共用同一按钮外壳（尺寸恒定），只切换麦克风图标颜色与文字；
 * 兜底"我说完了"按钮放固定高度槽位，仅录音时可见（visibility 切换，不占位变化）。
 */
function VoiceButton({
  micStream,
  autoStart,
  sessionId,
  disabled,
  onTranscript,
  onNotice,
}: {
  micStream: MediaStream;
  autoStart: boolean;
  sessionId: string;
  disabled: boolean;
  onTranscript: (answer: VoiceAnswer) => void;
  onNotice: (message: string) => void;
}) {
  const recorderRef = useRef<WavRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  /** autoStart 每次挂载只应触发一次自动开始，防止后续重渲染重复触发 */
  const autoStartedRef = useRef(false);

  // 组件卸载时释放本次录音的音频节点（不动 micStream，那是父组件的资源）
  useEffect(() => () => recorderRef.current?.teardown(), []);

  const stopRecording = useCallback(
    async (reason: "manual" | VadStopReason = "manual") => {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      setRecording(false);
      setSpeaking(false);
      if (!recorder) return;
      const blob = await recorder.stop();
      // 链路埋点（V2.0 §2.1）：录音结束（VAD 判定说完 / 手动提交 / 超时）
      logTiming("recording_end", { reason });
      if (!blob) {
        onNotice(reason === "timeout" ? "没有听到您说话，请再试一次" : "没有录到声音，请再试一次");
        return;
      }
      setTranscribing(true);
      try {
        const form = new FormData();
        form.append("sessionId", sessionId);
        form.append("audio", blob, "answer.wav");
        logTiming("asr_request");
        const response = await fetch("/api/asr", { method: "POST", body: form });
        const body = (await response.json()) as {
          text?: string;
          audioPath?: string;
          raw?: unknown;
          error?: string;
        };
        logTiming("asr_response", { status: response.status });
        if (!response.ok || !body.text) {
          // 服务端报错原文直接提示（2026-09-14 用户拍板：ASR 未开通等技术提示保留给患者端可见）
          onNotice(body.error ?? "没听清，请再说一次，或改用按钮作答");
          return;
        }
        onTranscript({ text: body.text, audioPath: body.audioPath, asrRaw: body.raw });
      } catch {
        onNotice("网络异常，转写失败，请改用按钮或文字作答");
      } finally {
        setTranscribing(false);
      }
    },
    [sessionId, onTranscript, onNotice]
  );

  const startRecording = useCallback(async () => {
    try {
      const recorder = new WavRecorder();
      await recorder.start(micStream, {
        onSpeechStart: () => setSpeaking(true),
        onAutoStop: (reason) => {
          void stopRecording(reason);
        },
      });
      recorderRef.current = recorder;
      setRecording(true);
      setSpeaking(false);
    } catch (error) {
      onNotice(error instanceof RecorderError ? error.message : "无法打开麦克风");
    }
  }, [micStream, stopRecording, onNotice]);

  // 播报刚结束（autoStart 由 false 变 true）就自动开始听，不需要患者点按钮
  useEffect(() => {
    if (autoStart && !autoStartedRef.current && !recording && !transcribing) {
      autoStartedRef.current = true;
      void startRecording();
    }
  }, [autoStart, recording, transcribing, startRecording]);

  // 录音/识别中不用 disabled（:disabled 会压暗到 0.5 看不清图标变色），改为点击守卫 + aria-disabled
  const busy = recording || transcribing;
  return (
    <div className="flex w-full flex-col items-center">
      <button
        type="button"
        disabled={!busy && disabled}
        aria-disabled={busy || disabled}
        onClick={() => {
          if (!busy) void startRecording();
        }}
        className="patient-primary-action w-full max-w-xl justify-center self-center text-xl"
        data-voice-state={transcribing ? "transcribing" : recording ? (speaking ? "speaking" : "listening") : "idle"}
      >
        {transcribing ? (
          <>
            <LoaderCircle className="animate-spin" size={26} strokeWidth={1.8} aria-hidden="true" />
            <span>正在识别您的回答…</span>
          </>
        ) : recording ? (
          <>
            <Mic
              size={26}
              strokeWidth={1.8}
              aria-hidden="true"
              className={speaking ? "voice-mic-speaking" : "voice-mic-listening"}
            />
            <span>{speaking ? "正在听您说话…" : "请开始说话…"}</span>
          </>
        ) : (
          <>
            <Mic size={26} strokeWidth={1.8} aria-hidden="true" />
            <span>开始语音回答</span>
          </>
        )}
      </button>
      {/* 固定高度槽位：录音时才显示手动提交兜底，visibility 切换不引起布局跳动 */}
      <div className="voice-submit-slot">
        <button
          type="button"
          disabled={disabled}
          onClick={() => void stopRecording("manual")}
          className="ui-button ui-button-quiet min-h-0 px-3 py-1 text-sm underline decoration-dotted underline-offset-4"
          style={{ visibility: recording ? "visible" : "hidden" }}
          tabIndex={recording ? 0 : -1}
        >
          我说完了，直接提交
        </button>
      </div>
    </div>
  );
}
