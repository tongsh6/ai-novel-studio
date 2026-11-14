// R01 manifest/CLI 测试的唯一纯合成 fixture owner：只含合成 id/hash/路径/文本，
// 不读取 artifacts、真实作者日志、源 DB 或真实 work uuid。schema/lengths 是本文件
// 的独立常量，不 import 被测 validator，避免循环 oracle。
const SCHEMA = "b87-r01-request-cost-manifest/v1";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_E = "e".repeat(64);
const SHA_F = "f".repeat(64);
const SHA_1 = "1".repeat(64);
const SHA_2 = "2".repeat(64);

export function manifestTarget() {
  return {
    id: "chapter-count",
    question: "询问当前有几章内容",
    review_focus: ["区分结构章位/设计态/已采纳正文"],
  };
}

export function historyManifest() {
  return {
    schema: SCHEMA,
    id: "fixture",
    mode: "history",
    frozen: true,
    source: {
      llm_log: "log/llm.jsonl",
      sha256: SHA_A,
      app_log: "log/app.jsonl",
      app_sha256: SHA_B,
      expected_lines: 1,
    },
    authors: [{ id: "a", line: 1, message_index: 1, sha256: SHA_C }],
    lengths: [3, 10, 20],
    model: {
      provider: "splash",
      model: "local/Q4-PLE4",
      reasoning_effort: "high",
      context_window: 262144,
    },
    seed: { script: "scripts/seed.exs" },
    budget: { turn_timeout_ms: 1000, max_harness_retries: 0 },
    evidence: { root: "artifacts/model-contracts/b87-r01/x" },
  };
}

export function nativeManifest(target = manifestTarget()) {
  return {
    ...historyManifest(),
    mode: "native",
    model: {
      ...historyManifest().model,
      thinking: "enabled",
      max_tokens: 32_000,
      timeout_ms: 300_000,
    },
    runtime: {
      profile: "b87-r01-controlled-splash-high",
      auto_maintenance: { enabled: true, keep_recent_items: 4 },
      sync_summary_maintenance: false,
    },
    authors: [{ ...historyManifest().authors[0], target }],
    seed: {
      script: "scripts/seed.exs",
      work_id: "work-1",
      title: "未命名作品·副本",
      session_title: "R01基线新会话",
    },
    snapshot: {
      source_sha256: SHA_E,
      work_sha256: SHA_F,
      content_sha256: SHA_1,
      business_content_sha256: SHA_2,
      dir: "artifacts/model-contracts/b87-r01/20261113/source-snapshot/20261113-real-v2",
    },
  };
}
