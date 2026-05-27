import { useEffect, useMemo, useRef, useState } from "react";
import { companyNavItems, projectNavItems } from "./constants/ui.js";
import { api } from "./lib/api.js";
import { modelStatusLine } from "./lib/view-models.js";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { Topbar } from "./components/Topbar.jsx";
import { ActionModal } from "./components/ActionModal.jsx";
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
  }, [modal, editor, activeNav]);

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

  async function runAction(actionId, input = {}, options = {}) {
    if (!actionsEnabled) {
      setModal({ kind: "error", title: "模型不可用", error: "当前没有可用模型配置，无法执行写作动作。", retryable: false });
      return;
    }

    const projectSlug = options.projectSlug ?? (currentScope === "project" ? selectedProject : "");
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
      input,
      steps: [{ phase: "Context", message: "正在读取固定 Context Profile。" }]
    });

    try {
      const start = await api("/api/actions/start", {
        method: "POST",
        body: JSON.stringify({ actionId, projectSlug, input }),
        signal: controller.signal
      });
      currentRunRef.current = start.runId;
      setModal({
        kind: "running",
        title: action?.label || "执行中",
        actionId,
        input,
        runId: start.runId,
        steps: [{ phase: "Context", message: "任务已创建，正在等待服务端回传执行步骤。" }]
      });
      await streamRun(start.runId, action, actionId, input, controller.signal);
    } catch (error) {
      if (error.name === "AbortError") {
        setModal({
          kind: "cancelled",
          title: action?.label || "执行已取消",
          actionId,
          input,
          error: "本次请求已取消。",
          retryable: true
        });
        return;
      }
      setModal({
        kind: "error",
        title: action?.label || "执行失败",
        actionId,
        input,
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

  function streamRun(runId, action, actionId, input, signal) {
    return new Promise((resolve, reject) => {
      const eventSource = new EventSource(`/api/actions/${runId}/events`);
      eventSourceRef.current = eventSource;
      const steps = [];

      const cleanup = () => {
        eventSource.close();
        if (eventSourceRef.current === eventSource) {
          eventSourceRef.current = null;
        }
      };

      signal.addEventListener("abort", () => cleanup(), { once: true });

      eventSource.addEventListener("step", (event) => {
        const step = JSON.parse(event.data);
        steps.push(step);
        setModal((current) => current && current.runId === runId ? { ...current, kind: "running", steps: [...steps] } : current);
      });

      eventSource.addEventListener("done", (event) => {
        const result = JSON.parse(event.data || "{}");
        cleanup();
        currentRunRef.current = null;
        refreshModelStatus();
        if (result.status === "cancelled") {
          setModal({ kind: "cancelled", title: action?.label || "执行已取消", actionId, input, error: result.error || "本次请求已取消。", retryable: true });
          resolve();
          return;
        }
        if (result.status === "error") {
          setModal({ kind: "error", title: action?.label || "执行失败", actionId, input, error: result.error || "执行失败", retryable: true, result: { ...result, events: result.events || steps } });
          resolve();
          return;
        }
        setModal({ kind: "result", title: result.action?.label || action?.label || "执行完成", actionId, input, result });
        resolve();
      });

      eventSource.onerror = () => {
        cleanup();
        reject(new Error("执行过程连接中断，请重试。"));
      };
    });
  }

  async function saveActionResult(result) {
    try {
      const saved = await api("/api/artifacts/write", {
        method: "POST",
        body: JSON.stringify({ artifacts: result.artifacts || [] })
      });
      const nextManifest = await api("/api/manifest");
      setManifest(nextManifest);
      if (result.saveMode === "project-bootstrap" && result.projectSlug) {
        openProject(result.projectSlug);
        setEditor(null);
        setModal({ kind: "saved", title: "已创建书籍项目", path: `books/${result.projectSlug}/` });
        return;
      }
      setModal({ kind: "saved", title: "已写入目标文件", path: (saved.written || []).join("、") });
    } catch (error) {
      setModal({ kind: "error", title: "写入失败", error: error.message, retryable: false });
    }
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
        error: "本次请求已取消。",
        retryable: true
      });
    }
  }

  function retryModalAction() {
    if (!modal?.actionId) return;
    runAction(modal.actionId, modal.input || {});
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
              runAction={runAction}
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
              runAction={runAction}
              actionsEnabled={actionsEnabled}
            />
          )}
          {page === "project-overview" && <ProjectOverview currentProject={currentProject} manifest={manifest} openFile={openFile} onDeleteFile={deleteFile} />}
          {page === "bible" && <BoardPage boardKey="bible" manifest={manifest} currentProject={currentProject} runAction={runAction} actionMap={actionMap} actionsEnabled={actionsEnabled} openFile={openFile} onDeleteFile={deleteFile} />}
          {page === "characters" && <BoardPage boardKey="characters" manifest={manifest} currentProject={currentProject} runAction={runAction} actionMap={actionMap} actionsEnabled={actionsEnabled} openFile={openFile} onDeleteFile={deleteFile} />}
          {page === "plot" && <PlotBoard manifest={manifest} currentProject={currentProject} runAction={runAction} actionMap={actionMap} actionsEnabled={actionsEnabled} openFile={openFile} onDeleteFile={deleteFile} />}
          {page === "factory" && <ChapterFactory currentProject={currentProject} runAction={runAction} actionMap={actionMap} actionsEnabled={actionsEnabled} />}
          {page === "continuity" && <BoardPage boardKey="continuity" manifest={manifest} currentProject={currentProject} runAction={runAction} actionMap={actionMap} actionsEnabled={actionsEnabled} openFile={openFile} onDeleteFile={deleteFile} />}
        </main>
      </div>
      {modal && <ActionModal modal={modal} onClose={() => setModal(null)} onSave={saveActionResult} onRetry={retryModalAction} onCancel={cancelRun} />}
      {editor && <FileEditorModal editor={editor} onClose={() => setEditor(null)} onChange={patchEditor} onSave={saveEditor} onDelete={deleteFile} />}
    </ErrorBoundary>
  );
}

export default App;
