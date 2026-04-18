const state = {
  projects: [],
  selectedProjectId: null,
  activeTab: "overview",
  activeChapterNumber: 1,
  llmStatus: null,
  promptConfig: null,
  promptStatus: null,
  pendingAction: "",
  pendingContext: null,
  bannerMessage: "",
  countdown: null,
  countdownTimer: null,
  automationPollTimer: null,
  automationPollInFlight: false,
};

const AUTOMATION_POLL_INTERVAL_MS = 5000;

const dom = {
  projectCount: document.querySelector("#project-count"),
  projectList: document.querySelector("#project-list"),
  projectTitle: document.querySelector("#project-title"),
  projectStatus: document.querySelector("#project-status"),
  projectSubtitle: document.querySelector("#project-subtitle"),
  projectNextAction: document.querySelector("#project-next-action"),
  projectUpdatedAt: document.querySelector("#project-updated-at"),
  overview: document.querySelector("#tab-overview"),
  settings: document.querySelector("#tab-settings"),
  outline: document.querySelector("#tab-outline"),
  library: document.querySelector("#tab-library"),
  chapters: document.querySelector("#tab-chapters"),
  reading: document.querySelector("#tab-reading"),
  prompts: document.querySelector("#tab-prompts"),
  records: document.querySelector("#tab-records"),
  tabs: document.querySelectorAll(".tab"),
  createProject: document.querySelector("#create-project"),
  newTitle: document.querySelector("#new-title"),
  newGenre: document.querySelector("#new-genre"),
  newHook: document.querySelector("#new-hook"),
  llmStatus: document.querySelector("#llm-status"),
  deleteProject: document.querySelector("#delete-project"),
  appBanner: document.querySelector("#app-banner"),
};

async function apiFetch(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    let message = `请求失败：${response.status}`;
    try {
      const payload = await response.json();
      if (payload.error) {
        message = payload.error;
      }
    } catch {
      // ignore invalid json payload
    }
    throw new Error(message);
  }

  return response.json();
}

function getCurrentProject() {
  return state.projects.find((project) => project.id === state.selectedProjectId) || null;
}

function chapterByNumber(project, number) {
  return project.chapters.find((chapter) => chapter.number === number);
}

function currentChapter(project) {
  return chapterByNumber(project, state.activeChapterNumber) || project.chapters[0];
}

function formatChapterStatus(status) {
  return {
    not_started: "未开始",
    outlined: "已有细纲",
    drafted: "已有草稿",
    system_passed: "系统通过",
    approved: "已批准",
  }[status] || status;
}

function formatVolumeStatus(status) {
  return {
    not_started: "未开始",
    planned: "已规划",
    drafting: "推进中",
    system_passed: "系统通过",
    human_passed: "人工通过",
  }[status] || "未开始";
}

function formatRunStatus(status) {
  return {
    idle: "空闲",
    running: "运行中",
    paused: "已暂停",
    failed: "失败",
    completed: "已完成",
  }[status] || "未知";
}

function formatRunStep(step) {
  return {
    volume_goal: "推演卷目标",
    volume_chapters: "规划卷章节",
    chapter_outline: "生成章节细纲",
    chapter_draft: "生成章节正文",
    chapter_check: "执行章节检查",
    completed: "已完成",
    failed: "失败",
  }[step] || "待开始";
}

function formatRunScope(currentRun) {
  if (!currentRun) {
    return "-";
  }
  if (currentRun.scope === "book") {
    return "全书";
  }
  if (currentRun.scope === "volume") {
    return `第 ${currentRun.volumeNumber || "-"} 卷`;
  }
  return currentRun.scope || "-";
}

function formatRunOptions(currentRun) {
  if (!currentRun) {
    return "-";
  }
  const options = currentRun.options || {};
  if (currentRun.scope !== "book") {
    return "-";
  }
  const startVolume = options.startVolumeNumber || currentRun.volumeNumber || "-";
  const endVolume = options.endVolumeNumber || startVolume;
  const volumeText =
    startVolume === endVolume
      ? `第 ${startVolume} 卷`
      : `第 ${startVolume} 卷到第 ${endVolume} 卷`;
  const skipText = options.skipSystemPassedChapters === false ? "重跑系统通过章" : "跳过系统通过章";
  return `${volumeText} | ${skipText}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

async function refreshProjects(preferredProjectId = null) {
  const payload = await apiFetch("/api/projects");
  state.projects = payload.projects || [];

  if (!state.projects.length) {
    state.selectedProjectId = null;
  } else if (
    preferredProjectId &&
    state.projects.some((project) => project.id === preferredProjectId)
  ) {
    state.selectedProjectId = preferredProjectId;
  } else if (
    state.selectedProjectId &&
    state.projects.some((project) => project.id === state.selectedProjectId)
  ) {
    // Keep the current selection.
  } else {
    state.selectedProjectId = state.projects[0].id;
  }

  render();
}

function replaceProjectInState(project) {
  const index = state.projects.findIndex((item) => item.id === project.id);
  if (index >= 0) {
    state.projects[index] = project;
  } else {
    state.projects.unshift(project);
  }
  if (!state.selectedProjectId) {
    state.selectedProjectId = project.id;
  }
}

async function refreshProject(projectId) {
  const payload = await apiFetch(`/api/projects/${projectId}`);
  const project = payload.project || null;
  if (!project) {
    return;
  }
  replaceProjectInState(project);
  render();
}

async function saveProject(project) {
  await apiFetch(`/api/projects/${project.id}`, {
    method: "PUT",
    body: JSON.stringify(project),
  });
  await refreshProjects(project.id);
}

async function invokeProjectAction(projectId, path) {
  console.log(`[Action] Invoking ${path} for project ${projectId}`);
  const result = await apiFetch(path, { method: "POST" });
  console.log(`[Action] Success:`, result);
  await refreshProjects(projectId);
}

async function deleteProject(projectId) {
  await apiFetch(`/api/projects/${projectId}`, { method: "DELETE" });
  await refreshProjects();
}

async function refreshPrompts() {
  const payload = await apiFetch("/api/prompts");
  state.promptConfig = payload.prompts || null;
  state.promptStatus = payload.status || null;
  render();
}

async function savePromptConfig(config) {
  const payload = await apiFetch("/api/prompts", {
    method: "PUT",
    body: JSON.stringify(config),
  });
  state.promptConfig = payload.prompts || null;
  state.promptStatus = payload.status || null;
  render();
}

function isBusy(action = "", context = null) {
  if (state.pendingAction !== action) {
    return false;
  }
  if (!context) {
    return true;
  }
  const pendingContext = state.pendingContext || {};
  return Object.entries(context).every(([key, value]) => pendingContext[key] === value);
}

function setPending(action, context = null) {
  state.pendingAction = action;
  state.pendingContext = context;
  render();
}

function clearPending() {
  state.pendingAction = "";
  state.pendingContext = null;
  render();
}

function showBanner(message) {
  state.bannerMessage = message;
  render();
}

function clearBanner() {
  if (!state.bannerMessage) {
    return;
  }
  state.bannerMessage = "";
  render();
}

function stopCountdownTimer() {
  if (!state.countdownTimer) {
    return;
  }
  clearInterval(state.countdownTimer);
  state.countdownTimer = null;
}

function busyButtonText(action) {
  const suffix = state.countdown !== null ? ` (${state.countdown}s)...` : "...";
  return {
    "generate-full-outline": `推演中${suffix}`,
    "generate-volume-goal": `推演中${suffix}`,
    "generate-volume-chapters": `规划中${suffix}`,
    "generate-chapter-outline": `生成中${suffix}`,
    "generate-draft": `生成中${suffix}`,
  }[action] || "处理中...";
}

function syncCountdownButtons() {
  const buttonMap = [
    {
      selector: "#generate-full-outline",
      action: "generate-full-outline",
      idleText: "✨ AI 智能生成全书大纲",
      context: () => {
        const project = getCurrentProject();
        return project ? { projectId: project.id } : null;
      },
    },
    {
      selector: '[data-volume-action="generate-goal"]',
      action: "generate-volume-goal",
      idleText: "✨ 推演本卷目标",
      multi: true,
      context: (btn) => {
        const project = getCurrentProject();
        return project ? { projectId: project.id, volumeNumber: Number(btn.dataset.volumeNumber) } : null;
      },
    },
    {
      selector: '[data-volume-action="generate-chapters"]',
      action: "generate-volume-chapters",
      idleText: "✨ 生成本卷章节",
      multi: true,
      context: (btn) => {
        const project = getCurrentProject();
        return project ? { projectId: project.id, volumeNumber: Number(btn.dataset.volumeNumber) } : null;
      },
    },
    {
      selector: "#generate-current-outline",
      action: "generate-chapter-outline",
      idleText: "补当前章细纲",
      context: () => {
        const project = getCurrentProject();
        return project ? { projectId: project.id, chapterNumber: state.activeChapterNumber } : null;
      },
    },
    {
      selector: "#generate-current-draft",
      action: "generate-draft",
      idleText: "生成当前章草稿",
      context: () => {
        const project = getCurrentProject();
        return project ? { projectId: project.id, chapterNumber: state.activeChapterNumber } : null;
      },
    },
  ];

  buttonMap.forEach(({ selector, action, idleText, context, multi }) => {
    const buttons = multi ? document.querySelectorAll(selector) : [document.querySelector(selector)];
    buttons.forEach(button => {
      if (!button) {
        return;
      }
      button.textContent = isBusy(action, context ? context(button) : null) ? busyButtonText(action) : idleText;
    });
  });
}

async function runAction(action, task, context = null) {
  if (state.pendingAction) {
    return;
  }

  const shouldTrackCountdown = action.startsWith("generate-");
  if (shouldTrackCountdown) {
    state.countdown = state.llmStatus?.timeout || 300;
  }
  setPending(action, context);

  if (shouldTrackCountdown) {
    stopCountdownTimer();
    syncCountdownButtons();
    state.countdownTimer = setInterval(() => {
      if (state.countdown === null) {
        stopCountdownTimer();
        return;
      }
      if (state.countdown > 0) {
        state.countdown -= 1;
        syncCountdownButtons();
        return;
      }
      stopCountdownTimer();
    }, 1000);
  }

  try {
    await task();
  } finally {
    stopCountdownTimer();
    state.countdown = null;
    clearPending();
  }
}

function cloneProject(project) {
  return structuredClone(project);
}

function captureOutlineDraft(project) {
  const nextProject = cloneProject(project);
  const premiseEl = document.querySelector("#outline-premise");
  if (premiseEl) {
    nextProject.outline.premise = premiseEl.value.trim();
  }

  nextProject.volumes = (nextProject.volumes || []).map((volume) => {
    const titleEl = document.querySelector(
      `[data-volume-number="${volume.number}"][data-volume-field="title"]`,
    );
    const goalEl = document.querySelector(
      `[data-volume-number="${volume.number}"][data-volume-field="goal"]`,
    );
    return {
      number: volume.number,
      title: titleEl ? titleEl.value.trim() : volume.title,
      goal: goalEl ? goalEl.value.trim() : volume.goal,
    };
  });

  nextProject.outline.chapterPlans = (nextProject.outline.chapterPlans || []).map((plan) => {
    const focusEl = document.querySelector(
      `[data-plan-number="${plan.chapterNumber}"][data-plan-field="focus"]`,
    );
    const hookEl = document.querySelector(
      `[data-plan-number="${plan.chapterNumber}"][data-plan-field="hook"]`,
    );
    return {
      chapterNumber: plan.chapterNumber,
      volumeNumber: plan.volumeNumber,
      focus: focusEl ? focusEl.value.trim() : plan.focus,
      hook: hookEl ? hookEl.value.trim() : plan.hook,
    };
  });

  return nextProject;
}

function projectAutomation(project) {
  return project?.automation || { runStatus: "idle", currentRun: null };
}

function volumeAutomationState(project, volumeNumber) {
  const automation = projectAutomation(project);
  const currentRun = automation.currentRun || null;
  if (currentRun?.scope === "volume" && currentRun?.volumeNumber === volumeNumber) {
    return {
      runStatus: automation.runStatus,
      currentRun,
    };
  }
  return {
    runStatus: "idle",
    currentRun: null,
  };
}

function setElementText(selector, value) {
  const element = document.querySelector(selector);
  if (element) {
    element.textContent = value;
  }
}

function setButtonState(selector, { hidden = false, disabled = false, text = null } = {}) {
  const button = document.querySelector(selector);
  if (!button) {
    return;
  }
  button.hidden = hidden;
  button.disabled = disabled;
  if (text !== null) {
    button.textContent = text;
  }
}

function setInputDisabled(selector, disabled) {
  const field = document.querySelector(selector);
  if (field) {
    field.disabled = disabled;
  }
}

function syncOverviewProjectDom(project) {
  if (!project) {
    return;
  }

  const approvedCount = project.chapters.filter((chapter) => chapter.status === "approved").length;
  const draftedCount = project.chapters.filter((chapter) => chapter.content.trim()).length;
  const totalChapters = project.chapters.length;
  const automation = projectAutomation(project);
  const currentRun = automation.currentRun || null;

  setElementText("[data-overview-approved-count]", String(approvedCount));
  setElementText("[data-overview-total-count]", String(totalChapters));
  setElementText("[data-overview-drafted-count]", String(draftedCount));
  setElementText("[data-overview-drafted-total-count]", String(totalChapters));
  setElementText("[data-overview-next-action]", project.nextAction || "-");
  setElementText("[data-overview-run-status]", formatRunStatus(automation.runStatus));
  setElementText("[data-overview-run-scope]", formatRunScope(currentRun));
  setElementText("[data-overview-run-options]", formatRunOptions(currentRun));
  setElementText("[data-overview-run-step]", formatRunStep(currentRun?.step));
  setElementText("[data-overview-run-volume]", currentRun?.volumeNumber ? String(currentRun.volumeNumber) : "-");
  setElementText("[data-overview-run-chapter]", currentRun?.chapterNumber ? String(currentRun.chapterNumber) : "-");
  setElementText("[data-overview-run-message]", currentRun?.message || "-");

  const empty = document.querySelector("[data-overview-run-empty]");
  const details = document.querySelector("[data-overview-run-details]");
  const error = document.querySelector("[data-overview-run-error]");
  if (empty) {
    empty.hidden = Boolean(currentRun);
  }
  if (details) {
    details.hidden = !currentRun;
  }
  if (error) {
    const hasError = Boolean(currentRun?.error);
    error.hidden = !hasError;
    if (hasError) {
      const errorText = error.querySelector("[data-overview-run-error-text]");
      if (errorText) {
        errorText.textContent = currentRun.error;
      }
    }
  }

  const canStart = !currentRun || automation.runStatus === "completed" || automation.runStatus === "failed";
  setButtonState("#start-book-auto", {
    hidden: !canStart,
    disabled: Boolean(state.pendingAction),
  });
  setButtonState("#refresh-project-status", {
    hidden: false,
    disabled: Boolean(state.pendingAction),
  });
  setButtonState('[data-auto-overview-action="pause"]', {
    hidden: !(currentRun && automation.runStatus === "running"),
    disabled: Boolean(state.pendingAction),
  });
  setButtonState('[data-auto-overview-action="resume"]', {
    hidden: !(currentRun && automation.runStatus === "paused"),
    disabled: Boolean(state.pendingAction),
  });
  const startNote = document.querySelector("[data-overview-start-note]");
  if (startNote) {
    startNote.hidden = canStart;
  }
  setInputDisabled("#book-auto-start-volume", !canStart || Boolean(state.pendingAction));
  setInputDisabled("#book-auto-end-volume", !canStart || Boolean(state.pendingAction));
  setInputDisabled("#book-auto-skip-system-passed", !canStart || Boolean(state.pendingAction));

  document.querySelectorAll("[data-auto-overview-action]").forEach((button) => {
    button.dataset.runScope = currentRun?.scope || "book";
    button.dataset.volumeNumber = currentRun?.volumeNumber || "";
  });

  project.chapters.forEach((chapter) => {
    setElementText(
      `[data-overview-chapter-status="${chapter.number}"]`,
      formatChapterStatus(chapter.status),
    );
  });
}

function syncOutlineAutomationDom(project) {
  if (!project) {
    return;
  }

  const automation = projectAutomation(project);
  const runLocked = ["running", "paused"].includes(automation.runStatus);

  (project.volumes || []).forEach((volume) => {
    const autoState = volumeAutomationState(project, volume.number);
    const currentRun = autoState.currentRun || null;
    const otherRunActive = runLocked && autoState.runStatus === "idle";

    setElementText(
      `[data-volume-status="${volume.number}"]`,
      formatVolumeStatus(volume.status),
    );

    setButtonState(
      `[data-volume-number="${volume.number}"][data-volume-auto="start"]`,
      {
        hidden: autoState.runStatus !== "idle",
        disabled: Boolean(state.pendingAction || otherRunActive),
      },
    );
    setButtonState(
      `[data-volume-number="${volume.number}"][data-volume-auto="running"]`,
      {
        hidden: autoState.runStatus !== "running",
        disabled: true,
      },
    );
    setButtonState(
      `[data-volume-number="${volume.number}"][data-volume-auto="pause"]`,
      {
        hidden: autoState.runStatus !== "running",
        disabled: Boolean(state.pendingAction),
      },
    );
    setButtonState(
      `[data-volume-number="${volume.number}"][data-volume-auto="resume"]`,
      {
        hidden: autoState.runStatus !== "paused",
        disabled: Boolean(state.pendingAction),
      },
    );
    setButtonState(
      `[data-volume-number="${volume.number}"][data-volume-auto="refresh"]`,
      {
        hidden: false,
        disabled: Boolean(state.pendingAction),
      },
    );

    const message = document.querySelector(`[data-volume-auto-message="${volume.number}"]`);
    if (message) {
      const hasMessage = Boolean(currentRun?.message);
      message.hidden = !hasMessage;
      if (hasMessage) {
        const chapterSuffix = currentRun.chapterNumber
          ? ` | 当前章节：第 ${currentRun.chapterNumber} 章`
          : "";
        message.textContent = `${currentRun.message}${chapterSuffix}`;
      } else {
        message.textContent = "";
      }
    }
  });

  (project.outline.chapterPlans || []).forEach((plan) => {
    const chapter = chapterByNumber(project, plan.chapterNumber);
    if (!chapter) {
      return;
    }
    setElementText(
      `[data-plan-status="${plan.chapterNumber}"]`,
      formatChapterStatus(chapter.status),
    );
  });
}

function stopAutomationPolling() {
  if (state.automationPollTimer) {
    clearTimeout(state.automationPollTimer);
    state.automationPollTimer = null;
  }
}

function hasActiveAutomation(project) {
  const runStatus = projectAutomation(project).runStatus;
  return runStatus === "running" || runStatus === "paused";
}

async function pollAutomationStatus() {
  const project = getCurrentProject();
  if (!project || state.automationPollInFlight) {
    return;
  }
  state.automationPollInFlight = true;
  try {
    const payload = await apiFetch(`/api/projects/${project.id}`);
    const latestProject = payload.project || null;
    if (!latestProject || latestProject.id !== state.selectedProjectId) {
      return;
    }
    replaceProjectInState(latestProject);
    renderHeader();
    syncOverviewProjectDom(latestProject);
    syncOutlineAutomationDom(latestProject);
  } catch (error) {
    console.error("[Automation Poll]", error);
  } finally {
    state.automationPollInFlight = false;
    syncAutomationPolling();
  }
}

function syncAutomationPolling() {
  stopAutomationPolling();
  const project = getCurrentProject();
  if (!project || !hasActiveAutomation(project)) {
    return;
  }
  state.automationPollTimer = setTimeout(() => {
    pollAutomationStatus();
  }, AUTOMATION_POLL_INTERVAL_MS);
}

function render() {
  renderBanner();
  renderBrandStatus();
  renderSidebar();
  renderHeader();
  renderOverview();
  renderSettings();
  renderOutline();
  renderLibrary();
  renderChapters();
  renderReading();
  renderPrompts();
  renderRecords();
  bindDynamicEvents();
  syncAutomationPolling();
}

function renderBanner() {
  if (!state.bannerMessage) {
    dom.appBanner.textContent = "";
    dom.appBanner.classList.add("hidden");
    return;
  }
  dom.appBanner.textContent = state.bannerMessage;
  dom.appBanner.classList.remove("hidden");
}

function renderBrandStatus() {
  if (!state.llmStatus) {
    dom.llmStatus.textContent = "模型状态加载中...";
    return;
  }
  const prefix = state.llmStatus.configured ? "LLM" : "Stub";
  const model = state.llmStatus.model ? ` | ${state.llmStatus.model}` : "";
  const promptPath = state.promptStatus?.path ? ` | prompts: ${state.promptStatus.path}` : "";
  dom.llmStatus.textContent = `${prefix}${model} | ${state.llmStatus.message}${promptPath}`;
}

function renderSidebar() {
  dom.projectCount.textContent = `${state.projects.length} 部`;
  if (!state.projects.length) {
    dom.projectList.innerHTML = `
      <div class="empty">
        <strong>还没有小说项目</strong>
        <span>先在上方填写书名、题材和卖点，创建第一部小说。</span>
      </div>
    `;
    return;
  }
  dom.projectList.innerHTML = state.projects
    .map(
      (project) => `
        <button class="project-card ${project.id === state.selectedProjectId ? "active" : ""}" data-project-id="${project.id}">
          <div class="row-between">
            <h3>${escapeHtml(project.title)}</h3>
            <span class="status-pill">${project.status}</span>
          </div>
          <p class="muted">${escapeHtml(project.genre)}</p>
          <p>${escapeHtml(project.hook)}</p>
          <div class="project-meta">
            <span class="chip">${escapeHtml(project.nextAction)}</span>
            <span class="chip">${escapeHtml(project.updatedAt)}</span>
          </div>
        </button>
      `,
    )
    .join("");
}

function renderHeader() {
  const project = getCurrentProject();
  if (!project) {
    dom.projectTitle.textContent = "请选择小说项目";
    dom.projectStatus.textContent = "";
    dom.projectSubtitle.textContent = "";
    dom.projectNextAction.textContent = "-";
    dom.projectUpdatedAt.textContent = "-";
    dom.deleteProject.disabled = true;
    return;
  }

  dom.projectTitle.textContent = project.title;
  dom.projectStatus.textContent = project.status;
  dom.projectSubtitle.textContent = `${project.genre} | ${project.hook}`;
  dom.projectNextAction.textContent = project.nextAction;
  dom.projectUpdatedAt.textContent = project.updatedAt;
  dom.deleteProject.disabled = Boolean(state.pendingAction);
  dom.deleteProject.textContent = isBusy("delete-project") ? "删除中..." : "删除小说";
}

function renderOverview() {
  const project = getCurrentProject();
  if (!project) {
    dom.overview.innerHTML = `<div class="empty">暂无项目</div>`;
    return;
  }

  const approvedCount = project.chapters.filter((chapter) => chapter.status === "approved").length;
  const draftedCount = project.chapters.filter((chapter) => chapter.content.trim()).length;
  const totalChapters = project.chapters.length;
  const automation = projectAutomation(project);
  const currentRun = automation.currentRun || null;
  const canStartBookAuto =
    !currentRun || automation.runStatus === "completed" || automation.runStatus === "failed";
  const firstVolumeNumber = project.volumes?.[0]?.number || 1;
  const lastVolumeNumber = project.volumes?.[project.volumes.length - 1]?.number || firstVolumeNumber;
  const startVolumeOptions = (project.volumes || [])
    .map(
      (volume) =>
        `<option value="${volume.number}" ${volume.number === firstVolumeNumber ? "selected" : ""}>第 ${volume.number} 卷</option>`,
    )
    .join("");
  const endVolumeOptions = (project.volumes || [])
    .map(
      (volume) =>
        `<option value="${volume.number}" ${volume.number === lastVolumeNumber ? "selected" : ""}>第 ${volume.number} 卷</option>`,
    )
    .join("");

  dom.overview.innerHTML = `
    <div class="overview-grid">
      <article class="info-card">
        <span class="eyebrow">项目定位</span>
        <strong>${escapeHtml(project.genre)}</strong>
        <p>${escapeHtml(project.hook)}</p>
      </article>
      <article class="info-card">
        <span class="eyebrow">进度总览</span>
        <strong><span data-overview-approved-count>${approvedCount}</span> / <span data-overview-total-count>${totalChapters}</span> 已批准</strong>
        <p><span data-overview-drafted-count>${draftedCount}</span> / <span data-overview-drafted-total-count>${totalChapters}</span> 已有正文</p>
      </article>
      <article class="info-card">
        <span class="eyebrow">下一步动作</span>
        <strong data-overview-next-action>${escapeHtml(project.nextAction)}</strong>
        <p>通过设定、大纲、章节页继续推进。</p>
      </article>
    </div>
    <div class="overview-detail-layout" style="margin-top:16px;">
      <div class="overview-side-stack">
        <article class="editor-card">
          <div class="section-header">
            <h3>最小验证范围</h3>
            <span class="badge">页面驱动</span>
          </div>
          <p>当前原型验证的是多项目独立管理与多章节持续推进，不再局限于前三章。</p>
          <div class="actions">
            <button class="secondary" data-tab-target="settings">补设定</button>
            <button class="primary" data-tab-target="chapters">推进章节</button>
          </div>
        </article>
        <article class="editor-card">
          <div class="section-header">
            <h3>章节状态</h3>
            <span class="badge">Chapter State</span>
          </div>
          <div class="stack">
            ${project.chapters
              .map(
                (chapter) => `
                  <div class="row-between">
                    <span>${escapeHtml(chapter.title)}</span>
                    <span class="status-pill" data-overview-chapter-status="${chapter.number}">${formatChapterStatus(chapter.status)}</span>
                  </div>
                `,
              )
              .join("")}
          </div>
        </article>
      </div>
      <div class="overview-side-stack">
        <article class="editor-card overview-automation-card">
          <div class="section-header">
            <h3>任务状态</h3>
            <span class="badge" data-overview-run-status>${formatRunStatus(automation.runStatus)}</span>
          </div>
          <p class="muted" data-overview-run-empty ${currentRun ? "hidden" : ""}>暂无自动任务。可以在“大纲”页对任意一卷启动自动推进。</p>
          <div data-overview-run-details ${currentRun ? "" : "hidden"}>
            <p><strong>范围：</strong><span data-overview-run-scope>${escapeHtml(formatRunScope(currentRun))}</span></p>
            <p><strong>范围设置：</strong><span data-overview-run-options>${escapeHtml(formatRunOptions(currentRun))}</span></p>
            <p><strong>步骤：</strong><span data-overview-run-step>${escapeHtml(formatRunStep(currentRun?.step))}</span></p>
            <p><strong>当前卷：</strong><span data-overview-run-volume>${escapeHtml(currentRun?.volumeNumber || "-")}</span></p>
            <p><strong>当前章节：</strong><span data-overview-run-chapter>${escapeHtml(currentRun?.chapterNumber || "-")}</span></p>
            <p><strong>说明：</strong><span data-overview-run-message>${escapeHtml(currentRun?.message || "-")}</span></p>
            <p data-overview-run-error ${currentRun?.error ? "" : "hidden"}><strong>错误：</strong><span data-overview-run-error-text>${escapeHtml(currentRun?.error || "")}</span></p>
          </div>
          <div class="actions" style="margin-top:16px;">
            <button class="ghost" id="refresh-project-status" ${state.pendingAction ? "disabled" : ""}>刷新状态</button>
            <button class="secondary" data-auto-overview-action="pause" data-run-scope="${currentRun?.scope || "book"}" data-volume-number="${currentRun?.volumeNumber || ""}" ${currentRun && automation.runStatus === "running" ? "" : "hidden"} ${state.pendingAction ? "disabled" : ""}>暂停自动推进</button>
            <button class="primary" data-auto-overview-action="resume" data-run-scope="${currentRun?.scope || "book"}" data-volume-number="${currentRun?.volumeNumber || ""}" ${currentRun && automation.runStatus === "paused" ? "" : "hidden"} ${state.pendingAction ? "disabled" : ""}>继续自动推进</button>
          </div>
          <p class="muted" style="margin-top:12px;">自动任务在后台运行。页面会每 5 秒同步一次状态，不会覆盖当前编辑区里的未保存输入。</p>
        </article>
        <article class="editor-card overview-start-card">
          <div class="section-header">
            <h3>新任务启动设置</h3>
            <span class="badge">全书自动推进</span>
          </div>
          <p class="muted" data-overview-start-note ${canStartBookAuto ? "hidden" : ""}>当前已有自动任务在执行中。请先等待完成，或在上方暂停/继续当前任务。</p>
          <div class="grid-3" style="margin-top:16px;">
            <label>起始卷
              <select id="book-auto-start-volume" ${canStartBookAuto ? "" : "disabled"}>
                ${startVolumeOptions}
              </select>
            </label>
            <label>结束卷
              <select id="book-auto-end-volume" ${canStartBookAuto ? "" : "disabled"}>
                ${endVolumeOptions}
              </select>
            </label>
            <label class="overview-checkbox-field">
              <input type="checkbox" id="book-auto-skip-system-passed" checked ${canStartBookAuto ? "" : "disabled"} />
              <span>跳过已系统通过章节</span>
            </label>
          </div>
          <div class="actions" style="margin-top:16px;">
            <button class="primary" id="start-book-auto" ${canStartBookAuto ? "" : "hidden"} ${state.pendingAction ? "disabled" : ""}>自动推进全书</button>
          </div>
        </article>
      </div>
    </div>
  `;
}

function renderSettings() {
  const project = getCurrentProject();
  if (!project) {
    dom.settings.innerHTML = `<div class="empty">暂无项目</div>`;
    return;
  }

  dom.settings.innerHTML = `
    <div class="settings-grid">
      <article class="editor-card">
        <h3>基础信息</h3>
        <label>书名<input data-field="title" value="${escapeAttr(project.title)}" /></label>
        <label>题材<input data-field="genre" value="${escapeAttr(project.genre)}" /></label>
        <label>平台<input data-field="platform" value="${escapeAttr(project.platform)}" /></label>
        <label>读者<input data-field="audience" value="${escapeAttr(project.audience)}" /></label>
        <label>一句话卖点<textarea data-field="hook" rows="4">${escapeHtml(project.hook)}</textarea></label>
      </article>
      <article class="editor-card">
        <h3>最小设定</h3>
        <label>主题<textarea data-field="settings.theme" rows="3">${escapeHtml(project.settings.theme)}</textarea></label>
        <label>世界观<textarea data-field="settings.world" rows="4">${escapeHtml(project.settings.world)}</textarea></label>
        <label>力量体系<textarea data-field="settings.powerSystem" rows="3">${escapeHtml(project.settings.powerSystem)}</textarea></label>
        <label>势力格局<textarea data-field="settings.factions" rows="3">${escapeHtml(project.settings.factions)}</textarea></label>
      </article>
    </div>
    <article class="editor-card" style="margin-top:16px;">
      <div class="section-header">
        <h3>角色</h3>
        <button class="ghost" id="add-character">新增角色</button>
      </div>
      <div class="stack">
        ${project.characters
          .map(
            (character, index) => `
              <div class="grid-3">
                <label>姓名<input data-character-index="${index}" data-character-field="name" value="${escapeAttr(character.name)}" /></label>
                <label>定位<input data-character-index="${index}" data-character-field="role" value="${escapeAttr(character.role)}" /></label>
                <label>目标<input data-character-index="${index}" data-character-field="goal" value="${escapeAttr(character.goal)}" /></label>
              </div>
            `,
          )
          .join("")}
      </div>
      <div class="actions" style="margin-top:16px;">
        <button class="primary" id="save-settings">保存设定</button>
      </div>
    </article>
  `;
}

function renderOutline() {
  const project = getCurrentProject();
  if (!project) {
    dom.outline.innerHTML = `<div class="empty">暂无项目</div>`;
    return;
  }

  const volumes = project.volumes || [];
  const plansByVolume = new Map();
  (project.outline.chapterPlans || []).forEach((plan) => {
    const list = plansByVolume.get(plan.volumeNumber) || [];
    list.push(plan);
    plansByVolume.set(plan.volumeNumber, list);
  });
  const outlineActionContext = { projectId: project.id };

  dom.outline.innerHTML = `
    <article class="editor-card">
      <div class="section-header">
        <h3>故事大纲</h3>
        <div class="actions">
          <button class="secondary" id="generate-full-outline" ${state.pendingAction ? "disabled" : ""}>${isBusy("generate-full-outline", outlineActionContext) ? (state.countdown !== null ? `推演中 (${state.countdown}s)...` : "推演中...") : "✨ AI 智能生成全书大纲"}</button>
          <button class="primary" id="save-outline">保存大纲</button>
        </div>
      </div>
      <label>故事 premise<textarea id="outline-premise" rows="4">${escapeHtml(project.outline.premise)}</textarea></label>
    </article>

    <div class="volumes-container" style="margin-top:20px;">
      ${volumes.map(volume => {
        const plans = plansByVolume.get(volume.number) || [];
        const autoState = volumeAutomationState(project, volume.number);
        const automation = projectAutomation(project);
        const otherRunActive =
          ["running", "paused"].includes(automation.runStatus) && autoState.runStatus === "idle";
        return `
          <div class="volume-block" style="margin-bottom:32px; border-left: 4px solid var(--accent); padding-left: 20px;">
            <div class="section-header">
              <h3 style="color: var(--accent-strong);">第 ${volume.number} 卷：<input type="text" data-volume-number="${volume.number}" data-volume-field="title" value="${escapeAttr(volume.title)}" style="width:auto; display:inline; padding:4px 8px; margin-top:0;" /></h3>
              <span class="status-pill" data-volume-status="${volume.number}">${formatVolumeStatus(volume.status)}</span>
            </div>
            <label>本卷目标<textarea data-volume-number="${volume.number}" data-volume-field="goal" rows="2">${escapeHtml(volume.goal)}</textarea></label>
            <div class="actions" style="margin-top:12px; justify-content:flex-start;">
              <button class="secondary" data-volume-action="generate-goal" data-volume-number="${volume.number}" ${state.pendingAction ? "disabled" : ""}>${isBusy("generate-volume-goal", {projectId: project.id, volumeNumber: volume.number}) ? "推演目标中..." : "✨ 推演本卷目标"}</button>
              <button class="secondary" data-volume-action="generate-chapters" data-volume-number="${volume.number}" ${state.pendingAction ? "disabled" : ""}>${isBusy("generate-volume-chapters", {projectId: project.id, volumeNumber: volume.number}) ? "规划章节中..." : "✨ 生成本卷章节"}</button>
              <button class="primary" data-volume-auto="start" data-volume-number="${volume.number}" ${autoState.runStatus === "idle" ? "" : "hidden"} ${(state.pendingAction || otherRunActive) ? "disabled" : ""}>自动推进本卷</button>
              <button class="primary" data-volume-auto="running" data-volume-number="${volume.number}" ${autoState.runStatus === "running" ? "" : "hidden"} disabled>自动推进中</button>
              <button class="ghost" data-volume-auto="pause" data-volume-number="${volume.number}" ${autoState.runStatus === "running" ? "" : "hidden"} ${state.pendingAction ? "disabled" : ""}>暂停</button>
              <button class="primary" data-volume-auto="resume" data-volume-number="${volume.number}" ${autoState.runStatus === "paused" ? "" : "hidden"} ${state.pendingAction ? "disabled" : ""}>继续自动推进</button>
              <button class="ghost" data-volume-auto="refresh" data-volume-number="${volume.number}" ${state.pendingAction ? "disabled" : ""}>刷新状态</button>
            </div>
            <p class="muted" data-volume-auto-message="${volume.number}" style="margin:10px 0 0;" ${autoState.currentRun ? "" : "hidden"}>${escapeHtml(autoState.currentRun?.message || "")}${autoState.currentRun?.chapterNumber ? ` | 当前章节：第 ${autoState.currentRun.chapterNumber} 章` : ""}</p>
            
            <div class="grid-3" style="margin-top:12px;">
              ${plans.map(plan => `
                <article class="chapter-card">
                  <div class="row-between">
                    <h3>第 ${plan.chapterNumber} 章</h3>
                    <span class="status-pill" data-plan-status="${plan.chapterNumber}">${formatChapterStatus(chapterByNumber(project, plan.chapterNumber).status)}</span>
                  </div>
                  <label>章节目标<textarea data-plan-number="${plan.chapterNumber}" data-plan-field="focus" rows="5">${escapeHtml(plan.focus)}</textarea></label>
                  <label>章节钩子<textarea data-plan-number="${plan.chapterNumber}" data-plan-field="hook" rows="3">${escapeHtml(plan.hook)}</textarea></label>
                </article>
              `).join("")}
              <div class="empty-card" style="display:flex; align-items:center; justify-content:center; border: 2px dashed var(--line); border-radius:18px; min-height:100px;">
                <button class="ghost" data-action="add-chapter-to-volume" data-volume-number="${volume.number}">+ 新增章节</button>
              </div>
            </div>
          </div>
        `;
      }).join("")}
    </div>
    
    <div class="actions" style="margin-top:20px; justify-content: center;">
      <button class="secondary" id="add-volume">+ 新增卷</button>
    </div>
  `;
}

function renderLibrary() {
  const project = getCurrentProject();
  if (!project) {
    dom.library.innerHTML = `<div class="empty">暂无项目</div>`;
    return;
  }

  const library = project.library || [];

  dom.library.innerHTML = `
    <article class="editor-card">
      <div class="section-header">
        <h3>资料库 (Reference Library)</h3>
        <div class="actions" style="display: flex; gap: 8px;">
          <input type="text" id="new-category-name" placeholder="新分类名称" style="width:150px; margin-top:0;" />
          <button class="primary" id="add-library-category">新增分类</button>
        </div>
      </div>
      <p class="muted">为本小说维护专属的参考资料体系。资料内容将在 AI 生成时作为背景参考。</p>
    </article>

    <div class="library-container" style="margin-top:16px;">
      ${library.map(category => `
        <article class="editor-card category-card" style="margin-bottom:16px;">
          <div class="section-header">
            <h4>${escapeHtml(category.name)}</h4>
            <div class="actions">
              <button class="ghost" data-delete-category="${category.id}">删除分类</button>
            </div>
          </div>
          <div class="entry-list" style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px;">
            ${category.entries.map((entry, index) => `
              <div class="library-entry" style="padding: 10px; background: var(--paper-strong); border-radius: 8px; border: 1px solid var(--line);">
                <div class="entry-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                  <strong style="font-size: 0.9em; color: var(--accent);">[${entry.type === 'card' ? '卡片' : entry.type === 'link' ? '链接' : '笔记'}] ${escapeHtml(entry.name)}</strong>
                  <button class="ghost-sm" data-delete-entry="${category.id}:${index}" style="padding: 2px 8px; font-size: 0.8em;">删除</button>
                </div>
                <div class="entry-content" style="font-size: 0.9em; line-height: 1.5; color: var(--ink);">
                  ${entry.type === 'link' ? `<a href="${escapeAttr(entry.content)}" target="_blank" style="color: var(--accent);">${escapeHtml(entry.content)}</a>` : `<pre style="white-space: pre-wrap; margin: 0; font-family: inherit;">${escapeHtml(entry.content)}</pre>`}
                </div>
              </div>
            `).join('')}
            ${category.entries.length === 0 ? '<p class="muted">暂无条目</p>' : ''}
          </div>
          <div class="add-entry-form" style="margin-top:16px; padding-top:16px; border-top:1px dashed var(--line);">
             <div class="grid-3">
               <input type="text" data-new-entry-name="${category.id}" placeholder="资料名称" style="margin-top:0;" />
               <select data-new-entry-type="${category.id}" style="margin-top:0;">
                 <option value="card">结构化卡片</option>
                 <option value="note">自由笔记</option>
                 <option value="link">外部引用</option>
               </select>
               <button class="secondary" data-add-entry="${category.id}">添加条目</button>
             </div>
             <textarea data-new-entry-content="${category.id}" rows="2" placeholder="内容、笔记或链接 URL" style="margin-top:8px;"></textarea>
          </div>
        </article>
      `).join('')}
      ${library.length === 0 ? '<div class="empty">暂无分类，请先新增分类。</div>' : ''}
    </div>
  `;
}

function renderChapters() {
  const project = getCurrentProject();
  if (!project) {
    dom.chapters.innerHTML = `<div class="empty">暂无项目</div>`;
    return;
  }

  const chapter = currentChapter(project);
  const chapterActionContext = { projectId: project.id, chapterNumber: chapter.number };
  const checking = isBusy("check-chapter", chapterActionContext);
  const generatingOutline = isBusy("generate-chapter-outline", chapterActionContext);
  const generatingDraft = isBusy("generate-draft", chapterActionContext);
  const savingChapter = isBusy("save-chapter", chapterActionContext);
  const approving = isBusy("approve-chapter", chapterActionContext);
  const canApprove = Boolean(chapter.checkResult?.ok) && !state.pendingAction;
  const volumes = project.volumes || [];

  dom.chapters.innerHTML = `
    <div class="chapter-layout">
      <aside class="chapter-list" style="overflow-y: auto; max-height: calc(100vh - 250px);">
        ${volumes.map(vol => {
          const volChapters = project.chapters.filter(c => c.volumeNumber === vol.number);
          return `
            <div class="volume-group" style="margin-bottom: 16px;">
              <h4 style="font-size: 0.85em; color: var(--muted); margin-bottom: 8px; padding-left: 8px; border-left: 2px solid var(--accent);">${escapeHtml(vol.title)}</h4>
              ${volChapters.map(item => `
                <button class="${item.number === chapter.number ? "active" : ""}" data-chapter-select="${item.number}" style="width:100%; margin-bottom:4px; text-align:left;">
                  <div class="row-between">
                    <strong>${escapeHtml(item.title)}</strong>
                    <span class="status-pill">${formatChapterStatus(item.status)}</span>
                  </div>
                  <p class="muted" style="font-size:0.8em; margin:4px 0 0;">最后更新：${escapeHtml(item.updatedAt)}</p>
                </button>
              `).join("")}
            </div>
          `;
        }).join("")}
        
        <div class="sidebar-actions" style="margin-top: 12px; display: grid; gap: 8px; padding: 8px; border-top: 1px dashed var(--line);">
          <button class="ghost" id="sidebar-add-chapter" style="padding: 8px; font-size: 0.9em;">+ 新增章节</button>
          <button class="ghost" id="sidebar-add-volume" style="padding: 8px; font-size: 0.9em;">+ 新增卷</button>
        </div>
      </aside>
      <section class="chapter-editor">
        <article class="editor-card">
          <div class="chapter-toolbar">
            <h3>${escapeHtml(chapter.title)}</h3>
            <div class="actions">
              <button class="secondary" id="generate-current-outline" ${state.pendingAction ? "disabled" : ""}>${generatingOutline ? (state.countdown !== null ? `生成中 (${state.countdown}s)...` : "生成中...") : "补当前章细纲"}</button>
              <button class="secondary" id="generate-current-draft" ${state.pendingAction ? "disabled" : ""}>${generatingDraft ? (state.countdown !== null ? `生成中 (${state.countdown}s)...` : "生成中...") : "生成当前章草稿"}</button>
              <button class="primary" id="save-current-chapter" ${state.pendingAction ? "disabled" : ""}>${savingChapter ? "保存中..." : "保存当前章"}</button>
            </div>
          </div>

          <label>章节标题<input id="chapter-title" value="${escapeAttr(chapter.title)}" /></label>
          <label>细纲编辑<textarea id="chapter-outline" rows="14">${escapeHtml(chapter.outline)}</textarea></label>
          <label>正文<textarea id="chapter-content" rows="16">${escapeHtml(chapter.content)}</textarea></label>
        </article>
      </section>
      <aside class="chapter-sidebar">
        <article class="check-card">
          <h3>章节元信息</h3>
          <p><strong>状态：</strong>${formatChapterStatus(chapter.status)}</p>
          <p><strong>角色：</strong>${escapeHtml(chapter.characters.join("、") || "未指定")}</p>
          <p><strong>伏笔：</strong>${escapeHtml(chapter.foreshadow.join("、") || "未指定")}</p>
        </article>
        <article class="check-card">
          <div class="section-header">
            <h3>章节检查</h3>
            <button class="ghost" id="check-current-chapter" ${state.pendingAction ? "disabled" : ""}>${checking ? "检查中..." : "执行检查"}</button>
          </div>
          ${
            chapter.checkResult
              ? `
                <p><strong>结果：</strong>${chapter.checkResult.ok ? "通过" : "未通过"}</p>
                <pre>${escapeHtml(chapter.checkResult.messages.join("\n"))}</pre>
              `
              : `<p class="muted">尚未执行检查。</p>`
          }
        </article>
        <article class="check-card">
          <h3>人工批准</h3>
          <p class="muted">批准后章节进入完成状态。</p>
          <button class="primary" id="approve-current-chapter" ${canApprove ? "" : "disabled"}>${approving ? "批准中..." : "批准当前章"}</button>
        </article>
      </aside>
    </div>
  `;
}

function renderReading() {
  const project = getCurrentProject();
  if (!project) {
    dom.reading.innerHTML = `<div class="empty">暂无项目</div>`;
    return;
  }

  const hasContent = project.chapters.some((ch) => ch.content.trim());
  if (!hasContent) {
    dom.reading.innerHTML = `
      <div class="empty">
        <strong>暂无可阅读内容</strong>
        <span>请先在章节工作区生成草稿。</span>
      </div>
    `;
    return;
  }

  const prevBody = dom.reading.querySelector("#reading-body");
  const savedScroll = prevBody ? prevBody.scrollTop : 0;

  dom.reading.innerHTML = `
    <div class="reading-layout">
      <nav class="reading-toc">
        <h3>目录</h3>
        <div class="reading-toc-list">
          ${project.chapters
            .map(
              (ch, i) => `
                <button class="reading-toc-item ${i === 0 ? "active" : ""}" data-reading-target="${ch.number}">
                  <span class="reading-toc-title">${escapeHtml(ch.title)}</span>
                  <span class="reading-toc-status">${formatChapterStatus(ch.status)}</span>
                </button>
              `,
            )
            .join("")}
        </div>
      </nav>
      <div class="reading-body" id="reading-body">
        ${project.chapters
          .map(
            (ch) => `
              <section class="reading-chapter" data-reading-number="${ch.number}">
                <h2 class="reading-chapter-title">${escapeHtml(ch.title)}</h2>
                ${
                  ch.content.trim()
                    ? `<div class="reading-chapter-text">${escapeHtml(ch.content)}</div>`
                    : `<p class="reading-no-content">本章暂无内容</p>`
                }
              </section>
            `,
          )
          .join("")}
      </div>
    </div>
  `;

  const newBody = dom.reading.querySelector("#reading-body");
  if (newBody && savedScroll > 0) {
    newBody.scrollTop = savedScroll;
  }
}

function bindReadingScroll() {
  const body = document.querySelector("#reading-body");
  if (!body) return;

  let ticking = false;

  function updateActiveToc() {
    const chapters = body.querySelectorAll(".reading-chapter");
    const bodyRect = body.getBoundingClientRect();
    let activeNumber = null;

    for (const chapter of chapters) {
      const rect = chapter.getBoundingClientRect();
      if (rect.top - bodyRect.top <= 40) {
        activeNumber = chapter.dataset.readingNumber;
      }
    }

    if (activeNumber) {
      document.querySelectorAll(".reading-toc-item").forEach((item) => {
        item.classList.toggle("active", item.dataset.readingTarget === activeNumber);
      });
    }
  }

  body.addEventListener("scroll", () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        updateActiveToc();
        ticking = false;
      });
      ticking = true;
    }
  });

  document.querySelectorAll(".reading-toc-item").forEach((item) => {
    item.addEventListener("click", () => {
      const number = item.dataset.readingTarget;
      const target = body.querySelector(`[data-reading-number="${number}"]`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}

function renderRecords() {
  const project = getCurrentProject();
  if (!project) {
    dom.records.innerHTML = `<div class="empty">暂无项目</div>`;
    return;
  }

  if (!project.generationRecords.length) {
    dom.records.innerHTML = `<div class="empty">还没有生成记录</div>`;
    return;
  }

  dom.records.innerHTML = project.generationRecords
    .slice()
    .reverse()
    .map(
      (record) => `
        <article class="record-card">
          <div class="row-between">
            <strong>${escapeHtml(record.type)}</strong>
            <span class="badge">${escapeHtml(record.createdAt)}</span>
          </div>
          <p>章节：第 ${record.chapterNumber} 章</p>
          <p>${escapeHtml(record.summary)}</p>
        </article>
      `,
    )
    .join("");
}

function renderPrompts() {
  if (!state.promptConfig) {
    dom.prompts.innerHTML = `<div class="empty">Prompt 配置加载中...</div>`;
    return;
  }

  const items = [
    { key: "full_outline", label: "全书大纲生成" },
    { key: "volume_goal", label: "本卷目标推演" },
    { key: "volume_chapters", label: "本卷章节规划" },
    { key: "chapter_outline", label: "单章细纲生成" },
    { key: "chapter_draft", label: "章节草稿生成" },
  ];

  dom.prompts.innerHTML = `
    <article class="editor-card">
      <div class="section-header">
        <div>
          <h3>Prompt 管理</h3>
          <p class="muted">当前配置文件：${escapeHtml(state.promptStatus?.path || "-")}</p>
        </div>
        <div class="actions">
          <button class="primary" id="save-prompts" ${state.pendingAction ? "disabled" : ""}>${isBusy("save-prompts") ? "保存中..." : "保存 Prompt 配置"}</button>
        </div>
      </div>
      <p class="muted">这里的修改会直接写入当前 prompt 配置文件，后续生成大纲和草稿都会读取这里的模板。</p>
    </article>
    <div class="prompt-grid" style="margin-top:16px;">
      ${items
        .map((item) => {
          const prompt = state.promptConfig[item.key] || {};
          return `
            <article class="editor-card prompt-card">
              <div class="section-header">
                <h3>${item.label}</h3>
                <span class="badge">${escapeHtml(item.key)}</span>
              </div>
              <label>Temperature<input type="number" step="0.1" min="0" max="2" data-prompt-key="${item.key}" data-prompt-field="temperature" value="${escapeAttr(prompt.temperature ?? 0.7)}" /></label>
              <label>System Prompt<textarea data-prompt-key="${item.key}" data-prompt-field="system" rows="6">${escapeHtml(prompt.system || "")}</textarea></label>
              <label>User Prompt<textarea data-prompt-key="${item.key}" data-prompt-field="user" rows="14">${escapeHtml(prompt.user || "")}</textarea></label>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function syncTabs() {
  dom.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === state.activeTab));
  document
    .querySelectorAll(".tab-panel")
    .forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${state.activeTab}`));
}

function bindStaticEvents() {
  dom.createProject.addEventListener("click", async () => {
    const title = dom.newTitle.value.trim();
    const genre = dom.newGenre.value.trim();
    const hook = dom.newHook.value.trim();

    if (!title || !genre || !hook) {
      window.alert("请先填写书名、题材和一句话卖点。");
      return;
    }

    await runAction("create-project", async () => {
      try {
        clearBanner();
        const payload = await apiFetch("/api/projects", {
          method: "POST",
          body: JSON.stringify({ title, genre, hook }),
        });
        dom.newTitle.value = "";
        dom.newGenre.value = "";
        dom.newHook.value = "";
        await refreshProjects(payload.project.id);
      } catch (error) {
        showBanner(error.message);
      }
    });
  });

  dom.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.activeTab = tab.dataset.tab;
      syncTabs();
    });
  });

  dom.deleteProject.addEventListener("click", async () => {
    const project = getCurrentProject();
    if (!project) {
      return;
    }
    const confirmed = window.confirm(`确定删除《${project.title}》吗？此操作不可恢复。`);
    if (!confirmed) {
      return;
    }
    await runAction("delete-project", async () => {
      try {
        clearBanner();
        await deleteProject(project.id);
      } catch (error) {
        showBanner(error.message);
      }
    });
  });
}

function bindDynamicEvents() {
  document.querySelectorAll("[data-project-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedProjectId = button.dataset.projectId;
      state.activeChapterNumber = 1;
      render();
    });
  });

  document.querySelectorAll("[data-tab-target]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tabTarget;
      syncTabs();
    });
  });

  const saveSettings = document.querySelector("#save-settings");
  if (saveSettings) {
    saveSettings.addEventListener("click", async () => {
      const project = cloneProject(getCurrentProject());
      project.title = document.querySelector('[data-field="title"]').value.trim();
      project.genre = document.querySelector('[data-field="genre"]').value.trim();
      project.platform = document.querySelector('[data-field="platform"]').value.trim();
      project.audience = document.querySelector('[data-field="audience"]').value.trim();
      project.hook = document.querySelector('[data-field="hook"]').value.trim();
      project.settings.theme = document.querySelector('[data-field="settings.theme"]').value.trim();
      project.settings.world = document.querySelector('[data-field="settings.world"]').value.trim();
      project.settings.powerSystem = document
        .querySelector('[data-field="settings.powerSystem"]')
        .value.trim();
      project.settings.factions = document
        .querySelector('[data-field="settings.factions"]')
        .value.trim();
      project.characters = project.characters.map((character, index) => ({
        name: document
          .querySelector(`[data-character-index="${index}"][data-character-field="name"]`)
          .value.trim(),
        role: document
          .querySelector(`[data-character-index="${index}"][data-character-field="role"]`)
          .value.trim(),
        goal: document
          .querySelector(`[data-character-index="${index}"][data-character-field="goal"]`)
          .value.trim(),
      }));

      await runAction("save-settings", async () => {
        try {
          clearBanner();
          await saveProject(project);
        } catch (error) {
          showBanner(error.message);
        }
      });
    });
  }

  const addCharacter = document.querySelector("#add-character");
  if (addCharacter) {
    addCharacter.addEventListener("click", async () => {
      const project = cloneProject(getCurrentProject());
      project.characters.push({ name: "新角色", role: "配角", goal: "" });
      await runAction("add-character", async () => {
        try {
          clearBanner();
          await saveProject(project);
        } catch (error) {
          showBanner(error.message);
        }
      });
    });
  }

  const saveOutline = document.querySelector("#save-outline");
  if (saveOutline) {
    saveOutline.addEventListener("click", async () => {
      const project = captureOutlineDraft(getCurrentProject());
      await runAction("save-outline", async () => {
        try {
          clearBanner();
          await saveProject(project);
        } catch (error) {
          showBanner(error.message);
        }
      });
    });
  }

  const generateFullOutline = document.querySelector("#generate-full-outline");
  if (generateFullOutline) {
    generateFullOutline.addEventListener("click", async () => {
      const project = getCurrentProject();
      const confirmed = window.confirm("✨ 确定要生成全书大纲吗？\n\n注意：这将根据您当前的【卖点】和【设定】重新规划全书框架，现有的卷纲和章节计划将被覆盖（已生成的正文将保留，但与新大纲可能不再匹配）。\n\n推演过程约需 1-3 分钟，请稍候。");
      if (!confirmed) return;

      await runAction("generate-full-outline", async () => {
        try {
          clearBanner();
          const currentData = captureOutlineDraft(project);
          await saveProject(currentData);
          await invokeProjectAction(
            project.id,
            `/api/projects/${project.id}/generate-full-outline`,
          );
          showBanner("全书大纲推演完成！");
        } catch (error) {
          showBanner(error.message);
        }
      }, { projectId: project.id });
    });
  }

  // Volume Generate Actions
  document.querySelectorAll('[data-volume-action="generate-goal"]').forEach(btn => {
    btn.addEventListener("click", async () => {
      const project = getCurrentProject();
      const volumeNumber = Number(btn.dataset.volumeNumber);
      await runAction("generate-volume-goal", async () => {
        try {
          clearBanner();
          const currentData = captureOutlineDraft(project);
          await saveProject(currentData);
          await invokeProjectAction(
            project.id,
            `/api/projects/${project.id}/volumes/${volumeNumber}/generate-goal`,
          );
          showBanner(`第 ${volumeNumber} 卷目标生成完成！`);
        } catch (error) {
          showBanner(error.message);
        }
      }, { projectId: project.id, volumeNumber });
    });
  });

  document.querySelectorAll('[data-volume-action="generate-chapters"]').forEach(btn => {
    btn.addEventListener("click", async () => {
      const project = getCurrentProject();
      const volumeNumber = Number(btn.dataset.volumeNumber);
      const confirmed = window.confirm(`✨ 确定要生成第 ${volumeNumber} 卷的章节计划吗？\n\n注意：这将根据本卷目标重新规划章节，该卷原有的章节计划将被覆盖。`);
      if (!confirmed) return;

      await runAction("generate-volume-chapters", async () => {
        try {
          clearBanner();
          const currentData = captureOutlineDraft(project);
          await saveProject(currentData);
          await invokeProjectAction(
            project.id,
            `/api/projects/${project.id}/volumes/${volumeNumber}/generate-chapters`,
          );
          showBanner(`第 ${volumeNumber} 卷章节规划完成！`);
        } catch (error) {
          showBanner(error.message);
        }
      }, { projectId: project.id, volumeNumber });
    });
  });

  const refreshProjectStatus = document.querySelector("#refresh-project-status");
  if (refreshProjectStatus) {
    refreshProjectStatus.addEventListener("click", async () => {
      const project = getCurrentProject();
      if (!project) {
        return;
      }
      await runAction("refresh-project", async () => {
        try {
          clearBanner();
          await refreshProject(project.id);
        } catch (error) {
          showBanner(error.message);
        }
      }, { projectId: project.id });
    });
  }

  const startBookAuto = document.querySelector("#start-book-auto");
  if (startBookAuto) {
      startBookAuto.addEventListener("click", async () => {
      const project = getCurrentProject();
      if (!project) {
        return;
      }
      const startVolume = Number(document.querySelector("#book-auto-start-volume")?.value || 0);
      const endVolume = Number(document.querySelector("#book-auto-end-volume")?.value || 0);
      const skipSystemPassedChapters = Boolean(
        document.querySelector("#book-auto-skip-system-passed")?.checked,
      );
      if (!startVolume || !endVolume) {
        window.alert("请先选择自动推进的卷范围。");
        return;
      }
      if (startVolume > endVolume) {
        window.alert("起始卷不能大于结束卷。");
        return;
      }
      const confirmed = window.confirm("✨ 确定要自动推进全书吗？\n\n系统会依次按卷完成目标设定、章节规划、章节写作、检查与系统审核通过。");
      if (!confirmed) {
        return;
      }
      await runAction("book-auto-start", async () => {
        try {
          clearBanner();
          const currentData = captureOutlineDraft(project);
          await saveProject(currentData);
          await apiFetch(`/api/projects/${project.id}/auto-run/start`, {
            method: "POST",
            body: JSON.stringify({
              startVolumeNumber: startVolume,
              endVolumeNumber: endVolume,
              skipSystemPassedChapters,
            }),
          });
          await refreshProject(project.id);
          showBanner("全书自动推进已启动。");
        } catch (error) {
          showBanner(error.message);
        }
      }, { projectId: project.id });
    });
  }

  document.querySelectorAll("[data-auto-overview-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const project = getCurrentProject();
      const action = button.dataset.autoOverviewAction;
      const scope = button.dataset.runScope;
      const volumeNumber = Number(button.dataset.volumeNumber);
      if (!project || !action || !scope) {
        return;
      }
      await runAction(`auto-${scope}-${action}`, async () => {
        try {
          clearBanner();
          const path =
            scope === "book"
              ? `/api/projects/${project.id}/auto-run/${action}`
              : `/api/projects/${project.id}/volumes/${volumeNumber}/auto-run/${action}`;
          await invokeProjectAction(project.id, path);
          if (scope === "book") {
            showBanner(action === "pause" ? "全书自动推进已暂停。" : "全书自动推进已继续。");
          } else {
            showBanner(action === "pause" ? `第 ${volumeNumber} 卷自动推进已暂停。` : `第 ${volumeNumber} 卷自动推进已继续。`);
          }
        } catch (error) {
          showBanner(error.message);
        }
      }, { projectId: project.id, volumeNumber: scope === "book" ? undefined : volumeNumber });
    });
  });

  document.querySelectorAll("[data-volume-auto]").forEach((button) => {
    button.addEventListener("click", async () => {
      const project = getCurrentProject();
      const volumeNumber = Number(button.dataset.volumeNumber);
      const action = button.dataset.volumeAuto;
      if (!project || !volumeNumber || !action) {
        return;
      }

      if (action === "refresh") {
        await runAction("refresh-project", async () => {
          try {
            clearBanner();
            await refreshProject(project.id);
          } catch (error) {
            showBanner(error.message);
          }
        }, { projectId: project.id });
        return;
      }

      if (action === "start") {
        const confirmed = window.confirm(`✨ 确定要自动推进第 ${volumeNumber} 卷吗？\n\n系统会依次完成卷目标、章节规划、章节写作、检查与系统审核通过。`);
        if (!confirmed) {
          return;
        }
      }

      await runAction(`volume-auto-${action}`, async () => {
        try {
          clearBanner();
          if (action === "start" || action === "resume") {
            const currentData = captureOutlineDraft(project);
            await saveProject(currentData);
          }
          await invokeProjectAction(
            project.id,
            `/api/projects/${project.id}/volumes/${volumeNumber}/auto-run/${action}`,
          );
          const message = {
            start: `第 ${volumeNumber} 卷自动推进已启动。`,
            pause: `第 ${volumeNumber} 卷自动推进已暂停。`,
            resume: `第 ${volumeNumber} 卷自动推进已继续。`,
          }[action] || "自动任务状态已更新。";
          showBanner(message);
        } catch (error) {
          showBanner(error.message);
        }
      }, { projectId: project.id, volumeNumber });
    });
  });

  // Add Volume Listener
  const addVolume = (btn) => {
    btn.addEventListener("click", async () => {
      const project = cloneProject(getCurrentProject());
      project.volumes = project.volumes || [];
      const nextNum = project.volumes.length + 1;
      const titles = {1: "第一卷", 2: "第二卷", 3: "第三卷", 4: "第四卷", 5: "第五卷"};
      project.volumes.push({
        number: nextNum,
        title: titles[nextNum] || `第${nextNum}卷`,
        goal: "",
      });
      await runAction("add-volume", async () => {
        try {
          clearBanner();
          await saveProject(project);
        } catch (error) {
          showBanner(error.message);
        }
      });
    });
  };

  const addVolumeBtn = document.querySelector("#add-volume");
  if (addVolumeBtn) addVolume(addVolumeBtn);
  const sidebarAddVolumeBtn = document.querySelector("#sidebar-add-volume");
  if (sidebarAddVolumeBtn) addVolume(sidebarAddVolumeBtn);

  // Add Chapter Listener
  const addChapter = (btn, volumeNumber) => {
    btn.addEventListener("click", async () => {
      const project = cloneProject(getCurrentProject());
      const maxNum = (project.chapters || []).reduce((max, c) => Math.max(max, c.number), 0);
      const nextNum = maxNum + 1;
      const targetVol = volumeNumber || (project.volumes.length > 0 ? project.volumes[project.volumes.length-1].number : 1);
      
      project.chapters = project.chapters || [];
      project.chapters.push({
        number: nextNum,
        volumeNumber: targetVol,
        title: `第${nextNum}章`,
        outline: "",
        content: "",
        status: "not_started",
        characters: [],
        foreshadow: [],
        updatedAt: new Date().toLocaleString(),
      });
      
      project.outline.chapterPlans = project.outline.chapterPlans || [];
      project.outline.chapterPlans.push({
        chapterNumber: nextNum,
        volumeNumber: targetVol,
        focus: "",
        hook: "",
      });

      await runAction("add-chapter", async () => {
        try {
          clearBanner();
          await saveProject(project);
          state.activeChapterNumber = nextNum;
          state.activeTab = "chapters";
          render();
        } catch (error) {
          showBanner(error.message);
        }
      });
    });
  };

  const sidebarAddChapterBtn = document.querySelector("#sidebar-add-chapter");
  if (sidebarAddChapterBtn) addChapter(sidebarAddChapterBtn);

  document.querySelectorAll('[data-action="add-chapter-to-volume"]').forEach(btn => {
    addChapter(btn, Number(btn.dataset.volumeNumber));
  });

  const savePrompts = document.querySelector("#save-prompts");
  if (savePrompts) {
    savePrompts.addEventListener("click", async () => {
      const nextConfig = structuredClone(state.promptConfig);
      Object.keys(nextConfig).forEach((key) => {
        nextConfig[key].temperature = Number(
          document.querySelector(`[data-prompt-key="${key}"][data-prompt-field="temperature"]`).value,
        );
        nextConfig[key].system = document
          .querySelector(`[data-prompt-key="${key}"][data-prompt-field="system"]`)
          .value;
        nextConfig[key].user = document
          .querySelector(`[data-prompt-key="${key}"][data-prompt-field="user"]`)
          .value;
      });

      await runAction("save-prompts", async () => {
        try {
          clearBanner();
          await savePromptConfig(nextConfig);
          showBanner("Prompt 配置已保存。");
        } catch (error) {
          showBanner(error.message);
        }
      });
    });
  }

  document.querySelectorAll("[data-chapter-select]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeChapterNumber = Number(button.dataset.chapterSelect);
      render();
    });
  });

  const saveCurrentChapter = document.querySelector("#save-current-chapter");
  if (saveCurrentChapter) {
    saveCurrentChapter.addEventListener("click", async () => {
      const project = cloneProject(getCurrentProject());
      const chapterNumber = state.activeChapterNumber;
      const chapter = chapterByNumber(project, chapterNumber);
      chapter.title = document.querySelector("#chapter-title").value.trim();
      chapter.outline = document.querySelector("#chapter-outline").value.trim();
      chapter.content = document.querySelector("#chapter-content").value.trim();
      await runAction("save-chapter", async () => {
        try {
          clearBanner();
          await saveProject(project);
        } catch (error) {
          showBanner(error.message);
        }
      }, { projectId: project.id, chapterNumber });
    });
  }

  const generateCurrentOutline = document.querySelector("#generate-current-outline");
  if (generateCurrentOutline) {
    generateCurrentOutline.addEventListener("click", async () => {
      const project = getCurrentProject();
      const chapterNumber = state.activeChapterNumber;
      await runAction("generate-chapter-outline", async () => {
        try {
          clearBanner();
          await invokeProjectAction(
            project.id,
            `/api/projects/${project.id}/chapters/${chapterNumber}/generate-outline`,
          );
        } catch (error) {
          showBanner(error.message);
        }
      }, { projectId: project.id, chapterNumber });
    });
  }

  const generateCurrentDraft = document.querySelector("#generate-current-draft");
  if (generateCurrentDraft) {
    generateCurrentDraft.addEventListener("click", async () => {
      const project = getCurrentProject();
      const chapterNumber = state.activeChapterNumber;
      const draftProject = cloneProject(project);
      const chapter = chapterByNumber(draftProject, chapterNumber);
      chapter.title = document.querySelector("#chapter-title").value.trim();
      chapter.outline = document.querySelector("#chapter-outline").value.trim();

      await runAction("generate-draft", async () => {
        try {
          clearBanner();
          await saveProject(draftProject);
          await invokeProjectAction(
            project.id,
            `/api/projects/${project.id}/chapters/${chapterNumber}/generate-draft`,
          );
        } catch (error) {
          showBanner(error.message);
        }
      }, { projectId: project.id, chapterNumber });
    });
  }

  const checkCurrentChapter = document.querySelector("#check-current-chapter");
  if (checkCurrentChapter) {
    checkCurrentChapter.addEventListener("click", async () => {
      const project = getCurrentProject();
      const chapterNumber = state.activeChapterNumber;
      const draftProject = cloneProject(project);
      const chapter = chapterByNumber(draftProject, chapterNumber);
      chapter.title = document.querySelector("#chapter-title").value.trim();
      chapter.outline = document.querySelector("#chapter-outline").value.trim();
      chapter.content = document.querySelector("#chapter-content").value.trim();

      await runAction("check-chapter", async () => {
        try {
          clearBanner();
          await saveProject(draftProject);
          await invokeProjectAction(
            project.id,
            `/api/projects/${project.id}/chapters/${chapterNumber}/check`,
          );
        } catch (error) {
          showBanner(error.message);
        }
      }, { projectId: project.id, chapterNumber });
    });
  }

  const approveCurrentChapter = document.querySelector("#approve-current-chapter");
  if (approveCurrentChapter) {
    approveCurrentChapter.addEventListener("click", async () => {
      const project = getCurrentProject();
      const chapterNumber = state.activeChapterNumber;
      await runAction("approve-chapter", async () => {
        try {
          clearBanner();
          await invokeProjectAction(
            project.id,
            `/api/projects/${project.id}/chapters/${chapterNumber}/approve`,
          );
        } catch (error) {
          showBanner(error.message);
        }
      }, { projectId: project.id, chapterNumber });
    });
  }

  // Library Tab Events
  const addLibraryCategory = document.querySelector("#add-library-category");
  if (addLibraryCategory) {
    addLibraryCategory.addEventListener("click", async () => {
      const nameInput = document.querySelector("#new-category-name");
      const name = nameInput.value.trim();
      if (!name) return;
      const project = cloneProject(getCurrentProject());
      project.library = project.library || [];
      project.library.push({ id: Math.random().toString(36).substr(2, 8), name, entries: [] });
      await saveProject(project);
    });
  }

  document.querySelectorAll("[data-delete-category]").forEach(button => {
    button.addEventListener("click", async () => {
      const id = button.dataset.deleteCategory;
      if (!confirm("确定要删除这个分类吗？")) return;
      const project = cloneProject(getCurrentProject());
      project.library = project.library.filter(c => c.id !== id);
      await saveProject(project);
    });
  });

  document.querySelectorAll("[data-add-entry]").forEach(button => {
    button.addEventListener("click", async () => {
      const categoryId = button.dataset.addEntry;
      const name = document.querySelector(`[data-new-entry-name="${categoryId}"]`).value.trim();
      const type = document.querySelector(`[data-new-entry-type="${categoryId}"]`).value;
      const content = document.querySelector(`[data-new-entry-content="${categoryId}"]`).value.trim();
      if (!name || !content) {
        alert("请输入名称和内容");
        return;
      }
      const project = cloneProject(getCurrentProject());
      const category = project.library.find(c => c.id === categoryId);
      if (category) {
        category.entries.push({ name, type, content });
        await saveProject(project);
      }
    });
  });

  document.querySelectorAll("[data-delete-entry]").forEach(button => {
    button.addEventListener("click", async () => {
      const [categoryId, index] = button.dataset.deleteEntry.split(":");
      const project = cloneProject(getCurrentProject());
      const category = project.library.find(c => c.id === categoryId);
      if (category) {
        category.entries.splice(Number(index), 1);
        await saveProject(project);
      }
    });
  });

  bindReadingScroll();
}

async function init() {
  bindStaticEvents();
  syncTabs();
  try {
    const health = await apiFetch("/api/health");
    state.llmStatus = health.llm || null;
    state.promptStatus = health.prompts || null;
    await refreshPrompts();
    await refreshProjects();
  } catch (error) {
    showBanner(`初始化失败：${error.message}`);
  }
}

init();
