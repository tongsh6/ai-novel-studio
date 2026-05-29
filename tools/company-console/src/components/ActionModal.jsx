import { useEffect, useMemo, useRef, useState } from "react";
import { History, LoaderCircle, RotateCcw, Square, X } from "lucide-react";
import { renderMarkdown } from "../lib/markdown.js";
import { statusLabel } from "../lib/view-models.js";

export function ActionModal({ modal, onClose, onSave, onRetry, onResume, onCancel }) {
  const result = modal.result;
  const events = result?.events || modal.steps || [];
  const [viewMode, setViewMode] = useState(modal.kind === "running" ? "all" : "key");
  const processRef = useRef(null);
  const visibleEvents = useMemo(
    () => (viewMode === "all" ? events : pickKeyEvents(events)).filter((event) => event.phase !== "Output"),
    [events, viewMode]
  );
  const targetList = useMemo(() => collectTargetStatuses(modal, events), [modal, events]);
  const targetSummary = useMemo(() => summarizeTargets(targetList), [targetList]);
  const livePhase = events.length ? formatEventPhase(events.at(-1)?.phase) : "";
  const fileCards = useMemo(() => buildFileCards(modal, targetList, events), [modal, targetList, events]);
  const writtenPaths = useMemo(() => new Set(result?.writtenPaths || modal.writeResult?.written || []), [result?.writtenPaths, modal.writeResult?.written]);
  const writingPaths = useMemo(() => new Set(result?.writingPaths || []), [result?.writingPaths]);
  const pendingWrites = useMemo(
    () => fileCards.filter((card) => card.canWrite && !writtenPaths.has(card.path)).length,
    [fileCards, writtenPaths]
  );

  useEffect(() => {
    setViewMode(modal.kind === "running" ? "all" : "key");
  }, [modal.kind, modal.runId, result?.runId]);

  useEffect(() => {
    if (modal.kind === "running" && viewMode === "all" && processRef.current) {
      processRef.current.scrollTop = processRef.current.scrollHeight;
    }
  }, [events, modal.kind, viewMode]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal execution-modal">
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
        {modal.writeResult && <WriteResultPanel writeResult={modal.writeResult} />}

        <div className="execution-layout">
          <section className="execution-process-panel">
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
                  {modal.kind === "running" && viewMode === "all"
                    ? `正在实时展示全部 ${events.length} 个节点`
                    : viewMode === "key"
                      ? `当前展示 ${visibleEvents.length}/${events.length} 个关键节点`
                      : `当前展示全部 ${events.length} 个节点`}
                </span>
              </div>
            )}
            <div className="process-panel-head">
              <div>
                <p className="eyebrow">主过程</p>
                <strong>Observe / Plan / Draft / Review 实时轨迹</strong>
              </div>
              {modal.kind === "running" && livePhase && <span className="live-phase-badge">实时阶段：{livePhase}</span>}
            </div>
            {visibleEvents.length > 0 ? (
              <div ref={processRef} className={`run-steps process-stream ${modal.kind === "running" && viewMode === "all" ? "live" : ""}`}>
                {visibleEvents.map((event, index) => (
                  <details
                    key={`${event.id || event.phase}-${event.at || index}-${index}`}
                    className={`run-step ${modal.kind === "running" && index === visibleEvents.length - 1 ? "is-live" : ""}`}
                    open={defaultOpen(event.phase, modal.kind)}
                  >
                    <summary className="run-step-summary">
                      <span className="run-step-phase">{formatEventPhase(event.phase)}</span>
                      <strong>{event.message}</strong>
                      <em>{formatEventTime(event.at)}</em>
                    </summary>
                    <div className="run-step-body">
                      {renderEventDetails(event)}
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <div className="empty-file-card">
                <strong>当前还没有可展示的执行过程。</strong>
                <p>开始执行后，公开过程会逐步回传到这里。</p>
              </div>
            )}
          </section>

          <section className="execution-files-panel">
            <div className="process-panel-head">
              <div>
                <p className="eyebrow">文件窗口</p>
                <strong>每个目标文件单独预览并单独确认写入</strong>
              </div>
              <span className="run-toolbar-note">
                {targetSummary.total
                  ? `共 ${targetSummary.total} 个目标文件，待写入 ${pendingWrites} 个`
                  : "当前任务未生成目标文件"}
              </span>
            </div>
            <div className="file-window-grid">
              {fileCards.map((card) => (
                <FileWindow
                  key={card.path}
                  card={card}
                  modalKind={modal.kind}
                  isWritten={writtenPaths.has(card.path)}
                  isWriting={writingPaths.has(card.path)}
                  onWrite={() => onSave(result, [card.path])}
                />
              ))}
              {!fileCards.length && (
                <div className="empty-file-card">
                  <strong>还没有文件结果。</strong>
                  <p>规划完成后，这里会按目标文件拆出独立窗口。</p>
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="modal-actions">
          <span>
            {targetSummary.total
              ? `目标文件 ${targetSummary.total} 个：新增 ${targetSummary.create}，覆盖 ${targetSummary.overwrite}${targetSummary.unchanged ? `，未变化 ${targetSummary.unchanged}` : ""}。`
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

function FileWindow({ card, modalKind, isWritten, isWriting, onWrite }) {
  const meta = targetStatus(card);
  const writeDisabled = !card.canWrite || isWriting || isWritten || modalKind !== "result";

  return (
    <article className="file-window-card">
      <div className="file-window-head">
        <div className="file-window-copy">
          <p className="eyebrow">{card.label || "目标文件"}</p>
          <strong>{card.path}</strong>
        </div>
        <div className="file-window-badges">
          <span className={`target-chip-badge ${meta.className}`}>{meta.label}</span>
          {isWritten && <span className="target-chip-badge create">已写入</span>}
          {modalKind === "running" && !isWritten && <span className="target-chip-badge unchanged">生成中</span>}
        </div>
      </div>
      <div className="file-window-body">
        {card.content ? (
          <div className="markdown-body compact compact-file-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(card.content) }} />
        ) : (
          <div className="empty-file-card inline">
            <strong>{card.placeholderTitle}</strong>
            <p>{card.placeholderCopy}</p>
          </div>
        )}
      </div>
      <div className="file-window-actions">
        <span className="run-toolbar-note">{card.footerNote}</span>
        {modalKind === "result" && (
          <button className="ui-button primary" disabled={writeDisabled} onClick={onWrite}>
            {isWriting
              ? (
                <>
                  <LoaderCircle size={15} className="spin" />
                  写入中
                </>
              ) : isWritten
                ? "已写入"
                : "写入这个文件"}
          </button>
        )}
      </div>
    </article>
  );
}

function WriteResultPanel({ writeResult }) {
  const summary = summarizeTargets([
    ...(writeResult.created || []).map((path) => ({ path, changeType: "create" })),
    ...(writeResult.overwritten || []).map((path) => ({ path, changeType: "overwrite" })),
    ...(writeResult.unchanged || []).map((path) => ({ path, changeType: "unchanged" }))
  ]);

  return (
    <div className="target-overview">
      <div className="target-overview-head">
        <div>
          <p className="eyebrow">写入结果</p>
          <strong>已完成部分或全部文件落盘</strong>
        </div>
      </div>
      <div className="detail-metrics">
        <div className="detail-metric">
          <span>新建</span>
          <strong>{summary.create}</strong>
        </div>
        <div className="detail-metric">
          <span>覆盖</span>
          <strong>{summary.overwrite}</strong>
        </div>
        <div className="detail-metric">
          <span>未变化</span>
          <strong>{summary.unchanged}</strong>
        </div>
      </div>
      <div className="target-chip-list">
        {(writeResult.created || []).map((path) => <TargetChip key={`created-${path}`} target={{ path, changeType: "create" }} />)}
        {(writeResult.overwritten || []).map((path) => <TargetChip key={`overwritten-${path}`} target={{ path, changeType: "overwrite" }} />)}
        {(writeResult.unchanged || []).map((path) => <TargetChip key={`unchanged-${path}`} target={{ path, changeType: "unchanged" }} />)}
      </div>
    </div>
  );
}

function TargetChip({ target }) {
  const meta = targetStatus(target);
  return (
    <div className="target-chip-card">
      <div className="target-chip-copy">
        <strong>{target.label || inferLabelFromPath(target.path) || "目标文件"}</strong>
        <code>{target.path}</code>
      </div>
      <span className={`target-chip-badge ${meta.className}`}>{meta.label}</span>
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
    Review: "自检"
  }[phase] || phase;
}

function defaultOpen(phase, modalKind) {
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
      {details.streamedText && event.phase !== "Draft" && (
        <div className="detail-block">
          <strong>当前公开过程</strong>
          <pre>{details.streamedText}</pre>
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
          <div className="target-chip-list">
            {details.targets.map((target) => <TargetChip key={target.path} target={target} />)}
          </div>
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
  const preferredOrder = ["Scope", "Context", "Budget", "Workflow", "Prompt", "Observe", "Plan", "Draft", "Review", "Write Plan", "Reflection"];
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

function collectTargetStatuses(modal, events) {
  if (Array.isArray(modal.result?.targets) && modal.result.targets.length) {
    return modal.result.targets;
  }
  const targetEvent = [...events].reverse().find((event) => Array.isArray(event.details?.targets) && event.details.targets.length);
  return targetEvent?.details?.targets || [];
}

function summarizeTargets(targets = []) {
  return targets.reduce((summary, target) => {
    const meta = targetStatus(target);
    summary.total += 1;
    summary[meta.bucket] += 1;
    return summary;
  }, { total: 0, create: 0, overwrite: 0, unchanged: 0 });
}

function targetStatus(target = {}) {
  const changeType = target.changeType || (target.exists ? "overwrite" : "create");
  if (changeType === "overwrite") {
    return { bucket: "overwrite", label: "覆盖", className: "overwrite" };
  }
  if (changeType === "unchanged") {
    return { bucket: "unchanged", label: "未变化", className: "unchanged" };
  }
  return { bucket: "create", label: "新增", className: "create" };
}

function inferLabelFromPath(repoPath) {
  return String(repoPath || "").split("/").pop()?.replace(/\.[^.]+$/, "") || "目标文件";
}

function buildFileCards(modal, targets, events) {
  const result = modal.result || {};
  const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
  const artifactMap = new Map(artifacts.map((artifact) => [artifact.path, artifact]));
  const liveDraft = [...events].reverse().find((event) => event.phase === "Draft" && event.details?.generatedText)?.details?.generatedText || "";
  const paths = [...new Set([...targets.map((target) => target.path), ...artifacts.map((artifact) => artifact.path)])];
  const singleTargetPath = paths.length === 1 ? paths[0] : "";

  return paths.map((path) => {
    const target = targets.find((item) => item.path === path) || { path, label: inferLabelFromPath(path) };
    const artifact = artifactMap.get(path);
    const fallbackContent = modal.kind === "running" && path === singleTargetPath ? liveDraft : "";
    const content = artifact?.content || fallbackContent;
    const hasRenderableContent = Boolean(String(content || "").trim());
    return {
      ...target,
      content,
      canWrite: Boolean(artifact?.path),
      placeholderTitle: modal.kind === "running"
        ? "该文件正在等待生成内容。"
        : "该文件暂时没有可预览内容。",
      placeholderCopy: modal.kind === "running"
        ? "如果是多文件结果，模型完成后会把对应内容拆到这里。"
        : "重新执行后会在这里显示可确认写入的 Markdown。",
      footerNote: hasRenderableContent
        ? (artifact?.path ? "这里展示的是确认前的文件预览，可单独写入。" : "当前为实时流式草稿，待完整结果回传后才能单独写入。")
        : (modal.kind === "running" ? "当前仍在等待该文件的专属内容。" : "当前没有可写入内容。")
    };
  });
}
