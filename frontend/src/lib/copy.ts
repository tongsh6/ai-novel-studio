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
  inputPlaceholder: "输入你的想法、问题或指令...",
  send: "发送",
  emptyState: "开始对话，创作你的作品",
  startupFailurePrefix: "作品上下文加载失败，工作台未连接。",
  startupFailureLoadWork: "无法获取或创建作品：",
  startupFailureResumeSession: "无法恢复作品会话：",
  startupFailureJoinMismatch: "Channel 返回的作品/会话与启动上下文不一致：",
  sendFailure: "发送失败，请重试。",
  candidatePanelTitle: "候选创作方向",
  candidateContinueLabel: "继续聊这个方向",
  candidateContinueTitle: "把这个候选作为下一轮探索上下文，不会写入作品设定。",
  workMenuTitle: "作品",
  workMenuCurrent: "当前",
  workMenuCreate: "新建作品",
  workMenuRefresh: "刷新作品列表",
  workMenuSwitching: "切换中",
  workMenuEmpty: "暂无作品",
  unnamedWorkTitle: "未命名作品",
  switchFailurePrefix: "作品切换失败：",
  createWorkFailure: "新建作品失败，请重试。",
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
// Memo 系统
// ============================================================

export const MEMORY = {
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
