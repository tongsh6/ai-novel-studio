// B27 §9 CP3 证据核验器正反例：memory 供给/观察回流/M2 描述性“已采纳”/生命周期。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts/native_b27_request_source_evidence.mjs");

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b27-evidence-"));
  fs.mkdirSync(path.join(dir, "llm-calls"));
  fs.mkdirSync(path.join(dir, "app-log"));
  fs.mkdirSync(path.join(dir, "database"));
  const driverLog = {
    provider: "strata",
    model: "iq3_s",
    scenarios: [
      {
        id: "M1",
        turn_status: "conversational",
        assistant_text: "林瑶失踪指向灵源矿区。",
        questions: 0,
        judgment_events: [{ action: "explore" }, { action: "reply" }],
        why_text: "参考来源 已确认设定 林瑶失踪指向灵源矿区。已从持久 trace 生成结构化回放。",
      },
      {
        id: "M2",
        turn_status: "conversational",
        assistant_text: "当前已采纳正文 1/1 场，已采纳版本存在；写到第 1 章。",
        questions: 0,
        judgment_events: [{ action: "reply" }],
        why_text: "参考来源 当前作品背景 trace",
      },
    ],
    model_lifecycle_before: { loaded_before: null },
    model_lifecycle_after: { loaded_after: null, unloaded: true },
  };
  fs.writeFileSync(path.join(dir, "b27-request-source-native-driver-log.json"), JSON.stringify(driverLog));
  fs.writeFileSync(
    path.join(dir, "model-lifecycle-before.json"),
    JSON.stringify({ loaded_before: null }),
  );
  fs.writeFileSync(
    path.join(dir, "model-lifecycle-after.json"),
    JSON.stringify({ loaded_after: null, unloaded: true, unload_error: null }),
  );
  const calls = [
    { request: { body: { messages: [{ role: "user", content: "我之前确认过的设定里，林瑶失踪和哪里有关？请先查记忆。" }] } } },
    { request: { body: { messages: [{ role: "user", content: "我先查一下。观察：林瑶失踪指向灵源矿区。" }] } }, response: { body: { choices: [{ message: { content: "已查得灵源矿区" } }] } } },
    { request: { body: { messages: [{ role: "user", content: "上一轮回答：林瑶失踪指向灵源矿区。现在写到第几章了？" }] } } },
  ];
  fs.writeFileSync(
    path.join(dir, "llm-calls/2026-10-30.jsonl"),
    calls.map((call, index) => `[2026-10-30T00:00:0${index}Z] ${JSON.stringify(call)}`).join("\n"),
  );
  fs.writeFileSync(
    path.join(dir, "app-log/2026-10-30.jsonl"),
    `${JSON.stringify({ msg: "judgment.decided explore memory_recall" })}\n`,
  );
  const dbPath = path.join(dir, "database/ai_novel_studio_test.sqlite3");
  const sqliteScript = [
    "import sqlite3, sys",
    "db = sqlite3.connect(sys.argv[1])",
    "db.execute('CREATE TABLE chapters (id TEXT)')",
    "db.execute('CREATE TABLE drafts (id TEXT)')",
    "db.execute('CREATE TABLE memory_items (id TEXT)')",
    "db.execute('CREATE TABLE author_action_receipts (id TEXT)')",
    "db.execute(\"INSERT INTO chapters VALUES ('c')\")",
    "db.execute(\"INSERT INTO drafts VALUES ('d')\")",
    "db.execute(\"INSERT INTO memory_items VALUES ('m')\")",
    "db.commit()",
    "db.close()",
  ].join("\n");
  execFileSync("python3", ["-c", sqliteScript, dbPath]);
  return dir;
}

test("机制证据齐全 + 描述性“已采纳”不被误判 → pass", () => {
  const dir = makeFixture();
  const output = execFileSync("node", [SCRIPT, "verify", dir], { encoding: "utf8" });
  assert.match(output, /status=pass/u);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert.equal(summary.status, "pass");
  assert.deepEqual(summary.m1_request_indexes, [0]);
  assert.ok(summary.m1_recall_request_indexes.includes(1));
});

test("生命周期未卸载 → fail 退出码非 0", () => {
  const dir = makeFixture();
  fs.writeFileSync(
    path.join(dir, "model-lifecycle-after.json"),
    JSON.stringify({ loaded_after: "iq3_s", unloaded: false, unload_error: null }),
  );
  assert.throws(
    () => execFileSync("node", [SCRIPT, "verify", dir], { encoding: "utf8", stdio: "pipe" }),
    /Command failed/u,
  );
});
