const state = {
  projects: [],
  selectedProjectId: null,
  activeTab: "overview",
  activeChapterNumber: 1,
  llmStatus: null,
  promptConfig: null,
  promptStatus: null,
  systemSettings: null,
  systemFeatures: [],
  authorSpace: null,
  authorFeaturesGlobal: [],
  authorReferenceAssetsGlobal: [],
  pendingAction: "",
  pendingContext: null,
  bannerMessage: "",
  countdown: null,
  countdownTimer: null,
  automationPollTimer: null,
  automationPollInFlight: false,
  referenceDrafts: {},
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
  systemSettings: document.querySelector("#tab-system-settings"),
  authorSpace: document.querySelector("#tab-author-space"),
  ideation: document.querySelector("#tab-ideation"),
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
  const { timeoutMs = 0, ...fetchOptions } = options;
  const controller = !fetchOptions.signal && timeoutMs > 0 && typeof AbortController !== "undefined"
    ? new AbortController()
    : null;
  const timeoutId = controller
    ? window.setTimeout(() => controller.abort(), timeoutMs)
    : null;

  let response;
  try {
    response = await fetch(path, {
      headers: {
        "Content-Type": "application/json",
        ...(fetchOptions.headers || {}),
      },
      ...fetchOptions,
      signal: fetchOptions.signal || controller?.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      const seconds = timeoutMs > 0 ? Math.ceil(timeoutMs / 1000) : 0;
      throw new Error(seconds ? `请求超时（>${seconds} 秒）` : "请求已取消");
    }
    throw error;
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }

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

function defaultReferenceDraft() {
  return {
    mode: "project_assisted_analysis",
    role: "parallel",
    sourceType: "local_file",
    sourceTitle: "",
    sourcePath: "",
    sourceText: "",
    sourceLabel: "",
    sourceUrl: "",
    notes: "",
  };
}

function referenceDraftFor(projectId) {
  if (!projectId) {
    return defaultReferenceDraft();
  }
  if (!state.referenceDrafts[projectId]) {
    state.referenceDrafts[projectId] = defaultReferenceDraft();
  }
  return state.referenceDrafts[projectId];
}

function captureReferenceDraft(projectId) {
  const draft = referenceDraftFor(projectId);
  draft.mode = document.querySelector("#reference-mode")?.value || draft.mode;
  draft.role = document.querySelector("#reference-role")?.value || draft.role;
  draft.sourceType = document.querySelector("#reference-source-type")?.value || draft.sourceType;
  draft.sourceTitle = document.querySelector("#reference-title")?.value || "";
  draft.sourceUrl = document.querySelector("#reference-source-url")?.value || "";
  draft.notes = document.querySelector("#reference-notes")?.value || "";
  state.referenceDrafts[projectId] = draft;
  return draft;
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

function kernelOf(project) {
  return (
    project?.kernel || {
      space: null,
      activeConversation: null,
      formalObjects: [],
      candidateObjects: [],
      candidateChangeSets: [],
      memories: [],
      referenceAssets: [],
      authorReferenceAssets: [],
      capabilityFeatures: [],
      authorCapabilityFeatures: [],
      enabledAuthorCapabilityFeatures: [],
      suggestedAuthorCapabilityFeatures: [],
      versions: [],
      summary: {
        formalObjectCount: 0,
        candidateChangeSetCount: 0,
        memoryCount: 0,
        versionCount: 0,
        referenceAssetCount: 0,
        authorReferenceAssetCount: 0,
        featureCount: 0,
        authorFeatureCount: 0,
        enabledAuthorFeatureCount: 0,
        suggestedAuthorFeatureCount: 0,
      },
    }
  );
}

function formatKernelSpaceStatus(status) {
  return {
    ideation: "构思中",
    structuring: "结构化中",
    stabilizing: "稳定中",
    writing_ready: "可进入写作",
  }[status] || "未知";
}

function formatKernelObjectLabel(object) {
  const typeMap = {
    novel_metadata: "小说元信息",
    worldbuilding: "世界设定",
    character_relation: "角色关系",
    story_direction: "故事方向",
  };
  const typeText = typeMap[object?.type] || object?.type || "对象";
  const subtype = object?.subtype ? ` / ${object.subtype}` : "";
  return `${typeText}${subtype}`;
}

function formatReferenceSourceType(sourceType) {
  return {
    local_file: "本地文件",
    url: "全文网址",
  }[sourceType] || sourceType || "未知来源";
}

function normalizedCompareText(value) {
  return String(value || "").replaceAll(/\s+/g, " ").trim();
}

function sameReferenceObject(a, b) {
  return (
    normalizedCompareText(a?.title) === normalizedCompareText(b?.title) &&
    normalizedCompareText(a?.type) === normalizedCompareText(b?.type) &&
    normalizedCompareText(a?.subtype) === normalizedCompareText(b?.subtype) &&
    normalizedCompareText(a?.content?.summary) === normalizedCompareText(b?.content?.summary)
  );
}

function sameReferenceInsight(a, b) {
  return normalizedCompareText(a?.summary) === normalizedCompareText(b?.summary);
}

function renderReferenceInsights(insights) {
  const items = Array.isArray(insights) ? insights : [];
  if (!items.length) {
    return '<p class="muted" style="margin-top:8px;">还没有结构结论。</p>';
  }
  return items
    .map(
      (item) => `
        <article class="record-card" style="margin-top:8px; padding:12px;">
          <strong>${escapeHtml(item.title || "未命名结论")}</strong>
          <div class="muted" style="margin-top:6px; line-height:1.6;">${escapeHtml(item.summary || "-")}</div>
        </article>
      `,
    )
    .join("");
}

function renderReferenceDraftInsights(draftInsights, finalInsights) {
  const draftItems = Array.isArray(draftInsights) ? draftInsights : [];
  if (!draftItems.length) {
    return '<p class="muted" style="margin-top:8px;">还没有 AI 初步结构。</p>';
  }
  return draftItems
    .map((item, index) => {
      const finalItem = Array.isArray(finalInsights) ? finalInsights[index] : null;
      const merged = finalItem ? sameReferenceInsight(item, finalItem) : false;
      return `
        <article class="record-card" style="margin-top:8px; padding:12px;">
          <div class="row-between" style="gap:12px; align-items:flex-start;">
            <span>
              <strong>${escapeHtml(item.title || "未命名初步结论")}</strong>
              ${
                finalItem
                  ? `<div class="muted" style="margin-top:6px;">对应标准块：${escapeHtml(finalItem.title || "-")}</div>`
                  : ""
              }
            </span>
            <span class="chip">${escapeHtml(merged ? "已并入最终结论" : "待人工对比")}</span>
          </div>
          ${
            merged
              ? '<div class="muted" style="margin-top:8px;">这一条的内容已经并入下方标准化结论，不再重复展开。</div>'
              : `<div class="muted" style="margin-top:8px; line-height:1.6;">${escapeHtml(item.summary || "-")}</div>`
          }
        </article>
      `;
    })
    .join("");
}

function renderReferenceRawAnalysis(rawAnalysis) {
  const content = rawAnalysis?.content || "";
  if (!content) {
    return '<p class="muted" style="margin-top:8px;">还没有原始处理结果。</p>';
  }
  if (rawAnalysis?.format === "json") {
    try {
      const parsed = JSON.parse(content);
      if (parsed?.analysisMode === "full_text_chunked" || parsed?.analysisMode === "full_text_sampled") {
        const chunks = Array.isArray(parsed.chunks) ? parsed.chunks : [];
        const sampled = parsed?.analysisMode === "full_text_sampled";
        const chunkRows = chunks.length
          ? chunks
              .map(
                (chunk) => `
                  <div class="record-card" style="margin-top:8px; padding:10px 12px;">
                    <div class="row-between" style="gap:12px;">
                      <strong>第 ${escapeHtml(String(chunk.index || "-"))} 段</strong>
                      <span class="badge">${escapeHtml(`${chunk.start ?? 0}..${chunk.end ?? 0}`)}</span>
                    </div>
                  </div>
                `,
              )
              .join("")
          : '<p class="muted" style="margin-top:8px;">没有可显示的分块信息。</p>';
        return `
          <article class="record-card" style="margin-top:8px; padding:12px;">
            <div class="row-between" style="gap:12px; align-items:flex-start;">
              <span>
                <strong>${sampled ? "全文抽样处理" : "全文分块处理"}</strong>
                <div class="muted" style="margin-top:6px;">总字数：${escapeHtml(String(parsed.totalCharacters || 0))} | 原始分块数：${escapeHtml(String(parsed.chunkCount || chunks.length || 0))} | 实际分析块：${escapeHtml(String(parsed.analyzedChunkCount || chunks.length || 0))}</div>
              </span>
              <span class="chip">${sampled ? "超长文本已抽样" : "仅展示处理链路"}</span>
            </div>
          </article>
          <div style="margin-top:12px;">
            <strong>最终汇总原始输出</strong>
            <article class="record-card" style="margin-top:8px; padding:12px;">
              <pre style="white-space:pre-wrap; margin:0; max-height:520px; overflow:auto; line-height:1.7; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;">${escapeHtml(parsed.aggregateRaw || "")}</pre>
            </article>
          </div>
          <div style="margin-top:12px;">
            <strong>分块执行记录</strong>
            ${chunkRows}
          </div>
        `;
      }
    } catch {
      // fallback to raw text block below
    }
  }
  return `
    <article class="record-card" style="margin-top:8px; padding:12px;">
      <pre style="white-space:pre-wrap; margin:0; max-height:520px; overflow:auto; line-height:1.7; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;">${escapeHtml(content)}</pre>
    </article>
  `;
}

function renderReferenceReusableObjects(objects, objectMap, showStatus = true) {
  const items = Array.isArray(objects) ? objects : [];
  if (!items.length) {
    return '<p class="muted" style="margin-top:8px;">还没有可复用对象。</p>';
  }
  return items
    .map((item) => {
      const linkedObject = objectMap.get(item.id || "");
      const objectStatus = linkedObject?.status === "formal"
        ? "已进入正式层"
        : linkedObject?.status === "candidate"
          ? "已进入候选区"
          : "尚未挂接";
      return `
        <article class="record-card" style="margin-top:8px; padding:12px;">
          <div class="row-between" style="gap:12px;">
            <strong>${escapeHtml(item.title || "未命名对象")}</strong>
            <span class="badge">${escapeHtml(formatKernelObjectLabel(item))}</span>
          </div>
          <div style="margin-top:6px; line-height:1.6;">${escapeHtml(item.content?.summary || "-")}</div>
          ${
            showStatus
              ? `<div class="muted" style="margin-top:8px;">当前状态：${escapeHtml(objectStatus)}</div>`
              : ""
          }
        </article>
      `;
    })
    .join("");
}

function renderReferenceDraftReusableObjects(draftObjects, finalObjects) {
  const items = Array.isArray(draftObjects) ? draftObjects : [];
  if (!items.length) {
    return '<p class="muted" style="margin-top:8px;">还没有 AI 初步对象。</p>';
  }
  const finalItems = Array.isArray(finalObjects) ? finalObjects : [];
  const allMerged = items.every((item) => finalItems.some((finalItem) => sameReferenceObject(item, finalItem)));
  if (allMerged) {
    return '<p class="muted" style="margin-top:8px;">AI 初步对象已全部并入下方最终对象，这里不再重复展开。</p>';
  }
  return renderReferenceReusableObjects(items, new Map(), false);
}

function renderReferenceProcessPanel(asset) {
  if (!asset) {
    return '<div class="empty" style="margin-top:12px;">还没有可查看的拆解过程。先提交一次参考作品拆解。</div>';
  }
  const draftAnalysis = asset.draftAnalysis || {};
  const draftInsights = draftAnalysis.insights || [];
  const draftReusableObjects = draftAnalysis.reusableObjects || [];
  const insights = asset.insights || [];
  const reusableObjects = asset.reusableObjects || [];
  return `
    <div class="row-between" style="gap:12px; align-items:flex-start; margin-top:12px;">
      <span>
        <strong>${escapeHtml(asset.sourceWork?.title || "未命名参考作品")}</strong>
        <div class="muted" style="margin-top:6px;">来源：${escapeHtml(formatReferenceSourceType(asset.sourceWork?.sourceType))} | ${escapeHtml(asset.sourceWork?.sourceLabel || "-")}</div>
      </span>
      <span class="badge">${escapeHtml(asset.mode)}</span>
    </div>
    <div class="muted" style="margin-top:10px; line-height:1.7;">${escapeHtml(asset.summary || "-")}</div>

    <div class="section-header" style="margin-top:16px;">
      <h3>原始 AI 处理结果</h3>
      <span class="badge">${escapeHtml(asset.rawAnalysis?.format || "text")}</span>
    </div>
    ${renderReferenceRawAnalysis(asset.rawAnalysis)}

    <div class="section-header" style="margin-top:16px;">
      <h3>AI 初步结构</h3>
      <span class="badge">${escapeHtml(String(draftInsights.length))} / ${escapeHtml(String(draftReusableObjects.length))}</span>
    </div>
    <div class="muted" style="margin-top:8px;">${escapeHtml(draftAnalysis.summary || asset.summary || "-")}</div>
    ${renderReferenceDraftInsights(draftInsights, insights)}

    <div class="section-header" style="margin-top:12px;">
      <h3>AI 初步对象</h3>
      <span class="badge">${escapeHtml(String(draftReusableObjects.length))}</span>
    </div>
    ${renderReferenceDraftReusableObjects(draftReusableObjects, reusableObjects)}
  `;
}

function renderReferenceResultPanel(asset, objectMap) {
  if (!asset) {
    return '<div class="empty" style="margin-top:12px;">还没有拆解结论。先完成一次参考作品拆解。</div>';
  }
  const reusableObjects = asset.reusableObjects || [];
  const insights = asset.insights || [];
  return `
    <div class="row-between" style="gap:12px; align-items:flex-start; margin-top:12px;">
      <span>
        <strong>${escapeHtml(asset.sourceWork?.title || "未命名参考作品")}</strong>
        <div class="muted" style="margin-top:6px;">这里展示的是结合当前标准框架后的最终结论，可直接拿来判断是否吸收。</div>
      </span>
      <span class="chip">最终结果</span>
    </div>

    <div class="section-header" style="margin-top:16px;">
      <h3>结构化结论</h3>
      <span class="badge">${escapeHtml(String(insights.length))}</span>
    </div>
    ${renderReferenceInsights(insights)}

    <div class="section-header" style="margin-top:16px;">
      <h3>可复用对象</h3>
      <span class="badge">${escapeHtml(String(reusableObjects.length))}</span>
    </div>
    ${renderReferenceReusableObjects(reusableObjects, objectMap)}
  `;
}

function renderReferenceAssetCard(asset, objectMap, compact = false) {
  const reusableObjects = asset.reusableObjects || [];
  const insights = asset.insights || [];
  if (compact) {
    return `
      <article class="record-card" style="margin-top:12px;">
        <div class="row-between" style="gap:12px;">
          <strong>${escapeHtml(asset.sourceWork?.title || "未命名参考作品")}</strong>
          <span class="chip">${escapeHtml(formatReferenceSourceType(asset.sourceWork?.sourceType))}</span>
        </div>
        <div class="muted" style="margin-top:6px;">${escapeHtml(asset.summary || "-")}</div>
        <div class="muted" style="margin-top:8px;">结构结论 ${escapeHtml(String(insights.length))} 条 | 可复用对象 ${escapeHtml(String(reusableObjects.length))} 项</div>
      </article>
    `;
  }
  return renderReferenceResultPanel(asset, objectMap);
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

function defaultSystemSettings() {
  return {
    models: [],
    taskRouting: {
      free_ideation: { primaryModelId: "", fallbackModelId: "" },
      reference_chunk_analysis: { primaryModelId: "", fallbackModelId: "" },
      reference_aggregate_analysis: { primaryModelId: "", fallbackModelId: "" },
      chapter_generation: { primaryModelId: "", fallbackModelId: "" },
      quality_check: { primaryModelId: "", fallbackModelId: "" },
      format_repair: { primaryModelId: "", fallbackModelId: "" },
    },
    execution: {
      timeoutSeconds: 300,
      retryCount: 1,
      chunkSize: 12000,
      chunkOverlap: 600,
      aggregateGroupSize: 8,
      enableFormatRepairFallback: true,
    },
  };
}

function defaultAuthorSpace() {
  return {
    profile: { penName: "", displayName: "", bio: "" },
    contacts: { email: "", wechat: "", phone: "", other: "" },
    publishing: { platforms: "", homepage: "", writingGoals: "", currentStage: "" },
    styleNotes: {
      styleTraits: "",
      languagePreference: "",
      pacePreference: "",
      characterPreference: "",
      worldPreference: "",
      conflictPreference: "",
      avoidance: "",
      otherNotes: "",
    },
  };
}

function createLmStudioSystemModel() {
  return {
    id: `model-${Date.now()}`,
    name: "",
    provider: "lm-studio",
    baseUrl: "http://127.0.0.1:1234/v1",
    apiKeyRef: "LMSTUDIO_API_KEY",
    enabled: true,
    usageTags: [],
    notes: "本地 LM Studio 的 OpenAI 兼容接口。默认地址是 http://127.0.0.1:1234/v1，通常可不填 API Key。",
  };
}

async function refreshSystemSettings() {
  const payload = await apiFetch("/api/system-settings");
  state.systemSettings = payload.systemSettings || defaultSystemSettings();
  state.systemFeatures = payload.systemFeatures || [];
}

async function saveSystemSettings(config) {
  const payload = await apiFetch("/api/system-settings", {
    method: "PUT",
    body: JSON.stringify(config),
  });
  state.systemSettings = payload.systemSettings || defaultSystemSettings();
  state.systemFeatures = payload.systemFeatures || [];
  render();
}

async function refreshAuthorSpace() {
  const payload = await apiFetch("/api/author-space");
  state.authorSpace = payload.authorSpace || defaultAuthorSpace();
  state.authorFeaturesGlobal = payload.authorFeatures || [];
  state.authorReferenceAssetsGlobal = payload.authorReferenceAssets || [];
}

async function saveAuthorSpace(config) {
  const payload = await apiFetch("/api/author-space", {
    method: "PUT",
    body: JSON.stringify(config),
  });
  state.authorSpace = payload.authorSpace || defaultAuthorSpace();
  state.authorFeaturesGlobal = payload.authorFeatures || [];
  state.authorReferenceAssetsGlobal = payload.authorReferenceAssets || [];
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

function setPending(action, context = null, options = {}) {
  state.pendingAction = action;
  state.pendingContext = context;
  if (options.render !== false) {
    render();
  }
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

function projectReferenceAnalysis(project) {
  return project?.referenceAnalysis || { runStatus: "idle", currentRun: null };
}

function hasActiveReferenceAnalysis(project) {
  return projectReferenceAnalysis(project).runStatus === "running";
}

function formatReferenceAnalysisStatus(project) {
  const analysis = projectReferenceAnalysis(project);
  const currentRun = analysis.currentRun || {};
  if (analysis.runStatus === "running") {
    const analyzed = Number(currentRun.analyzedChunkCount || 0);
    const completed = Number(currentRun.completedChunks || 0);
    if (analyzed > 0) {
      const phaseLabel = currentRun.phase === "aggregate" ? "汇总中" : "拆解中";
      return `${phaseLabel} ${completed}/${analyzed}`;
    }
    return currentRun.message || "排队中";
  }
  if (analysis.runStatus === "completed") {
    return "分析完成";
  }
  if (analysis.runStatus === "failed") {
    return "分析失败";
  }
  return "待命";
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

async function runAction(action, task, context = null, options = {}) {
  if (state.pendingAction) {
    return;
  }

  const shouldTrackCountdown = action.startsWith("generate-");
  if (shouldTrackCountdown) {
    state.countdown = state.llmStatus?.timeout || 300;
  }
  setPending(action, context, { render: options.renderOnStart !== false });

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

function hasActiveBackgroundWork(project) {
  return hasActiveAutomation(project) || hasActiveReferenceAnalysis(project);
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
    render();
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
  if (!project || !hasActiveBackgroundWork(project)) {
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
  renderSystemSettings();
  renderAuthorSpace();
  renderIdeation();
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

function systemTaskLabel(taskKey) {
  return {
    free_ideation: "自由构思",
    reference_chunk_analysis: "拆书分块",
    reference_aggregate_analysis: "拆书汇总",
    chapter_generation: "章节生成",
    quality_check: "检查校验",
    format_repair: "格式修复",
  }[taskKey] || taskKey;
}

function renderModelOptions(models, selectedValue) {
  return ['<option value="">未设置</option>']
    .concat(
      (models || []).map(
        (model) => `
          <option value="${escapeAttr(model.id)}" ${model.id === selectedValue ? "selected" : ""}>
            ${escapeHtml(model.name || model.id)}
          </option>
        `,
      ),
    )
    .join("");
}

function renderSystemSettings() {
  const config = state.systemSettings || defaultSystemSettings();
  const models = config.models || [];
  const systemFeatures = state.systemFeatures || [];
  const taskRouting = config.taskRouting || {};

  dom.systemSettings.innerHTML = `
    <article class="editor-card">
      <div class="section-header">
        <div>
          <h3>系统设置</h3>
          <p class="muted">这里保存全局模型配置和任务路由。当前实际执行链路支持通过 \`AI_NOVEL_*\` 或 \`LMSTUDIO_*\` 环境变量接入模型。</p>
        </div>
        <button class="primary" id="save-system-settings" ${state.pendingAction ? "disabled" : ""}>保存系统设置</button>
      </div>
    </article>

    <div class="grid-2" style="margin-top:16px;">
      <article class="editor-card">
        <div class="section-header">
          <h3>系统级能力</h3>
          <span class="badge">${escapeHtml(String(systemFeatures.length))}</span>
        </div>
        ${
          systemFeatures.length
            ? systemFeatures
                .map(
                  (feature) => `
                    <article class="record-card" style="margin-top:12px;">
                      <div class="row-between" style="align-items:flex-start; gap:12px;">
                        <span>
                          <strong>${escapeHtml(feature.name)}</strong>
                          <div class="muted" style="margin-top:6px;">${escapeHtml(feature.description || "-")}</div>
                        </span>
                        <span class="chip">${escapeHtml(feature.status || "system_active")}</span>
                      </div>
                    </article>
                  `,
                )
                .join("")
            : '<p class="muted" style="margin-top:12px;">还没有系统级能力。</p>'
        }
      </article>

      <article class="editor-card">
        <div class="section-header">
          <h3>执行参数</h3>
          <span class="badge">全局</span>
        </div>
        <div class="grid-3" style="margin-top:12px;">
          <label>超时（秒）
            <input id="system-timeout-seconds" type="number" min="1" value="${escapeAttr(String(config.execution?.timeoutSeconds ?? 300))}" />
          </label>
          <label>重试次数
            <input id="system-retry-count" type="number" min="0" value="${escapeAttr(String(config.execution?.retryCount ?? 1))}" />
          </label>
          <label>分块大小
            <input id="system-chunk-size" type="number" min="1000" value="${escapeAttr(String(config.execution?.chunkSize ?? 12000))}" />
          </label>
          <label>分块重叠
            <input id="system-chunk-overlap" type="number" min="0" value="${escapeAttr(String(config.execution?.chunkOverlap ?? 600))}" />
          </label>
          <label>汇总分组大小
            <input id="system-aggregate-group-size" type="number" min="1" value="${escapeAttr(String(config.execution?.aggregateGroupSize ?? 8))}" />
          </label>
          <label class="overview-checkbox-field">
            <input id="system-enable-format-repair-fallback" type="checkbox" ${(config.execution?.enableFormatRepairFallback ?? true) ? "checked" : ""} />
            <span>开启格式修复兜底</span>
          </label>
        </div>
      </article>
    </div>

    <article class="editor-card" style="margin-top:16px;">
      <div class="section-header">
        <h3>模型列表</h3>
        <div class="actions">
          <button class="secondary" id="add-lmstudio-model" ${state.pendingAction ? "disabled" : ""}>添加 LM Studio</button>
          <button class="secondary" id="add-system-model" ${state.pendingAction ? "disabled" : ""}>新增模型</button>
        </div>
      </div>
      ${
        models.length
          ? models
              .map(
                (model, index) => `
                  <article class="record-card" style="margin-top:12px;">
                    <div class="grid-3">
                      <label>模型名称
                        <input data-system-model-field="${index}:name" value="${escapeAttr(model.name || "")}" placeholder="例如：deepseek-chat" />
                      </label>
                      <label>提供方
                        <input data-system-model-field="${index}:provider" value="${escapeAttr(model.provider || "")}" placeholder="例如：deepseek / lm-studio" />
                      </label>
                      <label>配置标识
                        <input data-system-model-field="${index}:apiKeyRef" value="${escapeAttr(model.apiKeyRef || "")}" placeholder="例如：DEEPSEEK_API_KEY / LMSTUDIO_API_KEY" />
                      </label>
                    </div>
                    <div class="grid-2" style="margin-top:12px;">
                      <label>Base URL
                        <input data-system-model-field="${index}:baseUrl" value="${escapeAttr(model.baseUrl || "")}" placeholder="例如：https://api.deepseek.com / http://127.0.0.1:1234/v1" />
                      </label>
                      <label>用途标签
                        <input data-system-model-field="${index}:usageTags" value="${escapeAttr((model.usageTags || []).join(", "))}" placeholder="例如：自由构思, 拆书分块" />
                      </label>
                    </div>
                    <div class="grid-2" style="margin-top:12px;">
                      <label>备注
                        <textarea data-system-model-field="${index}:notes" rows="2" placeholder="模型说明或限制">${escapeHtml(model.notes || "")}</textarea>
                      </label>
                      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
                        <label class="overview-checkbox-field">
                          <input data-system-model-field="${index}:enabled" type="checkbox" ${model.enabled ? "checked" : ""} />
                          <span>启用</span>
                        </label>
                        <button class="ghost" data-remove-system-model="${index}" ${state.pendingAction ? "disabled" : ""}>删除模型</button>
                      </div>
                    </div>
                  </article>
                `,
              )
              .join("")
          : '<p class="muted" style="margin-top:12px;">还没有配置任何模型。</p>'
      }
    </article>

    <article class="editor-card" style="margin-top:16px;">
      <div class="section-header">
        <h3>任务路由</h3>
        <span class="badge">先只保存</span>
      </div>
      <div class="stack" style="margin-top:12px;">
        ${Object.keys(defaultSystemSettings().taskRouting)
          .map((taskKey) => {
            const current = taskRouting[taskKey] || { primaryModelId: "", fallbackModelId: "" };
            return `
              <div class="grid-3" style="align-items:end; margin-top:12px;">
                <div>
                  <strong>${escapeHtml(systemTaskLabel(taskKey))}</strong>
                  <div class="muted" style="margin-top:6px;">主模型 / 备用模型</div>
                </div>
                <label>主模型
                  <select data-system-routing="${taskKey}:primaryModelId">${renderModelOptions(models, current.primaryModelId)}</select>
                </label>
                <label>备用模型
                  <select data-system-routing="${taskKey}:fallbackModelId">${renderModelOptions(models, current.fallbackModelId)}</select>
                </label>
              </div>
            `;
          })
          .join("")}
      </div>
    </article>
  `;
}

function renderAuthorSpace() {
  const config = state.authorSpace || defaultAuthorSpace();
  const authorFeatures = state.authorFeaturesGlobal || [];
  const authorAssets = state.authorReferenceAssetsGlobal || [];
  dom.authorSpace.innerHTML = `
    <article class="editor-card">
      <div class="section-header">
        <div>
          <h3>作者空间</h3>
          <p class="muted">这里只保存作者长期资料。联系方式只保存，不进入模型上下文。</p>
        </div>
        <button class="primary" id="save-author-space" ${state.pendingAction ? "disabled" : ""}>保存作者空间</button>
      </div>
    </article>

    <div class="grid-2" style="margin-top:16px;">
      <article class="editor-card">
        <div class="section-header">
          <h3>作者身份</h3>
          <span class="badge">基础</span>
        </div>
        <label>笔名
          <input id="author-pen-name" value="${escapeAttr(config.profile?.penName || "")}" placeholder="例如：辰东" />
        </label>
        <label>显示名 / 备注名
          <input id="author-display-name" value="${escapeAttr(config.profile?.displayName || "")}" placeholder="例如：主作者A" />
        </label>
        <label>作者简介
          <textarea id="author-bio" rows="4" placeholder="作者长期简介">${escapeHtml(config.profile?.bio || "")}</textarea>
        </label>
      </article>

      <article class="editor-card">
        <div class="section-header">
          <h3>联系方式与平台</h3>
          <span class="badge">仅保存</span>
        </div>
        <div class="grid-2">
          <label>邮箱
            <input id="author-email" value="${escapeAttr(config.contacts?.email || "")}" />
          </label>
          <label>微信
            <input id="author-wechat" value="${escapeAttr(config.contacts?.wechat || "")}" />
          </label>
          <label>手机号
            <input id="author-phone" value="${escapeAttr(config.contacts?.phone || "")}" />
          </label>
          <label>其他联系方式
            <input id="author-contact-other" value="${escapeAttr(config.contacts?.other || "")}" />
          </label>
        </div>
        <label style="margin-top:12px;">常用发布平台
          <input id="author-platforms" value="${escapeAttr(config.publishing?.platforms || "")}" placeholder="例如：起点中文网, 微信读书" />
        </label>
        <label>主页或链接
          <input id="author-homepage" value="${escapeAttr(config.publishing?.homepage || "")}" />
        </label>
        <label>写作目标
          <textarea id="author-writing-goals" rows="3">${escapeHtml(config.publishing?.writingGoals || "")}</textarea>
        </label>
        <label>当前阶段说明
          <textarea id="author-current-stage" rows="3">${escapeHtml(config.publishing?.currentStage || "")}</textarea>
        </label>
      </article>
    </div>

    <div class="grid-2" style="margin-top:16px;">
      <article class="editor-card">
        <div class="section-header">
          <h3>长期写作风格</h3>
          <span class="badge">自由文本</span>
        </div>
        <label>风格特点
          <textarea id="author-style-traits" rows="3">${escapeHtml(config.styleNotes?.styleTraits || "")}</textarea>
        </label>
        <label>语言偏好
          <textarea id="author-language-preference" rows="3">${escapeHtml(config.styleNotes?.languagePreference || "")}</textarea>
        </label>
        <label>节奏偏好
          <textarea id="author-pace-preference" rows="3">${escapeHtml(config.styleNotes?.pacePreference || "")}</textarea>
        </label>
        <label>人物塑造偏好
          <textarea id="author-character-preference" rows="3">${escapeHtml(config.styleNotes?.characterPreference || "")}</textarea>
        </label>
        <label>世界观偏好
          <textarea id="author-world-preference" rows="3">${escapeHtml(config.styleNotes?.worldPreference || "")}</textarea>
        </label>
        <label>冲突组织偏好
          <textarea id="author-conflict-preference" rows="3">${escapeHtml(config.styleNotes?.conflictPreference || "")}</textarea>
        </label>
        <label>避讳表达
          <textarea id="author-avoidance" rows="3">${escapeHtml(config.styleNotes?.avoidance || "")}</textarea>
        </label>
        <label>其他备注
          <textarea id="author-other-notes" rows="3">${escapeHtml(config.styleNotes?.otherNotes || "")}</textarea>
        </label>
      </article>

      <article class="editor-card">
        <div class="section-header">
          <h3>作者层沉淀</h3>
          <span class="badge">${escapeHtml(String(authorFeatures.length))} / ${escapeHtml(String(authorAssets.length))}</span>
        </div>
        <div class="section-header" style="margin-top:16px;">
          <h3>作者特性库</h3>
          <span class="badge">${escapeHtml(String(authorFeatures.length))}</span>
        </div>
        ${
          authorFeatures.length
            ? authorFeatures
                .slice()
                .reverse()
                .slice(0, 8)
                .map(
                  (feature) => `
                    <div class="row-between" style="margin-top:10px; align-items:flex-start;">
                      <span>
                        <strong>${escapeHtml(feature.name)}</strong>
                        <div class="muted" style="margin-top:6px;">${escapeHtml(feature.description || "-")}</div>
                      </span>
                      <span class="chip">${escapeHtml(feature.status || "-")}</span>
                    </div>
                  `,
                )
                .join("")
            : '<p class="muted" style="margin-top:12px;">还没有沉淀作者特性。</p>'
        }

        <div class="section-header" style="margin-top:20px;">
          <h3>作者通用参考资产</h3>
          <span class="badge">${escapeHtml(String(authorAssets.length))}</span>
        </div>
        ${
          authorAssets.length
            ? authorAssets
                .slice()
                .reverse()
                .slice(0, 6)
                .map(
                  (asset) => `
                    <article class="record-card" style="margin-top:12px;">
                      <strong>${escapeHtml(asset.sourceWork?.title || "未命名参考作品")}</strong>
                      <div class="muted" style="margin-top:6px;">${escapeHtml(asset.summary || "-")}</div>
                    </article>
                  `,
                )
                .join("")
            : '<p class="muted" style="margin-top:12px;">还没有作者通用参考资产。</p>'
        }
      </article>
    </div>
  `;
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

function renderIdeation() {
  const project = getCurrentProject();
  if (!project) {
    dom.ideation.innerHTML = `<div class="empty">暂无项目</div>`;
    return;
  }

  const kernel = kernelOf(project);
  const allObjectsById = new Map(
    [...(kernel.candidateObjects || []), ...(kernel.formalObjects || [])].map((object) => [object.id, object]),
  );
  const candidateObjectsById = new Map(
    (kernel.candidateObjects || []).map((object) => [object.id, object]),
  );
  const formalObjects = kernel.formalObjects || [];
  const candidateChangeSets = kernel.candidateChangeSets || [];
  const memories = kernel.memories || [];
  const versions = kernel.versions || [];
  const referenceAssets = kernel.referenceAssets || [];
  const authorReferenceAssets = kernel.authorReferenceAssets || [];
  const features = kernel.capabilityFeatures || [];
  const authorFeatures = kernel.authorCapabilityFeatures || [];
  const enabledAuthorFeatures = kernel.enabledAuthorCapabilityFeatures || [];
  const suggestedAuthorFeatures = kernel.suggestedAuthorCapabilityFeatures || [];
  const summary = kernel.summary || {};
  const messages = kernel.activeConversation?.messages || [];
  const latestReferenceAsset = referenceAssets.length ? referenceAssets[referenceAssets.length - 1] : null;
  const referenceDraft = referenceDraftFor(project.id);
  const referenceAnalysis = projectReferenceAnalysis(project);
  const referenceAnalysisRunning = hasActiveReferenceAnalysis(project);
  const referenceStatus = formatReferenceAnalysisStatus(project);
  const referenceRun = referenceAnalysis.currentRun || {};

  dom.ideation.innerHTML = `
    <div class="overview-grid">
      <article class="info-card">
        <span class="eyebrow">小说空间</span>
        <strong>${escapeHtml(formatKernelSpaceStatus(kernel.space?.status))}</strong>
        <p>${escapeHtml(kernel.space?.id || "-")}</p>
      </article>
      <article class="info-card">
        <span class="eyebrow">已确认设定</span>
        <strong>${escapeHtml(String(summary.formalObjectCount || 0))}</strong>
        <p>已进入正式层的结构化对象数量。</p>
      </article>
      <article class="info-card">
        <span class="eyebrow">待确认内容</span>
        <strong>${escapeHtml(String(summary.candidateChangeSetCount || 0))}</strong>
        <p>自由对话提炼出的待确认内容。</p>
      </article>
      <article class="info-card">
        <span class="eyebrow">记忆 / 版本</span>
        <strong>${escapeHtml(String(summary.memoryCount || 0))} / ${escapeHtml(String(summary.versionCount || 0))}</strong>
        <p>确认后的记忆沉淀与版本快照。</p>
      </article>
      <article class="info-card">
        <span class="eyebrow">拆书资产</span>
        <strong>${escapeHtml(String(summary.referenceAssetCount || 0))} / ${escapeHtml(String(summary.authorReferenceAssetCount || 0))}</strong>
        <p>当前小说 / 作者级参考资产数量。</p>
      </article>
    </div>

    <article class="editor-card" style="margin-top:16px;">
      <div class="section-header">
        <div>
          <h3>自由构思对话</h3>
          <p class="muted">这里应该像和 agent 聊天。你直接说想法、感觉、参考书、犹豫点，我在后台持续提炼候选对象。</p>
        </div>
        <span class="badge">${escapeHtml(String(messages.length))} 条消息</span>
      </div>
      <div id="ideation-chat-log" style="display:flex; flex-direction:column; gap:12px; margin-top:12px; max-height:420px; overflow:auto; padding-right:4px;">
        ${
          messages.length
            ? messages
                .map((message) => {
                  const meta = message.meta || {};
                  const suggestions = Array.isArray(meta.suggestions) ? meta.suggestions : [];
                  const gaps = Array.isArray(meta.gaps) ? meta.gaps : [];
                  const isAssistant = message.role !== "user";
                  const suggestionsBlock =
                    isAssistant && suggestions.length
                      ? `<div style="margin-top:12px;">
                          <div class="eyebrow" style="margin-bottom:6px;">下一步建议</div>
                          <div style="display:flex; flex-wrap:wrap; gap:6px;">
                            ${suggestions
                              .map(
                                (item) => `
                                  <button class="secondary" type="button" data-ideation-suggestion="${escapeAttr(item.prompt || "")}" title="${escapeAttr(item.prompt || "")}" style="padding:6px 12px; font-size:12px;">${escapeHtml(item.title || "继续推进")}</button>
                                `,
                              )
                              .join("")}
                          </div>
                        </div>`
                      : "";
                  const gapsBlock =
                    isAssistant && gaps.length
                      ? `<div style="margin-top:12px;">
                          <div class="eyebrow" style="margin-bottom:6px;">缺口提醒</div>
                          <ul style="margin:0; padding-left:18px; line-height:1.6;">
                            ${gaps
                              .map(
                                (item) => `
                                  <li><strong>${escapeHtml(item.title || "待补缺口")}</strong>${
                                    item.detail ? `：${escapeHtml(item.detail)}` : ""
                                  }</li>
                                `,
                              )
                              .join("")}
                          </ul>
                        </div>`
                      : "";
                  return `
                    <article class="record-card" style="margin-top:0; align-self:${message.role === "user" ? "flex-end" : "stretch"}; background:${message.role === "user" ? "rgba(91, 140, 255, 0.08)" : "rgba(255,255,255,0.03)"}; border-color:${message.role === "user" ? "rgba(91, 140, 255, 0.25)" : "rgba(255,255,255,0.08)"};">
                      <div class="row-between" style="gap:12px;">
                        <strong>${escapeHtml(message.role === "user" ? "你" : "构思助手")}</strong>
                        <span class="badge">${escapeHtml(message.createdAt || "-")}</span>
                      </div>
                      <div style="white-space:pre-wrap; margin-top:10px; line-height:1.7;">${escapeHtml(message.content || "")}</div>
                      ${suggestionsBlock}
                      ${gapsBlock}
                    </article>
                  `;
                })
                .join("")
            : '<div class="empty">还没有开始对话。直接输入一段模糊想法就行。</div>'
        }
      </div>
      <div style="margin-top:16px;">
        <label>
          继续对话
          <textarea id="ideation-chat-input" rows="4" placeholder="例如：我想写一个慢热的古代志怪悬疑，主角是会验尸的边缘小吏，整体气质偏冷，不想走爽文节奏。参考《大宋提刑官》的职业切口和一些志怪氛围，但不想做纯探案单元剧。"></textarea>
        </label>
        <div class="actions" style="margin-top:12px; justify-content:flex-end;">
          <button class="primary" id="send-ideation-chat" ${state.pendingAction ? "disabled" : ""}>${isBusy("kernel-chat", { projectId: project.id }) ? "发送中..." : "发送"}</button>
        </div>
      </div>
    </article>

    <article class="editor-card" style="margin-top:16px;">
      <div class="section-header">
        <div>
          <h3>参考作品拆解</h3>
          <p class="muted">这是一个独立输入板块。先定义来源和拆解意图，再单独查看下面的过程与结果。</p>
          <p class="muted">拆解输入主体应该是本地全文文件或可读取全文的网址。作品名只是可选标签。</p>
          ${
            referenceAnalysisRunning
              ? `<p class="muted">${escapeHtml(referenceRun.message || "后台处理中...")}</p>`
              : ""
          }
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="badge" id="reference-analyze-status">${escapeHtml(referenceStatus)}</span>
          <button type="button" class="secondary" id="analyze-reference-asset" ${(state.pendingAction || referenceAnalysisRunning) ? "disabled" : ""}>${referenceAnalysisRunning ? "分析中..." : "分析参考作品"}</button>
        </div>
      </div>
      <div class="grid-3" style="margin-top:12px;">
        <label>模式
          <select id="reference-mode">
            <option value="project_assisted_analysis" ${referenceDraft.mode === "project_assisted_analysis" ? "selected" : ""}>开书辅助</option>
            <option value="independent_analysis" ${referenceDraft.mode === "independent_analysis" ? "selected" : ""}>独立拆书</option>
          </select>
        </label>
        <label>参考角色
          <select id="reference-role">
            <option value="parallel" ${referenceDraft.role === "parallel" ? "selected" : ""}>平行参考</option>
            <option value="primary" ${referenceDraft.role === "primary" ? "selected" : ""}>主参考</option>
            <option value="supporting" ${referenceDraft.role === "supporting" ? "selected" : ""}>辅助参考</option>
          </select>
        </label>
        <label>来源类型
          <select id="reference-source-type">
            <option value="local_file" ${referenceDraft.sourceType === "local_file" ? "selected" : ""}>本地文件</option>
            <option value="url" ${referenceDraft.sourceType === "url" ? "selected" : ""}>全文网址</option>
          </select>
        </label>
      </div>
      <div class="grid-2" style="margin-top:12px;">
        <label>作品名（可选）
          <input id="reference-title" value="${escapeAttr(referenceDraft.sourceTitle)}" placeholder="例如：遮天" />
        </label>
        <label>本地全文文件
          <input id="reference-source-file" type="file" accept=".txt,.md,.markdown,.text" style="display:none;" />
          <div style="display:flex; align-items:center; gap:12px; margin-top:6px; padding:14px 16px; border:1px solid rgba(196, 177, 150, 0.9); border-radius:18px; background:rgba(255,255,255,0.55);">
            <button type="button" class="secondary" id="select-reference-file">选择文件</button>
            <span class="muted">${escapeHtml(referenceDraft.sourceLabel || "未选择任何文件")}</span>
          </div>
        </label>
      </div>
      <label style="margin-top:12px;">全文网址
        <input id="reference-source-url" value="${escapeAttr(referenceDraft.sourceUrl)}" placeholder="例如：https://example.com/full-novel" />
      </label>
      <label style="margin-top:12px;">拆解意图
        <textarea id="reference-notes" rows="4" placeholder="例如：我想拆它的世界展开方式、势力升级、主角成长切口，但不要直接模仿表达风格。">${escapeHtml(referenceDraft.notes)}</textarea>
      </label>
    </article>

    <div class="grid-2" style="margin-top:16px;">
      <article class="editor-card">
        <div class="section-header">
          <h3>拆解过程</h3>
          <span class="badge">${escapeHtml(latestReferenceAsset ? (latestReferenceAsset.sourceWork?.title || "最近一次") : "未开始")}</span>
        </div>
        <p class="muted" style="margin-top:8px;">这里专门看本次拆解是怎么被 AI 处理的。默认只展开最近一次项目级拆解。</p>
        ${renderReferenceProcessPanel(latestReferenceAsset)}
      </article>

      <article class="editor-card">
        <div class="section-header">
          <h3>拆解结论</h3>
          <span class="badge">${escapeHtml(latestReferenceAsset ? String((latestReferenceAsset.reusableObjects || []).length) : "0")}</span>
        </div>
        <p class="muted" style="margin-top:8px;">右侧只看最终可判断的结果，不再混原始处理过程。</p>
        ${renderReferenceResultPanel(latestReferenceAsset, allObjectsById)}
      </article>
    </div>

    <article class="editor-card" style="margin-top:16px;">
      <div class="section-header">
        <h3>待确认内容</h3>
        <span class="badge">${escapeHtml(String(candidateChangeSets.length))} 组</span>
      </div>
      <p class="muted" style="margin-top:8px;">先看上面的拆解过程和拆解结论，再在这里决定哪些内容进入当前小说。</p>
      ${
        candidateChangeSets.length
          ? candidateChangeSets
              .slice()
              .reverse()
              .map((changeSet) => {
                const items = (changeSet.objectIds || [])
                  .map((objectId) => candidateObjectsById.get(objectId))
                  .filter(Boolean);
                return `
                  <article class="record-card" style="margin-top:12px;">
                    <div class="row-between">
                      <strong>${escapeHtml(changeSet.title)}</strong>
                      <span class="badge">${escapeHtml(changeSet.status)}</span>
                    </div>
                    <p class="muted">${escapeHtml(changeSet.notes || "本轮讨论提炼出的候选对象。")}</p>
                    <div class="stack" style="margin-top:12px;">
                      ${items
                        .map(
                          (object) => `
                            <div class="row-between" style="align-items:flex-start; gap:12px;">
                              <label style="display:flex; gap:10px; align-items:flex-start; flex:1;">
                                <input type="checkbox" data-candidate-object="${changeSet.id}" value="${escapeAttr(object.id)}" checked />
                                <span>
                                  <strong>${escapeHtml(object.title)}</strong>
                                  <span class="muted">(${escapeHtml(formatKernelObjectLabel(object))})</span>
                                  <div class="muted" style="margin-top:6px;">${escapeHtml(object.content?.summary || "-")}</div>
                                </span>
                              </label>
                              <button type="button" class="secondary" data-discuss-object-title="${escapeAttr(object.title || "")}" data-discuss-object-label="${escapeAttr(formatKernelObjectLabel(object))}" style="padding:6px 12px; font-size:12px; white-space:nowrap;">讨论此对象</button>
                            </div>
                          `,
                        )
                        .join("")}
                    </div>
                    <div class="grid-3" style="margin-top:12px;">
                      <label>发布范围
                        <select data-release-mode="${changeSet.id}">
                          <option value="future_only">仅未来生效</option>
                          <option value="from_volume">从某卷开始</option>
                          <option value="from_chapter">从某章开始</option>
                          <option value="global_redefine">全局重定义</option>
                        </select>
                      </label>
                      <label>起始卷
                        <input type="number" min="1" data-release-volume="${changeSet.id}" placeholder="可选" />
                      </label>
                      <label>起始章
                        <input type="number" min="1" data-release-chapter="${changeSet.id}" placeholder="可选" />
                      </label>
                    </div>
                    <div class="actions" style="margin-top:12px;">
                      <button class="secondary" data-accept-change-set="${changeSet.id}" ${state.pendingAction ? "disabled" : ""}>确认勾选项</button>
                    </div>
                  </article>
                `;
              })
              .join("")
          : '<div class="empty" style="margin-top:12px;">还没有待确认内容。先输入一段自由构思，或先做一次作品拆解。</div>'
      }
    </article>

    <div class="grid-2" style="margin-top:16px;">
      <article class="editor-card">
        <div class="section-header">
          <h3>参考资产库</h3>
          <span class="badge">${escapeHtml(String(referenceAssets.length))} / ${escapeHtml(String(authorReferenceAssets.length))}</span>
        </div>
        <p class="muted" style="margin-top:8px;">这里存放已经沉淀下来的参考资产，不和本次拆解结果混在一起。</p>
        <div class="section-header" style="margin-top:16px;">
          <h3>本书参考资产</h3>
          <span class="badge">${escapeHtml(String(referenceAssets.length))}</span>
        </div>
        ${
          referenceAssets.length
            ? referenceAssets
                .slice()
                .reverse()
                .map((asset) => renderReferenceAssetCard(asset, allObjectsById, true))
                .join("")
            : '<p class="muted" style="margin-top:12px;">这本书下还没有沉淀任何参考资产。</p>'
        }

        <div class="section-header" style="margin-top:20px;">
          <h3>作者通用参考资产</h3>
          <span class="badge">${escapeHtml(String(authorReferenceAssets.length))}</span>
        </div>
        ${
          authorReferenceAssets.length
            ? authorReferenceAssets
                .slice()
                .reverse()
                .slice(0, 6)
                .map((asset) => renderReferenceAssetCard(asset, allObjectsById, true))
                .join("")
            : '<p class="muted" style="margin-top:12px;">还没有作者通用参考资产。</p>'
        }
      </article>

      <article class="editor-card">
        <div class="section-header">
          <h3>已确认设定</h3>
          <span class="badge">${escapeHtml(String(formalObjects.length))} 项</span>
        </div>
        ${
          formalObjects.length
            ? formalObjects
                .slice()
                .reverse()
                .map(
                  (object) => `
                    <article class="record-card" style="margin-top:12px;">
                      <div class="row-between">
                        <strong>${escapeHtml(object.title)}</strong>
                        <span class="badge">${escapeHtml(formatKernelObjectLabel(object))}</span>
                      </div>
                      <p>${escapeHtml(object.content?.summary || "-")}</p>
                      <p class="muted">版本：${escapeHtml(object.versionRef || "-")} | 作用域：${escapeHtml(object.effectiveScope?.level || "-")}</p>
                      <div class="actions" style="margin-top:10px;">
                        <button type="button" class="secondary" data-discuss-object-title="${escapeAttr(object.title || "")}" data-discuss-object-label="${escapeAttr(formatKernelObjectLabel(object))}" data-discuss-object-formal="1" style="padding:6px 12px; font-size:12px;">讨论此对象</button>
                      </div>
                    </article>
                  `,
                )
                .join("")
            : '<div class="empty" style="margin-top:12px;">还没有已确认设定。确认后会进入这里。</div>'
        }

        <div class="section-header" style="margin-top:20px;">
          <h3>记忆沉淀与版本</h3>
          <span class="badge">${escapeHtml(String(memories.length))} / ${escapeHtml(String(versions.length))}</span>
        </div>
        ${
          memories.length
            ? memories
                .slice()
                .reverse()
                .slice(0, 6)
                .map(
                  (memory) => `
                    <div class="row-between" style="margin-top:10px; align-items:flex-start;">
                      <span>${escapeHtml(memory.summary)}</span>
                      <span class="chip">${escapeHtml(memory.type)}</span>
                    </div>
                  `,
                )
                .join("")
            : '<p class="muted" style="margin-top:12px;">还没有记忆沉淀。</p>'
        }
        ${
          versions.length
            ? `
              <div class="stack" style="margin-top:12px;">
                ${versions
                  .slice()
                  .reverse()
                  .slice(0, 4)
                  .map(
                    (version) => `
                      <div class="row-between">
                        <span>${escapeHtml(version.summary || version.id)}</span>
                        <span class="badge">${escapeHtml(version.id)}</span>
                      </div>
                    `,
                  )
                  .join("")}
              </div>
            `
            : ""
        }

        <div class="section-header" style="margin-top:20px;">
          <h3>本书试出的新特性</h3>
          <span class="badge">${escapeHtml(String(features.length))} / ${escapeHtml(String(summary.authorFeatureCount || 0))}</span>
        </div>
        ${
          features.length
            ? features
                .slice()
                .reverse()
                .map(
                  (feature) => `
                    <article class="record-card" style="margin-top:12px;">
                      <div class="row-between" style="align-items:flex-start; gap:12px;">
                        <span>
                          <strong>${escapeHtml(feature.name)}</strong>
                          <div class="muted" style="margin-top:6px;">${escapeHtml(feature.description || "-")}</div>
                        </span>
                        <span class="chip">${escapeHtml(feature.status)}</span>
                      </div>
                      <p class="muted" style="margin-top:10px;">类型：${escapeHtml(feature.featureType || "metadata_extension")}</p>
                      ${
                        feature.promotedFeatureId
                          ? `<p class="muted">已提升到作者级：${escapeHtml(feature.promotedFeatureId)}</p>`
                          : `<div class="actions" style="margin-top:12px;"><button class="secondary" data-promote-feature="${escapeAttr(feature.id)}" ${state.pendingAction ? "disabled" : ""}>提升到作者特性库</button></div>`
                      }
                    </article>
                  `,
                )
                .join("")
            : '<p class="muted" style="margin-top:12px;">当前这本书还没有试出新的结构特性。</p>'
        }

        <div class="section-header" style="margin-top:20px;">
          <h3>建议启用的作者特性</h3>
          <span class="badge">${escapeHtml(String(summary.suggestedAuthorFeatureCount || 0))}</span>
        </div>
        ${
          suggestedAuthorFeatures.length
            ? suggestedAuthorFeatures
                .slice()
                .map(
                  (feature) => `
                    <article class="record-card" style="margin-top:12px;">
                      <div class="row-between" style="align-items:flex-start; gap:12px;">
                        <span>
                          <strong>${escapeHtml(feature.name)}</strong>
                          <div class="muted" style="margin-top:6px;">${escapeHtml(feature.description || "-")}</div>
                        </span>
                        <span class="chip">建议启用</span>
                      </div>
                      <div class="actions" style="margin-top:12px;">
                        <button class="secondary" data-enable-author-feature="${escapeAttr(feature.id)}" ${state.pendingAction ? "disabled" : ""}>启用到当前小说</button>
                      </div>
                    </article>
                  `,
                )
                .join("")
            : '<p class="muted" style="margin-top:12px;">当前没有匹配到建议启用的作者特性。</p>'
        }

        <div class="section-header" style="margin-top:20px;">
          <h3>已继承的作者特性</h3>
          <span class="badge">${escapeHtml(String(summary.enabledAuthorFeatureCount || 0))}</span>
        </div>
        ${
          enabledAuthorFeatures.length
            ? enabledAuthorFeatures
                .slice()
                .reverse()
                .map(
                  (feature) => `
                    <div class="row-between" style="margin-top:10px; align-items:flex-start;">
                      <span>
                        <strong>${escapeHtml(feature.name)}</strong>
                        <div class="muted" style="margin-top:6px;">${escapeHtml(feature.description || "-")}</div>
                      </span>
                      <span class="chip">${escapeHtml(feature.status)}</span>
                    </div>
                  `,
                )
                .join("")
            : '<p class="muted" style="margin-top:12px;">这本书还没有继承作者特性。</p>'
        }

        <div class="section-header" style="margin-top:20px;">
          <h3>作者特性库</h3>
          <span class="badge">${escapeHtml(String(authorFeatures.length))}</span>
        </div>
        ${
          authorFeatures.length
            ? authorFeatures
                .slice()
                .reverse()
                .slice(0, 8)
                .map(
                  (feature) => `
                    <div class="row-between" style="margin-top:10px; align-items:flex-start;">
                      <span>
                        <strong>${escapeHtml(feature.name)}</strong>
                        <div class="muted" style="margin-top:6px;">${escapeHtml(feature.description || "-")}</div>
                      </span>
                      <span class="chip">${escapeHtml(feature.status)}</span>
                    </div>
                  `,
                )
                .join("")
            : '<p class="muted" style="margin-top:12px;">还没有沉淀作者特性。</p>'
        }
      </article>
    </div>
  `;

  const chatLog = document.querySelector("#ideation-chat-log");
  if (chatLog) {
    chatLog.scrollTop = chatLog.scrollHeight;
  }
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

function captureSystemSettingsDraft() {
  const current = structuredClone(state.systemSettings || defaultSystemSettings());
  current.execution.timeoutSeconds = Number(document.querySelector("#system-timeout-seconds")?.value || current.execution.timeoutSeconds || 300);
  current.execution.retryCount = Number(document.querySelector("#system-retry-count")?.value || current.execution.retryCount || 1);
  current.execution.chunkSize = Number(document.querySelector("#system-chunk-size")?.value || current.execution.chunkSize || 12000);
  current.execution.chunkOverlap = Number(document.querySelector("#system-chunk-overlap")?.value || current.execution.chunkOverlap || 600);
  current.execution.aggregateGroupSize = Number(document.querySelector("#system-aggregate-group-size")?.value || current.execution.aggregateGroupSize || 8);
  current.execution.enableFormatRepairFallback = Boolean(document.querySelector("#system-enable-format-repair-fallback")?.checked);

  current.models = (current.models || []).map((model, index) => ({
    ...model,
    name: document.querySelector(`[data-system-model-field="${index}:name"]`)?.value?.trim() || "",
    provider: document.querySelector(`[data-system-model-field="${index}:provider"]`)?.value?.trim() || "",
    baseUrl: document.querySelector(`[data-system-model-field="${index}:baseUrl"]`)?.value?.trim() || "",
    apiKeyRef: document.querySelector(`[data-system-model-field="${index}:apiKeyRef"]`)?.value?.trim() || "",
    enabled: Boolean(document.querySelector(`[data-system-model-field="${index}:enabled"]`)?.checked),
    usageTags: (document.querySelector(`[data-system-model-field="${index}:usageTags"]`)?.value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    notes: document.querySelector(`[data-system-model-field="${index}:notes"]`)?.value?.trim() || "",
  }));

  Object.keys(current.taskRouting || {}).forEach((taskKey) => {
    current.taskRouting[taskKey] = {
      primaryModelId: document.querySelector(`[data-system-routing="${taskKey}:primaryModelId"]`)?.value || "",
      fallbackModelId: document.querySelector(`[data-system-routing="${taskKey}:fallbackModelId"]`)?.value || "",
    };
  });
  return current;
}

function captureAuthorSpaceDraft() {
  return {
    profile: {
      penName: document.querySelector("#author-pen-name")?.value?.trim() || "",
      displayName: document.querySelector("#author-display-name")?.value?.trim() || "",
      bio: document.querySelector("#author-bio")?.value?.trim() || "",
    },
    contacts: {
      email: document.querySelector("#author-email")?.value?.trim() || "",
      wechat: document.querySelector("#author-wechat")?.value?.trim() || "",
      phone: document.querySelector("#author-phone")?.value?.trim() || "",
      other: document.querySelector("#author-contact-other")?.value?.trim() || "",
    },
    publishing: {
      platforms: document.querySelector("#author-platforms")?.value?.trim() || "",
      homepage: document.querySelector("#author-homepage")?.value?.trim() || "",
      writingGoals: document.querySelector("#author-writing-goals")?.value?.trim() || "",
      currentStage: document.querySelector("#author-current-stage")?.value?.trim() || "",
    },
    styleNotes: {
      styleTraits: document.querySelector("#author-style-traits")?.value?.trim() || "",
      languagePreference: document.querySelector("#author-language-preference")?.value?.trim() || "",
      pacePreference: document.querySelector("#author-pace-preference")?.value?.trim() || "",
      characterPreference: document.querySelector("#author-character-preference")?.value?.trim() || "",
      worldPreference: document.querySelector("#author-world-preference")?.value?.trim() || "",
      conflictPreference: document.querySelector("#author-conflict-preference")?.value?.trim() || "",
      avoidance: document.querySelector("#author-avoidance")?.value?.trim() || "",
      otherNotes: document.querySelector("#author-other-notes")?.value?.trim() || "",
    },
  };
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
  const isGlobal = state.activeTab === "system-settings" || state.activeTab === "author-space";
  document.querySelector(".workspace-header")?.classList.toggle("hidden", isGlobal);
  document.querySelector(".workspace > .tabs")?.classList.toggle("hidden", isGlobal);
}

function bindStaticEvents() {
  dom.createProject.addEventListener("click", async () => {
    const title = dom.newTitle.value.trim();
    const genre = dom.newGenre.value.trim() || "待定题材";
    const hook = dom.newHook.value.trim() || "待构思卖点";

    if (!title) {
      window.alert("请先填写书名。题材和卖点可以先留空，后续在构思页继续推进。");
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
  const saveSystemSettingsButton = document.querySelector("#save-system-settings");
  if (saveSystemSettingsButton) {
    saveSystemSettingsButton.addEventListener("click", async () => {
      await runAction("save-system-settings", async () => {
        try {
          clearBanner();
          await saveSystemSettings(captureSystemSettingsDraft());
          showBanner("系统设置已保存。");
        } catch (error) {
          showBanner(error.message);
        }
      });
    });
  }

  const addSystemModelButton = document.querySelector("#add-system-model");
  if (addSystemModelButton) {
    addSystemModelButton.addEventListener("click", () => {
      const next = captureSystemSettingsDraft();
      next.models.push({
        id: `model-${Date.now()}`,
        name: "",
        provider: "",
        baseUrl: "",
        apiKeyRef: "",
        enabled: true,
        usageTags: [],
        notes: "",
      });
      state.systemSettings = next;
      render();
    });
  }

  const addLmStudioModelButton = document.querySelector("#add-lmstudio-model");
  if (addLmStudioModelButton) {
    addLmStudioModelButton.addEventListener("click", () => {
      const next = captureSystemSettingsDraft();
      next.models.push(createLmStudioSystemModel());
      state.systemSettings = next;
      render();
    });
  }

  document.querySelectorAll("[data-remove-system-model]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.removeSystemModel);
      const next = captureSystemSettingsDraft();
      next.models.splice(index, 1);
      state.systemSettings = next;
      render();
    });
  });

  const saveAuthorSpaceButton = document.querySelector("#save-author-space");
  if (saveAuthorSpaceButton) {
    saveAuthorSpaceButton.addEventListener("click", async () => {
      await runAction("save-author-space", async () => {
        try {
          clearBanner();
          await saveAuthorSpace(captureAuthorSpaceDraft());
          showBanner("作者空间已保存。");
        } catch (error) {
          showBanner(error.message);
        }
      });
    });
  }

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

  const sendIdeationChat = document.querySelector("#send-ideation-chat");
  if (sendIdeationChat) {
    const submitChat = async () => {
      const project = getCurrentProject();
      const input = document.querySelector("#ideation-chat-input");
      const message = input?.value.trim() || "";
      if (!project) {
        return;
      }
      if (!message) {
        window.alert("请先输入一段对话内容。");
        return;
      }
      await runAction("kernel-chat", async () => {
        try {
          clearBanner();
          await apiFetch(`/api/projects/${project.id}/kernel/chat`, {
            method: "POST",
            body: JSON.stringify({ message }),
          });
          if (input) {
            input.value = "";
          }
          await refreshProject(project.id);
          showBanner("已记录本轮对话，并更新候选对象。");
        } catch (error) {
          showBanner(error.message);
        }
      }, { projectId: project.id });
    };

    sendIdeationChat.addEventListener("click", submitChat);

    const ideationInput = document.querySelector("#ideation-chat-input");
    if (ideationInput) {
      ideationInput.addEventListener("keydown", async (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          await submitChat();
        }
      });
    }
  }

  document.querySelectorAll("[data-ideation-suggestion]").forEach((button) => {
    button.addEventListener("click", () => {
      const prompt = button.getAttribute("data-ideation-suggestion") || "";
      const input = document.querySelector("#ideation-chat-input");
      if (!input) {
        return;
      }
      input.value = prompt;
      input.focus();
      input.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });

  document.querySelectorAll("[data-discuss-object-title]").forEach((button) => {
    button.addEventListener("click", () => {
      const title = button.getAttribute("data-discuss-object-title") || "";
      const label = button.getAttribute("data-discuss-object-label") || "";
      const isFormal = button.getAttribute("data-discuss-object-formal") === "1";
      const input = document.querySelector("#ideation-chat-input");
      if (!input) {
        return;
      }
      const scopeHint = isFormal ? "已确认" : "候选";
      input.value = `我想专门聚焦讨论${scopeHint}对象「${title}」（${label}）：它的合理性如何？有没有更好的替代方案？还缺什么关键信息？`;
      input.focus();
      input.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });

  const analyzeReferenceAsset = document.querySelector("#analyze-reference-asset");
  const projectForDraft = getCurrentProject();
  const currentProjectId = projectForDraft?.id || null;
  [
    "#reference-mode",
    "#reference-role",
    "#reference-source-type",
    "#reference-title",
    "#reference-source-url",
    "#reference-notes",
  ].forEach((selector) => {
    const input = document.querySelector(selector);
    if (!input || !currentProjectId) {
      return;
    }
    input.addEventListener("input", () => {
      captureReferenceDraft(currentProjectId);
    });
    input.addEventListener("change", () => {
      captureReferenceDraft(currentProjectId);
    });
  });
  const referenceFileInput = document.querySelector("#reference-source-file");
  const selectReferenceFileButton = document.querySelector("#select-reference-file");
  if (selectReferenceFileButton && referenceFileInput) {
    selectReferenceFileButton.addEventListener("click", (event) => {
      event.preventDefault();
      referenceFileInput.click();
    });
  }
  if (referenceFileInput && currentProjectId) {
    referenceFileInput.addEventListener("change", async (event) => {
      const draft = referenceDraftFor(currentProjectId);
      const file = event.target.files?.[0];
      if (!file) {
        draft.sourcePath = "";
        draft.sourceText = "";
        draft.sourceLabel = "";
        state.referenceDrafts[currentProjectId] = draft;
        render();
        return;
      }
      draft.sourceLabel = file.name;
      draft.sourcePath = "";
      draft.sourceText = await file.text();
      if (!draft.sourceTitle) {
        draft.sourceTitle = file.name.replace(/\.[^.]+$/, "");
      }
      state.referenceDrafts[currentProjectId] = draft;
      render();
    });
  }
  if (analyzeReferenceAsset) {
    analyzeReferenceAsset.addEventListener("click", async (event) => {
      event.preventDefault();
      const project = getCurrentProject();
      const draft = project ? captureReferenceDraft(project.id) : defaultReferenceDraft();
      const sourceType = draft.sourceType;
      const sourceTitle = draft.sourceTitle.trim();
      const sourcePath = draft.sourcePath.trim();
      const sourceText = draft.sourceText || "";
      const sourceLabel = draft.sourceLabel || "";
      const sourceUrl = draft.sourceUrl.trim();
      const notes = draft.notes.trim();
      const mode = draft.mode;
      const role = draft.role;
      if (!project) {
        return;
      }
      if (sourceType === "local_file" && !sourceText.trim()) {
        window.alert("请先选择本地全文文件。");
        return;
      }
      if (sourceType === "url" && !sourceUrl) {
        window.alert("请先提供可读取全文的网址。");
        return;
      }
      await runAction("reference-analyze", async () => {
        try {
          clearBanner();
          const payload = await apiFetch(`/api/projects/${project.id}/kernel/reference-assets/analyze`, {
            method: "POST",
            body: JSON.stringify({
              sourceType,
              sourceTitle,
              sourcePath,
              sourceText,
              sourceLabel,
              sourceUrl,
              notes,
              mode,
              role,
            }),
          });
          if (payload.project) {
            replaceProjectInState(payload.project);
            render();
          } else {
            await refreshProject(project.id);
          }
          showBanner("已开始后台拆解，进度会自动刷新。");
        } catch (error) {
          showBanner(error.message);
        }
      }, { projectId: project.id, mode });
    });
  }

  document.querySelectorAll("[data-promote-feature]").forEach((button) => {
    button.addEventListener("click", async () => {
      const project = getCurrentProject();
      const featureId = button.dataset.promoteFeature;
      if (!project || !featureId) {
        return;
      }
      await runAction("feature-promote", async () => {
        try {
          clearBanner();
          await apiFetch(`/api/projects/${project.id}/kernel/capability-features/${featureId}/promote`, {
            method: "POST",
            body: JSON.stringify({}),
          });
          await refreshProject(project.id);
          showBanner("已提升到作者特性库。");
        } catch (error) {
          showBanner(error.message);
        }
      }, { projectId: project.id, featureId });
    });
  });

  document.querySelectorAll("[data-enable-author-feature]").forEach((button) => {
    button.addEventListener("click", async () => {
      const project = getCurrentProject();
      const featureId = button.dataset.enableAuthorFeature;
      if (!project || !featureId) {
        return;
      }
      await runAction("author-feature-enable", async () => {
        try {
          clearBanner();
          await apiFetch(`/api/projects/${project.id}/kernel/author-capability-features/${featureId}/enable`, {
            method: "POST",
            body: JSON.stringify({}),
          });
          await refreshProject(project.id);
          showBanner("已启用作者级能力到当前小说。");
        } catch (error) {
          showBanner(error.message);
        }
      }, { projectId: project.id, featureId });
    });
  });

  document.querySelectorAll("[data-accept-change-set]").forEach((button) => {
    button.addEventListener("click", async () => {
      const project = getCurrentProject();
      const changeSetId = button.dataset.acceptChangeSet;
      if (!project || !changeSetId) {
        return;
      }
      const objectIds = Array.from(
        document.querySelectorAll(`[data-candidate-object="${changeSetId}"]:checked`),
      ).map((input) => input.value);
      if (!objectIds.length) {
        window.alert("请至少勾选一个候选对象。");
        return;
      }
      const releaseMode = document.querySelector(`[data-release-mode="${changeSetId}"]`)?.value || "future_only";
      const volumeNumber = document.querySelector(`[data-release-volume="${changeSetId}"]`)?.value || "";
      const chapterNumber = document.querySelector(`[data-release-chapter="${changeSetId}"]`)?.value || "";
      await runAction("kernel-accept", async () => {
        try {
          clearBanner();
          await apiFetch(`/api/projects/${project.id}/kernel/candidate-change-sets/${changeSetId}/accept`, {
            method: "POST",
            body: JSON.stringify({
              objectIds,
              releasePlan: {
                mode: releaseMode,
                volumeNumber: volumeNumber ? Number(volumeNumber) : null,
                chapterNumber: chapterNumber ? Number(chapterNumber) : null,
              },
            }),
          });
          await refreshProject(project.id);
          showBanner("已将勾选候选对象发布到正式层。");
        } catch (error) {
          showBanner(error.message);
        }
      }, { projectId: project.id, changeSetId });
    });
  });

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
    await refreshSystemSettings();
    await refreshAuthorSpace();
    await refreshProjects();
  } catch (error) {
    showBanner(`初始化失败：${error.message}`);
  }
}

init();
