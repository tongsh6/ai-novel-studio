// B71 修订场景的 Node 正反例：真实 SQLite + 真实 WS 帧形状，走
// scripts/native_b71_evidence.mjs 的完整 revision verifier 入口。
// 本测试不启动 GUI/Mix、不写产品路径，只证明验收器不会把错绑/缺 pair/
// 未闭合 validation/字节篡改/自动采纳等情况判成通过。
//
// 资源边界：纯判定（章节草稿目标/action ACK/evidence span）零目录/DB；修订批次
// 由 `lib/native_ui/fixtures/native_b71_revision_io_fixture.mjs` 经
// `materializeFixture` 在 run 内物化一次（只读共享），每个写 summary 或篡改单个
// 真实事实的 case 取 `createWorkingCopy` 隔离副本，目录归 run scope 的 work area。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { productionFingerprint } from "./lib/native_ui/scenario_evidence.mjs";
import { buildAuthoringCanonSnapshot } from "./lib/native_ui/authoring_canon_evidence.mjs";
import {
  authorActionAck,
  chapterDraftTarget,
  outsideEvidencePreserved,
} from "./lib/native_ui/authoring_revision_evidence.mjs";
import { main } from "./native_b71_evidence.mjs";
import {
  createWorkingCopy,
  materializeFixture,
  openTestRunScope,
} from "./lib/test_env.mjs";
import {
  CHAPTER_TITLE,
  CHILD_RUN,
  CHILD_TURN,
  ORIGINAL_BODY,
  REVISED_BODY,
  RECEIPT,
  SOURCE_RUN,
  SOURCE_TURN,
  TRACE,
  WORKSPACE,
  canonTables,
  iso,
} from "./lib/native_ui/fixtures/native_b71_revision_facts.mjs";
import {
  REVISION_DB_REL,
  b71RevisionFixtureSpec,
} from "./lib/native_ui/fixtures/native_b71_revision_io_fixture.mjs";

let runScope;
let production;

test.before(() => {
  runScope = openTestRunScope();
});

// 纯判定 case 不触发产品指纹（git 子进程）；首个 IO 消费者才计算一次。
function productionSources() {
  production ??= productionFingerprint();
  return production;
}

test.after(() => {
  runScope?.close();
});

function canonSnapshot(at, withReceipt) {
  return buildAuthoringCanonSnapshot({
    tables: canonTables({ withReceipt }),
    referenceLogs: [],
    at,
  });
}

function fixture() {
  return materializeFixture(
    b71RevisionFixtureSpec({
      canon: {
        start: canonSnapshot(iso(500), false),
        before: canonSnapshot(iso(3500), false),
        final: canonSnapshot(iso(20_000), true),
      },
      production: productionSources(),
    }),
    { scope: runScope },
  );
}

// verify 会写 summary/checks，正例与反例都只改隔离副本。
function writableBatch(t) {
  return createWorkingCopy(fixture(), { context: t }).dir;
}

function wireFrame(direction, at, frame) {
  return { direction, at, frame };
}

function mutateTransport(dir, mutate) {
  const file = path.join(dir, "native-transport.jsonl");
  const rows = fs.readFileSync(file, "utf8").trim().split("\n").map(JSON.parse);
  mutate(rows);
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

function mutateJson(dir, name, mutate) {
  const file = path.join(dir, name);
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  mutate(value);
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function withDb(dir, use) {
  const db = new DatabaseSync(path.join(dir, REVISION_DB_REL));
  try {
    return use(db);
  } finally {
    db.close();
  }
}

function mutateDb(dir, sql, params = []) {
  withDb(dir, (db) => db.prepare(sql).run(...params));
}

test("章节草稿按钮必须绑定目标章标题，不能落到后一章", () => {
  const nodes = [
    { role: "AXStaticText", value: "第01章：底层灵气账单" },
    { role: "AXButton", title: "生成正文草稿" },
    { role: "AXStaticText", value: CHAPTER_TITLE },
    { role: "AXStaticText", value: "主角在废弃矿区遭遇巡检傀儡。" },
    { role: "AXButton", title: "生成正文草稿", path: "target" },
    { role: "AXStaticText", value: "第03章：誓词回环" },
    { role: "AXButton", title: "生成正文草稿", path: "next" },
  ];
  assert.equal(chapterDraftTarget(nodes, CHAPTER_TITLE)?.path, "target");
  assert.equal(chapterDraftTarget(nodes.slice(0, 3), CHAPTER_TITLE), null);
  assert.equal(chapterDraftTarget(nodes, "第02章：另一章"), null);
});

test("author_action ACK 只接受同 join/request/topic 的唯一回复", () => {
  const actionFrame = wireFrame("sent", iso(0), ["join-1", "req-action", "workspace:w", "author_action", { action: {} }]);
  const reply = (requestRef, at) => wireFrame("received", at, ["join-1", requestRef, "workspace:w", "phx_reply", { status: "ok", response: { received: true, action_status: "running" } }]);
  assert.equal(authorActionAck([actionFrame, reply("req-action", iso(1))], actionFrame).response.action_status, "running");
  assert.throws(() => authorActionAck([actionFrame, reply("other", iso(1))], actionFrame), /唯一/);
  assert.throws(() => authorActionAck([actionFrame, reply("req-action", iso(1)), reply("req-action", iso(2))], actionFrame), /唯一/);
});

test("local 修订必须保留 evidence span 外原文前缀与后缀", () => {
  const span = {
    text: "他猛地侧身。他一刀劈下。他反手格挡。",
    sentence_start: 1,
    sentence_end: 3,
  };
  assert.equal(outsideEvidencePreserved(ORIGINAL_BODY, REVISED_BODY, [span]), true);
  assert.equal(outsideEvidencePreserved(ORIGINAL_BODY, REVISED_BODY.replace("他迈步逼近。", "他退后。"), [span]), false);
});

test("完整修订批次通过 runner 入口", async (t) => {
  const dir = writableBatch(t);
  await main(["verify", dir]);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert.equal(summary.all_checks_passed, true);
  assert.equal(summary.slice_id, "b71-authoring-revision");
  assert.ok(summary.checks.revision_exchange_has_exactly_two_calls);
  assert.equal(summary.measured.why.before, iso(9000));
  assert.equal(summary.measured.why.after, iso(11_000));
});

test("child scope 错绑必须失败", async (t) => {
  const dir = writableBatch(t);
  mutateDb(dir, "UPDATE agent_runs SET workspace_id = ? WHERE id = ?", ["workspace-other", CHILD_RUN]);
  await assert.rejects(() => main(["verify", dir]), /agent_runs 精确绑定/);
});

test("缺 provider pair 必须失败", async (t) => {
  const dir = writableBatch(t);
  mutateDb(dir, "DELETE FROM provider_runs WHERE id = ?", ["prun-2"]);
  await assert.rejects(() => main(["verify", dir]), /原生断言失败/);
});

test("source 逐 call join 缺 ProviderRun pair 必须失败", async (t) => {
  const dir = writableBatch(t);
  mutateDb(dir, "DELETE FROM provider_runs WHERE id = ?", ["prun-source"]);
  await assert.rejects(() => main(["verify", dir]), /source_native_call_pairs/);
});

test("source consumed budget 与真实逐 call 数不一致必须失败", async (t) => {
  const dir = writableBatch(t);
  mutateDb(dir, "UPDATE agent_runs SET consumed_budget = ? WHERE id = ?", [
    JSON.stringify({ provider_calls: 2 }),
    SOURCE_RUN,
  ]);
  await assert.rejects(() => main(["verify", dir]), /source_native_call_counts_match_consumed/);
});

test("source/child 混淆必须失败", async (t) => {
  const dir = writableBatch(t);
  mutateTransport(dir, (rows) => {
    for (const row of rows) {
      if (row.frame?.[3] === "agent_run_state" && row.frame[4].run_id === CHILD_RUN) {
        row.frame[4].run_id = SOURCE_RUN;
      }
      if (row.frame?.[3] === "turn_result" && row.frame[4].agent_run?.run_id === CHILD_RUN) {
        row.frame[4].agent_run.run_id = SOURCE_RUN;
      }
    }
  });
  await assert.rejects(() => main(["verify", dir]), /agent_run_state|turn_result|revision_source_result/);
});

test("错误或重复 ACK 必须失败", async (t) => {
  const dir = writableBatch(t);
  mutateTransport(dir, (rows) => {
    rows.push(wireFrame("received", iso(6500), ["join-1", "req-action", `workspace:${WORKSPACE}`, "phx_reply", { status: "ok", response: { received: true } }]));
  });
  await assert.rejects(() => main(["verify", dir]), /ACK 必须唯一/);
});

test("没有重试/未闭合 validation 必须失败", async (t) => {
  const dir = writableBatch(t);
  withDb(dir, (db) => {
    const row = db.prepare("SELECT message FROM authoring_session_messages WHERE run_id = ? AND run_sequence = ?").get(CHILD_RUN, 4);
    const message = JSON.parse(row.message);
    message.blocks[0].status = "passed";
    db.prepare("UPDATE authoring_session_messages SET message = ? WHERE run_id = ? AND run_sequence = ?").run(
      JSON.stringify(message),
      CHILD_RUN,
      4,
    );
  });
  await assert.rejects(() => main(["verify", dir]), /原生断言失败/);
});

test("artifact 字节篡改必须失败", async (t) => {
  const dir = writableBatch(t);
  withDb(dir, (db) => {
    const row = db.prepare("SELECT content FROM interactions WHERE turn_id = ?").get(CHILD_TURN);
    const value = JSON.parse(row.content);
    value.turn_result.adoption_state.pending[0].payload.items[0].body += "篡改";
    db.prepare("UPDATE interactions SET content = ? WHERE turn_id = ?").run(JSON.stringify(value), CHILD_TURN);
  });
  mutateTransport(dir, (rows) => {
    for (const row of rows) {
      if (row.frame?.[3] === "turn_result" && row.frame[4].turn_id === CHILD_TURN) {
        row.frame[4].adoption_state.pending[0].payload.items[0].body += "篡改";
      }
    }
  });
  await assert.rejects(() => main(["verify", dir]), /原生断言失败/);
});

test("自动采纳/自动处置必须失败", async (t) => {
  const dir = writableBatch(t);
  mutateTransport(dir, (rows) => {
    for (const row of rows) {
      if (row.frame?.[3] === "turn_result" && row.frame[4].turn_id === CHILD_TURN) {
        row.frame[4].truthfulness.artifact_adopted = true;
        row.frame[4].adoption_state.resolved = [{ artifact_id: "as-original" }];
      }
    }
  });
  await assert.rejects(() => main(["verify", dir]), /原生断言失败/);
});


test("ACK 未确认或失败状态必须拒绝", async (t) => {
  const dir = writableBatch(t);
  mutateTransport(dir, (rows) => {
    for (const row of rows) {
      if (row.frame?.[3] === "phx_reply" && row.frame[1] === "req-action") {
        row.frame[4].response.received = false;
        row.frame[4].response.action_status = "failed";
      }
    }
  });
  await assert.rejects(() => main(["verify", dir]), /ACK 未确认受理/);
});

test("自动处置 agent_event 必须失败", async (t) => {
  const dir = writableBatch(t);
  mutateTransport(dir, (rows) => {
    rows.push(wireFrame("received", iso(8500), [null, null, `workspace:${WORKSPACE}`, "agent_event", { run_ref: CHILD_RUN, event_type: "artifact_adopted" }]));
  });
  await assert.rejects(() => main(["verify", dir]), /no_auto_decision_events/);
});

test("receipt 结果错绑必须失败", async (t) => {
  const dir = writableBatch(t);
  mutateDb(dir, "UPDATE author_action_receipts SET result = ? WHERE id = ?", [
    JSON.stringify({ run_id: "run-other", receipt_id: RECEIPT, status: "running" }),
    RECEIPT,
  ]);
  await assert.rejects(() => main(["verify", dir]), /receipt_stable_and_persisted/);
});

test("source 旁路假文本必须失败", async (t) => {
  const dir = writableBatch(t);
  mutateTransport(dir, (rows) => {
    for (const row of rows) {
      if (row.direction === "sent" && row.frame?.[3] === "user_message") {
        row.frame[4].text = `${CHAPTER_TITLE}：主角在废弃矿区遭遇巡检傀儡。`;
      }
    }
  });
  await assert.rejects(() => main(["verify", dir]), /revision_source_message/);
});

test("source 缺 generate_micro_plan 时必须失败", async (t) => {
  const dir = writableBatch(t);
  mutateTransport(dir, (rows) => {
    for (const row of rows) {
      if (row.direction === "sent" && row.frame?.[3] === "user_message") {
        delete row.frame[4].generate_micro_plan;
      }
    }
  });
  await assert.rejects(() => main(["verify", dir]), /revision_source_message/);
});

test("跨 topic 的 action_result 必须失败", async (t) => {
  const dir = writableBatch(t);
  mutateTransport(dir, (rows) => {
    for (const row of rows) {
      if (row.frame?.[3] === "action_result") row.frame[2] = "workspace:foreign";
    }
  });
  await assert.rejects(() => main(["verify", dir]), /revision_action_result/);
});

test("动作前的 child turn_result 必须失败", async (t) => {
  const dir = writableBatch(t);
  mutateTransport(dir, (rows) => {
    for (const row of rows) {
      if (row.frame?.[3] === "turn_result" && row.frame[4]?.turn_id === CHILD_TURN) {
        row.at = iso(3500);
      }
    }
  });
  await assert.rejects(() => main(["verify", dir]), /child completed turn_result 必须恰好一条，实测 0/);
});

test("source finding 非 local 时不能冒充局部修订", async (t) => {
  const dir = writableBatch(t);
  mutateTransport(dir, (rows) => {
    for (const row of rows) {
      if (row.frame?.[3] === "turn_result" && row.frame[4].turn_id === SOURCE_TURN) {
        row.frame[4].quality_review.findings[0].revision_scope = "paragraph";
        row.frame[4].quality_review.findings[0].impact_scope = "paragraph";
      }
    }
  });
  await assert.rejects(() => main(["verify", dir]), /不是全部 local/);
});

test("child 混入源 run 权限必须失败", async (t) => {
  const dir = writableBatch(t);
  mutateDb(dir, "UPDATE agent_runs SET authority_scope = ? WHERE id = ?", [
    JSON.stringify({ allowed_tools: ["prose_writing", "chapter_read"] }),
    CHILD_RUN,
  ]);
  await assert.rejects(() => main(["verify", dir]), /child_authority_scope_is_revision_only/);
});

test("child trace/decision 缺失必须失败", async (t) => {
  const dir = writableBatch(t);
  mutateDb(dir, "DELETE FROM decision_traces WHERE trace_id = ?", [TRACE]);
  await assert.rejects(() => main(["verify", dir]), /decision trace 读取/);
});

test("canon 额外写入必须失败", async (t) => {
  const dir = writableBatch(t);
  mutateJson(dir, "b71-final.json", (value) => {
    value.authoring_canon.tables.drafts.row_count = 1;
    value.authoring_canon.tables.drafts.rows_sha256 = "0".repeat(64);
    value.authoring_canon.tables.drafts.canon_sha256 = "0".repeat(64);
  });
  await assert.rejects(() => main(["verify", dir]), /revision_canon_unchanged_except_action_receipt/);
});

test("source finding 只有 impact_scope local 时仍按 local 验证", async (t) => {
  const dir = writableBatch(t);
  mutateTransport(dir, (rows) => {
    for (const row of rows) {
      if (row.frame?.[3] === "turn_result" && row.frame[4].turn_id === SOURCE_TURN) {
        delete row.frame[4].quality_review.findings[0].revision_scope;
      }
    }
  });
  await main(["verify", dir]);
});

test("source finding 缺 quality_finding_id 时必须失败", async (t) => {
  const dir = writableBatch(t);
  mutateTransport(dir, (rows) => {
    for (const row of rows) {
      if (row.frame?.[3] === "turn_result" && row.frame[4].turn_id === SOURCE_TURN) {
        delete row.frame[4].quality_review.findings[0].quality_finding_id;
      }
    }
  });
  await assert.rejects(() => main(["verify", dir]), /quality_finding_id/);
});

test("source finding id 非字符串时不能冒充有效 ref", async (t) => {
  const dir = writableBatch(t);
  mutateTransport(dir, (rows) => {
    for (const row of rows) {
      if (row.frame?.[3] === "turn_result" && row.frame[4].turn_id === SOURCE_TURN) {
        row.frame[4].quality_review.findings[0].quality_finding_id = 123;
      }
    }
  });
  await assert.rejects(() => main(["verify", dir]), /quality_finding_id/);
});

test("source 结果错绑 parent/review/pending/action 时必须失败", async (t) => {
  const mutations = [
    (row) => { row.frame[4].agent_run.parent_turn_ref = "turn-other"; },
    (row) => { row.frame[4].quality_review.review_status = "pending"; },
    (row) => { row.frame[4].adoption_state.pending = []; },
    (row) => { row.frame[4].available_actions = []; },
  ];
  for (const mutate of mutations) {
    const dir = writableBatch(t);
    mutateTransport(dir, (rows) => {
      for (const row of rows) {
        if (row.frame?.[3] === "turn_result" && row.frame[4].turn_id === SOURCE_TURN) mutate(row);
      }
    });
    await assert.rejects(() => main(["verify", dir]), /revision_source_result/);
  }
});

test("source 缺 agent_run 身份时以来源错误关闭而非崩溃", async (t) => {
  const dir = writableBatch(t);
  mutateTransport(dir, (rows) => {
    for (const row of rows) {
      if (row.frame?.[3] === "turn_result" && row.frame[4].turn_id === SOURCE_TURN) {
        delete row.frame[4].agent_run;
      }
    }
  });
  await assert.rejects(() => main(["verify", dir]), /revision_source_result/);
});

test("source 缺 quality_review 时以来源错误关闭而非崩溃", async (t) => {
  const dir = writableBatch(t);
  mutateTransport(dir, (rows) => {
    for (const row of rows) {
      if (row.frame?.[3] === "turn_result" && row.frame[4].turn_id === SOURCE_TURN) {
        delete row.frame[4].quality_review;
      }
    }
  });
  await assert.rejects(() => main(["verify", dir]), /revision_source_result/);
});

test("生产计数快照缺失时必须失败", async (t) => {
  const dir = writableBatch(t);
  mutateJson(dir, "b71-final.json", (value) => {
    delete value.db_production_counts;
  });
  await assert.rejects(
    () => main(["verify", dir]),
    /production_counts_change_only_action_receipt/,
  );
});

test("action ACK 缺 receipt_id 时必须失败", async (t) => {
  const dir = writableBatch(t);
  mutateTransport(dir, (rows) => {
    for (const row of rows) {
      if (row.frame?.[3] === "phx_reply" && row.frame[1] === "req-action") {
        delete row.frame[4].response.receipt_id;
      }
    }
  });
  await assert.rejects(() => main(["verify", dir]), /缺 run\/receipt/);
});

test("source 计数快照缺任一侧时按 production_counts_unchanged 检查失败而不是崩溃", async (t) => {
  for (const name of ["b71-start.json", "b71-before-revision.json"]) {
    const dir = writableBatch(t);
    mutateJson(dir, name, (value) => {
      delete value.db_production_counts;
    });
    await assert.rejects(
      () => main(["verify", dir]),
      /production_counts_unchanged_through_source/,
      name,
    );
  }
});

test("source target_chapter_ref 缺失/非字符串/无前缀/空 id 都按来源错误关闭", async (t) => {
  for (const ref of [undefined, 42, "chapter", "chapter:"]) {
    const dir = writableBatch(t);
    mutateTransport(dir, (rows) => {
      for (const row of rows) {
        if (row.frame?.[3] === "turn_result" && row.frame[4].turn_id === SOURCE_TURN) {
          const artifact = row.frame[4].adoption_state.pending[0];
          if (ref === undefined) delete artifact.target_chapter_ref;
          else artifact.target_chapter_ref = ref;
        }
      }
    });
    await assert.rejects(
      () => main(["verify", dir]),
      /target_chapter_ref/,
      String(ref),
    );
  }
});

test("config 缺省章标题时回退真实默认章", async (t) => {
  const dir = writableBatch(t);
  mutateJson(dir, "native-b71-config.json", (value) => {
    value.chapter_title = "";
  });
  await main(["verify", dir]);
});
