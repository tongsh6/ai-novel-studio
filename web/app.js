const state = {
  works: [],
  selectedWorkId: null,
  selectedChapterId: null,
  selectedDecisionId: null,
  mode: "workbench",
  workbench: null,
  reading: null,
  busy: false,
  chatByWorkId: {},
  createDraftByScope: {},
  refineDraftByScope: {},
};

const dom = {
  workCount: document.querySelector("#work-count"),
  workList: document.querySelector("#work-list"),
  createTitle: document.querySelector("#create-title"),
  createPitch: document.querySelector("#create-pitch"),
  createGenre: document.querySelector("#create-genre"),
  createWork: document.querySelector("#create-work"),
  healthBadge: document.querySelector("#health-badge"),
  currentTitle: document.querySelector("#current-title"),
  currentPitch: document.querySelector("#current-pitch"),
  toggleMode: document.querySelector("#toggle-mode"),
  chatLog: document.querySelector("#chat-log"),
  chatSuggestions: document.querySelector("#chat-suggestions"),
  chatInput: document.querySelector("#chat-input"),
  sendChat: document.querySelector("#send-chat"),
  banner: document.querySelector("#banner"),
  emptyWorkspace: document.querySelector("#empty-workspace"),
  workbenchView: document.querySelector("#workbench-view"),
  readingView: document.querySelector("#reading-view"),
  metricStage: document.querySelector("#metric-stage"),
  metricChapters: document.querySelector("#metric-chapters"),
  metricDrafted: document.querySelector("#metric-drafted"),
  activeChapterPill: document.querySelector("#active-chapter-pill"),
  chapterList: document.querySelector("#chapter-list"),
  decisionList: document.querySelector("#decision-list"),
  decisionPanel: document.querySelector("#decision-panel"),
  chapterPanel: document.querySelector("#chapter-panel"),
  chapterTitle: document.querySelector("#chapter-title"),
  chapterStatus: document.querySelector("#chapter-status"),
  chapterFunction: document.querySelector("#chapter-function"),
  chapterEvent: document.querySelector("#chapter-event"),
  chapterConflict: document.querySelector("#chapter-conflict"),
  chapterHook: document.querySelector("#chapter-hook"),
  chapterSummary: document.querySelector("#chapter-summary"),
  chapterInfoPoints: document.querySelector("#chapter-info-points"),
  generateOutline: document.querySelector("#generate-outline"),
  generateDraft: document.querySelector("#generate-draft"),
  draftMeta: document.querySelector("#draft-meta"),
  draftLineage: document.querySelector("#draft-lineage"),
  draftText: document.querySelector("#draft-text"),
  readingToc: document.querySelector("#reading-toc"),
  readingTitle: document.querySelector("#reading-title"),
  readingVersion: document.querySelector("#reading-version"),
  readingLineage: document.querySelector("#reading-lineage"),
  readingText: document.querySelector("#reading-text"),
};

async function apiFetch(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `请求失败：${response.status}`);
  }
  return payload;
}

function setBanner(message, isError = false) {
  if (!message) {
    dom.banner.hidden = true;
    dom.banner.textContent = "";
    dom.banner.style.background = "";
    dom.banner.style.borderColor = "";
    return;
  }
  dom.banner.hidden = false;
  dom.banner.textContent = message;
  dom.banner.style.background = isError
    ? "rgba(175, 63, 47, 0.14)"
    : "rgba(58, 91, 78, 0.12)";
  dom.banner.style.borderColor = isError
    ? "rgba(175, 63, 47, 0.24)"
    : "rgba(58, 91, 78, 0.2)";
}

function setBusy(busy) {
  state.busy = busy;
  dom.createWork.disabled = busy;
  dom.generateOutline.disabled = busy || !state.selectedChapterId;
  dom.generateDraft.disabled = busy || !state.selectedChapterId;
  dom.toggleMode.disabled = busy || !state.selectedWorkId;
  dom.sendChat.disabled = busy;
  if (busy) {
    dom.generateOutline.textContent = "生成中…";
    dom.generateDraft.textContent = "生成中…";
  }
}

function currentWorkbenchChapter() {
  const chapters = state.workbench?.chapters || [];
  return chapters.find((chapter) => chapter.id === state.selectedChapterId) || chapters[0] || null;
}

function currentReadingChapter() {
  const chapters = state.reading?.readingProjection?.chapters || [];
  return chapters.find((chapter) => chapter.chapterId === state.selectedChapterId) || chapters[0] || null;
}

function chapterTitleById(chapterId) {
  const chapters = state.workbench?.chapters || [];
  return chapters.find((chapter) => chapter.id === chapterId)?.title || "";
}

function chapterHasDraft(chapter = currentWorkbenchChapter()) {
  return Boolean(chapter?.latestDraft);
}

function draftActionLabel(chapter = currentWorkbenchChapter()) {
  return chapterHasDraft(chapter) ? "修订草稿" : "生成草稿";
}

function scrollDecisionContextIntoView() {
  const selectedDecision = state.selectedDecisionId
    ? dom.decisionList.querySelector(`[data-decision-id="${CSS.escape(state.selectedDecisionId)}"]`)
    : null;
  if (selectedDecision) {
    selectedDecision.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  } else if (dom.decisionPanel) {
    dom.decisionPanel.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }

  if (dom.chapterPanel) {
    dom.chapterPanel.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }
}

function chapterStatusLabel(status) {
  return {
    BACKLOG: "待推进",
    OUTLINED: "已细纲",
    DRAFTED: "已草稿",
  }[status] || status || "-";
}

function stageLabel(stage) {
  return {
    IDEATION: "立项中",
    CHAPTER_PLANNING: "章节规划中",
    DRAFTING: "正文草稿中",
    REVISING: "正文修订中",
  }[stage] || stage || "-";
}

function decisionTypeLabel(type) {
  return {
    work_seed_created: "创建立项",
    chapter_outline_generated: "生成细纲",
    chapter_outline_rewritten: "重生成细纲",
    chapter_draft_created: "生成草稿",
    chapter_draft_rewritten: "重出草稿",
    chapter_draft_revised: "修订草稿",
  }[type] || type || "-";
}

function currentChatMessages() {
  return state.chatByWorkId[chatScopeKey()] || [];
}

function chatScopeKey() {
  return state.selectedWorkId || "__lobby__";
}

function currentCreateDraft() {
  return (
    state.createDraftByScope[chatScopeKey()] || {
      active: false,
      title: "",
      oneLinePitch: "",
      genre: "",
      awaitingField: "",
    }
  );
}

function updateCreateDraft(patch) {
  const scopeKey = chatScopeKey();
  const current = currentCreateDraft();
  state.createDraftByScope[scopeKey] = { ...current, ...patch };
}

function clearCreateDraft(scopeKey = chatScopeKey()) {
  delete state.createDraftByScope[scopeKey];
}

function currentRefineDraft() {
  return (
    state.refineDraftByScope[chatScopeKey()] || {
      active: false,
      instruction: "",
      awaitingChoice: false,
    }
  );
}

function updateRefineDraft(patch) {
  const scopeKey = chatScopeKey();
  const current = currentRefineDraft();
  state.refineDraftByScope[scopeKey] = { ...current, ...patch };
}

function clearRefineDraft(scopeKey = chatScopeKey()) {
  delete state.refineDraftByScope[scopeKey];
}

function ensureChatSeed() {
  const scopeKey = chatScopeKey();
  if (!state.chatByWorkId[scopeKey]) {
    const chapter = currentWorkbenchChapter();
    state.chatByWorkId[scopeKey] = [
      {
        role: "assistant",
        text: state.selectedWorkId
          ? chapter
            ? `当前作品已就绪。你可以直接说“给当前章生成细纲”、“直接出草稿”或“切到阅读态”。我会优先围绕 ${chapter.title} 推进。`
            : "当前作品已就绪。你可以直接说“给当前章生成细纲”、“直接出草稿”或“切到阅读态”。"
          : "还没有作品。你可以直接说“创建作品：标题｜一句话卖点｜题材”，我会先帮你立项。",
        createdAt: formatNow(),
      },
    ];
  }
}

function pushChatMessage(role, text) {
  ensureChatSeed();
  state.chatByWorkId[chatScopeKey()].push({
    role,
    text,
    createdAt: formatNow(),
  });
}

function formatNow() {
  return new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimestamp(value) {
  const ts = Number(value);
  if (!Number.isFinite(ts) || ts <= 0) {
    return "-";
  }
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function currentSuggestions() {
  const chapter = currentWorkbenchChapter();
  if (!state.selectedWorkId) {
    const draft = currentCreateDraft();
    if (draft.active) {
      const missing = missingCreateFields(draft);
      if (missing[0] === "title") {
        return ["标题：霜港遗民", "标题：《赤潮学院》", "查看立项格式"];
      }
      if (missing[0] === "genre") {
        return ["题材：末世 / 经营", "题材：学院流 / 玄幻", "查看立项格式"];
      }
      return ["卖点：一句话概括冲突与钩子", "一句话：主角必须...", "查看立项格式"];
    }
    return ["查看立项格式", "创建作品：标题｜一句话卖点｜题材", "用表单创建"];
  }
  const refineDraft = currentRefineDraft();
  if (refineDraft.active && refineDraft.awaitingChoice) {
    return ["先改细纲", "直接重出草稿", "算了，先不改"];
  }
  if (state.mode === "reading") {
    return ["返回工作台", "查看当前章", "生成草稿"];
  }
  if (!chapter) {
    return ["查看作品状态", "切到阅读态"];
  }
  if (chapter.status === "BACKLOG") {
    return ["给当前章生成细纲", "查看当前章状态", "切到阅读态"];
  }
  if (chapter.status === "OUTLINED") {
    return ["直接出草稿", "查看当前章状态", "切到阅读态"];
  }
  return ["查看当前章状态", "切到阅读态", "修订当前草稿"];
}

function renderChat() {
  ensureChatSeed();
  const messages = currentChatMessages();
  dom.chatLog.innerHTML = messages
    .map(
      (message) => `
        <article class="chat-item ${message.role}">
          <div class="chat-meta">
            <strong>${message.role === "user" ? "你" : "工作台"}</strong>
            <span>${escapeHtml(message.createdAt)}</span>
          </div>
          <p class="chat-body">${escapeHtml(message.text)}</p>
        </article>
      `
    )
    .join("");
  dom.chatSuggestions.innerHTML = currentSuggestions()
    .map(
      (text) => `
        <button class="suggestion-chip" data-chat-suggestion="${escapeHtml(text)}">${escapeHtml(text)}</button>
      `
    )
    .join("");
  dom.sendChat.disabled = state.busy;
  dom.chatLog.scrollTop = dom.chatLog.scrollHeight;
}

function renderWorks() {
  dom.workCount.textContent = String(state.works.length);
  if (!state.works.length) {
    dom.workList.className = "work-list empty-state";
    dom.workList.textContent = "还没有作品。";
    return;
  }
  dom.workList.className = "work-list";
  dom.workList.innerHTML = state.works
    .map(
      (work) => `
        <button class="work-item ${work.id === state.selectedWorkId ? "active" : ""}" data-work-id="${work.id}">
          <strong>${escapeHtml(work.title)}</strong>
          <p>${escapeHtml(work.oneLinePitch || "暂无卖点")}</p>
          <small>${escapeHtml(stageLabel(work.stage))} · ${escapeHtml(work.genre || "未填题材")}</small>
        </button>
      `
    )
    .join("");
}

function renderWorkbench() {
  const hasWork = Boolean(state.selectedWorkId && state.workbench);
  dom.emptyWorkspace.hidden = hasWork;
  dom.workbenchView.hidden = !hasWork || state.mode !== "workbench";
  dom.readingView.hidden = !hasWork || state.mode !== "reading";
  dom.toggleMode.disabled = !hasWork || state.busy;

  if (!hasWork) {
    dom.currentTitle.textContent = "尚未选择作品";
    dom.currentPitch.textContent = "可以直接在上面的对话入口立项，或继续使用左侧表单。";
    dom.toggleMode.textContent = "切到阅读态";
    dom.generateDraft.textContent = "生成草稿";
    dom.draftLineage.textContent = "还没有版本关系可展示。";
    dom.draftLineage.className = "draft-lineage empty-state";
    renderChat();
    return;
  }

  const work = state.workbench.work;
  const chapters = state.workbench.chapters || [];
  const decisions = state.workbench.recentDecisions || [];
  const chapter = currentWorkbenchChapter();

  dom.currentTitle.textContent = work.title;
  dom.currentPitch.textContent = work.one_line_pitch || work.summary || "暂无一句话卖点。";
  dom.toggleMode.textContent = state.mode === "workbench" ? "切到阅读态" : "返回工作台";

  dom.metricStage.textContent = stageLabel(work.stage);
  dom.metricChapters.textContent = String(chapters.length);
  dom.metricDrafted.textContent = String(chapters.filter((item) => item.status === "DRAFTED").length);

  dom.chapterList.innerHTML = chapters
    .map(
      (item) => `
        <button class="chapter-item ${item.id === state.selectedChapterId ? "active" : ""}" data-chapter-id="${item.id}">
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.summary || item.function || "尚未生成内容")}</p>
          <small>${escapeHtml(chapterStatusLabel(item.status))}</small>
        </button>
      `
    )
    .join("");

  dom.decisionList.innerHTML = decisions.length
    ? decisions
        .map((item) => renderDecisionItem(item))
        .join("")
    : '<div class="empty-state">还没有决策记录。</div>';

  if (!chapter) {
    dom.activeChapterPill.textContent = "未选中";
    dom.chapterTitle.textContent = "-";
    dom.chapterStatus.textContent = "-";
    dom.chapterFunction.textContent = "-";
    dom.chapterEvent.textContent = "-";
    dom.chapterConflict.textContent = "-";
    dom.chapterHook.textContent = "-";
    dom.chapterSummary.textContent = "-";
    dom.chapterInfoPoints.innerHTML = "";
    dom.draftMeta.textContent = "暂无草稿";
    dom.draftLineage.textContent = "还没有版本关系可展示。";
    dom.draftLineage.className = "draft-lineage empty-state";
    dom.draftText.textContent = "还没有正文草稿。";
    dom.generateOutline.disabled = true;
    dom.generateDraft.disabled = true;
    dom.generateDraft.textContent = "生成草稿";
    return;
  }

  dom.activeChapterPill.textContent = chapter.title;
  dom.chapterTitle.textContent = chapter.title;
  dom.chapterStatus.textContent = chapterStatusLabel(chapter.status);
  dom.chapterFunction.textContent = chapter.function || "尚未明确";
  dom.chapterEvent.textContent = chapter.core_event || "尚未明确";
  dom.chapterConflict.textContent = chapter.conflict || "尚未明确";
  dom.chapterHook.textContent = chapter.ending_hook || "尚未明确";
  dom.chapterSummary.textContent = chapter.summary || "还没有章节摘要。";

  const infoPoints = parseJsonArray(chapter.info_points_json);
  dom.chapterInfoPoints.innerHTML = infoPoints.length
    ? infoPoints.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
    : "<li>还没有信息点。</li>";

  if (chapter.latestDraft) {
    dom.draftMeta.textContent = `v${chapter.latestDraft.version_no} · ${chapter.latestDraft.word_count} 字`;
    dom.draftLineage.textContent = draftLineageText(chapter.latestDraft);
    dom.draftLineage.className = "draft-lineage";
    dom.draftText.textContent = chapter.latestDraft.text || "草稿为空。";
  } else {
    dom.draftMeta.textContent = "暂无草稿";
    dom.draftLineage.textContent = "还没有版本关系可展示。";
    dom.draftLineage.className = "draft-lineage empty-state";
    dom.draftText.textContent = "还没有正文草稿。";
  }

  dom.generateOutline.disabled = state.busy;
  dom.generateDraft.disabled = state.busy || chapter.status === "BACKLOG";
  dom.generateDraft.textContent = draftActionLabel(chapter);
  renderChat();
}

function renderReading() {
  if (!state.selectedWorkId || !state.reading || state.mode !== "reading") {
    return;
  }
  const projection = state.reading.readingProjection;
  const readingChapter = currentReadingChapter();
  const toc = projection?.toc || [];

  dom.readingToc.innerHTML = toc
    .map(
      (item) => `
        <button class="toc-item ${item.chapterId === state.selectedChapterId ? "active" : ""}" data-reading-chapter-id="${item.chapterId}">
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(chapterStatusLabel(item.status))}</p>
          <small>${item.hasDraft ? "可阅读" : "暂无正文"}</small>
        </button>
      `
    )
    .join("");

  if (!readingChapter) {
    dom.readingTitle.textContent = "暂无可阅读章节";
    dom.readingVersion.textContent = "-";
    dom.readingLineage.textContent = "还没有版本关系可展示。";
    dom.readingLineage.className = "draft-lineage empty-state";
    dom.readingText.textContent = "先在工作台中生成章节草稿。";
    return;
  }

  dom.readingTitle.textContent = readingChapter.title;
  dom.readingVersion.textContent = readingChapter.draftVersionNo
    ? `v${readingChapter.draftVersionNo}`
    : "无草稿";
  dom.readingLineage.textContent = readingLineageText(readingChapter);
  dom.readingLineage.className = "draft-lineage";
  dom.readingText.textContent = readingChapter.text || "先在工作台中生成章节草稿。";
  renderChat();
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderDecisionItem(item) {
  const extensions = parseJsonObject(item.extensions_json);
  const affectedRefs = parseJsonArray(item.affected_object_refs_json);
  const chapterId =
    extensions.chapterId ||
    affectedRefs.find((ref) => String(ref || "").startsWith("chapter_")) ||
    "";
  const chapterTitle = chapterTitleById(chapterId);
  const chips = [decisionTypeLabel(item.decision_type)];
  if (extensions.rewriteMode && extensions.rewriteMode !== "default") {
    chips.push(`模式 ${extensions.rewriteMode}`);
  }
  if (extensions.baseVersionNo) {
    chips.push(`基于 v${extensions.baseVersionNo}`);
  }
  if (extensions.draftVersionNo) {
    chips.push(`v${extensions.draftVersionNo}`);
  }
  if (chapterTitle) {
    chips.push(chapterTitle);
  }

  const instructionBlock = extensions.instructionText
    ? `
        <div class="decision-instruction">
          <span class="decision-kicker">本轮要求</span>
          <p>${escapeHtml(extensions.instructionText)}</p>
        </div>
      `
    : "";

  const rationaleBlock = item.rationale
    ? `<p class="decision-rationale">${escapeHtml(item.rationale)}</p>`
    : "";

  return `
    <article
      class="decision-item ${item.id === state.selectedDecisionId ? "active" : ""} ${chapterId ? "interactive" : ""}"
      data-decision-id="${escapeHtml(item.id)}"
      data-decision-chapter-id="${escapeHtml(chapterId)}"
      data-decision-draft-version="${escapeHtml(extensions.draftVersionNo || "")}"
    >
      <div class="decision-top">
        <strong>${escapeHtml(item.title)}</strong>
        <span class="decision-time">${escapeHtml(formatTimestamp(item.created_at))}</span>
      </div>
      <p class="decision-body">${escapeHtml(item.decision || item.rationale || "-")}</p>
      ${instructionBlock}
      <div class="decision-chip-row">
        ${chips.map((chip) => `<span class="decision-chip">${escapeHtml(chip)}</span>`).join("")}
      </div>
      ${rationaleBlock}
    </article>
  `;
}

function draftLineageText(draft) {
  if (!draft) {
    return "还没有版本关系可展示。";
  }
  const extensions = parseJsonObject(draft.extensions_json);
  const currentVersion = draft.version_no ? `v${draft.version_no}` : "当前版本";
  if (extensions.baseVersionNo) {
    return `${currentVersion} 是基于 v${extensions.baseVersionNo} 修订而来。`;
  }
  if (draft.source_type === "stub_generation" || draft.source_type === "llm_generation") {
    return `${currentVersion} 是当前章节的首个生成版本。`;
  }
  return `${currentVersion} 已生成。`;
}

function readingLineageText(readingChapter) {
  if (!readingChapter || !readingChapter.draftVersionNo) {
    return "还没有版本关系可展示。";
  }
  const extensions = parseJsonObject(readingChapter.draftExtensionsJson);
  const currentVersion = `v${readingChapter.draftVersionNo}`;
  if (extensions.baseVersionNo) {
    return `${currentVersion} 是基于 v${extensions.baseVersionNo} 修订而来。`;
  }
  if (readingChapter.draftSourceType === "stub_generation" || readingChapter.draftSourceType === "llm_generation") {
    return `${currentVersion} 是当前章节的首个生成版本。`;
  }
  return `${currentVersion} 已可阅读，但当前没有更多来源信息。`;
}

async function requestDraftAction({
  workId,
  chapterId,
  chapter,
  instructionText = "",
  rewriteMode = "default",
  reviseMode = "revise_direct",
  createdBy = "system_stub",
}) {
  const hasDraft = chapterHasDraft(chapter);
  const path = hasDraft
    ? `/api/works/${workId}/chapters/${chapterId}/revise-draft`
    : `/api/works/${workId}/chapters/${chapterId}/generate-draft`;
  const body = hasDraft
    ? {
        createdBy,
        instructionText,
        reviseMode,
      }
    : {
        createdBy,
        instructionText,
        rewriteMode,
      };
  return apiFetch(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function refreshWorks() {
  const payload = await apiFetch("/api/works");
  state.works = payload.works || [];
  if (!state.selectedWorkId && state.works.length) {
    state.selectedWorkId = state.works[0].id;
  }
  if (state.selectedWorkId && !state.works.some((work) => work.id === state.selectedWorkId)) {
    state.selectedWorkId = state.works[0]?.id || null;
  }
  renderWorks();
}

async function refreshWorkbench() {
  if (!state.selectedWorkId) {
    state.workbench = null;
    state.reading = null;
    state.selectedDecisionId = null;
    renderWorkbench();
    return;
  }
  state.workbench = await apiFetch(`/api/works/${state.selectedWorkId}/workbench`);
  if (!state.selectedChapterId) {
    state.selectedChapterId = state.workbench.work.active_chapter_id || state.workbench.chapters[0]?.id || null;
  }
  if (
    state.selectedChapterId &&
    !state.workbench.chapters.some((chapter) => chapter.id === state.selectedChapterId)
  ) {
    state.selectedChapterId = state.workbench.chapters[0]?.id || null;
  }
  if (
    state.selectedDecisionId &&
    !state.workbench.recentDecisions?.some((decision) => decision.id === state.selectedDecisionId)
  ) {
    state.selectedDecisionId = null;
  }
  renderWorkbench();
}

async function refreshReading() {
  if (!state.selectedWorkId) {
    state.reading = null;
    renderReading();
    return;
  }
  state.reading = await apiFetch(`/api/works/${state.selectedWorkId}/reading`);
  renderReading();
}

async function refreshAll() {
  await refreshWorks();
  await refreshWorkbench();
  if (state.mode === "reading" && state.selectedWorkId) {
    await refreshReading();
  }
}

async function guarded(action, successMessage, loadingMessage) {
  setBusy(true);
  setBanner(loadingMessage || "");
  try {
    await action();
    if (successMessage) {
      setBanner(successMessage);
    }
  } catch (error) {
    setBanner(error.message || "请求失败", true);
  } finally {
    setBusy(false);
    renderWorkbench();
    renderReading();
  }
}

function normalizeIntent(text) {
  return String(text || "").trim().toLowerCase();
}

function detectCreateIntent(text) {
  const normalized = normalizeIntent(text);
  return (
    normalized.includes("创建作品") ||
    normalized.includes("新建作品") ||
    normalized.includes("新建小说") ||
    normalized.includes("作品立项") ||
    normalized.startsWith("立项")
  );
}

function detectRefineIntent(text) {
  const normalized = normalizeIntent(text);
  return (
    normalized.includes("再狠一点") ||
    normalized.includes("更狠") ||
    normalized.includes("节奏快一点") ||
    normalized.includes("节奏更快") ||
    normalized.includes("重来一版") ||
    normalized.includes("重出一版") ||
    normalized.includes("改一下") ||
    normalized.includes("调整一下") ||
    normalized.includes("更紧一点") ||
    normalized.includes("更炸一点") ||
    normalized.includes("重写")
  );
}

function extractCreateWorkFields(text) {
  const compact = String(text || "").trim();
  if (!compact) return {};

  const pipeMatch = compact.match(/(?:创建作品|新建作品|新建小说|作品立项|立项)\s*[:：]?\s*([^｜|]+)[｜|]([^｜|]+)[｜|]([^｜|]+)/);
  if (pipeMatch) {
    const parsed = {
      title: pipeMatch[1].trim(),
      oneLinePitch: pipeMatch[2].trim(),
      genre: pipeMatch[3].trim(),
    };
    if (
      ["标题", "作品名", "一句话卖点", "题材"].includes(parsed.title) ||
      ["标题", "作品名", "一句话卖点", "题材"].includes(parsed.oneLinePitch) ||
      ["标题", "作品名", "一句话卖点", "题材"].includes(parsed.genre)
    ) {
      return {};
    }
    return parsed;
  }

  const titleLabelMatch = compact.match(/(?:标题|作品名|书名)[:：]\s*([^，。,；;\n]+)/);
  const titleMatch = compact.match(/《([^》]+)》/) || compact.match(/[“"]([^"”]+)[”"]/);
  const genreMatch = compact.match(/题材[:：]?\s*([^，。,；;\n]+)/);
  const pitchMatch = compact.match(/(?:卖点|一句话卖点|一句话)[:：]?\s*(.+)$/);
  const fields = {};
  if (titleLabelMatch) {
    fields.title = titleLabelMatch[1].trim();
  } else if (titleMatch) {
    fields.title = titleMatch[1].trim();
  }
  if (genreMatch) {
    fields.genre = genreMatch[1].trim();
  }
  if (pitchMatch) {
    fields.oneLinePitch = pitchMatch[1].trim();
  }
  return fields;
}

function missingCreateFields(draft) {
  const missing = [];
  if (!draft.title) missing.push("title");
  if (!draft.genre) missing.push("genre");
  if (!draft.oneLinePitch) missing.push("oneLinePitch");
  return missing;
}

function fieldLabel(field) {
  return {
    title: "标题",
    genre: "题材",
    oneLinePitch: "一句话卖点",
  }[field] || field;
}

function createDraftSummary(draft) {
  const parts = [];
  if (draft.title) parts.push(`标题《${draft.title}》`);
  if (draft.genre) parts.push(`题材 ${draft.genre}`);
  if (draft.oneLinePitch) parts.push(`卖点「${draft.oneLinePitch}」`);
  return parts.join("，");
}

async function handleChatIntent(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return;
  pushChatMessage("user", text);
  renderChat();

  const chapter = currentWorkbenchChapter();
  const normalized = normalizeIntent(text);

  if (!state.selectedWorkId) {
    const askedCreate = detectCreateIntent(text);
    const draft = currentCreateDraft();
    const extractedFields = extractCreateWorkFields(text);
    if (normalized.includes("表单")) {
      pushChatMessage("assistant", "左侧表单仍然可用。但如果你想直接对话立项，推荐使用：创建作品：标题｜一句话卖点｜题材");
      renderChat();
      return;
    }
    if (normalized.includes("格式") || normalized.includes("怎么立项")) {
      pushChatMessage("assistant", "对话立项格式：创建作品：标题｜一句话卖点｜题材。示例：创建作品：霜港遗民｜极夜海港的最后一名维修官，要把废弃港口变成幸存者之城。｜末世 / 经营");
      renderChat();
      return;
    }

    if (askedCreate || draft.active || Object.keys(extractedFields).length > 0) {
      const nextDraft = {
        ...draft,
        active: true,
        ...extractedFields,
      };
      if (draft.awaitingField && !extractedFields[draft.awaitingField] && !askedCreate) {
        nextDraft[draft.awaitingField] = text;
      }
      nextDraft.title = String(nextDraft.title || "").trim();
      nextDraft.genre = String(nextDraft.genre || "").trim();
      nextDraft.oneLinePitch = String(nextDraft.oneLinePitch || "").trim();

      const missing = missingCreateFields(nextDraft);
      if (!missing.length) {
        const createPayload = {
          title: nextDraft.title,
          genre: nextDraft.genre,
          oneLinePitch: nextDraft.oneLinePitch,
        };
        await guarded(async () => {
          const payload = await apiFetch("/api/works", {
            method: "POST",
            body: JSON.stringify(createPayload),
          });
          state.chatByWorkId[payload.work.id] = state.chatByWorkId["__lobby__"] || [];
          delete state.chatByWorkId["__lobby__"];
          clearCreateDraft("__lobby__");
          state.selectedWorkId = payload.work.id;
          state.selectedChapterId = payload.chapters[0]?.id || null;
          state.workbench = payload;
          state.mode = "workbench";
          await refreshWorks();
          renderWorkbench();
        }, "已通过对话创建作品立项底稿。");
        pushChatMessage("assistant", `作品《${createPayload.title}》已立项完成。接下来你可以直接说“给当前章生成细纲”。`);
        renderChat();
        return;
      }

      nextDraft.awaitingField = missing[0];
      updateCreateDraft(nextDraft);
      const summary = createDraftSummary(nextDraft);
      pushChatMessage(
        "assistant",
        `${summary ? `我先记下这些：${summary}。` : ""}接下来请补${fieldLabel(missing[0])}。`
      );
      renderChat();
      return;
    }

    if (normalized.includes("写一本") || normalized.includes("想写")) {
      updateCreateDraft({ active: true, awaitingField: "title" });
      pushChatMessage("assistant", "可以。先给这部作品一个标题，或者直接用《书名》告诉我。");
      renderChat();
      return;
    }

    pushChatMessage("assistant", "当前还没有作品。你可以直接说“创建作品：标题｜一句话卖点｜题材”，也可以先只告诉我标题、题材或一句话卖点，我会继续追问缺的部分。");
    renderChat();
    return;
  }

  const refineDraft = currentRefineDraft();
  if (refineDraft.active && refineDraft.awaitingChoice) {
    if (normalized.includes("算了") || normalized.includes("先不改") || normalized.includes("取消")) {
      clearRefineDraft();
      pushChatMessage("assistant", "这次修改要求先不执行。你可以继续推进当前章，或稍后再提新的调整要求。");
      renderChat();
      return;
    }

    if (normalized.includes("细纲") || normalized.includes("outline")) {
      clearRefineDraft();
      await guarded(async () => {
        state.workbench = await apiFetch(
          `/api/works/${state.selectedWorkId}/chapters/${chapter.id}/generate-outline`,
          {
            method: "POST",
            body: JSON.stringify({
              instructionText: refineDraft.instruction,
              rewriteMode: "outline_first",
            }),
          }
        );
        await refreshWorks();
      }, "已按澄清结果重新生成章节细纲。", "正在调用 AI 生成细纲，请稍候…");
      pushChatMessage(
        "assistant",
        `已按“${refineDraft.instruction}”重生成 ${chapter.title} 的细纲。若你认可这个方向，再继续说“直接出草稿”。`
      );
      renderChat();
      return;
    }

    if (normalized.includes("草稿") || normalized.includes("直接") || normalized.includes("重出")) {
      clearRefineDraft();
      const reviseExistingDraft = chapterHasDraft(chapter);
      await guarded(async () => {
        state.workbench = await requestDraftAction({
          workId: state.selectedWorkId,
          chapterId: chapter.id,
          chapter,
          instructionText: refineDraft.instruction,
          rewriteMode: "draft_direct",
          reviseMode: "revise_direct",
        });
        await refreshWorks();
        if (state.mode === "reading") {
          await refreshReading();
        }
      }, reviseExistingDraft ? “已按澄清结果修订章节草稿。” : “已按澄清结果重生成章节草稿。”, “正在调用 AI 生成草稿，请稍候…”);
      pushChatMessage(
        “assistant”,
        reviseExistingDraft
          ? `已按”${refineDraft.instruction}”基于当前版本修订 ${chapter.title} 的草稿。切到阅读态可以直接审看。`
          : `已按”${refineDraft.instruction}”为 ${chapter.title} 重出草稿。切到阅读态可以直接审看。`
      );
      renderChat();
      return;
    }

    pushChatMessage("assistant", "我还在等你二选一：先改细纲，还是直接重出草稿？");
    renderChat();
    return;
  }

  if (normalized.includes("细纲") || normalized.includes("outline")) {
    if (!chapter) {
      pushChatMessage("assistant", "当前还没有可推进的章节。");
      renderChat();
      return;
    }
    await guarded(async () => {
      state.workbench = await apiFetch(
        `/api/works/${state.selectedWorkId}/chapters/${chapter.id}/generate-outline`,
        {
          method: “POST”,
          body: JSON.stringify({}),
        }
      );
      await refreshWorks();
    }, “章节细纲已生成。”, “正在调用 AI 生成细纲，请稍候…”);
    pushChatMessage(“assistant”, `已按你的要求为 ${chapter.title} 生成细纲。你现在可以继续说”直接出草稿”。`);
    renderChat();
    return;
  }

  if (normalized.includes("草稿") || normalized.includes("draft")) {
    if (!chapter) {
      pushChatMessage("assistant", "当前还没有可推进的章节。");
      renderChat();
      return;
    }
    const reviseExistingDraft = chapterHasDraft(chapter);
    await guarded(async () => {
      state.workbench = await requestDraftAction({
        workId: state.selectedWorkId,
        chapterId: chapter.id,
        chapter,
      });
      await refreshWorks();
      if (state.mode === "reading") {
        await refreshReading();
      }
    }, reviseExistingDraft ? "章节草稿已修订。" : "章节草稿已生成。", "正在调用 AI 生成草稿，请稍候…");
    pushChatMessage(
      "assistant",
      reviseExistingDraft
        ? `已基于当前版本修订 ${chapter.title} 的草稿。你可以切到阅读态直接对比最新输出。`
        : `已为 ${chapter.title} 生成最新草稿。你可以切到阅读态直接审看。`
    );
    renderChat();
    return;
  }

  if (detectRefineIntent(text)) {
    if (!chapter) {
      pushChatMessage("assistant", "当前还没有可调整的章节。先选中一章，或先生成当前章内容。");
      renderChat();
      return;
    }
    updateRefineDraft({
      active: true,
      instruction: text,
      awaitingChoice: true,
    });
    pushChatMessage(
      "assistant",
      `收到，你想把 ${chapter.title} 调成“${text}”。当前我还需要你确认执行路径：先改细纲，还是直接重出草稿？`
    );
    renderChat();
    return;
  }

  if (normalized.includes("阅读")) {
    state.mode = "reading";
    await guarded(async () => {
      await refreshReading();
    });
    pushChatMessage("assistant", "已切到阅读态。现在右侧展示的是纯净正文视图。");
    renderChat();
    return;
  }

  if (normalized.includes("返回") || normalized.includes("工作台")) {
    state.mode = "workbench";
    await guarded(async () => {
      await refreshWorkbench();
    });
    pushChatMessage("assistant", "已回到工作台。你可以继续推进当前章。");
    renderChat();
    return;
  }

  if (normalized.includes("当前章") || normalized.includes("状态")) {
    const statusText = chapter
      ? `${chapter.title} 当前状态是 ${chapterStatusLabel(chapter.status)}。`
      : "当前还没有可推进章节。";
    pushChatMessage("assistant", `${statusText} 你可以继续说“给当前章生成细纲”或“直接出草稿”。`);
    renderChat();
    return;
  }

  const work = state.workbench?.work;
  pushChatMessage(
    "assistant",
    work
      ? `我已记住当前作品《${work.title}》。目前这层对话入口支持：生成细纲、生成或修订草稿、切阅读态、回工作台、查看当前章状态，以及先澄清再处理“改这一章”的请求。`
      : "当前还没有选中作品。"
  );
  renderChat();
}

async function init() {
  try {
    await apiFetch("/api/health");
    dom.healthBadge.textContent = "API 已连接";
    dom.healthBadge.classList.remove("muted");
  } catch (error) {
    dom.healthBadge.textContent = "API 不可用";
    setBanner(error.message || "无法连接后端", true);
    return;
  }

  await guarded(async () => {
    await refreshAll();
  });
}

dom.createWork.addEventListener("click", async () => {
  await guarded(async () => {
    const payload = await apiFetch("/api/works", {
      method: "POST",
      body: JSON.stringify({
        title: dom.createTitle.value,
        oneLinePitch: dom.createPitch.value,
        genre: dom.createGenre.value,
      }),
    });
    state.selectedWorkId = payload.work.id;
    state.selectedChapterId = payload.chapters[0]?.id || null;
    state.workbench = payload;
    state.mode = "workbench";
    if (state.chatByWorkId["__lobby__"]) {
      state.chatByWorkId[payload.work.id] = state.chatByWorkId["__lobby__"];
      delete state.chatByWorkId["__lobby__"];
    }
    dom.createTitle.value = "";
    dom.createPitch.value = "";
    dom.createGenre.value = "";
    await refreshWorks();
    renderWorkbench();
  }, "已创建作品立项底稿。");
});

dom.workList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-work-id]");
  if (!button) return;
  state.selectedWorkId = button.dataset.workId;
  state.selectedChapterId = null;
  state.selectedDecisionId = null;
  state.mode = "workbench";
  await guarded(async () => {
    await refreshWorkbench();
  });
});

dom.chapterList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-chapter-id]");
  if (!button) return;
  state.selectedChapterId = button.dataset.chapterId;
  state.selectedDecisionId = null;
  renderWorkbench();
});

dom.decisionList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-decision-id]");
  if (!card) return;
  const chapterId = card.dataset.decisionChapterId || "";
  const draftVersion = card.dataset.decisionDraftVersion || "";
  state.selectedDecisionId = card.dataset.decisionId || null;
  if (chapterId) {
    state.selectedChapterId = chapterId;
    state.mode = "workbench";
    const chapterTitle = chapterTitleById(chapterId);
    setBanner(
      draftVersion
        ? `已定位到 ${chapterTitle || "关联章节"}，对应草稿版本 v${draftVersion}。`
        : `已定位到 ${chapterTitle || "关联章节"}。`
    );
  }
  renderWorkbench();
  requestAnimationFrame(() => {
    scrollDecisionContextIntoView();
  });
});

dom.generateOutline.addEventListener("click", async () => {
  if (!state.selectedWorkId || !state.selectedChapterId) return;
  await guarded(async () => {
    state.workbench = await apiFetch(
      `/api/works/${state.selectedWorkId}/chapters/${state.selectedChapterId}/generate-outline`,
      {
        method: "POST",
        body: JSON.stringify({}),
      }
    );
    await refreshWorks();
  }, "章节细纲已生成。", "正在调用 AI 生成细纲，请稍候…");
});

dom.generateDraft.addEventListener("click", async () => {
  if (!state.selectedWorkId || !state.selectedChapterId) return;
  const chapter = currentWorkbenchChapter();
  const reviseExistingDraft = chapterHasDraft(chapter);
  await guarded(async () => {
    state.workbench = await requestDraftAction({
      workId: state.selectedWorkId,
      chapterId: state.selectedChapterId,
      chapter,
    });
    if (state.mode === "reading") {
      await refreshReading();
    }
    await refreshWorks();
  }, reviseExistingDraft ? "章节草稿已修订。" : "章节草稿已生成。", "正在调用 AI 生成草稿，请稍候…");
});

dom.toggleMode.addEventListener("click", async () => {
  if (!state.selectedWorkId) return;
  state.mode = state.mode === "workbench" ? "reading" : "workbench";
  await guarded(async () => {
    if (state.mode === "reading") {
      await refreshReading();
    } else {
      await refreshWorkbench();
    }
  });
});

dom.sendChat.addEventListener("click", async () => {
  const text = dom.chatInput.value;
  dom.chatInput.value = "";
  await handleChatIntent(text);
});

dom.chatInput.addEventListener("keydown", async (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    const text = dom.chatInput.value;
    dom.chatInput.value = "";
    await handleChatIntent(text);
  }
});

dom.chatSuggestions.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-chat-suggestion]");
  if (!button) return;
  await handleChatIntent(button.dataset.chatSuggestion);
});

dom.readingToc.addEventListener("click", (event) => {
  const button = event.target.closest("[data-reading-chapter-id]");
  if (!button) return;
  state.selectedChapterId = button.dataset.readingChapterId;
  state.selectedDecisionId = null;
  renderReading();
});

init();
