// R05 回复可见证据：预期文本与 AX 节点由案例独立给出，不调用产品或被测投影生成 oracle。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import * as r05 from "./authoring_r05_evidence.mjs";
import { r05CapturedViews } from "./authoring_live_evidence.mjs";
import { materializeFixture, openTestRunScope, withWorkingCopy } from "../test_env.mjs";
import { authorVisibleFixtureSpec } from "./fixtures/authoring_live_io_fixture.mjs";
import { G2_VISIBLE_TARGET, visibleAfterInput, visibleReadingPage } from "./fixtures/authoring_live_facts.mjs";

const ROOT = "0/0/0/0/0";
const MESSAGE = "请只分析胜利的代价，指出依据和可改方向，不生成候选，也不要保存。";
const FRAME = [100, 200, 900, 35];
const group = (index, value, frame = FRAME) => [
  { path: `${ROOT}/${index}`, role: "AXGroup", frame: [...frame] },
  { path: `${ROOT}/${index}/0`, role: "AXStaticText", value, frame: [...frame] },
];
function page(body, { message = MESSAGE, status = "已完成" } = {}) {
  return [
    { path: "0", role: "AXWindow", frame: [0, 0, 1280, 800] },
    { path: ROOT, role: "AXWebArea", frame: [0, 80, 1280, 660] },
    { path: ROOT + "/0", role: "AXPopUpButton", title: G2_VISIBLE_TARGET.work_title, desc: "作品" },
    { path: ROOT + "/1", role: "AXPopUpButton", title: "AI 助手", desc: "助手名称" },
    { path: ROOT + "/2", role: "AXStaticText", value: "无任务" },
    ...group(10, "你"), ...group(11, message), ...group(12, "AI 助手"),
    ...body,
    { path: ROOT + "/80", role: "AXGroup", title: "本轮创作过程" },
    { path: ROOT + "/80/0", role: "AXStaticText", value: status },
    { path: ROOT + "/90", role: "AXButton", title: "为什么", desc: "查看这轮回应的依据" },
  ];
}
function visibleInput(reply, nodes, shown) {
  return {
    goal: "quality", target: G2_VISIBLE_TARGET, message: MESSAGE, reply, finalNodes: nodes,
    reply_views: replyViews(nodes),
    afterInputText: visibleAfterInput(MESSAGE), readingBeforeText: visibleReadingPage(),
    readingAfterText: visibleReadingPage(),
    finalText: [G2_VISIBLE_TARGET.work_title, "你", MESSAGE, "AI 助手", shown, "已完成", "为什么"].join("\n"),
  };
}

function replyViews(start, end = start) {
  return [
    { edge: "start", capture: "r05-reply-start", nodes: start,
      screenshot_present: true, window_capture: true },
    { edge: "end", capture: start === end ? "r05-reply-start" : "r05-reply-end", nodes: end,
      screenshot_present: true, window_capture: true },
  ];
}
function match(reply, body, options = {}) {
  return r05.r05ReplyMatch({ reply, nodes: page(body), message: MESSAGE, ...options });
}

test("R05 独立业务红例：完整 Markdown 回复经标题加粗列表渲染后应可签收", () => {
  const reply = "## 结论\n\n**胜利的代价太轻。**\n\n1. 守卫三招落败。\n2. 主角没有损失。\n\n建议让选择留下后果。";
  const body = [
    { path: ROOT + "/20", role: "AXHeading", title: "结论", value: 2, frame: [...FRAME] },
    { path: ROOT + "/20/0", role: "AXStaticText", value: "结论", frame: [...FRAME] },
    ...group(21, "胜利的代价太轻。"),
    { path: ROOT + "/22", role: "AXList", subrole: "AXContentList" },
    { path: ROOT + "/22/0", role: "AXGroup", value: "守卫三招落败。" },
    { path: ROOT + "/22/0/0", role: "AXListMarker", value: "1" },
    { path: ROOT + "/22/0/1", role: "AXStaticText", value: "守卫三招落败。", frame: [...FRAME] },
    { path: ROOT + "/22/1", role: "AXGroup", value: "主角没有损失。" },
    { path: ROOT + "/22/1/0", role: "AXListMarker", value: "2" },
    { path: ROOT + "/22/1/1", role: "AXStaticText", value: "主角没有损失。", frame: [...FRAME] },
    ...group(23, "建议让选择留下后果。"),
  ];
  const input = visibleInput(reply, page(body),
    "结论\n胜利的代价太轻。\n守卫三招落败。\n主角没有损失。\n建议让选择留下后果。");
  const report = r05.r05VisibleEvidence(input);
  assert.equal(report.observed.outcome, "completed");
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.observed.reply_visible, true);
});

test("R05 独立业务红例：原文只在过程记录中出现不能补齐助手实际交付", () => {
  const reply = "第一句分析。第二句限定。";
  const nodes = page(group(20, "第一句分析。"));
  nodes.push({ path: ROOT + "/80/1", role: "AXGroup" },
    { path: ROOT + "/80/1/0", role: "AXStaticText", value: reply });
  const report = r05.r05VisibleEvidence(visibleInput(reply, nodes,
    "第一句分析。\n本轮创作过程\n第一句分析。第二句限定。"));
  assert.equal(report.observed.outcome, "completed");
  assert.equal(report.ok, false, JSON.stringify(report));
  assert.equal(report.observed.reply_visible, false);
});

const STATIC_CASES = [
  [
    "CJK 标点内强调",
    "**中文。**继续",
    "中文。继续"
  ],
  [
    "强调、删除线不留下语法符",
    "**重点**与*轻声*、~~原判断~~。",
    "重点与轻声、原判断。"
  ],
  [
    "普通段落软换行",
    "first line\nsecond line",
    "first line second line"
  ],
  [
    "转义星号和井号",
    "字面 \\* 星号与 \\# 标记。",
    "字面 * 星号与 # 标记。"
  ],
  [
    "静态未闭合强调",
    "未完成 **强调",
    "未完成 **强调"
  ],
  [
    "行内代码保留语法符",
    "字面 `**保留** # 号`。",
    "字面 **保留** # 号。"
  ],
  [
    "实体仅做语法解码",
    "AT&amp;T &lt;tag&gt;",
    "AT&T <tag>"
  ],
  [
    "安全链接保留 URL",
    "[资料](https://example.test/a?x=1&y=2)",
    "资料 (https://example.test/a?x=1&y=2)"
  ],
  [
    "相对地址不显示 URL",
    "[本页](../local)",
    "本页"
  ],
  [
    "危险协议不成为可见 URL",
    "[危险](javascript:alert%281%29)",
    "危险"
  ],
  [
    "图片只显示说明",
    "![图片说明](https://tracker.invalid/pixel)",
    "图片说明"
  ],
  [
    "HTML 源按既有只读呈现成为字面文本",
    "<script>alert(1)</script>",
    "<script>alert(1)</script>"
  ]
];
test("R05 静态 Markdown 预期来自手写可见文本，保留字面与现有链接安全政策", () => {
  for (const [label, reply, visible] of STATIC_CASES) {
    const report = match(reply, group(20, visible));
    assert.equal(report.ok, true, label + ": " + JSON.stringify(report));
  }
});

test("R05 同段强调拆成多个 AX 叶时不制造或吞掉词间空格", () => {
  for (const [reply, pieces] of [
    ["前**重点**后", ["前", "重点", "后"]],
    ["before **focus** after", ["before ", "focus", " after"]],
  ]) {
    const body = [{ path: ROOT + "/20", role: "AXGroup" },
      ...pieces.map((value, index) => ({ path: ROOT + "/20/" + index,
        role: "AXStaticText", value, frame: [...FRAME] }))];
    assert.equal(match(reply, body).ok, true, reply);
  }
  assert.equal(match("a b", group(20, "ab")).ok, false);
  assert.equal(match("ab", group(20, "a b")).ok, false);
});

test("R05 代码块缩进、空行及字面 Markdown 符号不能被普通文本归一抹掉", () => {
  const reply = "```text\n  缩进\n\n    **第二行**\n```";
  const code = "  缩进\n\n    **第二行**\n";
  assert.equal(match(reply, group(20, code)).ok, true);
  for (const wrong of [
    "缩进\n\n    **第二行**\n",
    "  缩进\n    **第二行**\n",
    "  缩进\n\n    第二行\n",
    "  缩进     **第二行**",
  ]) assert.equal(match(reply, group(20, wrong)).ok, false, JSON.stringify(wrong));
});

test("R05 引用与表格按作者读序保留全部单元，不让原始分隔符代替内容", () => {
  const reply = "> 保留假设\n\n| 视角 | 风险 |\n| --- | --- |\n| 单视角 | 遗漏 |";
  const body = [
    ...group(20, "保留假设"),
    { path: ROOT + "/21", role: "AXTable" },
    { path: ROOT + "/21/0", role: "AXRow" },
    { path: ROOT + "/21/0/0", role: "AXCell" },
    { path: ROOT + "/21/0/0/0", role: "AXStaticText", value: "视角", frame: [...FRAME] },
    { path: ROOT + "/21/0/1", role: "AXCell" },
    { path: ROOT + "/21/0/1/0", role: "AXStaticText", value: "风险", frame: [...FRAME] },
    { path: ROOT + "/21/1", role: "AXRow" },
    { path: ROOT + "/21/1/0", role: "AXCell" },
    { path: ROOT + "/21/1/0/0", role: "AXStaticText", value: "单视角", frame: [...FRAME] },
    { path: ROOT + "/21/1/1", role: "AXCell" },
    { path: ROOT + "/21/1/1/0", role: "AXStaticText", value: "遗漏", frame: [...FRAME] },
  ];
  assert.equal(match(reply, body).ok, true);
  assert.equal(match(reply, body.filter((node) => node.value !== "风险")).ok, false);
});

test("R05 AX 容器的汇总和标题不重复记文本，数值路径顺序与真实重复段落保留", () => {
  const body = [
    { path: ROOT + "/20", role: "AXHeading", title: "标题", value: 2 },
    { path: ROOT + "/20/0", role: "AXStaticText", value: "标题", frame: [...FRAME] },
    { path: ROOT + "/21", role: "AXList" },
    { path: ROOT + "/21/10", role: "AXGroup", value: "重复。" },
    { path: ROOT + "/21/10/0", role: "AXListMarker", value: "2" },
    { path: ROOT + "/21/10/1", role: "AXStaticText", value: "重复。", frame: [...FRAME] },
    { path: ROOT + "/21/2", role: "AXGroup", value: "重复。" },
    { path: ROOT + "/21/2/0", role: "AXListMarker", value: "1" },
    { path: ROOT + "/21/2/1", role: "AXStaticText", value: "重复。", frame: [...FRAME] },
  ];
  const nodes = page(body), surface = r05.r05ReplySurface(nodes, { message: MESSAGE });
  assert.equal(surface.ok, true, JSON.stringify(surface));
  assert.deepEqual(surface.leaves.map((node) => [node.path, node.value]), [
    [ROOT + "/20/0", "标题"], [ROOT + "/21/2/1", "重复。"], [ROOT + "/21/10/1", "重复。"],
  ]);
  assert.equal(surface.first, nodes.find((node) => node.path === ROOT + "/20/0"));
  assert.equal(surface.last, nodes.find((node) => node.path === ROOT + "/21/10/1"));
  assert.equal(surface.assistant_path, ROOT + "/12");
  assert.equal(surface.why_path, ROOT + "/90");
  assert.equal(match("重复。\n\n重复。", [...group(20, "重复。"), ...group(21, "重复。")]).ok, true);
  assert.equal(match("重复。\n\n重复。", group(20, "重复。")).ok, false);
});

test("R05 助手紧邻的帧标签不是模型正文，同文正文仍完整保留且决定首末视口", () => {
  const reply = "生成草稿\n\n我已核对首尾线索，候选等你决定。";
  for (const desc of ["生成草稿", "生成草稿：整章修订"]) {
    const badge = group(13, "生成草稿");
    badge[0].desc = desc;
    const nodes = page([...badge, ...group(20, "生成草稿"),
      ...group(21, "我已核对首尾线索，候选等你决定。")]);
    const before = JSON.stringify(nodes);
    const report = r05.r05ReplyMatch({ reply, nodes, message: MESSAGE });
    assert.equal(report.ok, true, desc);
    assert.deepEqual(report.surface.leaves.map((node) => [node.path, node.value]), [
      [ROOT + "/20/0", "生成草稿"], [ROOT + "/21/0", "我已核对首尾线索，候选等你决定。"],
    ]);
    assert.equal(report.surface.first.path, ROOT + "/20/0");
    assert.equal(report.surface.last.path, ROOT + "/21/0");
    assert.equal(JSON.stringify(nodes), before);
  }
});

test("R05 正文关键词、非紧邻标签及坏结构不能被当作帧标签删除", () => {
  const reply = "完整回复。";
  for (const change of [
    (badge) => { delete badge[0].desc; },
    (badge) => { badge[0].desc = "另一个标签：目标"; },
    (badge) => { badge[0].role = "AXHeading"; },
    (badge) => { badge.push({ path: ROOT + "/13/1", role: "AXStaticText", value: "额外内容" }); },
    (badge) => { badge.forEach((node) => { node.path = node.path.replace("/13", "/30"); }); },
  ]) {
    const badge = group(13, "生成草稿"); badge[0].desc = "生成草稿：整章修订"; change(badge);
    assert.equal(match(reply, [...badge, ...group(20, reply)]).ok, false);
  }
  const badgeOnly = group(13, "生成草稿"); badgeOnly[0].desc = "生成草稿：整章修订";
  assert.equal(r05.r05ReplySurface(page(badgeOnly), { message: MESSAGE }).ok, false);
});

test("R05 完整回复必须保全中段、末句、顺序及数量，不接受前缀或散落子序列", () => {
  const reply = "第一段。\n\n第二段。\n\n最后一句限定。";
  const correct = ["第一段。", "第二段。", "最后一句限定。"];
  assert.equal(match(reply, correct.flatMap((value, index) => group(20 + index, value))).ok, true);
  for (const [label, paragraphs] of [
    ["缺首", correct.slice(1)], ["缺中", [correct[0], correct[2]]], ["缺尾", correct.slice(0, 2)],
    ["错序", [correct[1], correct[0], correct[2]]],
    ["额外", [correct[0], "其他结论。", correct[1], correct[2]]],
    ["尾句前缀", [correct[0], correct[1], "最后一句"]],
  ]) assert.equal(match(reply, paragraphs.flatMap((value, index) => group(20 + index, value))).ok,
    false, label);
});

test("R05 新增作者边界不可借旧同文回合；助手原样引用作者不新增作者计数", () => {
  const body = group(20, "完整回复。"), nodes = page(body);
  assert.equal(r05.r05ReplyMatch({ reply: "完整回复。", nodes, message: MESSAGE, baselineAuthorCount: 1 }).ok, false);
  nodes.push(...group(4, "你"), ...group(5, MESSAGE));
  assert.equal(r05.r05ReplyMatch({ reply: "完整回复。", nodes, message: MESSAGE, baselineAuthorCount: 1 }).ok, true);
  assert.equal(match(MESSAGE, group(20, MESSAGE)).ok, true);
  const old = page(group(20, "只有开头。"));
  old.push(...group(4, "你"), ...group(5, "以前的问题"), ...group(6, "AI 助手"),
    ...group(7, "只有开头。还有末句。"),
    { path: ROOT + "/8", role: "AXButton", title: "为什么", desc: "查看这轮回应的依据" });
  assert.equal(r05.r05ReplyMatch({ reply: "只有开头。还有末句。", nodes: old, message: MESSAGE }).ok, false);
});

test("R05 内容不能跨下一作者消息、第二个助手交付或 Why 后候选区拼接", () => {
  const reply = "开头。\n\n结尾。";
  for (const body of [
    [...group(20, "开头。"), ...group(40, "你"), ...group(41, "下一条问题"),
      ...group(42, "AI 助手"), ...group(43, "结尾。")],
    [...group(20, "开头。"),
      { path: ROOT + "/21", role: "AXButton", title: "为什么", desc: "查看这轮回应的依据" },
      ...group(22, "AI 助手"), ...group(23, "结尾。")],
    [...group(20, "开头。"), ...group(95, "结尾。")],
  ]) assert.equal(match(reply, body).ok, false);
});

test("R05 缺真实助手标签或 Why 入口不以同名正文冒充交付区", () => {
  for (const change of [
    (nodes) => { nodes.find((node) => node.path === ROOT + "/12/0").value = "别的角色"; },
    (nodes) => { const why = nodes.find((node) => node.path === ROOT + "/90");
      why.role = "AXStaticText"; why.value = "为什么"; },
    (nodes) => { nodes.find((node) => node.path === ROOT + "/90").desc = "其他按钮"; },
    (nodes) => { nodes.push({ path: ROOT + "/89", role: "AXButton", title: "为什么",
      desc: "查看这轮回应的依据" }); },
  ]) {
    const nodes = page(group(20, "完整回复。")); change(nodes);
    assert.equal(r05.r05ReplySurface(nodes, { message: MESSAGE }).ok, false);
  }
});

test("R05 短回复同一真实 capture 可以证明首末视口，完整内容与 viewport 是独立证据", () => {
  const reply = "短回复已完成。", nodes = page(group(20, reply));
  const input = visibleInput(reply, nodes, reply);
  assert.equal(input.reply_views[0].capture, input.reply_views[1].capture);
  assert.equal(r05.r05VisibleEvidence(input).ok, true);
  const surface = r05.r05ReplySurface(nodes, { message: MESSAGE });
  assert.equal(r05.r05ReplyEdgeVisible(nodes, surface, "start"), true);
  assert.equal(r05.r05ReplyEdgeVisible(nodes, surface, "end"), true);
  assert.equal(r05.r05ReplyEdgeVisible(nodes, surface, "middle"), false);
  for (const view of input.reply_views) view.nodes = structuredClone(nodes).map((node) =>
    node.path === ROOT + "/20/0" ? { ...node, frame: [100, 1200, 900, 35] } : node);
  assert.equal(r05.r05ReplyMatch({ reply, nodes, message: MESSAGE }).ok, true);
  assert.equal(r05.r05VisibleEvidence(input).ok, false);
});

test("R05 长单叶首尾分屏可证明边缘，只有中部相交不能证明任一边缘", () => {
  const reply = "这一段逐项说明判断依据与范围。".repeat(80);
  const start = page(group(20, reply, [100, 200, 900, 1100]));
  const end = page(group(20, reply, [100, -500, 900, 1100]));
  const middle = page(group(20, reply, [100, -200, 900, 1100]));
  const surface = (nodes) => r05.r05ReplySurface(nodes, { message: MESSAGE });
  assert.equal(r05.r05ReplyEdgeVisible(start, surface(start), "start"), true);
  assert.equal(r05.r05ReplyEdgeVisible(start, surface(start), "end"), false);
  assert.equal(r05.r05ReplyEdgeVisible(end, surface(end), "start"), false);
  assert.equal(r05.r05ReplyEdgeVisible(end, surface(end), "end"), true);
  assert.equal(r05.r05ReplyEdgeVisible(middle, surface(middle), "start"), false);
  assert.equal(r05.r05ReplyEdgeVisible(middle, surface(middle), "end"), false);
  const input = visibleInput(reply, end, reply);
  input.reply_views = replyViews(start, end);
  assert.equal(r05.r05VisibleEvidence(input).ok, true);
});

test("R05 视口必须服从窗口及滚动祖先裁剪，缺 frame 或仅水平部分相交均不足", () => {
  for (const change of [
    (nodes) => { nodes.find((node) => node.path === ROOT).frame = [0, 300, 1280, 300]; },
    (nodes) => { nodes.find((node) => node.path === ROOT + "/20/0").frame = [-10, 200, 900, 35]; },
    (nodes) => { nodes.find((node) => node.path === ROOT + "/20/0").frame = [100, 200, 0, 35]; },
    (nodes) => { delete nodes.find((node) => node.path === ROOT + "/20/0").frame; },
    (nodes) => { nodes.splice(nodes.findIndex((node) => node.role === "AXWindow"), 1); },
    (nodes) => { nodes.push({ path: "0/0/0/0", role: "AXScrollArea", frame: [0, 300, 1280, 400] }); },
  ]) {
    const nodes = page(group(20, "完整回复。")); change(nodes);
    const surface = r05.r05ReplySurface(nodes, { message: MESSAGE });
    assert.equal(r05.r05ReplyEdgeVisible(nodes, surface, "start"), false);
    assert.equal(r05.r05ReplyEdgeVisible(nodes, surface, "end"), false);
  }
});

test("R05 首末截图均须完整同轮回复与 completed，不能借旧窗口、截短节点或活跃过程", () => {
  const reply = "当前完整回复。";
  for (const [label, change] of [
    ["缺views", (input) => { input.reply_views = []; }],
    ["缺end", (input) => { input.reply_views.pop(); }],
    ["缺截图", (input) => { input.reply_views[0].screenshot_present = false; }],
    ["fallback截图", (input) => { input.reply_views[0].window_capture = false; }],
    ["错误作品", (input) => { input.reply_views[0].nodes.find((node) => node.desc === "作品").title = "其他作品"; }],
    ["旧作者", (input) => { input.reply_views[0].nodes.find((node) => node.path === ROOT + "/11/0").value = "旧原话"; }],
    ["缺末句", (input) => { input.reply_views[1].nodes.find((node) => node.path === ROOT + "/20/0").value = "当前"; }],
    ["运行中", (input) => { input.reply_views[1].nodes.find((node) => node.path === ROOT + "/80/0").value = "进行中"; }],
    ["仍在维护", (input) => { input.reply_views[1].nodes.push(
      { path: ROOT + "/100", role: "AXGroup", title: "当前创作任务操作" },
      { path: ROOT + "/100/0", role: "AXStaticText", value: "进行中" });
      input.reply_views[1].nodes.find((node) => node.path === ROOT + "/80/0").value = "进行中"; }],
  ]) {
    const nodes = page(group(20, reply)), input = visibleInput(reply, nodes, reply);
    input.reply_views = replyViews(structuredClone(nodes), structuredClone(nodes));
    change(input);
    const report = r05.r05VisibleEvidence(input);
    assert.equal(report.observed.outcome, "completed", label);
    assert.equal(report.ok, false, label + ": " + JSON.stringify(report));
  }
});

// 真实文件读取边界；仅签 capture 关联，不把合成 PNG 或页级 fixture 当成原生 UI 验收。
test("R05 reader 拒绝未绑定的回复视图文件，篡改前合法副本必须通过", () => {
  const scope = openTestRunScope();
  const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
  const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  try {
    const fixture = materializeFixture(authorVisibleFixtureSpec({ mode: "read_only" }), { scope });
    const cases = [
      ["同数量异节点", (dir, log) => {
        log.r05_reply_views[0].nodes.find((node) => node.role === "AXStaticText").value = "被替换的原始节点";
        writeJson(path.join(dir, "native-b71-driver-log.json"), log);
      }, /AX 原始节点与 capture 内容不一致/u],
      ["文本异字节", (dir) => fs.appendFileSync(path.join(dir, "r05-reply-start.text.txt"), "\n被改写"),
        /可见文本与 capture 内容不一致/u],
      ["图片异字节且文件头仍合法", (dir) => fs.appendFileSync(path.join(dir, "r05-reply-start.jpg"), "changed-image"),
        /截图与 capture 内容不一致/u],
      ["缺少文本文件", (dir) => fs.rmSync(path.join(dir, "r05-reply-start.text.txt")),
        /缺少证据文件/u],
      ["缺少图片文件", (dir) => fs.rmSync(path.join(dir, "r05-reply-start.jpg")), /ENOENT/u],
      ["同名 capture 不唯一", (dir, log) => {
        log.captures.push(structuredClone(log.captures.find((entry) => entry.name === "r05-reply-start")));
        writeJson(path.join(dir, "native-b71-driver-log.json"), log);
      }, /AX 观察必须唯一绑定 capture/u],
      ["本入口外的现存 capture", (dir, log) => {
        log.r05_reply_views[0].capture = "final";
        writeJson(path.join(dir, "native-b71-driver-log.json"), log);
      }, /视图名称不属于本入口/u],
      ["capture 早于 ready", (dir, log, common) => {
        log.captures.find((entry) => entry.name === "r05-reply-start").at =
          new Date(Date.parse(common.ready.ready_at) - 1000).toISOString();
        writeJson(path.join(dir, "native-b71-driver-log.json"), log);
      }, /AX capture 早于本批窗口/u],
      ["文件早于 ready", (dir, _log, common) => {
        const old = new Date(Date.parse(common.ready.ready_at) - 1000);
        fs.utimesSync(path.join(dir, "r05-reply-start.text.txt"), old, old);
      }, /证据文件早于原生窗口就绪/u],
    ];
    for (const [label, tamper, reason] of cases) withWorkingCopy(fixture, (copy) => {
      const dir = copy.dir, logFile = path.join(dir, "native-b71-driver-log.json");
      const observation = readJson(path.join(dir, "native-b71-turn-observation.json"));
      const common = { ready: readJson(path.join(dir, "native-driver-ready.json")),
        ui: readJson(path.join(dir, "native-ui-complete.json")) };
      const log = readJson(logFile);
      log.r05_reply_views = [];
      const expected = [];
      for (const edge of ["start", "end"]) {
        const capture = "r05-reply-" + edge, nodes = structuredClone(observation.last.nodes);
        const text = fs.readFileSync(path.join(dir, "final.text.txt"));
        const picture = fs.readFileSync(path.join(dir, "final.jpg"));
        // AX 文本文件在本测试只承担存在/时点；结构化 raw 的内容身份由下面独立哈希签定。
        fs.writeFileSync(path.join(dir, capture + ".ax.txt"),
          nodes.map((node) => node.path + " " + node.role + " " + String(node.value ?? "")).join("\n"));
        fs.writeFileSync(path.join(dir, capture + ".text.txt"), text);
        fs.writeFileSync(path.join(dir, capture + ".jpg"), picture);
        log.captures.push({ name: capture, at: observation.last.at, nodes: nodes.length,
          ax_sha256: hash(JSON.stringify(nodes)), text_sha256: hash(text),
          screenshot: { ok: true, sha256: hash(picture) } });
        log.r05_reply_views.push({ edge, capture, nodes });
        common.ui.screenshots.push(capture + ".jpg");
        expected.push({ edge, capture, nodes: structuredClone(nodes),
          screenshot_present: true, window_capture: true });
      }
      writeJson(logFile, log);
      writeJson(path.join(dir, "native-ui-complete.json"), common.ui);
      assert.deepEqual(r05CapturedViews(dir, common, "reply"), expected, label + ": 合法对照");
      tamper(dir, log, common);
      // 不调用 sealAuthorVisibleCaptures：被破坏副本必须对原 capture 收据失败。
      assert.throws(() => r05CapturedViews(dir, common, "reply"), reason, label);
    });
  } finally {
    scope.close();
  }
});


// 明确 hard break 保留自己的证据边界：同组相邻叶须真实跨行，或正文含实际换行。
test("R05 两空格 hard break 的三行统计按同组真实跨行叶签收，首末可见另验", () => {
  const reply = "总章数：2  \n有正文：1  \n还没写正文：1";
  const body = [
    { path: ROOT + "/20", role: "AXGroup", frame: [424, 506, 90, 75] },
    { path: ROOT + "/20/0", role: "AXStaticText", value: "总章数：2", frame: [424, 510, 64, 18] },
    { path: ROOT + "/20/1", role: "AXStaticText", value: "有正文：1", frame: [424, 535, 62, 17] },
    { path: ROOT + "/20/2", role: "AXStaticText", value: "还没写正文：1", frame: [424, 559, 90, 18] },
  ];
  const nodes = page(body), before = JSON.stringify(nodes);
  const report = r05.r05ReplyMatch({ reply, nodes, message: MESSAGE });
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.deepEqual(report.surface.leaves.map((node) => node.value), ["总章数：2", "有正文：1", "还没写正文：1"]);
  assert.equal(report.surface.first.path, ROOT + "/20/0");
  assert.equal(report.surface.last.path, ROOT + "/20/2");
  assert.equal(JSON.stringify(nodes), before);
  const input = visibleInput(reply, nodes, "总章数：2\n有正文：1\n还没写正文：1");
  assert.equal(r05.r05VisibleEvidence(input).ok, true);
  const end = structuredClone(nodes);
  end.find((node) => node.path === ROOT + "/20/2").frame = [424, 1200, 90, 18];
  assert.equal(r05.r05ReplyMatch({ reply, nodes: end, message: MESSAGE }).ok, true);
  input.reply_views = replyViews(nodes, end);
  assert.equal(r05.r05VisibleEvidence(input).ok, false);
});

test("R05 单叶实际 LF 可证明两种明确 hard break，普通空格不能代替", () => {
  assert.equal(match("总章数：2  \n有正文：1  \n还没写正文：1",
    group(20, "总章数：2\n有正文：1\n还没写正文：1")).ok, true);
  for (const reply of ["甲  \n乙", "甲\\\n乙"]) {
    assert.equal(match(reply, group(20, "甲\n乙")).ok, true, reply);
    assert.equal(match(reply, group(20, "甲 乙")).ok, false, reply);
    assert.equal(match(reply, group(20, "甲乙")).ok, false, reply);
  }
});

test("R05 AX 分叶本身不足以证明 hard break，必须有合法且不重叠的跨行 frame", () => {
  const reply = "甲  \n乙";
  const body = [
    { path: ROOT + "/20", role: "AXGroup", frame: [100, 190, 100, 70] },
    { path: ROOT + "/20/0", role: "AXStaticText", value: "甲", frame: [100, 200, 20, 18] },
    { path: ROOT + "/20/1", role: "AXStaticText", value: "乙", frame: [100, 230, 20, 18] },
  ];
  for (const [label, change] of [
    ["同行", (nodes) => { nodes[2].frame = [130, 200, 20, 18]; }],
    ["垂直重叠", (nodes) => { nodes[2].frame = [100, 210, 20, 18]; }],
    ["逆向行序", (nodes) => { nodes[2].frame = [100, 180, 20, 18]; }],
    ["缺前叶 frame", (nodes) => { delete nodes[1].frame; }],
    ["缺后叶 frame", (nodes) => { delete nodes[2].frame; }],
    ["零宽 frame", (nodes) => { nodes[2].frame = [100, 230, 0, 18]; }],
    ["负高 frame", (nodes) => { nodes[2].frame = [100, 230, 20, -18]; }],
    ["非有限 frame", (nodes) => { nodes[2].frame = [100, NaN, 20, 18]; }],
  ]) {
    const changed = structuredClone(body); change(changed);
    assert.equal(match(reply, changed).ok, false, label);
  }
});

test("R05 hard break 只能位于对应字节边界，不能补普通词间空格", () => {
  const body = [
    { path: ROOT + "/20", role: "AXGroup", frame: [100, 190, 100, 70] },
    { path: ROOT + "/20/0", role: "AXStaticText", value: "a", frame: [100, 200, 20, 18] },
    { path: ROOT + "/20/1", role: "AXStaticText", value: "bcd", frame: [100, 230, 50, 18] },
  ];
  assert.equal(match("ab  \ncd", body).ok, false);
  body[2].value = "b";
  assert.equal(match("a b", body).ok, false);
  assert.equal(match("ab", body).ok, true);
});

test("R05 hard break 同组多叶仍保完整内容、顺序与次数", () => {
  const reply = "总章数：2  \n有正文：1  \n还没写正文：1";
  for (const [label, lines] of [
    ["缺首", ["有正文：1", "还没写正文：1"]],
    ["缺中", ["总章数：2", "还没写正文：1"]],
    ["缺尾", ["总章数：2", "有正文：1"]],
    ["改值", ["总章数：2", "有正文：2", "还没写正文：1"]],
    ["错序", ["有正文：1", "总章数：2", "还没写正文：1"]],
    ["重复", ["总章数：2", "有正文：1", "有正文：1", "还没写正文：1"]],
    ["尾句前缀", ["总章数：2", "有正文：1", "还没写正文"]],
  ]) {
    const body = [{ path: ROOT + "/20", role: "AXGroup", frame: [100, 190, 200, 130] },
      ...lines.map((value, index) => ({ path: ROOT + "/20/" + index,
        role: "AXStaticText", value, frame: [100, 200 + index * 25, 150, 18] }))];
    assert.equal(match(reply, body).ok, false, label);
  }
});

test("R05 hard break 邻 inline code 时保留 code 双空格，普通首尾空白不移动边界", () => {
  const reply = "`a  b`  \n尾句";
  const body = [
    { path: ROOT + "/20", role: "AXGroup", frame: [100, 190, 100, 70] },
    { path: ROOT + "/20/0", role: "AXStaticText", value: "a  b", frame: [100, 200, 50, 18] },
    { path: ROOT + "/20/1", role: "AXStaticText", value: "尾句", frame: [100, 230, 50, 18] },
  ];
  assert.equal(match(reply, body).ok, true);
  body[1].value = "a b";
  assert.equal(match(reply, body).ok, false);
  body[1].value = " \t甲";
  body[2].value = "乙 \t";
  assert.equal(match("甲  \n乙", body).ok, true);
});

test("R05 连续 hard break 各自需要证据，文字 LF 和同次跨行边界不能重复计数", () => {
  const reply = "甲\\\n\\\n乙";
  assert.equal(match(reply, group(20, "甲\n\n乙")).ok, true);
  assert.equal(match(reply, group(20, "甲\n乙")).ok, false);
  const body = [
    { path: ROOT + "/20", role: "AXGroup", frame: [100, 190, 100, 80] },
    { path: ROOT + "/20/0", role: "AXStaticText", value: "甲", frame: [100, 200, 20, 18] },
    { path: ROOT + "/20/1", role: "AXStaticText", value: "乙", frame: [100, 250, 20, 18] },
  ];
  assert.equal(match(reply, body).ok, false);
  body[1].value = "甲\n";
  assert.equal(match(reply, body).ok, false);
});
