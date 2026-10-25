#!/usr/bin/env node
/**
 * B34 CP0：一次性只读抽样脚本。
 * 从 log/llm-calls/stage/*.jsonl 抽取真实作者输入，按 turn 关联 app 日志中的判断/采纳结果，
 * 做初版意图分类与频次统计，并对照现有 fixture/验收场景输出覆盖缺口候选。
 * 不接产品、不写日志、不调用模型；产物落 artifacts/model-contracts/b34-cp0/。
 *
 * 用法：node scripts/mine_author_intents.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const LLM_DIR = path.join(ROOT, "log/llm-calls/stage");
const APP_DIR = path.join(ROOT, "log/app/stage");
const OUT = path.join(ROOT, "artifacts/model-contracts/b34-cp0");

const readJsonl = (file) => {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const out = [];
  let errors = 0;
  lines.forEach((line, idx) => {
    if (!line.trim()) return;
    const m = line.match(/^\[([^\]]+)\]\s*(\{.*\})\s*$/);
    try {
      if (m) {
        out.push({ ts: m[1], obj: JSON.parse(m[2]), file: path.relative(ROOT, file), line: idx + 1 });
      } else {
        // app/stage 日志为无前缀的纯 JSON 行
        const obj = JSON.parse(line);
        out.push({ ts: obj.timestamp || "", obj, file: path.relative(ROOT, file), line: idx + 1 });
      }
    } catch { errors++; }
  });
  return { out, errors };
};

const clean = (s) => (s || "").replace(/\r/g, "").trim().replace(/\s+/g, " ");

const looksBoilerplate = (t) => {
  if (!t) return true;
  if (t.length > 400) return true;
  if (t.includes("## ")) return true;
  if (t.startsWith("本次你承担")) return true;
  if (t.startsWith("你是一个小说创作 AI")) return true;
  if (t.includes("输出格式（严格 JSON）")) return true;
  if (t.includes("必须严格按 JSON")) return true;
  if (t.startsWith("{")) return true;
  return false;
};

function extractAuthor(contents) {
  for (const c of contents) {
    for (const marker of ["## 作者输入", "## 用户输入"]) {
      const i = c.indexOf(marker);
      if (i < 0) continue;
      const rest = c.slice(i + marker.length);
      const end = rest.search(/\n##\s|\n\s*##\s/);
      const text = clean(end >= 0 ? rest.slice(0, end) : rest);
      if (!looksBoilerplate(text)) {
        return { text, source: marker === "## 作者输入" ? "prompt_author_input" : "prompt_user_input" };
      }
    }
  }
  // 缺省：最后一条短 user content（不要拿 system/长模板充当作者原话）
  for (let idx = contents.length - 1; idx >= 0; idx--) {
    const raw = contents[idx] || "";
    const text = clean(raw);
    if (raw.length <= 240 && !looksBoilerplate(text)) return { text, source: "fallback_last_user" };
  }
  return null;
}

const authorsByTurn = new Map();
const llmStats = { files: 0, lines: 0, parseErrors: 0, turns: 0, callsMissingAuthor: 0 };

for (const f of fs.readdirSync(LLM_DIR).filter((x) => x.endsWith(".jsonl")).sort()) {
  const file = path.join(LLM_DIR, f);
  const { out, errors } = readJsonl(file);
  llmStats.files++; llmStats.lines += out.length; llmStats.parseErrors += errors;

  for (const rec of out) {
    const o = rec.obj;
    const body = o.request?.body || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const contents = messages.map((m) => (typeof m?.content === "string" ? m.content : ""));
    const author = extractAuthor(contents);
    // 无 turn/session 的旧调用不能共用一个 "unknown" 键（会把不同 turn 合并丢样本）；
    // 退回文件:行号保证一次调用一个独立 turn。
    const turnKey = o.turn_id
      ? `${o.session_id || o.workspace_id || "unknown"}|${o.turn_id}`
      : `line|${rec.file}:${rec.line}`;
    const step = o.step || "unknown";
    const systemKind = classifyPromptKind(contents);

    if (!authorsByTurn.has(turnKey)) {
      authorsByTurn.set(turnKey, {
        turnKey,
        session_id: o.session_id || null,
        work_id: o.work_id || null,
        workspace_id: o.workspace_id || null,
        turn_id: o.turn_id || null,
        first_ts: rec.ts,
        last_ts: rec.ts,
        model: body.model || null,
        provider: o.provider || null,
        steps: new Set(),
        system_kinds: new Set(),
        authors: [],
        responses: [],
      });
    }
    const t = authorsByTurn.get(turnKey);
    t.last_ts = rec.ts;
    t.steps.add(step);
    if (systemKind) t.system_kinds.add(systemKind);
    if (author) t.authors.push({ ...author, ts: rec.ts, step, file: rec.file, line: rec.line });
    else llmStats.callsMissingAuthor++;
    t.responses.push({ ts: rec.ts, step, body: o.response?.body ?? null });
  }
}

function classifyPromptKind(contents) {
  const joined = contents.join("\n");
  if (joined.includes("你本次承担创作判断器")) return "judgment";
  if (joined.includes("你本次承担计划起草") || joined.includes("计划起草器")) return "plan";
  if (joined.includes("你本次承担创作执行") || joined.includes("writer")) return "writer";
  if (joined.includes("你是一个小说创作 AI。分析用户消息")) return "frame_legacy";
  if (joined.includes("你是一个小说创作 AI 的规划器")) return "planner_legacy";
  return "other";
}

// 同一 turn 选最像作者原话的一份（judgment > user block > fallback）；不同 turn 保留多次发生。
const corpusTurns = [];
for (const t of authorsByTurn.values()) {
  if (t.authors.length === 0) continue;
  const rank = { prompt_author_input: 0, prompt_user_input: 0, fallback_last_user: 1 };
  t.authors.sort((a, b) => (rank[a.source] ?? 2) - (rank[b.source] ?? 2) || a.ts.localeCompare(b.ts));
  const a = t.authors[0];
  corpusTurns.push({
    ...t,
    steps: [...t.steps],
    system_kinds: [...t.system_kinds],
    author_text: a.text,
    author_source: a.source,
    author_ref: `${a.file}:${a.line}`,
    author_ts: a.ts,
    author_step: a.step,
  });
}
llmStats.turns = corpusTurns.length;

// ── app 日志：按 turn_id 索引判断/采纳事件 ─────────────────────────────
const appByTurn = new Map();
const appStats = { files: 0, lines: 0, parseErrors: 0, events: 0 };
for (const f of fs.readdirSync(APP_DIR).filter((x) => x.endsWith(".jsonl")).sort()) {
  const file = path.join(APP_DIR, f);
  const { out, errors } = readJsonl(file);
  appStats.files++; appStats.lines += out.length; appStats.parseErrors += errors;
  for (const rec of out) {
    const o = rec.obj; appStats.events++;
    const turn = o.turn_id || null;
    if (!turn) continue;
    if (!appByTurn.has(turn)) appByTurn.set(turn, []);
    appByTurn.get(turn).push({ ...o, _ref: `${rec.file}:${rec.line}`, _ts: o.timestamp || rec.ts });
  }
}

function resultFromApp(events) {
  if (!events?.length) return null;
  const judged = [...events].reverse().find((e) => /judgment\.decided|planner\.form_frame|planner\.plan|decision\.made|continuation/i.test(e.event || ""));
  const adopted = [...events].reverse().find((e) => /adoption\.evaluate|author_action|adoption\.done/i.test(e.event || ""));
  const out = { action: null, capability: null, frame_type: null, decision_type: null, outcome: null, refs: [] };
  if (judged) {
    out.action = judged.action ?? null;
    out.capability = judged.capability ?? null;
    out.frame_type = judged.frame_type ?? null;
    out.refs.push(judged._ref);
  }
  if (adopted) {
    out.decision_type = adopted.decision_type ?? adopted.action_type ?? null;
    out.refs.push(adopted._ref);
  }
  out.outcome = judged?.action || (out.decision_type ? "adopted" : null);
  return out.refs.length ? out : null;
}

function resultFromLlmResponse(contents, response) {
  let body = response?.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const msg = body?.choices?.[0]?.message;
  const content = msg?.content;
  if (typeof content === "string") {
    try {
      const j = JSON.parse(content);
      return {
        action: j.action || j.frame_type || null,
        capability: j.capability || j.tool_name || null,
        frame_type: j.frame_type || null,
        candidate_count: Array.isArray(j.candidate_directions) ? j.candidate_directions.length : null,
        source: "llm_response",
      };
    } catch { /* ignore */ }
  }
  const call = msg?.tool_calls?.[0];
  if (call?.function?.arguments) {
    try {
      const args = JSON.parse(call.function.arguments);
      return {
        action: args.action || null,
        capability: args.capability || null,
        frame_type: null,
        source: "llm_tool_call",
      };
    } catch { /* ignore */ }
  }
  return null;
}

// ── 意图分类（初版启发式；taxonomy.md 记录可校准）─────────────────────
const INTENTS = [
  ["meta_acceptance", /采纳|接受|放弃|丢弃|拒绝|撤销|回滚/],
  ["export_review", /导出|审读|审阅|校对|审核/],
  ["structure_renumber", /编号|重编号|序号|章节顺序|顺序理顺|排序/],
  ["structure_change", /结构|分卷|合并|拆分|调整.{0,6}卷|卷章/],
  ["character_role_revision", /(指定|改判|确立|设为|改成|改为|标记).{0,24}(主角|反派|配角|群像)|(主角|反派|配角).{0,12}(是|为|改成|改判|指定)/],
  ["character_design", /设计.{0,8}(角色|人物|反派|配角)|新建.{0,4}角色|新角色/],
  ["character_evolution", /演化|成长|转变|黑化|关系.{0,6}变化|状态变化|弧光/],
  ["world_foreshadow", /世界观|设定|规则|伏笔|势力|地理|组织/],
  ["plan_outline", /大纲|章节规划|分卷|卷纲|后续剧情|章节安排|计划.{0,6}章/],
  ["chapter_rewrite", /重写|改写/],
  ["chapter_revision", /修订|整理|修改|润色|排版|调整.{0,8}(章|正文|段落|分段)|生硬|衔接|重复/],
  ["prose_write", /(写|续写|起草|开始写|继续|下一章|完成).{0,14}(章|正文|草稿|写作|创作)|正文没写|帮我写|写完|接着写|全部你定|^(下一章|继续|接着|继续写|继续完成)$|^第.{1,6}章$/],
  ["work_setup", /(创建|开始|新写|准备写|新的).{0,8}(小说|作品|书|创作)|起个?名字|书名|题材|类型|玄幻|武侠|东方/],
  ["progress_query", /谁是主角|写完了吗|进度|多少字|第.{1,6}章.{0,8}(写|状态|完成)|有没有|是什么|哪些章节|几章|草稿在哪|执行了么|做完|存档|现在做什么|我要确认什么/],
  ["discussion", /讨论|聊聊|继续聊|方向|看法|觉得|为什么|是否合适|建议|评价|分析一下/],
  ["delegation", /你定|同意|可以|好的|行|就这样/],
  ["chitchat_noise", /^(kkk|test|测试|\d+)$/i],
];

function classifyIntent(text) {
  const t = clean(text);
  for (const [intent, re] of INTENTS) if (re.test(t)) return { intent, confidence: "high" };
  if (/[?？]/.test(t)) return { intent: "query_status", confidence: "low" };
  return { intent: "other_unclassified", confidence: "low" };
}

// ── 覆盖源扫描（fixtures/scenarios/semantic cases）────────────────────
const COVERAGE_SOURCES = [
  ["slice_verify_fixture", "apps/novel_agent/test/support/provider/slice_verify.ex"],
  ["b27_semantic_cases", "quality/acceptance/fixtures/b27-semantic-cases/cases.yml"],
];
const scenarioDir = path.join(ROOT, "quality/acceptance/scenarios");
if (fs.existsSync(scenarioDir)) {
  for (const f of fs.readdirSync(scenarioDir).filter((x) => x.endsWith(".yml"))) {
    COVERAGE_SOURCES.push([`scenario:${f.replace(/\.yml$/, "")}`, path.join("quality/acceptance/scenarios", f)]);
  }
}
const coverageText = COVERAGE_SOURCES.map(([name, rel]) => {
  const p = path.join(ROOT, rel);
  const raw = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  // 只取场景/案例的名称与 id 行，避免正文里的泛关键词造成“伪覆盖”。
  const names = raw.split("\n").filter((l) => /^\s*(id|title|name|case_id|scenario_id)\s*:/.test(l)).join("\n");
  return { name, rel, text: names || raw.slice(0, 0) };
});
const INTENT_KEYWORDS = {
  meta_acceptance: ["采纳", "放弃", "拒绝", "accept", "adopt", "discard"],
  export_review: ["导出", "审读", "校对", "审核", "review"],
  structure_renumber: ["编号", "重编号", "renumber", "序号", "顺序"],
  structure_change: ["结构", "分卷", "合并", "拆分", "volume"],
  character_role_revision: ["主角", "反派", "配角", "narrative_role", "改判", "role revision"],
  character_design: ["设计角色", "新角色", "character_design", "角色设计"],
  character_evolution: ["演化", "角色演化", "character_evolution", "成长"],
  world_foreshadow: ["世界观", "伏笔", "设定", "world_building", "foreshadow"],
  plan_outline: ["大纲", "规划", "plot_outline", "章节安排"],
  chapter_rewrite: ["重写", "改写", "rewrite"],
  chapter_revision: ["修订", "整理", "润色", "排版", "revision"],
  prose_write: ["写章", "续写", "prose_writing", "正文"],
  query_status: ["查询", "进度", "状态", "query"],
  discussion: ["讨论", "对话", "聊聊"],
};
const intentCoverage = {};
for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
  intentCoverage[intent] = coverageText
    .filter(({ text }) => keywords.some((k) => text.toLowerCase().includes(k.toLowerCase())))
    .map(({ name }) => name);
}

// ── 组装语料 ─────────────────────────────────────────────────────────
fs.mkdirSync(path.join(OUT, "samples"), { recursive: true });
const corpus = corpusTurns.map((t, i) => {
  const rawEvents = t.turn_id ? appByTurn.get(t.turn_id) : null;
  const authorMs = Date.parse(t.author_ts);
  const appEvents = (rawEvents || []).filter((e) => {
    const ms = Date.parse(e._ts);
    return Number.isFinite(ms) && Math.abs(ms - authorMs) <= 6 * 60 * 60 * 1000;
  });
  const appResult = resultFromApp(appEvents.length ? appEvents : null);
  const llmResult = [...t.responses].reverse().map((r) => resultFromLlmResponse([], r.body)).find(Boolean) || null;
  const { intent, confidence } = classifyIntent(t.author_text);
  const result = appResult || llmResult || {
    action: null, capability: null, frame_type: null, decision_type: null, outcome: null,
    source: "unknown_unassociated", refs: [],
  };
  return {
    id: `b34-${String(i + 1).padStart(4, "0")}`,
    author_text: t.author_text,
    author_source: t.author_source,
    intent,
    intent_confidence: confidence,
    timestamp: t.author_ts,
    session_id: t.session_id,
    work_id: t.work_id,
    turn_id: t.turn_id,
    models: [...new Set([t.model].filter(Boolean))],
    provider_steps: t.steps,
    prompt_kinds: t.system_kinds,
    result,
    refs: { author: t.author_ref, app: result.refs || [] },
  };
});
const uniq = new Map();
for (const c of corpus) {
  const key = clean(c.author_text);
  if (!uniq.has(key)) uniq.set(key, { ...c, occurrences: 1, occurrence_refs: [c.refs.author] });
  else { const u = uniq.get(key); u.occurrences++; u.occurrence_refs.push(c.refs.author); }
}
const uniqueCorpus = [...uniq.values()];
fs.writeFileSync(path.join(OUT, "corpus.jsonl"), uniqueCorpus.map((c) => JSON.stringify(c)).join("\n") + "\n");
fs.writeFileSync(path.join(OUT, "corpus-all-turns.jsonl"), corpus.map((c) => JSON.stringify(c)).join("\n") + "\n");

const freq = {};
for (const c of uniqueCorpus) freq[c.intent] = (freq[c.intent] || 0) + 1;
const resultFreq = {};
for (const c of uniqueCorpus) {
  const k = `${c.result.action || "unknown"}|${c.result.decision_type || "-"}`;
  resultFreq[k] = (resultFreq[k] || 0) + 1;
}
const sourceFreq = {};
for (const c of uniqueCorpus) sourceFreq[c.author_source] = (sourceFreq[c.author_source] || 0) + 1;
const assoc = uniqueCorpus.filter((c) => (c.refs.app || []).length > 0).length;
const dates = {};
for (const c of corpus) (dates[c.timestamp?.slice(0, 10)] ||= 0), dates[c.timestamp?.slice(0, 10)]++;

// samples per intent
for (const intent of [...INTENTS.map((x) => x[0]), "other_unclassified"]) {
  const rows = uniqueCorpus.filter((c) => c.intent === intent).slice(0, 5);
  if (!rows.length) continue;
  const md = rows.map((r) => {
    const appRefs = (r.refs.app || []).length ? " ; " + r.refs.app.join(" , ") : "";
    return `- **${r.timestamp}** ${r.author_text.replace(/\|/g, "\\|")}\n  - result: action=${r.result.action} capability=${r.result.capability} decision=${r.result.decision_type}\n  - refs: ${r.refs.author}${appRefs}`;
  }).join("\n");
  fs.writeFileSync(path.join(OUT, "samples", `${intent}.md`), `# B34 samples: ${intent}\n\n${md}\n`);
}

const matrixRows = Object.keys(freq).sort((a, b) => freq[b] - freq[a]).map((intent) => {
  const cov = intentCoverage[intent] || [];
  const rows = uniqueCorpus.filter((c) => c.intent === intent);
  const known = rows.filter((c) => c.result.action || c.result.decision_type).length;
  const executed = rows.filter((c) => ["execute", "plan", "adopt", "adopt_tentative"].includes(c.result.action) || ["accept", "edit_then_accept", "adopt", "adopt_tentative"].includes(c.result.decision_type)).length;
  const risk = cov.length === 0 && freq[intent] >= 3 ? "HIGH" : cov.length === 0 ? "MED" : "LOW";
  return { intent, count: freq[intent], known, executed, coverage: cov, risk };
});

const coverageMd = [
  "# B34 CP0 覆盖缺口矩阵（意图类 × 频次）",
  "",
  "| 意图类 | 语料频次 | 已知结果 | execute/采纳 | 现有 fixture/场景覆盖 | 风险 |",
  "|---|---:|---:|---:|---|---|",
  ...matrixRows.map((r) => `| ${r.intent} | ${r.count} | ${r.known} | ${r.executed} | ${r.coverage.length ? r.coverage.join("<br>") : "**无**"} | ${r.risk} |`),
  "",
  "## Top 未覆盖意图（按频次）",
  ...matrixRows.filter((r) => r.coverage.length === 0).slice(0, 10).map((r) => `- ${r.intent}: ${r.count} 条`),
  "",
  "## 人工校准（对启发式矩阵的补充）",
  "- progress_query（10 条）：无专门“自然语言进度问询”验收场景；`p1-word-count-audit`/`au12-work-profile-overview` 只覆盖字数/档案展示，不等于用户在写章长上下文中问“第几章写到哪/执行完了吗”。→ 缺口成立，建议 fixture。",
  "- work_setup（8 条）：`su02-empty-start-unnamed-work` 覆盖空作品起步，但“创建玄幻/武侠/东方题材并起名”的开场意图无专门场景；`p1-chapter-plan-minimum` 只覆盖已有作品计划。→ 缺口成立。",
  "- discussion（8 条）：`agent-conversation-turn`/`au01-ordinary-chat-two-turn-roundtrip` 覆盖普通对话，但长会话中“继续聊某方向/评价某章写法”的讨论不误执行无专项断言。",
  "- delegation（2 条）/chitchat_noise（2 条）：历史真实样本，属边界输入；可并入 B33 动作意图负例，不必单独场景。",
  "- other_unclassified（5 条）：短指代（下一章/第二章/标题/kkk 等）依赖上下文；语料保留原文与引用，不做二次猜测。",
  "",
  "## 说明",
  "- 覆盖命中为启发式关键词扫描 `slice_verify.ex`、B27 semantic cases、`quality/acceptance/scenarios/*.yml`；需人工校准。",
  "- 频次来自去重后作者原话语料；同一原话多次发生保留 `occurrences`。",
].join("\n");
const fixtureSuggestions = [
  "",
  "## 建议 fixture 清单（供 CP1 冻结）",
  "",
  "1. **progress_query（最高优先级缺口，10 条）**：新增 `author-progress-question-in-writing-context`（长上下文：3 章计划 + 部分已写；真实输入“第几章写到哪/执行完了么/草稿在哪” → 基于当前事实回答进度，不创建候选、不写正文；与 p1-word-count-audit 的“字数统计”区分）。",
  "2. **work_setup（8 条）**：新增 `author-new-work-genre-and-title`（空作品起步：“写一本玄幻/帮我起名” → plan/ask_author，不直接产 prose 正文；覆盖空作品事实缺席时诚实澄清）。",
  "3. **discussion（8 条）**：新增 `author-direction-discussion-without-execute`（“继续聊这个方向/这段写法如何” → reply 讨论、零候选零写入；与 B33 动作意图 gate 正例配对）。",
  "4. **delegation（2 条）**：并入 B33/B34 动作意图负例（“全部你定/同意” → 不自动创建/采纳候选，需具体动作或澄清）。",
  "5. **other_unclassified / chitchat_noise（7 条）**：作为边界输入语料保留，不要求产品 fixture；可加入 judgment 负例集（“第二章/kkk/数字”不误执行）。",
  "6. **低频但近期切片相关**：`structure_renumber`/`character_role_revision` 在本语料为 0（历史窗口主要 2026-06/07，没有 B29/B30 维护指令），已由 `b30-chapter-renumber-roundtrip`/`b29-existing-character-role-revision` 覆盖；CP1 应把 2026-10 新协议单独切窗重采频次。",
  "7. **world_foreshadow（14 条）**：已有场景覆盖较广，但多为设定采纳；建议补一条“设定讨论 vs 设定采纳”边界（长会话，作者只问规则是否合理，不产 world_rule 候选）。",
];
fs.writeFileSync(path.join(OUT, "coverage-matrix.md"), coverageMd + "\n" + fixtureSuggestions.join("\n") + "\n");

const summary = [
  "# B34 CP0 作者意图语料摘要",
  "",
  `- 生成时间：${new Date().toISOString()}`,
  `- llm-calls 日志：${llmStats.files} 文件 / ${llmStats.lines} 行（解析失败 ${llmStats.parseErrors}）`,
  `- app 日志：${appStats.files} 文件 / ${appStats.lines} 行（解析失败 ${appStats.parseErrors}）`,
  `- 抽取 turn 数：${llmStats.turns}（缺作者原话调用 ${llmStats.callsMissingAuthor}）`,
  `- 去重后语料条数：${uniqueCorpus.length}；turn 级 occurrence：${corpus.length}`,
  `- 结果关联率（有 app 事件 refs）：${assoc}/${uniqueCorpus.length}（${((assoc / uniqueCorpus.length) * 100).toFixed(1)}%）`,
  `- 结果未知（action=null 且无 adoption decision）：${uniqueCorpus.filter((c) => !c.result.action && !c.result.decision_type).length}`,
  `- 解析失败：llm ${llmStats.parseErrors} / app ${appStats.parseErrors}`,
  `- 解析失败/unknown 比例：llm 解析 ${(llmStats.parseErrors / (llmStats.lines || 1) * 100).toFixed(1)}%；结果未知 ${(uniqueCorpus.filter((c) => !c.result.action && !c.result.decision_type).length / uniqueCorpus.length * 100).toFixed(1)}%`,
  `- 作者文本来源：${JSON.stringify(sourceFreq)}`,
  "",
  "## 日期分布（turn 级）",
  ...Object.entries(dates).sort().map(([d, n]) => `- ${d}: ${n}`),
  "",
  "## 意图频次（去重后）",
  ...Object.entries(freq).sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k}: ${n}`),
  "",
  "## 结果分布（action|decision）",
  ...Object.entries(resultFreq).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => `- ${k}: ${n}`),
  "",
  "## 协议/模型分布（turn 级）",
  ...Object.entries(uniqueCorpus.reduce((acc, c) => { const k = (c.prompt_kinds || []).join("+") || "unknown"; acc[k] = (acc[k] || 0) + 1; return acc; }, {})).map(([k, n]) => `- ${k}: ${n}`),
  ...Object.entries(uniqueCorpus.reduce((acc, c) => { const k = (c.models || []).join("+") || "unknown"; acc[k] = (acc[k] || 0) + 1; return acc; }, {})).map(([k, n]) => `- model ${k}: ${n}`),
  "",
  "## 解析/关联限制",
  "- 2026-06/07 部分日志为旧 frame/planner 协议，无 judgment 事件，结果标 unknown；不猜。",
  "- 新协议 stream 响应 body 可能不是 JSON（event_stream），结果依赖 app 日志 turn_id 关联。",
  "- 作者输入优先 prompt `## 作者输入`，其次 `## 用户输入`，最后短 user content（标 fallback）；缺省不猜。",
].join("\n");
fs.writeFileSync(path.join(OUT, "corpus-summary.md"), summary + "\n");
console.log(summary);
console.error(`wrote ${OUT}`);
