// B71 §16.14 确认/拒绝场景的共享常量（无依赖，供 driver/evidence/capture 共用，
// 避免 capture_evidence ↔ evidence 的循环 import）。
//
// 高风险来源与 frontend/slice-verify/external-ui-driver.mjs 的 au04 真实作者请求一致。
export const CONFIRMATION_REQUEST =
  "第01章：底层灵气账单 写得太平了，推翻重写这一章的正文草稿，保持为待采纳草稿。";

export const CONFIRMATION_MODES = Object.freeze({
  confirm: {
    action_type: "confirm_before_execute",
    label: "确认执行",
    receipt_action_type: "confirm_before_execute",
  },
  reject: {
    action_type: "reject_or_cancel_confirmation",
    label: "拒绝",
    receipt_action_type: "reject_or_cancel_confirmation",
  },
});

export const CONFIRMATION_CHECKPOINTS = Object.freeze([
  "start",
  // C6 采样窗口：拒绝/确认动作「点击前」与「收到决定后」的 canon 快照。
  "click-before",
  "decision-after",
  "after-confirm",
  "after-duplicate",
  "after-restore",
  "final",
]);
