import { useMemo, useState } from "react";
import { History, RotateCcw, Square, X } from "lucide-react";
import { renderMarkdown } from "../lib/markdown.js";
import { statusLabel } from "../lib/view-models.js";

export function ActionModal({ modal, onClose, onSave, onRetry, onResume, onCancel }) {
  const result = modal.result;
  const events = result?.events || modal.steps || [];
  const [viewMode, setViewMode] = useState("key");
  const visibleEvents = useMemo(() => viewMode === "all" ? events : pickKeyEvents(events), [events, viewMode]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-head">
          <div>
            <p className="eyebrow">{formatModalKind(modal.kind)}</p>
            <h2>{modal.title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </div>
        {modal.error && <div className="error-box">{modal.error}</div>}
        {modal.path && <div className="success-box">已写入：{modal.path}</div>}
        {events.length > 0 && (
          <div className="run-toolbar">
            <div className="segmented-control" aria-label="执行视图">
              <button className={viewMode === "key" ? "ui-button secondary active" : "ui-button secondary"} onClick={() => setViewMode("key")}>
                关键事件
              </button>
              <button className={viewMode === "all" ? "ui-button secondary active" : "ui-button secondary"} onClick={() => setViewMode("all")}>
                完整过程
              </button>
            </div>
            <span className="run-toolbar-note">
              {viewMode === "key" ? `当前展示 ${visibleEvents.length}/${events.length} 个关键节点` : `当前展示全部 ${events.length} 个节点`}
            </span>
          </div>
        )}
        {events.length > 0 && (
          <div className="run-steps">
            {visibleEvents.map((event, index) => (
              <details
                key={`${event.phase}-${event.at || index}-${index}`}
                className={`run-step ${event.phase === "Output" ? "output-step" : ""}`}
                open={defaultOpen(event.phase, modal.kind)}
              >
                <summary className="run-step-summary">
                  <span className="run-step-phase">{formatEventPhase(event.phase)}</span>
                  <strong>{event.phase === "Draft" && event.details?.generatedText ? "正文正在流式生成中。" : event.message}</strong>
                  <em>{formatEventTime(event.at)}</em>
                </summary>
                <div className="run-step-body">
                  {renderEventDetails(event)}
                  {event.phase === "Output" || event.phase === "Draft" ? (
                    <div className="markdown-body compact result-output" dangerouslySetInnerHTML={{ __html: renderMarkdown(event.phase === "Draft" ? detailsForDraft(event) : event.message) }} />
                  ) : (
                    <p className="run-step-copy">{event.message}</p>
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <span>
            {result?.targets?.length
              ? `目标文件：${result.targets.map((item) => item.path).join("、")}`
              : "当前任务未生成可保存结果。"}
          </span>
          <div className="button-row">
            {modal.kind === "running" && (
              <button className="ui-button danger" onClick={onCancel}>
                <Square size={15} />
                取消
              </button>
            )}
            {(modal.kind === "error" || modal.kind === "cancelled") && (
              <button className="ui-button secondary" onClick={onRetry}>
                <RotateCcw size={15} />
                重试
              </button>
            )}
            {modal.kind !== "running" && result?.resumeAvailable && (
              <button className="ui-button secondary" onClick={onResume}>
                <History size={15} />
                从恢复点继续
              </button>
            )}
            {modal.kind === "result" && result && (
              <button className="ui-button primary" onClick={() => onSave(result)}>
                {result.saveLabel || "确认写入目标文件"}
              </button>
            )}
            {modal.kind !== "running" && (
              <button className="ui-button secondary" onClick={onClose}>
                关闭
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatModalKind(kind) {
  return {
    running: "执行中",
    result: "待确认",
    saved: "已写入",
    error: "执行失败",
    cancelled: "已取消"
  }[kind] || kind;
}

function formatEventPhase(phase) {
  return {
    Scope: "执行范围",
    Context: "读取资料",
    Budget: "Token 预算",
    Workflow: "执行流程",
    Prompt: "执行框架",
    Observe: "观察",
    Plan: "计划",
    Draft: "生成",
    "Write Plan": "写入计划",
    Reflection: "执行摘要",
    Review: "自检",
    Output: "生成结果"
  }[phase] || phase;
}

function defaultOpen(phase, modalKind) {
  if (phase === "Output") return modalKind === "result";
  if (phase === "Draft" && modalKind === "running") return true;
  return true;
}

function formatEventTime(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

function renderEventDetails(event) {
  const details = event.details;
  if (!details) return null;

  return (
    <div className="event-details">
      {details.metrics && (
        <div className="detail-metrics">
          {details.metrics.map((item) => (
            <div key={item.label} className="detail-metric">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      )}
      {details.files && (
        <div className="context-files">
          {details.files.map((file) => (
            <details key={file.path} className="context-file">
              <summary>
                <strong>{file.path}</strong>
                <span>{file.available ? `${statusLabel(file.status)} · ${file.selectedTokens || file.fullTokens || 0} tok` : "缺失"}</span>
              </summary>
              {file.available ? (
                <>
                  <p className="detail-line">{renderCompressionLine(file)}</p>
                  <pre>{file.excerpt || "文件为空"}</pre>
                </>
              ) : <p>本次固定资料路径不存在，模型会按缺资料处理。</p>}
            </details>
          ))}
        </div>
      )}
      {details.plan && (
        <ul className="detail-list">
          {details.plan.map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
      {details.items && (
        <ul className="detail-list">
          {details.items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
      {details.preview && (
        <div className="detail-block">
          <strong>Prompt 预览</strong>
          <pre>{details.preview}</pre>
        </div>
      )}
      {details.generatedText && event.phase === "Draft" && (
        <div className="detail-block">
          <strong>当前已生成内容</strong>
        </div>
      )}
      {details.sections?.length > 0 && (
        <div className="detail-block">
          <strong>当前结构片段</strong>
          <div className="detail-cards">
            {details.sections.map((section) => (
              <div key={section.id || section.title} className="detail-card">
                <div className="detail-card-head">
                  <strong>{section.title}</strong>
                  <span>{section.tokens || 0} tok</span>
                </div>
                <p>{section.excerpt}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {details.checkpoints?.length > 0 && (
        <div className="detail-block">
          <strong>恢复点</strong>
          <div className="checkpoint-list">
            {details.checkpoints.map((checkpoint) => (
              <details key={checkpoint.id} className="checkpoint-item">
                <summary>
                  <strong>{checkpoint.label}</strong>
                  <span>{checkpoint.generatedTokens || 0} tok · {checkpoint.needsContinuation ? "待续写" : "已完整"}</span>
                </summary>
                <div className="checkpoint-body">
                  <p className="detail-line">
                    停止原因：{checkpoint.stopReason || "正常结束"} · 结束标记：{checkpoint.marker || "无"} · 结构片段：{checkpoint.sectionCount || 0}
                  </p>
                  {checkpoint.reviewSummary && <p>{checkpoint.reviewSummary}</p>}
                  {checkpoint.excerpt && <pre>{checkpoint.excerpt}</pre>}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
      {details.targets && (
        <div className="detail-block">
          <strong>目标文件</strong>
          <ul className="detail-list">
            {details.targets.map((target) => (
              <li key={target.path}>
                <code>{target.path}</code>
                {target.exists ? "（将修改现有文件）" : "（将创建新文件）"}
              </li>
            ))}
          </ul>
        </div>
      )}
      {details.input && (
        <div className="detail-block">
          <strong>输入</strong>
          <pre>{JSON.stringify(details.input, null, 2)}</pre>
        </div>
      )}
      {details.missingContext?.length > 0 && (
        <div className="detail-block">
          <strong>缺失资料</strong>
          <ul className="detail-list">{details.missingContext.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      )}
      {details.note && <p className="detail-line">{details.note}</p>}
      {details.error && <p className="detail-line error-text">{details.error}</p>}
    </div>
  );
}

function renderCompressionLine(file) {
  const levelMap = {
    full: "保留全文",
    compressed: "已压缩",
    missing: "缺失",
    empty: "空文件"
  };
  return `${levelMap[file.compressionLevel] || file.compressionLevel || "已处理"} · 预算 ${file.allocatedBudget || 0} tok · 原始 ${file.fullTokens || 0} tok · 当前 ${file.selectedTokens || 0} tok${file.compressionNote ? ` · ${file.compressionNote}` : ""}`;
}

function pickKeyEvents(events) {
  if (!Array.isArray(events) || !events.length) return [];
  const preferredOrder = ["Scope", "Budget", "Workflow", "Observe", "Plan", "Draft", "Review", "Write Plan", "Output"];
  const lastByPhase = new Map();
  events.forEach((event) => {
    if (preferredOrder.includes(event.phase)) {
      if (event.phase === "Draft") {
        const current = lastByPhase.get(event.phase);
        const isStreamingEvent = Boolean(event.details?.generatedText);
        const currentIsStreaming = Boolean(current?.details?.generatedText);
        if (!current || isStreamingEvent || !currentIsStreaming) {
          lastByPhase.set(event.phase, event);
        }
        return;
      }
      lastByPhase.set(event.phase, event);
    }
  });
  return preferredOrder.map((phase) => lastByPhase.get(phase)).filter(Boolean);
}

function detailsForDraft(event) {
  return event.details?.generatedText || "";
}
