import { RotateCcw, Square, X } from "lucide-react";
import { renderMarkdown } from "../lib/markdown.js";
import { statusLabel } from "../lib/view-models.js";

export function ActionModal({ modal, onClose, onSave, onRetry, onCancel }) {
  const result = modal.result;
  const events = result?.events || modal.steps || [];

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
          <div className="run-steps">
            {events.map((event, index) => (
              <details key={`${event.phase}-${index}`} className="run-step" open={event.phase !== "Output" || modal.kind !== "running"}>
                <summary>
                  <span>{formatEventPhase(event.phase)}</span>
                  <em>{event.message}</em>
                </summary>
                {renderEventDetails(event)}
                {event.phase === "Output" ? (
                  <div className="markdown-body compact" dangerouslySetInnerHTML={{ __html: renderMarkdown(event.message) }} />
                ) : (
                  <p>{event.message}</p>
                )}
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
              <button onClick={onCancel}>
                <Square size={15} />
                取消
              </button>
            )}
            {(modal.kind === "error" || modal.kind === "cancelled") && (
              <button onClick={onRetry}>
                <RotateCcw size={15} />
                重试
              </button>
            )}
            {modal.kind === "result" && result && (
              <button className="primary" onClick={() => onSave(result)}>
                {result.saveLabel || "确认写入目标文件"}
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
    Workflow: "执行流程",
    "Write Plan": "写入计划",
    Reflection: "执行摘要",
    Output: "生成结果"
  }[phase] || phase;
}

function renderEventDetails(event) {
  const details = event.details;
  if (!details) return null;

  return (
    <div className="event-details">
      {details.files && (
        <div className="context-files">
          {details.files.map((file) => (
            <details key={file.path} className="context-file">
              <summary>
                <strong>{file.path}</strong>
                <span>{file.available ? statusLabel(file.status) : "缺失"}</span>
              </summary>
              {file.available ? <pre>{file.excerpt || "文件为空"}</pre> : <p>本次固定资料路径不存在，模型会按缺资料处理。</p>}
            </details>
          ))}
        </div>
      )}
      {details.plan && (
        <ul className="detail-list">
          {details.plan.map((item) => <li key={item}>{item}</li>)}
        </ul>
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
