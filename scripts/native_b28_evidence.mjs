// B28 原生验收的只读证据适配：测量动作全部由外部系统 UI 驱动。
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { b28BuildInitialFragment, b28BuildContinuationFragment, b28ExpectedAgeReplacement, b28SegmentCandidateMatches, b28FormattingPlanMatches, b28SourceFingerprint as productionSources } from "./lib/b28-chapter-fixture.mjs";

export const inputs = Object.freeze({
  format: "把已保存的第一章正文整理修订一下，只调整分段和排版，不要改字句。",
  content: "把已保存的第一章正文里的年龄改一下，二十五岁改成三十岁，其余逐字不变。",
  continuation: "接着第一章继续往下写一段，只写下一段正文，保持人物与情节不变。",
  search_new: "查一下第01章正文里有没有出现「三十岁」，只按当前正文回答。",
  search_old: "查一下第01章正文里有没有出现「二十五岁」，只按当前正文回答。",
});
const checkpoints = ["seed", "isolation-after", "first-adopted", "baseline", "format-after", "content-after", "restored", "final"];
const read = (dir, file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
const write = (dir, file, value) => {
  assert(!fs.existsSync(path.join(dir, file)), `证据不得覆盖: ${file}`);
  fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2));
};
const jsonl = (file) => fs.readFileSync(file, "utf8").split("\n").filter((line) => line.includes("{")).map((line) => JSON.parse(line.slice(line.indexOf("{"))));
const logs = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).flatMap((f) => jsonl(path.join(dir, f)));
const bodyOf = (candidate) => candidate?.artifact_type === "prose_formatting_plan" ? candidate?.payload?.formatting_preview ?? "" : candidate?.payload?.content ?? candidate?.payload?.items?.map((i) => i.body).join("\n\n") ?? "";
const refsOf = (facts) => facts.drafts.filter((d) => d.chapter_id === facts.chapter_id && d.draft_status === "ACCEPTED").map((d) => ({ draft_ref: `draft:${d.id}`, version: Number(d.revision) }));
const acceptedText = (facts) => facts.drafts.filter((d) => d.chapter_id === facts.chapter_id && d.draft_status === "ACCEPTED").map((d) => d.content).filter(Boolean).join("\n\n");
const identityOf = (facts) => facts.chapters.map(({ id, seq, title }) => ({ id, seq, title }));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const words = (text) => text.replace(/[^\p{L}\p{N}]/gu, "").length;
const shaFile = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const titleProbe = "把已保存的第一章正文里的年龄改一下，三十岁改成二十五岁，其余逐字不变。";

function copySource(dir, source) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const parent = fs.realpathSync(path.resolve(source));
  assert(parent.startsWith(path.join(root, "artifacts") + path.sep), "只允许复制项目内测试证据库");
  assert(path.resolve(dir).startsWith(path.join(root, "artifacts") + path.sep), "副本必须位于项目证据目录");
  // 已终止的本任务测试库可恢复；不依赖某一失败文案，也不重新生成已有模型候选。
  read(path.dirname(parent), "termination.json");
  assert(read(path.dirname(parent), "detached-meta.json").args.includes("b28-whole-chapter-revision"));
  const backup = path.join(parent, "database-before-failure-close.sqlite3");
  const sourceDb = fs.existsSync(backup) ? backup : path.join(parent, "database/ai_novel_studio_test.sqlite3");
  assert(fs.realpathSync(sourceDb).startsWith(parent + path.sep), "源库不能经符号链接越界");
  const targetDb = path.join(dir, "database/ai_novel_studio_test.sqlite3");
  assert(!fs.existsSync(targetDb));
  const sourceHash = shaFile(sourceDb);
  execFileSync("python3", ["-c", "import sqlite3,sys; s=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()", sourceDb, targetDb]);
  for (const file of ["b28-native-inputs.json", "seed.log"]) fs.copyFileSync(path.join(parent, file), path.join(dir, file), fs.constants.COPYFILE_EXCL);
  assert.equal(shaFile(sourceDb), sourceHash);
  const config = read(dir, "b28-native-inputs.json");
  const db = new DatabaseSync(targetDb, { readOnly: true });
  try {
    write(dir, "source-facts.json", { main: facts(db, config.work_id, config.chapter_a_id),
      isolation: facts(db, config.isolation_work_id, config.isolation_chapter_a_id), missing: facts(db, config.missing_work_id, "") });
  } finally { db.close(); }
  write(dir, "replay-source.json", { parent, source_database: sourceDb, source_sha256: sourceHash,
    copy_sha256: shaFile(targetDb), at: new Date().toISOString(), scope: ["readonly_new", "readonly_old", "segment_title", "missing_target", "archive"] });
}

function assertScopedProductionChange(parent, current) {
  const before = read(parent, "production-sources-before.json");
  const changed = Object.keys({ ...before, ...current }).filter((name) => before[name] !== current[name]);
  const file = "apps/novel_application/lib/novel_application/pending_artifact_workflow.ex";
  assert.deepEqual(changed, [file], "继承数据链只允许已声明的系统范围标题变更");
  const original = fs.readFileSync(path.resolve(parent, "../runner-source", file), "utf8");
  const marker = "  defp chapter_candidate_title(chapter_title, _scope),";
  const insertion = '  defp chapter_candidate_title(chapter_title, :target_segments),\n    do: "#{chapter_title}（指定段落修订稿）"\n\n';
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  assert.equal(fs.readFileSync(path.join(root, file), "utf8"), original.replace(marker, insertion + marker));
}


export function revisionChecks(candidate, before, after, mode) {
  const payload = candidate?.payload ?? {}, effect = payload.adoption_effect ?? {};
  const source = acceptedText(before), content = bodyOf(candidate);
  const covered = (effect.covered ?? []).map((x) => String(typeof x === "string" ? x : x.draft_ref ?? x.ref).replace(/:\d+$/, "")).sort();
  const expected = refsOf(before);
  const segmentMode = mode === "target_segments";
  const expectedContent = segmentMode ? b28ExpectedAgeReplacement(source).final_text : content;
  return {
    target: candidate?.target_chapter_ref === `chapter:${before.chapter_id}`,
    scope: (payload.modification_scope ?? payload.scope?.modification_scope) === mode,
    effect: segmentMode ? effect.mode === "replace_segments" : effect.mode === "format_paragraphs" && effect.coverage === "complete",
    covered: same(covered, expected.map((r) => r.draft_ref).sort()),
    versions: same((effect.expected_base_versions ?? effect.base_versions ?? []).map((r) => ({ draft_ref: r.draft_ref ?? r.ref, version: r.version })).sort((a, b) => a.draft_ref.localeCompare(b.draft_ref)), [...expected].sort((a, b) => a.draft_ref.localeCompare(b.draft_ref))),
    base: segmentMode ? b28SegmentCandidateMatches(content, effect, source, expected) : typeof payload.base_text === "string" && payload.base_text === source,
    complete: expectedContent.includes("【初稿末句】") && expectedContent.includes("【续写末句】"),
    change: segmentMode ? b28SegmentCandidateMatches(content, effect, source, expected) && acceptedText(after) === expectedContent : b28FormattingPlanMatches(candidate, source),
    identity: same(identityOf(before), identityOf(after)),
    superseded: expected.every((ref) => after.drafts.some((d) => `draft:${d.id}` === ref.draft_ref && d.draft_status === "SUPERSEDED")),
    current: refsOf(after).length === 1 && acceptedText(after) === expectedContent,
  };
}

function facts(database, workId, chapterId) {
  const all = (sql, values = []) => database.prepare(sql).all(...values);
  return { work_id: workId, chapter_id: chapterId,
    chapters: all("SELECT id,title,seq,status FROM chapters WHERE work_id=? ORDER BY seq", [workId]),
    drafts: all("SELECT d.id,s.chapter_id,s.seq AS scene_seq,d.content,d.status AS draft_status,d.revision FROM drafts d JOIN scenes s ON s.id=d.scene_id WHERE d.work_id=? ORDER BY s.chapter_id,s.seq,d.revision", [workId]),
    summaries: all("SELECT id,status,summary_text,source_ref,revision_base,updated_at FROM chapter_summaries WHERE work_id=? AND chapter_id=? ORDER BY updated_at", [workId, chapterId]),
  };
}
function capture(dir, checkpoint) {
  assert(checkpoints.includes(checkpoint) || checkpoint === "replay-start");
  const config = read(dir, "b28-native-inputs.json");
  const db = new DatabaseSync(path.join(dir, "database/ai_novel_studio_test.sqlite3"), { readOnly: true });
  try {
    const main = facts(db, config.work_id, config.chapter_a_id);
    const isolation = facts(db, config.isolation_work_id, config.isolation_chapter_a_id);
    const missing = facts(db, config.missing_work_id, "");
    write(dir, `${checkpoint}.json`, { at: new Date().toISOString(), main, isolation, missing });
  } finally { db.close(); }
}
async function prepare(dir) {
  const ready = read(dir, "native-driver-ready.json");
  if (fs.existsSync(path.join(dir, "replay-source.json"))) {
    const source = read(dir, "replay-source.json"), production = productionSources();
    assert.equal(shaFile(source.source_database), source.source_sha256);
    // 实模批次只借用已采纳测试数据，不继承替身业务结论。
    if (ready.provider === "slice_verify") assertScopedProductionChange(source.parent, production);
    write(dir, "production-sources-before.json", production);
    write(dir, "scoped-inputs.json", { title_probe: titleProbe, search_new: inputs.search_new, search_old: inputs.search_old, missing: inputs.format });
    capture(dir, "replay-start");
    const start = read(dir, "replay-start.json"), original = read(dir, "source-facts.json");
    for (const work of ["main", "isolation", "missing"]) assert.deepEqual(start[work], original[work], `副本${work}事实须等于A1停止时状态`);
    console.log("A1只读副本与源码范围校验通过；scoped输入已备妥。"); return;
  }
  const seed = fs.readFileSync(path.join(dir, "seed.log"), "utf8");
  const fields = ["work_id", "session_id", "chapter_a_id", "isolation_work_id", "isolation_session_id", "isolation_chapter_a_id", "isolation_duplicate_chapter_id"];
  const config = Object.fromEntries(fields.map((key) => {
    const value = seed.split(/\s+/).find((s) => s.startsWith(`${key}=`))?.slice(key.length + 1);
    assert(value, `seed缺字段 ${key}`); return [key, value];
  }));
  const title = `B28 原生缺目标 ${ready.run_ref.slice(0, 8)}`;
  const response = await fetch(`${ready.api_url}/api/works`, { method: "POST", signal: AbortSignal.timeout(10_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, genre: "雨港悬疑", core_selling_point: "缺目标零写入", tone_preference: "克制" }) });
  assert(response.ok); const { work } = await response.json();
  write(dir, "b28-native-inputs.json", { ...config, missing_work_id: work.id, missing_title: title, inputs, initial: b28BuildInitialFragment(), continuation: b28BuildContinuationFragment() });
  write(dir, "production-sources-before.json", productionSources());
  capture(dir, "seed"); console.log("B28原生前提与原矩阵输入已备妥；accepted正文仍为空，须从UI构造。");
}

function verify(dir) {
  const ready = read(dir, "native-driver-ready.json"), ui = read(dir, "native-ui-complete.json"), config = read(dir, "b28-native-inputs.json");
  const replay = fs.existsSync(path.join(dir, "replay-source.json")) ? read(dir, "replay-source.json") : null;
  const parent = replay?.parent ?? dir;
  const currentWire = jsonl(path.join(dir, "native-transport.jsonl"));
  const priorWire = replay ? jsonl(path.join(parent, "native-transport.jsonl")) : [];
  assert.equal(ui.harness_run_ref, ready.run_ref); assert.equal(ui.driver, "cua-native-system-ui");
  assert.equal(ui.app_bundle, "com.ai-novel-studio.app"); assert.equal(ready.browser_driver_started, false);
  assert(!fs.existsSync(path.join(dir, "ui-frames.json")));
  const snapshots = Object.fromEntries(checkpoints.map((key) => [key, read(key === "final" ? dir : parent, `${key}.json`)]));
  const wire = [...priorWire, ...currentWire];
  const sent = wire.filter((r) => r.direction === "sent" && !r.dropped), received = wire.filter((r) => r.direction === "received" && !r.dropped);
  const app = [...(replay ? logs(path.join(parent, "app-log")) : []), ...logs(path.join(dir, "app-log"))];
  const llm = [...(replay ? logs(path.join(parent, "llm-calls")) : []), ...logs(path.join(dir, "llm-calls"))];
  const providerCalls = app.filter((r) => r.event === "provider_gateway.complete.start" && [config.work_id, config.isolation_work_id, config.missing_work_id].includes(r.work_id));
  assert(providerCalls.length && providerCalls.every((r) => r.provider === "slice_verify"));
  const ax = (name) => {
    const sourceDir = replay && !["T4-missing", "T8-archive", "T2-title-scoped"].includes(name) ? parent : dir;
    const sourceReady = sourceDir === dir ? ready : read(parent, "native-driver-ready.json");
    const file = path.join(sourceDir, `${name}.ax.txt`); assert(fs.statSync(file).mtimeMs >= Date.parse(sourceReady.ready_at));
    return fs.readFileSync(file, "utf8");
  };
  const mainReceived = received.filter((r) => r.frame[2] === `workspace:${config.work_id}`);
  const resultForText = (text, workId = config.work_id) => {
    const sourceWire = replay && workId === config.work_id && [inputs.format, inputs.content].includes(text) ? priorWire : currentWire;
    const messages = sourceWire.filter((r) => r.direction === "sent" && r.frame?.[2] === `workspace:${workId}` && r.frame[3] === "user_message" && r.frame[4].text === text);
    assert.equal(messages.length, 1, `普通输入必须只发送一次: ${text}`);
    const message = messages[0], turnId = message.frame[4].turn_id;
    const ack = received.find((r) => r.at >= message.at && r.frame[2] === message.frame[2] && r.frame[1] === message.frame[1] && r.frame[3] === "phx_reply" && r.frame[4].status === "ok" && r.frame[4].response?.turn_id === turnId);
    const runId = ack?.frame[4].response?.run_id; assert(runId, "输入回执必须绑定真实run");
    const results = received.filter((r) => r.at >= message.at && r.frame[2] === message.frame[2] && r.frame[3] === "turn_result" && r.frame[4].turn_id.startsWith(turnId) && !r.frame[4].truthfulness?.artifact_adopted);
    assert(results.length, `缺少请求结果: ${turnId}`);
    return { message, turnId, runId, result: results.at(-1).frame[4], prompts: llm.filter((r) => r.work_id === workId && r.turn_id?.startsWith(turnId)).map((r) => typeof r.prompt === "string" ? r.prompt : JSON.stringify(r.request?.body ?? {})), scoped: received.filter((r) => r.at >= message.at && r.frame[2] === message.frame[2] && (r.frame[4].run_id === runId || r.frame[4].run_ref === runId || r.frame[4].turn_id?.startsWith(turnId))) };
  };
  const format = resultForText(inputs.format), content = resultForText(inputs.content), missing = resultForText(inputs.format, config.missing_work_id);
  const candidate = (turn) => turn.result.adoption_state?.pending?.find((p) => ["prose_fragment", "prose_formatting_plan"].includes(p.artifact_type));
  const f = candidate(format), c = candidate(content); assert(f && c, "缺少修订候选");
  const baseline = snapshots.baseline.main, afterFormat = snapshots["format-after"].main, afterContent = snapshots["content-after"].main, restored = snapshots.restored.main, final = snapshots.final.main;
  const fc = revisionChecks(f, baseline, afterFormat, "format_only"), cc = revisionChecks(c, afterFormat, afterContent, "target_segments");
  const actions = sent.filter((r) => r.frame[2] === `workspace:${config.work_id}` && r.frame[3] === "author_action");
  const edited = actions.filter((r) => r.frame[4].action.action_type === "edit_then_accept");
  assert.equal(edited.length, 2, "两段源正文须分别经UI编辑采纳");
  const editedTexts = edited.map((r) => r.frame[4].action.payload?.edited_content ?? r.frame[4].action.payload?.edited_text ?? r.frame[4].action.payload?.content);
  const allPending = mainReceived.filter((r) => r.frame[3] === "turn_result").flatMap((r) => r.frame[4].adoption_state?.pending ?? []);
  const firstCandidate = allPending.find((p) => p.artifact_id === edited[0].frame[4].action.target_ref);
  const receiptFor = (entry, source) => {
    const sends = actions.filter((r) => r.frame[4].action.target_ref === entry.artifact_id && ["accept", "adopt", "confirm_adoption"].includes(r.frame[4].action.action_type));
    assert.equal(sends.length, 1, "修订稿只采纳一次且必须来自UI");
    const action = sends[0].frame[4].action;
    assert.equal(action.source_turn_ref, source.result.turn_id, "采纳必须绑定候选来源turn");
    const done = mainReceived.find((r) => r.at >= sends[0].at && r.frame[3] === "turn_result" && r.frame[4].truthfulness?.artifact_adopted === true && r.frame[4].adoption_state?.resolved?.some((p) => p.artifact_id === entry.artifact_id));
    const receipt = mainReceived.find((r) => r.at >= sends[0].at && r.frame[3] === "action_result" && r.frame[4].status === "accepted" && (r.frame[4].action_id === action.action_id || r.frame[4].target_ref === entry.artifact_id));
    const text = JSON.stringify({ result: done?.frame[4], receipt: receipt?.frame[4] });
    return { applied: Boolean(done), echoes: text.includes('"adoption_effect"') && text.includes('"superseded_draft_refs"'), at: sends[0].at };
  };
  const fa = receiptFor(f, format), ca = receiptFor(c, content);
  const reading = (label, after) => {
    const text = ax(label), at = new Date(fs.statSync(path.join(parent, `${label}.ax.txt`)).mtimeMs).toISOString();
    const responses = mainReceived.filter((r) => r.at >= after && r.at <= at && r.frame[3] === "phx_reply" && r.frame[4].status === "ok" && r.frame[4].response?.title === "第01章：夜潮" && Array.isArray(r.frame[4].response?.scenes));
    assert(responses.length, `${label}缺少真实阅读投影响应`);
    const response = responses.at(-1).frame[4].response;
    const flat = text.replace(/^\s*\d+ text\s*/gm, "").replace(/\n/g, " ");
    const count = /本章有效字数\s*([\d,]+)\s*字/.exec(flat);
    return { visible: text.includes("阅读模式") && text.includes("第01章：夜潮"), text: response.scenes.map((s) => s.content).filter(Boolean).join("\n\n"), words: count ? Number(count[1].replaceAll(",", "")) : null };
  };
  const fr = reading("T1-reading", fa.at), cr = reading("T2-reading", ca.at), rr = reading("T5-reading-restored", snapshots["content-after"].at);
  const sn = resultForText(inputs.search_new), so = resultForText(inputs.search_old);
  const observation = (turn) => turn.scoped.filter((r) => r.frame[3] === "agent_event" && JSON.stringify(r.frame[4]).includes("prose_search")).map((r) => JSON.stringify(r.frame[4])).join("\n");
  const oldDrafts = final.drafts.filter((d) => d.chapter_id === config.chapter_a_id && d.draft_status === "SUPERSEDED");
  const summary = final.summaries.filter((s) => s.status === "ACCEPTED").at(-1);
  const oldSummary = baseline.summaries.filter((s) => s.status === "ACCEPTED").at(-1);
  const isolationFrames = received.filter((r) => r.frame[2] === `workspace:${config.isolation_work_id}` && r.frame[3] === "turn_result");
  const formatAx = ax("T1-candidate"), restoredAx = ax("T3-restored");
  const productionUnchanged = same(read(dir, "production-sources-before.json"), productionSources());
  const readOnly = (turn) => {
    const decisions = app.filter((r) => r.event === "judgment.decided.done" && r.turn_id?.startsWith(turn.turnId));
    return same(decisions.map((r) => r.action), ["explore", "reply"]) &&
      !(turn.result.adoption_state?.pending ?? []).length && turn.result.truthfulness?.production_write_performed !== true;
  };
  const scopedChecks = { readonly_new_no_candidate_or_write: readOnly(sn), readonly_old_no_candidate_or_write: readOnly(so) };
  if (replay) {
    assert.equal(shaFile(replay.source_database), replay.source_sha256, "A1原库不得被改动");
    assertScopedProductionChange(parent, read(dir, "production-sources-before.json"));
    const start = read(dir, "replay-start.json"), probe = resultForText(titleProbe), draft = candidate(probe);
    scopedChecks.segment_title_matches_real_scope = draft?.payload?.modification_scope === "target_segments" &&
      ax("T2-title-scoped").includes("第01章：夜潮（指定段落修订稿）");
    scopedChecks.no_new_adoption = !currentWire.some((r) => r.direction === "sent" && r.frame?.[3] === "author_action" && ["accept", "edit_then_accept"].includes(r.frame[4].action?.action_type));
    scopedChecks.canonical_facts_unchanged = same(start.main, snapshots.final.main) && same(start.isolation, snapshots.final.isolation) && same(start.missing, snapshots.final.missing);
    const priorReady = read(parent, "native-driver-ready.json");
    assert.equal(priorReady.browser_driver_started, false);
    assert(!fs.existsSync(path.join(parent, "ui-frames.json")));
    for (const name of read(parent, "native-screenshot-index.json")) {
      const file = path.resolve(parent, name); assert(file.startsWith(parent + path.sep));
      assert(fs.statSync(file).mtimeMs >= Date.parse(priorReady.ready_at));
      const magic = fs.readFileSync(file).subarray(0, 8).toString("hex"); assert(magic.startsWith("ffd8ff") || magic === "89504e470d0a1a0a");
    }
  }
  const checks = {
    same_title_ambiguous_blocked_with_clarification: isolationFrames.length > 0 && /多个标题|章节卡片|章序号|同名/.test(ax("T0-ambiguous")) && isolationFrames.every((r) => !(r.frame[4].adoption_state?.pending ?? []).length),
    same_title_zero_write_no_new_chapter: same(snapshots.seed.isolation, snapshots["isolation-after"].isolation) && same(snapshots.seed.isolation, snapshots.final.isolation),
    unique_title_candidate_has_chapter_ref: firstCandidate?.target_chapter_ref === `chapter:${config.chapter_a_id}`,
    main_edit_then_accept_binds_chapter: refsOf(snapshots["first-adopted"].main).length === 1 && snapshots["first-adopted"].isolation.drafts.length === 0,
    two_accepted_fragments_built_via_real_ui: same(editedTexts, [config.initial, config.continuation]) && refsOf(baseline).length === 2 && acceptedText(baseline) === `${config.initial}\n\n${config.continuation}`,
    format_target_chapter_ref_present: fc.target,
    format_judgment_bound_chapter: format.prompts.some((p) => p.includes(`chapter:${config.chapter_a_id}`) && /format_only|整章/.test(p)),
    format_writer_prompt_covers_both_fragments: format.prompts.some((p) => p.includes("点灯人第一次点灯时才二十五岁") && p.includes("点灯人不能回头看灯焰")),
    format_candidate_covers_both_fragments: fc.complete,
    format_base_text_covers_both_fragments: fc.base,
    format_effect_format_paragraphs: fc.effect,
    format_modification_scope: fc.scope,
    format_covered_refs_match: fc.covered,
    format_expected_base_versions_present: fc.versions,
    format_plan_preserves_bytes_and_adds_paragraph: fc.change,
    format_adoption_applied: fa.applied,
    format_adoption_receipt_echoes_effect: fa.echoes,
    format_same_chapter_identity: fc.identity,
    format_old_fragments_superseded: fc.superseded,
    format_reading_equals_preview: fc.current && fr.text === bodyOf(f),
    content_target_chapter_ref_present: cc.target,
    content_candidate_matches_bound_segment: cc.complete && cc.base && cc.covered && cc.versions && cc.effect && cc.scope,
    content_only_specified_change_applied: cc.change,
    content_adoption_applied: ca.applied,
    content_adoption_receipt_echoes_effect: ca.echoes,
    content_same_chapter_identity: cc.identity && cc.superseded,
    content_reading_consumes_new_value: cc.current && cr.text.includes("三十岁") && !cr.text.includes("二十五岁"),
    refresh_idempotent: same(identityOf(afterContent), identityOf(restored)) && acceptedText(afterContent) === acceptedText(restored) && !/button.*(?:应用分段方案|保存修订稿|保存为章节正文)/.test(restoredAx),
    format_visible_target_and_scope: /第01章[：:]夜潮/.test(formatAx) && /分段方案|整章(排版|内容)修订稿|整章排版|只调整分段|只排版/.test(formatAx),
    missing_ref_no_new_chapter: same(snapshots.seed.missing.chapters, snapshots.final.missing.chapters),
    missing_ref_zero_write: missing.result.truthfulness?.production_write_performed !== true && snapshots.final.missing.drafts.length === 0,
    missing_ref_blocked_with_clarification: /裁决|澄清|无法|需要你|多个标题|确认目标/.test(ax("T4-missing")),
    missing_ref_no_new_writing_execution: missing.result.truthfulness?.tool_called !== true && !(missing.result.adoption_state?.pending ?? []).length,
    reading_projection_after_t1_equals_new_candidate: fr.visible && fr.text === bodyOf(f),
    reading_projection_after_t2_equals_applied_text: cr.visible && cr.text === b28ExpectedAgeReplacement(acceptedText(afterFormat)).final_text,
    chapter_word_count_matches_new_content: cr.words === words(acceptedText(afterContent)),
    reading_after_refresh_consumes_same_new_value: rr.visible && rr.text === cr.text && rr.words === cr.words,
    reading_visible_target_chapter: fr.visible && cr.visible,
    chapter_summary_refreshed_after_replace_scope: Boolean(summary) && (!oldSummary || summary.id !== oldSummary.id && summary.updated_at >= oldSummary.updated_at),
    chapter_summary_not_pointing_to_superseded_old_draft: Boolean(summary) && !oldDrafts.some((d) => JSON.stringify({ source_ref: summary.source_ref, revision_base: summary.revision_base }).includes(d.id)),
    next_round_context_reads_new_chapter: sn.prompts.some((p) => p.includes("三十岁") && p.includes("点灯人不能回头看灯焰") && !p.includes("点灯人第一次点灯时才二十五岁")),
    retrieval_hits_new_value: observation(sn).includes("三十岁") && /命中/.test(observation(sn) + sn.result.assistant_message?.text),
    retrieval_old_value_not_current: /未检索到|未命中/.test(observation(so)) && !/命中\s*\d+\s*章/u.test(observation(so)),
    history_old_drafts_superseded_and_retained: oldDrafts.length >= 3 && oldDrafts.some((d) => d.content.includes("【初稿末句】")) && oldDrafts.some((d) => d.content.includes("【续写末句】")),
    current_projection_only_new_accepted_draft: refsOf(final).length === 1 && acceptedText(final) === b28ExpectedAgeReplacement(acceptedText(afterFormat)).final_text,
    ui_source_and_scope_visible: /第01章[：:]夜潮/.test(ax("T8-archive")) && /第01章[：:]夜潮/.test(formatAx),
    production_sources_unchanged_during_measurement: productionUnchanged,
    no_acceptance_hooks_added: productionUnchanged,
  };
  // 最后两项比较本批生产源码指纹；沿用已有产品，验收适配不向产品添加行为。
  assert.equal(Object.keys(checks).length, 48);
  assert(ui.screenshots.length >= (replay ? 4 : 8));
  for (const name of ui.screenshots) {
    const file = path.resolve(dir, name); assert(file.startsWith(dir + path.sep)); assert(fs.statSync(file).mtimeMs >= Date.parse(ready.ready_at));
    const magic = fs.readFileSync(file).subarray(0, 8).toString("hex"); assert(magic.startsWith("ffd8ff") || magic === "89504e470d0a1a0a");
  }
  write(dir, "b28-native-checks.json", { checks, scoped_checks: scopedChecks, failed: Object.keys(checks).filter((key) => !checks[key]), source: "既有B28矩阵48项，原生UI/网络/持久化对账", parent_failed_batch: replay?.parent ?? null });
  assert(Object.values(checks).every(Boolean), `B28原生断言失败: ${Object.keys(checks).filter((k) => !checks[k]).join(", ")}`);
  assert(Object.values(scopedChecks).every(Boolean), `scoped断言失败: ${Object.keys(scopedChecks).filter((k) => !scopedChecks[k]).join(", ")}`);
  write(dir, "summary.json", { slice_id: "b28-whole-chapter-revision", surface: "tauri", driver: ui.driver, verified_at: new Date().toISOString(), checks, scoped_checks: scopedChecks, checks_passed: 48, checks_total: 48, trials: ["T0a", "T0b", "T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"], screenshots: ui.screenshots,
    evidence_batches: replay ? { inherited: { directory: parent, status: "failed_readonly_followup", trials: ["T0a", "T0b", "T1", "T2-data", "T3", "T5", "T6"] }, current: { directory: dir, trials: ["T2-title", "T4", "T7", "T8"] }, source_database_sha256: replay.source_sha256 } : null });
  console.log("B28 原生48项对账通过");
}

export async function main([mode, artifact, checkpoint]) {
  const dir = path.resolve(artifact);
  if (mode === "prepare") return prepare(dir);
  if (mode === "copy-source") return copySource(dir, checkpoint);
  if (mode === "capture") return capture(dir, checkpoint);
  if (mode === "verify") return verify(dir);
  throw new Error("unknown mode");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    if (process.argv[2] === "prepare") {
      const dir = path.resolve(process.argv[3]);
      if (!fs.existsSync(path.join(dir, "failure.json"))) write(dir, "failure.json", { at: new Date().toISOString(), phase: "CP0-prepare", reason: error.message });
    }
    console.error(error); process.exitCode = 1;
  });
}
