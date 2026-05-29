import { useEffect, useMemo, useState } from "react";
import { FilePlus2, FolderTree, LoaderCircle, Play, RefreshCcw, Trash2, X } from "lucide-react";
import { api } from "../lib/api.js";

function uniqueList(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function normalizeRepoPath(value) {
  return String(value || "").trim().replace(/^\/+/, "");
}

function splitRepoPath(value) {
  const normalized = normalizeRepoPath(value);
  const parts = normalized.split("/").filter(Boolean);
  const fileName = parts.pop() || "";
  return {
    folderPath: parts.join("/"),
    fileName
  };
}

function joinRepoPath(folderPath, fileName) {
  const normalizedFolder = normalizeRepoPath(folderPath);
  const normalizedName = normalizeFileName(fileName);
  if (!normalizedFolder) return normalizedName;
  if (!normalizedName) return normalizedFolder;
  return `${normalizedFolder}/${normalizedName}`;
}

function inferLabelFromFileName(fileName) {
  const value = String(fileName || "").trim();
  return value.replace(/\.[^.]+$/, "") || "目标文件";
}

function inferLabelFromPath(value) {
  return inferLabelFromFileName(splitRepoPath(value).fileName);
}

function slugifySegment(value, fallback = "补充文件") {
  return String(value || "")
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;
}

function normalizeFileName(value) {
  const stripped = String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_");
  if (!stripped) return "";
  if (/\.[^.]+$/.test(stripped)) return stripped;
  return `${stripped}.md`;
}

function inferDefaultFolder(action, projectSlug, targetDrafts = []) {
  const current = normalizeRepoPath(targetDrafts[0]?.folderPath);
  if (current) return current;
  if (projectSlug && action?.scope !== "company") return `books/${projectSlug}/资料库`;
  return "company";
}

function buildSuggestedTargetDraft(action, projectSlug, targetDrafts = []) {
  const folderPath = inferDefaultFolder(action, projectSlug, targetDrafts);
  const nextIndex = targetDrafts.length + 1;
  const fileName = normalizeFileName(`${slugifySegment(`${action?.label || "补充文件"}_补充_${nextIndex}`, `补充文件_${nextIndex}`)}`);
  return {
    folderPath,
    fileName,
    label: inferLabelFromFileName(fileName),
    labelMode: "auto"
  };
}

function buildTargetDraft(target) {
  const { folderPath, fileName } = splitRepoPath(target?.path);
  const derived = inferLabelFromFileName(fileName);
  return {
    folderPath,
    fileName,
    label: String(target?.label || derived).trim() || derived,
    labelMode: target?.label && String(target.label).trim() !== derived ? "manual" : "auto"
  };
}

function targetDraftToTarget(target) {
  const fileName = normalizeFileName(target.fileName);
  const folderPath = normalizeRepoPath(target.folderPath);
  const path = joinRepoPath(folderPath, fileName);
  if (!path) return null;
  return {
    path,
    label: String(target.label || inferLabelFromFileName(fileName)).trim() || inferLabelFromFileName(fileName)
  };
}

function normalizeApiError(error, action = "规划") {
  if (error?.message === "Not found") {
    return `${action}接口不可用。请确认当前启动的是 company-console 的完整服务，而不是只有前端静态页。`;
  }
  return error?.message || `${action}失败`;
}

function summarizeTargets(targets = []) {
  return targets.reduce((summary, target) => {
    summary.total += 1;
    if (target.changeType === "create") summary.create += 1;
    if (target.changeType === "overwrite") summary.overwrite += 1;
    if (target.changeType === "unchanged") summary.unchanged += 1;
    return summary;
  }, { total: 0, create: 0, overwrite: 0, unchanged: 0 });
}

function buildFolderOptions({ action, projectSlug, targetDrafts, contextCandidates, previewContext }) {
  const paths = [
    ...targetDrafts.map((target) => joinRepoPath(target.folderPath, target.fileName || "占位.md")),
    ...(contextCandidates || []).map((item) => item.path),
    ...(previewContext || []).map((item) => item.path)
  ];
  const folders = uniqueList(paths.map((path) => splitRepoPath(path).folderPath).filter(Boolean));
  const defaultFolder = inferDefaultFolder(action, projectSlug, targetDrafts);
  return uniqueList([defaultFolder, ...folders]).sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function buildFolderTree(paths = []) {
  const root = { key: "__root__", label: "", path: "", children: [] };
  const index = new Map([["", root]]);
  for (const repoPath of paths) {
    const parts = normalizeRepoPath(repoPath).split("/").filter(Boolean);
    let currentPath = "";
    let parent = root;
    for (const segment of parts) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      if (!index.has(currentPath)) {
        const node = { key: currentPath, label: segment, path: currentPath, children: [] };
        index.set(currentPath, node);
        parent.children.push(node);
      }
      parent = index.get(currentPath);
    }
  }
  const sortNode = (node) => {
    node.children.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
    node.children.forEach(sortNode);
  };
  sortNode(root);
  return root.children;
}

function buildFileTree(items = []) {
  const root = { key: "__root__", label: "", folders: [], files: [] };
  const index = new Map([["", root]]);
  for (const item of items) {
    const parts = normalizeRepoPath(item.path).split("/").filter(Boolean);
    const fileName = parts.pop() || item.path;
    let currentPath = "";
    let currentNode = root;
    for (const segment of parts) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      if (!index.has(currentPath)) {
        const node = { key: currentPath, label: segment, path: currentPath, folders: [], files: [] };
        index.set(currentPath, node);
        currentNode.folders.push(node);
      }
      currentNode = index.get(currentPath);
    }
    currentNode.files.push({
      key: item.path,
      path: item.path,
      label: fileName,
      item
    });
  }
  const sortNode = (node) => {
    node.folders.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
    node.files.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
    node.folders.forEach(sortNode);
  };
  sortNode(root);
  return root;
}

export function ActionInputModal({ actionId, action, initialValue, projectSlug, onClose, onConfirm }) {
  const [value, setValue] = useState(initialValue || {});
  const [guidanceDraft, setGuidanceDraft] = useState(initialValue?.additionalGuidance || "");
  const [guidanceCommitted, setGuidanceCommitted] = useState(Boolean(initialValue?.additionalGuidance));
  const [targets, setTargets] = useState([]);
  const [workflow, setWorkflow] = useState([]);
  const [selectedContextPaths, setSelectedContextPaths] = useState([]);
  const [contextCandidates, setContextCandidates] = useState([]);
  const [planState, setPlanState] = useState({ loading: false, error: "", summary: "", note: "", usedModel: false });
  const [preview, setPreview] = useState({ context: [], budget: null, promptPreview: "", targetStatuses: [] });
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [folderPickerIndex, setFolderPickerIndex] = useState(null);
  const [contextPickerScope, setContextPickerScope] = useState("");
  const fields = action?.inputSchema || [];

  const requiredMissing = useMemo(
    () => fields.filter((field) => field.required && !String(value[field.key] ?? field.defaultValue ?? "").trim()),
    [fields, value]
  );

  const normalizedTargets = useMemo(
    () => targets.map(targetDraftToTarget).filter(Boolean),
    [targets]
  );

  const hasIncompleteTargetRow = useMemo(
    () => targets.some((target) => !normalizeRepoPath(target.folderPath) || !normalizeFileName(target.fileName)),
    [targets]
  );

  const mandatoryTargetPaths = useMemo(
    () => normalizedTargets.map((target) => target.path),
    [normalizedTargets]
  );

  const effectiveContextPaths = useMemo(
    () => uniqueList([...selectedContextPaths, ...mandatoryTargetPaths]),
    [selectedContextPaths, mandatoryTargetPaths]
  );

  const groupedCandidates = useMemo(() => {
    const optional = (contextCandidates || []).filter((item) => !mandatoryTargetPaths.includes(item.path));
    return {
      company: optional.filter((item) => item.path.startsWith("company/")),
      book: optional.filter((item) => item.path.startsWith("books/"))
    };
  }, [contextCandidates, mandatoryTargetPaths]);

  const folderOptions = useMemo(
    () => buildFolderOptions({ action, projectSlug, targetDrafts: targets, contextCandidates, previewContext: preview.context }),
    [action, projectSlug, targets, contextCandidates, preview.context]
  );

  const selectedContextMap = useMemo(
    () => new Map((preview.context || []).map((item) => [item.path, item])),
    [preview.context]
  );

  const targetSummary = useMemo(
    () => summarizeTargets(preview.targetStatuses || []),
    [preview.targetStatuses]
  );

  useEffect(() => {
    setValue(initialValue || {});
    setGuidanceDraft(initialValue?.additionalGuidance || "");
    setGuidanceCommitted(Boolean(initialValue?.additionalGuidance));
    setRefreshNonce(0);
    setFolderPickerIndex(null);
    setContextPickerScope("");
  }, [initialValue, actionId]);

  useEffect(() => {
    if (!actionId) {
      setPlanState({ loading: false, error: "", summary: "", note: "", usedModel: false });
      setPreview({ context: [], budget: null, promptPreview: "", targetStatuses: [] });
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPlanState((current) => ({ ...current, loading: true, error: "" }));
      try {
        const plan = await api("/api/action-plan", {
          method: "POST",
          body: JSON.stringify({ actionId, projectSlug, input: value }),
          signal: controller.signal
        });
        setPlanState({
          loading: false,
          error: "",
          summary: plan.summary || "",
          note: plan.note || "",
          usedModel: Boolean(plan.usedModel)
        });
        setTargets((plan.targetPlan?.targets || []).map(buildTargetDraft));
        setWorkflow(plan.workflow || []);
        setSelectedContextPaths(
          (plan.selectedContextPaths || []).filter((repoPath) => !(plan.targetPlan?.targets || []).some((target) => target.path === repoPath))
        );
        setContextCandidates(plan.contextCandidates || []);
        setPreview({
          context: plan.context || [],
          budget: plan.budget || null,
          promptPreview: plan.promptPreview || "",
          targetStatuses: plan.targetStatuses || []
        });
        setPreviewError("");
      } catch (error) {
        if (error.name === "AbortError") return;
        setPlanState({ loading: false, error: normalizeApiError(error, "规划"), summary: "", note: "", usedModel: false });
      }
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [actionId, projectSlug, value, refreshNonce]);

  useEffect(() => {
    if (!actionId || (!planState.summary && !normalizedTargets.length)) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError("");
      try {
        const resolved = await api("/api/context/resolve", {
          method: "POST",
          body: JSON.stringify({
            actionId,
            projectSlug,
            input: value,
            targetPlanOverride: { targets: normalizedTargets },
            contextPathsOverride: effectiveContextPaths,
            workflowOverride: workflow
          }),
          signal: controller.signal
        });
        setPreview({
          context: resolved.context || [],
          budget: resolved.budget || null,
          promptPreview: resolved.promptPreview || "",
          targetStatuses: resolved.targetStatuses || []
        });
      } catch (error) {
        if (error.name === "AbortError") return;
        setPreviewError(normalizeApiError(error, "上下文预览"));
      } finally {
        setPreviewLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [actionId, projectSlug, value, normalizedTargets, effectiveContextPaths, workflow, planState.summary]);

  if (!action) return null;

  const canSubmit = !requiredMissing.length
    && !planState.loading
    && !previewLoading
    && normalizedTargets.length > 0
    && !hasIncompleteTargetRow;

  function updateField(key, nextValue) {
    setValue((current) => ({
      ...current,
      [key]: nextValue
    }));
  }

  function updateTarget(index, patch) {
    setTargets((current) => current.map((target, targetIndex) => {
      if (targetIndex !== index) return target;
      const next = { ...target, ...patch };
      if (patch.fileName != null && next.labelMode !== "manual") {
        next.label = inferLabelFromFileName(normalizeFileName(patch.fileName) || patch.fileName);
      }
      return next;
    }));
  }

  function updateTargetLabel(index, label) {
    setTargets((current) => current.map((target, targetIndex) => targetIndex === index
      ? {
        ...target,
        label,
        labelMode: "manual"
      }
      : target));
  }

  function removeTarget(index) {
    setTargets((current) => current.filter((_, targetIndex) => targetIndex !== index));
  }

  function addTarget() {
    setTargets((current) => [...current, buildSuggestedTargetDraft(action, projectSlug, current)]);
  }

  function removeOptionalContext(path) {
    setSelectedContextPaths((current) => current.filter((item) => item !== path));
  }

  function clearOptionalContext() {
    setSelectedContextPaths([]);
  }

  function confirmAdditionalGuidance() {
    const nextValue = guidanceDraft.trim();
    setValue((current) => ({
      ...current,
      additionalGuidance: nextValue
    }));
    setGuidanceCommitted(Boolean(nextValue));
  }

  function openContextPicker(scope) {
    setContextPickerScope(scope);
  }

  function applyContextScopeSelection(scope, nextPaths) {
    setSelectedContextPaths((current) => {
      const preserved = current.filter((path) => scope === "company" ? !path.startsWith("company/") : !path.startsWith("books/"));
      return uniqueList([...preserved, ...nextPaths]);
    });
    setContextPickerScope("");
  }

  const pickerItems = contextPickerScope === "company" ? groupedCandidates.company : groupedCandidates.book;
  const pickerSelected = selectedContextPaths.filter((path) => contextPickerScope === "company" ? path.startsWith("company/") : path.startsWith("books/"));

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal plan-modal">
        <div className="modal-head">
          <div>
            <p className="eyebrow">执行前规划确认</p>
            <h2>{action.label}</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="editor-body plan-modal-body">
          <section className="plan-section">
            <div className="target-overview-head">
              <div>
                <p className="eyebrow">{action.stage}</p>
                <strong>先补齐业务输入，再由 AI 规划文件与资料</strong>
              </div>
              <button className="ui-button secondary" onClick={() => setRefreshNonce((current) => current + 1)} disabled={planState.loading}>
                <RefreshCcw size={15} />
                重新规划
              </button>
            </div>
            <div className="form-grid">
              {fields.map((field) => (
                <label key={field.key} className={field.type === "textarea" ? "full-span-field" : ""}>
                  <span>{field.label}{field.required ? " *" : ""}</span>
                  {field.type === "select" ? (
                    <select value={value[field.key] ?? field.defaultValue ?? ""} onChange={(event) => updateField(field.key, event.target.value)}>
                      {(field.options || []).map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  ) : field.type === "textarea" ? (
                    <textarea
                      rows={6}
                      value={value[field.key] ?? ""}
                      placeholder={field.placeholder || ""}
                      onChange={(event) => updateField(field.key, event.target.value)}
                    />
                  ) : (
                    <input
                      type="text"
                      value={value[field.key] ?? ""}
                      placeholder={field.placeholder || ""}
                      onChange={(event) => updateField(field.key, event.target.value)}
                    />
                  )}
                </label>
              ))}
            </div>
            {requiredMissing.length > 0 && (
              <div className="error-box">请先补齐必填项：{requiredMissing.map((field) => field.label).join("、")}</div>
            )}
            {planState.loading && (
              <div className="loading-strip">
                <LoaderCircle size={16} className="spin" />
                <span>AI 正在规划目标文件与可读资料。</span>
              </div>
            )}
            {planState.error && <div className="error-box">{planState.error}</div>}
            {!planState.loading && !planState.error && (planState.summary || planState.note) && (
              <div className="input-modal-copy">
                {planState.summary && <strong>{planState.summary}</strong>}
                {planState.note && <p>{planState.note}</p>}
                <p>{planState.usedModel ? "当前文件计划来自 AI 规划，可继续微调文件夹、文件名和标签。" : "当前为默认规划结果，可继续微调文件夹、文件名和标签。"}</p>
              </div>
            )}
          </section>

          <section className="plan-section">
            <div className="target-overview">
              <div className="target-overview-head">
                <div>
                  <p className="eyebrow">目标文件计划</p>
                  <strong>改成文件夹 + 文件名，不再直接硬改完整路径</strong>
                </div>
                <button className="ui-button secondary" onClick={addTarget}>
                  <FilePlus2 size={15} />
                  新增目标文件
                </button>
              </div>
              <div className="detail-metrics">
                <div className="detail-metric">
                  <span>目标文件</span>
                  <strong>{targetSummary.total || normalizedTargets.length}</strong>
                </div>
                <div className="detail-metric">
                  <span>新增</span>
                  <strong>{targetSummary.create}</strong>
                </div>
                <div className="detail-metric">
                  <span>覆盖</span>
                  <strong>{targetSummary.overwrite}</strong>
                </div>
              </div>
              <div className="plan-target-list">
                {targets.map((target, index) => {
                  const normalizedPath = joinRepoPath(target.folderPath, normalizeFileName(target.fileName));
                  const status = (preview.targetStatuses || []).find((item) => item.path === normalizedPath);
                  return (
                    <div key={`${normalizedPath || "blank"}-${index}`} className="plan-target-row">
                      <div className="plan-target-fields">
                        <label className="full-span-field">
                          <span>目标文件夹</span>
                          <button type="button" className="folder-picker-button" onClick={() => setFolderPickerIndex(index)}>
                            <FolderTree size={15} />
                            <strong>{target.folderPath || "选择文件夹"}</strong>
                          </button>
                        </label>
                        <label>
                          <span>文件名</span>
                          <input
                            type="text"
                            value={target.fileName || ""}
                            placeholder="例如：角色总表.md"
                            onChange={(event) => updateTarget(index, { fileName: event.target.value })}
                          />
                        </label>
                        <label>
                          <span>文件标签</span>
                          <input
                            type="text"
                            value={target.label || ""}
                            placeholder="例如：角色总表"
                            onChange={(event) => updateTargetLabel(index, event.target.value)}
                          />
                        </label>
                        <div className="path-preview-card full-span-field">
                          <span>完整路径预览</span>
                          <code>{normalizedPath || "请先选择文件夹并填写文件名"}</code>
                        </div>
                      </div>
                      <div className="plan-target-meta">
                        {status && <span className={`target-chip-badge ${status.changeType}`}>{status.changeType === "create" ? "新增" : status.changeType === "overwrite" ? "覆盖" : "未变"}</span>}
                        <button className="icon-button danger" onClick={() => removeTarget(index)} title="删除这个目标文件">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {!targets.length && <div className="error-box">当前没有目标文件，无法开始执行。</div>}
            </div>
          </section>

          <section className="plan-section">
            <div className="target-overview">
              <div className="target-overview-head">
                <div>
                  <p className="eyebrow">读取资料计划</p>
                  <strong>改成弹窗文件树多选，不再一次性整批加入</strong>
                </div>
                <div className="button-row">
                  <button className="ui-button secondary" onClick={() => openContextPicker("company")} disabled={!groupedCandidates.company.length}>选择公司资料</button>
                  <button className="ui-button secondary" onClick={() => openContextPicker("book")} disabled={!groupedCandidates.book.length}>选择书籍资料</button>
                  <button className="ui-button secondary" onClick={clearOptionalContext} disabled={!selectedContextPaths.length}>清空可选资料</button>
                </div>
              </div>
              <div className="detail-metrics">
                <div className="detail-metric">
                  <span>已选资料</span>
                  <strong>{preview.context?.length || 0}</strong>
                </div>
                <div className="detail-metric">
                  <span>公司候选</span>
                  <strong>{groupedCandidates.company.length}</strong>
                </div>
                <div className="detail-metric">
                  <span>书籍候选</span>
                  <strong>{groupedCandidates.book.length}</strong>
                </div>
                <div className="detail-metric">
                  <span>强制读取</span>
                  <strong>{mandatoryTargetPaths.length}</strong>
                </div>
              </div>
              <div className="selected-context-list">
                {(preview.context || []).map((item) => {
                  const mandatory = mandatoryTargetPaths.includes(item.path);
                  return (
                    <div key={item.path} className="selected-context-card">
                      <div className="target-chip-copy">
                        <strong>{item.path}</strong>
                        <code>{mandatory ? "目标文件当前状态" : item.available ? "已加入读取" : "文件当前不存在"}</code>
                      </div>
                      <div className="selected-context-meta">
                        <span className={`target-chip-badge ${mandatory ? "overwrite" : "unchanged"}`}>{mandatory ? "必读" : "可删"}</span>
                        {!mandatory && <button className="ui-button secondary compact" onClick={() => removeOptionalContext(item.path)}>移除</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
              {previewError && <div className="error-box">{previewError}</div>}
            </div>
          </section>

          <section className="plan-section">
            <div className="target-overview">
              <div className="target-overview-head">
                <div>
                  <p className="eyebrow">额外指导意见</p>
                  <strong>补充资料之外的执行要求，确认后才纳入 token 计算</strong>
                </div>
                {guidanceCommitted && <span className="live-phase-badge">已确认纳入</span>}
              </div>
              <textarea
                rows={5}
                value={guidanceDraft}
                placeholder="例如：语气更狠一点；优先写回角色关系；不要碰某条旧设定；强化某个读者情绪点。"
                onChange={(event) => {
                  setGuidanceDraft(event.target.value);
                  setGuidanceCommitted(event.target.value.trim() === (value.additionalGuidance || "").trim() && Boolean(event.target.value.trim()));
                }}
              />
              <div className="button-row">
                <button className="ui-button secondary" onClick={() => {
                  setGuidanceDraft("");
                  setValue((current) => ({ ...current, additionalGuidance: "" }));
                  setGuidanceCommitted(false);
                }}>
                  清空指导意见
                </button>
                <button className="ui-button primary" onClick={confirmAdditionalGuidance}>
                  确认纳入本次执行
                </button>
              </div>
              <p className="muted">这里只在你点“确认纳入本次执行”后才会进入预算与执行提示。</p>
            </div>
          </section>

          <section className="plan-section">
            <div className="target-overview">
              <div className="target-overview-head">
                <div>
                  <p className="eyebrow">Token 预算预览</p>
                  <strong>资料选择变化后会自动重算</strong>
                </div>
                {previewLoading && <span className="live-phase-badge">正在重算</span>}
              </div>
              {preview.budget && (
                <div className="detail-metrics">
                  <div className="detail-metric">
                    <span>模型总窗口</span>
                    <strong>{preview.budget.maxContextWindowTokens}</strong>
                  </div>
                  <div className="detail-metric">
                    <span>本次输出上限</span>
                    <strong>{preview.budget.maxOutputTokens}</strong>
                  </div>
                  <div className="detail-metric">
                    <span>可用上下文预算</span>
                    <strong>{preview.budget.availableContextTokens}</strong>
                  </div>
                  <div className="detail-metric">
                    <span>原始上下文</span>
                    <strong>{preview.budget.originalContextTokens}</strong>
                  </div>
                  <div className="detail-metric">
                    <span>当前选中</span>
                    <strong>{preview.budget.selectedContextTokens}</strong>
                  </div>
                  <div className="detail-metric">
                    <span>压缩阈值</span>
                    <strong>{preview.budget.compressionThresholdTokens}</strong>
                  </div>
                  <div className="detail-metric">
                    <span>压缩状态</span>
                    <strong>{preview.budget.compressionActive ? "已触发" : "未触发"}</strong>
                  </div>
                </div>
              )}
              {preview.budget?.tokenizerNote && <p className="muted">{preview.budget.tokenizerNote}</p>}
              {preview.promptPreview && (
                <details className="context-file">
                  <summary>
                    <strong>本次上下文摘要预览</strong>
                    <span>展开查看</span>
                  </summary>
                  <pre>{preview.promptPreview}</pre>
                </details>
              )}
            </div>
          </section>
        </div>
        <div className="modal-actions">
          <span>
            {targetSummary.total
              ? `确认后开始执行：目标文件 ${targetSummary.total} 个，新增 ${targetSummary.create}，覆盖 ${targetSummary.overwrite}。`
              : "请先保留至少一个目标文件。"}
          </span>
          <div className="button-row">
            <button className="ui-button secondary" onClick={onClose}>取消</button>
            <button
              className="ui-button primary"
              disabled={!canSubmit}
              onClick={() => onConfirm({
                input: value,
                options: {
                  projectSlug,
                  targetPlanOverride: { targets: normalizedTargets },
                  contextPathsOverride: effectiveContextPaths,
                  workflowOverride: workflow
                }
              })}
            >
              <Play size={15} />
              确认后开始执行
            </button>
          </div>
        </div>
      </div>

      {folderPickerIndex != null && (
        <FolderPickerModal
          currentPath={targets[folderPickerIndex]?.folderPath || ""}
          folders={folderOptions}
          onClose={() => setFolderPickerIndex(null)}
          onSelect={(folderPath) => {
            updateTarget(folderPickerIndex, { folderPath });
            setFolderPickerIndex(null);
          }}
        />
      )}

      {contextPickerScope && (
        <ContextPickerModal
          title={contextPickerScope === "company" ? "选择公司资料" : "选择书籍资料"}
          items={pickerItems}
          initialSelected={pickerSelected}
          selectedContextMap={selectedContextMap}
          onClose={() => setContextPickerScope("")}
          onApply={(paths) => applyContextScopeSelection(contextPickerScope, paths)}
        />
      )}
    </div>
  );
}

function FolderPickerModal({ currentPath, folders, onClose, onSelect }) {
  const tree = useMemo(() => buildFolderTree(folders), [folders]);
  return (
    <div className="overlay-panel">
      <div className="overlay-modal">
        <div className="overlay-head">
          <div>
            <p className="eyebrow">选择文件夹</p>
            <strong>目标文件将写入这里</strong>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="tree-scroll">
          {tree.map((node) => (
            <FolderNode key={node.key} node={node} currentPath={currentPath} onSelect={onSelect} depth={0} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FolderNode({ node, currentPath, onSelect, depth }) {
  return (
    <div className="tree-folder-block" style={{ marginLeft: `${depth * 16}px` }}>
      <button type="button" className={node.path === currentPath ? "tree-folder-row active" : "tree-folder-row"} onClick={() => onSelect(node.path)}>
        <span>{node.label}</span>
        <em>{node.path}</em>
      </button>
      {node.children.map((child) => (
        <FolderNode key={child.key} node={child} currentPath={currentPath} onSelect={onSelect} depth={depth + 1} />
      ))}
    </div>
  );
}

function ContextPickerModal({ title, items, initialSelected, selectedContextMap, onClose, onApply }) {
  const [draftSelected, setDraftSelected] = useState(initialSelected);
  const tree = useMemo(() => buildFileTree(items), [items]);

  useEffect(() => {
    setDraftSelected(initialSelected);
  }, [initialSelected]);

  function togglePath(path) {
    setDraftSelected((current) => current.includes(path)
      ? current.filter((item) => item !== path)
      : [...current, path]);
  }

  return (
    <div className="overlay-panel">
      <div className="overlay-modal large">
        <div className="overlay-head">
          <div>
            <p className="eyebrow">{title}</p>
            <strong>按文件树多选后再应用</strong>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="tree-scroll">
          <ContextTreeNode
            node={tree}
            depth={0}
            selected={draftSelected}
            onToggle={togglePath}
            selectedContextMap={selectedContextMap}
          />
        </div>
        <div className="overlay-actions">
          <span>已选 {draftSelected.length} 个资料文件</span>
          <div className="button-row">
            <button className="ui-button secondary" onClick={onClose}>取消</button>
            <button className="ui-button primary" onClick={() => onApply(draftSelected)}>应用选择</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ContextTreeNode({ node, depth, selected, onToggle, selectedContextMap }) {
  const folders = node.folders || [];
  const files = node.files || [];
  return (
    <div>
      {node.label && (
        <div className="tree-folder-label" style={{ marginLeft: `${depth * 16}px` }}>
          <strong>{node.label}</strong>
        </div>
      )}
      {files.map((file) => {
        const checked = selected.includes(file.path);
        const resolved = selectedContextMap.get(file.path);
        return (
          <label key={file.key} className={`tree-file-row ${checked ? "active" : ""}`} style={{ marginLeft: `${(depth + 1) * 16}px` }}>
            <input type="checkbox" checked={checked} onChange={() => onToggle(file.path)} />
            <span>{file.label}</span>
            <em>{resolved?.fullTokens || file.item.fullTokens || 0} tok</em>
          </label>
        );
      })}
      {folders.map((folder) => (
        <ContextTreeNode
          key={folder.key}
          node={folder}
          depth={depth + (node.label ? 1 : 0)}
          selected={selected}
          onToggle={onToggle}
          selectedContextMap={selectedContextMap}
        />
      ))}
    </div>
  );
}
