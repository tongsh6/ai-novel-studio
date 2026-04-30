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
    description: "长跑已暂停，请查看进度",
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
  longRunProgress: {
    title: "长跑进度",
    description: "AI 正在执行长时间任务",
  },
} as const;

// ============================================================
// 工作台（docs/design-v2/ui-design/41-workbench-layout.md）
// ============================================================

export const WORKBENCH = {
  inputPlaceholder: "输入你的想法、问题或指令...",
  send: "发送",
  emptyState: "开始对话，创作你的作品",
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
