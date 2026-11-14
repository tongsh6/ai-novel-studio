// live verifier 邻接 IO：真实 transport/checkpoint 文件、11 表 SQLite 与作者可见
// 页面证据上的端到端 verify。批次模板由 `fixtures/authoring_live_io_fixture.mjs`
// 在 run 内按规格物化一次（默认 live / 无 used refs / 真实 SSE / G2 / G3 各自模板，
// 只读共享）；需要改 config/wire/DB/strata-slot 或让 verify 写 summary 的 case 取
// `withWorkingCopy` 隔离副本。预注册把 evidence.dir 绑定到批次绝对路径，故只在副本
// 上按本批目录重写，不进入共享模板。纯 L1–L12 判据在邻接
// `authoring_live_evidence.test.mjs`，不建目录/DB。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { verifyLiveBatch } from "./authoring_live_evidence.mjs";
import { FIXTURE_RESPONSE_FORMAT } from "./authoring_call_evidence.mjs";
import { sha256 } from "./scenario_evidence.mjs";
import { materializeFixture, openTestRunScope, withWorkingCopy } from "../test_env.mjs";
import {
  AUTHOR,
  G2_FIRST_READ,
  G2_LAST_READ,
  G2_MESSAGE,
  G2_VISIBLE_TARGET,
  G3_MESSAGE,
  SSE_CALL,
  SSE_TOOL_CALL,
  sseRecord,
  sseRecords,
  visibleFinal,
  visibleReadOnlyFinal,
  visibleReadingPage,
} from "./fixtures/authoring_live_facts.mjs";
import {
  LIVE_DB_REL,
  authorVisibleFixtureSpec,
  insertCanonicalRun,
  liveBatchFixtureSpec,
} from "./fixtures/authoring_live_io_fixture.mjs";

let runScope;

test.before(() => {
  runScope = openTestRunScope();
});

test.after(() => {
  runScope?.close();
});

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

function liveTemplate(options = {}) {
  return materializeFixture(liveBatchFixtureSpec(options), { scope: runScope });
}

function visibleTemplate(mode) {
  return materializeFixture(authorVisibleFixtureSpec({ mode }), { scope: runScope });
}

function rewriteRecords(dir, records) {
  writeJsonl(path.join(dir, "llm-calls", "2026-11-03.jsonl"), records);
}

// 预注册副本冻结在本批目录内：evidence.dir 指向工作副本，配置标记用同一哈希。
// 普通 live 不写 author_visible_target；b82-g2/b82-g3 写入冻结目标。
function bindPreregistration(dir, { scenarioId = null, authorVisibleTarget = null, message = AUTHOR } = {}) {
  const file = path.join(dir, "preregistration.json");
  const text = JSON.stringify(
    {
      id: "b82-live-sse-prereg",
      model: { provider: "strata", model: "iq3_s" },
      scenarios: [{
        ...(scenarioId ? { id: scenarioId } : {}),
        ...(authorVisibleTarget ? { author_visible_target: authorVisibleTarget } : {}),
        message,
        evidence: { dir },
      }],
    },
    null,
    2,
  );
  fs.writeFileSync(file, text);
  const configFile = path.join(dir, "native-b71-config.json");
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  config.message = message;
  if (authorVisibleTarget) config.author_visible_target = authorVisibleTarget;
  else delete config.author_visible_target;
  config.preregistration = { id: "b82-live-sse-prereg", sha256: sha256(text), model: "iq3_s" };
  writeJson(configFile, config);
  return { id: "b82-live-sse-prereg", sha256: sha256(text), model: "iq3_s" };
}

function assertVisiblePreregistration(copy, mode) {
  const message = mode === "read_only" ? G3_MESSAGE : G2_MESSAGE;
  bindPreregistration(copy.dir, {
    scenarioId: mode === "read_only" ? "b82-g3" : "b82-g2",
    authorVisibleTarget: G2_VISIBLE_TARGET,
    message,
  });
}

test("live verifier：完整 provider=strata 批次通过机制判据并写 summary", () => {
  withWorkingCopy(liveTemplate(), (copy) => {
    const { checks, summary } = verifyLiveBatch(copy.dir);
    assert.deepEqual(checks.failed_mechanism, []);
    assert.equal(checks.checks.mechanism.ir_projection_structure, true);
    assert.equal(checks.checks.mechanism.author_bytes_exact, true);
    assert.equal(checks.checks.mechanism.unadopted_zero_write, true);
    assert.equal(checks.checks.mechanism.usage_collected, true);
    assert.equal(checks.checks.mechanism.why_replay_zero_provider, true);
    assert.equal(summary.provider, "strata");
    assert.equal(summary.verdict.mechanism, "pass");
    assert.equal(summary.verdict.full_g1_g6_signed, false);
    assert(summary.not_signed.includes("I10_literary_quality_not_signed"));
    assert.equal(summary.tentative_design_derivations.length, 1);
    assert.equal(summary.tentative_design_derivations[0].provider_call_ref, "pcall_live_1");
    assert.equal(summary.refs.ok, true);
    assert(fs.existsSync(path.join(copy.dir, "summary.json")));
    assert(fs.existsSync(path.join(copy.dir, "native-b71-checks.json")));
    assert(fs.existsSync(path.join(copy.dir, "native-ws-frames.json")));
  });
});

test("live verifier：strata 未核验卸载时失败关闭", () => {
  withWorkingCopy(liveTemplate(), (copy) => {
    const slotPath = path.join(copy.dir, "strata-slot.json");
    const slot = JSON.parse(fs.readFileSync(slotPath, "utf8"));
    writeJson(slotPath, { ...slot, loaded_after: true, unloaded: false });
    assert.throws(() => verifyLiveBatch(copy.dir), /strata 批次结束必须核验 loaded=null/u);
  });
});

test("live verifier：截图不足或缺 strata-slot 时失败关闭", () => {
  withWorkingCopy(liveTemplate(), (copy) => {
    fs.rmSync(path.join(copy.dir, "after-input.png"));
    fs.rmSync(path.join(copy.dir, "final.png"));
    const uiPath = path.join(copy.dir, "native-ui-complete.json");
    const ui = JSON.parse(fs.readFileSync(uiPath, "utf8"));
    writeJson(uiPath, { ...ui, screenshots: ["01-workbench.png"] });
    assert.throws(() => verifyLiveBatch(copy.dir), /原生截图不足/u);
  });
  withWorkingCopy(liveTemplate(), (copy) => {
    fs.rmSync(path.join(copy.dir, "strata-slot.json"));
    assert.throws(() => verifyLiveBatch(copy.dir), /缺少 strata-slot\.json/u);
  });
});

test("live verifier：journey/provider 不匹配时拒绝", () => {
  withWorkingCopy(liveTemplate(), (copy) => {
    const configFile = path.join(copy.dir, "native-b71-config.json");
    const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
    writeJson(configFile, { ...config, journey: "pending" });
    assert.throws(() => verifyLiveBatch(copy.dir), /live verifier 只接受 journey=live/u);
  });
});

test("live verifier：run 与本批 session 错绑时失败关闭，不扫描其它作品/会话", () => {
  withWorkingCopy(liveTemplate(), (copy) => {
    const db = new DatabaseSync(path.join(copy.dir, LIVE_DB_REL));
    try {
      db.prepare("UPDATE agent_runs SET session_id = ? WHERE id = ?").run("session-other", "run_live_1");
    } finally {
      db.close();
    }
    assert.throws(() => verifyLiveBatch(copy.dir), /恰好一行/u);
  });
});

test("live verifier：DB 中其它作品的 used_refs 不进入本批判定（只读本批段）", () => {
  withWorkingCopy(liveTemplate({ usedRefs: [] }), (copy) => {
    const db = new DatabaseSync(path.join(copy.dir, LIVE_DB_REL));
    try {
      insertCanonicalRun(db, {
        runId: "run_other_work",
        workId: "work-other",
        sessionId: "session-other",
        usedRefs: ["observation:obs_out_of_boundary"],
      });
      db.prepare("INSERT INTO decision_traces (trace_id, workspace_id, session_id, turn_id, context_refs) VALUES (?,?,?,?,?)")
        .run("trace_other", "test", "session-other", "message_live_1", '["chapter:foreign"]');
    } finally {
      db.close();
    }
    const { summary } = verifyLiveBatch(copy.dir);
    // 本批段没有 used 声明 → unknown；若扫了别的作品行会误判为越界失败。
    assert.equal(summary.refs.ok, null);
    assert.equal(summary.refs.reason, "used_context_refs_unavailable");
  });
});

// B82 §16.9：冻结的普通 live 批次必须做过真实 SSE 逐调用对账，且只对账内的记录
// 才能进入 b71LiveModelBehavior 签证；本单元只接对账，G2 页级仍未代签。
test("B82 冻结 live：真实 SSE 逐调用对账写入 measured.native_call 并只用对账后记录", () => {
  withWorkingCopy(liveTemplate({ nativeCall: true }), (copy) => {
    bindPreregistration(copy.dir, { message: AUTHOR });
    const { summary } = verifyLiveBatch(copy.dir);
    assert.equal(summary.measured.native_call.sse_decoder_tool_only_count, 2);
    assert.deepEqual(summary.measured.native_call.provider_call_refs, ["pcall_live_1", "pcall_live_2"]);
    assert.deepEqual(summary.measured.native_call.provider_run_refs, ["prun_live_1", "prun_live_2"]);
    assert.equal(summary.measured.native_call.bound_request_count, 2);
    assert.equal(summary.measured.provider_calls, 2);
    assert.equal(summary.verdict.mechanism, "pass");
    // 非 b82-g2 的冻结 live 不派生作者可见页面判据，保持原入口。
    assert.equal(summary.author_visible, undefined);
  });
});

// B82 G2 新批次只签作者可见页面：真实原话、末页阅读原文前后不变、同章局部
// 「指定段落修订稿」待采纳候选。旧内部页/候选对账保留在纯 helper 测试中诊断。
test("B82 冻结 live：b82-g2 只按作者可见消息/末页阅读/同章修订候选签页面", () => {
  withWorkingCopy(visibleTemplate("candidate"), (copy) => {
    assertVisiblePreregistration(copy, "candidate");
    const { checks, summary } = verifyLiveBatch(copy.dir);
    assert.equal(checks.author_visible.ok, true, checks.author_visible.failures.join(","));
    assert.equal(checks.author_visible.observed.author_message, true);
    assert.equal(checks.author_visible.observed.reading_unchanged, true);
    assert.equal(checks.author_visible.observed.reading_complete, true);
    assert.equal(checks.author_visible.observed.pending_candidate, true);
    assert.deepEqual(checks.failed, []);
    assert.equal(summary.verdict.author_visible, "pass");
    assert.equal(summary.verdict.full_g1_g6_signed, false);
    assert.equal(summary.scenario_id, "b82-g2");
    assert.equal(summary.surface, "tauri-native");
    assert.equal(summary.screenshots.length, 5);
    assert.equal(summary.wait_ledger.kinds.includes("ack"), false, "B82 不要求 ack 分型");
    assert.equal(summary.author_visible_target.chapter_title, G2_VISIBLE_TARGET.chapter_title);
  });
});

test("B82 冻结 live：b82-g2 页面判据不生成也不读取 DB/wire", () => {
  withWorkingCopy(visibleTemplate("candidate"), (copy) => {
    assertVisiblePreregistration(copy, "candidate");
    // 从构造开始就不写应用内部证据，而不是先写再删。
    for (const entry of ["database", "seed.log", "llm-calls", "app-log", "native-transport.jsonl", "b71-start.json", "b71-final.json"]) {
      assert.equal(fs.existsSync(path.join(copy.dir, entry)), false, `作者可见批次不应生成 ${entry}`);
    }
    const { summary } = verifyLiveBatch(copy.dir);
    assert.equal(summary.verdict.author_visible, "pass");
    assert.equal(summary.author_visible.observed.reading_complete, true);
    assert.equal(summary.author_visible.observed.pending_candidate, true);
  });
});

// B82 G3 只读批次：自然只读原话、目标章一个真实范围页、本次完成且无候选/保存。
test("B82 冻结 live：b82-g3 按自然只读原话/真实已读范围/完成态签页面", () => {
  withWorkingCopy(visibleTemplate("read_only"), (copy) => {
    assertVisiblePreregistration(copy, "read_only");
    const { checks, summary } = verifyLiveBatch(copy.dir);
    assert.equal(checks.author_visible.ok, true, checks.author_visible.failures.join(","));
    assert.equal(checks.author_visible.observed.author_message, true);
    assert.equal(checks.author_visible.observed.completed, true);
    assert.equal(checks.author_visible.observed.reply_visible, true);
    assert.equal(checks.author_visible.observed.reading_activity, true);
    assert.deepEqual(checks.author_visible.observed.reading_range, {
      start: 1,
      end: 6000,
      total: 7000,
    });
    assert.equal(checks.author_visible.observed.reading_unchanged, true);
    assert.equal(checks.author_visible.observed.pending_candidate, false);
    assert.equal(checks.author_visible.observed.save_action, false);
    assert.deepEqual(checks.failed, []);
    assert.equal(summary.scenario_id, "b82-g3");
    assert.equal(summary.verdict.author_visible, "pass");
    assert.equal(summary.verdict.full_g1_g6_signed, false);
    assert(summary.not_signed.includes("g3_validation_result_not_signed"));
    assert(summary.not_signed.includes("mechanism"));
    assert.equal(summary.wait_ledger.kinds.includes("ack"), false, "B82 不要求 ack 分型");
  });
});

test("B82 冻结 live：b82-g3 模型失败或等待时留证不签", () => {
  for (const status of ["失败", "等待你回复"]) {
    withWorkingCopy(visibleTemplate("read_only"), (copy) => {
      assertVisiblePreregistration(copy, "read_only");
      fs.writeFileSync(
        path.join(copy.dir, "final.text.txt"),
        visibleReadOnlyFinal().replace("(value=已完成)", `(value=${status})`),
      );
      assert.throws(() => verifyLiveBatch(copy.dir), /author_visible_outcome_not_completed/u);
      const summary = JSON.parse(fs.readFileSync(path.join(copy.dir, "summary.json"), "utf8"));
      assert.equal(summary.verdict.author_visible, "fail");
      assert.equal(summary.author_visible.observed.completed, false);
      assert(summary.author_visible.failures.includes("author_visible_outcome_not_completed"));
    });
  }
});

test("B82 冻结 live：b82-g3 本次出现新候选或保存操作时拒绝", () => {
  withWorkingCopy(visibleTemplate("read_only"), (copy) => {
    assertVisiblePreregistration(copy, "read_only");
    fs.writeFileSync(
      path.join(copy.dir, "final.text.txt"),
      visibleReadOnlyFinal().replace(
        "(value=已完成)",
        [
          "第02章：灰烬中的手印（指定段落修订稿）",
          "修订稿候选",
          "保存修订稿",
          "(value=已完成)",
        ].join("\n"),
      ),
    );
    assert.throws(() => verifyLiveBatch(copy.dir), /unexpected_pending_candidate/u);
    const summary = JSON.parse(fs.readFileSync(path.join(copy.dir, "summary.json"), "utf8"));
    assert.equal(summary.author_visible.observed.pending_candidate, true);
    assert.equal(summary.author_visible.observed.save_action, true);
  });
});

test("B82 冻结 live：b82-g3 没有真实范围页时缺证并保留报告", () => {
  withWorkingCopy(visibleTemplate("read_only"), (copy) => {
    assertVisiblePreregistration(copy, "read_only");
    fs.writeFileSync(
      path.join(copy.dir, "final.text.txt"),
      visibleReadOnlyFinal().replace(
        G2_FIRST_READ,
        "(value=已阅读章节正文「灰烬中的手印」（第 2 章）（有效字数 6244）。)",
      ),
    );
    assert.throws(() => verifyLiveBatch(copy.dir), /reading_range_missing/u);
    const summary = JSON.parse(fs.readFileSync(path.join(copy.dir, "summary.json"), "utf8"));
    assert.equal(summary.author_visible.observed.reading_activity, true);
    assert.equal(summary.author_visible.observed.reading_range, null);
  });
});

test("B82 冻结 live：b82-g3 旧回合候选不能代签本次只读完成", () => {
  withWorkingCopy(visibleTemplate("read_only"), (copy) => {
    assertVisiblePreregistration(copy, "read_only");
    fs.writeFileSync(
      path.join(copy.dir, "final.text.txt"),
      [
        "第02章：灰烬中的手印（指定段落修订稿）",
        "修订稿候选",
        "保存修订稿",
        visibleReadOnlyFinal(),
      ].join("\n"),
    );
    const { summary } = verifyLiveBatch(copy.dir);
    assert.equal(summary.verdict.author_visible, "pass");
    assert.equal(summary.author_visible.observed.pending_candidate, false);
    assert.equal(summary.author_visible.observed.save_action, false);
  });
});

test("B82 冻结 live：b82-g2 单槽模型与冻结模型不一致时拒绝", () => {
  withWorkingCopy(visibleTemplate("candidate"), (copy) => {
    assertVisiblePreregistration(copy, "candidate");
    const slotPath = path.join(copy.dir, "strata-slot.json");
    const slot = JSON.parse(fs.readFileSync(slotPath, "utf8"));
    fs.writeFileSync(slotPath, JSON.stringify({ ...slot, model: "other-model" }, null, 2));
    assert.throws(() => verifyLiveBatch(copy.dir), /单槽模型与冻结模型不一致/u);
  });
});

test("B82 冻结 live：b82-g2 旧失败批次只有失败/未完成时缺证拒绝并保留报告", () => {
  withWorkingCopy(visibleTemplate("candidate"), (copy) => {
    assertVisiblePreregistration(copy, "candidate");
    fs.writeFileSync(path.join(copy.dir, "final.text.txt"), [
      G2_VISIBLE_TARGET.work_title,
      "你",
      G2_MESSAGE,
      "AI 助手",
      "这次候选处理未完成，目标可能已被处理或修订未成功。没有据此采纳或写入作品事实，请核对当前候选后继续。",
      "(value=失败)",
      "(value=第 3/3 步)",
    ].join("\n"));
    assert.throws(() => verifyLiveBatch(copy.dir), /pending_candidate_missing/u);
    const summary = JSON.parse(fs.readFileSync(path.join(copy.dir, "summary.json"), "utf8"));
    assert.equal(summary.verdict.author_visible, "fail");
    assert(summary.author_visible.failures.includes("pending_candidate_missing"));
  });
});

test("B82 冻结 live：b82-g2 历史同章候选不能代签本次失败终局", () => {
  withWorkingCopy(visibleTemplate("candidate"), (copy) => {
    assertVisiblePreregistration(copy, "candidate");
    fs.writeFileSync(path.join(copy.dir, "final.text.txt"), [
      "第02章：灰烬中的手印（指定段落修订稿）",
      "这是待保存章节草稿。确认保存后会写入章节正文；未保存前不会进入阅读模式或作品事实。预览：指定段落修订稿",
      "指定段落修订稿 他把第七枚手印按进灰里。 创作依据：旧回合。",
      "修订稿候选",
      "保存修订稿",
      "你",
      G2_MESSAGE,
      "AI 助手",
      "(value=失败)",
    ].join("\n"));
    assert.throws(() => verifyLiveBatch(copy.dir), /pending_candidate_missing/u);
    const summary = JSON.parse(fs.readFileSync(path.join(copy.dir, "summary.json"), "utf8"));
    assert.equal(summary.author_visible.observed.pending_candidate, false);
  });
});

test("B82 冻结 live：b82-g2 可见等待不自动作答，也不因此签页面", () => {
  withWorkingCopy(visibleTemplate("candidate"), (copy) => {
    assertVisiblePreregistration(copy, "candidate");
    fs.writeFileSync(path.join(copy.dir, "final.text.txt"), [
      G2_VISIBLE_TARGET.work_title,
      "你",
      G2_MESSAGE,
      "AI 助手",
      "我需要你补充要修订的段落。",
      "(value=等待你回复)",
    ].join("\n"));
    assert.throws(() => verifyLiveBatch(copy.dir), /pending_candidate_missing/u);
    const summary = JSON.parse(fs.readFileSync(path.join(copy.dir, "summary.json"), "utf8"));
    assert.equal(summary.author_visible.observed.pending_candidate, false);
    assert(summary.author_visible.failures.includes("pending_candidate_missing"));
  });
});

test("B82 冻结 live：b82-g2 缺 final 页时缺证失败并保留报告", () => {
  withWorkingCopy(visibleTemplate("candidate"), (copy) => {
    assertVisiblePreregistration(copy, "candidate");
    fs.rmSync(path.join(copy.dir, "final.text.txt"));
    assert.throws(() => verifyLiveBatch(copy.dir), /final_visible_missing/u);
    const summary = JSON.parse(fs.readFileSync(path.join(copy.dir, "summary.json"), "utf8"));
    assert.equal(summary.verdict.author_visible, "fail");
    assert(summary.author_visible.failures.includes("final_visible_missing"));
  });
});

test("B82 冻结 live：b82-g2 缺阅读后页时缺证失败并保留报告", () => {
  withWorkingCopy(visibleTemplate("candidate"), (copy) => {
    assertVisiblePreregistration(copy, "candidate");
    fs.rmSync(path.join(copy.dir, "03-reading-after.text.txt"));
    assert.throws(() => verifyLiveBatch(copy.dir), /reading_after_missing/u);
    const summary = JSON.parse(fs.readFileSync(path.join(copy.dir, "summary.json"), "utf8"));
    assert.equal(summary.verdict.author_visible, "fail");
    assert(summary.author_visible.failures.includes("reading_after_missing"));
  });
});

test("B82 冻结 live：b82-g2 阅读页仍显示旧投影状态时拒绝", () => {
  withWorkingCopy(visibleTemplate("candidate"), (copy) => {
    assertVisiblePreregistration(copy, "candidate");
    fs.writeFileSync(
      path.join(copy.dir, "02-reading-before.text.txt"),
      `${visibleReadingPage()}\n投影状态：重建中\n正在读取最新章节，请稍候。`,
    );
    assert.throws(() => verifyLiveBatch(copy.dir), /reading_before_projection_not_fresh/u);
    const summary = JSON.parse(fs.readFileSync(path.join(copy.dir, "summary.json"), "utf8"));
    assert.equal(summary.author_visible.observed.reading_unchanged, false);
  });
});

test("B82 冻结 live：b82-g2 首页读活动无可见范围时不补缺口", () => {
  withWorkingCopy(visibleTemplate("candidate"), (copy) => {
    assertVisiblePreregistration(copy, "candidate");
    fs.writeFileSync(
      path.join(copy.dir, "final.text.txt"),
      visibleFinal().replace(
        G2_FIRST_READ,
        "(value=已阅读章节正文「灰烬中的手印」（第 2 章）（有效字数 6244）。)",
      ),
    );
    assert.throws(() => verifyLiveBatch(copy.dir), /reading_not_complete/u);
    const summary = JSON.parse(fs.readFileSync(path.join(copy.dir, "summary.json"), "utf8"));
    assert.equal(summary.author_visible.observed.reading_complete, false);
  });
});

test("B82 冻结 live：b82-g2 只改非摘录正文也必须拒绝（完整同页比较）", () => {
  withWorkingCopy(visibleTemplate("candidate"), (copy) => {
    assertVisiblePreregistration(copy, "candidate");
    fs.writeFileSync(
      path.join(copy.dir, "03-reading-after.text.txt"),
      visibleReadingPage().replace(
        "灰烬从指缝里漏下去，井底的风把纸灰卷成一条细线。",
        "灰烬从指缝里漏下去，井底的风把纸灰卷成一条细线。（正文其它位置被改）",
      ),
    );
    assert.throws(() => verifyLiveBatch(copy.dir), /reading_changed/u);
    const summary = JSON.parse(fs.readFileSync(path.join(copy.dir, "summary.json"), "utf8"));
    assert.equal(summary.author_visible.observed.reading_unchanged, false);
  });
});

test("B82 冻结 live：b82-g2 目标章缺少章序完整标签时缺证", () => {
  withWorkingCopy(visibleTemplate("candidate"), (copy) => {
    bindPreregistration(copy.dir, {
      scenarioId: "b82-g2",
      authorVisibleTarget: { ...G2_VISIBLE_TARGET, chapter_title: "灰烬中的手印" },
      message: G2_MESSAGE,
    });
    assert.throws(() => verifyLiveBatch(copy.dir), /chapter_label_incomplete/u);
    const summary = JSON.parse(fs.readFileSync(path.join(copy.dir, "summary.json"), "utf8"));
    assert(summary.author_visible.failures.includes("chapter_label_incomplete"));
  });
});

test("B82 冻结 live：b82-g2 另一章候选不能签同章页面", () => {
  withWorkingCopy(visibleTemplate("candidate"), (copy) => {
    assertVisiblePreregistration(copy, "candidate");
    fs.writeFileSync(
      path.join(copy.dir, "final.text.txt"),
      visibleFinal().replace(
        "第02章：灰烬中的手印（指定段落修订稿）",
        "第01章：夜潮（指定段落修订稿）",
      ),
    );
    assert.throws(() => verifyLiveBatch(copy.dir), /pending_candidate_missing/u);
    const summary = JSON.parse(fs.readFileSync(path.join(copy.dir, "summary.json"), "utf8"));
    assert.equal(summary.author_visible.observed.candidate_same_chapter, false);
  });
});

test("B82 冻结 live：b82-g2 未显示完整阅读时缺证（手工阅读页不能替代读证）", () => {
  withWorkingCopy(visibleTemplate("candidate"), (copy) => {
    assertVisiblePreregistration(copy, "candidate");
    fs.writeFileSync(
      path.join(copy.dir, "final.text.txt"),
      visibleFinal().split(`${G2_FIRST_READ}\n`).join("").split(`${G2_LAST_READ}\n`).join(""),
    );
    assert.throws(() => verifyLiveBatch(copy.dir), /reading_activity_missing/u);
    const summary = JSON.parse(fs.readFileSync(path.join(copy.dir, "summary.json"), "utf8"));
    assert.equal(summary.author_visible.observed.reading_complete, false);
  });
});

test("B82 冻结 live：b82-g2 只显示末页读活动时不算读完整章", () => {
  withWorkingCopy(visibleTemplate("candidate"), (copy) => {
    assertVisiblePreregistration(copy, "candidate");
    fs.writeFileSync(
      path.join(copy.dir, "final.text.txt"),
      visibleFinal().split(`${G2_FIRST_READ}\n`).join(""),
    );
    assert.throws(() => verifyLiveBatch(copy.dir), /reading_not_complete/u);
    const summary = JSON.parse(fs.readFileSync(path.join(copy.dir, "summary.json"), "utf8"));
    assert.equal(summary.author_visible.observed.reading_complete, false);
  });
});

test("B82 冻结 live：b82-g2 缺当前作者消息时不用整页旧候选", () => {
  withWorkingCopy(visibleTemplate("candidate"), (copy) => {
    assertVisiblePreregistration(copy, "candidate");
    // after-input 仍保留作者消息，但当前 final AX 缺 marker：不得用整页旧候选。
    fs.writeFileSync(
      path.join(copy.dir, "final.text.txt"),
      visibleFinal().split(`${G2_MESSAGE}\n`).join(""),
    );
    assert.throws(() => verifyLiveBatch(copy.dir), /author_message_visible_missing/u);
    const summary = JSON.parse(fs.readFileSync(path.join(copy.dir, "summary.json"), "utf8"));
    assert.equal(summary.author_visible.observed.after_input_has_message, true);
    assert.equal(summary.author_visible.observed.pending_candidate, false);
    assert(summary.author_visible.failures.includes("pending_candidate_missing"));
  });
});

test("B82 冻结 live：b82-g2 候选/澄清泄漏技术术语时拒绝", () => {
  withWorkingCopy(visibleTemplate("candidate"), (copy) => {
    assertVisiblePreregistration(copy, "candidate");
    fs.appendFileSync(path.join(copy.dir, "final.text.txt"), "\n本轮候选由 call_id 关联。\n");
    assert.throws(() => verifyLiveBatch(copy.dir), /author_visible_internal_token_leak/u);
    const summary = JSON.parse(fs.readFileSync(path.join(copy.dir, "summary.json"), "utf8"));
    assert.equal(summary.author_visible.observed.author_visible_clean, false);
    assert(summary.author_visible.leak.hits.some((hit) => hit.token === "call_id"));
  });
});

test("B82 冻结 live：旧缺 author_visible_target 的 b82-g2 不能重签页面且保留旧报告", () => {
  withWorkingCopy(visibleTemplate("candidate"), (copy) => {
    bindPreregistration(copy.dir, {
      scenarioId: "b82-g2",
      authorVisibleTarget: null,
      message: G2_MESSAGE,
    });
    assert.equal(fs.existsSync(path.join(copy.dir, "summary.json")), false);
    assert.throws(() => verifyLiveBatch(copy.dir), /缺少冻结的作者可见目标/u);
    assert.equal(fs.existsSync(path.join(copy.dir, "summary.json")), false, "缺目标时不得改写旧报告");
  });
});

test("B82 冻结 live：原生 config 的 scenario_id 不能选择 b82-g2", () => {
  withWorkingCopy(liveTemplate({ nativeCall: true }), (copy) => {
    bindPreregistration(copy.dir, { message: AUTHOR });
    const configFile = path.join(copy.dir, "native-b71-config.json");
    const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
    writeJson(configFile, { ...config, scenario_id: "b82-g2" });
    const { summary } = verifyLiveBatch(copy.dir);
    assert.equal(summary.author_visible, undefined);
    assert.equal(summary.verdict.mechanism, "pass");
  });
});

test("B82 冻结 live：历史占位与缺响应不签", () => {
  const [first, second] = sseRecords();
  withWorkingCopy(liveTemplate({ nativeCall: true }), (copy) => {
    bindPreregistration(copy.dir, { message: AUTHOR });
    rewriteRecords(copy.dir, [first, { ...second, response: { ...second.response, body: "event_stream" } }]);
    assert.throws(() => verifyLiveBatch(copy.dir), /native_call_pairs_bound/u);
  });
  withWorkingCopy(liveTemplate({ nativeCall: true }), (copy) => {
    bindPreregistration(copy.dir, { message: AUTHOR });
    rewriteRecords(copy.dir, [first, { ...second, response: undefined }]);
    assert.throws(() => verifyLiveBatch(copy.dir), /native_call_pairs_bound/u);
  });
});

test("B82 冻结 live：ProviderRun 归属错误不签", () => {
  withWorkingCopy(liveTemplate({ nativeCall: true }), (copy) => {
    bindPreregistration(copy.dir, { message: AUTHOR });
    const db = new DatabaseSync(path.join(copy.dir, LIVE_DB_REL));
    try {
      db.prepare("UPDATE provider_runs SET session_id = ? WHERE id = ?").run("session-other", SSE_CALL.first.prun);
    } finally {
      db.close();
    }
    assert.throws(() => verifyLiveBatch(copy.dir), /native_call_pairs_owned/u);
  });
});

test("B82 冻结 live：scope 外的 SSE 记录不进入模型行为签证", () => {
  withWorkingCopy(liveTemplate({ nativeCall: true }), (copy) => {
    bindPreregistration(copy.dir, { message: AUTHOR });
    const foreign = sseRecord({
      ref: { pcall: "pcall_other_run", prun: "prun_other_run" },
      ts: "2026-11-03T10:00:03.000Z",
      turnId: "message_other_run",
    });
    rewriteRecords(copy.dir, [...sseRecords(), foreign]);
    const { summary } = verifyLiveBatch(copy.dir);
    assert.equal(summary.measured.provider_calls, 2);
    assert(!summary.measured.native_call.provider_call_refs.includes("pcall_other_run"));
  });
});

test("普通 live 入口：无预注册标记时不启用逐调用对账", () => {
  withWorkingCopy(liveTemplate({ nativeCall: true }), (copy) => {
    const { summary } = verifyLiveBatch(copy.dir);
    assert.equal(summary.measured.native_call, null);
    assert.equal(summary.measured.provider_calls, 2);
  });
});

// §16.9 真实来源：共享对账同时接受 fixture 与 SSE，所以冻结入口必须拒绝 fixture
// 替身——即使作用域正确、形状合法、工具事实与 canonical 完全一致。
test("B82 冻结 live：合法 fixture 替身不得冒充真实 SSE 来源", () => {
  const [first, second] = sseRecords();
  withWorkingCopy(liveTemplate({ nativeCall: true }), (copy) => {
    bindPreregistration(copy.dir, { message: AUTHOR });
    rewriteRecords(copy.dir, [
      { ...first, response_format: FIXTURE_RESPONSE_FORMAT, response: { status: "ok", usage: first.response.usage, body: { content: null, tool_calls: [SSE_TOOL_CALL] } } },
      { ...second, response_format: FIXTURE_RESPONSE_FORMAT, response: { status: "ok", usage: second.response.usage, body: { content: "我已核对第01章。", tool_calls: [] } } },
    ]);
    assert.throws(() => verifyLiveBatch(copy.dir), /真实 SSE/u);
  });
});
