import { useEffect, useMemo, useRef, useState } from "react";
import { companyNavItems, projectNavItems } from "./constants/ui.js";
import { api } from "./lib/api.js";
import { modelStatusLine } from "./lib/view-models.js";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { Topbar } from "./components/Topbar.jsx";
import { ActionModal } from "./components/ActionModal.jsx";
import { ActionInputModal } from "./components/ActionInputModal.jsx";
import { FileEditorModal } from "./components/FileEditorModal.jsx";
import {
  BoardPage,
  ChapterFactory,
  CompanyDashboard,
  Departments,
  PlotBoard,
  ProjectOverview,
  ProjectsHub
} from "./components/pages.jsx";

function App() {
  const [manifest, setManifest] = useState(null);
  const [modelStatus, setModelStatus] = useState(null);
  const [currentScope, setCurrentScope] = useState("company");
  const [page, setPage] = useState("company-dashboard");
  const [selectedProject, setSelectedProject] = useState("");
  const [selectedDepartment, setSelectedDepartment] = useState("main-agent");
  const [modal, setModal] = useState(null);
  const [builder, setBuilder] = useState({ seed: "" });
  const [editor, setEditor] = useState(null);
  const [actionInputModal, setActionInputModal] = useState(null);
  const requestControllerRef = useRef(null);
  const eventSourceRef = useRef(null);
  const currentRunRef = useRef(null);

  const currentProject = manifest?.projects?.find((project) => project.slug === selectedProject) || null;
  const actionMap = useMemo(() => new Map((manifest?.actions || []).map((action) => [action.id, action])), [manifest]);
  const actionsEnabled = Boolean(modelStatus?.configured);
  const activeNav = currentScope === "project" ? projectNavItems : companyNavItems;

  useEffect(() => {
    loadBootstrap();
  }, []);

  useEffect(() => {
    if (!currentProject && currentScope === "project") {
      setCurrentScope("company");
      setPage("projects");
    }
  }, [currentProject, currentScope]);

  useEffect(() => {
    function handleKeyDown(event) {
      const tag = event.target?.tagName;
      const isTyping = tag === "INPUT" || tag === "TEXTAREA" || event.target?.isContentEditable;
      if (event.key === "Escape") {
        if (actionInputModal) {
          setActionInputModal(null);
          return;
        }
        if (editor) {
          setEditor(null);
          return;
        }
        if (modal) {
          cancelRun(false);
          setModal(null);
          return;
        }
      }
      if (isTyping) return;
      if (event.altKey) {
        const index = Number(event.key);
        if (Number.isInteger(index) && index >= 1 && index <= activeNav.length) {
          event.preventDefault();
          setPage(activeNav[index - 1].id);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modal, editor, actionInputModal, activeNav]);

  async function loadBootstrap() {
    try {
      const [nextManifest, status] = await Promise.all([api("/api/manifest"), api("/api/model/status")]);
      setManifest(nextManifest);
      setModelStatus(status);
      setSelectedProject((current) => current || nextManifest.projects?.[0]?.slug || "");
    } catch (error) {
      setModal({ kind: "error", title: "加载失败", error: error.message, retryable: true });
    }
  }

  function openProject(slug) {
    setSelectedProject(slug);
    setCurrentScope("project");
    setPage("project-overview");
  }

  async function openFile(path) {
    const data = await api(`/api/file?path=${encodeURIComponent(path)}`);
    setEditor({
      path: data.path,
      draft: data.content,
      original: data.content,
      mode: "preview",
      dirty: false,
      saving: false
    });
  }

  function patchEditor(patch) {
    setEditor((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      next.dirty = next.draft !== next.original;
      return next;
    });
  }

  async function saveEditor() {
    if (!editor) return;
    patchEditor({ saving: true });
    try {
      await api("/api/file/write", {
        method: "POST",
        body: JSON.stringify({ path: editor.path, content: editor.draft })
      });
      const nextManifest = await api("/api/manifest");
      setManifest(nextManifest);
      setEditor((current) => current ? { ...current, original: current.draft, dirty: false, saving: false } : current);
    } catch (error) {
      patchEditor({ saving: false });
      setModal({ kind: "error", title: "保存失败", error: error.message, retryable: false });
    }
  }

  async function deleteFile(path) {
    if (!window.confirm(`确认删除这个资料文件？\n\n${path}`)) return;
    try {
      await api("/api/file/delete", {
        method: "POST",
        body: JSON.stringify({ path })
      });
      const nextManifest = await api("/api/manifest");
      setManifest(nextManifest);
      setEditor((current) => current?.path === path ? null : current);
      setModal({ kind: "saved", title: "已删除文件", path });
    } catch (error) {
      setModal({ kind: "error", title: "删除失败", error: error.message, retryable: false });
    }
  }

  function hasValue(value) {
    return value !== undefined && value !== null && String(value).trim() !== "";
  }

  function uniqueList(items = []) {
    return [...new Set(items.filter(Boolean))];
  }

  function withActionDefaults(action, input = {}) {
    const next = { ...input };
    for (const field of action?.inputSchema || []) {
      if (!hasValue(next[field.key]) && hasValue(field.defaultValue)) {
        next[field.key] = field.defaultValue;
      }
    }
    return next;
  }

  function requestAction(actionId, input = {}, options = {}) {
    const action = actionMap.get(actionId);
    const normalized = withActionDefaults(action, input);
    setActionInputModal({
      actionId,
      action,
      value: normalized,
      projectSlug: options.projectSlug ?? (currentScope === "project" ? selectedProject : "")
    });
  }

  async function runAction(actionId, input = {}, options = {}) {
    if (!actionsEnabled) {
      setModal({ kind: "error", title: "模型不可用", error: "当前没有可用模型配置，无法执行写作动作。", retryable: false });
      return;
    }

    const projectSlug = options.projectSlug ?? (currentScope === "project" ? selectedProject : "");
    const resumeState = options.resumeState || null;
    const executionOptions = {
      targetPlanOverride: options.targetPlanOverride || null,
      contextPathsOverride: options.contextPathsOverride || null,
      workflowOverride: options.workflowOverride || null
    };
    const action = actionMap.get(actionId);
    const controller = new AbortController();
    requestControllerRef.current = controller;
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    currentRunRef.current = null;

    setModal({
      kind: "running",
      title: action?.label || "执行中",
      actionId,
      projectSlug,
      input,
      executionOptions,
      steps: [{ phase: "Context", message: "正在读取你刚确认的资料与目标文件计划。" }]
    });

    try {
      const start = await api("/api/actions/start", {
        method: "POST",
        body: JSON.stringify({
          actionId,
          projectSlug,
          input,
          resumeState,
          ...executionOptions
        }),
        signal: controller.signal
      });
      currentRunRef.current = start.runId;
      setModal({
        kind: "running",
        title: action?.label || "执行中",
        actionId,
        projectSlug,
        input,
        executionOptions,
        runId: start.runId,
        steps: [{ phase: "Context", message: "任务已创建，正在等待服务端按确认后的计划回传执行步骤。" }]
      });
      await streamRun(start.runId, action, actionId, input, projectSlug, executionOptions, controller.signal);
    } catch (error) {
      if (error.name === "AbortError") {
        setModal({
          kind: "cancelled",
          title: action?.label || "执行已取消",
          actionId,
          projectSlug,
          input,
          executionOptions,
          error: "本次请求已取消。",
          retryable: true
        });
        return;
      }
      setModal({
        kind: "error",
        title: action?.label || "执行失败",
        actionId,
        projectSlug,
        input,
        executionOptions,
        error: error.message,
        retryable: true
      });
      refreshModelStatus();
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
      }
    }
  }

  function streamRun(runId, action, actionId, input, projectSlug, executionOptions, signal) {
    return new Promise((resolve, reject) => {
      const eventSource = new EventSource(`/api/actions/${runId}/events`);
      eventSourceRef.current = eventSource;
      let steps = [];
      let settled = false;
      let aborted = false;

      const cleanup = () => {
        eventSource.close();
        if (eventSourceRef.current === eventSource) {
          eventSourceRef.current = null;
        }
      };

      signal.addEventListener("abort", () => {
        aborted = true;
        cleanup();
      }, { once: true });

      eventSource.onopen = () => {
        setModal((current) => current && current.runId === runId
          ? {
            ...current,
            kind: "running",
            steps: current.steps?.length ? current.steps : [{ phase: "Context", message: "执行连接已建立，等待服务端逐步回传。" }]
          }
          : current);
      };

      eventSource.addEventListener("step", (event) => {
        const step = JSON.parse(event.data);
        steps.push(step);
        setModal((current) => current && current.runId === runId ? { ...current, kind: "running", steps: [...steps] } : current);
      });

      eventSource.addEventListener("patch", (event) => {
        const nextStep = JSON.parse(event.data);
        const index = steps.findIndex((item) => item.id === nextStep.id);
        if (index >= 0) {
          steps = steps.map((item, itemIndex) => itemIndex === index ? nextStep : item);
        } else {
          steps = [...steps, nextStep];
        }
        setModal((current) => current && current.runId === runId ? { ...current, kind: "running", steps: [...steps] } : current);
      });

      eventSource.addEventListener("done", (event) => {
        settled = true;
        const result = JSON.parse(event.data || "{}");
        cleanup();
        currentRunRef.current = null;
        refreshModelStatus();
        if (result.status === "cancelled") {
          setModal({ kind: "cancelled", title: action?.label || "执行已取消", actionId, projectSlug: result.projectSlug || projectSlug || "", input, executionOptions, error: result.error || "本次请求已取消。", retryable: true, result: { ...result, events: result.events || steps } });
          resolve();
          return;
        }
        if (result.status === "error") {
          setModal({ kind: "error", title: action?.label || "执行失败", actionId, projectSlug: result.projectSlug || projectSlug || "", input, executionOptions, error: result.error || "执行失败", retryable: true, result: { ...result, events: result.events || steps } });
          resolve();
          return;
        }
        setModal({ kind: "result", title: result.action?.label || action?.label || "执行完成", actionId, projectSlug: result.projectSlug || projectSlug || "", input, executionOptions, result });
        resolve();
      });

      eventSource.onerror = () => {
        if (settled || aborted || signal.aborted) {
          cleanup();
          return;
        }
        cleanup();
        reject(new Error("执行过程连接中断，请重试。"));
      };
    });
  }

  async function saveActionResult(result, selectedPaths = []) {
    const requested = new Set((selectedPaths.length ? selectedPaths : (result.artifacts || []).map((artifact) => artifact.path)).filter(Boolean));
    const alreadyWritten = new Set(result.writtenPaths || []);
    const artifacts = (result.artifacts || []).filter((artifact) => requested.has(artifact.path) && !alreadyWritten.has(artifact.path));
    if (!artifacts.length) return;
    const writingPaths = artifacts.map((artifact) => artifact.path);
    setModal((current) => current?.result
      ? {
        ...current,
        error: "",
        result: {
          ...current.result,
          writingPaths: uniqueList([...(current.result.writingPaths || []), ...writingPaths])
        }
      }
      : current);
    try {
      const saved = await api("/api/artifacts/write", {
        method: "POST",
        body: JSON.stringify({ artifacts })
      });
      const nextManifest = await api("/api/manifest");
      setManifest(nextManifest);
      const nextWrittenPaths = uniqueList([...(result.writtenPaths || []), ...(saved.written || [])]);
      const allWritten = (result.artifacts || []).length > 0 && nextWrittenPaths.length >= (result.artifacts || []).length;
      if (allWritten && result.saveMode === "project-bootstrap" && result.projectSlug) {
        openProject(result.projectSlug);
        setEditor(null);
      }
      setModal((current) => {
        if (!current?.result) return current;
        return {
          ...current,
          kind: allWritten ? "saved" : "result",
          title: allWritten
            ? (result.saveMode === "project-bootstrap" ? "已创建书籍项目" : "已写入目标文件")
            : current.title,
          path: allWritten
            ? (result.saveMode === "project-bootstrap" && result.projectSlug ? `books/${result.projectSlug}/` : nextWrittenPaths.join("、"))
            : current.path,
          writeResult: mergeWriteResults(current.writeResult, saved),
          result: {
            ...current.result,
            writtenPaths: nextWrittenPaths,
            writingPaths: (current.result.writingPaths || []).filter((path) => !writingPaths.includes(path))
          }
        };
      });
    } catch (error) {
      setModal((current) => current?.result
        ? {
          ...current,
          error: error.message,
          result: {
            ...current.result,
            writingPaths: (current.result.writingPaths || []).filter((path) => !writingPaths.includes(path))
          }
        }
        : { kind: "error", title: "写入失败", error: error.message, retryable: false });
    }
  }

  function mergeWriteResults(current, next) {
    if (!current) return next;
    return {
      ok: current.ok || next.ok,
      written: uniqueList([...(current.written || []), ...(next.written || [])]),
      created: uniqueList([...(current.created || []), ...(next.created || [])]),
      overwritten: uniqueList([...(current.overwritten || []), ...(next.overwritten || [])]),
      unchanged: uniqueList([...(current.unchanged || []), ...(next.unchanged || [])]),
      projectRoots: uniqueList([...(current.projectRoots || []), ...(next.projectRoots || [])])
    };
  }

  function cancelRun(updateModal = true) {
    if (requestControllerRef.current) {
      requestControllerRef.current.abort();
      requestControllerRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    const runId = currentRunRef.current;
    currentRunRef.current = null;
    if (runId) {
      fetch(`/api/actions/${runId}/cancel`, { method: "POST" }).catch(() => {});
    }
    if (updateModal && modal?.actionId) {
      setModal({
        kind: "cancelled",
        title: modal.title,
        actionId: modal.actionId,
        input: modal.input,
        projectSlug: modal.projectSlug,
        executionOptions: modal.executionOptions,
        error: "本次请求已取消。",
        retryable: true
      });
    }
  }

  function retryModalAction() {
    if (!modal?.actionId) return;
    runAction(modal.actionId, modal.input || {}, {
      projectSlug: modal.projectSlug || "",
      ...(modal.executionOptions || {})
    });
  }

  function resumeModalAction() {
    if (!modal?.actionId || !modal?.result?.resumeState) return;
    runAction(modal.actionId, modal.input || {}, {
      projectSlug: modal.projectSlug || "",
      resumeState: modal.result.resumeState,
      ...(modal.executionOptions || {})
    });
  }

  function refreshModelStatus() {
    api("/api/model/status").then(setModelStatus).catch(() => {});
  }

  if (!manifest) {
    return <div className="loading">ProjectGod 写作工作台加载中</div>;
  }

  return (
    <ErrorBoundary>
      <div className="app-shell">
        <Sidebar
          currentScope={currentScope}
          setCurrentScope={(scope) => {
            setCurrentScope(scope);
            setPage(scope === "project" ? "project-overview" : "company-dashboard");
          }}
          companyNavItems={companyNavItems}
          projectNavItems={projectNavItems}
          page={page}
          setPage={setPage}
          currentProject={currentProject}
          modelStatus={modelStatus}
          statusLine={modelStatusLine(modelStatus)}
        />
        <main className="main">
          <Topbar manifest={manifest} currentScope={currentScope} currentProject={currentProject} onBackToCompany={() => {
            setCurrentScope("company");
            setPage("projects");
          }} />

          {page === "company-dashboard" && <CompanyDashboard manifest={manifest} openFile={openFile} onDeleteFile={deleteFile} />}
          {page === "departments" && (
            <Departments
              manifest={manifest}
              selectedDepartment={selectedDepartment}
              setSelectedDepartment={setSelectedDepartment}
              currentProject={currentProject}
              runAction={requestAction}
              actionMap={actionMap}
              actionsEnabled={actionsEnabled}
            />
          )}
          {page === "projects" && (
            <ProjectsHub
              manifest={manifest}
              selectedProject={selectedProject}
              openProject={openProject}
              builder={builder}
              setBuilder={setBuilder}
              runAction={requestAction}
              actionsEnabled={actionsEnabled}
            />
          )}
          {page === "project-overview" && <ProjectOverview currentProject={currentProject} manifest={manifest} openFile={openFile} onDeleteFile={deleteFile} />}
          {page === "bible" && <BoardPage boardKey="bible" manifest={manifest} currentProject={currentProject} runAction={requestAction} actionMap={actionMap} actionsEnabled={actionsEnabled} openFile={openFile} onDeleteFile={deleteFile} />}
          {page === "characters" && <BoardPage boardKey="characters" manifest={manifest} currentProject={currentProject} runAction={requestAction} actionMap={actionMap} actionsEnabled={actionsEnabled} openFile={openFile} onDeleteFile={deleteFile} />}
          {page === "plot" && <PlotBoard manifest={manifest} currentProject={currentProject} runAction={requestAction} actionMap={actionMap} actionsEnabled={actionsEnabled} openFile={openFile} onDeleteFile={deleteFile} />}
          {page === "factory" && <ChapterFactory currentProject={currentProject} runAction={requestAction} actionMap={actionMap} actionsEnabled={actionsEnabled} />}
          {page === "continuity" && <BoardPage boardKey="continuity" manifest={manifest} currentProject={currentProject} runAction={requestAction} actionMap={actionMap} actionsEnabled={actionsEnabled} openFile={openFile} onDeleteFile={deleteFile} />}
        </main>
      </div>
      {modal && <ActionModal modal={modal} onClose={() => setModal(null)} onSave={saveActionResult} onRetry={retryModalAction} onResume={resumeModalAction} onCancel={cancelRun} />}
      {actionInputModal && (
        <ActionInputModal
          actionId={actionInputModal.actionId}
          action={actionInputModal.action}
          initialValue={actionInputModal.value}
          projectSlug={actionInputModal.projectSlug}
          onClose={() => setActionInputModal(null)}
          onConfirm={({ input, options }) => {
            const payload = withActionDefaults(actionInputModal.action, input);
            const actionId = actionInputModal.actionId;
            setActionInputModal(null);
            runAction(actionId, payload, options);
          }}
        />
      )}
      {editor && <FileEditorModal editor={editor} onClose={() => setEditor(null)} onChange={patchEditor} onSave={saveEditor} onDelete={deleteFile} />}
    </ErrorBoundary>
  );
}

export default App;
