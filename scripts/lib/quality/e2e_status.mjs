// B41 CP3：E2E-01 聚合器的证据判定纯函数。
//
// 职责边界：
// - 只做判定：把 registry 状态、CP4 verdict / legacy summary 内容、freshness、
//   命令结果组合成场景状态与聚合 verdict；
// - 不读文件、不起进程、不写产物：I/O 由 scripts/e2e_01_full_chain_check.sh 的
//   shell runner 完成（它调用 registry/verdict CLI 后把原始数据传进来）；
// - 状态一律由真实证据计算，调用方不得传入写死的「已验收/已测试」。
//
// 场景状态词表（内部）：pass | fail | blocked | stale | evidence_missing | not_run
// 聚合 verdict 词表（聚合专有 quality-aggregate/v1，不冒充 CP4
// quality-verdict/v2）：pass | fail | skipped | not_run | evidence_missing。
// blocked 是 manifest 状态、不是执行结果：批内 blocked 场景记为 skipped（场景行
// 仍保留 blocked 内部状态并列出 blocked_reason），因此聚合 verdict 不含 blocked。
// 退出码（CP0 §6.2 item 8 批量语义）：pass=0、fail=1（优先）、evidence_missing=67、
// 全 blocked/skipped/not_run 且无 pass → 69；只有「整批场景全部 blocked、完全
// 没有执行任何验收」才用 65（单场景入口 quality_accept.sh 直接返回 65）。
// usage/config=64/66 由 runner 自己处理（如 registry/verdict CLI 缺失或查询失败）。
//
// freshness 规则（CP3 要求）：evidence 记录 `git_head` 与当前 HEAD 一致、或显式
// `current`/`freshness: "current"` 标记，才可视为 current；无 git_head 的旧
// summary 证据只能是 stale，绝不能 pass。旧 summary 存在本身永远不是 PASS 依据。

export const SCENARIO_STATUSES = Object.freeze([
  "pass",
  "fail",
  "blocked",
  "stale",
  "evidence_missing",
  "not_run",
]);

export const AGGREGATE_SCHEMA_VERSION = "quality-aggregate/v1";

export const AGGREGATE_STATUSES = Object.freeze([
  "pass",
  "fail",
  "skipped",
  "not_run",
  "evidence_missing",
]);

export const AGGREGATE_EXIT_CODES = Object.freeze({
  pass: 0,
  fail: 1,
  skipped: 69,
  not_run: 69,
  evidence_missing: 67,
});

// 仅「整批场景全部 blocked、没有任何验收执行」使用；单场景入口仍直接返回 65。
export const AGGREGATE_BLOCKED_EXIT_CODE = 65;

const VERDICT_STATUSES = Object.freeze([
  "pass",
  "fail",
  "skipped",
  "not_run",
  "evidence_missing",
]);

// legacy summary 若自带这些状态，不能当通过证据。
const NON_PASS_SUMMARY_STATUSES = Object.freeze([
  "failed",
  "fail",
  "error",
  "blocked",
]);

const LEGACY_STATUS_BY_AGGREGATE = Object.freeze({
  pass: "passed",
  fail: "failed",
  skipped: "skipped",
  not_run: "not_run",
  evidence_missing: "evidence_missing",
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// B40/B41 hotfix：`git rev-parse --short HEAD` 写出的短哈希（≥7 位）是同一 commit 的
// 合法缩写；此前只做字符串全等导致短哈希证据一律 stale。完整 hash 仍优先，短哈希仅在
// 是当前 HEAD 前缀时视为同一 commit（与 git 自身缩写规则一致，不做模糊猜测）。
const MIN_ABBREV_HEAD_LENGTH = 7;

/**
 * 判断证据记录的 commit 标识是否与当前 HEAD 指向同一 commit。
 * @param {string|null} recordHead
 * @param {string|null} head
 * @returns {boolean}
 */
export function commitMatches(recordHead, head) {
  if (!recordHead || !head) return false;
  if (recordHead === head) return true;
  return (
    recordHead.length >= MIN_ABBREV_HEAD_LENGTH &&
    recordHead.length < head.length &&
    head.startsWith(recordHead)
  );
}

/**
 * freshness 判定：只依赖证据记录自身携带的版本标记与当前 HEAD。
 * @returns {{fresh: boolean, reason: string, git_head: string|null, source: string|null}}
 */
export function checkFreshness(record, currentHead) {
  const head = text(currentHead);
  if (!isObject(record)) {
    return { fresh: false, reason: "没有可判定的证据记录", git_head: null, source: null };
  }

  const recordHead = text(record.git_head);
  const currentMarker =
    record.current === true ||
    record.freshness === "current" ||
    record.freshness === true ||
    (isObject(record.freshness) && record.freshness.status === "current");

  if (currentMarker) {
    if (recordHead && head && !commitMatches(recordHead, head)) {
      return {
        fresh: false,
        reason: `证据 current 标记与 git_head 矛盾（${recordHead} != 当前 HEAD ${head}）`,
        git_head: recordHead,
        source: "current_marker",
      };
    }
    return {
      fresh: true,
      reason: recordHead
        ? "证据显式 current 标记，git_head 与当前 HEAD 一致"
        : "证据显式 current 标记",
      git_head: recordHead || head || null,
      source: "current_marker",
    };
  }

  if (!recordHead) {
    return {
      fresh: false,
      reason: "证据没有 git_head/current 标记，无法证明对应当前 HEAD（旧证据按 stale 处理）",
      git_head: null,
      source: null,
    };
  }
  if (!head) {
    return {
      fresh: false,
      reason: "当前 git HEAD 不可用，freshness 无法确认（按 stale 处理）",
      git_head: recordHead,
      source: "git_head",
    };
  }
  if (!commitMatches(recordHead, head)) {
    return {
      fresh: false,
      reason: `证据 git_head ${recordHead} 与当前 HEAD ${head} 不一致（历史证据）`,
      git_head: recordHead,
      source: "git_head",
    };
  }
  return {
    fresh: true,
    reason:
      recordHead === head
        ? "证据 git_head 与当前 HEAD 一致"
        : `证据 git_head ${recordHead} 是当前 HEAD 的短哈希（同一 commit）`,
    git_head: recordHead,
    source: "git_head",
  };
}

/** 兼容旧 summary 的断言位置（behavior.assertions / assertions）。 */
export function collectAssertions(record) {
  const assertions = record?.behavior?.assertions ?? record?.assertions ?? [];
  return Array.isArray(assertions) ? assertions : [];
}

function evidenceError(code, message) {
  return { code, message };
}

/**
 * 内容/来源校验：provider、surface、slice/scenario id、断言、lmstudio 调用数。
 * verdict 与 legacy summary 共用，但 verdict 额外要求 driver 字段。
 * 断言类差异与来源类差异分开返回，供 freshness 判定决定是否 fail。
 */
export function checkArtifactContent(record, expectations = {}, { source = "summary" } = {}) {
  const errors = [];
  const observed = {
    slice_id: text(record?.slice_id) || text(record?.scenario_id) || null,
    provider: text(record?.provider) || null,
    surface: text(record?.surface) || null,
    driver: text(record?.driver) || null,
    assertions: collectAssertions(record),
  };

  const expectedIds = (expectations.slice_ids ?? []).map(text).filter(Boolean);
  if (expectedIds.length > 0 && !expectedIds.includes(observed.slice_id)) {
    errors.push(
      evidenceError(
        "slice_mismatch",
        `expected slice_id ${expectedIds.join("|")}, got ${observed.slice_id}`,
      ),
    );
  }
  if (expectations.provider && observed.provider !== expectations.provider) {
    errors.push(
      evidenceError(
        "provider_mismatch",
        `expected provider ${expectations.provider}, got ${observed.provider}`,
      ),
    );
  }
  if (expectations.surface && observed.surface !== expectations.surface) {
    errors.push(
      evidenceError(
        "surface_mismatch",
        `expected surface ${expectations.surface}, got ${observed.surface}`,
      ),
    );
  }
  if (source === "verdict" && expectations.require_driver !== false && !observed.driver) {
    errors.push(evidenceError("driver_missing", "verdict 缺 driver 字段，来源链不完整"));
  }
  // verdict 已在自身机制/模型行为字段里声明证据；legacy summary 才按 manifest
  // 断言清单逐项核对（旧 summary 的断言是历史验收事实，仍可用于内容校验）。
  if (source === "summary") {
    for (const assertion of expectations.assertions ?? []) {
      if (!observed.assertions.includes(assertion)) {
        errors.push(evidenceError("assertion_missing", `missing assertion ${assertion}`));
      }
    }
  }
  if (source === "summary" && expectations.provider === "lmstudio") {
    const requestCount = Number(record?.lmstudio?.request_count ?? 0);
    observed.lmstudio_request_count = requestCount;
    if (!(requestCount >= 1)) {
      errors.push(
        evidenceError(
          "lmstudio_request_missing",
          `expected lmstudio.request_count >= 1, got ${record?.lmstudio?.request_count ?? null}`,
        ),
      );
    }
  }
  if (source === "summary" && NON_PASS_SUMMARY_STATUSES.includes(text(record?.status))) {
    errors.push(
      evidenceError(
        "summary_status_not_pass",
        `summary 自带状态 ${record.status}，不能作为通过证据`,
      ),
    );
  }

  const sourceCodes = new Set([
    "slice_mismatch",
    "provider_mismatch",
    "surface_mismatch",
    "driver_missing",
    "summary_status_not_pass",
  ]);
  return {
    ok: errors.length === 0,
    errors,
    observed,
    sourceErrors: errors.filter((error) => sourceCodes.has(error.code)),
    contentErrors: errors.filter((error) => !sourceCodes.has(error.code)),
  };
}

/**
 * registry 查询结果判定。entry 形状由 CP1 manifest_cli 固定：
 * {id, status: "active"|"blocked"|"draft"|null, blocked_reason, tier, surface}
 */
export function classifyRegistryEntry(entry, { scenarioId = "" } = {}) {
  const label = scenarioId || text(entry?.id) || "<unknown>";
  if (entry === null || entry === undefined) {
    return {
      status: "fail",
      reason: `registry 没有返回 ${label} 的查询结果`,
      blocked_reason: null,
      entry: null,
    };
  }
  if (!isObject(entry)) {
    return {
      status: "fail",
      reason: `registry 返回 ${label} 的结果不是对象`,
      blocked_reason: null,
      entry,
    };
  }

  const status = entry.status ?? null;
  if (status === "active") {
    return { status: "active", reason: `${label} registry=active`, blocked_reason: null, entry };
  }
  if (status === "blocked") {
    const blockedReason = text(entry.blocked_reason) || "registry 标记 blocked 但未提供 blocked_reason";
    return {
      status: "blocked",
      reason: `${label} registry=blocked：${blockedReason}`,
      blocked_reason: blockedReason,
      entry,
    };
  }
  if (status === "draft") {
    return {
      status: "fail",
      reason: `${label} 是 draft 注册项，不能作为验收证据`,
      blocked_reason: null,
      entry,
    };
  }
  if (status === null) {
    return {
      status: "fail",
      reason: `${label} 未在 manifest registry 注册（status=null）`,
      blocked_reason: null,
      entry,
    };
  }
  return {
    status: "fail",
    reason: `${label} 的 registry 状态 ${String(status)} 不在 active|blocked|draft|null 词表内`,
    blocked_reason: null,
    entry,
  };
}

/**
 * 单条 artifact 证据判定。输入全部由 runner 抽取好（不在此处做 I/O）。
 *
 * @param {object} input
 * @param {string} input.rel_path             展示/证据用相对路径
 * @param {boolean} input.found               summary.json 或 verdict.json 是否存在
 * @param {object|null} input.summary         解析后的 legacy summary
 * @param {string|null} input.summary_read_error
 * @param {object|null} input.verdict         verdict_cli read 的 JSON（可为 legacy fallback）
 * @param {string|null} input.verdict_read_error
 * @param {boolean} input.legacy_summary      verdict_cli 判定为「无 verdict，legacy summary」
 * @param {object} input.expectations         {slice_ids, provider, surface, assertions}
 * @param {string|null} input.current_head
 */
export function classifyArtifact(input) {
  const {
    rel_path = "",
    found = false,
    summary = null,
    summary_read_error = null,
    verdict = null,
    verdict_read_error = null,
    legacy_summary = false,
    expectations = {},
    current_head = null,
  } = input ?? {};

  const base = {
    rel_path,
    found: Boolean(found),
    evidence_source: null,
    status: "evidence_missing",
    reason: "",
    reason_codes: [],
    freshness: null,
    observed: null,
    errors: [],
  };

  if (!found) {
    return {
      ...base,
      status: "evidence_missing",
      reason: "证据 artifact 不存在",
      reason_codes: ["artifact_missing"],
    };
  }

  const useVerdict = verdict !== null && verdict !== undefined && !legacy_summary;
  if (useVerdict) {
    if (verdict_read_error) {
      return {
        ...base,
        evidence_source: "verdict",
        status: "fail",
        reason: `verdict 读取失败：${verdict_read_error}`,
        reason_codes: ["verdict_read_error"],
      };
    }
    // CP4 读取接口对「缺 verdict / 缺 status / 结构无效」统一给 evidence_missing；
    // 聚合器同样把无效 verdict 当缺失证据，不能降级成 fail 或 pass。
    if (verdict.status === "evidence_missing") {
      return {
        ...base,
        evidence_source: "verdict",
        status: "evidence_missing",
        reason: `verdict 状态 evidence_missing${text(verdict.reason) ? `：${text(verdict.reason)}` : ""}`,
        reason_codes: ["verdict_evidence_missing"],
        observed: { status: verdict.status },
      };
    }
    const invalid = verdictIsInvalid(verdict);
    if (invalid) {
      return {
        ...base,
        evidence_source: "verdict",
        status: "evidence_missing",
        reason: `verdict 无效，按 evidence_missing 处理：${invalid}`,
        reason_codes: ["verdict_invalid"],
        observed: { status: verdict?.status ?? null },
      };
    }
    // 场景 verdict 由 CP2 入口写并填 driver/provider；缺任一视为来源链无效
    // （CP4 R2 裁决）→ evidence_missing，不能作为通过/失败证据。
    const missingIdentity = [
      text(verdict.driver) ? null : "driver",
      text(verdict.provider) ? null : "provider",
    ].filter(Boolean);
    if (missingIdentity.length > 0) {
      return {
        ...base,
        evidence_source: "verdict",
        status: "evidence_missing",
        reason: `verdict 缺 ${missingIdentity.join("/")}，来源链无效按 evidence_missing 处理`,
        reason_codes: ["verdict_source_incomplete"],
        observed: { status: verdict?.status ?? null },
      };
    }

    const content = checkArtifactContent(verdict, expectations, { source: "verdict" });
    const freshness = checkFreshness(verdict, current_head);
    const result = {
      ...base,
      evidence_source: "verdict",
      observed: content.observed,
      freshness,
    };

    if (verdict.status === "pass") {
      if (content.sourceErrors.length > 0 || content.contentErrors.length > 0) {
        return {
          ...result,
          status: "fail",
          reason: failuresReason("verdict 内容/来源校验失败", content.errors),
          reason_codes: content.errors.map((error) => error.code),
          errors: content.errors,
        };
      }
      if (!freshness.fresh) {
        return {
          ...result,
          status: "stale",
          reason: `verdict 判 pass 但不是当前证据：${freshness.reason}`,
          reason_codes: ["stale_evidence"],
        };
      }
      return {
        ...result,
        status: "pass",
        reason: "verdict pass 且 freshness=current",
        reason_codes: [],
      };
    }
    if (verdict.status === "fail") {
      return {
        ...result,
        status: "fail",
        reason: `verdict 状态 fail${text(verdict.reason) ? `：${text(verdict.reason)}` : ""}`,
        reason_codes: ["verdict_fail"],
        errors: content.errors,
      };
    }
    if (verdict.status === "skipped" || verdict.status === "not_run") {
      return {
        ...result,
        status: "not_run",
        reason: `verdict 状态 ${verdict.status}${text(verdict.reason) ? `：${text(verdict.reason)}` : ""}`,
        reason_codes: [`verdict_${verdict.status}`],
      };
    }
    return {
      ...result,
      status: "evidence_missing",
      reason: "verdict 状态 evidence_missing（缺真实证据）",
      reason_codes: ["verdict_evidence_missing"],
    };
  }

  // 无 verdict：只能按 legacy summary 评估，且必须有 git_head/current 标记才可能 pass。
  if (summary_read_error) {
    return {
      ...base,
      evidence_source: "legacy_summary",
      status: "fail",
      reason: `legacy summary 解析失败：${summary_read_error}`,
      reason_codes: ["summary_read_error"],
    };
  }
  if (!isObject(summary)) {
    return {
      ...base,
      evidence_source: "legacy_summary",
      status: "evidence_missing",
      reason: "既无 verdict 也无 legacy summary",
      reason_codes: ["artifact_missing"],
    };
  }

  const content = checkArtifactContent(summary, expectations, { source: "summary" });
  const freshness = checkFreshness(summary, current_head);
  const result = {
    ...base,
    evidence_source: "legacy_summary",
    observed: content.observed,
    freshness,
  };

  if (content.sourceErrors.length > 0) {
    return {
      ...result,
      status: "fail",
      reason: failuresReason("legacy summary 来源校验失败", content.sourceErrors),
      reason_codes: content.sourceErrors.map((error) => error.code),
      errors: content.errors,
    };
  }
  if (!freshness.fresh) {
    return {
      ...result,
      status: "stale",
      reason: `legacy summary 不是当前 HEAD 证据（存在不等于 PASS）：${freshness.reason}`,
      reason_codes: ["stale_evidence", ...content.contentErrors.map((error) => error.code)],
      errors: content.contentErrors,
    };
  }
  if (content.contentErrors.length > 0) {
    return {
      ...result,
      status: "fail",
      reason: failuresReason("legacy summary 内容校验失败", content.contentErrors),
      reason_codes: content.contentErrors.map((error) => error.code),
      errors: content.contentErrors,
    };
  }
  return {
    ...result,
    status: "pass",
    reason: "legacy summary 内容齐全且携带当前 HEAD 的 freshness 证据",
    reason_codes: [],
  };
}

function verdictIsInvalid(verdict) {
  if (!isObject(verdict)) return "verdict 不是对象";
  const version = text(verdict.schema_version);
  if (version && version !== "quality-verdict/v2") {
    return `verdict schema_version ${version} 不是 quality-verdict/v2`;
  }
  if (!VERDICT_STATUSES.includes(verdict.status)) {
    return `verdict.status ${String(verdict.status)} 不在 pass|fail|skipped|not_run|evidence_missing 词表内`;
  }
  if (text(verdict.scenario_id) === "" && text(verdict.slice_id) === "") {
    return "verdict 缺 scenario_id/slice_id，无法做来源匹配";
  }
  return null;
}

function failuresReason(prefix, errors) {
  return `${prefix}：${errors.map((error) => error.message).join("; ")}`;
}

/** 命令执行结果判定：tcsv 已执行 → pass/fail；显式 skip → skipped；否则 not_run。 */
export function classifyCommand({ name = "<unknown>", exit_code = null, log = null, skipped_reason = null } = {}) {
  if (skipped_reason) {
    return {
      name,
      log,
      status: "skipped",
      reason: `命令未执行：${skipped_reason}`,
    };
  }
  if (exit_code === null || exit_code === undefined || exit_code === "") {
    return { name, log, status: "not_run", reason: "本聚合没有该命令的执行记录" };
  }
  const code = Number(exit_code);
  if (!Number.isFinite(code)) {
    return { name, log, status: "not_run", reason: "本聚合没有该命令的执行记录" };
  }
  if (code === 0) {
    return { name, log, status: "pass", reason: "命令 exit 0", exit_code: code };
  }
  return { name, log, status: "fail", reason: `命令 exit ${code}`, exit_code: code };
}

function combineArtifactStatuses(statuses) {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("stale")) return "stale";
  if (statuses.includes("evidence_missing")) return "evidence_missing";
  if (statuses.includes("not_run")) return "not_run";
  if (statuses.length > 0 && statuses.every((status) => status === "pass")) return "pass";
  return "evidence_missing";
}

function scenarioMechanism(commandChecks) {
  const failed = commandChecks.filter((check) => check.status === "fail");
  if (failed.length > 0) {
    return { status: "fail", evidence_refs: failed.map((check) => check.log ?? check.name) };
  }
  if (commandChecks.length === 0) {
    return { status: "not_applicable", evidence_refs: [] };
  }
  if (commandChecks.some((check) => check.status !== "pass")) {
    return {
      status: "unknown",
      evidence_refs: commandChecks.filter((check) => check.status === "pass").map((check) => check.log ?? check.name),
    };
  }
  return { status: "pass", evidence_refs: commandChecks.map((check) => check.log ?? check.name) };
}

/**
 * 场景判定：registry（blocked 真相）> 命令/artifact fail > stale > evidence_missing > pass。
 * blocked 场景不做「已验收」计算：registry 说 blocked，就只能是 blocked + reason。
 */
export function evaluateScenario(input = {}) {
  const {
    id = "",
    name = "",
    registry_entries = [],
    artifacts = [],
    commands = [],
    current_head = null,
    expected_surface = null,
  } = input;

  const artifactChecks = artifacts.map((artifact) => ({
    ...classifyArtifact({ ...artifact, current_head }),
    expectations: artifact.expectations ?? {},
    scenario_ids: [id],
  }));
  const commandChecks = commands.map(classifyCommand);
  const evidence = [
    ...artifactChecks.map((check) => check.rel_path),
    ...commandChecks.map((check) => check.name),
  ];

  const registryChecks = registry_entries.map((entry) => classifyRegistryEntry(entry.entry, {
    scenarioId: entry.scenario_id,
  }));
  const blockedEntry = registryChecks.find((check) => check.status === "blocked");
  const registryFailure = registryChecks.find((check) => check.status === "fail");
  const sourceFailure = registryChecks.find(
    (check) =>
      expected_surface &&
      check.entry &&
      text(check.entry.surface) &&
      text(check.entry.surface) !== expected_surface,
  );

  const result = {
    id,
    name,
    status: "evidence_missing",
    reason: "",
    reason_codes: [],
    blocked_reason: blockedEntry?.blocked_reason ?? null,
    evidence,
    artifact_checks: artifactChecks,
    command_checks: commandChecks,
    registry_checks: registryChecks,
    mechanism: scenarioMechanism(commandChecks),
  };

  if (blockedEntry) {
    return {
      ...result,
      status: "blocked",
      reason: blockedEntry.reason,
      reason_codes: ["registry_blocked"],
    };
  }
  if (sourceFailure) {
    return {
      ...result,
      status: "fail",
      reason: `registry surface=${text(sourceFailure.entry.surface)} 与期望证据 surface=${expected_surface} 不匹配`,
      reason_codes: ["registry_surface_mismatch"],
    };
  }
  if (registryFailure) {
    return {
      ...result,
      status: "fail",
      reason: registryFailure.reason,
      reason_codes: ["registry_source_mismatch"],
    };
  }

  const commandFailure = commandChecks.find((check) => check.status === "fail");
  if (commandFailure) {
    return {
      ...result,
      status: "fail",
      reason: commandFailure.reason,
      reason_codes: ["command_failed"],
    };
  }

  if (artifactChecks.length === 0) {
    const commandMechanism = result.mechanism.status;
    return {
      ...result,
      status: commandMechanism === "fail" ? "fail" : "evidence_missing",
      reason:
        "没有该场景的独立真实页面 artifact（局部机制证据不等于验收证据）；按 evidence_missing 处理",
      reason_codes: ["no_acceptance_artifact"],
    };
  }

  const artifactStatus = combineArtifactStatuses(artifactChecks.map((check) => check.status));
  const failedArtifact = artifactChecks.find((check) => check.status === "fail");
  const staleArtifact = artifactChecks.find((check) => check.status === "stale");
  const missingArtifact = artifactChecks.find((check) => check.status === "evidence_missing");

  if (artifactStatus === "fail" && failedArtifact) {
    return {
      ...result,
      status: "fail",
      reason: failedArtifact.reason,
      reason_codes: failedArtifact.reason_codes,
    };
  }
  if (artifactStatus === "stale" && staleArtifact) {
    return {
      ...result,
      status: "stale",
      reason: staleArtifact.reason,
      reason_codes: staleArtifact.reason_codes,
    };
  }
  if (artifactStatus === "evidence_missing" && missingArtifact) {
    return {
      ...result,
      status: "evidence_missing",
      reason: missingArtifact.reason,
      reason_codes: missingArtifact.reason_codes,
    };
  }
  if (artifactStatus === "not_run") {
    return {
      ...result,
      status: "not_run",
      reason: "artifact 证据对应 verdict 状态为 skipped/not_run",
      reason_codes: ["verdict_not_run"],
    };
  }
  return {
    ...result,
    status: "pass",
    reason: "全部 artifact 证据来源匹配、内容校验通过且 freshness=current",
    reason_codes: [],
  };
}

/**
 * 聚合 verdict 判定（CP0 §6.2 item 8 批量语义）：
 * fail（命令/场景内容）优先 → evidence_missing（stale/缺证）→ 有 pass 且无
 * 上述问题即 pass（批内 blocked/skipped 只记 skipped，不拉低为 fail）→
 * 无 pass 时按 blocked/skipped/not_run 记 skipped/not_run。
 */
export function aggregateStatus({ scenarios = [], commands = [] } = {}) {
  const failedCommands = commands.filter((command) => Number(command.exit_code) !== 0);
  const failedScenarios = scenarios.filter((scenario) => scenario.status === "fail");
  const blockedScenarios = scenarios.filter((scenario) => scenario.status === "blocked");
  const notRunScenarios = scenarios.filter((scenario) => scenario.status === "not_run");
  const unresolvedScenarios = scenarios.filter((scenario) =>
    ["stale", "evidence_missing"].includes(scenario.status),
  );
  const executedScenarios = scenarios.filter((scenario) =>
    ["pass", "fail", "stale", "evidence_missing"].includes(scenario.status),
  );
  const passScenarios = scenarios.filter((scenario) => scenario.status === "pass");

  if (failedCommands.length > 0) {
    return {
      status: "fail",
      reason: `聚合命令失败：${failedCommands.map((command) => command.name).join(", ")}`,
      reason_codes: ["command_failed"],
    };
  }
  if (failedScenarios.length > 0) {
    return {
      status: "fail",
      reason: `场景 fail：${failedScenarios.map((scenario) => scenario.id).join(", ")}`,
      reason_codes: ["scenario_failed"],
    };
  }
  if (unresolvedScenarios.length > 0) {
    return {
      status: "evidence_missing",
      reason: `当前 HEAD 缺少可判定证据：${unresolvedScenarios
        .map((scenario) => `${scenario.id}=${scenario.status}`)
        .join(", ")}`,
      reason_codes: ["current_evidence_missing"],
    };
  }
  if (scenarios.length === 0) {
    return {
      status: "not_run",
      reason: "没有任何可判定场景执行",
      reason_codes: ["no_scenarios"],
    };
  }
  if (passScenarios.length > 0 && unresolvedScenarios.length === 0) {
    const skipped = blockedScenarios.length + notRunScenarios.length;
    return {
      status: "pass",
      reason:
        skipped > 0
          ? `批内 ${passScenarios.length} 个场景 pass，${skipped} 个 skipped（blocked/not_run 明细见 blocked_scenarios/not_run_scenarios）`
          : `全部 ${scenarios.length} 个场景证据来源匹配、内容校验通过且 freshness=current`,
      reason_codes: ["batch_pass"],
      skipped_scenarios: [
        ...blockedScenarios.map((scenario) => scenario.id),
        ...notRunScenarios.map((scenario) => scenario.id),
      ],
    };
  }
  if (executedScenarios.length === 0) {
    const allBlocked = blockedScenarios.length === scenarios.length;
    if (allBlocked) {
      return {
        status: "skipped",
        reason: `整批 ${scenarios.length} 个场景均为 registry blocked，没有任何验收执行（重锚/退役前不得写已验收）`,
        reason_codes: ["blocked_batch"],
      };
    }
    if (notRunScenarios.length === scenarios.length) {
      return {
        status: "not_run",
        reason: "全部场景均未运行（skipped/not_run），无执行结果",
        reason_codes: ["batch_not_run"],
      };
    }
    return {
      status: "skipped",
      reason: `没有场景 pass：${scenarios
        .map((scenario) => `${scenario.id}=${scenario.status}`)
        .join(", ")}`,
      reason_codes: ["batch_skipped"],
    };
  }
  // 走到这里说明存在已执行场景但没有 pass（例如全部 fail 已在前面处理，只剩混合
  // skipped/not_run 与 blocked），按未通过处理，绝不判 pass。
  return {
    status: "skipped",
    reason: `没有场景 pass：${scenarios
      .map((scenario) => `${scenario.id}=${scenario.status}`)
      .join(", ")}`,
    reason_codes: ["batch_skipped"],
  };
}

export function exitCodeForAggregateStatus(status) {
  if (!(status in AGGREGATE_EXIT_CODES)) {
    throw new Error(`未知聚合状态 ${String(status)}，拒绝映射退出码`);
  }
  return AGGREGATE_EXIT_CODES[status];
}

/**
 * 聚合退出码：一般按状态映射；唯一例外是「整批场景全部 blocked」→ 65
 * （对应单场景 blocked 语义，表示没有任何可执行验收；有 pass 时按批量语义 0）。
 */
export function aggregateExitCode({ status, scenarios = [] } = {}) {
  const allBlocked =
    scenarios.length > 0 && scenarios.every((scenario) => scenario.status === "blocked");
  if (allBlocked && status === "skipped") return AGGREGATE_BLOCKED_EXIT_CODE;
  return exitCodeForAggregateStatus(status);
}

export function scenarioStatusCounts(scenarios = []) {
  const counts = Object.fromEntries(SCENARIO_STATUSES.map((status) => [status, 0]));
  for (const scenario of scenarios) {
    if (scenario.status in counts) counts[scenario.status] += 1;
  }
  return counts;
}

function legacySummaryStatus(aggregateVerdictStatus) {
  return LEGACY_STATUS_BY_AGGREGATE[aggregateVerdictStatus] ?? aggregateVerdictStatus;
}

function artifactLinkRole(check) {
  if (check.status === "pass") return "required";
  if (check.status === "stale") return "scoped";
  if (check.status === "fail") return "failure";
  return "required";
}

function collectMechanism({ scenarios, commands, skipped_commands }) {
  const failedCommands = commands.filter((command) => Number(command.exit_code) !== 0);
  const failedArtifacts = scenarios
    .filter((scenario) => scenario.status !== "blocked")
    .flatMap((scenario) => scenario.artifact_checks)
    .filter((check) => check.status === "fail");
  if (failedCommands.length > 0) {
    return {
      status: "fail",
      evidence_refs: failedCommands.map((command) => command.log ?? command.name),
    };
  }
  if (failedArtifacts.length > 0) {
    return {
      status: "fail",
      evidence_refs: failedArtifacts.map((check) => check.rel_path),
    };
  }
  if (skipped_commands.length > 0) {
    return { status: "unknown", evidence_refs: [] };
  }
  if (commands.length === 0) {
    return { status: "unknown", evidence_refs: [] };
  }
  return {
    status: "pass",
    evidence_refs: commands.map((command) => command.log ?? command.name),
  };
}

function collectModelBehavior({ scenarios, provider, commands }) {
  const lmstudioChecks = scenarios
    .filter((scenario) => scenario.status !== "blocked")
    .flatMap((scenario) => scenario.artifact_checks)
    .filter((check) => check.expectations?.provider === "lmstudio");
  if (lmstudioChecks.length === 0) {
    return { status: "not_applicable", evidence_refs: [] };
  }
  const failed = lmstudioChecks.filter((check) => check.status === "fail");
  if (failed.length > 0) {
    return { status: "fail", evidence_refs: failed.map((check) => check.rel_path) };
  }
  const current = lmstudioChecks.filter((check) => check.status === "pass");
  if (current.length > 0) {
    return { status: "pass", evidence_refs: current.map((check) => check.rel_path) };
  }
  if (provider === "slice_verify") {
    // 本轮用确定性替身，未调用真实模型；历史 lmstudio 证据也不是 current。
    return { status: "unknown", evidence_refs: [] };
  }
  const realLlm = commands.find((command) => command.name === "mix-real-lmstudio");
  if (realLlm && Number(realLlm.exit_code) !== 0) {
    return { status: "fail", evidence_refs: [realLlm.log ?? realLlm.name] };
  }
  return { status: "unknown", evidence_refs: [] };
}

export function buildAggregateVerdict({
  scenarios = [],
  commands = [],
  skipped_commands = [],
  provider = "lmstudio",
  git_head = null,
  generated_at = null,
  started_at = null,
  artifact_dir = "",
} = {}) {
  const aggregate = aggregateStatus({ scenarios, commands });
  const artifactChecks = scenarios.flatMap((scenario) => scenario.artifact_checks);
  const blockedScenarios = scenarios.filter((scenario) => scenario.status === "blocked");
  const staleChecks = artifactChecks.filter((check) => check.status === "stale");
  const failedChecks = artifactChecks.filter((check) => check.status === "fail");
  const finalRefs = artifactChecks.filter((check) => check.status === "pass").map((check) => check.rel_path);
  const failureRefs = [
    ...failedChecks.map((check) => check.rel_path),
    ...commands.filter((command) => Number(command.exit_code) !== 0).map((command) => command.log ?? command.name),
  ];
  const scopedRefs = [
    ...staleChecks.map((check) => check.rel_path),
    ...blockedScenarios.flatMap((scenario) => scenario.artifact_checks).map((check) => check.rel_path),
  ];
  const durationMs =
    started_at && generated_at
      ? Math.max(0, new Date(generated_at).getTime() - new Date(started_at).getTime())
      : null;

  return {
    schema_version: AGGREGATE_SCHEMA_VERSION,
    scenario_id: "e2e-01-full-chain",
    tier: "nightly",
    surface: "browser",
    status: aggregate.status,
    reason: aggregate.reason,
    reason_codes: aggregate.reason_codes,
    driver: "scripts/e2e_01_full_chain_check.sh",
    provider,
    model: null,
    actual_model: null,
    attempt: 1,
    timeouts: 0,
    generated_at,
    started_at,
    finished_at: generated_at,
    duration_ms: durationMs,
    git_head,
    artifact_dir,
    artifact_links: artifactChecks.map((check) => ({
      kind: "summary_json",
      path: check.rel_path,
      role: artifactLinkRole(check),
    })),
    evidence_required: artifactChecks.map((check) => check.rel_path),
    evidence_present: artifactChecks.filter((check) => check.found).map((check) => check.rel_path),
    evidence_missing: artifactChecks
      .filter((check) => check.status === "evidence_missing")
      .map((check) => check.rel_path),
    mechanism: collectMechanism({ scenarios, commands, skipped_commands }),
    model_behavior: collectModelBehavior({ scenarios, provider, commands }),
    final_refs: finalRefs,
    failure_refs: failureRefs,
    scoped_refs: scopedRefs,
  };
}

function scenarioRow(scenario) {
  return {
    id: scenario.id,
    name: scenario.name,
    status: scenario.status,
    reason: scenario.reason,
    evidence: scenario.evidence,
    mechanism: scenario.mechanism,
    ...(scenario.blocked_reason ? { blocked_reason: scenario.blocked_reason } : {}),
    ...(scenario.registry_checks.length > 0
      ? {
          registry_status: scenario.registry_checks.map((check) => ({
            scenario_id: check.entry?.id ?? null,
            status: check.entry?.status ?? null,
            tier: check.entry?.tier ?? null,
            surface: check.entry?.surface ?? null,
          })),
        }
      : {}),
  };
}

function buildAssertions({ commands, skipped_commands, provider, scenarios }) {
  const assertions = ["aggregate_runner_executed"];
  if (commands.length > 0) assertions.push("local_e2e_and_replay_tests_executed");
  if (provider === "lmstudio" && commands.some((command) => command.name === "mix-real-lmstudio")) {
    assertions.push("real_lmstudio_tests_executed");
  }
  if (scenarios.some((scenario) => scenario.artifact_checks.length > 0)) {
    assertions.push("required_true_page_tauri_artifacts_checked");
  }
  assertions.push("no_product_acceptance_logic_added");
  return assertions;
}

function buildRemainingGaps(scenarios) {
  const e10 = scenarios.find((scenario) => scenario.id === "E10");
  if (!e10 || e10.status === "pass") return [];
  return [
    {
      scenario_id: "E10",
      status: e10.status,
      gap: "application/persistence trace roundtrip 已闭合；普通旧 turn / developer / 多类型 trace query UI 继续归 AU-07 cross-reference owner。E10 没有独立真实页面 artifact，聚合按 evidence_missing 处理，不冒充已验收。",
      priority: "cross-reference",
    },
  ];
}

/**
 * 汇总 summary（写 artifacts/slice-verify/e2e-01-full-chain/summary.json）。
 * 旧字段保留（scenario_status_counts/e2e_scenarios/commands/artifact_checks/assertions/
 * remaining_gaps/status），但 status/各场景状态均由 verdict 推导，不得与 verdict 矛盾。
 */
export function buildAggregateSummary({
  scenarios = [],
  commands = [],
  skipped_commands = [],
  provider = "lmstudio",
  git_head = null,
  generated_at = null,
  started_at = null,
  artifact_dir = "",
} = {}) {
  const verdict = buildAggregateVerdict({
    scenarios,
    commands,
    skipped_commands,
    provider,
    git_head,
    generated_at,
    started_at,
    artifact_dir,
  });
  const blockedScenarios = scenarios.filter((scenario) => scenario.status === "blocked");
  const staleScenarios = scenarios.filter((scenario) => scenario.status === "stale");
  const missingScenarios = scenarios.filter((scenario) => scenario.status === "evidence_missing");
  const notRunScenarios = scenarios.filter((scenario) => scenario.status === "not_run");

  return {
    scenario_id: "e2e-01-full-chain",
    title: "E2E-01 端到端全链路聚合验收",
    generated_at,
    git_head,
    provider,
    status: legacySummaryStatus(verdict.status),
    exit_code: aggregateExitCode({ status: verdict.status, scenarios }),
    artifact_dir,
    scenario_status_counts: scenarioStatusCounts(scenarios),
    e2e_scenarios: scenarios.map(scenarioRow),
    commands,
    skipped_commands,
    artifact_checks: scenarios.flatMap((scenario) =>
      scenario.artifact_checks.map((check) => ({
        ...check,
        scenario_ids: [scenario.id],
      })),
    ),
    blocked_scenarios: blockedScenarios.map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      blocked_reason: scenario.blocked_reason,
      reason: scenario.reason,
      evidence: scenario.evidence,
      artifact_present: scenario.artifact_checks.some((check) => check.found),
    })),
    stale_scenarios: staleScenarios.map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      reason: scenario.reason,
      evidence: scenario.evidence,
    })),
    evidence_missing_scenarios: missingScenarios.map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      reason: scenario.reason,
      evidence: scenario.evidence,
    })),
    not_run_scenarios: notRunScenarios.map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      reason: scenario.reason,
    })),
    verdict,
    assertions: buildAssertions({ commands, skipped_commands, provider, scenarios }),
    remaining_gaps: buildRemainingGaps(scenarios),
  };
}
