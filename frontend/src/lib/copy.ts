/**
 * 集中化文案管理
 *
 * 规则来源：
 *   - docs/design-v2/ui-design/47-ui-copy-guidelines.md（UI 文案指南）
 *   - AGENTS.md § UI 设计驱动（Design-Driven）
 *
 * 约束：
 *   - 所有用户可见文字必须集中在此文件
 *   - 组件中禁止硬编码中文或英文 UI 文案
 *   - Canonical 英文术语（card_type / intent / state）不出现在面向作者的 UI 中
 *   - 新增文案前先核对 47-ui-copy-guidelines.md 的禁止用语表
 */

// ============================================================
// 通用
// ============================================================

export const APP_NAME = "AI Novel Studio";

export const BUTTON = {
  confirm: "确认",
  cancel: "取消",
  close: "关闭",
  save: "保存",
  delete: "删除",
  edit: "编辑",
  back: "返回",
  next: "下一步",
  submit: "提交",
  retry: "重试",
  copy: "复制",
  export: "导出",
  import: "导入",
  search: "搜索",
  filter: "筛选",
  reset: "重置",
  refresh: "刷新",
  more: "更多",
  expand: "展开",
  collapse: "收起",
  add: "添加",
  remove: "移除",
  create: "创建",
  update: "更新",
  archive: "归档",
  restore: "恢复",
  deprecate: "标记过期",
  lock: "锁定",
  unlock: "解锁",
} as const;

// ============================================================
// 状态
// ============================================================

export const STATUS = {
  loading: "加载中...",
  error: "出错了",
  empty: "暂无内容",
  noResults: "未找到匹配结果",
  connecting: "正在连接...",
  connected: "已连接",
  disconnected: "连接已断开",
  saving: "保存中...",
  saved: "已保存",
  deleting: "删除中...",
  deleted: "已删除",
  processing: "处理中...",
  completed: "已完成",
  failed: "失败",
  pending: "待处理",
  active: "进行中",
  archived: "已归档",
  deprecated: "已过期",
  locked: "已锁定",
} as const;

// ============================================================
// 卡片系统（docs/design-v2/ui-design/42-card-system.md）
// ============================================================

export const CARD = {
  clarification: {
    title: "需要澄清",
    description: "AI 需要更多信息才能继续",
  },
  confirmation: {
    title: "请确认",
    description: "请确认以下内容是否符合预期",
    confirmLabel: "确认执行",
    rejectLabel: "取消",
  },
  warning: {
    title: "注意",
    description: "以下内容可能存在问题",
  },
  checkpoint: {
    title: "检查点",
    description: "长跑任务已暂停，请决定下一步",
    resumeLabel: "继续执行",
    cancelLabel: "取消任务",
    branchLabel: "创建分支",
    pendingArtifacts: "待处理产物",
  },
  tentativeArtifact: {
    title: "待采纳",
    description: "AI 建议进行以下改动",
    acceptLabel: "确认创建",
    discardLabel: "放弃",
    editThenAcceptLabel: "修改后采纳",
    editDialogTitle: "修改后采纳",
    editDialogDescription: "编辑这段正文后再采纳；采纳的是你修改后的版本。",
    editPlaceholder: "在此修改正文…",
    editConfirmLabel: "采纳修改后的版本",
    editCancelLabel: "取消",
  },
  adoption: {
    title: "已采纳",
    description: "改动已应用到作品",
  },
  adoptionDecision: {
    acceptedTitle: "已采纳",
    acceptedDescription: "这条候选稿已写入作品状态，后续创作会以采纳结果为准。",
    discardedTitle: "已废弃",
    discardedDescription: "这条候选稿已从待处理列表移除，未写入作品事实。",
    editedAcceptedTitle: "已修改后采纳",
    editedAcceptedDescription: "系统已按修改意见采纳，原候选稿保留为来源记录。",
    unknownTitle: "已处理",
    unknownDescription: "这条候选稿已有处理结果，不再需要重复操作。",
    artifactFallbackTitle: "创作设定",
    openReadingModeLabel: "查看已采纳内容",
  },
  longRunProgress: {
    title: "长跑进度",
    description: "AI 正在执行长时间任务",
  },
  result: {
    title: "执行完成",
    description: "操作已完成",
  },
  failure: {
    title: "执行失败",
    description: "操作未能完成",
    retryLabel: "重试",
    discardLabel: "放弃",
  },
  escalation: {
    title: "需要关注",
    description: "此操作需要你的特别关注",
  },
} as const;

// ============================================================
// 工作台（docs/design-v2/ui-design/41-workbench-layout.md）
// ============================================================

export const WORKBENCH = {
  userDisplayName: "你",
  assistantDisplayNameDefault: "AI",
  assistantDisplayNameAction: "AI 名称",
  assistantDisplayNameTitle: "AI 显示名",
  assistantDisplayNameDescription: "只改变当前作品里的界面称呼。",
  assistantDisplayNameField: "显示名",
  assistantDisplayNamePlaceholder: "AI",
  assistantDisplayNameSave: "保存名称",
  assistantDisplayNameReset: "恢复默认",
  assistantDisplayNameSaving: "保存中",
  assistantDisplayNameFailure: "名称保存失败，请重试。",
  inputPlaceholder: "输入你的想法、问题或指令...",
  send: "发送",
  thinking: "思考中...",
  emptyState: "开始对话，创作你的作品",
  welcomeMessage:
    "欢迎使用 AI Novel Studio！\n\n本产品需要连接大语言模型（LLM）才能工作。\n请确保 LM Studio 已启动并加载模型（默认端口 1234）。\n\n你可以这样开始：\n• 「我想创建一部玄幻小说」\n• 「写一本都市小说，核心卖点是商战复仇」\n• 「帮我创作一部科幻小说，目标读者是大学生」\n\n输入你的想法，我们开始创作吧！",
  startupFailurePrefix: "作品上下文加载失败，工作台未连接。",
  startupFailureLoadWork: "无法获取或创建作品：",
  startupFailureResumeSession: "无法恢复作品会话：",
  startupFailureJoinMismatch: "Channel 返回的作品/会话与启动上下文不一致：",
  sendFailure: "发送失败，请重试。",
  candidatePanelTitle: "候选创作方向",
  candidateContinueLabel: "继续聊这个方向",
  candidateContinueTitle: "把这个候选作为下一轮探索上下文，不会写入作品设定。",
  candidateAdoptLabel: "采用这个方向",
  candidateAdoptTitle: "提交服务端授权的采纳动作，重新经过采纳边界评估。",
  frameBadges: {
    creativeExploration: "探索方向",
    executionCandidate: "生成草稿",
    casualReply: "自然回复",
    questionAnswer: "回答问题",
    metaDiscussion: "创作讨论",
    confirmationAnswer: "确认回合",
    fallback: "本轮回应",
  },
  frameBadgeTitle: (label: string, goal: string | null) =>
    goal ? `${label}：${goal}` : label,
  workMenuTitle: "作品",
  workMenuCurrent: "当前",
  workMenuCreate: "新建作品",
  workMenuRefresh: "刷新作品列表",
  workMenuSwitching: "切换中",
  workMenuEmpty: "暂无作品",
  unnamedWorkTitle: "未命名作品",
  switchFailurePrefix: "作品切换失败：",
  createWorkFailure: "新建作品失败，请重试。",
  adoptionIncomplete: "采纳未完成，请查看系统提示后重试。",
  actionFailure: "操作失败，请重试。",
  actionUnavailable: "当前动作不可用，请刷新或继续对话。",
  actionConfirm: "确认执行",
  actionReject: "拒绝",
  actionCancel: "取消",
  actionAnswer: "回答",
  archiveRailTitle: "作品档案",
  archiveRailOpen: "打开档案",
  archiveRailDetail: "查看详情",
  pendingAdoptionsPrefix: "待采纳",
  sessionSearchPlaceholder: "搜索会话",
  sessionReadOnlyTitle: "历史会话",
  sessionReadOnlyDescription: "正在只读查看历史 transcript。新输入仍会回到当前活跃会话。",
  sessionBackToActive: "返回当前会话",
  sessionBranchFromHistory: "从这里继续",
  sessionBranchTitle: (title: string) => `${title} 的延续`,
  sessionBranchFailure: "从历史会话继续失败，请重试。",
  sessionArchive: "归档会话",
  sessionArchiveFailure: "会话归档失败，请重试。",
  sessionOpenFailure: "会话打开失败，请重试。",
} as const;

// ============================================================
// 决策溯源（docs/design-v3/acceptance/author/AU-07-trace-and-replay.md）
// ============================================================

export const TRACE = {
  actionLabel: "为什么",
  actionTitle: "查看这轮回应的依据",
  contextLabel: "参考来源",
  noContext: "本轮没有使用额外作品上下文。",
  detailLabel: "补充说明",
  integrityNote: "解释来自本轮已保存的 trace 摘要，不会重新调用模型或改写作品。",
  previousDialogueSummary: (topic: string) => `上一轮围绕「${topic}」展开，AI 已给出回应。`,
  previousAuthorMention: (topic: string) => `上一轮作者提到「${topic}」。`,
  previousAssistantReply: "上一轮 AI 已给出回应。",
  decisions: {
    replyOnly: "自然回复",
    exploration: "探索方向",
    executionCandidate: "生成草稿",
    downgrade: "降级为对话",
    confirmationRequired: "需要确认",
    clarificationRequired: "需要补充信息",
    rejected: "已拒绝执行",
    recovery: "已降级恢复",
    toolAllowed: "允许工具",
    toolDispatched: "已调用工具",
    adoptTentative: "已采用候选",
    unknown: "已记录",
  },
  reasons: {
    noToolNeeded: "本轮只需要自然语言回应，不需要调用工具或写入作品状态。",
    exploratoryOnly: "本轮是在探索创作方向，候选内容不会自动写入作品档案、设定或正文。",
    userRequestedDiscussion: "你提出的是讨论或解释请求，系统没有执行写入动作。",
    toolWasDispatched: "本轮调用了创作工具，工具结果仍需通过卡片确认后才会进入作品。",
    microPlanEvaluated: "系统先评估了执行计划，再按权限和范围决定是否继续。",
    microPlanFailed: "执行计划生成失败，系统已降级为安全的自然回复。",
    confirmationRequired: "本轮需要你的确认，系统不会在确认前执行高影响操作。",
    clarificationRequired: "系统缺少必要信息，需补充后才能继续推进。",
    rejected: "系统拒绝执行本轮请求，并保留了拒绝原因摘要。",
    safeFallback: "系统保留了本轮的安全解释摘要。",
  },
  gates: {
    actionScope: "当前请求超出本轮可执行范围。",
    plannerBoundary: "计划没有通过执行边界检查。",
    authorityBudget: "权限或预算策略要求先暂停。",
    confirmationRequired: "此操作需要作者明确确认。",
    generic: "系统记录了一个执行门禁原因。",
  },
  reasonCodes: {
    gatesPassed: "执行门禁已通过。",
    candidateAdoptedAsTentative: "候选内容先作为待采纳草稿保存。",
    toolResultNotAdoption: "工具结果不是自动采纳的作品事实。",
    generic: "系统记录了一个内部原因，作者视图保留为安全摘要。",
  },
  contextSources: {
    currentWork: "当前作品背景",
    recentDialogue: "近期对话",
    memory: "已确认设定",
    workArchive: "作品档案",
    sessionTranscript: "当前会话记录",
    other: "其他安全来源",
  },
  recoveryApplied: "系统已使用降级恢复策略。",
  toolUsed: (name: string) => `本轮使用了工具：${name}。`,
  toolWithStatus: (name: string, status: string) => `本轮使用了工具：${name}，结果状态为 ${status}。`,
} as const;

export function candidateContinuationText(title: string, pitch: string): string {
  return `继续聊「${title}」这个方向：${pitch}`;
}

export const WORKSPACE_RUNTIME = {
  currentWorkTitle: "当前作品",
  connectionBooting: "启动中",
  connectionConnecting: "正在连接",
  connectionConnected: "已连接",
  connectionDegraded: "连接不稳定",
  connectionFailed: "离线",
} as const;

// ============================================================
// 作品档案（docs/design-v2/ui-design/43-structure-panel.md）
// ============================================================

export const STRUCTURE_PANEL = {
  title: "作品档案",
  noWork: "尚未创建设定",
  unnamedWork: "未命名作品",
  stats: {
    volumes: "卷",
    drafts: "草稿",
    characters: "角色",
    memories: "设定",
    pending: "待采纳",
  },
  tabs: {
    outline: "大纲与结构",
    character: "角色",
    foreshadowing: "伏笔",
    rule: "经验规则",
  },
  pendingSection: "待采纳内容",
  pendingLabel: "待采纳",
  pendingFallbackTitle: "待审核内容",
  pendingFallbackContent: "等待审核中的内容",
  confirmedForeshadowingSection: "已确认设定",
  acceptSetting: "采纳设定",
  requestRevision: "提出修改",
  detailTitle: "详情",
  detailHint: "详情为当前作品的只读档案，修改需回到工作台对话处理。",
  viewDetail: "查看详情",
  selected: "已选中",
  close: "关闭档案",
  detailRows: {
    role: "身份",
    aliases: "别名",
    state: "状态",
    updatedAt: "最后更新",
    type: "类型",
    scope: "范围",
    source: "来源",
    weight: "权重",
    confidence: "置信度",
    referenceCount: "引用次数",
    version: "版本",
    tags: "标签",
    protection: "保护",
  },
  detailValues: {
    adopted: "已采纳",
    recallable: "可召回",
    notRecallable: "不进入普通召回",
    locked: "已锁定",
  },
  memoryTypeLabels: {
    FORESHADOWING: "伏笔",
    PLOT_FACT: "剧情事实",
    WORLD_RULE: "世界规则",
    CONSTRAINT: "约束",
    STYLE_RULE: "风格规则",
    IDEA: "灵感",
  },
  memoryScopeLabels: {
    WORK: "整部作品",
    VOLUME: "当前卷",
    ARC: "当前故事线",
    CHAPTER: "当前章节",
    SCENE: "当前场景",
    GLOBAL: "全局",
  },
  sourceTypeLabels: {
    AUTHOR_CONFIRMED: "作者确认",
    AI_EXTRACTED: "AI 提取",
    IMPORTED: "导入",
    SYSTEM: "系统",
  },
  outlineEmptyTitle: "大纲与结构",
  acceptedChapterPlanSection: "已采纳章节计划",
  chapterCountUnit: "章",
  generateChapterDraft: "生成正文草稿",
  chapterPendingBadge: "待补足",
  chapterWrittenPrefix: "已写",
  chapterWordsUnit: "字",
  outlineEmptyWithWork: "在对话中说「生成章节大纲」或「规划分卷结构」，AI 会帮你整理作品的骨架。",
  outlineEmptyNoWork: "先在工作台创建作品，AI 会帮你搭建大纲和分卷结构。",
  startPlanning: "开始规划",
  noChapter: "暂无章节",
  characterEmptyTitle: "角色档案",
  characterEmptyWithWork: "在对话中说「创建角色」或「分析已有角色」，AI 会提取角色信息并建档。",
  characterEmptyNoWork: "先在工作台创建作品，AI 会在创作过程中自动提取角色信息。",
  createCharacter: "创建角色",
  foreshadowingEmptyTitle: "暂无伏笔设定",
  foreshadowingEmptyDesc: "在对话中说「创建主线大纲」或「构建世界观」，AI 会生成设定内容。",
  ruleEmptyTitle: "经验规则",
  ruleEmptyDesc: "在对话中说「导入风格样本」或「构建世界观」，AI 会生成写作规则和设定约束。",
  newAction: "发起新操作",
  actionHint: "如需深度修改，请在工作台对话中提出。",
  aliasPrefix: "别名：",
} as const;

// ============================================================
// 阅读模式
// ============================================================

export const READING = {
  totalWordsLabel: "全书有效字数",
  chapterWordsLabel: "本章有效字数",
  wordsUnit: "字",
  shortChapterBadge: "短章",
  emptyChapterBadge: "待补足",
  milestoneProgressLabel: "P1 进度",
  milestoneMetLabel: "已达 P1 目标",
  chaptersBelowMinSuffix: "章待补足",
  emptyChapterBody: "本章尚无已采纳正文，待补足。",
  sceneEmptyBody: "（该场景暂无已采纳正文）",
} as const;

// ============================================================
// Memo 系统
// ============================================================

export const MEMORY = {
  pageTitle: "记忆管理",
  createButton: "+ 新建记忆",
  backToWorkbench: "返回工作台",
  workbenchEntry: "记忆",
  createTitle: "新建记忆",
  editTitle: "编辑记忆",
  detailTitle: "记忆详情",
  noContent: "暂无记忆",
  searchPlaceholder: "搜索记忆...",
  typeLabel: "类型",
  scopeLabel: "作用域",
  statusLabel: "状态",
  confirmAction: "确认",
  lockAction: "锁定",
  unlockAction: "解锁",
  deprecateAction: "标记过期",
  archiveAction: "归档",
  weightLabel: "权重",
  validityLabel: "有效范围",
} as const;

// ============================================================
// v3 Workbench (VS-07)
// ============================================================

export const WORKBENCH_V3 = {
  welcomeMessage:
    "欢迎使用 AI Novel Studio v3！\n\n" +
    "这是一款对话式小说创作工具。你可以：\n" +
    "• 聊聊创作方向，我会帮你探索\n" +
    "• 让我帮你生成角色设定、剧情草案\n" +
    "• 需要确认的重要操作我会明确提示\n\n" +
    "输入你的想法，开始创作吧！",
  inputPlaceholder: "输入你的想法...（例如：我想写一部赛博修仙小说）",
  sendButton: "发送",
  thinking: "AI 思考中...",
  connectionOffline: "服务离线",
  connectionOnline: "已连接",
  llmChecking: "检测中…",
  llmConnected: "LLM 已连接",
  llmDisconnected: "LLM 未连接",
  llmProviderUnknown: "未配置模型",
  phaseCompleted: "已完成",
  phaseAwaiting: "等待你的操作",
  statusConversational: "对话中",
  statusNeedsClarification: "需要补充信息",
  statusNeedsConfirmation: "需要确认",
  actionConfirm: "确认",
  actionReject: "拒绝",
  actionCancel: "取消",
  actionContinue: "继续对话",
  candidateTitle: "候选方向",
  errorSendFailed: "发送失败，请重试。",
  errorActionFailed: "操作失败，请重试。",
} as const;
