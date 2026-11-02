// B71 CP4b pending 对话候选作者边界的纯判据。
//
// 本模块只消费外部驱动/AX/真实 WS 帧/Provider 记录/实际请求 scope facts 与
// 只读 checkpoint 事实；不做 I/O、不启 GUI、不按“最新/首个/末个”猜身份。
// 关键边界：
// - 保存/放弃/Why 都按候选可见标题+正文定位；真实 WKWebView 扁平 AX 树里按钮与候选
//   article 是同级兄弟，故路径归属不成立时按「同级兄弟顺序 + 用户消息 marker」切出本
//   消息块，块内唯一命中并禁止借用兄弟候选按钮；缺失/多义/跨块/不可见 fail closed；
// - author_action 帧、ACK、action_result、动作 TurnResult 各自按请求/广播身份唯一绑定；
// - revision 全 item 集只与同次 writer 响应同 item_id 字段逐字比较；
// - 新请求必须消费真实 ACCEPTED/DISCARDED refs/状态，回复必须等于同次 Provider 原字节；
// - canon 分段只允许真实作者动作带来的精确 memory/receipt 增量，其余事实逐表不变。
import { compareAuthoringCanonSnapshots } from "./authoring_canon_evidence.mjs";
import {
  actionResultBindsArtifact,
  actionResultIdentityFor,
} from "./adoption_contract.mjs";

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const nonBlank = (value) => typeof value === "string" && value.trim() !== "";
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const allOf = (...values) => values.every(Boolean);
function get(value, key) {
  return value !== null && typeof value === "object" ? value[key] : undefined;
}

// 等待循环只把“本窗口内尚未出现”当缺失；冲突/非法仍是即时失败，不能靠错误文案判别。
function waitMiss(message) {
  const error = new Error(message);
  error.code = "B71_PENDING_NOT_FOUND";
  return error;
}

function conflict(message) {
  const error = new Error(message);
  error.code = "B71_PENDING_CONFLICT";
  return error;
}

export function isPendingWaitMiss(error) {
  return error?.code === "B71_PENDING_NOT_FOUND";
}

export const PENDING_REVISION_MESSAGE =
  "请修改现有候选，把沈砚改成林渡，其余内容和资料校验标识保留；生成修订候选，不要保存。";
export const PENDING_FOLLOWUP_MESSAGE = "资料处理进度怎么样？";
export const PENDING_SOURCE_MESSAGE_PREFIX =
  "把这份大纲直接存档为作品设定：主角沈砚经营旧书铺。校验标识";
export const PENDING_PROFILE = "judgment_loop_v1";
export const PENDING_CHECKPOINTS = Object.freeze([
  "start",
  "after-source",
  "after-revision",
  "before-why",
  "after-why",
  "after-accept",
  "after-discard",
  "after-restore",
  "final",
]);

const PROSE_TYPES = new Set(["prose_fragment", "scene_draft"]);
const ARCHIVE_TYPES = new Set([
  "character_seed",
  "character_evolution_seed",
  "world_setting",
  "world_rule_seed",
  "foreshadowing_seed",
  "style_rule_seed",
  "constraint_seed",
]);
const KNOWN_TYPES = new Set([
  ...PROSE_TYPES,
  ...ARCHIVE_TYPES,
  "outline_draft",
  "work_skeleton_suggestion",
  "foreshadowing_resolution",
  "prose_formatting_plan",
]);

export function pendingSourceMessage(nonce) {
  if (!nonBlank(nonce)) throw new Error("pending_source_message: nonce 必须非空");
  return `${PENDING_SOURCE_MESSAGE_PREFIX}${nonce}。`;
}

// UI 文案来自真实 copy contract；未知类型不能落到通用“保存”按钮上猜。
export function actionLabelsFor(artifactType, { revision = false } = {}) {
  if (!KNOWN_TYPES.has(artifactType)) {
    throw new Error(`pending_action_label: 未知 artifact 类型 ${String(artifactType)}`);
  }
  if (PROSE_TYPES.has(artifactType)) {
    return revision
      ? { accept: "保存修订稿", discard: "放弃修订稿" }
      : { accept: "保存为章节正文", discard: "不保存" };
  }
  if (artifactType === "outline_draft") return { accept: "保存到大纲", discard: "不保存" };
  if (artifactType === "work_skeleton_suggestion") {
    return { accept: "采纳为全书规划", discard: "不保存" };
  }
  if (artifactType === "foreshadowing_resolution") {
    return { accept: "确认伏笔已回收", discard: "不保存" };
  }
  if (artifactType === "prose_formatting_plan") {
    return { accept: "应用分段方案", discard: "放弃分段方案" };
  }
  return { accept: "保存到作品档案", discard: "不保存" };
}

// AX 节点可见语义：title/desc/value 都是作者可见文本；不读隐藏 metadata。
function nodeText(node) {
  return [node?.title, node?.desc, node?.value]
    .filter((part) => part !== null && part !== undefined && String(part).trim() !== "")
    .join(" ");
}

function isVisible(node) {
  return Array.isArray(node?.frame) && node.frame.length >= 4 &&
    node.frame[1] > 0 && node.frame[2] > 0 && node.frame[3] > 0;
}

function inScope(node, scopePath) {
  const path = String(node?.path ?? "");
  return path === scopePath || path.startsWith(`${scopePath}/`);
}

// ── 真实 WKWebView 扁平 AX 树的消息块归属 ──────────────────────────────────
//
// 真实 Tauri/WKWebView 的 AX 树把候选卡（title/body/rationale）、Why 按钮与候选动作
// 按钮暴露为**同一 AXWebArea 父级下的同级兄弟**，不存在包含三者的候选容器（真实批次
// cp4b-pending-02 原始 dump：Why=…/30、候选 article=…/33、动作按钮=…/34…36）。
// 因此「按 item 自身路径向上找祖先容器」的模型在真实树上只能停在 item 子树，动作按钮
// 永远不在 scope 内（pending 批次实测 action_missing）。
//
// 消息块模型：以 item 所在父级的兄弟顺序为源，用真实可见的说话人标记（用户消息
// marker「你」）与对话结束标记（输入框/本次只做一步/发送）切出**本消息块**；块内还需
// 排除其它已知候选的可见标题/正文（禁止借用兄弟候选按钮）。块内匹配必须唯一；
// 命中但不可见时返回 action_not_visible（调用方可先滚动揭示再重试），不向更外层借用。
const SPEAKER_MARKERS = new Set(["你", "AI"]);
const USER_SPEAKER = "你";

function parentPath(path) {
  return String(path).split("/").slice(0, -1).join("/");
}

function lastPathIndex(path) {
  return Number(String(path).split("/").at(-1));
}

function siblingNodes(nodes, parent) {
  return nodes
    .filter((node) => isObject(node) && typeof node.path === "string" && parentPath(node.path) === parent)
    .sort((left, right) => lastPathIndex(left.path) - lastPathIndex(right.path));
}

function speakerMarker(nodes, node) {
  if (node?.role !== "AXGroup") return null;
  const texts = siblingNodes(nodes, node.path).map(nodeText).filter(nonBlank);
  if (texts.length !== 1) return null;
  return SPEAKER_MARKERS.has(texts[0]) ? texts[0] : null;
}

function conversationEndMarker(node) {
  if (node?.role === "AXTextField" || node?.role === "AXCheckBox") return true;
  return node?.role === "AXButton" && nodeText(node) === "发送";
}

// 在 levelPath 这一层，把 item 的该层祖先切进「你」(用户消息) 与下一消息/输入区之间。
function messageBlockAt(nodes, levelPath, itemScopePath) {
  const articlePath = ancestors(itemScopePath).find((path) => parentPath(path) === levelPath);
  if (!articlePath) return null;
  const siblings = siblingNodes(nodes, levelPath);
  const index = siblings.findIndex((node) => node.path === articlePath);
  if (index < 0) return null;
  let start = 0;
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    if (speakerMarker(nodes, siblings[cursor]) === USER_SPEAKER) { start = cursor; break; }
  }
  let end = siblings.length - 1;
  for (let cursor = index + 1; cursor < siblings.length; cursor += 1) {
    if (speakerMarker(nodes, siblings[cursor]) === USER_SPEAKER || conversationEndMarker(siblings[cursor])) {
      end = cursor - 1;
      break;
    }
  }
  const paths = siblings.slice(start, end + 1).map((node) => node.path);
  if (paths.length === 0) return null;
  return { level: levelPath, paths };
}

function inMessageBlock(node, block) {
  if (!isObject(node) || typeof node.path !== "string") return false;
  return block.paths.some((path) => node.path === path || node.path.startsWith(`${path}/`));
}

function blockContainsText(nodes, block, value) {
  return nonBlank(value) && nodes.some((node) => inMessageBlock(node, block) && nodeText(node) === value);
}

function foreignItemInBlock(nodes, block, { itemTitle, itemBody }, knownItems) {
  return (knownItems ?? []).find(
    (item) =>
      isObject(item) &&
      !(item.itemTitle === itemTitle && item.itemBody === itemBody) &&
      (blockContainsText(nodes, block, item.itemTitle) || blockContainsText(nodes, block, item.itemBody)),
  );
}

// 只有路径模型不成立时才尝试消息块模型；命中但不可见/禁用/多义直接失败关闭，不向更外层借用。
function locateInMessageBlock(nodes, itemScopePath, { label, matcher, knownItems, itemTitle, itemBody }) {
  for (const levelPath of ancestors(itemScopePath).slice(1)) {
    const block = messageBlockAt(nodes, levelPath, itemScopePath);
    if (!block) continue;
    const foreign = foreignItemInBlock(nodes, block, { itemTitle, itemBody }, knownItems);
    if (foreign) return { ok: false, reason: "foreign_item_in_block", foreign: foreign.itemTitle ?? null };
    const matches = nodes.filter(
      (node) => node?.role === "AXButton" && inMessageBlock(node, block) && matcher(nodeText(node), label, node),
    );
    if (matches.length === 0) continue;
    if (matches.length > 1) return { ok: false, reason: "action_ambiguous", count: matches.length };
    if (matches[0].enabled === false) return { ok: false, reason: "action_disabled" };
    if (!isVisible(matches[0])) return { ok: false, reason: "action_not_visible" };
    return {
      ok: true,
      button: matches[0],
      scope_path: block.paths[0],
      item_path: itemScopePath,
    };
  }
  return { ok: false, reason: "action_missing" };
}

function ancestors(path) {
  const parts = String(path).split("/").filter(Boolean);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/")).reverse();
}

function candidateScopes(nodes, titleNodes, bodyNodes) {
  return nodes.filter((node) => {
    const titles = titleNodes.filter((candidate) => inScope(candidate, node?.path)).length;
    const bodies = bodyNodes.filter((candidate) => inScope(candidate, node?.path)).length;
    return titles > 0 && bodies > 0;
  });
}

function deepestScopes(candidates) {
  const depth = (node) => String(node?.path).split("/").length;
  const deepest = Math.max(...candidates.map(depth));
  return candidates.filter((node) => depth(node) === deepest);
}

// 标题+正文唯一确定候选 item 的最深 AX 结构；同文本多实例直接失败。
export function locatePendingItem(nodes, { itemTitle, itemBody } = {}) {
  if (!Array.isArray(nodes)) return { ok: false, reason: "nodes_missing" };
  if (!nonBlank(itemTitle) || !nonBlank(itemBody)) return { ok: false, reason: "item_input_missing" };
  const titleNodes = nodes.filter((node) => nodeText(node) === itemTitle);
  const bodyNodes = nodes.filter((node) => nodeText(node) === itemBody);
  if (titleNodes.length === 0 || bodyNodes.length === 0) {
    return { ok: false, reason: "item_missing" };
  }
  const scopes = deepestScopes(candidateScopes(nodes, titleNodes, bodyNodes));
  if (scopes.length !== 1) return { ok: false, reason: "item_ambiguous" };
  return { ok: true, scope: scopes[0], title_nodes: titleNodes.length, body_nodes: bodyNodes.length };
}

function actionButtons(nodes, scopePath, label, matcher) {
  return nodes.filter(
    (node) =>
      node?.role === "AXButton" &&
      inScope(node, scopePath) &&
      isVisible(node) &&
      matcher(nodeText(node), label, node),
  );
}

function isSameItem(item, { itemTitle, itemBody }) {
  return item?.itemTitle === itemTitle && item?.itemBody === itemBody;
}

function visibleTextInScope(nodes, scopePath, value) {
  return nodes.some((node) => inScope(node, scopePath) && nodeText(node) === value);
}

function foreignItemInScope(nodes, scopePath, item) {
  return allOf(
    nonBlank(item?.itemTitle),
    nonBlank(item?.itemBody),
    visibleTextInScope(nodes, scopePath, item?.itemTitle) ||
      visibleTextInScope(nodes, scopePath, item?.itemBody),
  );
}

// 候选所属结构的上界：从 item 自身结构向上，遇到任何其它已知候选的可见标题/正文
// 即停止。这样不会在共享列表/根节点里借用兄弟候选按钮；不靠 maxDepth/坐标。
function ownedScope(nodes, itemScope, knownItems, target) {
  let boundary = itemScope.path;
  for (const scopePath of ancestors(itemScope.path)) {
    if (scopePath === itemScope.path) continue;
    if (knownItems.some((item) => !isSameItem(item, target) && foreignItemInScope(nodes, scopePath, item))) {
      break;
    }
    boundary = scopePath;
  }
  return boundary;
}

function locateKnownContext(nodes, { itemTitle, itemBody, knownItems }) {
  if (!Array.isArray(nodes)) return { ok: false, reason: "nodes_missing" };
  const item = locatePendingItem(nodes, { itemTitle, itemBody });
  if (!item.ok) return item;
  if (!Array.isArray(knownItems) || knownItems.length === 0) {
    return { ok: false, reason: "known_items_missing" };
  }
  return {
    ok: true,
    item,
    boundary: ownedScope(nodes, item.scope, knownItems, { itemTitle, itemBody }),
  };
}

function locateOwnedButton(nodes, { itemTitle, itemBody, knownItems, label, matcher } = {}) {
  const context = locateKnownContext(nodes, { itemTitle, itemBody, knownItems });
  if (!context.ok) return context;
  const buttons = actionButtons(nodes, context.boundary, label, matcher);
  if (buttons.length > 1) return { ok: false, reason: "action_ambiguous", count: buttons.length };
  if (buttons.length === 0) {
    // 真实扁平 AX 树里 item 子树不含 Why/动作按钮：改用同级消息块模型，仍要求唯一、
    // 可见、未禁用，并在块内排除其它已知候选（不借兄弟候选按钮）。
    return locateInMessageBlock(nodes, context.item.scope.path, {
      label,
      matcher,
      knownItems,
      itemTitle,
      itemBody,
    });
  }
  if (buttons[0].enabled === false) return { ok: false, reason: "action_disabled" };
  return {
    ok: true,
    button: buttons[0],
    scope_path: context.boundary,
    item_path: context.item.scope.path,
  };
}

export function locateScopedButton(nodes, { itemTitle, itemBody, label, knownItems } = {}) {
  if (!nonBlank(label)) return { ok: false, reason: "label_missing" };
  return locateOwnedButton(nodes, {
    itemTitle,
    itemBody,
    knownItems,
    label,
    // 真实按钮的可见名来自 title（desc 是说明文案）；兼容无 desc 的纯 title 节点。
    matcher: (text, want, node) => node?.title === want || text === want,
  });
}

export function locateWhyButton(nodes, { itemTitle, itemBody, knownItems } = {}) {
  return locateOwnedButton(nodes, {
    itemTitle,
    itemBody,
    knownItems,
    label: "为什么",
    matcher: (text) => text.includes("为什么"),
  });
}

function requireTurnId(turnResult) {
  const turnId = get(turnResult, "turn_id");
  if (!nonBlank(turnId)) throw new Error("pending_action: TurnResult 缺 turn_id");
  return turnId;
}

function actionFieldsValid(action, turnId) {
  const fields = ["action_id", "idempotency_key", "source_turn_ref", "target_ref"];
  if (!fields.every((field) => nonBlank(action[field]))) {
    throw new Error("pending_action: action_id/idempotency_key/source_turn_ref/target_ref 缺失");
  }
  if (action.source_turn_ref !== turnId) {
    throw new Error("pending_action: source_turn_ref 与 TurnResult 不一致");
  }
  if (action.enabled === false) throw new Error("pending_action: action enabled=false");
  return action;
}

// 动作只能来自当前 TurnResult 的真实 available_actions，且 source/target 精确绑定。
export function selectPendingAction(turnResult, { artifactId, actionType } = {}) {
  if (!allOf(nonBlank(artifactId), nonBlank(actionType))) {
    throw new Error("pending_action: artifactId/actionType 必须非空");
  }
  const turnId = requireTurnId(turnResult);
  const matches = list(turnResult.available_actions).filter(
    (action) => get(action, "action_type") === actionType && get(action, "target_ref") === artifactId,
  );
  if (matches.length !== 1) {
    throw new Error(`pending_action: ${actionType}/${artifactId} 必须唯一，实测 ${matches.length}`);
  }
  return actionFieldsValid(matches[0], turnId);
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

const same = (left, right) => canonicalJson(left) === canonicalJson(right);

function actionFields(action) {
  return {
    action_id: get(action, "action_id"),
    action_type: get(action, "action_type"),
    idempotency_key: get(action, "idempotency_key"),
    source_turn_ref: get(action, "source_turn_ref"),
    target_ref: get(action, "target_ref"),
  };
}

function requireWindow({ topic, since }, label) {
  if (!nonBlank(topic)) throw new Error(`${label}: 缺 owning topic`);
  if (!nonBlank(since)) throw new Error(`${label}: 缺 since`);
}

function frameRecord(record, direction) {
  if (get(record, "direction") !== direction) return null;
  const frame = get(record, "frame");
  if (!Array.isArray(frame) || frame.length < 5) return null;
  return frame;
}

function frameEventRecord(record, direction, topic, event) {
  const frame = frameRecord(record, direction);
  if (!frame) return null;
  return allOf(get(frame, 2) === topic, get(frame, 3) === event) ? frame : null;
}

function within(record, since) {
  const at = get(record, "at");
  return allOf(typeof at === "string", at >= since);
}

function conflictAction(actual, expected) {
  if (same(actual, expected)) return false;
  if (actual.action_id === expected.action_id) return true;
  return allOf(
    actual.source_turn_ref === expected.source_turn_ref,
    actual.target_ref === expected.target_ref,
  );
}

export function actionFrame(wire, { topic, since, action } = {}) {
  requireWindow({ topic, since }, "pending_action_frame");
  const expected = actionFields(action);
  if (!allOf(nonBlank(expected.action_id), nonBlank(expected.target_ref))) {
    throw new Error("pending_action_frame: 动作身份缺失");
  }
  const candidates = list(wire).filter((record) => {
    const frame = frameEventRecord(record, "sent", topic, "author_action");
    return allOf(frame, within(record, since), isObject(get(get(frame, 4), "action")));
  });
  const exact = candidates.filter((record) => same(actionFields(get(get(record, "frame"), 4).action), expected));
  const conflicts = candidates.filter((record) =>
    conflictAction(actionFields(get(get(record, "frame"), 4).action), expected));
  if (conflicts.length > 0) {
    throw conflict(
      `pending_action_frame: 动作 source/target/idempotency 冲突（实测 ${exact.length} exact / ${conflicts.length} conflict）`,
    );
  }
  if (exact.length !== 1) throw waitMiss(`pending_action_frame: author_action 必须恰好一条，实测 ${exact.length}`);
  return exact[0];
}

function replyIdentity(frame) {
  const source = get(frame, "frame");
  const identity = [get(source, 0), get(source, 1), get(source, 2)];
  if (identity.some((part) => !nonBlank(part))) throw new Error("pending_action_ack: 请求身份缺失");
  return identity;
}

function replyRecord(record, identity, since) {
  const frame = frameEventRecord(record, "received", identity[2], "phx_reply");
  if (!frame) return null;
  const sameRequest = allOf(
    get(frame, 0) === identity[0],
    get(frame, 1) === identity[1],
    within(record, since),
  );
  return sameRequest ? frame : null;
}

function ackResponse(body) {
  const response = get(body, "response");
  if (get(body, "status") !== "ok") throw new Error("pending_action_ack: ACK 未确认受理");
  if (get(response, "received") !== true) throw new Error("pending_action_ack: ACK 未确认受理");
  if (get(response, "duplicate") === true) throw new Error("pending_action_ack: duplicate 回执不能冒充首次受理");
  return response;
}

export function actionAck(wire, frame, { actionStatus } = {}) {
  const identity = replyIdentity(frame);
  const replies = list(wire).filter((record) => replyRecord(record, identity, get(frame, "at")));
  if (replies.length !== 1) throw waitMiss(`pending_action_ack: 同请求 ACK 必须唯一，实测 ${replies.length}`);
  const response = ackResponse(get(get(replies[0], "frame"), 4));
  if (get(response, "action_status") !== actionStatus) {
    throw new Error(`pending_action_ack: action_status 不是 ${actionStatus}`);
  }
  return { reply: replies[0], response };
}

const RESULT_STATUS = Object.freeze({ accept: "accepted", discard: "discarded" });

function actionResultMatches(body, action, actionStatus) {
  return allOf(
    RESULT_STATUS[action?.action_type] === actionStatus,
    actionResultBindsArtifact(body, action),
    get(body, "status") === actionStatus,
  );
}

function resultClaimsAction(body, action) {
  const expected = actionResultIdentityFor(action);
  return allOf(
    expected !== null,
    get(body, "action_id") === expected.action_id ||
      get(body, "action_id") === action.action_id ||
      get(body, "artifact_id") === action.target_ref ||
      get(get(body, "decision"), "candidate_ref") === action.target_ref,
  );
}

export function actionResult(wire, { topic, since, action, actionStatus } = {}) {
  requireWindow({ topic, since }, "pending_action_result");
  if (!actionResultIdentityFor(action) || RESULT_STATUS[action.action_type] !== actionStatus) {
    throw new Error("pending_action_result: 未知动作类型/状态");
  }
  const candidates = list(wire).filter((record) =>
    allOf(frameEventRecord(record, "received", topic, "action_result"), within(record, since)));
  const matches = candidates.filter((record) =>
    actionResultMatches(get(get(record, "frame"), 4), action, actionStatus));
  const conflicts = candidates.filter((record) =>
    resultClaimsAction(get(get(record, "frame"), 4), action) && !matches.includes(record));
  if (conflicts.length > 0) throw conflict("pending_action_result: 同一动作的回执冲突");
  if (matches.length !== 1) throw waitMiss(`pending_action_result: 回执广播必须恰好一条，实测 ${matches.length}`);
  return matches[0];
}

function turnResultParent(record, topic, since, parentTurnRef) {
  const frame = frameEventRecord(record, "received", topic, "turn_result");
  if (!frame) return null;
  return allOf(
    within(record, since),
    get(get(frame, 4), "parent_turn_id") === parentTurnRef,
  ) ? record : null;
}

export function actionTurnResult(wire, { topic, since, parentTurnRef } = {}) {
  requireWindow({ topic, since }, "pending_action_turn_result");
  if (!nonBlank(parentTurnRef)) throw new Error("pending_action_turn_result: 缺 parentTurnRef");
  const matches = list(wire).filter((record) => turnResultParent(record, topic, since, parentTurnRef));
  if (matches.length !== 1) {
    throw waitMiss(`pending_action_turn_result: parent=${parentTurnRef} 必须恰好一条，实测 ${matches.length}`);
  }
  return matches[0];
}

export function resolvedEntry(turnResult, artifactId, status) {
  const matches = list(turnResult?.adoption_state?.resolved).filter(
    (entry) => entry?.artifact_id === artifactId && entry?.adoption_status === status,
  );
  if (matches.length !== 1) {
    throw new Error(`pending_resolved: ${artifactId}/${status} 必须恰好一条，实测 ${matches.length}`);
  }
  return matches[0];
}

function parseObject(raw) {
  try {
    const parsed = JSON.parse(raw);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function decodeArguments(call) {
  const args = get(call, "arguments");
  if (isObject(args)) return args;
  if (allOf(args === undefined || args === null, isObject(get(call, "raw_arguments")))) {
    return get(call, "raw_arguments");
  }
  if (typeof args === "string") return parseObject(args) ?? {};
  return {};
}

function writerItems(records, providerCallRef) {
  const matched = list(records).filter((record) => get(record, "provider_call_ref") === providerCallRef);
  if (matched.length !== 1) return { reason: "writer_record_missing", items: [] };
  const calls = list(get(get(get(matched[0], "response"), "body"), "tool_calls"));
  const items = [];
  for (const call of calls) {
    const args = decodeArguments(call);
    for (const item of list(args.items)) items.push(item);
  }
  return { items };
}

const ARTIFACT_ITEM_FIELDS = Object.freeze(["item_id", "title", "body", "rationale"]);

function itemFields(item) {
  return Object.fromEntries(ARTIFACT_ITEM_FIELDS.map((field) => [field, get(item, field)]));
}

function uniqueProviderCall(items) {
  const refs = [...new Set(items.map((item) => get(item, "provider_call_ref")))];
  if (refs.length !== 1) return null;
  return nonBlank(refs[0]) ? refs[0] : null;
}

function itemFailure(item, writerItemsList) {
  const matches = writerItemsList.filter((candidate) => get(candidate, "item_id") === get(item, "item_id"));
  if (matches.length === 0) return { ok: false, reason: "writer_item_missing" };
  if (matches.length > 1) return { ok: false, reason: "writer_item_duplicate" };
  if (same(itemFields(item), itemFields(matches[0]))) return null;
  return { ok: false, reason: "writer_item_field_mismatch", item_id: get(item, "item_id") };
}

// revision 全 item 集必须与同次 writer 响应精确相等；不修补、不部分通过。
export function writerArtifactMatch({ artifact, records } = {}) {
  const items = list(get(get(artifact, "payload"), "items"));
  if (items.length === 0) return { ok: false, reason: "artifact_items_missing" };
  if (!items.every((item) => isObject(item) && ARTIFACT_ITEM_FIELDS.every((field) => hasOwn(item, field)))) {
    return { ok: false, reason: "artifact_item_fields_missing" };
  }
  const providerCallRef = uniqueProviderCall(items);
  if (providerCallRef === null) return { ok: false, reason: "provider_call_ref_ambiguous" };
  const writer = writerItems(records, providerCallRef);
  if (writer.reason) return { ok: false, reason: writer.reason };
  if (writer.items.length !== items.length) {
    return { ok: false, reason: "writer_item_count_mismatch", writer_item_count: writer.items.length };
  }
  const failure = items.map((item) => itemFailure(item, writer.items)).find(Boolean);
  if (failure) return failure;
  return { ok: true, reason: null, provider_call_ref: providerCallRef, writer_item_count: writer.items.length };
}

function sectionText(content) {
  if (typeof content !== "string") return null;
  const match = content.match(/## 消息处置与已有产物([\s\S]*?)(?=\n##\s|$)/u);
  return match === null ? null : match[1];
}

const APPLIED_SCOPE_PREFIX = "【应用数据 · scope_update";

function isAppliedScopeMessage(message) {
  const content = get(message, "content");
  return (
    get(message, "role") === "user" &&
    typeof content === "string" &&
    content.trimStart().startsWith(APPLIED_SCOPE_PREFIX)
  );
}

function parseFacts(value) {
  try {
    const parsed = JSON.parse(value);
    return allOf(
      isObject(parsed),
      Array.isArray(parsed.pending_adoptions),
      Array.isArray(parsed.resolved_adoptions),
    ) ? parsed : null;
  } catch {
    return null;
  }
}

function factsInSection(section) {
  const trimmed = section.trim();
  const whole = parseFacts(trimmed);
  if (whole) return whole;
  const lines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"));
  const parsed = lines.map(parseFacts).filter(Boolean);
  return parsed.length === 1 ? parsed[0] : null;
}

// 状态只属于最新一条真实应用的 scope_update 消息；作者原话、历史 scope、其它
// 位置引用的同名 JSON 都不授权。最新 scope 缺 section/非法 JSON 就是缺证据。
export function scopeFactsFromRequest(requestBody) {
  const scopes = list(get(requestBody, "messages")).filter(isAppliedScopeMessage);
  if (scopes.length === 0) return null;
  const section = sectionText(get(scopes.at(-1), "content"));
  return section === null ? null : factsInSection(section);
}

function resolvedByRefAll(facts) {
  return list(get(facts, "resolved_adoptions")).filter(isObject);
}

function resolvedByRef(facts, artifactId) {
  return resolvedByRefAll(facts).filter((entry) => entry.artifact_ref === artifactId);
}

function resolvedExact(facts, expected) {
  if (!isObject(expected)) return false;
  const matches = resolvedByRef(facts, expected.artifact_id);
  if (matches.length !== 1) return false;
  const entry = matches[0];
  return allOf(
    entry.status === expected.status,
    entry.body_preview === expected.body,
    expected.title === undefined || entry.title === expected.title,
    expected.revision_of === undefined || entry.revision_of === expected.revision_of,
  );
}

function pendingEmpty(facts) {
  if (!isObject(facts)) return false;
  return list(facts.pending_adoptions).length === 0 && facts.pending_adoption_count === 0;
}

function resolvedCountExact(facts) {
  if (!isObject(facts)) return false;
  return list(facts.resolved_adoptions).length === 2 &&
    facts.resolved_adoption_count === 2 &&
    facts.omitted_adoptions === 0;
}

function statusesPresent(resolved, required) {
  return required.every((status) => resolved.some((entry) => entry.status === status));
}

export function scopeFactsChecks(facts, { source, revision } = {}) {
  const resolved = resolvedByRefAll(facts);
  return {
    checks: {
      scope_pending_empty: pendingEmpty(facts),
      scope_resolved_count_exact: resolvedCountExact(facts),
      scope_discarded_source_exact: resolvedExact(facts, source),
      scope_accepted_revision_exact: resolvedExact(facts, revision),
      scope_statuses_present: statusesPresent(resolved, ["ACCEPTED", "DISCARDED"]),
    },
    measured: {
      pending_count: list(get(facts, "pending_adoptions")).length,
      resolved_count: resolved.length,
      source_ref: get(source, "artifact_id") ?? null,
      revision_ref: get(revision, "artifact_id") ?? null,
    },
  };
}

function acceptedContentConsumed(accepted, reply) {
  return accepted.some(
    (entry) =>
      (nonBlank(entry.body_preview) && reply.includes(entry.body_preview)) ||
      (nonBlank(entry.title) && reply.includes(entry.title)),
  );
}

function replyNoWrite(turnResult) {
  return allOf(
    get(get(turnResult, "truthfulness"), "production_write_performed") !== true,
    get(get(turnResult, "truthfulness"), "artifact_adopted") !== true,
  );
}

export function followupReplyChecks({ turnResult, providerContent, facts } = {}) {
  const reply = String(get(get(turnResult, "assistant_message"), "text") ?? "");
  const resolved = resolvedByRefAll(facts);
  const statuses = [...new Set(resolved.map((entry) => entry.status).filter(nonBlank))];
  const accepted = resolved.filter((entry) =>
    entry.status === "ACCEPTED" || entry.status === "EDITED_ACCEPTED");
  return {
    reply_present: reply.trim() !== "",
    reply_exact_provider: allOf(nonBlank(providerContent), reply === providerContent),
    reply_consumes_resolved_statuses:
      statusesPresent(resolved, ["ACCEPTED", "DISCARDED"]) &&
      statuses.every((status) => reply.includes(status)),
    reply_consumes_accepted_content: acceptedContentConsumed(accepted, reply),
    reply_no_production_write: replyNoWrite(turnResult),
  };
}

// ── canon 分段（checkpoint 由 I/O 边界采集）──────────────────────────────────
const CANON_TABLES = Object.freeze([
  "works",
  "drafts",
  "chapters",
  "volumes",
  "scenes",
  "characters",
  "memory_items",
  "ledger_entries",
  "author_action_receipts",
]);
const OPS_COLUMNS = Object.freeze(["reference_count", "last_referenced_at"]);
function tableSignature(snapshot, table) {
  const tables = snapshot && snapshot.tables;
  const value = tables && tables[table];
  if (!value) return null;
  return `${value.rows_sha256}\u0000${value.row_count}`;
}

const sameTable = (left, right, table) =>
  tableSignature(left, table) === tableSignature(right, table);

function sameTables(left, right, excluded = []) {
  return CANON_TABLES.filter((table) => !excluded.includes(table)).every((table) =>
    sameTable(left, right, table));
}

function rowsById(rows) {
  return new Map(list(rows).map((row) => [String(row.id), row]));
}

function comparableMemory(row) {
  const copy = { ...row };
  for (const column of OPS_COLUMNS) delete copy[column];
  return copy;
}

function memoryRowsUnchangedExceptOps(before, after) {
  const left = rowsById(before);
  const right = rowsById(after);
  if (left.size !== right.size) return false;
  return [...left.keys()].every((id) =>
    right.has(id) && same(comparableMemory(left.get(id)), comparableMemory(right.get(id))));
}

function existingMemoryRowsUnchanged(before, after) {
  const left = rowsById(before);
  const right = rowsById(after);
  return [...left.keys()].every((id) =>
    right.has(id) && same(comparableMemory(left.get(id)), comparableMemory(right.get(id))));
}

function receiptsByAction(rows) {
  return new Map(list(rows).map((row) => [String(row.action_id), row]));
}

function receipt(result) {
  // checkpoint 写入边界已把 JSON 文本解析成对象，这里直接消费该结构。
  return isObject(result) ? result : null;
}

function checkpoint(checkpoints, name) {
  const value = checkpoints?.[name];
  if (!value) throw new Error(`pending_canon: 缺 checkpoint ${name}`);
  return value;
}

function noWriterSegments(start, afterSource, afterRevision) {
  return allOf(
    sameTables(start.canon, afterSource.canon),
    sameTables(afterSource.canon, afterRevision.canon),
    list(afterSource.receipts).length === 0,
    list(afterRevision.receipts).length === 0,
    list(afterSource.memory_items).length === 0,
    list(afterRevision.memory_items).length === 0,
  );
}

function acceptCountsExact(afterRevision, afterAccept, addedMemory) {
  return allOf(
    afterAccept.canon.tables.author_action_receipts.row_count ===
      afterRevision.canon.tables.author_action_receipts.row_count + 1,
    afterAccept.canon.tables.memory_items.row_count ===
      afterRevision.canon.tables.memory_items.row_count + 1,
    addedMemory.length === 1,
  );
}

function acceptedMemoryBound(acceptedRow, acceptResult, revisionItem, expectedMemoryId, workId) {
  if (acceptedRow === null) return false;
  return allOf(
    acceptedRow.work_id === workId,
    acceptedRow.status === "CONFIRMED",
    acceptedRow.summary === revisionItem.title,
    typeof acceptedRow.content === "string",
    acceptedRow.content.includes(String(revisionItem.body ?? "")),
    acceptedRow.source_id === get(get(acceptResult, "persistence"), "mutation_id"),
    acceptedRow.id === expectedMemoryId,
    list(acceptedRow.tags).includes("adopted_artifact"),
  );
}

function acceptReceiptBound(acceptResult, acceptReceipt, acceptAction, revisionArtifact) {
  return allOf(
    get(acceptResult, "decision") === "ACCEPTED",
    get(acceptResult, "artifact_id") === get(revisionArtifact, "artifact_id"),
    get(acceptReceipt, "status") === "accepted",
    get(acceptReceipt, "action_id") === get(acceptAction, "action_id"),
    get(acceptReceipt, "idempotency_key") === get(acceptAction, "idempotency_key"),
    get(acceptReceipt, "source_turn_ref") === get(acceptAction, "source_turn_ref"),
  );
}

function acceptSegment(afterRevision, afterAccept, acceptAction, revisionArtifact, workId) {
  const acceptReceipt = receiptsByAction(afterAccept.receipts).get(String(acceptAction?.action_id));
  const beforeMemory = rowsById(afterRevision.memory_items);
  const afterMemory = rowsById(afterAccept.memory_items);
  const addedMemory = [...afterMemory.keys()].filter((id) => !beforeMemory.has(id));
  const acceptedRow = addedMemory.length === 1 ? afterMemory.get(addedMemory[0]) : null;
  const acceptResult = receipt(acceptReceipt?.result);
  const expectedMemoryId = get(get(acceptResult, "persistence"), "memory_item_id");
  const revisionItem = list(get(get(revisionArtifact, "payload"), "items"))[0] ?? {};
  const onlyTablesAllowed = sameTables(
    afterRevision.canon,
    afterAccept.canon,
    ["memory_items", "author_action_receipts"],
  );
  const existingRowsKept = existingMemoryRowsUnchanged(
    afterRevision.memory_items,
    afterAccept.memory_items,
  );
  return {
    check: allOf(
      onlyTablesAllowed,
      acceptCountsExact(afterRevision, afterAccept, addedMemory),
      existingRowsKept,
      acceptedMemoryBound(acceptedRow, acceptResult, revisionItem, expectedMemoryId, workId),
      acceptReceiptBound(acceptResult, acceptReceipt, acceptAction, revisionArtifact),
    ),
    originalKept: !list(afterAccept.memory_items).some(
      (row) => row.id === get(revisionArtifact, "artifact_id"),
    ),
    expectedMemoryId: expectedMemoryId ?? null,
    addedMemoryRows: addedMemory.length,
  };
}

function discardCountsExact(afterAccept, afterDiscard) {
  return allOf(
    afterDiscard.canon.tables.author_action_receipts.row_count ===
      afterAccept.canon.tables.author_action_receipts.row_count + 1,
    list(afterDiscard.receipts).length === list(afterAccept.receipts).length + 1,
  );
}

function discardBound(discardReceipt, discardAction, sourceArtifact) {
  const discardResult = receipt(discardReceipt.result);
  return allOf(
    discardReceipt.action_id === get(discardAction, "action_id"),
    discardReceipt.idempotency_key === get(discardAction, "idempotency_key"),
    discardReceipt.source_turn_ref === get(discardAction, "source_turn_ref"),
    discardReceipt.status === "discarded",
    get(discardResult, "decision") === "DISCARDED",
    get(discardResult, "artifact_id") === get(sourceArtifact, "artifact_id"),
  );
}

function previousAcceptReceiptKept(acceptReceipt, acceptAfter) {
  return acceptReceipt !== undefined && same(acceptReceipt, acceptAfter);
}

function receiptForAction(rows, action) {
  return receiptsByAction(rows).get(String(action?.action_id));
}

function discardReceipts(afterAccept, afterDiscard, acceptAction, discardAction) {
  const acceptReceipt = receiptForAction(afterAccept.receipts, acceptAction);
  const discardReceipt = receiptForAction(afterDiscard.receipts, discardAction);
  if (!acceptReceipt) return null;
  if (!discardReceipt) return null;
  return {
    acceptReceipt,
    discardReceipt,
    acceptAfter: receiptForAction(afterDiscard.receipts, acceptAction),
  };
}

function discardSegment(afterAccept, afterDiscard, acceptAction, discardAction, sourceArtifact) {
  const receipts = discardReceipts(afterAccept, afterDiscard, acceptAction, discardAction);
  if (receipts === null) return false;
  return allOf(
    sameTables(afterAccept.canon, afterDiscard.canon, ["author_action_receipts"]),
    discardCountsExact(afterAccept, afterDiscard),
    memoryRowsUnchangedExceptOps(afterAccept.memory_items, afterDiscard.memory_items),
    previousAcceptReceiptKept(receipts.acceptReceipt, receipts.acceptAfter),
    discardBound(receipts.discardReceipt, discardAction, sourceArtifact),
  );
}

function noChangeSegment(before, after) {
  return allOf(
    sameTables(before.canon, after.canon),
    memoryRowsUnchangedExceptOps(before.memory_items, after.memory_items),
    same(before.receipts, after.receipts),
  );
}

function referenceAccounted(checkpoints) {
  const pairs = [
    [checkpoints.start, checkpoints["after-source"]],
    [checkpoints["after-source"], checkpoints["after-revision"]],
    [checkpoints["after-accept"], checkpoints["after-discard"]],
    [checkpoints["after-discard"], checkpoints["after-restore"]],
    [checkpoints["after-restore"], checkpoints.final],
  ];
  return pairs.every(([left, right]) =>
    compareAuthoringCanonSnapshots(left.canon, right.canon)
      .checks.memory_reference_updates_accounted);
}

function zeroAuthoringFacts(start) {
  return ["drafts", "chapters", "volumes", "scenes", "characters", "ledger_entries", "memory_items", "author_action_receipts"]
    .every((table) => start.canon?.tables?.[table]?.row_count === 0);
}

export function pendingCanonChecks(checkpoints, { workId, sourceArtifact, revisionArtifact, acceptAction, discardAction } = {}) {
  const start = checkpoint(checkpoints, "start");
  const afterSource = checkpoint(checkpoints, "after-source");
  const afterRevision = checkpoint(checkpoints, "after-revision");
  const afterAccept = checkpoint(checkpoints, "after-accept");
  const afterDiscard = checkpoint(checkpoints, "after-discard");
  const afterRestore = checkpoint(checkpoints, "after-restore");
  const final = checkpoint(checkpoints, "final");

  const accept = acceptSegment(afterRevision, afterAccept, acceptAction, revisionArtifact, workId);
  const acceptNoReferences =
    list(afterAccept.canon?.memory_reference_logs).length ===
      list(afterRevision.canon?.memory_reference_logs).length &&
    accept.expectedMemoryId !== null &&
    rowsById(afterAccept.memory_items).get(accept.expectedMemoryId)?.reference_count === 0;

  return {
    checks: {
      canon_start_has_no_authoring_facts: zeroAuthoringFacts(start),
      canon_source_and_revision_write_nothing: noWriterSegments(start, afterSource, afterRevision),
      canon_accept_only_adds_bound_memory_and_receipt: accept.check,
      canon_accept_does_not_discard_original: accept.originalKept,
      canon_discard_only_adds_bound_source_receipt:
        discardSegment(afterAccept, afterDiscard, acceptAction, discardAction, sourceArtifact),
      canon_restore_writes_nothing: noChangeSegment(afterDiscard, afterRestore),
      canon_followup_writes_nothing: noChangeSegment(afterRestore, final),
      canon_memory_references_accounted: referenceAccounted(checkpoints) && acceptNoReferences,
    },
    measured: {
      accepted_memory_id: accept.expectedMemoryId,
      added_memory_rows: accept.addedMemoryRows,
      receipts: {
        start: list(start.receipts).length,
        after_source: list(afterSource.receipts).length,
        after_revision: list(afterRevision.receipts).length,
        after_accept: list(afterAccept.receipts).length,
        after_discard: list(afterDiscard.receipts).length,
        after_restore: list(afterRestore.receipts).length,
        final: list(final.receipts).length,
      },
    },
  };
}
