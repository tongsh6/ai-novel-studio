// B27 §9 CP3 证据核验器测试族纯事实 owner：只提供内存字节/行，不创建目录、DB
// 或子进程。真实文件与 4 表 SQLite 模板在 `native_b27_request_source_io_fixture.mjs`；
// 正反例共享本文件的同一组事实，避免各自复制期望。
export const DB_REL = "database/ai_novel_studio_test.sqlite3";

// 零 canon 写判据读取的 4 表；只保留既有 SUT 实际 COUNT 的列。
export const DB_SCHEMA_SQL = [
  "CREATE TABLE chapters (id TEXT)",
  "CREATE TABLE drafts (id TEXT)",
  "CREATE TABLE memory_items (id TEXT)",
  "CREATE TABLE author_action_receipts (id TEXT)",
].join(";\n");

// 既有合成批次：1 章 / 1 draft / 1 memory / 0 采纳回执。
export const DB_SEED = Object.freeze({
  chapters: ["c"],
  drafts: ["d"],
  memory_items: ["m"],
  author_action_receipts: [],
});

const MEMORY_TEXT = "林瑶失踪指向灵源矿区。";

export function driverLog() {
  return {
    provider: "strata",
    model: "iq3_s",
    scenarios: [
      {
        id: "M1",
        turn_status: "conversational",
        assistant_text: MEMORY_TEXT,
        questions: 0,
        judgment_events: [{ action: "explore" }, { action: "reply" }],
        why_text: `参考来源 已确认设定 ${MEMORY_TEXT}已从持久 trace 生成结构化回放。`,
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
}

export function lifecycleBefore() {
  return { loaded_before: null };
}

export function lifecycleAfter() {
  return { loaded_after: null, unloaded: true, unload_error: null };
}

// 反例：模型未卸载；只替换生命周期单一事实。
export function lifecycleAfterLoaded() {
  return { loaded_after: "iq3_s", unloaded: false, unload_error: null };
}

export function llmCalls() {
  return [
    {
      request: {
        body: {
          messages: [
            { role: "user", content: "我之前确认过的设定里，林瑶失踪和哪里有关？请先查记忆。" },
          ],
        },
      },
    },
    {
      request: {
        body: {
          messages: [{ role: "user", content: "我先查一下。观察：林瑶失踪指向灵源矿区。" }],
        },
      },
      response: { body: { choices: [{ message: { content: "已查得灵源矿区" } }] } },
    },
    {
      request: {
        body: {
          messages: [{ role: "user", content: "上一轮回答：林瑶失踪指向灵源矿区。现在写到第几章了？" }],
        },
      },
    },
  ];
}

export function appLogRecords() {
  return [{ msg: "judgment.decided explore memory_recall" }];
}
