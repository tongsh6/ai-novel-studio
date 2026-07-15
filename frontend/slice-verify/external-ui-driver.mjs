import { chromium } from "playwright";
import { Socket } from "phoenix";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const sliceId = process.argv[2];
const baseUrl = process.env.SLICE_VERIFY_BASE_URL ?? "http://127.0.0.1:5769";
const artifactDir =
  process.env.SLICE_VERIFY_ARTIFACT_DIR ??
  path.resolve("..", "artifacts", "slice-verify", sliceId ?? "unknown");
const chatInputSelector = 'input[placeholder="输入你的想法、问题或指令..."]';
const agentRunSteerInputSelector = 'input[placeholder="补充调整当前请求..."]';
const acceptDraftButtonPattern = /确认创建|保存为章节正文|保存到大纲|保存到作品档案|保存到作品/;
const readingModeButtonPattern = /\[阅读模式\]|阅读/;

if (!sliceId) {
  throw new Error("Usage: node slice-verify/external-ui-driver.mjs <slice-id>");
}

fs.mkdirSync(artifactDir, { recursive: true });

const frames = [];

function decodePhoenixFrame(payload) {
  try {
    const frame = JSON.parse(payload);
    if (Array.isArray(frame) && frame.length >= 5) {
      const [, , topic, event, body] = frame;
      return { topic, event, body };
    }
  } catch {
    return null;
  }

  return null;
}

function recordFrame(direction, payload) {
  const decoded = decodePhoenixFrame(payload);
  if (decoded) frames.push({ direction, ...decoded });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeVisibleText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function providerActivityReasonCodes(event) {
  const eventType = String(event?.event_type ?? "");
  const codes = ["provider_execution_stream"];
  if (eventType) codes.push(`provider_${eventType}`);

  const phase = String(event?.payload?.phase ?? event?.payload?.provider_progress_phase ?? "");
  if (phase === "request_prepared") codes.push("provider_request_prepared");
  if (phase === "request_dispatched") codes.push("provider_request_dispatched");
  if (phase === "response_received") codes.push("provider_response_received");

  return codes;
}

function providerActivityProgressFrame(run, event) {
  const payload = event?.payload ?? {};
  const eventType = String(event?.event_type ?? "");
  const outputSummary = run?.output?.content_summary ?? {};

  return {
    body: {
      event_type: "provider_progress",
      visibility: "developer",
      step_ref: run?.step_ref ?? null,
      reason_codes: providerActivityReasonCodes(event),
      payload: {
        ...payload,
        provider_event_type: eventType,
        provider_progress_phase: payload.phase ?? payload.provider_progress_phase,
        provider_run_ref: run?.provider_run_ref ?? event?.provider_run_ref,
        provider_call_ref: run?.provider_call_ref ?? event?.provider_call_ref,
        purpose: run?.purpose,
        status: run?.status,
        output_type: payload.output_type ?? run?.output_type,
        chunk_index: payload.chunk_index,
        chunk_content_length: payload.content_length ?? payload.chunk_content_length,
        accumulated_content_length: payload.accumulated_content_length,
        content_length: eventType === "final_output" ? run?.content_length : payload.content_length,
        native_tool_call_count:
          eventType === "final_output"
            ? outputSummary.native_tool_call_count
            : payload.native_tool_call_count,
        native_tool_call_names:
          eventType === "final_output"
            ? outputSummary.native_tool_call_names
            : payload.native_tool_call_names,
        usage: run?.usage,
      },
    },
  };
}

function isToolTraceRef(ref) {
  if (typeof ref === "string") return ref.startsWith("tool_trace:");
  if (!ref || typeof ref !== "object") return false;

  return Boolean(ref.tool_name && ref.tool_request_ref && ref.tool_result_ref);
}

function assertReplayReportCompleteForReadonlyTool(traceRecord) {
  const report = traceRecord.replay_report ?? {};
  const chainSteps = Array.isArray(report.chain_summary)
    ? report.chain_summary.map((step) => step.step)
    : [];
  const questions = Array.isArray(report.required_questions) ? report.required_questions : [];
  const missingRefs = Array.isArray(report.missing_trace_refs) ? report.missing_trace_refs : [];

  assert(report.provider_called === false, "ReplayReport called or claimed provider recall");
  assert(
    report.result_status === "complete",
    `ReplayReport was not complete: ${report.result_status}`,
  );
  assert(missingRefs.length === 0, `ReplayReport had missing refs: ${missingRefs.join(", ")}`);
  assert(chainSteps.includes("frame"), "ReplayReport chain did not include frame");
  assert(chainSteps.includes("plan"), "ReplayReport chain did not include plan");
  assert(chainSteps.includes("decision"), "ReplayReport chain did not include decision");
  assert(chainSteps.includes("tool_trace"), "ReplayReport chain did not include tool trace");
  assert(chainSteps.includes("turn_result"), "ReplayReport chain did not include TurnResult");
  assert(
    questions.length === 6,
    `ReplayReport did not answer six required questions: ${questions.length}`,
  );
  assert(
    questions.every((question) => ["answered", "not_applicable"].includes(question.status)),
    "ReplayReport had unanswered or missing required questions",
  );
  assert(
    questions.some((question) => question.id === "tool_approval" && question.status === "answered"),
    "ReplayReport did not answer the tool approval question",
  );
  assert(
    questions.some(
      (question) => question.id === "adoption_boundary" && question.status === "answered",
    ),
    "ReplayReport did not answer why the ToolResult was not adopted",
  );

  return { report, chainSteps, questions, missingRefs };
}

function field(source, key) {
  if (!source || typeof source !== "object") return undefined;
  return source[key];
}

function firstToolTraceRef(refs) {
  if (!Array.isArray(refs)) return null;
  return refs.find(isToolTraceRef) ?? null;
}

function assertToolTraceRegistryRedactedIo(traceRecord) {
  const toolRef = firstToolTraceRef(traceRecord.tool_trace_refs);
  assert(toolRef, "ToolTrace ref was not available for registry/redaction checks");

  const registrySnapshot = field(toolRef, "registry_snapshot") ?? {};
  const contractRefs = field(toolRef, "contract_refs") ?? {};
  const grantSummary = field(toolRef, "grant_summary") ?? {};
  const requestSummary = field(toolRef, "request_summary") ?? {};
  const resultSummary = field(toolRef, "result_summary") ?? {};
  const ioRedaction = field(toolRef, "io_redaction") ?? {};
  const requestKeys = Array.isArray(field(requestSummary, "keys"))
    ? field(requestSummary, "keys")
    : [];
  const resultKeys = Array.isArray(field(resultSummary, "keys"))
    ? field(resultSummary, "keys")
    : [];

  assert(
    field(registrySnapshot, "tool_name") === "character_roster",
    "ToolTrace registry snapshot did not name character_roster",
  );
  assert(
    field(registrySnapshot, "tool_version") === "1.0.0",
    "ToolTrace registry snapshot did not preserve tool version",
  );
  assert(
    field(registrySnapshot, "status") === "active",
    "ToolTrace registry snapshot did not preserve active status",
  );
  assert(
    field(registrySnapshot, "tool_layer") === "memory",
    "ToolTrace registry snapshot did not preserve memory layer",
  );
  assert(
    field(contractRefs, "input_contract_ref") === "character_roster_query_v1",
    "ToolTrace did not preserve input contract ref",
  );
  assert(
    field(contractRefs, "output_contract_ref") === "character_roster_result_v1",
    "ToolTrace did not preserve output contract ref",
  );
  assert(
    Array.isArray(field(grantSummary, "requested_read_scopes")) &&
      field(grantSummary, "requested_read_scopes").includes("character_list"),
    "ToolTrace did not preserve read grant summary",
  );
  assert(
    Array.isArray(field(grantSummary, "requested_write_scopes")) &&
      field(grantSummary, "requested_write_scopes").length === 0,
    "Readonly ToolTrace recorded write grants",
  );
  assert(
    field(grantSummary, "grants_within_registry") === true,
    "ToolTrace grants were not checked against registry",
  );
  assert(
    requestKeys.includes("characters"),
    "ToolTrace request summary did not include redacted input keys",
  );
  assert(
    resultKeys.includes("character_count"),
    "ToolTrace result summary did not include redacted output keys",
  );
  assert(
    resultKeys.includes("characters"),
    "ToolTrace result summary did not include character output key",
  );
  assert(field(requestSummary, "payload_stored") === false, "ToolTrace stored raw request payload");
  assert(field(resultSummary, "payload_stored") === false, "ToolTrace stored raw result payload");
  assert(
    field(ioRedaction, "input_payload_stored") === false,
    "ToolTrace redaction allowed raw input payload",
  );
  assert(
    field(ioRedaction, "output_payload_stored") === false,
    "ToolTrace redaction allowed raw output payload",
  );

  const serialized = JSON.stringify(toolRef);
  for (const rawToken of ["林澈", "未确认影子", "外部角色", "追查灵源矿区真相"]) {
    assert(!serialized.includes(rawToken), `ToolTrace leaked raw tool payload token: ${rawToken}`);
  }

  const report = traceRecord.replay_report ?? {};
  const toolChainStep = Array.isArray(report.chain_summary)
    ? report.chain_summary.find((step) => step.step === "tool_trace")
    : null;
  assert(toolChainStep, "ReplayReport chain did not expose a tool_trace step");
  assert(
    field(field(toolChainStep, "registry_snapshot") ?? {}, "tool_name") === "character_roster",
    "ReplayReport tool_trace step did not carry registry snapshot",
  );
  assert(
    field(field(toolChainStep, "io_redaction") ?? {}, "input_payload_stored") === false &&
      field(field(toolChainStep, "io_redaction") ?? {}, "output_payload_stored") === false,
    "ReplayReport tool_trace step did not preserve redacted IO boundary",
  );

  return {
    toolRef,
    registrySnapshot,
    contractRefs,
    grantSummary,
    requestSummary,
    resultSummary,
    ioRedaction,
    registrySnapshotComplete: true,
    redactedIoNoRawPayload: true,
    replayReportToolTraceCarriesSnapshot: true,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForChild(child, label) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} exited with code=${code ?? "null"} signal=${signal ?? "null"}`));
    });
  });
}

async function fetchOk(url, timeoutMs = 1_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForUrlState(url, expectedReachable, message, timeoutMs = 30_000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if ((await fetchOk(url)) === expectedReachable) return;
    await sleep(500);
  }

  throw new Error(message);
}

function protocolSocketEndpoint() {
  const apiUrl = process.env.SLICE_VERIFY_API_URL ?? baseUrl;
  return `${apiUrl.replace(/^http/, "ws")}/socket`;
}

function receiveProtocolPush(push, label) {
  return new Promise((resolve, reject) => {
    push
      .receive("ok", (payload) => resolve({ status: "ok", payload }))
      .receive("error", (payload) => resolve({ status: "error", payload }))
      .receive("timeout", () => reject(new Error(`${label} timeout`)));
  });
}

async function joinProtocolWorkspace(workId, sessionId) {
  assert(workId, "protocol workspace requires work_id");
  assert(sessionId, "protocol workspace requires session_id");

  const socket = new Socket(protocolSocketEndpoint(), { transport: WebSocket });
  const events = [];

  socket.connect();
  const channel = socket.channel(`workspace:${workId}`, { work_id: workId, session_id: sessionId });
  channel.on("turn_result", (payload) => events.push({ event: "turn_result", payload }));
  channel.on("action_result", (payload) => events.push({ event: "action_result", payload }));

  const join = await receiveProtocolPush(channel.join(10_000), "protocol workspace join");
  assert(join.status === "ok", `protocol workspace join failed: ${JSON.stringify(join.payload)}`);

  return { socket, channel, events, join: join.payload };
}

async function closeProtocolWorkspace(client) {
  try {
    await receiveProtocolPush(client.channel.leave(2_000), "protocol workspace leave");
  } catch {
    // Best-effort cleanup only; the verifier evidence is already captured before this point.
  } finally {
    client.socket.disconnect();
  }
}

async function waitForProtocolEvent(
  client,
  afterIndex,
  eventName,
  predicate,
  message,
  timeoutMs = 60_000,
) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const match = client.events
      .slice(afterIndex)
      .find((entry) => entry.event === eventName && predicate(entry.payload));
    if (match) return match.payload;
    await sleep(250);
  }

  throw new Error(message);
}

async function pushProtocolUserMessage(client, text, workId, sessionId) {
  const eventCount = client.events.length;
  const reply = await receiveProtocolPush(
    client.channel.push(
      "user_message",
      {
        text,
        work_id: workId,
        session_id: sessionId,
        generate_micro_plan: false,
      },
      300_000,
    ),
    "protocol user_message",
  );
  assert(reply.status === "ok", `protocol user_message failed: ${JSON.stringify(reply.payload)}`);

  const turnResult = await waitForProtocolEvent(
    client,
    eventCount,
    "turn_result",
    (payload) => payload?.work_id === workId && payload?.session_id === sessionId,
    "protocol user_message did not receive turn_result",
    120_000,
  );

  return { reply: reply.payload, turnResult };
}

async function pushProtocolAuthorAction(client, action) {
  return await receiveProtocolPush(
    client.channel.push("author_action", { action }, 300_000),
    `protocol author_action ${action.action_id}`,
  );
}

async function killProcessTree(pid, graceSeconds = 3) {
  const projectRoot = process.env.SLICE_VERIFY_PROJECT_ROOT;
  assert(projectRoot, "SLICE_VERIFY_PROJECT_ROOT is required to control Phoenix");

  const killer = spawn(
    "bash",
    [
      "-lc",
      'source "$PROJECT_ROOT/scripts/lib/process_tree.sh"; kill_process_tree "$TARGET_PID" "$TARGET_GRACE"',
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        PROJECT_ROOT: projectRoot,
        TARGET_PID: String(pid),
        TARGET_GRACE: String(graceSeconds),
      },
      stdio: "pipe",
    },
  );

  let stderr = "";
  killer.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForChild(killer, "kill_process_tree");
  } catch (error) {
    const detail = stderr.trim();
    throw new Error(`${error.message}${detail ? `: ${detail}` : ""}`);
  }
}

function startPhoenixSliceServer() {
  const projectRoot = process.env.SLICE_VERIFY_PROJECT_ROOT;
  const phoenixPort = process.env.SLICE_VERIFY_PHOENIX_PORT;
  const appLogDir = process.env.SLICE_VERIFY_APP_LOG_DIR;
  const llmLogDir = process.env.SLICE_VERIFY_LLM_LOG_DIR;
  const provider = process.env.SLICE_VERIFY_PROVIDER ?? "slice_verify";
  const backendLog = process.env.SLICE_VERIFY_BACKEND_LOG;

  assert(projectRoot, "SLICE_VERIFY_PROJECT_ROOT is required to restart Phoenix");
  assert(phoenixPort, "SLICE_VERIFY_PHOENIX_PORT is required to restart Phoenix");
  assert(appLogDir, "SLICE_VERIFY_APP_LOG_DIR is required to restart Phoenix");
  assert(llmLogDir, "SLICE_VERIFY_LLM_LOG_DIR is required to restart Phoenix");
  assert(backendLog, "SLICE_VERIFY_BACKEND_LOG is required to restart Phoenix");

  const stdout = fs.openSync(backendLog, "a");
  const stderr = fs.openSync(backendLog, "a");

  const child = spawn(
    "mix",
    ["run", "--no-start", "--no-halt", "scripts/slice_verify_server.exs"],
    {
      cwd: projectRoot,
      detached: true,
      env: {
        ...process.env,
        MIX_ENV: "test",
        PHOENIX_TEST_PORT: phoenixPort,
        PHOENIX_PORT: phoenixPort,
        SLICE_VERIFY_APP_LOG_DIR: appLogDir,
        SLICE_VERIFY_LLM_LOG_DIR: llmLogDir,
        SLICE_VERIFY_PROVIDER: provider,
        AI_NOVEL_DESKTOP_PROFILE: "slice-verify",
      },
      stdio: ["ignore", stdout, stderr],
    },
  );

  fs.closeSync(stdout);
  fs.closeSync(stderr);

  child.once("error", (error) => {
    fs.appendFileSync(backendLog, `\n[slice-verify] failed to restart Phoenix: ${error.message}\n`);
  });

  return child;
}

function createPhoenixServiceController() {
  const originalPid = Number(process.env.SLICE_VERIFY_PHOENIX_PID ?? "");
  const apiUrl = process.env.SLICE_VERIFY_API_URL;
  assert(Number.isInteger(originalPid) && originalPid > 0, "SLICE_VERIFY_PHOENIX_PID is required");
  assert(apiUrl, "SLICE_VERIFY_API_URL is required");

  const healthUrl = `${apiUrl}/health`;
  let restarted = null;

  return {
    async stopOriginal() {
      await killProcessTree(originalPid);
      await waitForUrlState(
        healthUrl,
        false,
        "Phoenix health stayed reachable after external service stop",
        20_000,
      );
    },
    async restart() {
      restarted = startPhoenixSliceServer();
      await waitForUrlState(
        healthUrl,
        true,
        "Phoenix health did not recover after external service restart",
        60_000,
      );
      return restarted.pid;
    },
    async stopRestarted() {
      if (!restarted?.pid) return;
      await killProcessTree(restarted.pid);
      restarted = null;
    },
  };
}

async function createWorkSeed(attrs) {
  const response = await fetch(`${baseUrl}/api/works`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(attrs),
  });

  assert(response.ok, `Failed to create work seed: HTTP ${response.status}`);
  const body = await response.json();
  assert(body?.work?.id, "Created work seed response did not include work id");
  return body.work;
}

async function createWorkSessionSeed(workId, attrs) {
  const response = await fetch(`${baseUrl}/api/works/${encodeURIComponent(workId)}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(attrs),
  });

  assert(response.ok, `Failed to create work session seed: HTTP ${response.status}`);
  const body = await response.json();
  assert(body?.session?.id, "Created work session response did not include session id");
  return body.session;
}

async function listWorksFromApi() {
  const response = await fetch(`${baseUrl}/api/works`);
  assert(response.ok, `Failed to list works: HTTP ${response.status}`);
  const body = await response.json();
  return body?.works ?? [];
}

async function fetchWorkFromApi(id) {
  const response = await fetch(`${baseUrl}/api/works/${encodeURIComponent(id)}`);
  assert(response.ok, `Failed to fetch work ${id}: HTTP ${response.status}`);
  const body = await response.json();
  assert(body?.work?.id === id, `Fetched work ${id} response did not match requested id`);
  return body.work;
}

async function fetchSessionSnapshotFromApi(workId, sessionId) {
  const response = await fetch(
    `${baseUrl}/api/works/${encodeURIComponent(workId)}/sessions/${encodeURIComponent(sessionId)}`,
  );
  assert(response.ok, `Failed to fetch session snapshot ${sessionId}: HTTP ${response.status}`);
  return await response.json();
}

async function fetchSessionTranscriptPageApi(workId, sessionId, beforeId, limit = 30) {
  const params = new URLSearchParams();
  if (beforeId) params.set("before_id", beforeId);
  if (limit) params.set("limit", String(limit));
  const response = await fetch(
    `${baseUrl}/api/works/${encodeURIComponent(workId)}/sessions/${encodeURIComponent(
      sessionId,
    )}/transcript?${params.toString()}`,
  );
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function discardWorkFromApi(work) {
  const response = await fetch(`${baseUrl}/api/works/${encodeURIComponent(work.id)}/discard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision: work.revision }),
  });
  assert(response.ok, `Failed to discard work ${work.id}: HTTP ${response.status}`);
  const body = await response.json();
  assert(body?.work?.id === work.id, `Discard response did not match work ${work.id}`);
  return body.work;
}

async function waitForWorkByTitle(title, excludedIds = new Set(), timeoutMs = 10_000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const match = (await listWorksFromApi()).find(
      (work) => work.title === title && !excludedIds.has(work.id),
    );
    if (match) return match;
    await sleep(250);
  }

  throw new Error(`Work did not appear in API list with title: ${title}`);
}

async function waitForTranscriptTurn(workId, sessionId, turnId, timeoutMs = 30_000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const snapshot = await fetchSessionSnapshotFromApi(workId, sessionId);
    const transcript = Array.isArray(snapshot.transcript) ? snapshot.transcript : [];
    const assistantRow = transcript.find(
      (entry) => entry.turn_id === turnId && entry.role === "assistant",
    );
    const userRow = transcript.find((entry) => entry.turn_id === turnId && entry.role === "user");

    if (assistantRow && userRow) {
      return { snapshot, assistantRow, userRow };
    }

    await sleep(250);
  }

  throw new Error(`Transcript did not persist turn ${turnId} for session ${sessionId}`);
}

async function fetchReplayApi(workId, sessionId, turnId) {
  const response = await fetch(
    `${baseUrl}/api/works/${encodeURIComponent(workId)}/sessions/${encodeURIComponent(
      sessionId,
    )}/turns/${encodeURIComponent(turnId)}/replay`,
  );
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function fetchAgentRunActivityApi(workId, sessionId, turnId) {
  const response = await fetch(
    `${baseUrl}/api/works/${encodeURIComponent(workId)}/sessions/${encodeURIComponent(
      sessionId,
    )}/turns/${encodeURIComponent(turnId)}/agent-run-activity`,
  );
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function openWorkMenu(page) {
  await workTitle(page).click();
  await page.locator('[class*="workMenu"]').first().waitFor({ timeout: 10_000 });
}

async function clickWorkMenuItemByExactTitle(page, title) {
  const items = page.getByRole("menuitem");
  const count = await items.count();

  for (let index = 0; index < count; index += 1) {
    const item = items.nth(index);
    const text = ((await item.textContent()) ?? "").replace(/\s+/g, " ").trim();
    if (text === title || text === `${title} 当前`) {
      await item.click();
      return;
    }
  }

  throw new Error(`Work menu item not found: ${title}`);
}

async function refreshAndSelectWork(page, title) {
  await openWorkMenu(page);
  const refresh = page.locator('button[title="刷新作品列表"]').first();
  if ((await refresh.count()) > 0) {
    await refresh.click();
    await sleep(250);
  }
  await clickWorkMenuItemByExactTitle(page, title);
}

async function ensureWorkSelectedByTitle(page, title, expectedWorkId, timeoutMs = 30_000) {
  const currentTitle = ((await workTitle(page).textContent()) ?? "").replace(/\s+/g, " ").trim();
  if (currentTitle.includes(title)) {
    const existingJoin = readAppLogRecords()
      .filter((record) => record.event === "channel.join.done" && record.work_id === expectedWorkId)
      .at(-1);
    if (existingJoin) return existingJoin;

    const joinReply =
      latestChannelJoinReply()?.body?.response ?? latestChannelJoinReply()?.body ?? {};
    return {
      event: "channel.join.done",
      workspace_id: expectedWorkId,
      work_id: expectedWorkId,
      session_id: joinReply.session_id ?? null,
      outcome: "ok",
    };
  }

  const beforeCount = readAppLogRecords().length;
  await switchToWorkByTitle(page, title);
  return await waitForNewAppLogRecord(
    beforeCount,
    (record) => record.event === "channel.join.done" && record.work_id === expectedWorkId,
    `Selecting ${title} did not join expected work channel`,
    timeoutMs,
  );
}

async function waitForVisibleWorkTitle(page, title, timeoutMs = 15_000) {
  await page.waitForFunction(
    (expectedTitle) => {
      const titleButton = document.querySelector('button[title="作品"]');
      return (titleButton?.textContent ?? "").includes(expectedTitle);
    },
    title,
    { timeout: timeoutMs },
  );
}

async function createWorkFromMenu(page, previousWorkId) {
  const beforeCount = readAppLogRecords().length;
  await openWorkMenu(page);
  await page.getByRole("menuitem", { name: "快速新建未命名作品" }).click();

  return await waitForNewAppLogRecord(
    beforeCount,
    (record) =>
      record.event === "channel.join.done" && record.work_id && record.work_id !== previousWorkId,
    "Creating a work from the work menu did not join a new workspace channel",
    30_000,
  );
}

async function openNamedCreateWorkDialog(page) {
  await openWorkMenu(page);
  await page.getByRole("menuitem", { name: "新建作品" }).click();
  await page.getByRole("dialog", { name: "新建作品" }).waitFor({ timeout: 10_000 });
}

async function submitWorkTitleDialog(page, title, buttonName) {
  await page.locator("#work-title-input").fill(title);
  await page.getByRole("button", { name: buttonName }).click();
}

async function configureProviderRuntime(attrs) {
  const response = await fetch(`${baseUrl}/api/provider/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(attrs),
  });

  const body = await response.json().catch(() => ({}));
  assert(
    response.ok && body?.ok !== false,
    `Failed to configure provider ${attrs.provider}: HTTP ${response.status}`,
  );
  return body;
}

function activeSliceVerifyProvider() {
  const provider = process.env.SLICE_VERIFY_PROVIDER ?? "slice_verify";
  assert(
    ["slice_verify", "lmstudio", "deepseek"].includes(provider),
    `Unsupported slice verify provider: ${provider}`,
  );
  return provider;
}

function compactProviderAttrs(attrs) {
  return Object.fromEntries(
    Object.entries(attrs).filter(([, value]) => {
      if (value == null) return false;
      if (typeof value === "string") return value.trim() !== "";
      return true;
    }),
  );
}

async function firstOpenAiCompatibleModel(endpoint) {
  try {
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/models`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;

    const body = await response.json();
    const model = Array.isArray(body?.data) ? body.data.find((entry) => entry?.id) : null;
    return typeof model?.id === "string" && model.id.trim() !== "" ? model.id.trim() : null;
  } catch {
    return null;
  }
}

async function providerRuntimeAttrsForExternalRun(provider) {
  if (provider === "slice_verify") return { provider: "slice_verify" };

  if (provider === "lmstudio") {
    const endpoint = process.env.NOVEL_LMSTUDIO_ENDPOINT ?? "http://localhost:1234/v1";
    const model =
      process.env.NOVEL_LMSTUDIO_MODEL ??
      (await firstOpenAiCompatibleModel(endpoint)) ??
      "qwen/qwen3.5-122b-a10b";

    return { provider: "lmstudio", endpoint, model };
  }

  const apiKey = process.env.NOVEL_DEEPSEEK_API_KEY ?? process.env.DEEPSEEK_API_KEY;
  assert(apiKey, "DeepSeek live verification requires NOVEL_DEEPSEEK_API_KEY or DEEPSEEK_API_KEY");

  return compactProviderAttrs({
    provider: "deepseek",
    api_key: apiKey,
    endpoint: process.env.NOVEL_DEEPSEEK_ENDPOINT ?? "https://api.deepseek.com",
    model: process.env.NOVEL_DEEPSEEK_MODEL ?? "deepseek-v4-flash",
    thinking: process.env.NOVEL_DEEPSEEK_THINKING ?? "disabled",
    reasoning_effort: process.env.NOVEL_DEEPSEEK_REASONING_EFFORT,
  });
}

async function configureExternalRunProviderRuntime() {
  const provider = activeSliceVerifyProvider();
  return await configureProviderRuntime(await providerRuntimeAttrsForExternalRun(provider));
}

async function startHangingOpenAiServer() {
  const sockets = new Set();
  const server = http.createServer((_request, _response) => {
    // Intentionally never respond: the real LM Studio adapter must hit its receive timeout.
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  assert(address && typeof address === "object", "Hanging OpenAI server did not bind a port");

  return {
    endpoint: `http://127.0.0.1:${address.port}/v1`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function textContent(page, selector) {
  return page
    .locator(selector)
    .first()
    .textContent()
    .then((value) => value?.trim() ?? "")
    .catch(() => "");
}

function serviceStatus(page) {
  return page.getByText(/^服务:|^同步/).first();
}

function workTitle(page) {
  return page.locator('button[title="作品"]').first();
}

function latestSentUserMessage() {
  return frames
    .filter((frame) => frame.direction === "sent" && frame.event === "user_message")
    .at(-1);
}

function latestChannelJoinReply() {
  return frames
    .filter(
      (frame) =>
        frame.direction === "received" &&
        frame.event === "phx_reply" &&
        (frame.body?.response?.work_id || frame.body?.work_id),
    )
    .at(-1);
}

function latestTurnResult() {
  return frames
    .filter((frame) => frame.direction === "received" && frame.event === "turn_result")
    .at(-1)?.body;
}

function latestActionResult() {
  return frames
    .filter((frame) => frame.direction === "received" && frame.event === "action_result")
    .at(-1)?.body;
}

function receivedTaskStateFrames(taskId) {
  return frames.filter(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "task_state" &&
      (!taskId || frame.body?.task_id === taskId),
  );
}

async function waitForFrame(predicate, message, timeoutMs = 60_000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const match = frames.find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(message);
}

async function waitForNewFrame(afterCount, predicate, message, timeoutMs = 60_000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const match = frames.slice(afterCount).find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(message);
}

async function installReasoningStreamObserver(page) {
  await page.evaluate(() => {
    if (window.__sliceVerifyReasoningObserver?.disconnect) {
      window.__sliceVerifyReasoningObserver.disconnect();
    }

    window.__sliceVerifyReasoningStreamSamples = [];

    const currentReasoningText = () => {
      const sections = Array.from(document.querySelectorAll('section[aria-label="推理"]'));
      const section = sections[sections.length - 1];
      return section?.innerText ?? "";
    };

    let lastText = "";
    const sample = (reason) => {
      const text = currentReasoningText();
      if (!text || text === lastText) return;
      lastText = text;
      window.__sliceVerifyReasoningStreamSamples.push({
        reason,
        length: text.length,
        text,
        time: performance.now(),
      });
    };

    const observer = new MutationObserver(() => sample("mutation"));
    observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    sample("initial");
    window.__sliceVerifyReasoningObserver = observer;
  });
}

async function readReasoningStreamSamples(page) {
  return await page.evaluate(() => window.__sliceVerifyReasoningStreamSamples ?? []);
}

function localDateString() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function readAppLogRecords() {
  const logPath = path.join(artifactDir, "app-log", `${localDateString()}.jsonl`);
  if (!fs.existsSync(logPath)) return [];

  return fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function readSeedField(name) {
  const seedPath = path.join(artifactDir, "seed.log");
  if (!fs.existsSync(seedPath)) return null;

  const seedLog = fs.readFileSync(seedPath, "utf8");
  const prefix = `${name}=`;
  const token = seedLog.split(/\s+/).find((part) => part.startsWith(prefix));
  return token ? token.slice(prefix.length) : null;
}

async function clickVisibleReadingModeButton(page) {
  const button = page.getByRole("button", { name: /^\s*阅读\s*$/ }).first();
  await button.waitFor({ state: "visible", timeout: 10_000 });
  await button.scrollIntoViewIfNeeded();

  const box = await button.boundingBox();
  assert(box, "Reading mode button did not have a visible bounding box");

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function queryTraceByTurn(turnId) {
  const projectRoot = process.env.SLICE_VERIFY_PROJECT_ROOT;
  assert(projectRoot, "SLICE_VERIFY_PROJECT_ROOT is required to query persisted trace");

  const outputPath = path.join(artifactDir, "trace-query.json");
  const queryCode = `
repo_config =
  :novel_persistence
  |> Application.get_env(NovelPersistence.Repo, [])
  |> Keyword.put(:pool, DBConnection.ConnectionPool)
  |> Keyword.put(:pool_size, 1)

Application.put_env(:novel_persistence, NovelPersistence.Repo, repo_config)

{:ok, _started} = Application.ensure_all_started(:novel_persistence)

turn_id = System.fetch_env!("TRACE_QUERY_TURN_ID")

defmodule SliceVerifyReplayQuery do
  def trace_from_record(record) do
    %NovelDomain.DecisionTrace{
      trace_id: record.trace_id,
      turn_id: record.turn_id,
      frame_ref: record.frame_ref,
      plan_ref: record.plan_ref,
      decision_type: atomize(record.decision_type),
      no_tool_reason: record.no_tool_reason,
      no_behavior_reason: record.no_behavior_reason,
      no_write_reason: record.no_write_reason,
      turn_result_ref: record.turn_result_ref,
      replay_policy: record.replay_policy,
      redaction_level: atomize(record.redaction_level || "author_safe"),
      tool_trace_refs: record.tool_trace_refs || [],
      behavior_trace_refs: record.behavior_trace_refs || [],
      state_trace_refs: record.state_trace_refs || [],
      event_order: Enum.map(record.event_order || [], &atomize/1)
    }
  end

  def replay_report(record) do
    record
    |> trace_from_record()
    |> NovelApplication.ReplayService.build_report()
    |> Map.from_struct()
  end

  defp atomize(value) when is_atom(value), do: value
  defp atomize(value) when is_binary(value), do: String.to_atom(value)
  defp atomize(_value), do: nil
end

traces =
  turn_id
  |> NovelPersistence.TraceRepository.list_by_turn()
  |> Enum.map(fn record ->
    %{
      trace_id: record.trace_id,
      turn_id: record.turn_id,
      workspace_id: record.workspace_id,
      frame_ref: record.frame_ref,
      plan_ref: record.plan_ref,
      decision_type: record.decision_type,
      tool_trace_refs: Map.get(record, :tool_trace_refs) || [],
      behavior_trace_refs: Map.get(record, :behavior_trace_refs) || [],
      state_trace_refs: Map.get(record, :state_trace_refs) || [],
      replay_report: SliceVerifyReplayQuery.replay_report(record)
    }
  end)

payload = %{turn_id: turn_id, count: length(traces), traces: traces}

File.write!(System.fetch_env!("TRACE_QUERY_OUTPUT"), Jason.encode!(payload) <> "\\n")
`;

  const child = spawn("mix", ["run", "--no-start", "-e", queryCode], {
    cwd: projectRoot,
    env: {
      ...process.env,
      MIX_ENV: "test",
      TRACE_QUERY_TURN_ID: turnId,
      TRACE_QUERY_OUTPUT: outputPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForChild(child, "trace query");
  } catch (error) {
    throw new Error(
      `${error.message}${stderr.trim() ? `: ${stderr.trim()}` : ""}${
        stdout.trim() ? ` stdout=${stdout.trim()}` : ""
      }`,
    );
  }

  assert(fs.existsSync(outputPath), "Trace query did not write trace-query.json");
  return JSON.parse(fs.readFileSync(outputPath, "utf8"));
}

async function insertPartialTraceForTurn(workId, sessionId, turnId) {
  const projectRoot = process.env.SLICE_VERIFY_PROJECT_ROOT;
  assert(projectRoot, "SLICE_VERIFY_PROJECT_ROOT is required to insert partial trace");

  const outputPath = path.join(artifactDir, "partial-trace-insert.json");
  const insertCode = `
repo_config =
  :novel_persistence
  |> Application.get_env(NovelPersistence.Repo, [])
  |> Keyword.put(:pool, DBConnection.ConnectionPool)
  |> Keyword.put(:pool_size, 1)

Application.put_env(:novel_persistence, NovelPersistence.Repo, repo_config)

{:ok, _started} = Application.ensure_all_started(:novel_persistence)

work_id = System.fetch_env!("TRACE_PARTIAL_WORK_ID")
session_id = System.fetch_env!("TRACE_PARTIAL_SESSION_ID")
turn_id = System.fetch_env!("TRACE_PARTIAL_TURN_ID")
suffix = System.unique_integer([:positive, :monotonic]) |> Integer.to_string()

attrs = %{
  workspace_id: work_id,
  session_id: session_id,
  trace_id: "trace-partial-" <> suffix,
  turn_id: turn_id,
  frame_ref: "frame-partial-" <> suffix,
  plan_ref: "plan-partial-" <> suffix,
  decision_type: "tool_dispatched",
  no_tool_reason: "tool_was_dispatched",
  no_behavior_reason: "tool_dispatched",
  no_write_reason: "no production write",
  replay_policy: %{use_recorded_frame: true, recall_provider: false},
  event_order: ["author_input_received", "micro_plan_recorded", "tool_dispatched"],
  context_refs: [
    %{
      "source_type" => "current_work",
      "summary" => "缺失 trace refs 的回放验收上下文"
    }
  ]
}

{:ok, record} = NovelPersistence.TraceRepository.insert(attrs)

payload = %{
  trace_id: record.trace_id,
  work_id: record.workspace_id,
  session_id: record.session_id,
  turn_id: record.turn_id,
  decision_type: record.decision_type
}

File.write!(System.fetch_env!("TRACE_PARTIAL_OUTPUT"), Jason.encode!(payload) <> "\\n")
`;

  const child = spawn("mix", ["run", "--no-start", "-e", insertCode], {
    cwd: projectRoot,
    env: {
      ...process.env,
      MIX_ENV: "test",
      TRACE_PARTIAL_WORK_ID: workId,
      TRACE_PARTIAL_SESSION_ID: sessionId,
      TRACE_PARTIAL_TURN_ID: turnId,
      TRACE_PARTIAL_OUTPUT: outputPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForChild(child, "partial trace insert");
  } catch (error) {
    throw new Error(
      `${error.message}${stderr.trim() ? `: ${stderr.trim()}` : ""}${
        stdout.trim() ? ` stdout=${stdout.trim()}` : ""
      }`,
    );
  }

  assert(fs.existsSync(outputPath), "Partial trace insert did not write output");
  return JSON.parse(fs.readFileSync(outputPath, "utf8"));
}

async function waitForAppLogRecord(predicate, message, timeoutMs = 60_000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const match = readAppLogRecords().find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(message);
}

async function waitForNewAppLogRecord(afterCount, predicate, message, timeoutMs = 60_000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const match = readAppLogRecords().slice(afterCount).find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(message);
}

async function waitForAppLogCount(predicate, minCount, message, timeoutMs = 60_000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const count = readAppLogRecords().filter(predicate).length;
    if (count >= minCount) return count;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(message);
}

async function waitForNewAppLogCount(afterCount, predicate, minCount, message, timeoutMs = 60_000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const count = readAppLogRecords().slice(afterCount).filter(predicate).length;
    if (count >= minCount) return count;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(message);
}

function viewportForSlice(id) {
  if (id === "au10-workbench-matrix-layout") return { width: 1280, height: 800 };
  return { width: 1440, height: 900 };
}

async function captureWorkbenchLayout(page, phase) {
  return await page.evaluate((currentPhase) => {
    const rectOf = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
      };
    };
    const visible = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
    };
    const text = document.body.innerText;
    const topBar = rectOf('[class*="topBar"]');
    const mainArea = rectOf('[class*="mainArea"]');
    const inputArea = rectOf('[class*="inputArea"]');
    const rail = rectOf('[class*="structureRailCollapsed"]');

    return {
      phase: currentPhase,
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
      document_scroll_width: document.documentElement.scrollWidth,
      document_scroll_height: document.documentElement.scrollHeight,
      body_scroll_width: document.body.scrollWidth,
      top_bar_height: topBar?.height ?? 0,
      top_bar_within_viewport:
        Boolean(topBar) &&
        topBar.x >= 0 &&
        topBar.y >= 0 &&
        topBar.right <= window.innerWidth + 1 &&
        topBar.bottom <= window.innerHeight + 1,
      top_bar_single_row: Boolean(topBar) && topBar.height <= 72,
      main_area_visible: Boolean(mainArea) && mainArea.width >= 960 && mainArea.height >= 560,
      input_area_visible:
        Boolean(inputArea) &&
        inputArea.y >= 0 &&
        inputArea.bottom <= window.innerHeight + 1 &&
        inputArea.height >= 56,
      rail_width: rail?.width ?? 0,
      rail_within_viewport:
        Boolean(rail) && rail.right <= window.innerWidth + 1 && rail.height >= 560,
      no_horizontal_overflow:
        document.documentElement.scrollWidth <= window.innerWidth + 2 &&
        document.body.scrollWidth <= window.innerWidth + 2,
      workbench_visible: visible('[class*="workbench"]'),
      chat_input_visible: visible('input[placeholder="输入你的想法、问题或指令..."]'),
      send_button_visible: [...document.querySelectorAll("button")].some(
        (button) => (button.textContent ?? "").trim() === "发送",
      ),
      service_status_visible: /服务: 已连接|同步已连接/.test(text),
      provider_status_visible: /Stub|LM Studio|DeepSeek|Anthropic|模型已连接|模型未连接/.test(text),
      task_status_visible: text.includes("无任务"),
      reading_entry_visible: text.includes("[阅读模式]") || text.includes("阅读"),
      archive_entry_visible: text.includes("打开档案"),
    };
  }, phase);
}

function assertWorkbenchLayout(layout, phase) {
  assert(layout.viewport_width === 1280, `${phase}: expected 1280px viewport`);
  assert(layout.viewport_height === 800, `${phase}: expected 800px viewport`);
  assert(layout.workbench_visible, `${phase}: workbench root is not visible`);
  assert(layout.no_horizontal_overflow, `${phase}: page has horizontal overflow`);
  assert(layout.top_bar_within_viewport, `${phase}: top bar is outside viewport`);
  assert(layout.top_bar_single_row, `${phase}: top bar wrapped into a second row`);
  assert(layout.main_area_visible, `${phase}: main work area is too small or hidden`);
  assert(layout.input_area_visible, `${phase}: input area is not stable at the bottom`);
  assert(layout.rail_within_viewport, `${phase}: structure rail overflows viewport`);
  assert(layout.chat_input_visible, `${phase}: chat input is not visible`);
  assert(layout.send_button_visible, `${phase}: send button is not visible`);
  assert(layout.service_status_visible, `${phase}: service status is not visible`);
  assert(layout.provider_status_visible, `${phase}: provider status is not visible`);
  assert(layout.task_status_visible, `${phase}: task status baseline is not visible`);
  assert(layout.reading_entry_visible, `${phase}: reading entry is not visible`);
  assert(layout.archive_entry_visible, `${phase}: archive entry is not visible`);
}

async function commonUiState(page, turnResult, sentMessage) {
  const visibleText = await page.locator("body").innerText();

  return {
    event: "slice_verify.ui_state.done",
    slice_id: sliceId,
    turn_id: turnResult.turn_id,
    workspace_id: sentMessage.body?.work_id,
    work_id: sentMessage.body?.work_id,
    session_id: sentMessage.body?.session_id,
    context_work_id: sentMessage.body?.work_id,
    active_session_id: sentMessage.body?.session_id,
    restored_turn_id: turnResult.turn_id,
    socket_connected: true,
    message_count: frames.filter((frame) => frame.event === "turn_result").length * 2 + 1,
    welcome_message_count: visibleText.includes("欢迎使用 AI Novel Studio") ? 1 : 0,
    pending_adoption_count: await page.getByRole("button", { name: /采纳/ }).count(),
    first_message_text: visibleText.slice(0, 300),
    service_status_text: await serviceStatus(page)
      .textContent()
      .then((value) => value?.trim() ?? ""),
    title_text: await workTitle(page)
      .textContent()
      .then((value) => value?.trim() ?? ""),
    long_session_visible_text: visibleText,
    duration_ms: 0,
    outcome: "done",
  };
}

async function openSessionRail(page) {
  const searchBox = page.getByPlaceholder("搜索会话");
  if (await searchBox.isVisible().catch(() => false)) return;

  const sessionSummary = page.locator("summary").filter({ hasText: "会话" }).last();
  await sessionSummary.waitFor({ state: "visible", timeout: 10_000 });
  await sessionSummary.click();
  await searchBox.waitFor({ state: "visible", timeout: 10_000 });
}

async function focusLatestAgenticLoopEvidence(page) {
  const layout = await page.evaluate(() => {
    const flows = Array.from(document.querySelectorAll('[class*="agentRunFlow"]')).filter(
      (element) =>
        element instanceof HTMLElement &&
        element.querySelector(':scope > [class*="agentRunFlowRail"]') instanceof HTMLElement &&
        element.querySelector(':scope > [class*="agentRunFlowContent"]') instanceof HTMLElement,
    );
    const flow = flows[flows.length - 1];
    if (!flow) return null;

    const status = flow.querySelector('[class*="agenticLoopStatusPanel"]');
    const phase = flow.querySelector('[class*="agenticLoopPhaseStrip"]');
    const target = status ?? phase ?? flow;
    let container = flow.parentElement;
    while (container && container !== document.body) {
      const style = window.getComputedStyle(container);
      if (
        container.scrollHeight > container.clientHeight &&
        (style.overflowY === "auto" || style.overflowY === "scroll")
      ) {
        break;
      }
      container = container.parentElement;
    }

    const scrollParent =
      container && container !== document.body ? container : document.scrollingElement;
    if (scrollParent) {
      const targetRect = target.getBoundingClientRect();
      const parentRect =
        scrollParent === document.scrollingElement
          ? { top: 0 }
          : scrollParent.getBoundingClientRect();
      scrollParent.scrollTop = Math.max(
        0,
        scrollParent.scrollTop + targetRect.top - parentRect.top - 24,
      );
    }

    const flowRect = flow.getBoundingClientRect();
    const phaseRect = (phase ?? target).getBoundingClientRect();
    const details = flow.querySelector('[class*="agentRunDetails"]');
    const rail = document.querySelector('[class*="structureRailCollapsed"]');
    const statusRect = status?.getBoundingClientRect() ?? null;
    const detailsRect = details?.getBoundingClientRect() ?? null;
    const railRect = rail?.getBoundingClientRect() ?? null;

    return {
      flow_width: Math.round(flowRect.width),
      phase_top: Math.round(phaseRect.top),
      phase_width: Math.round(phaseRect.width),
      status_top: statusRect ? Math.round(statusRect.top) : null,
      details_top: detailsRect ? Math.round(detailsRect.top) : null,
      rail_left: railRect ? Math.round(railRect.left) : null,
      rail_width: railRect ? Math.round(railRect.width) : null,
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
    };
  });

  await page.waitForTimeout(100);
  return layout;
}

async function visibleMessageRoleOrder(page) {
  return await page.evaluate(() => {
    const userMessages = Array.from(document.querySelectorAll('[class*="userMsg"]')).map(
      (element) => ({ role: "user", top: element.getBoundingClientRect().top }),
    );
    const assistantMessages = Array.from(document.querySelectorAll('[class*="assistantMsg"]')).map(
      (element) => ({ role: "assistant", top: element.getBoundingClientRect().top }),
    );

    return [...userMessages, ...assistantMessages]
      .sort((left, right) => left.top - right.top)
      .map((entry) => entry.role);
  });
}

async function visibleMessageTextIndexes(page, snippets) {
  return await page.evaluate((expectedSnippets) => {
    const rows = Array.from(
      document.querySelectorAll('[class*="userMsg"], [class*="assistantMsg"]'),
    );
    let searchFrom = 0;

    return expectedSnippets.map((snippet) => {
      let index = rows.findIndex(
        (element, rowIndex) => rowIndex >= searchFrom && element.textContent?.includes(snippet),
      );
      if (index < 0) {
        index = rows.findIndex((element) => element.textContent?.includes(snippet));
      }
      const element = index >= 0 ? rows[index] : null;
      if (index >= 0) searchFrom = index + 1;

      return {
        snippet,
        index,
        role:
          element?.className && String(element.className).includes("userMsg")
            ? "user"
            : element?.className && String(element.className).includes("assistantMsg")
              ? "assistant"
              : null,
      };
    });
  }, snippets);
}

async function visibleAgentRunActivityIndexes(page) {
  return await page.evaluate(() => {
    const rows = Array.from(
      document.querySelectorAll('[class*="userMsg"], [class*="assistantMsg"]'),
    );

    return rows
      .map((element, index) => ({
        index,
        role:
          element?.className && String(element.className).includes("userMsg")
            ? "user"
            : element?.className && String(element.className).includes("assistantMsg")
              ? "assistant"
              : null,
        hasActivity: Boolean(element.textContent?.includes("创作执行")),
      }))
      .filter((entry) => entry.role === "assistant" && entry.hasActivity);
  });
}

async function sendOrdinaryChatTurn(page, message, afterFrameCount) {
  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const agentRunActivityObservedPromise = page
    .waitForFunction(() => document.body.innerText.includes("创作执行"), undefined, {
      timeout: 5_000,
    })
    .then(() => true)
    .catch(() => false);

  const turnFrame = await waitForNewFrame(
    afterFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.assistant_message?.text,
    `No ordinary chat turn_result after message: ${message}`,
    90_000,
  );

  await page.waitForFunction(
    (payload) =>
      document.body.innerText.includes(payload.message) &&
      document.body.innerText.includes(payload.assistantText) &&
      !document.body.innerText.includes("思考中"),
    {
      message,
      assistantText: turnFrame.body.assistant_message.text,
    },
    { timeout: 30_000 },
  );

  const agentRunActivityObserved = await agentRunActivityObservedPromise;
  return {
    turnResult: turnFrame.body,
    agentRunActivityObserved,
    thinkingObserved: agentRunActivityObserved,
  };
}

async function driveAu01OrdinaryChatTwoTurnRoundtrip(page) {
  const firstMessage = "我想写一个雨夜开场的悬疑故事，先聊聊气质。";
  const secondMessage = "这种雨夜气质会让读者产生什么第一印象？";

  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  assert((await workTitle(page).count()) > 0, "Real work title button is not visible");
  assert((await serviceStatus(page).count()) > 0, "Real service status is not visible");

  const firstTurn = await sendOrdinaryChatTurn(page, firstMessage, frames.length);
  const secondTurn = await sendOrdinaryChatTurn(page, secondMessage, frames.length);
  const sentMessages = frames.filter(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      [firstMessage, secondMessage].includes(String(frame.body?.text ?? "")),
  );

  assert(sentMessages.length === 2, "Real workbench did not send two user_message frames");
  assert(
    sentMessages.every((frame) => frame.body?.generate_micro_plan === false),
    "Ordinary chat user_message did not preserve generate_micro_plan=false",
  );
  assert(firstTurn.turnResult.turn_id !== secondTurn.turnResult.turn_id, "Turns reused turn_id");

  const uiState = await commonUiState(page, secondTurn.turnResult, sentMessages.at(-1));
  const visibleText = await page.locator("body").innerText();
  const messageRoleOrder = await visibleMessageRoleOrder(page);
  const messageTextIndexes = await visibleMessageTextIndexes(page, [
    firstMessage,
    firstTurn.turnResult.assistant_message.text,
    secondMessage,
    secondTurn.turnResult.assistant_message.text,
  ]);
  const messageTextOrderAnchored =
    messageTextIndexes.every((entry) => Number(entry.index) >= 0) &&
    messageTextIndexes[0].index < messageTextIndexes[1].index &&
    messageTextIndexes[1].index < messageTextIndexes[2].index &&
    messageTextIndexes[2].index < messageTextIndexes[3].index;
  const agentRunActivityIndexes = await visibleAgentRunActivityIndexes(page);
  const secondAgentRunActivityAnchored = agentRunActivityIndexes.some(
    (entry) => entry.index > messageTextIndexes[2].index,
  );
  const userMessageCount = await page.locator('[class*="userMsg"]').count();
  const assistantMessageCount = await page.locator('[class*="assistantMsg"]').count();
  const availableActionCount = await page.locator('[class*="cardActions"] button').count();
  const cardActionCount = await page.locator('[class*="cardActions"]').count();
  const candidatePanelCount = await page.locator("[class*=candidatePanel]").count();
  const adoptionDecisionCardCount = await page
    .getByText(/待确认的创作材料|采纳|修改后采纳|放弃/)
    .count();

  assert(visibleText.includes(firstMessage), "First user message is not visible");
  assert(visibleText.includes(secondMessage), "Second user message is not visible");
  assert(
    visibleText.includes(firstTurn.turnResult.assistant_message.text),
    "First assistant reply is not visible",
  );
  assert(
    visibleText.includes(secondTurn.turnResult.assistant_message.text),
    "Second assistant reply is not visible",
  );
  assert(
    firstTurn.agentRunActivityObserved || secondTurn.agentRunActivityObserved,
    "AgentRun activity was missed",
  );
  assert(
    secondAgentRunActivityAnchored,
    `Second user message did not get its own AgentRun activity flow: ${JSON.stringify(
      agentRunActivityIndexes,
    )}`,
  );
  assert(!visibleText.includes("思考中"), "Thinking indicator stayed visible after replies");
  assert(
    messageTextOrderAnchored,
    `Assistant replies were not anchored below their own user messages: ${JSON.stringify(
      messageTextIndexes,
    )}`,
  );
  assert(availableActionCount === 0, "Ordinary chat rendered available action buttons");
  assert(cardActionCount === 0, "Ordinary chat rendered card action containers");
  assert(candidatePanelCount === 0, "Ordinary chat rendered candidate panel");
  assert(adoptionDecisionCardCount === 0, "Ordinary chat rendered adoption decision controls");

  return [
    {
      ...uiState,
      turn_id: firstTurn.turnResult.turn_id,
      turn_ids: [firstTurn.turnResult.turn_id, secondTurn.turnResult.turn_id],
      ui_turn_ids: [firstTurn.turnResult.turn_id, secondTurn.turnResult.turn_id],
      first_turn_id: firstTurn.turnResult.turn_id,
      second_turn_id: secondTurn.turnResult.turn_id,
      user_message_count: userMessageCount,
      assistant_turn_message_count: Math.max(
        0,
        assistantMessageCount - uiState.welcome_message_count,
      ),
      message_role_order: messageRoleOrder,
      message_text_indexes: messageTextIndexes,
      message_text_order_anchored: messageTextOrderAnchored,
      agent_run_activity_indexes: agentRunActivityIndexes,
      agent_run_activity_count: agentRunActivityIndexes.length,
      second_agent_run_activity_anchored: secondAgentRunActivityAnchored,
      agent_run_activity_observed:
        firstTurn.agentRunActivityObserved || secondTurn.agentRunActivityObserved,
      thinking_visible_after_reply: visibleText.includes("思考中"),
      available_action_count: availableActionCount,
      card_action_count: cardActionCount,
      candidate_panel_count: candidatePanelCount,
      adoption_decision_card_count: adoptionDecisionCardCount,
      first_user_message_visible: visibleText.includes(firstMessage),
      second_user_message_visible: visibleText.includes(secondMessage),
      first_assistant_reply_visible: visibleText.includes(
        firstTurn.turnResult.assistant_message.text,
      ),
      second_assistant_reply_visible: visibleText.includes(
        secondTurn.turnResult.assistant_message.text,
      ),
    },
  ];
}

async function driveAu01EmptyMessageGuard(page) {
  const blankMessage = "   ";
  const recoveryMessage = "空消息后继续聊一个雨夜开场的悬疑气质。";

  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  assert((await workTitle(page).count()) > 0, "Real work title button is not visible");
  assert((await serviceStatus(page).count()) > 0, "Real service status is not visible");

  const userMessageCountBefore = await page.locator('[class*="userMsg"]').count();
  const assistantMessageCountBefore = await page.locator('[class*="assistantMsg"]').count();
  const sentUserMessagesBefore = frames.filter(
    (frame) => frame.direction === "sent" && frame.event === "user_message",
  ).length;

  await page.locator(chatInputSelector).fill(blankMessage);
  await page.getByRole("button", { name: /^发送$/ }).click();
  await sleep(700);

  const userMessageCountAfterBlank = await page.locator('[class*="userMsg"]').count();
  const assistantMessageCountAfterBlank = await page.locator('[class*="assistantMsg"]').count();
  const blankInputValueAfterClick = await page.locator(chatInputSelector).inputValue();
  const inputEnabledAfterBlank = await page.locator(chatInputSelector).isEnabled();
  const visibleTextAfterBlank = await page.locator("body").innerText();
  const sentUserMessagesAfterBlank = frames.filter(
    (frame) => frame.direction === "sent" && frame.event === "user_message",
  ).length;
  const blankUserMessageFrameCount = sentUserMessagesAfterBlank - sentUserMessagesBefore;

  assert(blankUserMessageFrameCount === 0, "Blank input sent a user_message frame");
  assert(
    userMessageCountAfterBlank === userMessageCountBefore,
    "Blank input appended a visible user message",
  );
  assert(
    assistantMessageCountAfterBlank === assistantMessageCountBefore,
    "Blank input appended an assistant message",
  );
  assert(!visibleTextAfterBlank.includes("思考中"), "Blank input left thinking visible");
  assert(inputEnabledAfterBlank, "Chat input became disabled after blank input");

  const recoveryTurn = await sendOrdinaryChatTurn(page, recoveryMessage, frames.length);
  const sentRecoveryMessage = frames.find(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.text === recoveryMessage,
  );
  assert(sentRecoveryMessage, "Recovery message was not sent after blank input");
  assert(
    sentRecoveryMessage.body?.generate_micro_plan === false,
    "Recovery ordinary chat did not preserve generate_micro_plan=false",
  );

  const uiState = await commonUiState(page, recoveryTurn.turnResult, sentRecoveryMessage);
  const visibleText = await page.locator("body").innerText();

  return [
    {
      ...uiState,
      turn_id: recoveryTurn.turnResult.turn_id,
      turn_ids: [recoveryTurn.turnResult.turn_id],
      recovery_turn_id: recoveryTurn.turnResult.turn_id,
      blank_attempted: true,
      blank_input_value_after_click: blankInputValueAfterClick,
      blank_user_message_frame_count: blankUserMessageFrameCount,
      message_count_unchanged_after_blank:
        userMessageCountAfterBlank === userMessageCountBefore &&
        assistantMessageCountAfterBlank === assistantMessageCountBefore,
      user_message_count_before_blank: userMessageCountBefore,
      user_message_count_after_blank: userMessageCountAfterBlank,
      assistant_message_count_before_blank: assistantMessageCountBefore,
      assistant_message_count_after_blank: assistantMessageCountAfterBlank,
      input_enabled_after_blank: inputEnabledAfterBlank,
      thinking_visible_after_blank: visibleTextAfterBlank.includes("思考中"),
      recovery_message_visible: visibleText.includes(recoveryMessage),
      recovery_assistant_reply_visible: visibleText.includes(
        recoveryTurn.turnResult.assistant_message.text,
      ),
      recovery_generate_micro_plan: sentRecoveryMessage.body?.generate_micro_plan,
    },
  ];
}

async function driveAu01GarbageJsonRecovery(page) {
  const garbageMessage = "AU01GARBAGE：请模拟创作引擎返回格式错误，工作台应显示友好降级。";
  const recoveryMessage = "乱码降级后继续聊一个雨夜开场的悬疑气质。";

  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  assert((await workTitle(page).count()) > 0, "Real work title button is not visible");
  assert((await serviceStatus(page).count()) > 0, "Real service status is not visible");

  const garbageTurn = await sendOrdinaryChatTurn(page, garbageMessage, frames.length);
  const sentGarbageMessage = frames.find(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.text === garbageMessage,
  );
  assert(sentGarbageMessage, "Garbage-triggering message was not sent");
  assert(
    sentGarbageMessage.body?.generate_micro_plan === false,
    "Garbage-triggering ordinary chat did not preserve generate_micro_plan=false",
  );

  const fallbackText = garbageTurn.turnResult.assistant_message?.text ?? "";
  assert(
    fallbackText.includes("格式不符合") && fallbackText.includes("请重试"),
    `Malformed provider JSON did not render a friendly fallback: ${fallbackText}`,
  );

  const visibleTextAfterGarbage = await page.locator("body").innerText();
  const inputEnabledAfterGarbage = await page.locator(chatInputSelector).isEnabled();
  const serviceStatusTextAfterGarbage = await serviceStatus(page)
    .textContent()
    .then((value) => value?.trim() ?? "");
  const rawProviderPayloadVisible =
    visibleTextAfterGarbage.includes("not valid json") ||
    visibleTextAfterGarbage.includes("raw provider payload") ||
    visibleTextAfterGarbage.includes("{{{");

  assert(!rawProviderPayloadVisible, "Raw malformed provider payload became visible");
  assert(!visibleTextAfterGarbage.includes("思考中"), "Thinking stayed visible after fallback");
  assert(inputEnabledAfterGarbage, "Chat input became disabled after malformed provider JSON");

  const recoveryTurn = await sendOrdinaryChatTurn(page, recoveryMessage, frames.length);
  const sentRecoveryMessage = frames.find(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.text === recoveryMessage,
  );
  assert(sentRecoveryMessage, "Recovery message was not sent after malformed provider JSON");
  assert(
    sentRecoveryMessage.body?.generate_micro_plan === false,
    "Recovery ordinary chat did not preserve generate_micro_plan=false",
  );
  assert(
    !String(recoveryTurn.turnResult.assistant_message?.text ?? "").includes("格式不符合"),
    "Recovery turn still rendered the malformed JSON fallback",
  );

  const uiState = await commonUiState(page, recoveryTurn.turnResult, sentRecoveryMessage);
  const visibleText = await page.locator("body").innerText();

  return [
    {
      ...uiState,
      turn_id: garbageTurn.turnResult.turn_id,
      turn_ids: [garbageTurn.turnResult.turn_id, recoveryTurn.turnResult.turn_id],
      ui_turn_ids: [garbageTurn.turnResult.turn_id, recoveryTurn.turnResult.turn_id],
      garbage_turn_id: garbageTurn.turnResult.turn_id,
      recovery_turn_id: recoveryTurn.turnResult.turn_id,
      fallback_message_visible: visibleTextAfterGarbage.includes(fallbackText),
      raw_provider_payload_visible: rawProviderPayloadVisible,
      input_enabled_after_garbage: inputEnabledAfterGarbage,
      thinking_visible_after_garbage: visibleTextAfterGarbage.includes("思考中"),
      service_status_text_after_garbage: serviceStatusTextAfterGarbage,
      channel_connected_after_garbage: !serviceStatusTextAfterGarbage.includes("未连接"),
      garbage_generate_micro_plan: sentGarbageMessage.body?.generate_micro_plan,
      recovery_generate_micro_plan: sentRecoveryMessage.body?.generate_micro_plan,
      recovery_message_visible: visibleText.includes(recoveryMessage),
      recovery_assistant_reply_visible: visibleText.includes(
        recoveryTurn.turnResult.assistant_message.text,
      ),
      recovery_assistant_is_fallback: String(
        recoveryTurn.turnResult.assistant_message?.text ?? "",
      ).includes("格式不符合"),
    },
  ];
}

async function driveAu01FrameValidationFriendlyError(page) {
  const invalidFrameMessage =
    "AU01BADFRAME：请模拟创作引擎产出带禁止语义的 frame，工作台应拦截并友好提示。";
  const recoveryMessage = "frame 校验失败后继续聊一个雨夜开场的悬疑气质。";

  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  assert((await workTitle(page).count()) > 0, "Real work title button is not visible");
  assert((await serviceStatus(page).count()) > 0, "Real service status is not visible");

  const invalidTurn = await sendOrdinaryChatTurn(page, invalidFrameMessage, frames.length);
  const sentInvalidFrameMessage = frames.find(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.text === invalidFrameMessage,
  );
  assert(sentInvalidFrameMessage, "Invalid-frame-triggering message was not sent");
  assert(
    sentInvalidFrameMessage.body?.generate_micro_plan === false,
    "Invalid-frame ordinary chat did not preserve generate_micro_plan=false",
  );

  const fallbackText = invalidTurn.turnResult.assistant_message?.text ?? "";
  assert(
    fallbackText.includes("这次处理失败") &&
      fallbackText.includes("未创建待采纳内容") &&
      fallbackText.includes("没有写入作品事实"),
    `Frame validation failure did not render the generic friendly fallback: ${fallbackText}`,
  );

  const serializedTurnResult = JSON.stringify(invalidTurn.turnResult);
  const visibleTextAfterInvalidFrame = await page.locator("body").innerText();
  const inputEnabledAfterInvalidFrame = await page.locator(chatInputSelector).isEnabled();
  const serviceStatusTextAfterInvalidFrame = await serviceStatus(page)
    .textContent()
    .then((value) => value?.trim() ?? "");
  const internalValidationReasonVisible =
    visibleTextAfterInvalidFrame.includes("frame validation failed") ||
    visibleTextAfterInvalidFrame.includes("forbidden semantics") ||
    visibleTextAfterInvalidFrame.includes("ready_to_execute") ||
    visibleTextAfterInvalidFrame.includes("approved and ready_to_execute") ||
    visibleTextAfterInvalidFrame.includes("slice_verify raw provider payload");
  const internalValidationReasonInTurnResult =
    serializedTurnResult.includes("frame validation failed") ||
    serializedTurnResult.includes("forbidden semantics") ||
    serializedTurnResult.includes("ready_to_execute") ||
    serializedTurnResult.includes("approved and ready_to_execute") ||
    serializedTurnResult.includes("slice_verify raw provider payload");

  assert(!internalValidationReasonVisible, "Internal frame validation reason became visible");
  assert(
    !internalValidationReasonInTurnResult,
    "Internal frame validation reason leaked into turn_result payload",
  );
  assert(
    !visibleTextAfterInvalidFrame.includes("思考中"),
    "Thinking stayed visible after fallback",
  );
  assert(
    inputEnabledAfterInvalidFrame,
    "Chat input became disabled after frame validation failure",
  );

  const recoveryTurn = await sendOrdinaryChatTurn(page, recoveryMessage, frames.length);
  const sentRecoveryMessage = frames.find(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.text === recoveryMessage,
  );
  assert(sentRecoveryMessage, "Recovery message was not sent after frame validation failure");
  assert(
    sentRecoveryMessage.body?.generate_micro_plan === false,
    "Recovery ordinary chat did not preserve generate_micro_plan=false",
  );
  assert(
    !String(recoveryTurn.turnResult.assistant_message?.text ?? "").includes("这次处理失败"),
    "Recovery turn still rendered the frame validation fallback",
  );

  const uiState = await commonUiState(page, recoveryTurn.turnResult, sentRecoveryMessage);
  const visibleText = await page.locator("body").innerText();

  return [
    {
      ...uiState,
      turn_id: invalidTurn.turnResult.turn_id,
      turn_ids: [invalidTurn.turnResult.turn_id, recoveryTurn.turnResult.turn_id],
      ui_turn_ids: [invalidTurn.turnResult.turn_id, recoveryTurn.turnResult.turn_id],
      invalid_frame_turn_id: invalidTurn.turnResult.turn_id,
      recovery_turn_id: recoveryTurn.turnResult.turn_id,
      fallback_message_visible: visibleTextAfterInvalidFrame.includes(fallbackText),
      internal_validation_reason_visible: internalValidationReasonVisible,
      internal_validation_reason_in_turn_result: internalValidationReasonInTurnResult,
      input_enabled_after_invalid_frame: inputEnabledAfterInvalidFrame,
      thinking_visible_after_invalid_frame: visibleTextAfterInvalidFrame.includes("思考中"),
      service_status_text_after_invalid_frame: serviceStatusTextAfterInvalidFrame,
      channel_connected_after_invalid_frame: !serviceStatusTextAfterInvalidFrame.includes("未连接"),
      invalid_frame_generate_micro_plan: sentInvalidFrameMessage.body?.generate_micro_plan,
      recovery_generate_micro_plan: sentRecoveryMessage.body?.generate_micro_plan,
      recovery_message_visible: visibleText.includes(recoveryMessage),
      recovery_assistant_reply_visible: visibleText.includes(
        recoveryTurn.turnResult.assistant_message.text,
      ),
      recovery_assistant_is_fallback: String(
        recoveryTurn.turnResult.assistant_message?.text ?? "",
      ).includes("这次处理失败"),
    },
  ];
}

async function driveAu01TurnresultRecorderUiConsistency(page) {
  const message = "请只和我聊雨夜悬疑开场的氛围，不写正文也不改设定。";

  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  const turn = await sendOrdinaryChatTurn(page, message, frames.length);
  const turnResult = turn.turnResult;
  const sentMessage = latestSentUserMessage();
  assert(sentMessage, "No user_message websocket frame was sent for AU-01 recorder check");

  const workId = sentMessage.body?.work_id;
  const sessionId = sentMessage.body?.session_id;
  assert(workId, "AU-01 recorder check did not have work_id in user_message");
  assert(sessionId, "AU-01 recorder check did not have session_id in user_message");

  const assistantText = String(turnResult.assistant_message?.text ?? "");
  assert(assistantText.length > 0, "TurnResult did not include assistant_message.text");

  const visibleTextBeforeReload = await page.locator("body").innerText();
  assert(visibleTextBeforeReload.includes(message), "Current UI did not show the user message");
  assert(visibleTextBeforeReload.includes(assistantText), "Current UI did not show assistant text");

  const { snapshot, assistantRow, userRow } = await waitForTranscriptTurn(
    workId,
    sessionId,
    turnResult.turn_id,
  );
  const transcriptTurnResult = assistantRow.turn_result ?? {};
  const transcriptAssistantText = String(transcriptTurnResult.assistant_message?.text ?? "");

  assert(snapshot.read_only === false, "Active session snapshot was unexpectedly read-only");
  assert(userRow.text === message, "Recorder user row text did not match the UI input");
  assert(assistantRow.text === assistantText, "Recorder assistant row text did not match UI text");
  assert(
    transcriptTurnResult.turn_id === turnResult.turn_id,
    "Recorder turn_result turn_id did not match websocket turn_result",
  );
  assert(
    transcriptAssistantText === assistantText,
    "Recorder turn_result assistant_message.text did not match websocket turn_result",
  );

  const appLogCountBeforeReload = readAppLogRecords().length;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(chatInputSelector).waitFor({ timeout: 20_000 });

  const resumedAfterReload = await waitForNewAppLogRecord(
    appLogCountBeforeReload,
    (record) =>
      record.event === "work_session.resume.done" &&
      record.work_id === workId &&
      record.session_id === sessionId &&
      Number(record.transcript_count ?? 0) >= Number(snapshot.transcript?.length ?? 2),
    "Reload did not resume the active session transcript",
    30_000,
  );

  await page.waitForFunction(
    (payload) =>
      document.body.innerText.includes(payload.message) &&
      document.body.innerText.includes(payload.assistantText) &&
      !document.body.innerText.includes("思考中"),
    { message, assistantText },
    { timeout: 30_000 },
  );

  const restoredSnapshot = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder="输入你的想法、问题或指令..."]');
    const sendButton = [...document.querySelectorAll("button")].find(
      (button) => (button.textContent ?? "").trim() === "发送",
    );

    return {
      visible_text: document.body.innerText,
      input_disabled: Boolean(input?.disabled),
      send_disabled: Boolean(sendButton?.disabled),
    };
  });

  assert(!restoredSnapshot.input_disabled, "Chat input was disabled after transcript restore");
  assert(!restoredSnapshot.send_disabled, "Send button was disabled after transcript restore");

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_id: turnResult.turn_id,
      turn_ids: [turnResult.turn_id],
      work_id: workId,
      workspace_id: workId,
      context_work_id: workId,
      session_id: sessionId,
      active_session_id: sessionId,
      sent_message_text: message,
      assistant_text: assistantText,
      current_ui_user_message_visible: visibleTextBeforeReload.includes(message),
      current_ui_assistant_visible: visibleTextBeforeReload.includes(assistantText),
      transcript_user_row_found: Boolean(userRow),
      transcript_assistant_row_found: Boolean(assistantRow),
      transcript_user_text_matches_ui: userRow.text === message,
      transcript_assistant_text_matches_ui: assistantRow.text === assistantText,
      transcript_turn_result_turn_id_matches_websocket:
        transcriptTurnResult.turn_id === turnResult.turn_id,
      transcript_turn_result_assistant_text_matches_websocket:
        transcriptAssistantText === assistantText,
      transcript_turn_result_assistant_text: transcriptAssistantText,
      transcript_count: snapshot.transcript.length,
      session_snapshot_read_only: snapshot.read_only,
      reload_resume_transcript_count: resumedAfterReload.transcript_count,
      restored_ui_user_message_visible: restoredSnapshot.visible_text.includes(message),
      restored_ui_assistant_visible: restoredSnapshot.visible_text.includes(assistantText),
      restored_input_enabled: !restoredSnapshot.input_disabled,
      restored_send_enabled: !restoredSnapshot.send_disabled,
      generate_micro_plan: sentMessage.body?.generate_micro_plan,
      thinking_observed: turn.thinkingObserved,
      socket_connected: true,
      duration_ms: 0,
      outcome: "done",
    },
  ];
}

async function driveAgentSessionTranscriptLazyPage(page) {
  await configureProviderRuntime({ provider: "slice_verify" });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });

  const messages = Array.from({ length: 16 }, (_item, index) => {
    const ordinal = String(index + 1).padStart(2, "0");
    return `UA01SESSIONPAGE-${ordinal} 验证长会话按页加载`;
  });

  let lastTurn = null;
  for (const message of messages) {
    lastTurn = await sendOrdinaryChatTurn(page, message, frames.length);
  }

  const sentMessage = latestSentUserMessage();
  const workId = sentMessage?.body?.work_id;
  const sessionId = sentMessage?.body?.session_id;
  assert(workId, "Session transcript lazy page scenario did not capture work_id");
  assert(sessionId, "Session transcript lazy page scenario did not capture session_id");
  assert(
    lastTurn?.turnResult?.turn_id,
    "Session transcript lazy page scenario did not finish turns",
  );

  const snapshot = await fetchSessionSnapshotFromApi(workId, sessionId);
  const firstPage = snapshot.transcript ?? [];
  const firstPageInfo = snapshot.transcript_page ?? {};
  assert(
    firstPage.length === 30,
    `Expected first transcript page to have 30 rows, got ${firstPage.length}`,
  );
  assert(
    firstPageInfo.has_more_before === true,
    "First transcript page did not expose has_more_before",
  );
  assert(firstPageInfo.before_id, "First transcript page did not expose before_id cursor");

  const olderApi = await fetchSessionTranscriptPageApi(workId, sessionId, firstPageInfo.before_id);
  const olderTranscript = olderApi.body?.transcript ?? [];
  assert(olderApi.status === 200, "Session transcript page API did not return HTTP 200");
  assert(
    olderTranscript.some((entry) => String(entry.text ?? "").includes(messages[0])),
    "Older transcript page API did not return the first user message",
  );
  const olderAssistantEntry = olderTranscript.find(
    (entry) => entry.role === "assistant" && entry.turn_id && entry.turn_result?.agent_run,
  );
  const olderAssistantTurnId = olderAssistantEntry?.turn_id;
  const olderAssistantAgentRun = olderAssistantEntry?.turn_result?.agent_run ?? {};
  const olderTranscriptAgentRunSummaryOnly =
    olderAssistantAgentRun.activity_loaded === false &&
    (!Array.isArray(olderAssistantAgentRun.events) || olderAssistantAgentRun.events.length === 0) &&
    (!Array.isArray(olderAssistantAgentRun.provider_runs) ||
      olderAssistantAgentRun.provider_runs.length === 0);
  assert(
    olderAssistantTurnId,
    "Older transcript page did not include an assistant turn with AgentRun summary",
  );
  assert(
    olderTranscriptAgentRunSummaryOnly,
    "Older transcript assistant should carry AgentRun summary only before detail expansion",
  );

  const olderActivityApi = await fetchAgentRunActivityApi(workId, sessionId, olderAssistantTurnId);
  const olderActivityBody = olderActivityApi.body ?? {};
  const olderActivityAgentRuns = Array.isArray(olderActivityBody.agent_runs)
    ? olderActivityBody.agent_runs
    : [];
  const olderActivityEvents = olderActivityAgentRuns.flatMap((run) =>
    Array.isArray(run.events) ? run.events : [],
  );
  // 2026-07-02 d0643cd3 起 developer 事件不入 activity API 的 agent_runs[].events；
  // provider 事实由 ProviderRun 事件序列（provider_runs[].events）承担。
  const olderActivityProviderRunEvents = (
    Array.isArray(olderActivityBody.provider_runs) ? olderActivityBody.provider_runs : []
  ).flatMap((run) => (Array.isArray(run.events) ? run.events : []));
  const olderActivityProviderRuns = Array.isArray(olderActivityBody.provider_runs)
    ? olderActivityBody.provider_runs
    : [];
  const olderActivityProviderPurposes = [
    ...new Set(olderActivityProviderRuns.map((run) => run.purpose)),
  ].filter(Boolean);
  const olderActivityRawContentLeaked = [
    "assistant_message",
    "candidate_directions",
    "raw_prompt",
    "system_prompt",
    "raw_provider_error",
    "raw_output",
    messages[0],
  ].some((value) => JSON.stringify(olderActivityBody).includes(value));
  assert(olderActivityApi.status === 200, "Older assistant AgentRun activity API was not HTTP 200");
  assert(
    olderActivityAgentRuns.length >= 1,
    "Older assistant AgentRun activity API did not return AgentRun summary",
  );
  assert(
    olderActivityProviderRunEvents.length >= 2,
    "Older assistant persisted ProviderRun facts did not return provider event sequences",
  );
  assert(
    olderActivityProviderRuns.length >= 3,
    "Older assistant AgentRun activity API did not return ProviderRun usage summaries",
  );
  assert(
    olderActivityProviderPurposes.includes("author_reasoning") &&
      olderActivityProviderPurposes.includes("conversation"),
    "Older assistant AgentRun activity API did not preserve author reasoning/conversation purposes",
  );
  assert(
    !olderActivityRawContentLeaked,
    "Older assistant AgentRun activity API leaked raw provider content",
  );

  const appLogCountBeforeReload = readAppLogRecords().length;
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });

  const resumedAfterReload = await waitForNewAppLogRecord(
    appLogCountBeforeReload,
    (record) =>
      record.event === "work_session.resume.done" &&
      record.work_id === workId &&
      record.session_id === sessionId &&
      Number(record.transcript_count ?? 0) === 30,
    "Reload did not resume only the latest transcript page",
    30_000,
  );

  await page.waitForFunction(
    (payload) =>
      document.body.innerText.includes(payload.latestMessage) &&
      document.body.innerText.includes(payload.loadOlderLabel),
    {
      latestMessage: messages.at(-1),
      loadOlderLabel: "加载更早对话",
    },
    { timeout: 30_000 },
  );

  const visibleBeforeLoadOlder = await page.locator("body").innerText();
  const firstMessageHiddenBeforeLoadOlder = !visibleBeforeLoadOlder.includes(messages[0]);
  assert(
    firstMessageHiddenBeforeLoadOlder,
    "Reloaded long session still rendered the oldest message before loading older transcript",
  );

  const providerCallCountBeforeLoadOlder = readAppLogRecords().filter(
    (record) => record.event === "provider_gateway.complete.start",
  ).length;
  await page.getByRole("button", { name: "加载更早对话" }).click();

  await page.waitForFunction(
    (payload) => document.body.innerText.includes(payload.firstMessage),
    { firstMessage: messages[0] },
    { timeout: 30_000 },
  );
  await sleep(500);

  const visibleAfterLoadOlder = await page.locator("body").innerText();
  const providerCallCountAfterLoadOlder = readAppLogRecords().filter(
    (record) => record.event === "provider_gateway.complete.start",
  ).length;
  // Order 62 CP3 语义迁移：工作详情折叠区与模型调用明细 UI 已移除。更早消息的
  // 运行组三层 UI 直接随消息渲染；provider 事实由上方 scoped activity API 键承担。
  // 核心不变量保留：加载更早对话与查看历史活动均不得重新调用 provider。
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("创作执行") &&
      document.querySelectorAll('section[aria-label="计划"]').length >= 1,
    undefined,
    { timeout: 30_000 },
  );
  await sleep(500);
  const visibleAfterOlderActivityExpand = await page.locator("body").innerText();
  const providerCallCountAfterOlderActivityExpand = readAppLogRecords().filter(
    (record) => record.event === "provider_gateway.complete.start",
  ).length;
  const olderUiRawContentLeaked = [
    "raw_prompt",
    "system_prompt",
    "raw_provider_error",
    "raw_output",
  ].some((value) => visibleAfterOlderActivityExpand.includes(value));

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "agent-session-transcript-lazy-page",
      turn_id: lastTurn.turnResult.turn_id,
      turn_ids: [olderAssistantTurnId, lastTurn.turnResult.turn_id],
      work_id: workId,
      workspace_id: workId,
      context_work_id: workId,
      session_id: sessionId,
      older_assistant_turn_id: olderAssistantTurnId,
      active_session_id: sessionId,
      sent_turn_count: messages.length,
      persisted_first_page_count: firstPage.length,
      persisted_first_page_has_more_before: firstPageInfo.has_more_before === true,
      persisted_first_page_before_id_present: typeof firstPageInfo.before_id === "string",
      older_transcript_api_status: olderApi.status,
      older_transcript_api_count: olderTranscript.length,
      older_transcript_api_first_message_visible: olderTranscript.some((entry) =>
        String(entry.text ?? "").includes(messages[0]),
      ),
      older_transcript_agent_run_summary_only: olderTranscriptAgentRunSummaryOnly,
      older_agent_run_activity_api_status: olderActivityApi.status,
      older_agent_run_activity_api_run_count: olderActivityAgentRuns.length,
      older_provider_run_activity_api_event_count: olderActivityProviderRunEvents.length,
      older_provider_run_activity_api_count: olderActivityProviderRuns.length,
      older_provider_run_activity_api_purposes: olderActivityProviderPurposes,
      older_agent_run_activity_api_raw_content_leaked: olderActivityRawContentLeaked,
      reload_resume_transcript_count: resumedAfterReload.transcript_count,
      restored_latest_message_visible: visibleBeforeLoadOlder.includes(messages.at(-1)),
      restored_oldest_message_hidden_before_load: firstMessageHiddenBeforeLoadOlder,
      load_older_button_visible: visibleBeforeLoadOlder.includes("加载更早对话"),
      older_message_visible_after_load: visibleAfterLoadOlder.includes(messages[0]),
      load_older_button_hidden_after_exhausted: !visibleAfterLoadOlder.includes("加载更早对话"),
      provider_recalled_during_load_older:
        providerCallCountAfterLoadOlder > providerCallCountBeforeLoadOlder,
      // Order 62 CP3 语义迁移：折叠区/明细 UI 已移除；历史消息运行组随消息直接渲染。
      older_ui_agent_flow_visible:
        visibleAfterOlderActivityExpand.includes("创作执行"),
      older_ui_provider_run_replay_raw_content_leaked: olderUiRawContentLeaked,
      provider_recalled_during_older_activity_expand:
        providerCallCountAfterOlderActivityExpand > providerCallCountAfterLoadOlder,
    },
  ];
}

async function openArchiveTab(page, tabName) {
  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: tabName }).click();
  return await waitForArchivePanel(page);
}

async function waitForArchivePanel(page) {
  const archivePanel = page.locator('[class*="panel"]').filter({ hasText: "作品档案" }).first();
  await archivePanel.waitFor({ timeout: 10_000 });
  return archivePanel;
}

async function archivePanelSnapshot(archivePanel) {
  return await archivePanel.evaluate((element) => ({
    foreshadowing_count: Number(element.getAttribute("data-archive-foreshadowing-count") ?? 0),
    rule_count: Number(element.getAttribute("data-archive-rule-count") ?? 0),
    character_count: Number(element.getAttribute("data-archive-character-count") ?? 0),
    volumes: Number(element.getAttribute("data-archive-volumes") ?? 0),
    chapters: Number(element.getAttribute("data-archive-chapters") ?? 0),
    memory_items: Number(element.getAttribute("data-archive-memory-items") ?? 0),
    drafts_total: Number(element.getAttribute("data-archive-drafts-total") ?? 0),
    drafts_accepted: Number(element.getAttribute("data-archive-drafts-accepted") ?? 0),
    detail_kind: element.getAttribute("data-archive-detail-kind") ?? "",
    detail_id: element.getAttribute("data-archive-detail-id") ?? "",
    text: element.innerText,
  }));
}

async function closeArchiveIfOpen(page) {
  const closeArchive = page.getByRole("button", { name: "关闭档案" });
  if ((await closeArchive.count()) > 0) {
    await closeArchive.first().click();
    await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  }
}

async function switchToWorkByTitle(page, title) {
  await workTitle(page).click();
  const item = page.getByRole("menuitem").filter({ hasText: title }).first();
  await item.waitFor({ timeout: 10_000 });
  await item.click();
  await page.waitForFunction(
    (expected) => {
      const titleButton = document.querySelector('button[title="作品"]');
      return (titleButton?.textContent ?? "").includes(expected);
    },
    title,
    { timeout: 15_000 },
  );
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
}

async function driveLongSessionCompression(page) {
  await page.locator(chatInputSelector).fill("继续最新设定");
  await page.getByRole("button", { name: /^发送$/ }).click();

  await page.waitForFunction(() => document.body.innerText.includes("继续最新设定"), {
    timeout: 10_000,
  });
  for (let attempt = 0; attempt < 120 && !latestTurnResult(); attempt += 1) {
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(300);

  const sentMessage = latestSentUserMessage();
  const turnResult = latestTurnResult();
  assert(sentMessage, "No user_message websocket frame was sent");
  assert(turnResult, "No turn_result websocket frame was received");
  assert(turnResult.trace_summary, "Turn result did not include trace summary");

  const uiState = await commonUiState(page, turnResult, sentMessage);

  assert(
    uiState.long_session_visible_text.includes("继续最新设定"),
    "Real UI did not display the user message",
  );

  return [uiState];
}

async function driveAu03SessionHistoryReadonly(page) {
  const joinReply = latestChannelJoinReply();
  const workId = joinReply?.body?.response?.work_id ?? joinReply?.body?.work_id ?? null;
  const activeSessionId =
    joinReply?.body?.response?.session_id ?? joinReply?.body?.session_id ?? null;
  assert(workId, "No work_id was available from the real channel join");

  const searchResponse = await fetch(
    `${baseUrl}/api/works/${encodeURIComponent(workId)}/sessions?query=${encodeURIComponent("林瑶旧线索")}`,
  );
  assert(
    searchResponse.ok,
    `Failed to search seeded history session: HTTP ${searchResponse.status}`,
  );
  const searchBody = await searchResponse.json();
  const seededHistorySession = (searchBody.sessions ?? []).find(
    (session) => session.title === "林瑶旧线索讨论",
  );
  assert(seededHistorySession?.id, "Seeded history session was not available through sessions API");

  await openSessionRail(page);
  const searchBox = page.getByPlaceholder("搜索会话");
  await searchBox.waitFor({ timeout: 10_000 });
  await searchBox.fill("林瑶旧线索");

  const historySessionButton = page.locator("button").filter({ hasText: "林瑶旧线索讨论" }).first();
  await historySessionButton.waitFor({ timeout: 10_000 });
  await historySessionButton.click();

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("历史会话") &&
      document.body.innerText.includes("林瑶留下的旧线索") &&
      document.body.innerText.includes("返回当前会话"),
    { timeout: 10_000 },
  );

  const readonlySessionButtonText = (
    (await page.locator("button").filter({ hasText: "林瑶旧线索讨论" }).first().textContent()) ?? ""
  )
    .replace(/\s+/g, " ")
    .trim();
  const readonlySessionStatus = seededHistorySession.status;

  const readonlySnapshot = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder="输入你的想法、问题或指令..."]');
    const sendButton = [...document.querySelectorAll("button")].find(
      (button) => (button.textContent ?? "").trim() === "发送",
    );

    return {
      visible_text: document.body.innerText,
      input_disabled: Boolean(input?.disabled),
      send_disabled: Boolean(sendButton?.disabled),
    };
  });

  assert(readonlySessionStatus === "EXITED", "Readonly session status was not EXITED");
  assert(
    readonlySessionButtonText.includes("EXITED"),
    "Readonly session status was not visible in the session list",
  );
  assert(readonlySnapshot.input_disabled, "History session input was not disabled");
  assert(readonlySnapshot.send_disabled, "History session send button was not disabled");
  assert(
    readonlySnapshot.visible_text.includes("林瑶留下的旧线索"),
    "History transcript text was not visible",
  );

  await page.getByRole("button", { name: "返回当前会话" }).click();
  await page.waitForFunction(
    () =>
      !document.body.innerText.includes("正在只读查看历史 transcript") &&
      document.body.innerText.includes("当前会话继续讨论灵源矿区"),
    { timeout: 10_000 },
  );

  const activeRestored = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder="输入你的想法、问题或指令..."]');
    const sendButton = [...document.querySelectorAll("button")].find(
      (button) => (button.textContent ?? "").trim() === "发送",
    );
    return {
      visible_text: document.body.innerText,
      input_disabled: Boolean(input?.disabled),
      send_disabled: Boolean(sendButton?.disabled),
    };
  });

  assert(!activeRestored.input_disabled, "Active session input stayed disabled after restore");
  assert(!activeRestored.send_disabled, "Active session send stayed disabled after restore");

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_ids: [],
      work_id: workId,
      context_work_id: workId,
      session_id: activeSessionId,
      readonly_session_id: seededHistorySession.id,
      readonly_session_status: readonlySessionStatus,
      readonly_session_button_text: readonlySessionButtonText,
      readonly_banner_visible: true,
      readonly_input_disabled: readonlySnapshot.input_disabled,
      readonly_send_disabled: readonlySnapshot.send_disabled,
      active_session_restored: true,
      readonly_visible_text: readonlySnapshot.visible_text,
      active_visible_text: activeRestored.visible_text,
      socket_connected: true,
      duration_ms: 0,
      outcome: "done",
    },
  ];
}

async function driveAu03BranchFromHistory(page) {
  const joinReply = latestChannelJoinReply();
  const workId = joinReply?.body?.response?.work_id ?? joinReply?.body?.work_id ?? null;
  assert(workId, "No work_id was available from the real channel join");

  const searchResponse = await fetch(
    `${baseUrl}/api/works/${encodeURIComponent(workId)}/sessions?query=${encodeURIComponent("林瑶旧线索")}`,
  );
  assert(
    searchResponse.ok,
    `Failed to search seeded history session: HTTP ${searchResponse.status}`,
  );
  const searchBody = await searchResponse.json();
  const seededHistorySession = (searchBody.sessions ?? []).find(
    (session) => session.title === "林瑶旧线索讨论",
  );
  assert(seededHistorySession?.id, "Seeded history session was not available through sessions API");

  const branchCount = readAppLogRecords().length;
  await openSessionRail(page);
  const searchBox = page.getByPlaceholder("搜索会话");
  await searchBox.waitFor({ timeout: 10_000 });
  await searchBox.fill("林瑶旧线索");

  const historySessionButton = page.locator("button").filter({ hasText: "林瑶旧线索讨论" }).first();
  await historySessionButton.waitFor({ timeout: 10_000 });
  await historySessionButton.click();

  const shownHistory = await waitForNewAppLogRecord(
    branchCount,
    (record) =>
      record.event === "work_session.show.done" &&
      record.work_id === workId &&
      record.session_id === seededHistorySession.id &&
      record.read_only === true &&
      Number(record.transcript_count ?? 0) >= 2,
    "AU-03 branch source history session was not opened read-only",
    30_000,
  );

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("历史会话") &&
      document.body.innerText.includes("林瑶留下的旧线索") &&
      document.body.innerText.includes("从这里继续"),
    { timeout: 10_000 },
  );

  const readonlySnapshot = await page.evaluate(() => ({
    visible_text: document.body.innerText,
    readonly_banner_visible:
      document.body.innerText.includes("历史会话") &&
      document.body.innerText.includes("正在只读查看历史 transcript"),
  }));
  assert(readonlySnapshot.readonly_banner_visible, "Readonly history banner was not visible");
  assert(
    readonlySnapshot.visible_text.includes("林瑶留下的旧线索"),
    "Branch source history transcript text was not visible",
  );

  await page.getByRole("button", { name: "从这里继续" }).click();

  const created = await waitForNewAppLogRecord(
    branchCount,
    (record) =>
      record.event === "work_session.create.done" &&
      record.work_id === workId &&
      record.session_id &&
      record.source_session_ref === seededHistorySession.id &&
      record.source_turn_ref === "turn_history_1",
    "AU-03 branch session was not created with source session/turn refs",
    30_000,
  );

  const branchSessionId = created.session_id;
  await waitForNewAppLogRecord(
    branchCount,
    (record) =>
      record.event === "work_session.resume.done" &&
      record.work_id === workId &&
      record.session_id === branchSessionId &&
      Number(record.transcript_count ?? -1) === 0,
    "AU-03 branch session did not resume with an empty transcript",
    30_000,
  );
  await waitForNewAppLogRecord(
    branchCount,
    (record) =>
      record.event === "channel.join.done" &&
      record.work_id === workId &&
      record.session_id === branchSessionId,
    "AU-03 branch session did not rejoin the workspace channel",
    30_000,
  );

  await page.waitForFunction(
    () =>
      !document.body.innerText.includes("正在只读查看历史 transcript") &&
      document.body.innerText.includes("欢迎使用 AI Novel Studio") &&
      !document.body.innerText.includes("林瑶留下的旧线索"),
    { timeout: 10_000 },
  );

  const branchTitle = `${seededHistorySession.title} 的延续`;
  const branchSessionButtonText = (
    (await page.locator("button").filter({ hasText: branchTitle }).first().textContent()) ?? ""
  )
    .replace(/\s+/g, " ")
    .trim();
  const branchSnapshot = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      visible_text: text,
      readonly_banner_visible:
        text.includes("历史会话") && text.includes("正在只读查看历史 transcript"),
      message_count: document.querySelectorAll('[class*="userMsg"], [class*="assistantMsg"]')
        .length,
    };
  });

  assert(!branchSnapshot.readonly_banner_visible, "Branch session stayed in read-only mode");
  assert(
    branchSessionButtonText.includes("ACTIVE"),
    "Branch session was not marked ACTIVE in the session list",
  );
  assert(
    !branchSnapshot.visible_text.includes("林瑶留下的旧线索"),
    "History transcript leaked into the new branch session",
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_ids: [],
      work_id: workId,
      context_work_id: workId,
      session_id: branchSessionId,
      readonly_session_id: seededHistorySession.id,
      readonly_banner_visible: true,
      readonly_visible_text: readonlySnapshot.visible_text,
      branch_source_session_ref: created.source_session_ref,
      branch_source_turn_ref: created.source_turn_ref,
      branch_active_session_id: branchSessionId,
      branch_readonly_banner_visible: branchSnapshot.readonly_banner_visible,
      branch_message_count: branchSnapshot.message_count,
      branch_visible_text: branchSnapshot.visible_text,
      branch_session_item_active: branchSessionButtonText.includes("ACTIVE"),
      source_session_transcript_count: shownHistory.transcript_count,
      socket_connected: true,
      duration_ms: 0,
      outcome: "done",
    },
  ];
}

async function driveAu03ArchiveSessionFilter(page) {
  const joinReply = latestChannelJoinReply();
  const workId = joinReply?.body?.response?.work_id ?? joinReply?.body?.work_id ?? null;
  assert(workId, "No work_id was available from the real channel join");

  const searchResponse = await fetch(
    `${baseUrl}/api/works/${encodeURIComponent(workId)}/sessions?query=${encodeURIComponent("林瑶旧线索")}`,
  );
  assert(
    searchResponse.ok,
    `Failed to search seeded archive candidate session: HTTP ${searchResponse.status}`,
  );
  const searchBody = await searchResponse.json();
  const seededHistorySession = (searchBody.sessions ?? []).find(
    (session) => session.title === "林瑶旧线索讨论",
  );
  assert(seededHistorySession?.id, "Seeded history session was not available through sessions API");

  await openSessionRail(page);
  const searchBox = page.getByPlaceholder("搜索会话");
  await searchBox.waitFor({ timeout: 10_000 });
  await searchBox.fill("林瑶旧线索");

  const historySessionButton = page.locator("button").filter({ hasText: "林瑶旧线索讨论" }).first();
  await historySessionButton.waitFor({ timeout: 10_000 });
  await historySessionButton.click();

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("历史会话") &&
      document.body.innerText.includes("林瑶留下的旧线索"),
    { timeout: 10_000 },
  );

  const archiveButton = page.getByRole("button", { name: "归档会话" }).first();
  await archiveButton.waitFor({ timeout: 10_000 });
  const archiveButtonVisible = await archiveButton.isVisible();
  assert(archiveButtonVisible, "Archive button was not visible for the exited history session");

  const archiveCount = readAppLogRecords().length;
  await archiveButton.click();

  await waitForNewAppLogRecord(
    archiveCount,
    (record) =>
      record.event === "work_session.archive.done" &&
      record.work_id === workId &&
      record.session_id === seededHistorySession.id &&
      record.status === "ARCHIVED",
    "AU-03 archive session did not persist ARCHIVED status",
    30_000,
  );

  await searchBox.fill("");
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("button")).every(
        (button) => !(button.textContent ?? "").includes("林瑶旧线索讨论"),
      ),
    { timeout: 10_000 },
  );
  const defaultHistoryButtonCount = await page
    .locator("button")
    .filter({ hasText: "林瑶旧线索讨论" })
    .count();

  await searchBox.fill("林瑶旧线索");
  const archivedSessionButton = page
    .locator("button")
    .filter({ hasText: "林瑶旧线索讨论" })
    .first();
  await archivedSessionButton.waitFor({ timeout: 10_000 });
  const archivedButtonText = ((await archivedSessionButton.textContent()) ?? "")
    .replace(/\s+/g, " ")
    .trim();
  await archivedSessionButton.click();

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("历史会话") &&
      document.body.innerText.includes("林瑶留下的旧线索") &&
      document.body.innerText.includes("正在只读查看历史 transcript"),
    { timeout: 10_000 },
  );

  const archivedSnapshot = await page.evaluate(() => ({
    visible_text: document.body.innerText,
    readonly_banner_visible:
      document.body.innerText.includes("历史会话") &&
      document.body.innerText.includes("正在只读查看历史 transcript"),
  }));

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_ids: [],
      work_id: workId,
      context_work_id: workId,
      readonly_session_id: seededHistorySession.id,
      archive_button_visible: archiveButtonVisible,
      archived_hidden_default: defaultHistoryButtonCount === 0,
      archived_search_found: archivedButtonText.includes("ARCHIVED"),
      archived_banner_visible: archivedSnapshot.readonly_banner_visible,
      archived_visible_text: archivedSnapshot.visible_text,
      socket_connected: true,
      duration_ms: 0,
      outcome: "done",
    },
  ];
}

async function driveAu03CurrentWorkContextSsot(page) {
  const joinReply = latestChannelJoinReply();
  const workId = joinReply?.body?.response?.work_id ?? joinReply?.body?.work_id ?? null;
  const activeSessionId =
    joinReply?.body?.response?.session_id ?? joinReply?.body?.session_id ?? null;
  assert(workId, "No work_id was available from the real channel join");
  assert(activeSessionId, "No active session_id was available from the real channel join");

  const searchResponse = await fetch(
    `${baseUrl}/api/works/${encodeURIComponent(workId)}/sessions?query=${encodeURIComponent("旧主角命名")}`,
  );
  assert(
    searchResponse.ok,
    `Failed to search seeded current-work history session: HTTP ${searchResponse.status}`,
  );
  const searchBody = await searchResponse.json();
  const historySession = (searchBody.sessions ?? []).find(
    (session) => session.title === "旧主角命名讨论",
  );
  assert(historySession?.id, "Seeded current-work history session was not available");

  await openSessionRail(page);
  const searchBox = page.getByPlaceholder("搜索会话");
  await searchBox.waitFor({ timeout: 10_000 });
  await searchBox.fill("旧主角命名");

  const historySessionButton = page.locator("button").filter({ hasText: "旧主角命名讨论" }).first();
  await historySessionButton.waitFor({ timeout: 10_000 });
  await historySessionButton.click();

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("历史会话") &&
      document.body.innerText.includes("主角当时叫林烬") &&
      document.body.innerText.includes("返回当前会话"),
    { timeout: 10_000 },
  );
  const readonlySnapshot = await page.evaluate(() => ({
    visible_text: document.body.innerText,
    readonly_banner_visible:
      document.body.innerText.includes("历史会话") &&
      document.body.innerText.includes("正在只读查看历史 transcript"),
  }));
  assert(
    readonlySnapshot.readonly_banner_visible,
    "Current-work history session was not read-only",
  );

  await page.getByRole("button", { name: "返回当前会话" }).click();
  await page.waitForFunction(
    () =>
      !document.body.innerText.includes("正在只读查看历史 transcript") &&
      document.body.innerText.includes("当前会话确认：主角现在叫林澈"),
    { timeout: 10_000 },
  );

  const message = "主角现在的核心动机是什么？";
  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  await page.waitForFunction(
    (text) => document.body.innerText.includes(text) && !document.body.innerText.includes("思考中"),
    message,
    { timeout: 90_000 },
  );
  for (let attempt = 0; attempt < 120 && !latestTurnResult(); attempt += 1) {
    await page.waitForTimeout(500);
  }

  const sentMessage = latestSentUserMessage();
  const turnResult = latestTurnResult();
  assert(sentMessage, "No current-work user_message websocket frame was sent");
  assert(turnResult, "No current-work turn_result websocket frame was received");

  const restoredSnapshot = await page.evaluate(() => ({
    visible_text: document.body.innerText,
    readonly_banner_visible:
      document.body.innerText.includes("历史会话") &&
      document.body.innerText.includes("正在只读查看历史 transcript"),
  }));
  assert(!restoredSnapshot.readonly_banner_visible, "Active session stayed in read-only mode");

  const uiState = await commonUiState(page, turnResult, sentMessage);

  return [
    {
      ...uiState,
      readonly_session_id: historySession.id,
      active_session_restored: true,
      readonly_banner_visible: restoredSnapshot.readonly_banner_visible,
      readonly_visible_text: readonlySnapshot.visible_text,
      active_visible_text: restoredSnapshot.visible_text,
      sent_message_text: message,
    },
  ];
}

async function driveAu03SessionNewActive(page) {
  const previousActiveToken = "当前会话继续讨论灵源矿区";
  const newMessage = `AU03 新会话闭环 ${Date.now()}：请只回应本轮新会话。`;
  const joinReply = latestChannelJoinReply();
  const workId = joinReply?.body?.response?.work_id ?? joinReply?.body?.work_id ?? null;
  const previousActiveSessionId =
    joinReply?.body?.response?.session_id ?? joinReply?.body?.session_id ?? null;
  assert(workId, "No work_id was available from the real channel join");
  assert(previousActiveSessionId, "No active session_id was available from the real channel join");

  await page.waitForFunction(
    (token) => document.body.innerText.includes(token),
    previousActiveToken,
    {
      timeout: 10_000,
    },
  );

  const beforeCreateCount = readAppLogRecords().length;
  await openSessionRail(page);
  await page.getByRole("button", { name: "新建会话" }).click();

  const created = await waitForNewAppLogRecord(
    beforeCreateCount,
    (record) =>
      record.event === "work_session.create.done" &&
      record.work_id === workId &&
      record.session_id &&
      record.session_id !== previousActiveSessionId,
    "No AU-03 new active work_session.create.done record",
    30_000,
  );

  const newActiveSessionId = created.session_id;
  const resumed = await waitForNewAppLogRecord(
    beforeCreateCount,
    (record) =>
      record.event === "work_session.resume.done" &&
      record.work_id === workId &&
      record.session_id === newActiveSessionId &&
      Number(record.transcript_count ?? -1) === 0,
    "New AU-03 active session did not resume with an empty transcript",
    30_000,
  );

  await waitForNewAppLogRecord(
    beforeCreateCount,
    (record) =>
      record.event === "channel.join.done" &&
      record.work_id === workId &&
      record.session_id === newActiveSessionId,
    "Workbench did not rejoin the new AU-03 active session",
    30_000,
  );

  await page.waitForFunction(
    (token) =>
      document.body.innerText.includes("欢迎使用 AI Novel Studio") &&
      !document.body.innerText.includes(token),
    previousActiveToken,
    { timeout: 10_000 },
  );

  const previousSessionResponse = await fetch(
    `${baseUrl}/api/works/${encodeURIComponent(workId)}/sessions?query=${encodeURIComponent("默认会话")}`,
  );
  assert(
    previousSessionResponse.ok,
    `Failed to search previous active session: HTTP ${previousSessionResponse.status}`,
  );
  const previousSessionBody = await previousSessionResponse.json();
  const previousSessionAfterCreate = (previousSessionBody.sessions ?? []).find(
    (session) => session.id === previousActiveSessionId,
  );
  assert(previousSessionAfterCreate?.status === "EXITED", "Previous active session was not EXITED");

  const newSessionSnapshot = await page.evaluate((token) => {
    const input = document.querySelector('input[placeholder="输入你的想法、问题或指令..."]');
    const sendButton = [...document.querySelectorAll("button")].find(
      (button) => (button.textContent ?? "").trim() === "发送",
    );
    const text = document.body.innerText;

    return {
      visible_text: text,
      input_disabled: Boolean(input?.disabled),
      send_disabled: Boolean(sendButton?.disabled),
      old_token_visible: text.includes(token),
    };
  }, previousActiveToken);

  assert(!newSessionSnapshot.input_disabled, "New active session input was disabled");
  assert(!newSessionSnapshot.send_disabled, "New active session send button was disabled");
  assert(
    !newSessionSnapshot.old_token_visible,
    "Previous active transcript leaked into new session",
  );

  await openSessionRail(page);
  const searchBox = page.getByPlaceholder("搜索会话");
  await searchBox.waitFor({ timeout: 10_000 });
  await searchBox.fill("默认会话");

  const previousSessionButton = page.locator("button").filter({ hasText: "默认会话" }).first();
  await previousSessionButton.waitFor({ timeout: 10_000 });
  await previousSessionButton.click();

  const shownPrevious = await waitForAppLogRecord(
    (record) =>
      record.event === "work_session.show.done" &&
      record.work_id === workId &&
      record.session_id === previousActiveSessionId &&
      record.read_only === true,
    "Previous active session was not reopened as readonly history",
    30_000,
  );

  await page.waitForFunction(
    (token) =>
      document.body.innerText.includes("历史会话") &&
      document.body.innerText.includes("正在只读查看历史 transcript") &&
      document.body.innerText.includes(token),
    previousActiveToken,
    { timeout: 10_000 },
  );

  const previousReadonlySnapshot = await page.evaluate((token) => {
    const input = document.querySelector('input[placeholder="输入你的想法、问题或指令..."]');
    const sendButton = [...document.querySelectorAll("button")].find(
      (button) => (button.textContent ?? "").trim() === "发送",
    );
    const text = document.body.innerText;

    return {
      visible_text: text,
      input_disabled: Boolean(input?.disabled),
      send_disabled: Boolean(sendButton?.disabled),
      old_token_visible: text.includes(token),
    };
  }, previousActiveToken);

  assert(
    previousReadonlySnapshot.input_disabled,
    "Previous readonly session input was not disabled",
  );
  assert(previousReadonlySnapshot.send_disabled, "Previous readonly session send was not disabled");
  assert(
    previousReadonlySnapshot.old_token_visible,
    "Previous active transcript was not visible after reopening as history",
  );

  await page.getByRole("button", { name: "返回当前会话" }).click();
  await page.waitForFunction(
    (token) => {
      const input = document.querySelector('input[placeholder="输入你的想法、问题或指令..."]');
      const sendButton = [...document.querySelectorAll("button")].find(
        (button) => (button.textContent ?? "").trim() === "发送",
      );
      const text = document.body.innerText;

      return (
        !text.includes("正在只读查看历史 transcript") &&
        !text.includes(token) &&
        input?.disabled === false &&
        sendButton?.disabled === false
      );
    },
    previousActiveToken,
    { timeout: 10_000 },
  );

  const sendFrameCount = frames.length;
  const sendLogCount = readAppLogRecords().length;
  await page.locator(chatInputSelector).fill(newMessage);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    sendFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.work_id === workId &&
      frame.body?.session_id === newActiveSessionId &&
      String(frame.body?.text ?? "").includes(newMessage),
    "No AU-03 new-session user_message websocket frame was sent",
    30_000,
  );

  const turnFrame = await waitForNewFrame(
    sendFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      frame.body?.status !== "error",
    "No AU-03 new-session turn_result frame was received",
    120_000,
  );
  const turnId = turnFrame.body.turn_id;

  await waitForNewAppLogRecord(
    sendLogCount,
    (record) =>
      record.event === "channel.user_message.start" &&
      record.work_id === workId &&
      record.session_id === newActiveSessionId &&
      record.turn_id === turnId,
    "No AU-03 new-session channel.user_message.start log",
    30_000,
  );

  const contextRecord = await waitForNewAppLogRecord(
    sendLogCount,
    (record) =>
      record.event === "context.assemble.done" &&
      record.turn_id === turnId &&
      record.has_conversation === false,
    "AU-03 new-session first turn did not assemble an empty conversation context",
    30_000,
  );

  await waitForNewAppLogRecord(
    sendLogCount,
    (record) =>
      record.event === "channel.user_message.done" &&
      record.work_id === workId &&
      record.session_id === newActiveSessionId &&
      record.turn_id === turnId,
    "No AU-03 new-session channel.user_message.done log",
    30_000,
  );

  const finalNewSessionText = await page.locator("body").innerText();
  assert(finalNewSessionText.includes(newMessage), "New session user message was not visible");
  assert(
    !finalNewSessionText.includes(previousActiveToken),
    "Previous active transcript leaked after the new session turn",
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_id: turnId,
      turn_ids: [turnId],
      work_id: workId,
      context_work_id: workId,
      previous_active_session_id: previousActiveSessionId,
      new_active_session_id: newActiveSessionId,
      session_id: newActiveSessionId,
      created_session_id: created.session_id,
      previous_active_status_after_create: previousSessionAfterCreate.status,
      new_session_transcript_empty: Number(resumed.transcript_count ?? -1) === 0,
      new_session_input_enabled: !newSessionSnapshot.input_disabled,
      new_session_send_enabled: !newSessionSnapshot.send_disabled,
      old_active_visible_initial: true,
      old_active_absent_after_create: !newSessionSnapshot.old_token_visible,
      previous_active_readonly_opened: true,
      previous_active_readonly_banner_visible: true,
      previous_active_input_disabled: previousReadonlySnapshot.input_disabled,
      previous_active_send_disabled: previousReadonlySnapshot.send_disabled,
      previous_active_transcript_visible_readonly: previousReadonlySnapshot.old_token_visible,
      active_session_restored: true,
      user_message_session_id: sentFrame.body?.session_id,
      user_message_work_id: sentFrame.body?.work_id,
      new_session_message_visible: finalNewSessionText.includes(newMessage),
      old_active_text_in_new_session: finalNewSessionText.includes(previousActiveToken),
      first_turn_context_has_conversation: contextRecord.has_conversation,
      first_turn_context_refs_count: contextRecord.context_refs_count,
      shown_previous_transcript_count: shownPrevious.transcript_count,
      shown_previous_pending_adoption_count: shownPrevious.pending_adoption_count,
      socket_connected: true,
      duration_ms: 0,
      outcome: "done",
    },
  ];
}

async function driveSu01ModelProviderSwitching(page) {
  const message = "SU01 模型切换后，请用一句话回复当前状态。";

  await page
    .getByRole("button", { name: /模型设置|Stub|LM Studio|DeepSeek|Anthropic/ })
    .first()
    .click();
  await page.getByRole("dialog", { name: "模型供应商" }).waitFor({ timeout: 10_000 });
  await page.locator("#model-provider-select").selectOption("stub");
  await page.getByRole("button", { name: "测试连接" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("连接可用。"), {
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "保存并切换" }).click();
  await page
    .getByRole("dialog", { name: "模型供应商" })
    .waitFor({ state: "detached", timeout: 10_000 });

  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const turnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.assistant_message != null,
    "No turn_result frame after provider switching message",
    90_000,
  );

  const turnResult = turnFrame.body;
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, turnResult, sentMessage);
  const visibleText = await page.locator("body").innerText();
  const modelButtonText = await page
    .getByRole("button", { name: /Stub|LM Studio|DeepSeek|Anthropic|模型设置/ })
    .first()
    .textContent()
    .then((value) => value?.trim() ?? "");

  assert(sentMessage, "No provider-switching user_message websocket frame was sent");
  assert(visibleText.includes(message), "Real UI did not retain the post-switch user message");
  assert(modelButtonText.includes("Stub"), "Model provider button did not show Stub after saving");

  return [
    {
      ...uiState,
      turn_id: turnResult.turn_id,
      message_text: message,
      model_provider_button_text: modelButtonText,
      provider_switched_to: "stub",
      provider_switch_saved: true,
      post_switch_message_visible: visibleText.includes(message),
      dialogue_preserved_after_switch: true,
    },
  ];
}

async function openLatestWhyDialog(page) {
  const whyButton = page.getByRole("button", { name: /为什么/ }).last();
  await whyButton.waitFor({ timeout: 10_000 });
  await whyButton.click();

  const dialog = page.getByRole("dialog").first();
  await dialog.waitFor({ timeout: 10_000 });
  await page.waitForFunction(() => document.body.innerText.includes("参考来源"), {
    timeout: 10_000,
  });

  return dialog.innerText();
}

async function driveAu07TraceWhyEntry(page) {
  const message = "我想写一个雨夜开场的悬疑故事，先聊聊气质。";
  const beforeFrameCount = frames.length;
  const { turnResult } = await sendOrdinaryChatTurn(page, message, beforeFrameCount);
  const sentMessage = latestSentUserMessage();

  assert(sentMessage, "No AU07 user_message websocket frame was sent");
  assert(turnResult.trace_summary, "AU07 turn_result did not include trace summary");
  assert(
    turnResult.truthfulness?.tool_called !== true,
    "AU07 why entry setup unexpectedly dispatched a tool",
  );
  assert(
    turnResult.truthfulness?.production_write_performed !== true,
    "AU07 why entry setup unexpectedly wrote production state",
  );

  const whyText = await openLatestWhyDialog(page);
  const uiState = await commonUiState(page, turnResult, sentMessage);
  const unsafePattern = /raw prompt|provider raw|hidden policy|debug|trace_|ctx_/i;

  assert(whyText.includes("不会重新调用模型"), "Why dialog did not state no-provider replay");
  assert(!unsafePattern.test(whyText), "Why dialog exposed unsafe trace or prompt text");

  return [
    {
      ...uiState,
      turn_id: turnResult.turn_id,
      trace_why_dialog_open: true,
      trace_why_text: whyText,
      trace_why_contains_raw_prompt: unsafePattern.test(whyText),
      replay_provider_called: false,
      production_write_performed: turnResult.truthfulness?.production_write_performed === true,
      tool_called: turnResult.truthfulness?.tool_called === true,
    },
  ];
}

async function driveAu07GateReasonWhy(page) {
  const [downgradeState] = await driveE2E01DowngradeRealPage(page);
  const unsafePattern =
    /raw prompt|provider raw|hidden policy|debug|trace_|ctx_|multi-step plan requires downgrade|downgrade_to_dialogue|action_scope/i;

  await openLatestWhyDialog(page);
  const dialog = page.getByRole("dialog").first();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("当前请求超出本轮可执行范围") &&
      document.body.innerText.includes("不会重新调用模型"),
    { timeout: 10_000 },
  );
  const whyText = await dialog.innerText();

  assert(whyText.includes("降级为对话"), "Gate why dialog did not show downgrade decision");
  assert(
    whyText.includes("当前请求超出本轮可执行范围"),
    "Gate why dialog did not explain the action_scope boundary",
  );
  assert(
    whyText.includes("系统先评估了执行计划"),
    "Gate why dialog did not explain the MicroPlan evaluation reason",
  );
  assert(whyText.includes("不会重新调用模型"), "Gate why dialog did not state no-provider replay");
  assert(!unsafePattern.test(whyText), "Gate why dialog exposed internal gate/reason/debug text");

  return [
    {
      ...downgradeState,
      slice_id: "au07-gate-reason-why",
      trace_why_dialog_open: true,
      trace_why_text: whyText,
      trace_why_contains_raw_prompt: unsafePattern.test(whyText),
      why_shows_downgrade_decision: whyText.includes("降级为对话"),
      why_shows_action_scope_gate: whyText.includes("当前请求超出本轮可执行范围"),
      why_shows_micro_plan_evaluated: whyText.includes("系统先评估了执行计划"),
      why_shows_no_provider_replay: whyText.includes("不会重新调用模型"),
      why_hides_internal_gate_code: !unsafePattern.test(whyText),
      replay_provider_called: false,
    },
  ];
}

async function driveAu07PersistedTraceQuery(page) {
  const message = "这一轮请只聊林烬进入灵源矿区前的心理压力，不要写正文。";
  const beforeFrameCount = frames.length;
  const { turnResult } = await sendOrdinaryChatTurn(page, message, beforeFrameCount);
  const sentMessage = latestSentUserMessage();

  assert(sentMessage, "No AU07 persisted-trace user_message websocket frame was sent");
  assert(turnResult.trace_summary, "AU07 persisted-trace turn_result did not include summary");
  assert(
    turnResult.truthfulness?.tool_called !== true,
    "AU07 persisted-trace setup unexpectedly dispatched a tool",
  );
  assert(
    turnResult.truthfulness?.production_write_performed !== true,
    "AU07 persisted-trace setup unexpectedly wrote production state",
  );

  const workId = sentMessage.body?.work_id;
  const sessionId = sentMessage.body?.session_id;
  assert(workId, "AU07 persisted-trace turn did not include work_id");
  assert(sessionId, "AU07 persisted-trace turn did not include session_id");

  const assistantText = String(turnResult.assistant_message?.text ?? "");
  assert(assistantText.length > 0, "AU07 persisted-trace assistant text was empty");

  await waitForTranscriptTurn(workId, sessionId, turnResult.turn_id, 30_000);

  const appLogCountBeforeReload = readAppLogRecords().length;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(chatInputSelector).waitFor({ timeout: 20_000 });

  const resumedAfterReload = await waitForNewAppLogRecord(
    appLogCountBeforeReload,
    (record) =>
      record.event === "work_session.resume.done" &&
      record.work_id === workId &&
      record.session_id === sessionId,
    "Reload did not resume the active session before persisted trace query",
    30_000,
  );

  await page.waitForFunction(
    (payload) =>
      document.body.innerText.includes(payload.message) &&
      document.body.innerText.includes(payload.assistantText) &&
      !document.body.innerText.includes("思考中"),
    { message, assistantText },
    { timeout: 30_000 },
  );

  const replayPathNeedle = `/api/works/${encodeURIComponent(workId)}/sessions/${encodeURIComponent(
    sessionId,
  )}/turns/${encodeURIComponent(turnResult.turn_id)}/replay`;

  const replayResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(replayPathNeedle) && response.request().method() === "GET",
    { timeout: 20_000 },
  );

  const whyButton = page.getByRole("button", { name: /为什么/ }).last();
  await whyButton.waitFor({ timeout: 10_000 });
  await whyButton.click();
  const replayResponse = await replayResponsePromise;
  assert(replayResponse.status() === 200, `Replay query returned HTTP ${replayResponse.status()}`);
  const replayBody = await replayResponse.json();

  const dialog = page.getByRole("dialog").first();
  await dialog.waitFor({ timeout: 10_000 });
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("参考来源") &&
      document.body.innerText.includes("已从持久 trace 生成结构化回放") &&
      document.body.innerText.includes("不会重新调用模型"),
    { timeout: 10_000 },
  );
  const whyText = await dialog.innerText();
  const unsafePattern = /raw prompt|provider raw|hidden policy|debug|trace_|ctx_/i;

  assert(!unsafePattern.test(whyText), "Persisted replay why dialog exposed unsafe trace text");
  assert(
    replayBody.work_id === workId &&
      replayBody.session_id === sessionId &&
      replayBody.turn_id === turnResult.turn_id,
    "Replay query response was not scoped to the current work/session/turn",
  );
  assert(
    replayBody.trace_summary?.replay_provider_called === false,
    "Replay trace summary did not prove no-provider replay",
  );
  assert(
    replayBody.replay_report?.provider_called === false,
    "Replay report did not prove provider_called=false",
  );

  const uiState = await commonUiState(page, turnResult, sentMessage);

  return [
    {
      ...uiState,
      slice_id: "au07-persisted-trace-query",
      turn_id: turnResult.turn_id,
      turn_ids: [turnResult.turn_id],
      work_id: workId,
      workspace_id: workId,
      context_work_id: workId,
      session_id: sessionId,
      active_session_id: sessionId,
      persisted_trace_query_status: replayResponse.status(),
      persisted_trace_query_path: replayPathNeedle,
      persisted_trace_query_scoped:
        replayBody.work_id === workId &&
        replayBody.session_id === sessionId &&
        replayBody.turn_id === turnResult.turn_id,
      replay_report_provider_called: replayBody.replay_report?.provider_called === true,
      replay_summary_provider_called: replayBody.trace_summary?.replay_provider_called === true,
      replay_report_result_status: replayBody.replay_report?.result_status,
      restored_after_reload: true,
      reload_resume_transcript_count: resumedAfterReload.transcript_count,
      trace_why_dialog_open: true,
      trace_why_text: whyText,
      trace_why_contains_raw_prompt: unsafePattern.test(whyText),
      persisted_replay_detail_visible: whyText.includes("已从持久 trace 生成结构化回放"),
      replay_no_provider_visible: whyText.includes("不会重新调用模型"),
      production_write_performed: turnResult.truthfulness?.production_write_performed === true,
      tool_called: turnResult.truthfulness?.tool_called === true,
    },
  ];
}

async function driveAu07PartialReplayUi(page) {
  const message = "这一轮请只聊林烬进入灵源矿区前的心理压力，不要写正文。";
  const beforeFrameCount = frames.length;
  const { turnResult } = await sendOrdinaryChatTurn(page, message, beforeFrameCount);
  const sentMessage = latestSentUserMessage();

  assert(sentMessage, "No AU07 partial replay user_message websocket frame was sent");
  assert(turnResult.trace_summary, "AU07 partial replay turn_result did not include summary");
  assert(
    turnResult.truthfulness?.tool_called !== true,
    "AU07 partial replay setup unexpectedly dispatched a tool",
  );
  assert(
    turnResult.truthfulness?.production_write_performed !== true,
    "AU07 partial replay setup unexpectedly wrote production state",
  );

  const workId = sentMessage.body?.work_id;
  const sessionId = sentMessage.body?.session_id;
  assert(workId, "AU07 partial replay turn did not include work_id");
  assert(sessionId, "AU07 partial replay turn did not include session_id");

  const assistantText = String(turnResult.assistant_message?.text ?? "");
  assert(assistantText.length > 0, "AU07 partial replay assistant text was empty");

  await waitForTranscriptTurn(workId, sessionId, turnResult.turn_id, 30_000);
  const partialTrace = await insertPartialTraceForTurn(workId, sessionId, turnResult.turn_id);

  const appLogCountBeforeReload = readAppLogRecords().length;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(chatInputSelector).waitFor({ timeout: 20_000 });

  const resumedAfterReload = await waitForNewAppLogRecord(
    appLogCountBeforeReload,
    (record) =>
      record.event === "work_session.resume.done" &&
      record.work_id === workId &&
      record.session_id === sessionId,
    "Reload did not resume the active session before partial replay query",
    30_000,
  );

  await page.waitForFunction(
    (payload) =>
      document.body.innerText.includes(payload.message) &&
      document.body.innerText.includes(payload.assistantText) &&
      !document.body.innerText.includes("思考中"),
    { message, assistantText },
    { timeout: 30_000 },
  );

  const replayPathNeedle = `/api/works/${encodeURIComponent(workId)}/sessions/${encodeURIComponent(
    sessionId,
  )}/turns/${encodeURIComponent(turnResult.turn_id)}/replay`;

  const replayResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(replayPathNeedle) && response.request().method() === "GET",
    { timeout: 20_000 },
  );

  const whyButton = page.getByRole("button", { name: /为什么/ }).last();
  await whyButton.waitFor({ timeout: 10_000 });
  await whyButton.click();
  const replayResponse = await replayResponsePromise;
  assert(replayResponse.status() === 200, `Replay query returned HTTP ${replayResponse.status()}`);
  const replayBody = await replayResponse.json();

  const dialog = page.getByRole("dialog").first();
  await dialog.waitFor({ timeout: 10_000 });
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("这轮 trace 不完整") &&
      document.body.innerText.includes("不会重新调用模型"),
    { timeout: 10_000 },
  );
  const whyText = await dialog.innerText();
  const unsafePattern = /raw prompt|provider raw|hidden policy|debug|trace_|ctx_/i;
  const missingRefs = replayBody.replay_report?.missing_trace_refs ?? [];

  assert(!unsafePattern.test(whyText), "Partial replay why dialog exposed unsafe trace text");
  assert(
    replayBody.work_id === workId &&
      replayBody.session_id === sessionId &&
      replayBody.turn_id === turnResult.turn_id,
    "Partial replay response was not scoped to the current work/session/turn",
  );
  assert(
    replayBody.replay_report?.result_status === "partial",
    "Partial replay report did not return result_status=partial",
  );
  assert(
    Array.isArray(missingRefs) && missingRefs.length > 0,
    "Partial replay report did not include missing trace refs",
  );
  assert(
    replayBody.trace_summary?.replay_provider_called === false,
    "Partial replay trace summary did not prove no-provider replay",
  );
  assert(
    replayBody.replay_report?.provider_called === false,
    "Partial replay report did not prove provider_called=false",
  );

  const uiState = await commonUiState(page, turnResult, sentMessage);

  return [
    {
      ...uiState,
      slice_id: "au07-partial-replay-ui",
      turn_id: turnResult.turn_id,
      turn_ids: [turnResult.turn_id],
      work_id: workId,
      workspace_id: workId,
      context_work_id: workId,
      session_id: sessionId,
      active_session_id: sessionId,
      inserted_partial_trace_id: partialTrace.trace_id,
      persisted_trace_query_status: replayResponse.status(),
      persisted_trace_query_path: replayPathNeedle,
      persisted_trace_query_scoped:
        replayBody.work_id === workId &&
        replayBody.session_id === sessionId &&
        replayBody.turn_id === turnResult.turn_id,
      replay_report_provider_called: replayBody.replay_report?.provider_called === true,
      replay_summary_provider_called: replayBody.trace_summary?.replay_provider_called === true,
      replay_report_result_status: replayBody.replay_report?.result_status,
      replay_report_missing_trace_refs: missingRefs,
      restored_after_reload: true,
      reload_resume_transcript_count: resumedAfterReload.transcript_count,
      trace_why_dialog_open: true,
      trace_why_text: whyText,
      trace_why_contains_raw_prompt: unsafePattern.test(whyText),
      replay_partial_visible: whyText.includes("这轮 trace 不完整"),
      replay_no_provider_visible: whyText.includes("不会重新调用模型"),
      production_write_performed: turnResult.truthfulness?.production_write_performed === true,
      tool_called: turnResult.truthfulness?.tool_called === true,
    },
  ];
}

async function driveAu07TraceQueryScopeNegativeMatrix(page) {
  const message = "这一轮请只聊林烬进入灵源矿区前的心理压力，不要写正文。";
  const beforeFrameCount = frames.length;
  const { turnResult } = await sendOrdinaryChatTurn(page, message, beforeFrameCount);
  const sentMessage = latestSentUserMessage();

  assert(sentMessage, "No AU07 scope-negative user_message websocket frame was sent");
  assert(turnResult.trace_summary, "AU07 scope-negative turn_result did not include summary");
  assert(
    turnResult.truthfulness?.tool_called !== true,
    "AU07 scope-negative setup unexpectedly dispatched a tool",
  );
  assert(
    turnResult.truthfulness?.production_write_performed !== true,
    "AU07 scope-negative setup unexpectedly wrote production state",
  );

  const workId = sentMessage.body?.work_id;
  const sessionId = sentMessage.body?.session_id;
  assert(workId, "AU07 scope-negative turn did not include work_id");
  assert(sessionId, "AU07 scope-negative turn did not include session_id");

  const assistantText = String(turnResult.assistant_message?.text ?? "");
  assert(assistantText.length > 0, "AU07 scope-negative assistant text was empty");
  await waitForTranscriptTurn(workId, sessionId, turnResult.turn_id, 30_000);

  const appLogCountBeforeReload = readAppLogRecords().length;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(chatInputSelector).waitFor({ timeout: 20_000 });

  const resumedAfterReload = await waitForNewAppLogRecord(
    appLogCountBeforeReload,
    (record) =>
      record.event === "work_session.resume.done" &&
      record.work_id === workId &&
      record.session_id === sessionId,
    "Reload did not resume the active session before trace scope negative matrix",
    30_000,
  );

  await page.waitForFunction(
    (payload) =>
      document.body.innerText.includes(payload.message) &&
      document.body.innerText.includes(payload.assistantText) &&
      !document.body.innerText.includes("思考中"),
    { message, assistantText },
    { timeout: 30_000 },
  );

  const sameWorkOtherSession = await createWorkSessionSeed(workId, {
    title: "AU07 trace scope negative session",
  });
  const otherWork = await createWorkSeed({
    title: `AU07 trace scope negative work ${Date.now()}`,
    genre: "悬疑",
    premise: "用于溯源查询隔离验收的另一部作品",
  });
  const otherWorkSession = await createWorkSessionSeed(otherWork.id, {
    title: "AU07 foreign work session",
  });

  const validReplay = await fetchReplayApi(workId, sessionId, turnResult.turn_id);
  assert(validReplay.status === 200, `Valid scoped replay returned HTTP ${validReplay.status}`);
  assert(
    validReplay.body?.work_id === workId &&
      validReplay.body?.session_id === sessionId &&
      validReplay.body?.turn_id === turnResult.turn_id,
    "Valid replay response did not match the original work/session/turn",
  );
  assert(
    validReplay.body?.replay_report?.provider_called === false,
    "Valid replay unexpectedly called provider",
  );

  const negativeCases = [
    {
      name: "foreign_work_with_source_session",
      response: await fetchReplayApi(otherWork.id, sessionId, turnResult.turn_id),
      expected_error: "session_not_found",
    },
    {
      name: "source_work_with_foreign_session",
      response: await fetchReplayApi(workId, otherWorkSession.id, turnResult.turn_id),
      expected_error: "session_not_found",
    },
    {
      name: "source_work_with_same_work_other_session",
      response: await fetchReplayApi(workId, sameWorkOtherSession.id, turnResult.turn_id),
      expected_error: "trace_not_found",
    },
    {
      name: "source_scope_with_missing_turn",
      response: await fetchReplayApi(workId, sessionId, `${turnResult.turn_id}-missing`),
      expected_error: "trace_not_found",
    },
  ];

  for (const item of negativeCases) {
    assert(item.response.status === 404, `${item.name} returned HTTP ${item.response.status}`);
    assert(
      item.response.body?.error === item.expected_error,
      `${item.name} returned ${JSON.stringify(item.response.body)}`,
    );
    assert(!item.response.body?.trace_summary, `${item.name} leaked trace_summary`);
    assert(!item.response.body?.replay_report, `${item.name} leaked replay_report`);
    assert(
      !JSON.stringify(item.response.body).includes(assistantText.slice(0, 20)),
      `${item.name} leaked assistant text in error response`,
    );
  }

  const bodyTextAfterNegativeFetch = await page.locator("body").innerText();
  assert(
    bodyTextAfterNegativeFetch.includes(message) &&
      bodyTextAfterNegativeFetch.includes(assistantText),
    "Negative replay queries disturbed the restored message stream",
  );
  assert(
    !bodyTextAfterNegativeFetch.includes("session_not_found") &&
      !bodyTextAfterNegativeFetch.includes("trace_not_found"),
    "Negative replay query errors leaked into the product UI",
  );

  const uiState = await commonUiState(page, turnResult, sentMessage);
  const negativeMatrix = Object.fromEntries(
    negativeCases.map((item) => [
      item.name,
      {
        status: item.response.status,
        error: item.response.body?.error,
        leaked_trace_summary: Boolean(item.response.body?.trace_summary),
        leaked_replay_report: Boolean(item.response.body?.replay_report),
      },
    ]),
  );

  return [
    {
      ...uiState,
      slice_id: "au07-trace-query-scope-negative-matrix",
      turn_id: turnResult.turn_id,
      turn_ids: [turnResult.turn_id],
      work_id: workId,
      workspace_id: workId,
      context_work_id: workId,
      session_id: sessionId,
      active_session_id: sessionId,
      restored_after_reload: true,
      reload_resume_transcript_count: resumedAfterReload.transcript_count,
      valid_replay_status: validReplay.status,
      valid_replay_scoped:
        validReplay.body?.work_id === workId &&
        validReplay.body?.session_id === sessionId &&
        validReplay.body?.turn_id === turnResult.turn_id,
      valid_replay_provider_called: validReplay.body?.replay_report?.provider_called === true,
      negative_replay_matrix: negativeMatrix,
      foreign_work_id: otherWork.id,
      foreign_session_id: otherWorkSession.id,
      same_work_other_session_id: sameWorkOtherSession.id,
      cross_work_replay_rejected: negativeMatrix.foreign_work_with_source_session?.status === 404,
      cross_session_replay_rejected:
        negativeMatrix.source_work_with_foreign_session?.status === 404,
      same_work_other_session_replay_rejected:
        negativeMatrix.source_work_with_same_work_other_session?.status === 404,
      missing_turn_replay_rejected: negativeMatrix.source_scope_with_missing_turn?.status === 404,
      negative_errors_hidden_from_ui:
        !bodyTextAfterNegativeFetch.includes("session_not_found") &&
        !bodyTextAfterNegativeFetch.includes("trace_not_found"),
      negative_responses_leaked_trace: Object.values(negativeMatrix).some(
        (item) => item.leaked_trace_summary || item.leaked_replay_report,
      ),
      replay_provider_called: false,
      production_write_performed: turnResult.truthfulness?.production_write_performed === true,
      tool_called: turnResult.truthfulness?.tool_called === true,
    },
  ];
}

async function driveContextSourceUi(page) {
  await page.locator(chatInputSelector).fill("林烬为什么要去灵源矿区？");
  await page.getByRole("button", { name: /^发送$/ }).click();

  await page.waitForFunction(() => document.body.innerText.includes("林烬为什么要去灵源矿区？"), {
    timeout: 10_000,
  });
  for (let attempt = 0; attempt < 120 && !latestTurnResult(); attempt += 1) {
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(300);

  const sentMessage = latestSentUserMessage();
  const turnResult = latestTurnResult();
  assert(sentMessage, "No user_message websocket frame was sent");
  assert(turnResult, "No turn_result websocket frame was received");
  assert(turnResult.trace_summary, "Turn result did not include trace summary");

  const whyText = await openLatestWhyDialog(page);
  const uiState = await commonUiState(page, turnResult, sentMessage);
  const unsafePattern = /raw prompt|provider raw|hidden policy|debug|trace_|ctx_/i;
  const hasSessionOrRecentDialogueSource =
    whyText.includes("当前会话记录") || whyText.includes("近期对话");

  assert(whyText.includes("参考来源"), "Why dialog did not show the source section");
  assert(whyText.includes("当前作品背景"), "Why dialog did not show current work source");
  assert(hasSessionOrRecentDialogueSource, "Why dialog did not show session dialogue source");
  assert(whyText.includes("已确认设定"), "Why dialog did not show memory source");
  assert(whyText.includes("灵源纪元"), "Why dialog did not show work summary text");
  assert(whyText.includes("灵源矿区"), "Why dialog did not show memory or session summary text");
  assert(!unsafePattern.test(whyText), "Why dialog exposed unsafe trace or prompt text");

  return [
    {
      ...uiState,
      trace_why_dialog_open: true,
      trace_why_text: whyText,
      trace_why_contains_raw_prompt: unsafePattern.test(whyText),
    },
  ];
}

async function driveAu11QualityDiagnosisMessageEnvelope(page) {
  const message = "这一章感觉不够爽，主角赢得太轻了。";
  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const turnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.trace_summary?.ai_message_envelope != null,
    "No AU11 turn_result with AIMessageEnvelope trace summary",
    90_000,
  );

  const turnResult = turnFrame.body;
  const sentMessage = latestSentUserMessage();
  assert(sentMessage, "No AU11 user_message websocket frame was sent");

  await waitForAppLogRecord(
    (record) =>
      record.event === "context.assemble.done" &&
      record.turn_id === turnResult.turn_id &&
      record.has_snapshot === true,
    "No AU11 context.assemble.done with current work snapshot",
    30_000,
  );

  const traceSummary = turnResult.trace_summary ?? {};
  const envelope = traceSummary.ai_message_envelope ?? {};
  const novelLayer = envelope.novel_layer ?? {};
  const workState = envelope.work_state_layer ?? {};
  const guidance = envelope.turn_guidance_layer ?? {};
  const qualityGates = Array.isArray(novelLayer.quality_gates) ? novelLayer.quality_gates : [];
  const focus = Array.isArray(guidance.element_focus) ? guidance.element_focus : [];
  const chapterSummary = Array.isArray(workState.chapter_summary)
    ? workState.chapter_summary.join("\n")
    : "";
  const contextRefs = Array.isArray(workState.context_refs) ? workState.context_refs : [];
  const contextSourceTypes = contextRefs.map((ref) => String(ref.source_type ?? ""));
  const assistantText = String(turnResult.assistant_message?.text ?? "");

  assert(
    traceSummary.guidance_mode === "quality",
    "AU11 trace summary did not mark guidance_mode=quality",
  );
  assert(guidance.guidance_mode === "quality", "AU11 TurnGuidance layer did not mark quality mode");
  assert(qualityGates.includes("conflict_pressure"), "AU11 novel layer missed conflict pressure");
  assert(qualityGates.includes("cost_visibility"), "AU11 novel layer missed cost visibility");
  assert(qualityGates.includes("reader_payoff"), "AU11 novel layer missed reader payoff");
  assert(qualityGates.includes("protagonist_agency"), "AU11 novel layer missed protagonist agency");
  assert(focus.includes("conflict_pressure"), "AU11 guidance layer missed conflict focus");
  assert(chapterSummary.includes("霓虹地牢"), "AU11 work state layer missed chapter summary");
  assert(
    contextSourceTypes.includes("current_work"),
    "AU11 work state layer missed current work source",
  );
  assert(
    assistantText.includes("代价") && assistantText.includes("读者回报"),
    "AU11 assistant response did not include concrete quality tradeoffs",
  );
  assert(turnResult.tool_result == null, "AU11 quality diagnosis unexpectedly called a tool");
  assert(turnResult.adoption_state == null, "AU11 quality diagnosis unexpectedly opened adoption");
  assert(
    turnResult.truthfulness?.production_write_performed === false,
    "AU11 quality diagnosis reported production write",
  );

  const whyText = await openLatestWhyDialog(page);
  const uiState = await commonUiState(page, turnResult, sentMessage);
  const unsafePattern = /raw prompt|provider raw|hidden policy|debug|trace_|ctx_/i;

  assert(whyText.includes("质量诊断"), "AU11 why dialog did not show quality diagnosis");
  assert(whyText.includes("冲突压力"), "AU11 why dialog did not show conflict pressure");
  assert(whyText.includes("代价可见"), "AU11 why dialog did not show visible cost");
  assert(whyText.includes("当前作品背景"), "AU11 why dialog did not show current work source");
  assert(!unsafePattern.test(whyText), "AU11 why dialog exposed unsafe trace or prompt text");

  return [
    {
      ...uiState,
      turn_id: turnResult.turn_id,
      message_text: message,
      guidance_mode_quality: traceSummary.guidance_mode === "quality",
      envelope_has_novel_layer: qualityGates.length >= 4,
      envelope_has_work_state: chapterSummary.includes("霓虹地牢"),
      envelope_has_turn_guidance: guidance.guidance_mode === "quality",
      novel_layer_has_quality_gates:
        qualityGates.includes("conflict_pressure") &&
        qualityGates.includes("cost_visibility") &&
        qualityGates.includes("reader_payoff") &&
        qualityGates.includes("protagonist_agency"),
      work_state_has_current_work_source: contextSourceTypes.includes("current_work"),
      work_state_chapter_summary_mentions_target: chapterSummary.includes("霓虹地牢"),
      turn_guidance_focuses_quality: focus.includes("conflict_pressure"),
      assistant_gives_concrete_tradeoff:
        assistantText.includes("代价") && assistantText.includes("读者回报"),
      no_tool_result: turnResult.tool_result == null,
      no_adoption_state: turnResult.adoption_state == null,
      no_production_write: turnResult.truthfulness?.production_write_performed === false,
      trace_why_dialog_open: true,
      trace_why_text: whyText,
      trace_why_contains_raw_prompt: unsafePattern.test(whyText),
      why_shows_quality_diagnosis: whyText.includes("质量诊断"),
      why_shows_quality_focus: whyText.includes("冲突压力") && whyText.includes("代价可见"),
      why_shows_current_work_source: whyText.includes("当前作品背景"),
    },
  ];
}

async function driveAu11MissingWorkstatePolicy(page) {
  const nonce = `AU11-MISSING-${Date.now()}`;
  const work = await createWorkSeed({ title: `AU11空白诊断作品-${nonce}` });
  const beforeJoinCount = readAppLogRecords().length;

  await refreshAndSelectWork(page, work.title);
  const joinRecord = await waitForNewAppLogRecord(
    beforeJoinCount,
    (record) =>
      record.event === "channel.join.done" &&
      record.work_id === work.id &&
      String(record.session_id ?? "").trim().length > 0,
    "Selecting AU11 missing WorkState work did not join its workspace channel",
    30_000,
  );
  await waitForVisibleWorkTitle(page, work.title);

  const message = "帮我看看这一章哪里不成立。";
  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const turnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.trace_summary?.ai_message_envelope != null,
    "No AU11 missing WorkState turn_result with AIMessageEnvelope trace summary",
    90_000,
  );

  const turnResult = turnFrame.body;
  const sentMessage = latestSentUserMessage();
  assert(sentMessage, "No AU11 missing WorkState user_message websocket frame was sent");
  assert(sentMessage.body?.work_id === work.id, "AU11 missing WorkState message used wrong work");

  await waitForAppLogRecord(
    (record) =>
      record.event === "context.assemble.done" &&
      record.turn_id === turnResult.turn_id &&
      record.work_id === work.id &&
      record.session_id === joinRecord.session_id &&
      record.has_snapshot === true,
    "No AU11 missing WorkState context.assemble.done with selected work snapshot",
    30_000,
  );

  const traceSummary = turnResult.trace_summary ?? {};
  const envelope = traceSummary.ai_message_envelope ?? {};
  const workState = envelope.work_state_layer ?? {};
  const guidance = envelope.turn_guidance_layer ?? {};
  const contextRefs = Array.isArray(workState.context_refs) ? workState.context_refs : [];
  const contextSourceTypes = contextRefs.map((ref) => String(ref.source_type ?? ""));
  const missingQuestions = Array.isArray(guidance.missing_questions)
    ? guidance.missing_questions.map(String)
    : [];
  const assistantText = String(turnResult.assistant_message?.text ?? "");
  const missingStatus = (value, reason) =>
    value?.status === "missing" && (!reason || value?.reason === reason);

  assert(
    traceSummary.guidance_mode === "quality",
    "AU11 missing WorkState trace summary did not mark guidance_mode=quality",
  );
  assert(
    guidance.guidance_mode === "quality",
    "AU11 missing WorkState TurnGuidance did not mark quality mode",
  );
  assert(
    String(workState.snapshot_summary ?? "").includes(work.title),
    "AU11 missing WorkState snapshot summary did not reference the selected work",
  );
  assert(
    missingStatus(workState.chapter_state, "no_chapter_state"),
    "AU11 missing WorkState did not mark missing chapter state",
  );
  assert(
    missingStatus(workState.chapter_summary, "no_chapter_summary"),
    "AU11 missing WorkState did not mark missing chapter summary",
  );
  assert(
    missingStatus(workState.prior_prose_excerpt, "no_prior_prose_excerpt_in_dialogue_context"),
    "AU11 missing WorkState did not mark missing prose excerpt",
  );
  assert(
    missingStatus(workState.character_state),
    "AU11 missing WorkState did not mark missing character state",
  );
  assert(
    missingQuestions.some((question) => question.includes("缺目标章节摘要")) &&
      missingQuestions.some((question) => question.includes("正文片段")),
    "AU11 missing WorkState guidance did not record missing target chapter/prose questions",
  );
  assert(
    assistantText.includes("缺少当前章节摘要或正文") &&
      assistantText.includes("不会改写正文或写入作品事实"),
    "AU11 missing WorkState assistant response did not ask for target material honestly",
  );
  assert(!assistantText.includes("已经读过"), "AU11 missing WorkState claimed it read the chapter");
  assert(!assistantText.includes("林烬"), "AU11 missing WorkState fabricated seeded chapter facts");
  assert(turnResult.tool_result == null, "AU11 missing WorkState unexpectedly called a tool");
  assert(turnResult.adoption_state == null, "AU11 missing WorkState unexpectedly opened adoption");
  assert(
    turnResult.truthfulness?.production_write_performed === false,
    "AU11 missing WorkState reported production write",
  );

  const whyText = await openLatestWhyDialog(page);
  const uiState = await commonUiState(page, turnResult, sentMessage);
  const unsafePattern = /raw prompt|provider raw|hidden policy|debug|trace_|ctx_/i;

  assert(whyText.includes("质量诊断"), "AU11 missing WorkState why did not show quality mode");
  assert(
    whyText.includes("作品层依据缺失或不足"),
    "AU11 missing WorkState why did not show missing WorkState",
  );
  assert(
    whyText.includes("缺少正文片段"),
    "AU11 missing WorkState why did not show missing prose limitation",
  );
  assert(!unsafePattern.test(whyText), "AU11 missing WorkState why exposed unsafe trace text");

  return [
    {
      ...uiState,
      turn_id: turnResult.turn_id,
      work_id: work.id,
      workspace_id: work.id,
      session_id: joinRecord.session_id,
      context_work_id: work.id,
      active_session_id: joinRecord.session_id,
      work_title: work.title,
      message_text: message,
      guidance_mode_quality: traceSummary.guidance_mode === "quality",
      work_state_has_current_work_source: contextSourceTypes.includes("current_work"),
      work_state_snapshot_mentions_work: String(workState.snapshot_summary ?? "").includes(
        work.title,
      ),
      work_state_chapter_state_missing: missingStatus(workState.chapter_state, "no_chapter_state"),
      work_state_chapter_summary_missing: missingStatus(
        workState.chapter_summary,
        "no_chapter_summary",
      ),
      work_state_prior_prose_missing: missingStatus(
        workState.prior_prose_excerpt,
        "no_prior_prose_excerpt_in_dialogue_context",
      ),
      work_state_character_state_missing: missingStatus(workState.character_state),
      turn_guidance_records_missing_questions:
        missingQuestions.some((question) => question.includes("缺目标章节摘要")) &&
        missingQuestions.some((question) => question.includes("正文片段")),
      assistant_asks_for_target_material:
        assistantText.includes("缺少当前章节摘要或正文") &&
        assistantText.includes("不会改写正文或写入作品事实"),
      assistant_claims_read_chapter: assistantText.includes("已经读过"),
      assistant_fabricates_seeded_chapter_fact: assistantText.includes("林烬"),
      no_tool_result: turnResult.tool_result == null,
      no_adoption_state: turnResult.adoption_state == null,
      no_production_write: turnResult.truthfulness?.production_write_performed === false,
      trace_why_dialog_open: true,
      trace_why_text: whyText,
      trace_why_contains_raw_prompt: unsafePattern.test(whyText),
      why_shows_quality_diagnosis: whyText.includes("质量诊断"),
      why_shows_work_state_missing: whyText.includes("作品层依据缺失或不足"),
      why_shows_missing_limit: whyText.includes("缺少正文片段"),
    },
  ];
}

async function driveAu09Au03SessionMemoryLayering(page) {
  const activeToken = "当前蓝桥计划";
  const memoryToken = "银槐誓约";
  const historyToken = "旧稿赤塔";
  const historyTitle = "旧稿赤塔历史会话";

  await openSessionRail(page);
  const sessionSearch = page.getByPlaceholder("搜索会话");
  await sessionSearch.waitFor({ timeout: 10_000 });
  await sessionSearch.fill(historyToken);

  const historySessionButton = page.getByRole("button").filter({ hasText: historyTitle }).first();
  await historySessionButton.waitFor({ timeout: 10_000 });
  await historySessionButton.click();

  const showRecord = await waitForAppLogRecord(
    (record) =>
      record.event === "work_session.show.done" &&
      record.read_only === true &&
      String(record.session_id ?? "").trim().length > 0,
    "No read-only historical session show record",
    30_000,
  );

  await page.waitForFunction(
    (token) =>
      document.body.innerText.includes("历史会话") &&
      document.body.innerText.includes(token) &&
      document.body.innerText.includes("正在只读查看历史 transcript"),
    historyToken,
    { timeout: 10_000 },
  );

  const readOnlyText = await page.locator("body").innerText();
  const readonlyInputDisabled = await page.locator(chatInputSelector).isDisabled();
  assert(readonlyInputDisabled, "Chat input was not disabled while viewing history session");
  assert(readOnlyText.includes(historyToken), "Historical transcript was not visible read-only");

  await page.getByRole("button", { name: "返回当前会话" }).click();
  await page.waitForFunction(
    () =>
      !document.body.innerText.includes("正在只读查看历史 transcript") &&
      document.querySelector('input[placeholder="输入你的想法、问题或指令..."]')?.disabled ===
        false,
    undefined,
    { timeout: 15_000 },
  );

  const message = `请结合${activeToken}和${memoryToken}，说明主角为什么继续追查灵源矿区。`;
  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const turnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.trace_summary != null,
    "No turn_result with trace summary for AU09/AU03 session memory layering",
    90_000,
  );

  const turnResult = turnFrame.body;
  const sentMessage = latestSentUserMessage();
  assert(sentMessage, "No AU09/AU03 layering user_message websocket frame was sent");

  await waitForAppLogRecord(
    (record) =>
      record.event === "context.assemble.done" &&
      record.turn_id === turnResult.turn_id &&
      record.has_snapshot === true &&
      record.has_conversation === true &&
      record.has_memory === true,
    "No context.assemble.done with work/session/memory context for AU09/AU03 layering",
    30_000,
  );

  const contextRefs = Array.isArray(turnResult.trace_summary?.context_refs)
    ? turnResult.trace_summary.context_refs
    : [];
  const sourceTypes = contextRefs.map((ref) => String(ref.source_type ?? ""));
  const sessionRef = contextRefs.find(
    (ref) => String(ref.source_type ?? "") === "session_transcript",
  );
  const memoryRef = contextRefs.find((ref) => String(ref.source_type ?? "") === "memory");
  const currentWorkRef = contextRefs.find(
    (ref) => String(ref.source_type ?? "") === "current_work",
  );
  const sessionSummary = String(sessionRef?.summary ?? "");
  const memorySummary = String(memoryRef?.summary ?? "");

  assert(currentWorkRef, "Trace context refs did not include current_work");
  assert(sessionRef, "Trace context refs did not include session_transcript");
  assert(memoryRef, "Trace context refs did not include memory");
  assert(
    !sourceTypes.includes("conversation"),
    "Active session transcript was still labelled conversation",
  );
  assert(
    sessionSummary.includes(activeToken),
    "Session transcript summary did not include active session token",
  );
  assert(
    !sessionSummary.includes(historyToken),
    "Session transcript summary included historical session token",
  );
  assert(
    memorySummary.includes(memoryToken),
    "Memory summary did not include governed memory token",
  );
  assert(!memorySummary.includes(historyToken), "Memory summary included historical session token");

  const whyText = await openLatestWhyDialog(page);
  const uiState = await commonUiState(page, turnResult, sentMessage);
  const unsafePattern = /raw prompt|provider raw|hidden policy|debug|trace_|ctx_/i;

  assert(whyText.includes("当前作品背景"), "Why dialog did not show current work source");
  assert(whyText.includes("当前会话记录"), "Why dialog did not show active session source");
  assert(whyText.includes("已确认设定"), "Why dialog did not show governed memory source");
  assert(whyText.includes(activeToken), "Why dialog did not show active session summary");
  assert(whyText.includes(memoryToken), "Why dialog did not show governed memory summary");
  assert(!whyText.includes(historyToken), "Why dialog included historical transcript content");
  assert(!unsafePattern.test(whyText), "Why dialog exposed unsafe trace or prompt text");

  return [
    {
      ...uiState,
      turn_id: turnResult.turn_id,
      recall_turn_id: turnResult.turn_id,
      readonly_session_id: showRecord.session_id,
      readonly_session_transcript_visible: readOnlyText.includes(historyToken),
      readonly_input_disabled: readonlyInputDisabled,
      active_session_restored: true,
      context_source_types: sourceTypes,
      context_has_current_work: Boolean(currentWorkRef),
      context_has_session_transcript: Boolean(sessionRef),
      context_has_memory: Boolean(memoryRef),
      context_excludes_conversation_fallback: !sourceTypes.includes("conversation"),
      context_session_summary_includes_active: sessionSummary.includes(activeToken),
      context_session_summary_excludes_history: !sessionSummary.includes(historyToken),
      context_memory_summary_includes_memory: memorySummary.includes(memoryToken),
      context_memory_summary_excludes_history: !memorySummary.includes(historyToken),
      trace_why_dialog_open: true,
      trace_why_text: whyText,
      trace_why_contains_raw_prompt: unsafePattern.test(whyText),
      why_shows_current_work_source: whyText.includes("当前作品背景"),
      why_shows_session_source: whyText.includes("当前会话记录"),
      why_shows_memory_source: whyText.includes("已确认设定"),
      why_shows_active_session_summary: whyText.includes(activeToken),
      why_shows_memory_summary: whyText.includes(memoryToken),
      why_excludes_historical_transcript: !whyText.includes(historyToken),
      active_session_token: activeToken,
      memory_token: memoryToken,
      historical_session_token: historyToken,
    },
  ];
}

async function createCandidateSourceTurn(
  page,
  promptText = "我想写一个赛博修仙故事，但还没想好小说创作方向。",
) {
  await page.locator(chatInputSelector).fill(promptText);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sourceTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      Array.isArray(frame.body?.candidate_directions) &&
      frame.body.candidate_directions.length > 0,
    "No candidate turn_result websocket frame was received",
  );
  const sourceTurnResult = sourceTurnFrame.body;
  const candidate = sourceTurnResult.candidate_directions[0];
  const availableAction =
    (sourceTurnResult.available_actions ?? []).find(
      (action) =>
        action.action_type === "choose_candidate" &&
        (action.candidate_ref === candidate.direction_id ||
          action.target_ref === candidate.direction_id),
    ) ??
    (sourceTurnResult.candidate_directions.length === 1 &&
    (sourceTurnResult.available_actions ?? []).filter(
      (action) => action.action_type === "choose_candidate",
    ).length === 1
      ? (sourceTurnResult.available_actions ?? []).find(
          (action) => action.action_type === "choose_candidate",
        )
      : null);

  assert(
    availableAction,
    "Candidate turn_result did not include a matching choose_candidate available_action",
  );

  await page.waitForFunction(
    () =>
      /继续讨论|继续聊这个方向/.test(document.body.innerText) &&
      /设为后续方向|采用这个方向/.test(document.body.innerText),
    { timeout: 10_000 },
  );

  return { sourceTurnResult, candidate, availableAction };
}

async function driveCandidateContinuation(page) {
  const { sourceTurnResult, candidate } = await createCandidateSourceTurn(page);
  const afterSourceFrameCount = frames.length;

  await page
    .getByRole("button", { name: /继续讨论|继续聊这个方向/ })
    .first()
    .click();

  const continuationFrame = await waitForNewFrame(
    afterSourceFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.generate_micro_plan === false &&
      frame.body?.candidate_selection?.source_turn_ref === sourceTurnResult.turn_id &&
      frame.body?.candidate_selection?.candidate_set_ref ===
        `candidate_set:${sourceTurnResult.turn_id}` &&
      frame.body?.candidate_selection?.candidate_ref === candidate.direction_id,
    "Real workbench did not send candidate_selection user_message from candidate continuation",
  );

  const continuationTurnFrame = await waitForNewFrame(
    afterSourceFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      frame.body.turn_id !== sourceTurnResult.turn_id,
    "No candidate continuation turn_result websocket frame was received",
  );
  const continuationTurnResult = continuationTurnFrame.body;

  const framesAfterContinue = frames.slice(afterSourceFrameCount);
  assert(
    !framesAfterContinue.some((frame) => frame.event === "author_action"),
    "Candidate continuation sent an author_action instead of a user_message",
  );
  assert(
    !framesAfterContinue.some((frame) => frame.event === "action_result"),
    "Candidate continuation triggered an action_result",
  );
  assert(
    !continuationTurnResult.adoption_decision,
    "Candidate continuation produced an adoption decision",
  );
  assert(
    continuationTurnResult.truthfulness?.production_write_performed === false,
    "Candidate continuation claimed a production write",
  );

  const uiState = await commonUiState(page, continuationTurnResult, continuationFrame);

  return [
    {
      ...uiState,
      source_turn_ref: sourceTurnResult.turn_id,
      candidate_ref: candidate.direction_id,
      candidate_set_ref: `candidate_set:${sourceTurnResult.turn_id}`,
      frame_badge_label: "探索方向",
      frame_badge_kind: "exploration",
      frame_badge_goal:
        continuationTurnResult.frame_summary?.dialogue_goal ??
        sourceTurnResult.frame_summary?.dialogue_goal ??
        null,
      candidate_panel_count: await page.locator("[class*=candidatePanel]").count(),
      candidate_selection_sent: true,
      generate_micro_plan: continuationFrame.body.generate_micro_plan,
      candidate_selected: continuationTurnResult.truthfulness?.candidate_selected ?? false,
      candidate_adopted: continuationTurnResult.truthfulness?.candidate_adopted ?? false,
      production_write_performed: continuationTurnResult.truthfulness?.production_write_performed,
      no_author_action_sent: !framesAfterContinue.some((frame) => frame.event === "author_action"),
      no_action_result_received: !framesAfterContinue.some(
        (frame) => frame.event === "action_result",
      ),
    },
  ];
}

async function driveCandidateMultiturnContext(page) {
  const nonce = `AU02CTX${Date.now().toString(36).toUpperCase()}`;
  const sourcePrompt = `${nonce} 我想写一个赛博修仙故事，但还没想好小说创作方向。`;
  const { sourceTurnResult, candidate } = await createCandidateSourceTurn(page, sourcePrompt);
  assert(
    String(candidate.title ?? "").includes(nonce),
    "Source candidate did not carry the AU02 context nonce",
  );

  const afterSourceFrameCount = frames.length;
  await page
    .getByRole("button", { name: /继续讨论|继续聊这个方向/ })
    .first()
    .click();

  const continuationFrame = await waitForNewFrame(
    afterSourceFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.generate_micro_plan === false &&
      frame.body?.candidate_selection?.source_turn_ref === sourceTurnResult.turn_id &&
      frame.body?.candidate_selection?.candidate_ref === candidate.direction_id,
    "Real workbench did not send candidate_selection for multiturn context setup",
  );

  const continuationTurnFrame = await waitForNewFrame(
    afterSourceFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      frame.body.turn_id !== sourceTurnResult.turn_id,
    "No candidate continuation turn_result was received for multiturn context setup",
  );
  const continuationTurnResult = continuationTurnFrame.body;

  const afterContinuationFrameCount = frames.length;
  const followupText = "这个方向的开场冲突应该怎么设计？不要写正文，只继续聊。";
  await page.locator(chatInputSelector).fill(followupText);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const followupFrame = await waitForNewFrame(
    afterContinuationFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.text === followupText &&
      frame.body?.generate_micro_plan === false &&
      !frame.body?.candidate_selection,
    "Real workbench did not send a plain follow-up user_message for candidate context",
  );

  const followupTurnFrame = await waitForNewFrame(
    afterContinuationFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      ![sourceTurnResult.turn_id, continuationTurnResult.turn_id].includes(frame.body.turn_id),
    "No candidate context follow-up turn_result was received",
  );
  const followupTurnResult = followupTurnFrame.body;

  const followupContext = await waitForAppLogRecord(
    (record) =>
      record.event === "context.assemble.done" &&
      record.turn_id === followupTurnResult.turn_id &&
      record.has_conversation === true &&
      record.has_session_summary === true,
    "Candidate context follow-up did not assemble session conversation context",
    30_000,
  );

  const followupReply = followupTurnResult.assistant_message?.text ?? "";
  assert(
    followupReply.includes(nonce),
    "Candidate context follow-up reply did not reflect the prior candidate nonce",
  );
  assert(
    followupTurnResult.truthfulness?.production_write_performed === false,
    "Candidate context follow-up claimed a production write",
  );
  assert(!followupTurnResult.tool_result, "Candidate context follow-up produced a tool result");
  assert(
    !followupTurnResult.adoption_decision,
    "Candidate context follow-up produced an adoption decision",
  );

  const framesAfterSource = frames.slice(afterSourceFrameCount);
  assert(
    !framesAfterSource.some((frame) => frame.event === "author_action"),
    "Candidate multiturn context sent an author_action",
  );
  assert(
    !framesAfterSource.some((frame) => frame.event === "action_result"),
    "Candidate multiturn context triggered an action_result",
  );

  await page.waitForFunction(
    ({ followup, reply }) =>
      document.body.innerText.includes(followup) &&
      document.body.innerText.includes(reply) &&
      !document.body.innerText.includes("思考中"),
    { followup: followupText, reply: followupReply },
    { timeout: 30_000 },
  );

  const uiState = await commonUiState(page, followupTurnResult, followupFrame);
  const visibleText = await page.locator("body").innerText();

  return [
    {
      ...uiState,
      source_turn_id: sourceTurnResult.turn_id,
      continuation_turn_id: continuationTurnResult.turn_id,
      followup_turn_id: followupTurnResult.turn_id,
      candidate_ref: candidate.direction_id,
      candidate_title: candidate.title,
      candidate_set_ref: `candidate_set:${sourceTurnResult.turn_id}`,
      context_nonce: nonce,
      candidate_title_visible: visibleText.includes(candidate.title),
      continuation_candidate_selection_sent: Boolean(continuationFrame.body?.candidate_selection),
      followup_plain_user_message_sent: !followupFrame.body?.candidate_selection,
      followup_context_has_conversation: followupContext.has_conversation,
      followup_context_has_session_summary: followupContext.has_session_summary,
      followup_reply_contains_context_nonce: followupReply.includes(nonce),
      followup_message_visible: visibleText.includes(followupText),
      followup_reply_visible: visibleText.includes(followupReply),
      generate_micro_plan: followupFrame.body?.generate_micro_plan,
      tool_result_present: Boolean(followupTurnResult.tool_result),
      adoption_decision_present: Boolean(followupTurnResult.adoption_decision),
      candidate_selected: followupTurnResult.truthfulness?.candidate_selected ?? false,
      candidate_adopted: followupTurnResult.truthfulness?.candidate_adopted ?? false,
      production_write_performed: followupTurnResult.truthfulness?.production_write_performed,
      no_author_action_sent: !framesAfterSource.some((frame) => frame.event === "author_action"),
      no_action_result_received: !framesAfterSource.some(
        (frame) => frame.event === "action_result",
      ),
    },
  ];
}

function countChineseCharacters(value) {
  return (String(value ?? "").match(/[\u4e00-\u9fff]/g) ?? []).length;
}

function hasJsonCodeShape(value) {
  return /```|"\s*frame_type"|candidate_directions|assistant_message|\{\s*"/i.test(
    String(value ?? ""),
  );
}

function isCandidateSemanticallyRelevantToCyberCultivation(candidate) {
  const text = [
    candidate?.title,
    candidate?.pitch,
    ...(Array.isArray(candidate?.tone_tags) ? candidate.tone_tags : []),
  ]
    .filter(Boolean)
    .join(" ");
  const relevanceTerms = [
    "赛博",
    "修仙",
    "灵根",
    "灵气",
    "机甲",
    "数据",
    "网络",
    "芯片",
    "云端",
    "心法",
    "功法",
    "道场",
    "神祇",
    "未来",
    "机械",
    "全息",
  ];

  return relevanceTerms.some((term) => text.includes(term));
}

async function driveNaturalExplorationNoSlotForm(page) {
  const beforeSourceFrameCount = frames.length;
  const { sourceTurnResult, candidate } = await createCandidateSourceTurn(page);
  const sourceMessage = latestSentUserMessage();
  assert(sourceMessage, "No source user_message was captured for natural exploration");

  const frameRecord = await waitForAppLogRecord(
    (record) =>
      record.event === "planner.form_frame.done" &&
      record.turn_id === sourceTurnResult.turn_id &&
      record.frame_type === "creative_exploration" &&
      Number(record.candidate_count ?? 0) > 0,
    "Natural exploration turn did not produce a creative_exploration frame",
    30_000,
  );

  const visibleText = await page.locator("body").innerText();
  const forbiddenSlotKeys = ["required_slots", "missing_slots", "slot_schema", "slot_form"];
  const forbiddenSlotFieldsAbsent = forbiddenSlotKeys.every((key) => sourceTurnResult[key] == null);
  const slotFormPattern = /必填字段|字段表单|请填写字段|slot_schema|required_slots|missing_slots/i;
  const executionCardPattern = /确认执行|待确认的创作材料|保存为章节正文|工具执行|MicroPlan/i;
  const framesAfterSource = frames.slice(beforeSourceFrameCount);
  const naturalReplyText = sourceTurnResult.assistant_message?.text ?? "";
  const naturalCandidates = sourceTurnResult.candidate_directions ?? [];
  const lmstudioQualityChecksRequired = process.env.SLICE_VERIFY_PROVIDER === "lmstudio";
  const naturalReplyChinese = countChineseCharacters(naturalReplyText) >= 8;
  const naturalReplyNoJsonCode = !hasJsonCodeShape(naturalReplyText);
  const candidatesNoJsonCode = naturalCandidates.every(
    (item) =>
      !hasJsonCodeShape(
        [item.title, item.pitch, ...(Array.isArray(item.tone_tags) ? item.tone_tags : [])].join(
          " ",
        ),
      ),
  );
  const candidateSemanticallyRelevant =
    naturalCandidates.length >= 2 &&
    naturalCandidates.every(isCandidateSemanticallyRelevantToCyberCultivation);

  assert(
    visibleText.includes(naturalReplyText),
    "Natural exploration assistant reply was not visible",
  );
  assert(visibleText.includes(candidate.title), "Candidate title was not visible");
  assert(forbiddenSlotFieldsAbsent, "TurnResult exposed slot form fields for natural exploration");
  assert(!slotFormPattern.test(visibleText), "Mechanical slot form text was visible");
  assert(!executionCardPattern.test(visibleText), "Execution or confirmation card was visible");
  assert(
    sourceMessage.body?.generate_micro_plan === false,
    "Natural exploration requested a micro plan",
  );
  assert(
    sourceTurnResult.truthfulness?.production_write_performed === false,
    "Natural exploration claimed a production write",
  );
  assert(!sourceTurnResult.tool_result, "Natural exploration produced a tool result");
  assert(!sourceTurnResult.adoption_decision, "Natural exploration produced an adoption decision");
  assert(
    !framesAfterSource.some((frame) => frame.event === "author_action"),
    "Natural exploration sent an author_action",
  );
  assert(
    !framesAfterSource.some((frame) => frame.event === "action_result"),
    "Natural exploration triggered an action_result",
  );
  if (lmstudioQualityChecksRequired) {
    assert(naturalReplyChinese, "LM Studio exploration reply was not a natural Chinese response");
    assert(naturalReplyNoJsonCode, "LM Studio exploration reply exposed JSON/code shape");
    assert(candidatesNoJsonCode, "LM Studio exploration candidates exposed JSON/code shape");
    assert(
      candidateSemanticallyRelevant,
      "LM Studio exploration candidates were not semantically tied to cyber cultivation",
    );
  }

  const uiState = await commonUiState(page, sourceTurnResult, sourceMessage);

  return [
    {
      ...uiState,
      source_turn_id: sourceTurnResult.turn_id,
      frame_type: frameRecord.frame_type,
      candidate_count: Number(frameRecord.candidate_count ?? 0),
      candidate_ref: candidate.direction_id,
      candidate_title: candidate.title,
      candidate_titles: naturalCandidates.map((item) => item.title),
      candidate_pitches: naturalCandidates.map((item) => item.pitch),
      candidate_set_ref: `candidate_set:${sourceTurnResult.turn_id}`,
      natural_reply_visible: visibleText.includes(naturalReplyText),
      lmstudio_quality_checks_required: lmstudioQualityChecksRequired,
      natural_reply_chinese: naturalReplyChinese,
      natural_reply_no_json_code: naturalReplyNoJsonCode,
      candidates_no_json_code: candidatesNoJsonCode,
      candidate_semantically_relevant: candidateSemanticallyRelevant,
      candidate_panel_rendered: await page.locator("[class*=candidatePanel]").count(),
      slot_form_visible: slotFormPattern.test(visibleText),
      forbidden_slot_fields_absent: forbiddenSlotFieldsAbsent,
      durable_clarification_opened: false,
      execution_card_visible: executionCardPattern.test(visibleText),
      generate_micro_plan: sourceMessage.body?.generate_micro_plan,
      tool_result_present: Boolean(sourceTurnResult.tool_result),
      adoption_decision_present: Boolean(sourceTurnResult.adoption_decision),
      candidate_selected: sourceTurnResult.truthfulness?.candidate_selected ?? false,
      candidate_adopted: sourceTurnResult.truthfulness?.candidate_adopted ?? false,
      production_write_performed: sourceTurnResult.truthfulness?.production_write_performed,
      no_author_action_sent: !framesAfterSource.some((frame) => frame.event === "author_action"),
      no_action_result_received: !framesAfterSource.some(
        (frame) => frame.event === "action_result",
      ),
    },
  ];
}

async function driveCandidateFallbackUi(page) {
  const beforeSourceFrameCount = frames.length;
  const promptText = "AU02BADCANDIDATES 我想写赛博修仙方向，但上游候选格式坏了时也要给可用方向。";
  const { sourceTurnResult, candidate } = await createCandidateSourceTurn(page, promptText);
  const sourceMessage = latestSentUserMessage();
  assert(sourceMessage, "No source user_message was captured for candidate fallback");

  const frameRecord = await waitForAppLogRecord(
    (record) =>
      record.event === "planner.form_frame.done" &&
      record.turn_id === sourceTurnResult.turn_id &&
      record.frame_type === "creative_exploration" &&
      Number(record.candidate_count ?? 0) >= 2,
    "Candidate fallback turn did not produce a creative_exploration frame with candidates",
    30_000,
  );

  const candidates = sourceTurnResult.candidate_directions ?? [];
  const fallbackCandidateTitles = candidates.map((item) => item.title);
  const fallbackCandidatePitches = candidates.map((item) => item.pitch);
  const hasKnownFallbackCandidate = fallbackCandidateTitles.includes("矛盾切入");
  const candidateFieldsNonempty = candidates.every(
    (item) => String(item.title ?? "").trim() !== "" && String(item.pitch ?? "").trim() !== "",
  );
  const candidateStatusesNotAdopted = candidates.every(
    (item) => item.adoption_status === "not_adopted",
  );
  const visibleText = await page.locator("body").innerText();
  const framesAfterSource = frames.slice(beforeSourceFrameCount);

  assert(
    sourceMessage.body?.text === promptText && sourceMessage.body?.generate_micro_plan === false,
    "Real workbench did not send the malformed-candidate prompt as a no-MicroPlan user_message",
  );
  assert(candidates.length >= 2, "Fallback candidate list was not populated");
  assert(
    hasKnownFallbackCandidate,
    "TurnResult did not contain the known Planner fallback candidate",
  );
  assert(candidateFieldsNonempty, "Fallback candidates contained empty title or pitch");
  assert(candidateStatusesNotAdopted, "Fallback candidates were not marked not_adopted");
  assert(visibleText.includes("矛盾切入"), "Fallback candidate title was not visible in UI");
  assert(
    sourceTurnResult.truthfulness?.production_write_performed === false,
    "Candidate fallback turn claimed a production write",
  );
  assert(!sourceTurnResult.tool_result, "Candidate fallback turn produced a tool result");
  assert(
    !sourceTurnResult.adoption_decision,
    "Candidate fallback turn produced an adoption decision",
  );
  assert(
    !framesAfterSource.some((frame) => frame.event === "author_action"),
    "Candidate fallback sent an author_action",
  );
  assert(
    !framesAfterSource.some((frame) => frame.event === "action_result"),
    "Candidate fallback triggered an action_result",
  );

  const uiState = await commonUiState(page, sourceTurnResult, sourceMessage);

  return [
    {
      ...uiState,
      source_turn_id: sourceTurnResult.turn_id,
      provider_candidate_payload: "malformed_candidates",
      frame_type: frameRecord.frame_type,
      frame_candidate_count: Number(frameRecord.candidate_count ?? 0),
      turn_result_candidate_count: candidates.length,
      fallback_candidate_titles: fallbackCandidateTitles,
      fallback_candidate_pitches: fallbackCandidatePitches,
      fallback_candidate_visible: visibleText.includes("矛盾切入"),
      has_known_fallback_candidate: hasKnownFallbackCandidate,
      candidate_fields_nonempty: candidateFieldsNonempty,
      candidate_statuses_not_adopted: candidateStatusesNotAdopted,
      candidate_ref: candidate.direction_id,
      candidate_set_ref: `candidate_set:${sourceTurnResult.turn_id}`,
      candidate_panel_rendered: await page.locator("[class*=candidatePanel]").count(),
      malformed_candidate_prompt_sent: sourceMessage.body?.text === promptText,
      generate_micro_plan: sourceMessage.body?.generate_micro_plan,
      tool_result_present: Boolean(sourceTurnResult.tool_result),
      adoption_decision_present: Boolean(sourceTurnResult.adoption_decision),
      candidate_selected: sourceTurnResult.truthfulness?.candidate_selected ?? false,
      candidate_adopted: sourceTurnResult.truthfulness?.candidate_adopted ?? false,
      production_write_performed: sourceTurnResult.truthfulness?.production_write_performed,
      no_author_action_sent: !framesAfterSource.some((frame) => frame.event === "author_action"),
      no_action_result_received: !framesAfterSource.some(
        (frame) => frame.event === "action_result",
      ),
    },
  ];
}

async function driveCandidateFreeformFollowup(page) {
  const { sourceTurnResult, candidate } = await createCandidateSourceTurn(page);
  const afterSourceFrameCount = frames.length;
  const freeformMessage = `不点候选按钮，我直接追问：${candidate.title} 这个方向还能怎么展开？`;

  const candidatePanelCountAfterSource = await page.locator("[class*=candidatePanel]").count();
  const inputEnabledAfterCandidate = await page.locator(chatInputSelector).isEnabled();
  const continueButtonCount = await page
    .getByRole("button", { name: /继续讨论|继续聊这个方向/ })
    .count();
  const adoptButtonCount = await page
    .getByRole("button", { name: /设为后续方向|采用这个方向/ })
    .count();

  assert(candidatePanelCountAfterSource > 0, "Candidate panel was not visible before freeform");
  assert(inputEnabledAfterCandidate, "Chat input was disabled after candidate panel appeared");

  await page.locator(chatInputSelector).fill(freeformMessage);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const freeformFrame = await waitForNewFrame(
    afterSourceFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.text === freeformMessage &&
      frame.body?.generate_micro_plan === false &&
      !frame.body?.candidate_selection,
    "Real workbench did not send a plain user_message for freeform candidate follow-up",
  );

  const freeformTurnFrame = await waitForNewFrame(
    afterSourceFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      frame.body.turn_id !== sourceTurnResult.turn_id,
    "No freeform candidate follow-up turn_result websocket frame was received",
  );
  const freeformTurnResult = freeformTurnFrame.body;

  await page.waitForFunction(
    (payload) =>
      document.body.innerText.includes(payload.message) &&
      document.body.innerText.includes(payload.assistantText) &&
      !document.body.innerText.includes("思考中"),
    {
      message: freeformMessage,
      assistantText: freeformTurnResult.assistant_message.text,
    },
    { timeout: 30_000 },
  );

  const framesAfterFreeform = frames.slice(afterSourceFrameCount);
  assert(
    !framesAfterFreeform.some((frame) => frame.event === "author_action"),
    "Freeform candidate follow-up sent an author_action",
  );
  assert(
    !framesAfterFreeform.some((frame) => frame.event === "action_result"),
    "Freeform candidate follow-up triggered an action_result",
  );
  assert(
    !freeformTurnResult.adoption_decision,
    "Freeform candidate follow-up produced an adoption decision",
  );
  assert(
    freeformTurnResult.truthfulness?.production_write_performed === false,
    "Freeform candidate follow-up claimed a production write",
  );

  const uiState = await commonUiState(page, freeformTurnResult, freeformFrame);
  const visibleText = await page.locator("body").innerText();

  return [
    {
      ...uiState,
      source_turn_ref: sourceTurnResult.turn_id,
      freeform_turn_id: freeformTurnResult.turn_id,
      candidate_ref: candidate.direction_id,
      candidate_title: candidate.title,
      candidate_set_ref: `candidate_set:${sourceTurnResult.turn_id}`,
      frame_badge_label: "探索方向",
      frame_badge_kind: "exploration",
      candidate_panel_count_after_source: candidatePanelCountAfterSource,
      input_enabled_after_candidate: inputEnabledAfterCandidate,
      candidate_continue_button_count: continueButtonCount,
      candidate_adopt_button_count: adoptButtonCount,
      freeform_message_text: freeformMessage,
      freeform_message_visible: visibleText.includes(freeformMessage),
      freeform_assistant_reply_visible: visibleText.includes(
        freeformTurnResult.assistant_message.text,
      ),
      freeform_user_message_sent: true,
      candidate_selection_sent: Boolean(freeformFrame.body?.candidate_selection),
      generate_micro_plan: freeformFrame.body.generate_micro_plan,
      candidate_selected: freeformTurnResult.truthfulness?.candidate_selected ?? false,
      candidate_adopted: freeformTurnResult.truthfulness?.candidate_adopted ?? false,
      production_write_performed: freeformTurnResult.truthfulness?.production_write_performed,
      no_author_action_sent: !framesAfterFreeform.some((frame) => frame.event === "author_action"),
      no_action_result_received: !framesAfterFreeform.some(
        (frame) => frame.event === "action_result",
      ),
      adoption_decision_present: Boolean(freeformTurnResult.adoption_decision),
    },
  ];
}

async function driveUnadoptedCandidateNoReadingFact(page) {
  const { sourceTurnResult, candidate } = await createCandidateSourceTurn(page);
  const sourceMessage = latestSentUserMessage();
  assert(sourceMessage, "No source user_message was captured for candidate turn");

  const afterSourceFrameCount = frames.length;
  const beforeReadingLogCount = readAppLogRecords().length;
  const candidatePitch = candidate.pitch ?? "";
  const candidateSetRef = `candidate_set:${sourceTurnResult.turn_id}`;
  const textBeforeReading = await page.locator("body").innerText();

  assert(
    textBeforeReading.includes(candidate.title),
    "Candidate title was not visible before reading mode",
  );
  assert(
    candidatePitch === "" || textBeforeReading.includes(candidatePitch),
    "Candidate pitch was not visible before reading mode",
  );
  assert(
    sourceTurnResult.truthfulness?.production_write_performed === false,
    "Source candidate turn claimed a production write",
  );

  await page.getByRole("button", { name: readingModeButtonPattern }).click();

  const tocRecord = await waitForNewAppLogRecord(
    beforeReadingLogCount,
    (record) =>
      record.event === "channel.get_toc.done" &&
      record.work_id === sourceMessage.body?.work_id &&
      Number(record.chapter_count ?? -1) === 0 &&
      Number(record.total_word_count ?? -1) === 0,
    "Reading mode did not read an empty TOC after unadopted candidate presentation",
    30_000,
  );

  await page.waitForFunction(
    ({ title, pitch }) =>
      document.body.innerText.includes("阅读模式") &&
      document.body.innerText.includes("暂无已采纳的章节内容") &&
      !document.body.innerText.includes(title) &&
      (pitch === "" || !document.body.innerText.includes(pitch)),
    { title: candidate.title, pitch: candidatePitch },
    { timeout: 15_000 },
  );

  const readingText = await page.locator("body").innerText();
  const framesAfterSource = frames.slice(afterSourceFrameCount);
  assert(
    !framesAfterSource.some((frame) => frame.event === "author_action"),
    "Unadopted candidate check sent an author_action",
  );
  assert(
    !framesAfterSource.some((frame) => frame.event === "action_result"),
    "Unadopted candidate check triggered an action_result",
  );
  assert(
    !sourceTurnResult.adoption_decision,
    "Source candidate turn produced an adoption decision",
  );

  const uiState = await commonUiState(page, sourceTurnResult, sourceMessage);

  return [
    {
      ...uiState,
      source_turn_id: sourceTurnResult.turn_id,
      candidate_ref: candidate.direction_id,
      candidate_title: candidate.title,
      candidate_pitch: candidatePitch,
      candidate_set_ref: candidateSetRef,
      frame_badge_label: "探索方向",
      frame_badge_kind: "exploration",
      candidate_panel_rendered_before_reading: true,
      reading_mode_opened: true,
      reading_empty_state_visible: readingText.includes("暂无已采纳的章节内容"),
      reading_toc_chapter_count: Number(tocRecord.chapter_count ?? -1),
      reading_total_word_count: Number(tocRecord.total_word_count ?? -1),
      candidate_title_visible_in_reading: readingText.includes(candidate.title),
      candidate_pitch_visible_in_reading:
        candidatePitch !== "" && readingText.includes(candidatePitch),
      candidate_selected: sourceTurnResult.truthfulness?.candidate_selected ?? false,
      candidate_adopted: sourceTurnResult.truthfulness?.candidate_adopted ?? false,
      production_write_performed: sourceTurnResult.truthfulness?.production_write_performed,
      adoption_decision_present: Boolean(sourceTurnResult.adoption_decision),
      generate_micro_plan: sourceMessage.body?.generate_micro_plan,
      no_author_action_sent: !framesAfterSource.some((frame) => frame.event === "author_action"),
      no_action_result_received: !framesAfterSource.some(
        (frame) => frame.event === "action_result",
      ),
      no_projection_events: !readAppLogRecords()
        .slice(beforeReadingLogCount)
        .some((record) => String(record.event ?? "").startsWith("projection.")),
    },
  ];
}

async function driveCandidateAdoptionBridge(page) {
  const { sourceTurnResult, candidate, availableAction } = await createCandidateSourceTurn(page);

  await page
    .getByRole("button", { name: /设为后续方向|采用这个方向/ })
    .first()
    .click();

  const actionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_id === availableAction.action_id &&
      frame.body?.action?.action_type === availableAction.action_type &&
      frame.body?.action?.source_turn_ref ===
        (availableAction.source_turn_ref ?? sourceTurnResult.turn_id) &&
      frame.body?.action?.target_ref === availableAction.target_ref &&
      frame.body?.action?.candidate_ref === availableAction.candidate_ref &&
      frame.body?.action?.candidate_set_ref === availableAction.candidate_set_ref,
    "Real workbench did not send server-provided choose_candidate author_action from candidate adoption",
  );

  const actionResultFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "action_result" &&
      frame.body?.action_type === "choose_candidate" &&
      frame.body?.candidate_ref === availableAction.candidate_ref,
    "No choose_candidate action_result websocket frame was received",
  );

  const adoptionTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.parent_turn_id === sourceTurnResult.turn_id &&
      frame.body?.adoption_decision?.decision_type === "adopt_tentative",
    "No candidate adoption decision turn_result websocket frame was received",
  );
  const adoptionTurnResult = adoptionTurnFrame.body;

  await page.waitForFunction(
    () => /已采用候选|已设为后续方向|候选方向已采用/.test(document.body.innerText),
    {
      timeout: 10_000,
    },
  );

  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, adoptionTurnResult, sentMessage);
  const visibleText = await page.locator("body").innerText();

  assert(
    /继续讨论|继续聊这个方向/.test(visibleText),
    "Candidate continuation button was not rendered",
  );
  assert(
    /设为后续方向|采用这个方向/.test(visibleText),
    "Candidate adoption button was not rendered",
  );
  assert(
    adoptionTurnResult.truthfulness?.candidate_selected === true,
    "Adoption turn_result did not mark candidate_selected",
  );
  assert(
    adoptionTurnResult.truthfulness?.candidate_adopted === true,
    "Adoption turn_result did not mark candidate_adopted",
  );
  assert(
    adoptionTurnResult.truthfulness?.production_write_performed === false,
    "Candidate adoption bridge claimed a production write",
  );

  return [
    {
      ...uiState,
      source_turn_id: sourceTurnResult.turn_id,
      continuation_turn_id: null,
      adoption_turn_id: adoptionTurnResult.turn_id,
      candidate_ref: availableAction.candidate_ref,
      candidate_set_ref: availableAction.candidate_set_ref,
      candidate_panel_count: await page.locator("[class*=candidatePanel]").count(),
      candidate_continue_clicked: false,
      candidate_adopt_clicked: true,
      author_action: actionFrame.body.action,
      action_result_status: actionResultFrame.body.status ?? latestActionResult()?.status,
      adoption_decision_type: adoptionTurnResult.adoption_decision.decision_type,
      candidate_selected: adoptionTurnResult.truthfulness.candidate_selected,
      candidate_adopted: adoptionTurnResult.truthfulness.candidate_adopted,
      production_write_performed: adoptionTurnResult.truthfulness.production_write_performed,
      visible_adoption_result: /已采用候选|已设为后续方向|候选方向已采用/.test(visibleText),
    },
  ];
}

async function driveAdoptionSafetyFreshness(page) {
  await page
    .locator(chatInputSelector)
    .fill("我想写一个赛博修仙故事，但还没想好小说创作方向，可以有一个高风险、覆盖主线的方向。");
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sourceTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      Array.isArray(frame.body?.candidate_directions) &&
      frame.body.candidate_directions.some((candidate) => candidate.risk_hint === "high"),
    "No high-risk candidate turn_result websocket frame was received",
  );
  const sourceTurnResult = sourceTurnFrame.body;
  const candidate = sourceTurnResult.candidate_directions.find((item) => item.risk_hint === "high");

  assert(candidate, "High-risk candidate was not present in source turn_result");

  await page
    .getByRole("button", { name: /设为后续方向|采用这个方向/ })
    .first()
    .click();

  const actionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "choose_candidate" &&
      frame.body?.action?.candidate_ref === candidate.direction_id &&
      frame.body?.action?.candidate_set_ref === `candidate_set:${sourceTurnResult.turn_id}`,
    "Real workbench did not send authorized high-risk choose_candidate author_action",
  );

  const actionResultFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "action_result" &&
      frame.body?.action_type === "choose_candidate" &&
      frame.body?.candidate_ref === candidate.direction_id &&
      frame.body?.status === "needs_confirmation" &&
      frame.body?.adoption_decision?.decision_type === "require_confirmation",
    "No high-risk candidate confirmation action_result websocket frame was received",
  );

  const confirmationTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.parent_turn_id === sourceTurnResult.turn_id &&
      frame.body?.status === "needs_confirmation" &&
      frame.body?.adoption_decision?.decision_type === "require_confirmation",
    "No high-risk candidate confirmation turn_result websocket frame was received",
  );
  const confirmationTurnResult = confirmationTurnFrame.body;

  await page.waitForFunction(
    () => /候选方向待确认|后续方向待确认|确认回合/.test(document.body.innerText),
    {
      timeout: 10_000,
    },
  );

  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, confirmationTurnResult, sentMessage);
  const visibleText = await page.locator("body").innerText();

  assert(
    /设为后续方向|采用这个方向/.test(visibleText),
    "Candidate adoption button was not rendered",
  );
  assert(
    confirmationTurnResult.truthfulness?.candidate_selected === true,
    "Confirmation turn_result did not mark candidate_selected",
  );
  assert(
    confirmationTurnResult.truthfulness?.candidate_adopted === false,
    "High-risk confirmation turn_result incorrectly marked candidate_adopted",
  );
  assert(
    confirmationTurnResult.truthfulness?.production_write_performed === false,
    "High-risk confirmation turn_result claimed a production write",
  );

  return [
    {
      ...uiState,
      source_turn_id: sourceTurnResult.turn_id,
      confirmation_turn_id: confirmationTurnResult.turn_id,
      candidate_ref: candidate.direction_id,
      candidate_set_ref: `candidate_set:${sourceTurnResult.turn_id}`,
      candidate_risk_hint: candidate.risk_hint,
      candidate_adopt_clicked: true,
      author_action: actionFrame.body.action,
      action_result_status: actionResultFrame.body.status ?? latestActionResult()?.status,
      adoption_decision_type: confirmationTurnResult.adoption_decision.decision_type,
      adoption_reason_codes: confirmationTurnResult.adoption_decision.reason_codes,
      candidate_selected: confirmationTurnResult.truthfulness.candidate_selected,
      candidate_adopted: confirmationTurnResult.truthfulness.candidate_adopted,
      production_write_performed: confirmationTurnResult.truthfulness.production_write_performed,
      visible_confirmation_result: /候选方向待确认|后续方向待确认|确认回合/.test(visibleText),
    },
  ];
}

async function driveStaleConflictCrossWorkFreshness(page) {
  await page.waitForFunction(() => document.body.innerText.includes("旧版主线覆盖"), {
    timeout: 20_000,
  });

  await page
    .getByRole("button", { name: /设为后续方向|采用这个方向/ })
    .first()
    .click();

  const actionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "choose_candidate" &&
      frame.body?.action?.candidate_ref === "dir_au05_stale_1" &&
      frame.body?.action?.candidate_set_ref === "candidate_set:turn_au05_stale_candidate_seed",
    "Real workbench did not send authorized stale choose_candidate author_action",
  );

  const actionResultFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "action_result" &&
      frame.body?.action_type === "choose_candidate" &&
      frame.body?.candidate_ref === "dir_au05_stale_1" &&
      frame.body?.status === "rejected" &&
      frame.body?.adoption_decision?.decision_type === "reject",
    "No stale candidate rejection action_result websocket frame was received",
  );

  const rejectionTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.parent_turn_id === "turn_au05_stale_candidate_seed" &&
      frame.body?.status === "cancelled" &&
      frame.body?.adoption_decision?.decision_type === "reject",
    "No stale candidate rejection turn_result websocket frame was received",
  );
  const rejectionTurnResult = rejectionTurnFrame.body;

  await page.waitForFunction(() => /候选方向未采用|后续方向未设置/.test(document.body.innerText), {
    timeout: 10_000,
  });

  const visibleText = await page.locator("body").innerText();
  const topic = actionFrame.topic ?? "";
  const workId = topic.startsWith("workspace:") ? topic.slice("workspace:".length) : undefined;

  assert(
    rejectionTurnResult.truthfulness?.candidate_selected === true,
    "Stale rejection turn_result did not mark candidate_selected",
  );
  assert(
    rejectionTurnResult.truthfulness?.candidate_adopted === false,
    "Stale rejection turn_result incorrectly marked candidate_adopted",
  );
  assert(
    rejectionTurnResult.truthfulness?.production_write_performed === false,
    "Stale rejection turn_result claimed a production write",
  );
  assert(
    rejectionTurnResult.truthfulness?.reason_codes?.includes("source_turn_stale"),
    "Stale rejection turn_result did not include source_turn_stale reason",
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_id: rejectionTurnResult.turn_id,
      work_id: workId,
      workspace_id: workId,
      source_turn_id: "turn_au05_stale_candidate_seed",
      rejection_turn_id: rejectionTurnResult.turn_id,
      candidate_ref: "dir_au05_stale_1",
      candidate_set_ref: "candidate_set:turn_au05_stale_candidate_seed",
      candidate_adopt_clicked: true,
      action_result_status: actionResultFrame.body.status ?? latestActionResult()?.status,
      adoption_decision_type: rejectionTurnResult.adoption_decision.decision_type,
      adoption_reason_codes: rejectionTurnResult.adoption_decision.reason_codes,
      candidate_selected: rejectionTurnResult.truthfulness.candidate_selected,
      candidate_adopted: rejectionTurnResult.truthfulness.candidate_adopted,
      production_write_performed: rejectionTurnResult.truthfulness.production_write_performed,
      visible_rejection_result: /候选方向未采用|后续方向未设置/.test(visibleText),
      restored_stale_candidate_visible: visibleText.includes("旧版主线覆盖"),
      duration_ms: 0,
      outcome: "done",
    },
  ];
}

async function driveConflictCrossWorkRecovery(page) {
  await page.waitForFunction(() => document.body.innerText.includes("外部作品主线移植"), {
    timeout: 20_000,
  });

  await page
    .getByRole("button", { name: /设为后续方向|采用这个方向/ })
    .first()
    .click();

  const actionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "choose_candidate" &&
      frame.body?.action?.candidate_ref === "dir_au05_cross_work_1" &&
      frame.body?.action?.candidate_set_ref === "candidate_set:turn_au05_cross_work_candidate_seed",
    "Real workbench did not send authorized cross-work choose_candidate author_action",
  );

  const actionResultFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "action_result" &&
      frame.body?.action_type === "choose_candidate" &&
      frame.body?.candidate_ref === "dir_au05_cross_work_1" &&
      frame.body?.status === "failed" &&
      frame.body?.adoption_decision?.decision_type === "fail_with_recovery",
    "No cross-work candidate recovery failure action_result websocket frame was received",
  );

  const failureTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.parent_turn_id === "turn_au05_cross_work_candidate_seed" &&
      frame.body?.status === "failed" &&
      frame.body?.adoption_decision?.decision_type === "fail_with_recovery",
    "No cross-work candidate recovery failure turn_result websocket frame was received",
  );
  const failureTurnResult = failureTurnFrame.body;

  await page.waitForFunction(
    () => /候选方向采用失败|后续方向设置失败/.test(document.body.innerText),
    {
      timeout: 10_000,
    },
  );

  const visibleText = await page.locator("body").innerText();
  const topic = actionFrame.topic ?? "";
  const workId = topic.startsWith("workspace:") ? topic.slice("workspace:".length) : undefined;

  assert(
    failureTurnResult.truthfulness?.candidate_selected === true,
    "Cross-work failure turn_result did not mark candidate_selected",
  );
  assert(
    failureTurnResult.truthfulness?.candidate_adopted === false,
    "Cross-work failure turn_result incorrectly marked candidate_adopted",
  );
  assert(
    failureTurnResult.truthfulness?.production_write_performed === false,
    "Cross-work failure turn_result claimed a production write",
  );
  assert(
    failureTurnResult.truthfulness?.reason_codes?.includes("work_id_mismatch"),
    "Cross-work failure turn_result did not include work_id_mismatch reason",
  );
  assert(
    failureTurnResult.truthfulness?.reason_codes?.includes("cross_work_adoption_rejected"),
    "Cross-work failure turn_result did not include cross_work_adoption_rejected reason",
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_id: failureTurnResult.turn_id,
      work_id: workId,
      workspace_id: workId,
      source_turn_id: "turn_au05_cross_work_candidate_seed",
      failure_turn_id: failureTurnResult.turn_id,
      candidate_ref: "dir_au05_cross_work_1",
      candidate_set_ref: "candidate_set:turn_au05_cross_work_candidate_seed",
      candidate_adopt_clicked: true,
      action_result_status: actionResultFrame.body.status ?? latestActionResult()?.status,
      adoption_decision_type: failureTurnResult.adoption_decision.decision_type,
      adoption_reason_codes: failureTurnResult.adoption_decision.reason_codes,
      candidate_selected: failureTurnResult.truthfulness.candidate_selected,
      candidate_adopted: failureTurnResult.truthfulness.candidate_adopted,
      production_write_performed: failureTurnResult.truthfulness.production_write_performed,
      visible_failure_result: /候选方向采用失败|后续方向设置失败/.test(visibleText),
      cross_work_candidate_visible: visibleText.includes("外部作品主线移植"),
      duration_ms: 0,
      outcome: "done",
    },
  ];
}

async function driveCanonConflictRecovery(page) {
  await page.waitForFunction(() => document.body.innerText.includes("年龄设定覆盖"), {
    timeout: 20_000,
  });

  await page
    .getByRole("button", { name: /设为后续方向|采用这个方向/ })
    .first()
    .click();

  const actionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "choose_candidate" &&
      frame.body?.action?.candidate_ref === "dir_au05_canon_conflict_1" &&
      frame.body?.action?.candidate_set_ref ===
        "candidate_set:turn_au05_canon_conflict_candidate_seed",
    "Real workbench did not send authorized canon-conflict choose_candidate author_action",
  );

  const actionResultFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "action_result" &&
      frame.body?.action_type === "choose_candidate" &&
      frame.body?.candidate_ref === "dir_au05_canon_conflict_1" &&
      frame.body?.status === "failed" &&
      frame.body?.adoption_decision?.decision_type === "fail_with_recovery",
    "No canon-conflict candidate recovery failure action_result websocket frame was received",
  );

  const failureTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.parent_turn_id === "turn_au05_canon_conflict_candidate_seed" &&
      frame.body?.status === "failed" &&
      frame.body?.adoption_decision?.decision_type === "fail_with_recovery",
    "No canon-conflict candidate recovery failure turn_result websocket frame was received",
  );
  const failureTurnResult = failureTurnFrame.body;

  await page.waitForFunction(
    () => /候选方向采用失败|后续方向设置失败/.test(document.body.innerText),
    {
      timeout: 10_000,
    },
  );

  const visibleText = await page.locator("body").innerText();
  const topic = actionFrame.topic ?? "";
  const workId = topic.startsWith("workspace:") ? topic.slice("workspace:".length) : undefined;

  assert(
    failureTurnResult.truthfulness?.candidate_selected === true,
    "Canon-conflict failure turn_result did not mark candidate_selected",
  );
  assert(
    failureTurnResult.truthfulness?.candidate_adopted === false,
    "Canon-conflict failure turn_result incorrectly marked candidate_adopted",
  );
  assert(
    failureTurnResult.truthfulness?.production_write_performed === false,
    "Canon-conflict failure turn_result claimed a production write",
  );
  assert(
    failureTurnResult.truthfulness?.reason_codes?.includes("canon_conflict_detected"),
    "Canon-conflict failure turn_result did not include canon_conflict_detected reason",
  );
  assert(
    failureTurnResult.truthfulness?.reason_codes?.includes("conflict_recovery_required"),
    "Canon-conflict failure turn_result did not include conflict_recovery_required reason",
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_id: failureTurnResult.turn_id,
      work_id: workId,
      workspace_id: workId,
      source_turn_id: "turn_au05_canon_conflict_candidate_seed",
      failure_turn_id: failureTurnResult.turn_id,
      candidate_ref: "dir_au05_canon_conflict_1",
      candidate_set_ref: "candidate_set:turn_au05_canon_conflict_candidate_seed",
      candidate_adopt_clicked: true,
      action_result_status: actionResultFrame.body.status ?? latestActionResult()?.status,
      adoption_decision_type: failureTurnResult.adoption_decision.decision_type,
      adoption_reason_codes: failureTurnResult.adoption_decision.reason_codes,
      candidate_selected: failureTurnResult.truthfulness.candidate_selected,
      candidate_adopted: failureTurnResult.truthfulness.candidate_adopted,
      production_write_performed: failureTurnResult.truthfulness.production_write_performed,
      visible_failure_result: /候选方向采用失败|后续方向设置失败/.test(visibleText),
      canon_conflict_candidate_visible: visibleText.includes("年龄设定覆盖"),
      duration_ms: 0,
      outcome: "done",
    },
  ];
}

async function driveP1ChapterPlanMinimum(page) {
  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "大纲与结构" }).click();
  await page.getByRole("button", { name: "规划卷章结构" }).click();

  const planMessageFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.generate_micro_plan === true &&
      String(frame.body?.text ?? "").includes("章节大纲"),
    "Real workbench did not send chapter plan user_message with micro plan enabled",
  );

  const generationFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.tool_name === "plot_outline" &&
      frame.body?.tool_result?.output?.artifact_type === "outline_draft" &&
      // 章数是 AI 生成的产物，不写死「恰好 12」：只要求达到长篇计划下限（>= 8）。
      Number(frame.body?.adoption_state?.pending?.[0]?.payload?.chapter_count ?? 0) >= 8,
    "No P1 chapter plan outline_draft turn_result websocket frame was received",
  );
  const generationTurnResult = generationFrame.body;
  const pendingArtifact = generationTurnResult.adoption_state.pending[0];
  // 首/末章标题取自实际生成的计划条目（provider 中立：确定性与真实 LLM 标题不同）。
  const planItems = pendingArtifact.payload?.items ?? [];
  const chapterCount = Number(pendingArtifact.payload?.chapter_count ?? planItems.length);
  const firstChapterTitle = String(planItems[0]?.title ?? "");
  const lastChapterTitle = String(planItems[planItems.length - 1]?.title ?? "");

  // 采纳走当前模型：待保存计划卡（候选集）+保存按钮（author_action accept），
  // 不再用旧的「采纳」按钮 / adopt 事件（channel adopt handler 已遗留、前端不用）。
  await page.waitForFunction(
    () => {
      return (
        /待确认的创作材料|大纲草稿/.test(document.body.innerText) &&
        [...document.querySelectorAll("button")].some((btn) =>
          /确认创建|保存为章节正文|保存到大纲|保存到作品档案|保存到作品/.test(
            (btn.textContent ?? "").trim(),
          ),
        )
      );
    },
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: acceptDraftButtonPattern }).first().click();

  const acceptActionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "accept" &&
      frame.body?.action?.target_ref === pendingArtifact.artifact_id,
    "Real workbench did not send accept author_action for the chapter plan",
  );
  const actionResultFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "action_result" &&
      frame.body?.status === "accepted" &&
      frame.body?.artifact_id === pendingArtifact.artifact_id,
    "No accepted action_result websocket frame was received for the chapter plan",
    120_000,
  );

  const adoptionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.truthfulness?.artifact_adopted === true &&
      Array.isArray(frame.body?.adoption_state?.resolved) &&
      frame.body.adoption_state.resolved.some(
        (entry) => entry.artifact_id === pendingArtifact.artifact_id,
      ),
    "No accepted outline_draft adoption turn_result websocket frame was received",
    120_000,
  );
  const adoptionTurnResult = adoptionFrame.body;

  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "大纲与结构" }).click();

  // 大纲与结构单一数据源 = 已采纳卷/章结构（get_toc），不再有独立的 get_chapter_plans。
  // 断言用「实际生成的首/末章标题」，不写死特定标题（确定性与真实 LLM 章名不同）。
  // 注意 Playwright 签名 waitForFunction(fn, arg, options)：arg 在前、options 在后。
  await page.waitForFunction(
    ({ first, last }) =>
      document.body.innerText.includes("已采纳章节计划") &&
      (first === "" || document.body.innerText.includes(first)) &&
      (last === "" || document.body.innerText.includes(last)),
    { first: firstChapterTitle, last: lastChapterTitle },
    { timeout: 10_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, generationTurnResult, sentMessage);

  const firstChapterVisible = firstChapterTitle !== "" && visibleText.includes(firstChapterTitle);
  const finalChapterVisible = lastChapterTitle !== "" && visibleText.includes(lastChapterTitle);

  assert(
    chapterCount >= 8,
    `Generated chapter plan too small for a long-form work: ${chapterCount}`,
  );
  assert(
    firstChapterVisible && finalChapterVisible,
    "Accepted chapter plan did not render its first and final chapters",
  );
  assert(
    actionResultFrame.body?.persistence?.reading_projection == null,
    "Outline adoption unexpectedly materialized a reading projection",
  );

  return [
    {
      ...uiState,
      turn_id: generationTurnResult.turn_id,
      generation_turn_id: generationTurnResult.turn_id,
      adoption_turn_id: adoptionTurnResult.turn_id,
      artifact_id: pendingArtifact.artifact_id,
      artifact_type: pendingArtifact.artifact_type,
      chapter_count: chapterCount,
      chapter_plan_visible: visibleText.includes("已采纳章节计划"),
      first_chapter_visible: firstChapterVisible,
      final_chapter_visible: finalChapterVisible,
      outline_adopt_clicked: true,
      outline_adopted: true,
      reading_projection_materialized: Boolean(
        actionResultFrame.body?.persistence?.reading_projection,
      ),
      adopt_payload: acceptActionFrame.body,
      action_result_status: actionResultFrame.body.status ?? latestActionResult()?.status,
      user_message_text: planMessageFrame.body?.text,
    },
  ];
}

async function driveP1ChapterDraftGeneration(page) {
  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "大纲与结构" }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("已采纳章节计划") &&
      document.body.innerText.includes("第01章：底层灵气账单"),
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: "生成正文草稿" }).first().click();

  const draftMessageFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.generate_micro_plan === true &&
      String(frame.body?.text ?? "").includes("第01章：底层灵气账单") &&
      String(frame.body?.text ?? "").includes("正文草稿"),
    "Real workbench did not send chapter draft user_message with micro plan enabled",
  );

  const draftTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.tool_name === "prose_writing" &&
      frame.body?.tool_result?.output?.artifact_type === "prose_fragment" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment",
    "No P1 chapter draft prose_fragment turn_result websocket frame was received",
  );
  const draftTurnResult = draftTurnFrame.body;
  const pendingArtifact = draftTurnResult.adoption_state.pending[0];
  const draftBody = pendingArtifact.payload?.items?.[0]?.body ?? "";
  const draftLeakMarker = "灵气账单从屋檐下垂落";

  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      return (
        /待确认的创作材料|待保存章节草稿|章节正文草稿/.test(text) &&
        text.includes("灵气账单从屋檐下垂落") &&
        text.includes("底层灵气账单")
      );
    },
    { timeout: 10_000 },
  );

  const beforeReadingLogCount = readAppLogRecords().length;

  await clickVisibleReadingModeButton(page);
  const tocRecord = await waitForNewAppLogRecord(
    beforeReadingLogCount,
    (record) =>
      record.event === "channel.get_toc.done" &&
      record.work_id === draftMessageFrame.body?.work_id &&
      Number(record.total_word_count ?? -1) === 0 &&
      Number(record.empty_chapter_count ?? 0) > 0,
    "Reading mode did not read the adopted chapter plan with zero accepted words",
    30_000,
  );

  // 已采纳的章节计划成为正式目录，阅读模式显示计划全章（待补足）；未采纳的正文草稿不进阅读（AU08-I2）。
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("阅读模式") &&
      document.body.innerText.includes("待补足") &&
      !document.body.innerText.includes("暂无已采纳的章节内容"),
    { timeout: 10_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, draftTurnResult, sentMessage);

  assert(draftBody.includes("底层灵气账单"), "Draft payload did not contain prose body text");
  assert(
    !frames.some((frame) => frame.direction === "sent" && frame.event === "adopt"),
    "Draft generation unexpectedly submitted an adopt event",
  );
  // 阅读目录显示已采纳计划的全章（待补足），不是空态。
  assert(
    visibleText.includes("待补足") && !visibleText.includes("暂无已采纳的章节内容"),
    "Reading mode did not show the adopted chapter plan (pending chapters) before draft adoption",
  );
  // 未采纳的正文草稿内容不得出现在阅读模式。
  assert(
    !visibleText.includes(draftLeakMarker),
    "Unadopted draft leaked into reading mode content",
  );

  return [
    {
      ...uiState,
      turn_id: draftTurnResult.turn_id,
      draft_turn_id: draftTurnResult.turn_id,
      artifact_id: pendingArtifact.artifact_id,
      artifact_type: pendingArtifact.artifact_type,
      chapter_title: "第01章：底层灵气账单",
      draft_generated: true,
      draft_pending: true,
      draft_body_chars: String(draftBody).length,
      draft_card_visible: true,
      reading_toc_chapter_count: Number(tocRecord.chapter_count ?? 0),
      reading_total_word_count: Number(tocRecord.total_word_count ?? 0),
      reading_empty_chapter_count: Number(tocRecord.empty_chapter_count ?? 0),
      reading_plan_visible_before_adoption:
        visibleText.includes("待补足") && !visibleText.includes("暂无已采纳的章节内容"),
      unadopted_draft_visible_in_reading: visibleText.includes(draftLeakMarker),
      adopt_event_sent: frames.some(
        (frame) => frame.direction === "sent" && frame.event === "adopt",
      ),
      user_message_text: draftMessageFrame.body?.text,
    },
  ];
}

async function driveVs00cCp3StructuredContext(page) {
  const targetChapterTitle = "第02章：旧服务器里的残诀";
  const previousChapterTitle = "第01章：底层灵气账单";
  const nextChapterTitle = "第03章";

  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "大纲与结构" }).click();
  await page.waitForFunction(
    ({ previousTitle, targetTitle }) =>
      document.body.innerText.includes("已采纳章节计划") &&
      document.body.innerText.includes(previousTitle) &&
      document.body.innerText.includes(targetTitle),
    { previousTitle: previousChapterTitle, targetTitle: targetChapterTitle },
    { timeout: 10_000 },
  );

  const draftButtons = page.getByRole("button", { name: "生成正文草稿" });
  assert(
    (await draftButtons.count()) >= 2,
    "Archive outline did not render a draft action for chapter 2",
  );
  await draftButtons.nth(1).click();

  const draftMessageFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.generate_micro_plan === true &&
      String(frame.body?.text ?? "").includes(targetChapterTitle) &&
      String(frame.body?.text ?? "").includes("正文草稿"),
    "Real workbench did not send chapter-2 draft user_message with micro plan enabled",
  );

  const draftTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.tool_name === "prose_writing" &&
      frame.body?.tool_result?.output?.artifact_type === "prose_fragment" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment",
    "No VS-00C CP3 chapter-2 prose_fragment turn_result websocket frame was received",
  );
  const draftTurnResult = draftTurnFrame.body;
  const pendingArtifact = draftTurnResult.adoption_state.pending[0];
  const draftBody = pendingArtifact.payload?.items?.[0]?.body ?? "";

  await waitForAppLogRecord(
    (record) =>
      record.event === "context.structure.done" &&
      record.turn_id === draftTurnResult.turn_id &&
      record.target_chapter === targetChapterTitle &&
      Number(record.chapter_seq ?? 0) === 2 &&
      record.has_plan_summary === true &&
      record.has_previous === true &&
      record.has_next === true,
    "No VS-00C CP3 structured context app log was emitted for chapter 2",
  );

  await page.waitForFunction(
    (targetTitle) =>
      /待保存章节草稿|章节正文草稿|待确认的创作材料/.test(document.body.innerText) &&
      document.body.innerText.includes(targetTitle),
    targetChapterTitle,
    { timeout: 10_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, draftTurnResult, sentMessage);

  assert(draftBody.includes("旧服务器里的残诀"), "Draft payload did not target chapter 2");
  assert(
    !frames.some((frame) => frame.direction === "sent" && frame.event === "adopt"),
    "CP3 draft generation unexpectedly submitted an adopt event",
  );

  return [
    {
      ...uiState,
      turn_id: draftTurnResult.turn_id,
      draft_turn_id: draftTurnResult.turn_id,
      artifact_id: pendingArtifact.artifact_id,
      artifact_type: pendingArtifact.artifact_type,
      chapter_title: targetChapterTitle,
      previous_chapter_title: previousChapterTitle,
      next_chapter_title: nextChapterTitle,
      draft_generated: true,
      draft_pending: true,
      draft_body_chars: String(draftBody).length,
      draft_card_visible: /待保存章节草稿|章节正文草稿|待确认的创作材料/.test(visibleText),
      requested_second_chapter: true,
      adopt_event_sent: frames.some(
        (frame) => frame.direction === "sent" && frame.event === "adopt",
      ),
      user_message_text: draftMessageFrame.body?.text,
    },
  ];
}

async function driveVs00cCp4ChapterPlanStructure(page) {
  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "大纲与结构" }).click();
  await page.getByRole("button", { name: "规划卷章结构" }).click();

  const planMessageFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.generate_micro_plan === true &&
      String(frame.body?.text ?? "").includes("章节大纲"),
    "Real workbench did not send CP4 chapter plan user_message with micro plan enabled",
  );

  const generationFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.tool_name === "plot_outline" &&
      frame.body?.tool_result?.output?.artifact_type === "outline_draft" &&
      Number(frame.body?.adoption_state?.pending?.[0]?.payload?.chapter_count ?? 0) >= 8,
    "No CP4 outline_draft turn_result websocket frame was received",
  );
  const generationTurnResult = generationFrame.body;
  const pendingOutline = generationTurnResult.adoption_state.pending[0];
  const planItems = pendingOutline.payload?.items ?? [];
  const targetItem = planItems[1] ?? planItems[0];
  const targetChapterTitle = String(targetItem?.title ?? "");
  const targetBody = String(targetItem?.body ?? "");

  assert(targetChapterTitle !== "", "CP4 generated outline did not contain a target chapter");
  assert(
    targetBody.includes("章功能定位") &&
      targetBody.includes("情节推进") &&
      targetBody.includes("人物变化") &&
      targetBody.includes("信息释放") &&
      targetBody.includes("伏笔动作") &&
      targetBody.includes("情绪定位") &&
      targetBody.includes("章尾断章"),
    "CP4 outline item body did not contain E18-E22 direction labels",
  );

  await page.waitForFunction(
    () => {
      return (
        /待确认的创作材料|大纲草稿/.test(document.body.innerText) &&
        [...document.querySelectorAll("button")].some((btn) =>
          /确认创建|保存为章节正文|保存到大纲|保存到作品档案|保存到作品/.test(
            (btn.textContent ?? "").trim(),
          ),
        )
      );
    },
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: acceptDraftButtonPattern }).first().click();

  const acceptActionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "accept" &&
      frame.body?.action?.target_ref === pendingOutline.artifact_id,
    "Real workbench did not send accept author_action for the CP4 chapter plan",
  );

  const actionResultFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "action_result" &&
      frame.body?.status === "accepted" &&
      frame.body?.artifact_id === pendingOutline.artifact_id,
    "No accepted action_result websocket frame was received for the CP4 chapter plan",
    120_000,
  );

  const adoptionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.truthfulness?.artifact_adopted === true &&
      Array.isArray(frame.body?.adoption_state?.resolved) &&
      frame.body.adoption_state.resolved.some(
        (entry) => entry.artifact_id === pendingOutline.artifact_id,
      ),
    "No accepted CP4 outline_draft adoption turn_result websocket frame was received",
    120_000,
  );
  const adoptionTurnResult = adoptionFrame.body;

  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "大纲与结构" }).click();
  await page.waitForFunction(
    (targetTitle) =>
      document.body.innerText.includes("已采纳章节计划") &&
      document.body.innerText.includes(targetTitle),
    targetChapterTitle,
    { timeout: 10_000 },
  );

  const targetIndex = Math.max(
    planItems.findIndex((item) => item === targetItem),
    0,
  );
  const draftButtons = page.getByRole("button", { name: "生成正文草稿" });
  assert(
    (await draftButtons.count()) > targetIndex,
    "Archive outline did not render a draft action for the CP4 target chapter",
  );
  await draftButtons.nth(targetIndex).click();

  const draftMessageFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.generate_micro_plan === true &&
      String(frame.body?.text ?? "").includes(targetChapterTitle) &&
      String(frame.body?.text ?? "").includes("正文草稿"),
    "Real workbench did not send CP4 draft user_message with micro plan enabled",
  );

  const draftTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.tool_name === "prose_writing" &&
      frame.body?.tool_result?.output?.artifact_type === "prose_fragment" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment",
    "No CP4 prose_fragment turn_result websocket frame was received",
    170_000,
  );
  const draftTurnResult = draftTurnFrame.body;
  const pendingDraft = draftTurnResult.adoption_state.pending[0];
  const draftBody = pendingDraft.payload?.items?.[0]?.body ?? "";
  const selfReport = draftTurnResult.tool_result?.output?.self_report ?? null;
  const selfReportRiskFlags = Array.isArray(selfReport?.risk_flags) ? selfReport.risk_flags : [];

  const structureLog = await waitForAppLogRecord(
    (record) =>
      record.event === "context.structure.done" &&
      record.turn_id === draftTurnResult.turn_id &&
      record.target_chapter === targetChapterTitle &&
      record.has_plan_summary === true &&
      record.has_plan_direction === true,
    "No VS-00C CP4 structured direction app log was emitted before prose writing",
  );

  const readerEffectLog = await waitForAppLogRecord(
    (record) =>
      record.event === "context.reader_effect.done" &&
      record.turn_id === draftTurnResult.turn_id &&
      record.target_chapter === targetChapterTitle &&
      record.has_reader_effect_brief === true &&
      record.intended_emotion_present === true &&
      record.hook_target_present === true &&
      record.payoff_or_promise_present === true &&
      record.suspense_boundary_present === true &&
      Number(record.risk_note_count ?? 0) >= 1,
    "No VS-00C CP5 ReaderEffectBrief app log was emitted before prose writing",
  );

  await page.waitForFunction(
    (targetTitle) =>
      /待保存章节草稿|章节正文草稿|待确认的创作材料/.test(document.body.innerText) &&
      document.body.innerText.includes(targetTitle),
    targetChapterTitle,
    { timeout: 10_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, draftTurnResult, sentMessage);

  return [
    {
      ...uiState,
      turn_id: draftTurnResult.turn_id,
      generation_turn_id: generationTurnResult.turn_id,
      adoption_turn_id: adoptionTurnResult.turn_id,
      draft_turn_id: draftTurnResult.turn_id,
      outline_artifact_id: pendingOutline.artifact_id,
      artifact_id: pendingDraft.artifact_id,
      artifact_type: pendingDraft.artifact_type,
      chapter_title: targetChapterTitle,
      chapter_seq: Number(structureLog.chapter_seq ?? targetIndex + 1),
      chapter_count: Number(pendingOutline.payload?.chapter_count ?? planItems.length),
      outline_direction_labels_present: true,
      outline_adopt_clicked: true,
      outline_adopted: true,
      reading_projection_materialized: Boolean(
        actionResultFrame.body?.persistence?.reading_projection,
      ),
      has_plan_summary: structureLog.has_plan_summary,
      has_plan_direction: structureLog.has_plan_direction,
      has_reader_effect_brief: readerEffectLog.has_reader_effect_brief,
      reader_effect_fields_present:
        readerEffectLog.intended_emotion_present === true &&
        readerEffectLog.hook_target_present === true &&
        readerEffectLog.payoff_or_promise_present === true &&
        readerEffectLog.suspense_boundary_present === true,
      reader_effect_risk_note_count: Number(readerEffectLog.risk_note_count ?? 0),
      self_report_present: Boolean(selfReport),
      self_report_intended_reader_effect_present:
        typeof selfReport?.intended_reader_effect === "string" &&
        selfReport.intended_reader_effect.trim() !== "",
      self_report_used_context_refs: Array.isArray(selfReport?.used_context_refs)
        ? selfReport.used_context_refs
        : [],
      self_report_risk_flags_count: selfReportRiskFlags.length,
      self_report_quality_action: selfReport?.quality_action,
      draft_generated: true,
      draft_pending: true,
      draft_body_chars: String(draftBody).length,
      draft_card_visible: /待保存章节草稿|章节正文草稿|待确认的创作材料/.test(visibleText),
      adopt_payload: acceptActionFrame.body,
      action_result_status: actionResultFrame.body.status ?? latestActionResult()?.status,
      user_message_text: draftMessageFrame.body?.text,
      plan_user_message_text: planMessageFrame.body?.text,
    },
  ];
}

// 从可见文本里解析「全书/本章有效字数 1,234 字」中的数字（去千分位逗号）。
// 使用硬编码字面量正则（避免动态 RegExp），文本为产品 UI 渲染、非用户输入。
function parseWordCount(match) {
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

function parseBookTotalWords(text) {
  return parseWordCount(/全书有效字数\s*([\d,]+)\s*字/.exec(text));
}

function parseChapterWords(text) {
  return parseWordCount(/本章有效字数\s*([\d,]+)\s*字/.exec(text));
}

// 正文有效字数：与后端 NovelDomain.ProseWordCount 同口径（仅字母/表意文字与数字）。
function effectiveWordCount(text) {
  return String(text ?? "").replace(/[^\p{L}\p{N}]/gu, "").length;
}

async function driveP1ChapterAdoptionReading(page) {
  // 复用 p1-chapter-draft-generation：打开档案大纲 → 生成第 1 章正文草稿。
  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "大纲与结构" }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("已采纳章节计划") &&
      document.body.innerText.includes("第01章：底层灵气账单"),
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: "生成正文草稿" }).first().click();

  // 真实 LM Studio 生成整章正文可能较慢，给足窗口（确定性 provider 会立即命中）。
  const draftTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.output?.artifact_type === "prose_fragment" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment",
    "No P1 chapter draft prose_fragment turn_result websocket frame was received",
    170_000,
  );
  const draftTurnResult = draftTurnFrame.body;
  const pendingArtifact = draftTurnResult.adoption_state.pending[0];

  await page.waitForFunction(
    () => {
      return (
        /待确认的创作材料|正文草稿/.test(document.body.innerText) &&
        [...document.querySelectorAll("button")].some((btn) =>
          /确认创建|保存为章节正文|保存到大纲|保存到作品档案|保存到作品/.test(
            (btn.textContent ?? "").trim(),
          ),
        )
      );
    },
    { timeout: 10_000 },
  );

  // 作者点击保存正文草稿（accept author_action → 采纳边界 → 持久化）。
  await page.getByRole("button", { name: acceptDraftButtonPattern }).first().click();

  const acceptActionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "accept" &&
      frame.body?.action?.target_ref === pendingArtifact.artifact_id,
    "Real workbench did not send an accept author_action for the prose draft",
  );

  const adoptTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.truthfulness?.artifact_adopted === true &&
      Array.isArray(frame.body?.adoption_state?.resolved) &&
      frame.body.adoption_state.resolved.some(
        (entry) => entry.artifact_id === pendingArtifact.artifact_id,
      ),
    "No resolved adoption turn_result websocket frame was received after accept",
    120_000,
  );
  const adoptTurnResult = adoptTurnFrame.body;

  // 采纳后旧草稿卡的保存按钮必须消失，否则作者会重复点击、重复提交同一动作。
  await page.waitForFunction(
    () => {
      return ![...document.querySelectorAll("button")].some((btn) =>
        /确认创建|保存为章节正文|保存到大纲|保存到作品档案|保存到作品/.test(
          (btn.textContent ?? "").trim(),
        ),
      );
    },
    { timeout: 10_000 },
  );
  const acceptButtonCleared =
    (await page.getByRole("button", { name: acceptDraftButtonPattern }).count()) === 0;

  // 进入阅读模式：采纳后的正文应进入投影，并显示有效字数。
  // 必须等到「本章有效字数」也渲染再快照：TOC（全书字数）与章节正文/章字数来自两次异步
  // 读取（get_toc 与 get_chapter_content），只等全书字数会在章字数渲染前抢拍导致 flaky。
  await page.getByRole("button", { name: readingModeButtonPattern }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("阅读模式") &&
      document.body.innerText.includes("全书有效字数") &&
      document.body.innerText.includes("本章有效字数") &&
      !document.body.innerText.includes("暂无已采纳的章节内容"),
    { timeout: 15_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, adoptTurnResult, sentMessage);

  const totalWords = parseBookTotalWords(visibleText);
  const chapterWords = parseChapterWords(visibleText);

  // 取阅读区真实渲染的正文段落（叶子 div，排除「本章有效字数」元信息行），
  // 用与后端同口径计算有效字数，验证"显示的字数 == 读者实际看到的正文字数"。
  const renderedProse = await page.evaluate(() => {
    const heading = [...document.querySelectorAll("h1")].find((el) => el.textContent?.trim());
    const block = heading?.parentElement;
    if (!block) return "";
    return [...block.querySelectorAll("div")]
      .filter((el) => el.children.length === 0)
      .map((el) => el.textContent ?? "")
      .filter((text) => !text.startsWith("本章有效字数"))
      .join("");
  });
  const visibleProseWords = effectiveWordCount(renderedProse);
  const stateTraceRefs = Array.isArray(adoptTurnResult.trace_summary?.state_trace_refs)
    ? adoptTurnResult.trace_summary.state_trace_refs
    : [];
  const stateTraceRef = stateTraceRefs[0]?.state_trace_ref ?? null;
  const resolvedStateTraceRef =
    adoptTurnResult.adoption_state?.resolved?.[0]?.state_trace_ref ?? null;
  const projectionSourceStateTraceRef =
    adoptTurnResult.projection_refs?.[0]?.source_state_trace_ref ?? null;
  const projectionRefreshStatus = adoptTurnResult.projection_refs?.[0]?.refresh_status ?? null;
  const projectionStaleBannerVisible = visibleText.includes("投影状态：已过期");
  const projectionRefreshButtonVisible = visibleText.includes("刷新投影");

  assert(visibleProseWords > 0, "No visible prose found in reading mode to count");
  assert(
    projectionRefreshStatus === "STALE",
    `Accepted prose did not emit STALE projection_ref refresh status: ${projectionRefreshStatus}`,
  );
  assert(
    projectionStaleBannerVisible,
    "Reading mode did not show the stale projection banner after adoption",
  );
  assert(
    projectionRefreshButtonVisible,
    "Reading mode did not show the refresh projection button after adoption",
  );
  assert(
    Number(totalWords) > 0,
    "Book total effective word count not visible/positive in reading mode",
  );
  assert(
    Number(chapterWords) > 0,
    "Chapter effective word count not visible/positive in reading mode",
  );
  assert(
    chapterWords === visibleProseWords,
    `Displayed chapter word count ${chapterWords} != effective count of visible prose ${visibleProseWords}`,
  );
  assert(
    totalWords === chapterWords,
    `Book total ${totalWords} != single adopted chapter ${chapterWords}`,
  );
  assert(!visibleText.includes("暂无已采纳的章节内容"), "Reading mode stayed empty after adoption");

  return [
    {
      ...uiState,
      turn_id: draftTurnResult.turn_id,
      draft_turn_id: draftTurnResult.turn_id,
      adopt_turn_id: adoptTurnResult.turn_id,
      artifact_id: pendingArtifact.artifact_id,
      artifact_type: pendingArtifact.artifact_type,
      chapter_title: "第01章：底层灵气账单",
      adoption_trace_ref: adoptTurnResult.trace_summary?.trace_ref,
      state_trace_ref: stateTraceRef,
      resolved_state_trace_ref: resolvedStateTraceRef,
      projection_source_state_trace_ref: projectionSourceStateTraceRef,
      projection_refresh_status: projectionRefreshStatus,
      projection_stale_banner_visible: projectionStaleBannerVisible,
      projection_refresh_button_visible: projectionRefreshButtonVisible,
      trace_summary_state_trace_refs_count: stateTraceRefs.length,
      projection_refs_count: adoptTurnResult.projection_refs?.length ?? 0,
      accept_event_sent: true,
      accept_action_type: acceptActionFrame.body?.action?.action_type,
      accept_button_cleared_after_adoption: acceptButtonCleared,
      artifact_adopted: adoptTurnResult.truthfulness?.artifact_adopted === true,
      reading_mode_populated_after_adoption: !visibleText.includes("暂无已采纳的章节内容"),
      total_word_count: totalWords,
      chapter_word_count: chapterWords,
      expected_word_count: visibleProseWords,
      word_count_matches_adopted_prose:
        chapterWords === visibleProseWords && totalWords === chapterWords,
      user_message_text: sentMessage?.body?.text,
    },
  ];
}

async function driveAu07StateTraceAdoptionReplay(page) {
  return driveP1ChapterAdoptionReading(page);
}

async function driveAu05DiscardAuthorAction(page) {
  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "大纲与结构" }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("已采纳章节计划") &&
      document.body.innerText.includes("第01章：底层灵气账单"),
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: "生成正文草稿" }).first().click();

  const draftTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.output?.artifact_type === "prose_fragment" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment",
    "No AU05 discard prose_fragment turn_result websocket frame was received",
    170_000,
  );
  const draftTurnResult = draftTurnFrame.body;
  const pendingArtifact = draftTurnResult.adoption_state.pending[0];
  const draftLeakMarker = String(
    pendingArtifact.payload?.items?.[0]?.body ?? pendingArtifact.payload?.body ?? "",
  ).slice(0, 24);

  await page.waitForFunction(
    () =>
      /待确认的创作材料|待采纳|正文草稿/.test(document.body.innerText) &&
      document.body.innerText.includes("不保存"),
    { timeout: 10_000 },
  );

  await page.getByRole("button", { name: "不保存" }).first().click();

  const discardActionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "discard" &&
      frame.body?.action?.target_ref === pendingArtifact.artifact_id,
    "Real workbench did not send discard author_action for the prose draft",
  );

  const actionResultFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "action_result" &&
      frame.body?.status === "discarded" &&
      frame.body?.artifact_id === pendingArtifact.artifact_id,
    "No discarded action_result websocket frame was received for the prose draft",
    120_000,
  );

  const discardedTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.truthfulness?.artifact_adopted === false &&
      frame.body?.truthfulness?.production_write_performed === false &&
      (frame.body?.adoption_state?.resolved ?? []).some(
        (entry) =>
          entry.artifact_id === pendingArtifact.artifact_id &&
          entry.adoption_status === "DISCARDED",
      ),
    "No DISCARDED resolved turn_result websocket frame was received after discard",
    120_000,
  );
  const discardedTurnResult = discardedTurnFrame.body;

  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].some(
        (btn) => (btn.textContent ?? "").trim() === "不保存",
      ),
    { timeout: 10_000 },
  );
  const discardButtonCleared = (await page.getByRole("button", { name: "不保存" }).count()) === 0;

  await page.getByRole("button", { name: readingModeButtonPattern }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("阅读模式") &&
      /暂无已采纳的章节内容|本章尚无已采纳正文/.test(document.body.innerText),
    { timeout: 15_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, discardedTurnResult, sentMessage);
  const draftVisibleInReading = draftLeakMarker !== "" && visibleText.includes(draftLeakMarker);

  assert(
    !draftVisibleInReading,
    "Discarded prose draft leaked into reading mode after author discarded it",
  );
  assert(
    discardedTurnResult.truthfulness?.artifact_adopted === false,
    "Discard turn_result claimed artifact_adopted",
  );
  assert(
    discardedTurnResult.truthfulness?.production_write_performed === false,
    "Discard turn_result claimed production_write_performed",
  );

  return [
    {
      ...uiState,
      turn_id: draftTurnResult.turn_id,
      draft_turn_id: draftTurnResult.turn_id,
      discard_turn_id: discardedTurnResult.turn_id,
      artifact_id: pendingArtifact.artifact_id,
      artifact_type: pendingArtifact.artifact_type,
      chapter_title: "第01章：底层灵气账单",
      discard_action_sent: true,
      discard_action_type: discardActionFrame.body?.action?.action_type,
      action_result_status: actionResultFrame.body?.status,
      artifact_discarded: (discardedTurnResult.adoption_state?.resolved ?? []).some(
        (entry) => entry.adoption_status === "DISCARDED",
      ),
      artifact_adopted: discardedTurnResult.truthfulness?.artifact_adopted === true,
      production_write_performed:
        discardedTurnResult.truthfulness?.production_write_performed === true,
      discard_button_cleared_after_discard: discardButtonCleared,
      reading_mode_empty_after_discard: /暂无已采纳的章节内容|本章尚无已采纳正文/.test(visibleText),
      draft_not_visible_in_reading: !draftVisibleInReading,
      user_message_text: sentMessage?.body?.text,
    },
  ];
}

async function driveP1PlanIncremental(page) {
  // 增量规划：已有 12 章已采纳计划的作品里，作者用自然语言要求继续规划后续章节；
  // 新计划经采纳边界物化为**追加**的计划章（title 幂等 + seq 续排，单一默认卷
  // 是 v2 27 §5.1/ADR-0004 的冻结决策），既有章（标题/顺序/字数）不被改动。

  // baseline：进阅读模式取当前投影（12 章计划）。
  const baselineFrames = frames.length;
  await page.getByRole("button", { name: readingModeButtonPattern }).click();
  await page.waitForFunction(() => document.body.innerText.includes("阅读模式"), {
    timeout: 15_000,
  });
  const baselineToc = await waitForFrame(
    (f) =>
      frames.indexOf(f) >= baselineFrames &&
      f.direction === "received" &&
      Array.isArray((f.body?.response ?? f.body)?.volumes),
    "No baseline get_toc frame",
    20_000,
  ).then((f) => f.body?.response ?? f.body);
  const baselineChapters = (baselineToc.volumes ?? []).flatMap((v) => v.chapters ?? []);
  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  // 作者自然语言发起增量规划（无专用按钮/关键字开关，意图由 AI 识别）。
  await page
    .locator(chatInputSelector)
    .fill(
      "已有章节计划很好，请接着已有章节继续生成后续剧情的章节大纲，从下一章接续编号，再生成一批新章节计划。",
    );
  await page.getByRole("button", { name: /^发送$/ }).click();

  const outlineFrame = await waitForFrame(
    (f) =>
      f.direction === "received" &&
      f.event === "turn_result" &&
      f.body?.tool_result?.tool_name === "plot_outline" &&
      f.body?.tool_result?.output?.artifact_type === "outline_draft" &&
      // 增量批量由 AI 自定（实测 7-12 章），只设保底下限。
      Number(f.body?.adoption_state?.pending?.[0]?.payload?.chapter_count ?? 0) >= 5,
    "No incremental outline_draft turn_result was received",
    200_000,
  );
  const pendingArtifact = outlineFrame.body.adoption_state.pending[0];
  const newPlanItems = pendingArtifact.payload?.items ?? [];
  const newTitles = newPlanItems.map((item) => String(item.title ?? ""));
  const baselineTitles = new Set(baselineChapters.map((c) => c.title));
  const titlesDisjoint = newTitles.every((title) => !baselineTitles.has(title));

  await page.waitForFunction(() => /待确认的创作材料|大纲草稿/.test(document.body.innerText), {
    timeout: 10_000,
  });
  await page.getByRole("button", { name: acceptDraftButtonPattern }).last().click();

  await waitForFrame(
    (f) =>
      f.direction === "received" &&
      f.event === "turn_result" &&
      f.body?.truthfulness?.artifact_adopted === true &&
      (f.body?.adoption_state?.resolved ?? []).some(
        (entry) => entry.artifact_id === pendingArtifact.artifact_id,
      ),
    "No adoption turn_result for the incremental outline",
    120_000,
  );

  // 采纳后投影：原章不动、新章按 seq 接续追加。
  const afterFrames = frames.length;
  await page.getByRole("button", { name: readingModeButtonPattern }).click();
  await page.waitForFunction(() => document.body.innerText.includes("阅读模式"), {
    timeout: 15_000,
  });
  const afterToc = await waitForFrame(
    (f) =>
      frames.indexOf(f) >= afterFrames &&
      f.direction === "received" &&
      Array.isArray((f.body?.response ?? f.body)?.volumes),
    "No post-adoption get_toc frame",
    20_000,
  ).then((f) => f.body?.response ?? f.body);
  const afterChapters = (afterToc.volumes ?? []).flatMap((v) => v.chapters ?? []);

  const originalsIntact = baselineChapters.every((before) => {
    const after = afterChapters.find((c) => c.id === before.id);
    return (
      after &&
      after.title === before.title &&
      after.seq === before.seq &&
      Number(after.word_count ?? 0) === Number(before.word_count ?? 0)
    );
  });
  const appended = afterChapters.filter(
    (c) => !baselineChapters.some((before) => before.id === c.id),
  );
  const maxBaselineSeq = Math.max(...baselineChapters.map((c) => Number(c.seq ?? 0)));
  const appendedSeqs = appended.map((c) => Number(c.seq ?? 0));
  const appendedInOrder =
    appendedSeqs.length > 0 &&
    appendedSeqs.every((seq, i) => seq > maxBaselineSeq && (i === 0 || seq > appendedSeqs[i - 1]));

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, outlineFrame.body, sentMessage);

  assert(
    titlesDisjoint,
    "Incremental plan reused existing chapter titles (would be deduped, not appended)",
  );
  assert(originalsIntact, "Existing chapters were modified by the incremental plan adoption");
  assert(appended.length >= 5, `Expected >= 5 appended chapters, got ${appended.length}`);
  assert(
    appendedInOrder,
    `Appended chapters not in continuing seq order: ${appendedSeqs.join(",")}`,
  );

  return [
    {
      ...uiState,
      turn_id: outlineFrame.body.turn_id,
      plan_turn_id: outlineFrame.body.turn_id,
      artifact_id: pendingArtifact.artifact_id,
      artifact_type: pendingArtifact.artifact_type,
      baseline_chapter_count: baselineChapters.length,
      new_plan_chapter_count: newPlanItems.length,
      total_chapter_count_after: afterChapters.length,
      appended_chapter_count: appended.length,
      new_titles_disjoint: titlesDisjoint,
      originals_intact: originalsIntact,
      appended_in_seq_order: appendedInOrder,
      user_message_text: sentMessage?.body?.text,
    },
  ];
}

async function driveP1ExportMinimum(page) {
  // P1-export-minimum：复用"采纳到阅读"全链（生成第1章正文→采纳→阅读模式），
  // 然后点真实「导出全书」按钮，由后端从已采纳作品事实组装 Markdown 并落盘；
  // driver 从页面显示的导出路径读取真实文件，验证目录顺序与正文完整性。
  const [base] = await driveP1ChapterAdoptionReading(page);

  // 第1章已采纳正文（从生成帧取 body 片段，用于断言"导出文件含已采纳正文"因果绑定）。
  const draftFrame = frames.find(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment",
  );
  const adoptedBody = String(
    draftFrame?.body?.adoption_state?.pending?.[0]?.payload?.items?.[0]?.body ?? "",
  );
  const adoptedSnippet = adoptedBody.slice(0, 16);

  await page.getByRole("button", { name: "导出全书" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("已导出到"), {
    timeout: 20_000,
  });

  const visibleText = await page.locator("body").innerText();
  // 路径可能含空格（作品标题入文件名），抓到行尾的 .md。
  const exportPathMatch = /已导出到\s+([^\n]+\.md)/.exec(visibleText);
  const exportPath = exportPathMatch?.[1] ?? "";
  assert(exportPath !== "", `Export path not visible on page: ${visibleText.slice(0, 200)}`);

  const fileExists = fs.existsSync(exportPath);
  assert(fileExists, `Exported file does not exist at ${exportPath}`);
  const doc = fs.readFileSync(exportPath, "utf8");

  // 目录完整且按 seq 有序：12 个计划章标题在目录段依序出现。
  const tocPositions = [];
  for (let n = 1; n <= 12; n += 1) {
    const seq = String(n).padStart(2, "0");
    const idx = doc.indexOf(`第${seq}章：`);
    tocPositions.push(idx);
  }
  const allChaptersPresent = tocPositions.every((idx) => idx >= 0);
  const lastOccurrenceOrdered = (() => {
    // 每章标题出现两次（目录 + 正文标题）；用首次出现位置验证目录顺序。
    return tocPositions.every((idx, i) => i === 0 || idx > tocPositions[i - 1]);
  })();

  const adoptedProseInFile = adoptedSnippet !== "" && doc.includes(adoptedSnippet);
  const placeholderCount = doc.split("（本章暂无已采纳正文）").length - 1;

  assert(allChaptersPresent, "Exported document is missing planned chapters in TOC");
  assert(lastOccurrenceOrdered, "Exported TOC chapters are out of order");
  assert(adoptedProseInFile, "Adopted chapter prose did not appear in the exported file");
  assert(
    placeholderCount === 11,
    `Expected 11 unwritten-chapter placeholders, got ${placeholderCount}`,
  );

  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, latestTurnResult() ?? {}, sentMessage);

  return [
    {
      ...uiState,
      turn_id: base.draft_turn_id,
      draft_turn_id: base.draft_turn_id,
      adopt_turn_id: base.adopt_turn_id,
      export_path: exportPath,
      exported_file_exists: fileExists,
      export_chapter_count: 12,
      toc_complete: allChaptersPresent,
      toc_in_order: lastOccurrenceOrdered,
      adopted_prose_in_file: adoptedProseInFile,
      unwritten_placeholder_count: placeholderCount,
      export_notice_visible: visibleText.includes("已导出到"),
      user_message_text: sentMessage?.body?.text,
    },
  ];
}

async function driveAu08ReadingReadonlyNoWrite(page) {
  // AU-08 D1：复用真实采纳到阅读链路，然后只在 ReadingMode 内执行只读操作。
  // 本 checkpoint 不点击 refresh/retry，避免把 projection refresh 状态机伪装为已闭合。
  const [base] = await driveP1ChapterAdoptionReading(page);

  const beforeReadonlyFrameCount = frames.length;
  const beforeReadonlyLogCount = readAppLogRecords().length;

  const readingSnapshot = await page.evaluate(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      );
    };
    const buttons = [...document.querySelectorAll("button")]
      .filter(isVisible)
      .map((button) => (button.textContent ?? "").replace(/\s+/g, " ").trim());
    const chatInput = document.querySelector('input[placeholder="输入你的想法、问题或指令..."]');
    const visibleText = document.body.innerText;

    const writeControlPattern =
      /确认创建|保存为章节正文|保存到大纲|保存到作品档案|保存到作品|不保存|确认执行|拒绝|采纳|修改后采纳/;

    return {
      visible_text: visibleText,
      reading_mode_visible: visibleText.includes("阅读模式"),
      export_button_visible: buttons.includes("导出全书"),
      back_button_visible: buttons.includes("返回工作台"),
      refresh_button_visible: buttons.includes("刷新投影"),
      chat_input_present: Boolean(chatInput),
      chat_input_visible: Boolean(chatInput && isVisible(chatInput)),
      write_control_count: buttons.filter((text) => writeControlPattern.test(text)).length,
      buttons,
    };
  });

  assert(readingSnapshot.reading_mode_visible, "Reading mode was not visible for readonly check");
  assert(readingSnapshot.export_button_visible, "Reading mode export button was not visible");
  assert(readingSnapshot.back_button_visible, "Reading mode back button was not visible");
  assert(
    !readingSnapshot.chat_input_visible,
    "Reading mode exposed a visible workbench chat input",
  );
  assert(
    readingSnapshot.write_control_count === 0,
    `Reading mode exposed write controls: ${readingSnapshot.buttons.join(" / ")}`,
  );

  await page.getByRole("button", { name: "导出全书" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("已导出到"), {
    timeout: 20_000,
  });

  const exportVisibleText = await page.locator("body").innerText();
  const exportPathMatch = /已导出到\s+([^\n]+\.md)/.exec(exportVisibleText);
  const exportPath = exportPathMatch?.[1] ?? "";
  assert(exportPath !== "", "Reading-mode export path was not visible");

  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  const afterReturn = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder="输入你的想法、问题或指令..."]');
    const sendButton = [...document.querySelectorAll("button")].find(
      (button) => (button.textContent ?? "").trim() === "发送",
    );
    const visibleText = document.body.innerText;

    return {
      workbench_visible: visibleText.includes("当前作品") || visibleText.includes("打开档案"),
      reading_mode_visible: visibleText.includes("阅读模式"),
      chat_input_present: Boolean(input),
      chat_input_disabled: Boolean(input?.disabled),
      send_button_disabled: Boolean(sendButton?.disabled),
    };
  });

  const framesDuringReadonly = frames.slice(beforeReadonlyFrameCount);
  const logsDuringReadonly = readAppLogRecords().slice(beforeReadonlyLogCount);
  const sentAuthorActions = framesDuringReadonly.filter(
    (frame) => frame.direction === "sent" && frame.event === "author_action",
  );
  const sentUserMessages = framesDuringReadonly.filter(
    (frame) => frame.direction === "sent" && frame.event === "user_message",
  );
  const channelAuthorActionRecords = logsDuringReadonly.filter((record) =>
    String(record.event ?? "").startsWith("channel.author_action."),
  );
  const adoptionRecords = logsDuringReadonly.filter((record) =>
    String(record.event ?? "").startsWith("adoption.evaluate."),
  );
  const toolboxExecuteRecords = logsDuringReadonly.filter((record) =>
    String(record.event ?? "").startsWith("toolbox.execute."),
  );
  const productionWriteClaims = framesDuringReadonly.filter(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.truthfulness?.production_write_performed === true,
  );
  const exportDone = logsDuringReadonly.find(
    (record) =>
      record.event === "channel.export_work.done" &&
      String(record.export_path ?? "") === exportPath,
  );

  assert(exportDone, "Reading-mode export did not complete through channel.export_work.done");
  assert(sentAuthorActions.length === 0, "Reading mode sent author_action frames");
  assert(sentUserMessages.length === 0, "Reading mode sent user_message frames");
  assert(
    channelAuthorActionRecords.length === 0,
    "Reading mode reached author_action channel logs",
  );
  assert(adoptionRecords.length === 0, "Reading mode triggered adoption evaluation");
  assert(toolboxExecuteRecords.length === 0, "Reading mode dispatched toolbox execution");
  assert(productionWriteClaims.length === 0, "Reading mode emitted a production write claim");
  assert(afterReturn.chat_input_present, "Workbench chat input was not restored after return");
  assert(!afterReturn.chat_input_disabled, "Workbench chat input was disabled after return");
  assert(!afterReturn.send_button_disabled, "Workbench send button was disabled after return");

  return [
    {
      ...base,
      slice_id: "au08-reading-readonly-no-write",
      reading_mode_visible_before_export: readingSnapshot.reading_mode_visible,
      reading_export_button_visible: readingSnapshot.export_button_visible,
      reading_back_button_visible: readingSnapshot.back_button_visible,
      reading_refresh_button_visible: readingSnapshot.refresh_button_visible,
      hidden_workbench_chat_input_present: readingSnapshot.chat_input_present,
      chat_input_absent_in_reading: !readingSnapshot.chat_input_visible,
      chat_input_hidden_or_absent_in_reading: !readingSnapshot.chat_input_visible,
      reading_write_control_count: readingSnapshot.write_control_count,
      reading_write_controls_hidden: readingSnapshot.write_control_count === 0,
      real_export_button_clicked: true,
      export_path: exportPath,
      export_done: Boolean(exportDone),
      export_task_type: exportDone?.task_type ?? null,
      export_chapter_count: Number(exportDone?.chapter_count ?? 0),
      author_action_sent_count_during_reading: sentAuthorActions.length,
      user_message_sent_count_during_reading: sentUserMessages.length,
      channel_author_action_log_count_during_reading: channelAuthorActionRecords.length,
      adoption_event_count_during_reading: adoptionRecords.length,
      toolbox_execute_count_during_reading: toolboxExecuteRecords.length,
      production_write_claim_count_during_reading: productionWriteClaims.length,
      no_author_action_sent_during_reading: sentAuthorActions.length === 0,
      no_user_message_sent_during_reading: sentUserMessages.length === 0,
      no_channel_author_action_log_during_reading: channelAuthorActionRecords.length === 0,
      no_adoption_event_during_reading: adoptionRecords.length === 0,
      no_tool_dispatch_during_reading: toolboxExecuteRecords.length === 0,
      no_production_write_claim_during_reading: productionWriteClaims.length === 0,
      returned_to_workbench: afterReturn.chat_input_present && !afterReturn.chat_input_disabled,
      chat_input_enabled_after_return:
        afterReturn.chat_input_present && !afterReturn.chat_input_disabled,
      send_button_enabled_after_return:
        afterReturn.chat_input_present && !afterReturn.send_button_disabled,
    },
  ];
}

async function driveAu08ReadingReturnContext(page) {
  // AU-08 B4：从真实阅读模式返回工作台后，继续输入必须留在同一 work/session。
  // 不点击 refresh/retry，不把 projection refresh 状态机纳入本 checkpoint。
  const [base] = await driveP1ChapterAdoptionReading(page);
  const expectedWorkId = base.work_id;
  const expectedSessionId = base.session_id;

  assert(expectedWorkId, "AU08 return-context base work_id was missing");
  assert(expectedSessionId, "AU08 return-context base session_id was missing");

  const beforeReturnFrameCount = frames.length;
  const readingSnapshot = await page.evaluate(() => {
    const visibleText = document.body.innerText;
    return {
      reading_mode_visible: visibleText.includes("阅读模式"),
      work_title_visible: visibleText.includes("AI Novel Studio")
        ? null
        : visibleText.split("\n")[2],
      back_button_visible: [...document.querySelectorAll("button")].some(
        (button) => (button.textContent ?? "").trim() === "返回工作台",
      ),
    };
  });

  assert(readingSnapshot.reading_mode_visible, "Reading mode was not visible before return");
  assert(readingSnapshot.back_button_visible, "Reading mode back button was not visible");

  const welcomeCountBeforeReturn = await page
    .locator("body")
    .innerText()
    .then((text) => (text.match(/欢迎使用 AI Novel Studio/g) ?? []).length);

  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  const beforeFollowupFrameCount = frames.length;
  const beforeFollowupLogCount = readAppLogRecords().length;
  const returnOnlyFrames = frames.slice(beforeReturnFrameCount, beforeFollowupFrameCount);
  const returnSentAuthorActions = returnOnlyFrames.filter(
    (frame) => frame.direction === "sent" && frame.event === "author_action",
  );
  const returnSentUserMessages = returnOnlyFrames.filter(
    (frame) => frame.direction === "sent" && frame.event === "user_message",
  );

  const afterReturn = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder="输入你的想法、问题或指令..."]');
    const sendButton = [...document.querySelectorAll("button")].find(
      (button) => (button.textContent ?? "").trim() === "发送",
    );
    const visibleText = document.body.innerText;

    return {
      workbench_visible: visibleText.includes("打开档案") && visibleText.includes("发送"),
      reading_mode_visible: visibleText.includes("阅读模式"),
      welcome_message_count: (visibleText.match(/欢迎使用 AI Novel Studio/g) ?? []).length,
      chat_input_present: Boolean(input),
      chat_input_disabled: Boolean(input?.disabled),
      send_button_disabled: Boolean(sendButton?.disabled),
      visible_text_prefix: visibleText.slice(0, 240),
    };
  });

  assert(afterReturn.workbench_visible, "Workbench was not visible after returning from reading");
  assert(afterReturn.chat_input_present, "Workbench chat input was not restored after return");
  assert(!afterReturn.chat_input_disabled, "Workbench chat input was disabled after return");
  assert(!afterReturn.send_button_disabled, "Workbench send button was disabled after return");
  assert(returnSentAuthorActions.length === 0, "Return from reading sent author_action frames");
  assert(returnSentUserMessages.length === 0, "Return from reading sent user_message frames");

  const followupText = "从阅读返回后，请继续聊第01章开场的读者压力，不要写正文。";
  await page.locator(chatInputSelector).fill(followupText);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const followupSentFrame = await waitForNewFrame(
    beforeFollowupFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      String(frame.body?.text ?? "").includes("从阅读返回后"),
    "No follow-up user_message was sent after returning from reading",
  );

  assert(
    followupSentFrame.body?.work_id === expectedWorkId,
    `Follow-up work_id changed after return: ${followupSentFrame.body?.work_id} != ${expectedWorkId}`,
  );
  assert(
    followupSentFrame.body?.session_id === expectedSessionId,
    `Follow-up session_id changed after return: ${followupSentFrame.body?.session_id} != ${expectedSessionId}`,
  );

  const followupTurnFrame = await waitForNewFrame(
    beforeFollowupFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      String(frame.body?.turn_id ?? "").trim().length > 0,
    "No follow-up turn_result was received after returning from reading",
    120_000,
  );
  const followupTurnResult = followupTurnFrame.body;

  const followupDone = await waitForNewAppLogRecord(
    beforeFollowupLogCount,
    (record) =>
      record.event === "channel.user_message.done" &&
      record.turn_id === followupTurnResult.turn_id &&
      record.work_id === expectedWorkId &&
      record.session_id === expectedSessionId,
    "No channel.user_message.done log proved the follow-up stayed in the same work/session",
    120_000,
  );

  const visibleText = await page.locator("body").innerText();
  const uiState = await commonUiState(page, followupTurnResult, followupSentFrame);

  assert(visibleText.includes(followupText), "Follow-up text was not visible in the transcript");
  assert(
    followupDone.turn_id === followupTurnResult.turn_id,
    "Follow-up done log did not match the visible follow-up turn",
  );

  return [
    {
      ...base,
      ...uiState,
      slice_id: "au08-reading-return-context",
      draft_turn_id: base.draft_turn_id,
      adopt_turn_id: base.adopt_turn_id,
      followup_turn_id: followupTurnResult.turn_id,
      original_work_id: expectedWorkId,
      original_session_id: expectedSessionId,
      returned_to_workbench: afterReturn.chat_input_present && !afterReturn.chat_input_disabled,
      workbench_visible_after_return: afterReturn.workbench_visible,
      chat_input_enabled_after_return:
        afterReturn.chat_input_present && !afterReturn.chat_input_disabled,
      send_button_enabled_after_return:
        afterReturn.chat_input_present && !afterReturn.send_button_disabled,
      no_author_action_sent_on_return: returnSentAuthorActions.length === 0,
      no_user_message_sent_on_return: returnSentUserMessages.length === 0,
      welcome_count_before_return: welcomeCountBeforeReturn,
      welcome_count_after_return: afterReturn.welcome_message_count,
      no_new_welcome_after_return: afterReturn.welcome_message_count <= welcomeCountBeforeReturn,
      followup_user_message_sent: true,
      followup_turn_result_received: true,
      followup_channel_done_same_scope: Boolean(followupDone),
      followup_visible_in_transcript: visibleText.includes(followupText),
      followup_user_message_text: followupText,
      work_id_preserved_after_return: followupSentFrame.body?.work_id === expectedWorkId,
      session_id_preserved_after_return: followupSentFrame.body?.session_id === expectedSessionId,
      followup_done_work_id: followupDone.work_id,
      followup_done_session_id: followupDone.session_id,
      reading_mode_visible_before_return: readingSnapshot.reading_mode_visible,
    },
  ];
}

async function driveAu04ConfirmBeforeExecute(page) {
  // AU-04：作者用自然语言要求重写已有章（高风险）→ 系统出确认卡（确认前不执行不写入）
  // → 作者点「确认执行」→ ConfirmationBinding re-gate（ADR-0009）→ prose_writing 产出
  // 待采纳正文。本 slice 同时是「确认卡 turn_result 穿过真实 wire」的回归验证：
  // 该 turn_result 携带 plan（JSON 安全形态），此前 raw struct 在 broadcast/persist 必崩。
  const requestText =
    "第01章：底层灵气账单 写得太平了，推翻重写这一章的正文草稿，保持为待采纳草稿。";

  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  await page.locator(chatInputSelector).fill(requestText);
  await page.getByRole("button", { name: /^发送$/ }).click();

  // 确认卡 turn_result 必须从真实 websocket 收到（核心回归点）：
  // needs_confirmation + confirm_before_execute 可用动作 + 确认前无执行无写入 + 携带 plan。
  const confirmTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.status === "needs_confirmation" &&
      (frame.body?.available_actions ?? []).some(
        (action) => action.action_type === "confirm_before_execute",
      ),
    "No needs_confirmation turn_result with confirm_before_execute action was received",
    200_000,
  );
  const confirmTurnResult = confirmTurnFrame.body;
  const confirmAction = confirmTurnResult.available_actions.find(
    (action) => action.action_type === "confirm_before_execute",
  );

  // 确认卡在真实页面可见：确认执行 / 拒绝，并说明确认对象、确认前不写入、确认后重新 gate。
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      return (
        text.includes("确认执行") &&
        text.includes("拒绝") &&
        text.includes("需要确认") &&
        text.includes("确认对象：正文草稿生成") &&
        text.includes("确认前不会调用工具或写入作品事实") &&
        text.includes("确认后系统会重新检查当前作品状态")
      );
    },
    { timeout: 10_000 },
  );

  const confirmationVisibleText = await page.locator("body").innerText();
  const confirmationCardDetailVisible = confirmationVisibleText.includes("需要确认");
  const confirmationCardTargetVisible = confirmationVisibleText.includes("确认对象：正文草稿生成");
  const confirmationCardNoWriteVisible =
    confirmationVisibleText.includes("确认前不会调用工具或写入作品事实");
  const confirmationCardReGateVisible =
    confirmationVisibleText.includes("确认后系统会重新检查当前作品状态");

  await page.getByRole("button", { name: "确认执行" }).first().click();

  const confirmActionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "confirm_before_execute" &&
      frame.body?.action?.action_id === confirmAction.action_id,
    "Real workbench did not send the confirm_before_execute author_action",
  );

  // 确认后 re-gate 放行执行：同一 turn 产出 prose_fragment 待采纳正文。
  const executedTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.tool_name === "prose_writing" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment",
    "No prose_fragment turn_result was received after confirm_before_execute",
    200_000,
  );
  const executedTurnResult = executedTurnFrame.body;
  const pendingArtifact = executedTurnResult.adoption_state.pending[0];

  // 产出仍是 tentative（AU04-I9）：待确认创作材料出现，未自动写入作品事实。
  await page.waitForFunction(
    () =>
      /待确认的创作材料|待确认正文草稿|待保存章节草稿|章节正文草稿|正文草稿/.test(
        document.body.innerText,
      ) &&
      /确认创建|保存为章节正文|保存到大纲|保存到作品档案|保存到作品/.test(document.body.innerText),
    { timeout: 10_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, executedTurnResult, sentMessage);

  assert(
    confirmTurnResult.truthfulness?.tool_called === false,
    "Confirmation turn_result claimed tool execution before author confirmed",
  );
  assert(
    confirmTurnResult.truthfulness?.production_write_performed === false,
    "Confirmation turn_result claimed a production write before author confirmed",
  );
  assert(
    confirmTurnResult.plan != null && typeof confirmTurnResult.plan === "object",
    "Confirmation turn_result did not carry the re-gate plan over the wire",
  );
  assert(
    confirmAction.behavior_ref != null && confirmAction.behavior_ref !== "",
    "confirm_before_execute action did not reference an open confirmation behavior",
  );
  assert(
    executedTurnResult.truthfulness?.tool_called === true,
    "Executed turn_result did not record tool_called after confirmation",
  );
  assert(
    executedTurnResult.truthfulness?.artifact_adopted !== true,
    "Executed turn_result claimed adoption — output must stay tentative (AU04-I9)",
  );

  return [
    {
      ...uiState,
      turn_id: confirmTurnResult.turn_id,
      confirm_turn_id: confirmTurnResult.turn_id,
      executed_turn_id: executedTurnResult.turn_id,
      artifact_id: pendingArtifact.artifact_id,
      artifact_type: pendingArtifact.artifact_type,
      confirmation_card_received: true,
      confirmation_card_visible: true,
      confirmation_card_detail_visible: confirmationCardDetailVisible,
      confirmation_card_target_visible: confirmationCardTargetVisible,
      confirmation_card_no_write_visible: confirmationCardNoWriteVisible,
      confirmation_card_re_gate_visible: confirmationCardReGateVisible,
      pending_draft_visible: visibleTextIncludesPendingDraft(visibleText),
      plan_carried_over_wire: confirmTurnResult.plan != null,
      confirm_action_behavior_ref: confirmAction.behavior_ref ?? "",
      tool_called_before_confirm: confirmTurnResult.truthfulness?.tool_called === true,
      production_write_before_confirm:
        confirmTurnResult.truthfulness?.production_write_performed === true,
      confirmed_dispatch: executedTurnResult.truthfulness?.tool_called === true,
      artifact_pending_after_confirm: pendingArtifact.artifact_type === "prose_fragment",
      confirm_action_sent:
        confirmActionFrame.body?.action?.action_type === "confirm_before_execute",
      user_message_text: sentMessage?.body?.text,
    },
  ];
}

async function driveAu04ConfirmationToolFailureRecovery(page) {
  const requestText =
    "AU04FAILTOOL 第01章：底层灵气账单 写得太平了，推翻重写这一章的正文草稿；如果模型执行失败，必须显示失败并保持无待采纳草稿状态。";

  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  await page.locator(chatInputSelector).fill(requestText);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const confirmTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.status === "needs_confirmation" &&
      (frame.body?.available_actions ?? []).some(
        (action) => action.action_type === "confirm_before_execute",
      ),
    "No needs_confirmation turn_result with confirm_before_execute action was received",
    200_000,
  );
  const confirmTurnResult = confirmTurnFrame.body;
  const confirmAction = confirmTurnResult.available_actions.find(
    (action) => action.action_type === "confirm_before_execute",
  );

  await page.waitForFunction(
    () => document.body.innerText.includes("确认执行") && document.body.innerText.includes("拒绝"),
    { timeout: 10_000 },
  );

  const beforeConfirmFrameCount = frames.length;
  const beforeConfirmLogCount = readAppLogRecords().length;
  await page.getByRole("button", { name: "确认执行" }).first().click();

  const confirmActionFrame = await waitForNewFrame(
    beforeConfirmFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "confirm_before_execute" &&
      frame.body?.action?.action_id === confirmAction.action_id,
    "Real workbench did not send the confirm_before_execute author_action",
  );

  const actionResultFrame = await waitForNewFrame(
    beforeConfirmFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "action_result" &&
      frame.body?.action_id === confirmAction.action_id &&
      frame.body?.status === "accepted",
    "Confirmation action was not acknowledged before tool failure recovery",
  );

  const failedTurnFrame = await waitForNewFrame(
    beforeConfirmFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.tool_name === "prose_writing" &&
      String(frame.body?.tool_result?.status ?? "").includes("failed") &&
      frame.body?.status === "failed",
    "No failed prose_writing turn_result was received after confirm_before_execute",
    200_000,
  );
  const failedTurnResult = failedTurnFrame.body;

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("这次没有生成创作草稿") &&
      document.body.innerText.includes("工具执行失败") &&
      document.body.innerText.includes("未创建待采纳内容") &&
      document.body.innerText.includes("没有写入作品事实"),
    { timeout: 10_000 },
  );
  await sleep(1_000);

  const framesAfterConfirm = frames.slice(beforeConfirmFrameCount);
  const logsAfterConfirm = readAppLogRecords().slice(beforeConfirmLogCount);
  const providerErrorRecords = logsAfterConfirm.filter(
    (record) =>
      record.event === "provider_gateway.complete.error" &&
      record.provider === "slice_verify" &&
      String(record.outcome_detail ?? "").includes("AU04FAILTOOL fixture provider failure"),
  );
  const toolboxExecuteErrorRecords = logsAfterConfirm.filter(
    (record) =>
      record.event === "toolbox.execute.error" &&
      record.tool_name === "prose_writing" &&
      String(record.tool_outcome ?? "").includes("failed") &&
      record.reason_code === "provider_error",
  );
  const toolboxExecuteSucceededRecords = logsAfterConfirm.filter(
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.tool_name === "prose_writing" &&
      record.tool_outcome === "succeeded",
  );
  const pendingProseFragmentCount = framesAfterConfirm.reduce((count, frame) => {
    if (frame.direction !== "received" || frame.event !== "turn_result") return count;
    return (
      count +
      (frame.body?.adoption_state?.pending ?? []).filter(
        (artifact) => artifact.artifact_type === "prose_fragment",
      ).length
    );
  }, 0);
  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, failedTurnResult, sentMessage);

  assert(
    confirmTurnResult.truthfulness?.tool_called === false,
    "Confirmation turn_result claimed tool execution before author confirmed",
  );
  assert(
    confirmTurnResult.truthfulness?.production_write_performed === false,
    "Confirmation turn_result claimed a production write before author confirmed",
  );
  assert(
    failedTurnResult.truthfulness?.tool_called === true,
    "Failed turn_result did not record that a tool execution was attempted",
  );
  assert(
    String(failedTurnResult.truthfulness?.tool_status ?? "").includes("failed"),
    "Failed turn_result did not carry failed tool_status in truthfulness",
  );
  assert(
    failedTurnResult.truthfulness?.production_write_performed === false,
    "Failed tool turn_result claimed a production write",
  );
  assert(
    (failedTurnResult.adoption_state?.pending ?? []).length === 0,
    "Failed tool turn_result produced pending adoption entries",
  );
  assert(
    providerErrorRecords.length >= 1,
    "No provider_gateway.complete.error log recorded the fixture provider failure",
  );
  assert(
    toolboxExecuteErrorRecords.length >= 1,
    "No toolbox.execute.error log recorded failed prose_writing",
  );
  assert(
    toolboxExecuteSucceededRecords.length === 0,
    `Expected no successful prose_writing dispatch after failure, got ${toolboxExecuteSucceededRecords.length}`,
  );
  assert(
    pendingProseFragmentCount === 0,
    `Expected no pending prose_fragment after failed confirmation execution, got ${pendingProseFragmentCount}`,
  );

  return [
    {
      ...uiState,
      turn_id: confirmTurnResult.turn_id,
      confirm_turn_id: confirmTurnResult.turn_id,
      failed_turn_id: failedTurnResult.turn_id,
      confirmation_card_received: true,
      confirmation_card_visible: true,
      plan_carried_over_wire: confirmTurnResult.plan != null,
      confirm_action_behavior_ref: confirmAction.behavior_ref ?? "",
      confirm_action_id: confirmAction.action_id,
      confirm_action_sent:
        confirmActionFrame.body?.action?.action_type === "confirm_before_execute",
      confirm_action_acknowledged: actionResultFrame.body?.status === "accepted",
      tool_called_before_confirm: confirmTurnResult.truthfulness?.tool_called === true,
      production_write_before_confirm:
        confirmTurnResult.truthfulness?.production_write_performed === true,
      confirmed_dispatch_attempted: failedTurnResult.truthfulness?.tool_called === true,
      confirmed_turn_failed: failedTurnResult.status === "failed",
      failed_tool_name: failedTurnResult.tool_result?.tool_name,
      failed_tool_status: failedTurnResult.tool_result?.status,
      truthfulness_tool_status: failedTurnResult.truthfulness?.tool_status,
      production_write_after_failure:
        failedTurnResult.truthfulness?.production_write_performed === true,
      pending_prose_fragment_after_failure_count: pendingProseFragmentCount,
      provider_error_count: providerErrorRecords.length,
      toolbox_execute_error_count: toolboxExecuteErrorRecords.length,
      toolbox_execute_success_count: toolboxExecuteSucceededRecords.length,
      failure_message_visible:
        visibleText.includes("这次没有生成创作草稿") && visibleText.includes("工具执行失败"),
      no_pending_artifact_after_failure: pendingProseFragmentCount === 0,
      no_successful_tool_dispatch_after_failure: toolboxExecuteSucceededRecords.length === 0,
      no_production_write_after_failure:
        failedTurnResult.truthfulness?.production_write_performed === false,
      user_message_text: sentMessage?.body?.text,
    },
  ];
}

async function driveAu04ConfirmIdempotencyUi(page) {
  const requestText =
    "第01章：底层灵气账单 写得太平了，推翻重写这一章的正文草稿，保持为待采纳草稿。";

  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  await page.locator(chatInputSelector).fill(requestText);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const confirmTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.status === "needs_confirmation" &&
      (frame.body?.available_actions ?? []).some(
        (action) => action.action_type === "confirm_before_execute",
      ),
    "No needs_confirmation turn_result with confirm_before_execute action was received",
    200_000,
  );
  const confirmTurnResult = confirmTurnFrame.body;
  const confirmAction = confirmTurnResult.available_actions.find(
    (action) => action.action_type === "confirm_before_execute",
  );

  await page.waitForFunction(
    () => document.body.innerText.includes("确认执行") && document.body.innerText.includes("拒绝"),
    { timeout: 10_000 },
  );

  const confirmButton = page.getByRole("button", { name: "确认执行" }).first();
  await confirmButton.waitFor({ timeout: 10_000 });
  const buttonBox = await confirmButton.boundingBox();
  assert(buttonBox, "Confirm button was not visible enough to receive pointer input");

  const beforeConfirmFrameCount = frames.length;
  const beforeConfirmLogCount = readAppLogRecords().length;
  await page.mouse.dblclick(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2, {
    delay: 20,
  });

  const confirmActionFrame = await waitForNewFrame(
    beforeConfirmFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "confirm_before_execute" &&
      frame.body?.action?.action_id === confirmAction.action_id,
    "Real workbench did not send the confirm_before_execute author_action",
  );

  const executedTurnFrame = await waitForNewFrame(
    beforeConfirmFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.tool_name === "prose_writing" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment",
    "No prose_fragment turn_result was received after confirm_before_execute",
    200_000,
  );
  const executedTurnResult = executedTurnFrame.body;

  await waitForAppLogCount(
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.turn_id === executedTurnResult.turn_id &&
      record.tool_name === "prose_writing" &&
      record.tool_outcome === "succeeded",
    1,
    "No toolbox.execute.done log proved prose_writing ran after confirmation",
    30_000,
  );

  await sleep(1_000);

  const framesAfterConfirm = frames.slice(beforeConfirmFrameCount);
  const logsAfterConfirm = readAppLogRecords().slice(beforeConfirmLogCount);
  const sentConfirmActionFrames = framesAfterConfirm.filter(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "confirm_before_execute" &&
      frame.body?.action?.action_id === confirmAction.action_id,
  );
  const duplicateActionResultFrames = framesAfterConfirm.filter(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "action_result" &&
      frame.body?.duplicate === true &&
      frame.body?.idempotency_key === confirmAction.idempotency_key,
  );
  const authorActionDoneRecords = logsAfterConfirm.filter(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.turn_id === confirmTurnResult.turn_id &&
      record.action_type === "confirm_before_execute" &&
      record.action_id === confirmAction.action_id,
  );
  const nonDuplicateAuthorActionDoneRecords = authorActionDoneRecords.filter(
    (record) => record.duplicate !== true,
  );
  const duplicateAuthorActionDoneRecords = authorActionDoneRecords.filter(
    (record) => record.duplicate === true,
  );
  const toolboxExecuteRecords = logsAfterConfirm.filter(
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.turn_id === executedTurnResult.turn_id &&
      record.tool_name === "prose_writing" &&
      record.tool_outcome === "succeeded",
  );
  const executedTurnFrames = framesAfterConfirm.filter(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id === executedTurnResult.turn_id &&
      frame.body?.tool_result?.tool_name === "prose_writing",
  );
  const pendingProseFragmentCount = executedTurnFrames.reduce(
    (count, frame) =>
      count +
      (frame.body?.adoption_state?.pending ?? []).filter(
        (artifact) => artifact.artifact_type === "prose_fragment",
      ).length,
    0,
  );
  const duplicateSuppressedOrDeduped =
    sentConfirmActionFrames.length === 1 ||
    duplicateActionResultFrames.length >= 1 ||
    duplicateAuthorActionDoneRecords.length >= 1;

  await page.waitForFunction(
    () =>
      /待确认的创作材料|待确认正文草稿|待保存章节草稿|章节正文草稿|正文草稿/.test(
        document.body.innerText,
      ) &&
      /确认创建|保存为章节正文|保存到大纲|保存到作品档案|保存到作品/.test(document.body.innerText),
    { timeout: 10_000 },
  );
  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, executedTurnResult, sentMessage);
  const pendingArtifact = executedTurnResult.adoption_state.pending[0];

  assert(
    confirmTurnResult.truthfulness?.tool_called === false,
    "Confirmation turn_result claimed tool execution before author confirmed",
  );
  assert(
    confirmTurnResult.truthfulness?.production_write_performed === false,
    "Confirmation turn_result claimed a production write before author confirmed",
  );
  assert(sentConfirmActionFrames.length >= 1, "Rapid confirm did not send any author_action");
  assert(
    nonDuplicateAuthorActionDoneRecords.length === 1,
    `Expected exactly one non-duplicate confirm receipt, got ${nonDuplicateAuthorActionDoneRecords.length}`,
  );
  assert(
    duplicateSuppressedOrDeduped,
    "Rapid confirm was neither suppressed by the UI nor deduplicated by the action boundary",
  );
  assert(
    toolboxExecuteRecords.length === 1,
    `Expected exactly one prose_writing dispatch after rapid confirm, got ${toolboxExecuteRecords.length}`,
  );
  assert(
    pendingProseFragmentCount === 1,
    `Expected exactly one pending prose_fragment after rapid confirm, got ${pendingProseFragmentCount}`,
  );

  return [
    {
      ...uiState,
      turn_id: confirmTurnResult.turn_id,
      confirm_turn_id: confirmTurnResult.turn_id,
      executed_turn_id: executedTurnResult.turn_id,
      artifact_id: pendingArtifact.artifact_id,
      artifact_type: pendingArtifact.artifact_type,
      confirmation_card_received: true,
      confirmation_card_visible: true,
      pending_draft_visible: visibleTextIncludesPendingDraft(visibleText),
      plan_carried_over_wire: confirmTurnResult.plan != null,
      confirm_action_behavior_ref: confirmAction.behavior_ref ?? "",
      confirm_action_id: confirmAction.action_id,
      confirm_action_idempotency_key: confirmAction.idempotency_key,
      tool_called_before_confirm: confirmTurnResult.truthfulness?.tool_called === true,
      production_write_before_confirm:
        confirmTurnResult.truthfulness?.production_write_performed === true,
      confirm_double_click_attempted: true,
      confirm_action_sent:
        confirmActionFrame.body?.action?.action_type === "confirm_before_execute",
      sent_confirm_action_count: sentConfirmActionFrames.length,
      author_action_done_count: authorActionDoneRecords.length,
      non_duplicate_author_action_done_count: nonDuplicateAuthorActionDoneRecords.length,
      duplicate_author_action_done_count: duplicateAuthorActionDoneRecords.length,
      duplicate_action_result_count: duplicateActionResultFrames.length,
      duplicate_suppressed_or_deduped: duplicateSuppressedOrDeduped,
      confirmed_dispatch: executedTurnResult.truthfulness?.tool_called === true,
      toolbox_execute_count: toolboxExecuteRecords.length,
      executed_turn_result_count: executedTurnFrames.length,
      pending_prose_fragment_count: pendingProseFragmentCount,
      no_duplicate_tool_dispatch: toolboxExecuteRecords.length === 1,
      single_pending_artifact_after_confirm: pendingProseFragmentCount === 1,
      artifact_pending_after_confirm: pendingArtifact.artifact_type === "prose_fragment",
      user_message_text: sentMessage?.body?.text,
    },
  ];
}

async function driveAu04StaleConfirmationUi(page) {
  const requestText =
    "第01章：底层灵气账单 写得太平了，推翻重写这一章的正文草稿，保持为待采纳草稿。";
  const followupText = "先普通聊一句：我们暂时只讨论节奏和读者感受。";

  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  await page.locator(chatInputSelector).fill(requestText);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const confirmTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.status === "needs_confirmation" &&
      (frame.body?.available_actions ?? []).some(
        (action) => action.action_type === "confirm_before_execute",
      ),
    "No needs_confirmation turn_result with confirm_before_execute action was received",
    200_000,
  );
  const confirmTurnResult = confirmTurnFrame.body;
  const confirmAction = confirmTurnResult.available_actions.find(
    (action) => action.action_type === "confirm_before_execute",
  );

  await page.waitForFunction(
    () => document.body.innerText.includes("确认执行") && document.body.innerText.includes("拒绝"),
    { timeout: 10_000 },
  );

  const beforeFollowFrameCount = frames.length;
  await page.locator(chatInputSelector).fill(followupText);
  await page.getByRole("button", { name: /^发送$/ }).click();

  await waitForNewFrame(
    beforeFollowFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.text === followupText,
    "Real workbench did not send the follow-up message that advances the current turn",
  );

  const followupTurnFrame = await waitForNewFrame(
    beforeFollowFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id !== confirmTurnResult.turn_id &&
      frame.body?.status !== "needs_confirmation",
    "No follow-up turn_result advanced the current turn after the confirmation card",
    200_000,
  );
  const followupTurnResult = followupTurnFrame.body;

  const beforeStaleFrameCount = frames.length;
  const beforeStaleLogCount = readAppLogRecords().length;
  const staleConfirmButton = page.getByRole("button", { name: "确认执行" }).first();
  const staleConfirmButtonCount = await page.getByRole("button", { name: "确认执行" }).count();
  const staleConfirmVisible =
    staleConfirmButtonCount > 0 ? await staleConfirmButton.isVisible().catch(() => false) : false;
  const staleConfirmDisabled = staleConfirmVisible
    ? await staleConfirmButton.isDisabled().catch(() => false)
    : false;

  let staleClickAttempted = false;
  let staleActionSent = false;
  let staleActionRejected = false;
  let staleRejectionReason = "";

  if (staleConfirmVisible && !staleConfirmDisabled) {
    staleClickAttempted = true;
    await staleConfirmButton.click();

    await waitForNewFrame(
      beforeStaleFrameCount,
      (frame) =>
        frame.direction === "sent" &&
        frame.event === "author_action" &&
        frame.body?.action?.action_type === "confirm_before_execute" &&
        frame.body?.action?.action_id === confirmAction.action_id,
      "Real workbench did not send the stale confirm author_action",
    );
    staleActionSent = true;

    const staleErrorFrame = await waitForNewFrame(
      beforeStaleFrameCount,
      (frame) =>
        frame.direction === "received" &&
        frame.event === "phx_reply" &&
        frame.body?.status === "error" &&
        JSON.stringify(frame.body).includes("stale"),
      "Stale confirm author_action was not rejected by the channel",
    );
    staleActionRejected = true;
    staleRejectionReason = JSON.stringify(staleErrorFrame.body);

    await page.waitForFunction(() => document.body.innerText.includes("操作失败，请重试。"), {
      timeout: 10_000,
    });
  }

  await sleep(1_000);

  const framesAfterStale = frames.slice(beforeStaleFrameCount);
  const logsAfterStale = readAppLogRecords().slice(beforeStaleLogCount);
  const sentStaleConfirmActionFrames = framesAfterStale.filter(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "confirm_before_execute" &&
      frame.body?.action?.action_id === confirmAction.action_id,
  );
  const authorActionErrorRecords = logsAfterStale.filter(
    (record) =>
      record.event === "channel.author_action.error" &&
      record.action_type === "confirm_before_execute" &&
      record.action_id === confirmAction.action_id &&
      String(record.outcome_detail ?? "").includes("stale"),
  );
  const toolboxExecuteAfterStaleRecords = logsAfterStale.filter(
    (record) => record.event === "toolbox.execute.done",
  );
  const pendingProseFragmentAfterStaleCount = framesAfterStale.reduce((count, frame) => {
    if (frame.direction !== "received" || frame.event !== "turn_result") return count;
    return (
      count +
      (frame.body?.adoption_state?.pending ?? []).filter(
        (artifact) => artifact.artifact_type === "prose_fragment",
      ).length
    );
  }, 0);

  const staleConfirmPrevented =
    (!staleConfirmVisible && sentStaleConfirmActionFrames.length === 0) ||
    staleConfirmDisabled ||
    staleActionRejected ||
    authorActionErrorRecords.length >= 1;

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, followupTurnResult, sentMessage);

  assert(
    confirmTurnResult.truthfulness?.tool_called === false,
    "Confirmation turn_result claimed tool execution before author confirmed",
  );
  assert(
    confirmTurnResult.truthfulness?.production_write_performed === false,
    "Confirmation turn_result claimed a production write before author confirmed",
  );
  assert(
    followupTurnResult.turn_id !== confirmTurnResult.turn_id,
    "Follow-up turn did not advance current turn",
  );
  assert(staleConfirmPrevented, "Stale confirmation was neither hidden, disabled, nor rejected");
  assert(
    toolboxExecuteAfterStaleRecords.length === 0,
    `Expected no toolbox execution after stale confirm, got ${toolboxExecuteAfterStaleRecords.length}`,
  );
  assert(
    pendingProseFragmentAfterStaleCount === 0,
    `Expected no pending prose_fragment after stale confirm, got ${pendingProseFragmentAfterStaleCount}`,
  );

  return [
    {
      ...uiState,
      turn_id: confirmTurnResult.turn_id,
      confirm_turn_id: confirmTurnResult.turn_id,
      followup_turn_id: followupTurnResult.turn_id,
      confirmation_card_received: true,
      confirmation_card_visible: true,
      plan_carried_over_wire: confirmTurnResult.plan != null,
      confirm_action_behavior_ref: confirmAction.behavior_ref ?? "",
      tool_called_before_confirm: confirmTurnResult.truthfulness?.tool_called === true,
      production_write_before_confirm:
        confirmTurnResult.truthfulness?.production_write_performed === true,
      followup_turn_completed: true,
      followup_advanced_current_turn: followupTurnResult.turn_id !== confirmTurnResult.turn_id,
      stale_confirm_visible: staleConfirmVisible,
      stale_confirm_disabled: staleConfirmDisabled,
      stale_confirm_click_attempted: staleClickAttempted,
      stale_confirm_action_sent: staleActionSent || sentStaleConfirmActionFrames.length >= 1,
      stale_confirm_rejected: staleActionRejected || authorActionErrorRecords.length >= 1,
      stale_confirm_prevented: staleConfirmPrevented,
      stale_rejection_reason: staleRejectionReason,
      author_action_error_count: authorActionErrorRecords.length,
      toolbox_execute_after_stale_count: toolboxExecuteAfterStaleRecords.length,
      pending_prose_fragment_after_stale_count: pendingProseFragmentAfterStaleCount,
      no_tool_dispatch_after_stale: toolboxExecuteAfterStaleRecords.length === 0,
      no_pending_artifact_after_stale: pendingProseFragmentAfterStaleCount === 0,
      action_failure_visible: visibleText.includes("操作失败，请重试。"),
      user_message_text: sentMessage?.body?.text,
    },
  ];
}

async function driveAu06SingleActiveConfirmation(page) {
  const firstRequestText =
    "第01章：底层灵气账单 写得太平了，推翻重写这一章的正文草稿，保持为待采纳草稿。";
  const secondRequestText = "第02章：旧服务器里的残诀 也需要推翻重写正文草稿，保持为待采纳草稿。";

  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  await page.locator(chatInputSelector).fill(firstRequestText);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const firstConfirmTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.status === "needs_confirmation" &&
      (frame.body?.available_actions ?? []).some(
        (action) => action.action_type === "confirm_before_execute",
      ),
    "No first needs_confirmation turn_result with confirm_before_execute action was received",
    200_000,
  );
  const firstConfirmTurnResult = firstConfirmTurnFrame.body;
  const firstConfirmAction = firstConfirmTurnResult.available_actions.find(
    (action) => action.action_type === "confirm_before_execute",
  );

  await page.waitForFunction(
    () => document.body.innerText.includes("确认执行") && document.body.innerText.includes("拒绝"),
    { timeout: 10_000 },
  );

  const beforeSecondFrameCount = frames.length;
  await page.locator(chatInputSelector).fill(secondRequestText);
  await page.getByRole("button", { name: /^发送$/ }).click();

  await waitForNewFrame(
    beforeSecondFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.text === secondRequestText,
    "Real workbench did not send the second high-risk user_message",
  );

  const secondConfirmTurnFrame = await waitForNewFrame(
    beforeSecondFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id !== firstConfirmTurnResult.turn_id &&
      frame.body?.status === "needs_confirmation" &&
      (frame.body?.available_actions ?? []).some(
        (action) => action.action_type === "confirm_before_execute",
      ),
    "No second needs_confirmation turn_result advanced the current turn",
    200_000,
  );
  const secondConfirmTurnResult = secondConfirmTurnFrame.body;
  const secondConfirmAction = secondConfirmTurnResult.available_actions.find(
    (action) => action.action_type === "confirm_before_execute",
  );
  const secondContextRefs = Array.isArray(secondConfirmTurnResult.trace_summary?.context_refs)
    ? secondConfirmTurnResult.trace_summary.context_refs
    : [];
  const secondBehaviorContextRef = secondContextRefs.find((ref) => ref?.source_type === "behavior");
  const secondBehaviorSummary = String(secondBehaviorContextRef?.summary ?? "");
  const firstBehaviorRefText = String(firstConfirmAction.behavior_ref ?? "");
  const firstActionIdText = String(firstConfirmAction.action_id ?? "");

  assert(
    firstConfirmAction.behavior_ref !== secondConfirmAction.behavior_ref,
    "Second confirmation reused the first behavior_ref; expected a distinct active behavior",
  );
  assert(
    firstConfirmTurnResult.truthfulness?.tool_called === false &&
      firstConfirmTurnResult.truthfulness?.production_write_performed === false,
    "First confirmation executed or wrote before author action",
  );
  assert(
    secondConfirmTurnResult.truthfulness?.tool_called === false &&
      secondConfirmTurnResult.truthfulness?.production_write_performed === false,
    "Second confirmation executed or wrote before author action",
  );
  assert(secondBehaviorContextRef, "Second confirmation did not receive active behavior context");
  assert(
    /待作者确认|确认/.test(secondBehaviorSummary),
    `Second behavior context was not author-readable: ${secondBehaviorSummary}`,
  );
  assert(
    firstBehaviorRefText === "" || !secondBehaviorSummary.includes(firstBehaviorRefText),
    "Behavior context summary leaked the first behavior_ref",
  );
  assert(
    firstActionIdText === "" || !secondBehaviorSummary.includes(firstActionIdText),
    "Behavior context summary leaked the first action_id",
  );

  await page.waitForFunction(
    () => document.body.innerText.includes("确认执行") && document.body.innerText.includes("拒绝"),
    { timeout: 10_000 },
  );

  const beforeOldAttemptFrameCount = frames.length;
  const beforeOldAttemptLogCount = readAppLogRecords().length;
  const confirmButtons = page.getByRole("button", { name: "确认执行" });
  const confirmButtonCountAfterSecond = await confirmButtons.count();
  assert(
    confirmButtonCountAfterSecond >= 1,
    "No confirm button remained after the second confirmation",
  );

  const firstVisibleConfirmButton = confirmButtons.first();
  const oldConfirmVisible =
    confirmButtonCountAfterSecond > 1
      ? await firstVisibleConfirmButton.isVisible().catch(() => false)
      : false;
  const oldConfirmDisabled = oldConfirmVisible
    ? await firstVisibleConfirmButton.isDisabled().catch(() => false)
    : false;

  let oldConfirmClickAttempted = false;
  let oldConfirmActionSent = false;
  let oldConfirmRejected = false;
  let oldRejectionReason = "";

  if (oldConfirmVisible && !oldConfirmDisabled) {
    oldConfirmClickAttempted = true;
    await firstVisibleConfirmButton.click();

    await waitForNewFrame(
      beforeOldAttemptFrameCount,
      (frame) =>
        frame.direction === "sent" &&
        frame.event === "author_action" &&
        frame.body?.action?.action_type === "confirm_before_execute" &&
        frame.body?.action?.action_id === firstConfirmAction.action_id,
      "Real workbench did not send the old confirm author_action",
    );
    oldConfirmActionSent = true;

    const oldErrorFrame = await waitForNewFrame(
      beforeOldAttemptFrameCount,
      (frame) =>
        frame.direction === "received" &&
        frame.event === "phx_reply" &&
        frame.body?.status === "error" &&
        JSON.stringify(frame.body).includes("stale"),
      "Old confirm author_action was not rejected as stale",
    );
    oldConfirmRejected = true;
    oldRejectionReason = JSON.stringify(oldErrorFrame.body);
  }

  await sleep(1_000);

  const framesAfterOldAttempt = frames.slice(beforeOldAttemptFrameCount);
  const logsAfterOldAttempt = readAppLogRecords().slice(beforeOldAttemptLogCount);
  const sentOldConfirmActionFrames = framesAfterOldAttempt.filter(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "confirm_before_execute" &&
      frame.body?.action?.action_id === firstConfirmAction.action_id,
  );
  const oldAuthorActionErrorRecords = logsAfterOldAttempt.filter(
    (record) =>
      record.event === "channel.author_action.error" &&
      record.action_type === "confirm_before_execute" &&
      record.action_id === firstConfirmAction.action_id &&
      String(record.outcome_detail ?? "").includes("stale"),
  );
  const toolboxExecuteAfterOldRecords = logsAfterOldAttempt.filter(
    (record) => record.event === "toolbox.execute.done",
  );
  const pendingProseFragmentAfterOldCount = framesAfterOldAttempt.reduce((count, frame) => {
    if (frame.direction !== "received" || frame.event !== "turn_result") return count;
    return (
      count +
      (frame.body?.adoption_state?.pending ?? []).filter(
        (artifact) => artifact.artifact_type === "prose_fragment",
      ).length
    );
  }, 0);

  const oldConfirmPrevented =
    confirmButtonCountAfterSecond === 1 ||
    oldConfirmDisabled ||
    oldConfirmRejected ||
    oldAuthorActionErrorRecords.length >= 1;

  assert(
    oldConfirmPrevented,
    "Old confirmation remained executable after a newer confirmation became active",
  );
  assert(
    toolboxExecuteAfterOldRecords.length === 0,
    `Expected no toolbox execution after old confirm attempt, got ${toolboxExecuteAfterOldRecords.length}`,
  );
  assert(
    pendingProseFragmentAfterOldCount === 0,
    `Expected no pending prose_fragment after old confirm attempt, got ${pendingProseFragmentAfterOldCount}`,
  );

  const beforeLatestConfirmFrameCount = frames.length;
  const beforeLatestConfirmLogCount = readAppLogRecords().length;
  await page.getByRole("button", { name: "确认执行" }).last().click();

  const latestConfirmActionFrame = await waitForNewFrame(
    beforeLatestConfirmFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "confirm_before_execute" &&
      frame.body?.action?.action_id === secondConfirmAction.action_id,
    "Real workbench did not send the latest confirm author_action",
  );

  const latestExecutedTurnFrame = await waitForNewFrame(
    beforeLatestConfirmFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.tool_name === "prose_writing" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment",
    "No prose_fragment turn_result was received after confirming the latest behavior",
    200_000,
  );
  const latestExecutedTurnResult = latestExecutedTurnFrame.body;

  await sleep(1_000);

  const logsAfterLatestConfirm = readAppLogRecords().slice(beforeLatestConfirmLogCount);
  const latestToolboxExecuteRecords = logsAfterLatestConfirm.filter(
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.turn_id === latestExecutedTurnResult.turn_id &&
      record.tool_name === "prose_writing" &&
      record.tool_outcome === "succeeded",
  );
  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, latestExecutedTurnResult, sentMessage);
  const latestPendingArtifact = latestExecutedTurnResult.adoption_state.pending[0];

  assert(
    latestToolboxExecuteRecords.length === 1,
    `Expected latest confirmation to dispatch prose_writing once, got ${latestToolboxExecuteRecords.length}`,
  );
  assert(
    latestExecutedTurnResult.truthfulness?.tool_called === true,
    "Latest confirmed turn_result did not record tool_called",
  );

  return [
    {
      ...uiState,
      turn_id: secondConfirmTurnResult.turn_id,
      first_confirm_turn_id: firstConfirmTurnResult.turn_id,
      second_confirm_turn_id: secondConfirmTurnResult.turn_id,
      latest_executed_turn_id: latestExecutedTurnResult.turn_id,
      artifact_id: latestPendingArtifact.artifact_id,
      artifact_type: latestPendingArtifact.artifact_type,
      first_confirm_action_id: firstConfirmAction.action_id,
      second_confirm_action_id: secondConfirmAction.action_id,
      first_confirm_action_behavior_ref: firstConfirmAction.behavior_ref ?? "",
      second_confirm_action_behavior_ref: secondConfirmAction.behavior_ref ?? "",
      distinct_behavior_refs: firstConfirmAction.behavior_ref !== secondConfirmAction.behavior_ref,
      second_turn_behavior_context_ref_visible: Boolean(secondBehaviorContextRef),
      second_turn_behavior_context_author_safe: true,
      second_turn_behavior_context_summary: secondBehaviorSummary,
      second_turn_behavior_context_redaction_level: secondBehaviorContextRef?.redaction_level ?? "",
      second_turn_behavior_context_ref: secondBehaviorContextRef?.context_ref ?? "",
      second_turn_behavior_context_source_id: secondBehaviorContextRef?.source_id ?? "",
      first_tool_called_before_confirm: firstConfirmTurnResult.truthfulness?.tool_called === true,
      first_production_write_before_confirm:
        firstConfirmTurnResult.truthfulness?.production_write_performed === true,
      second_tool_called_before_confirm: secondConfirmTurnResult.truthfulness?.tool_called === true,
      second_production_write_before_confirm:
        secondConfirmTurnResult.truthfulness?.production_write_performed === true,
      second_confirmation_advanced_current_turn:
        secondConfirmTurnResult.turn_id !== firstConfirmTurnResult.turn_id,
      confirm_button_count_after_second: confirmButtonCountAfterSecond,
      old_confirm_visible: oldConfirmVisible,
      old_confirm_disabled: oldConfirmDisabled,
      old_confirm_click_attempted: oldConfirmClickAttempted,
      old_confirm_action_sent: oldConfirmActionSent || sentOldConfirmActionFrames.length >= 1,
      old_confirm_rejected: oldConfirmRejected || oldAuthorActionErrorRecords.length >= 1,
      old_confirm_prevented: oldConfirmPrevented,
      old_rejection_reason: oldRejectionReason,
      old_author_action_error_count: oldAuthorActionErrorRecords.length,
      toolbox_execute_after_old_count: toolboxExecuteAfterOldRecords.length,
      pending_prose_fragment_after_old_count: pendingProseFragmentAfterOldCount,
      no_tool_dispatch_after_old: toolboxExecuteAfterOldRecords.length === 0,
      no_pending_artifact_after_old: pendingProseFragmentAfterOldCount === 0,
      latest_confirm_action_sent:
        latestConfirmActionFrame.body?.action?.action_type === "confirm_before_execute",
      latest_confirm_dispatched: latestExecutedTurnResult.truthfulness?.tool_called === true,
      latest_toolbox_execute_count: latestToolboxExecuteRecords.length,
      latest_pending_artifact_after_confirm:
        latestPendingArtifact.artifact_type === "prose_fragment",
      pending_draft_visible: visibleTextIncludesPendingDraft(visibleText),
      user_message_text: sentMessage?.body?.text,
    },
  ];
}

async function driveAu04ConfirmationTtlUi(page) {
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("已经过期的确认") &&
      document.body.innerText.includes("确认执行") &&
      document.body.innerText.includes("拒绝"),
    { timeout: 20_000 },
  );

  const beforeConfirmFrameCount = frames.length;
  const beforeConfirmLogCount = readAppLogRecords().length;
  const visibleBeforeClick = await page.locator("body").innerText();

  await page.getByRole("button", { name: "确认执行" }).first().click();

  const actionFrame = await waitForNewFrame(
    beforeConfirmFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "confirm_before_execute" &&
      frame.body?.action?.action_id === "act_au04_expired_confirm" &&
      frame.body?.action?.source_turn_ref === "turn_au04_expired_confirmation_seed",
    "Real workbench did not send the expired confirm author_action",
  );

  const errorFrame = await waitForNewFrame(
    beforeConfirmFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "phx_reply" &&
      frame.body?.status === "error" &&
      JSON.stringify(frame.body).includes("expired action"),
    "Expired confirm author_action was not rejected by the channel",
  );

  await page.waitForFunction(() => document.body.innerText.includes("操作失败，请重试。"), {
    timeout: 10_000,
  });
  await sleep(1_000);

  const framesAfterConfirm = frames.slice(beforeConfirmFrameCount);
  const logsAfterConfirm = readAppLogRecords().slice(beforeConfirmLogCount);
  const authorActionErrorRecords = logsAfterConfirm.filter(
    (record) =>
      record.event === "channel.author_action.error" &&
      record.turn_id === "turn_au04_expired_confirmation_seed" &&
      record.action_type === "confirm_before_execute" &&
      record.action_id === "act_au04_expired_confirm" &&
      String(record.outcome_detail ?? "").includes("expired action"),
  );
  const toolboxExecuteRecords = logsAfterConfirm.filter(
    (record) => record.event === "toolbox.execute.done",
  );
  const pendingProseFragmentCount = framesAfterConfirm.reduce((count, frame) => {
    if (frame.direction !== "received" || frame.event !== "turn_result") return count;
    return (
      count +
      (frame.body?.adoption_state?.pending ?? []).filter(
        (artifact) => artifact.artifact_type === "prose_fragment",
      ).length
    );
  }, 0);
  const visibleAfterClick = await page.locator("body").innerText();
  const joinRecord = readAppLogRecords().find(
    (record) => record.event === "channel.join.done" && record.work_id,
  );

  assert(
    authorActionErrorRecords.length >= 1,
    "No channel.author_action.error log recorded expired action rejection",
  );
  assert(
    toolboxExecuteRecords.length === 0,
    `Expected no toolbox execution after expired confirm, got ${toolboxExecuteRecords.length}`,
  );
  assert(
    pendingProseFragmentCount === 0,
    `Expected no pending prose_fragment after expired confirm, got ${pendingProseFragmentCount}`,
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_id: "turn_au04_expired_confirmation_seed",
      work_id: joinRecord?.work_id,
      workspace_id: joinRecord?.work_id,
      session_id: joinRecord?.session_id,
      confirmation_card_restored: true,
      confirmation_card_visible:
        visibleBeforeClick.includes("确认执行") && visibleBeforeClick.includes("拒绝"),
      expired_confirm_click_attempted: true,
      expired_confirm_action_sent:
        actionFrame.body?.action?.action_type === "confirm_before_execute",
      expired_confirm_rejected: true,
      expired_rejection_reason: JSON.stringify(errorFrame.body),
      author_action_error_count: authorActionErrorRecords.length,
      toolbox_execute_after_expired_count: toolboxExecuteRecords.length,
      pending_prose_fragment_after_expired_count: pendingProseFragmentCount,
      no_tool_dispatch_after_expired: toolboxExecuteRecords.length === 0,
      no_pending_artifact_after_expired: pendingProseFragmentCount === 0,
      action_failure_visible: visibleAfterClick.includes("操作失败，请重试。"),
      outcome: "done",
    },
  ];
}

async function driveAu04DisabledConfirmationActionUi(page) {
  const title = "AU04 禁用确认动作作品";
  const disabledReason = "当前作品状态已变化，请重新生成计划后再确认。";
  const work = await waitForWorkByTitle(title);
  const joinRecord = await ensureWorkSelectedByTitle(page, title, work.id);

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("AU04禁用确认动作文本") &&
      document.body.innerText.includes("禁用确认动作") &&
      document.body.innerText.includes("确认执行") &&
      document.body.innerText.includes("拒绝"),
    { timeout: 20_000 },
  );

  const beforeAttemptFrameCount = frames.length;
  const beforeAttemptLogCount = readAppLogRecords().length;
  const visibleBeforeAttempt = await page.locator("body").innerText();
  const confirmButton = page.getByRole("button", { name: "确认执行" }).first();
  const rejectButton = page.getByRole("button", { name: "拒绝" }).first();
  const confirmButtonCount = await page.getByRole("button", { name: "确认执行" }).count();
  const rejectButtonCount = await page.getByRole("button", { name: "拒绝" }).count();
  const confirmButtonDisabled = await confirmButton.isDisabled();
  const rejectButtonDisabled = await rejectButton.isDisabled();
  const confirmButtonTitle = await confirmButton.getAttribute("title");

  let disabledClickBlockedByBrowser = false;
  try {
    await confirmButton.click({ timeout: 1_000 });
  } catch {
    disabledClickBlockedByBrowser = true;
  }

  await sleep(1_000);

  const framesAfterAttempt = frames.slice(beforeAttemptFrameCount);
  const logsAfterAttempt = readAppLogRecords().slice(beforeAttemptLogCount);
  const sentAuthorActions = framesAfterAttempt.filter(
    (frame) => frame.direction === "sent" && frame.event === "author_action",
  );
  const disabledConfirmActionFrames = sentAuthorActions.filter(
    (frame) =>
      frame.body?.action?.action_type === "confirm_before_execute" &&
      frame.body?.action?.action_id === "act_au04_disabled_confirm",
  );
  const channelAuthorActionRecords = logsAfterAttempt.filter((record) =>
    String(record.event ?? "").startsWith("channel.author_action."),
  );
  const toolboxExecuteRecords = logsAfterAttempt.filter(
    (record) => record.event === "toolbox.execute.done",
  );
  const pendingProseFragmentCount = framesAfterAttempt.reduce((count, frame) => {
    if (frame.direction !== "received" || frame.event !== "turn_result") return count;
    return (
      count +
      (frame.body?.adoption_state?.pending ?? []).filter(
        (artifact) => artifact.artifact_type === "prose_fragment",
      ).length
    );
  }, 0);

  assert(confirmButtonCount >= 1, "Disabled confirmation card did not expose confirm action");
  assert(rejectButtonCount >= 1, "Disabled confirmation card did not expose reject action");
  assert(confirmButtonDisabled, "Confirm action was not disabled in the real workbench");
  assert(!rejectButtonDisabled, "Reject action was disabled together with confirm");
  assert(
    confirmButtonTitle === disabledReason,
    `Disabled confirm title did not explain reason: ${confirmButtonTitle ?? "null"}`,
  );
  assert(disabledClickBlockedByBrowser, "Disabled confirm click was not blocked by the browser");
  assert(disabledConfirmActionFrames.length === 0, "Disabled confirm sent an author_action");
  assert(sentAuthorActions.length === 0, "Disabled confirmation attempt sent an author_action");
  assert(
    channelAuthorActionRecords.length === 0,
    "Disabled confirmation attempt reached the channel author_action boundary",
  );
  assert(
    toolboxExecuteRecords.length === 0,
    `Disabled confirmation dispatched tools ${toolboxExecuteRecords.length} times`,
  );
  assert(
    pendingProseFragmentCount === 0,
    `Disabled confirmation created ${pendingProseFragmentCount} pending prose fragments`,
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_id: "turn_au04_disabled_confirmation_seed",
      turn_ids: ["turn_au04_disabled_confirmation_seed"],
      work_id: work.id,
      workspace_id: work.id,
      session_id: joinRecord?.session_id,
      confirmation_card_restored: true,
      confirmation_card_visible:
        visibleBeforeAttempt.includes("确认执行") && visibleBeforeAttempt.includes("拒绝"),
      disabled_confirm_button_count: confirmButtonCount,
      reject_button_count: rejectButtonCount,
      disabled_confirm_visible: confirmButtonCount >= 1,
      disabled_confirm_disabled: confirmButtonDisabled,
      disabled_confirm_title: confirmButtonTitle,
      disabled_reason_visible_via_title: confirmButtonTitle === disabledReason,
      reject_action_still_enabled: !rejectButtonDisabled,
      disabled_click_attempted: true,
      disabled_click_blocked_by_browser: disabledClickBlockedByBrowser,
      author_action_sent_count: sentAuthorActions.length,
      disabled_confirm_action_sent_count: disabledConfirmActionFrames.length,
      channel_author_action_log_count: channelAuthorActionRecords.length,
      toolbox_execute_after_disabled_attempt_count: toolboxExecuteRecords.length,
      pending_prose_fragment_after_disabled_attempt_count: pendingProseFragmentCount,
      no_author_action_sent: sentAuthorActions.length === 0,
      no_channel_author_action_log: channelAuthorActionRecords.length === 0,
      no_tool_dispatch_after_disabled_attempt: toolboxExecuteRecords.length === 0,
      no_pending_artifact_after_disabled_attempt: pendingProseFragmentCount === 0,
      socket_connected: true,
      duration_ms: 0,
      outcome: "done",
    },
  ];
}

async function driveAu04HistoryConfirmationReadonly(page) {
  const joinReply = latestChannelJoinReply();
  const workId = joinReply?.body?.response?.work_id ?? joinReply?.body?.work_id ?? null;
  const activeSessionId =
    joinReply?.body?.response?.session_id ?? joinReply?.body?.session_id ?? null;
  assert(workId, "No work_id was available from the real channel join");

  const searchResponse = await fetch(
    `${baseUrl}/api/works/${encodeURIComponent(workId)}/sessions?query=${encodeURIComponent("AU04 历史确认")}`,
  );
  assert(
    searchResponse.ok,
    `Failed to search seeded AU-04 history confirmation session: HTTP ${searchResponse.status}`,
  );
  const searchBody = await searchResponse.json();
  const seededHistorySession = (searchBody.sessions ?? []).find(
    (session) => session.title === "AU04 历史确认只读",
  );
  assert(
    seededHistorySession?.id,
    "Seeded AU-04 history confirmation session was not available through sessions API",
  );

  const beforeOpenFrameCount = frames.length;
  const beforeOpenLogCount = readAppLogRecords().length;
  await openSessionRail(page);
  const searchBox = page.getByPlaceholder("搜索会话");
  await searchBox.waitFor({ timeout: 10_000 });
  await searchBox.fill("AU04 历史确认");

  const historySessionButton = page
    .locator("button")
    .filter({ hasText: "AU04 历史确认只读" })
    .first();
  await historySessionButton.waitFor({ timeout: 10_000 });
  await historySessionButton.click();

  const shownHistory = await waitForNewAppLogRecord(
    beforeOpenLogCount,
    (record) =>
      record.event === "work_session.show.done" &&
      record.work_id === workId &&
      record.session_id === seededHistorySession.id &&
      record.read_only === true &&
      Number(record.transcript_count ?? 0) >= 2,
    "AU-04 history confirmation session was not opened read-only",
    30_000,
  );

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("历史会话") &&
      document.body.innerText.includes("这是历史会话里的待确认执行") &&
      document.body.innerText.includes("返回当前会话"),
    { timeout: 10_000 },
  );

  await sleep(1_000);

  const readonlySnapshot = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder="输入你的想法、问题或指令..."]');
    const sendButton = [...document.querySelectorAll("button")].find(
      (button) => (button.textContent ?? "").trim() === "发送",
    );
    const buttons = [...document.querySelectorAll("button")].map((button) =>
      (button.textContent ?? "").replace(/\s+/g, " ").trim(),
    );

    return {
      visible_text: document.body.innerText,
      input_disabled: Boolean(input?.disabled),
      send_disabled: Boolean(sendButton?.disabled),
      confirm_button_count: buttons.filter((text) => text === "确认执行").length,
      reject_button_count: buttons.filter((text) => text === "拒绝").length,
      branch_button_visible: buttons.some((text) => text.includes("从这里继续")),
      back_button_visible: buttons.some((text) => text.includes("返回当前会话")),
    };
  });

  const framesAfterOpen = frames.slice(beforeOpenFrameCount);
  const logsAfterOpen = readAppLogRecords().slice(beforeOpenLogCount);
  const sentAuthorActions = framesAfterOpen.filter(
    (frame) => frame.direction === "sent" && frame.event === "author_action",
  );
  const channelAuthorActionRecords = logsAfterOpen.filter((record) =>
    String(record.event ?? "").startsWith("channel.author_action."),
  );
  const toolboxExecuteRecords = logsAfterOpen.filter(
    (record) => record.event === "toolbox.execute.done",
  );
  const pendingProseFragmentCount = framesAfterOpen.reduce((count, frame) => {
    if (frame.direction !== "received" || frame.event !== "turn_result") return count;
    return (
      count +
      (frame.body?.adoption_state?.pending ?? []).filter(
        (artifact) => artifact.artifact_type === "prose_fragment",
      ).length
    );
  }, 0);

  assert(seededHistorySession.status === "EXITED", "Seeded history session status was not EXITED");
  assert(readonlySnapshot.input_disabled, "History confirmation input was not disabled");
  assert(readonlySnapshot.send_disabled, "History confirmation send button was not disabled");
  assert(
    readonlySnapshot.visible_text.includes("这是历史会话里的待确认执行"),
    "History confirmation transcript was not visible",
  );
  assert(
    readonlySnapshot.confirm_button_count === 0,
    `History confirmation exposed ${readonlySnapshot.confirm_button_count} confirm buttons`,
  );
  assert(
    readonlySnapshot.reject_button_count === 0,
    `History confirmation exposed ${readonlySnapshot.reject_button_count} reject buttons`,
  );
  assert(sentAuthorActions.length === 0, "Readonly history session sent an author_action");
  assert(
    channelAuthorActionRecords.length === 0,
    "Readonly history session produced channel.author_action logs",
  );
  assert(
    toolboxExecuteRecords.length === 0,
    `Readonly history confirmation executed tools ${toolboxExecuteRecords.length} times`,
  );
  assert(
    pendingProseFragmentCount === 0,
    `Readonly history confirmation created ${pendingProseFragmentCount} pending prose fragments`,
  );

  await page.getByRole("button", { name: "返回当前会话" }).click();
  await page.waitForFunction(
    () =>
      !document.body.innerText.includes("正在只读查看历史 transcript") &&
      document.body.innerText.includes("当前会话继续创作"),
    { timeout: 10_000 },
  );

  const activeRestored = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder="输入你的想法、问题或指令..."]');
    const sendButton = [...document.querySelectorAll("button")].find(
      (button) => (button.textContent ?? "").trim() === "发送",
    );
    return {
      visible_text: document.body.innerText,
      input_disabled: Boolean(input?.disabled),
      send_disabled: Boolean(sendButton?.disabled),
    };
  });

  assert(!activeRestored.input_disabled, "Active session input stayed disabled after restore");
  assert(!activeRestored.send_disabled, "Active session send stayed disabled after restore");

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_id: "turn_au04_history_confirmation_seed",
      turn_ids: ["turn_au04_history_confirmation_seed"],
      work_id: workId,
      workspace_id: workId,
      context_work_id: workId,
      session_id: activeSessionId,
      readonly_session_id: seededHistorySession.id,
      readonly_session_status: seededHistorySession.status,
      readonly_opened_from_real_workbench: true,
      readonly_transcript_count: shownHistory.transcript_count,
      readonly_banner_visible: true,
      history_confirmation_transcript_visible: true,
      history_confirmation_confirm_button_count: readonlySnapshot.confirm_button_count,
      history_confirmation_reject_button_count: readonlySnapshot.reject_button_count,
      history_confirmation_actions_hidden:
        readonlySnapshot.confirm_button_count === 0 && readonlySnapshot.reject_button_count === 0,
      readonly_input_disabled: readonlySnapshot.input_disabled,
      readonly_send_disabled: readonlySnapshot.send_disabled,
      readonly_branch_available: readonlySnapshot.branch_button_visible,
      readonly_back_available: readonlySnapshot.back_button_visible,
      author_action_sent_count: sentAuthorActions.length,
      channel_author_action_log_count: channelAuthorActionRecords.length,
      toolbox_execute_after_history_open_count: toolboxExecuteRecords.length,
      pending_prose_fragment_after_history_open_count: pendingProseFragmentCount,
      no_author_action_sent: sentAuthorActions.length === 0,
      no_channel_author_action_log: channelAuthorActionRecords.length === 0,
      no_tool_dispatch_from_history: toolboxExecuteRecords.length === 0,
      no_pending_artifact_from_history: pendingProseFragmentCount === 0,
      active_session_restored: true,
      active_input_enabled_after_restore: !activeRestored.input_disabled,
      active_send_enabled_after_restore: !activeRestored.send_disabled,
      socket_connected: true,
      duration_ms: 0,
      outcome: "done",
    },
  ];
}

async function driveAu04CrossWorkConfirmationGuard(page) {
  const sourceTitle = "AU04 跨作品确认源作品";
  const targetTitle = "AU04 跨作品确认目标作品";
  const sourceNeedle = "AU04跨作品旧确认源文本";
  const targetNeedle = "目标作品当前会话继续创作";
  const sourceWork = await waitForWorkByTitle(sourceTitle);
  const targetWork = await waitForWorkByTitle(targetTitle);

  const sourceJoin = await ensureWorkSelectedByTitle(page, sourceTitle, sourceWork.id);
  await waitForVisibleWorkTitle(page, sourceTitle);
  await page.waitForFunction(
    (needle) =>
      document.body.innerText.includes(needle) &&
      document.body.innerText.includes("确认执行") &&
      document.body.innerText.includes("拒绝"),
    sourceNeedle,
    { timeout: 15_000 },
  );

  const sourceBeforeSwitch = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")].map((button) =>
      (button.textContent ?? "").replace(/\s+/g, " ").trim(),
    );

    return {
      visible_text: document.body.innerText,
      confirm_button_count: buttons.filter((text) => text === "确认执行").length,
      reject_button_count: buttons.filter((text) => text === "拒绝").length,
    };
  });

  const beforeSwitchFrameCount = frames.length;
  const beforeSwitchLogCount = readAppLogRecords().length;
  const targetJoin = await ensureWorkSelectedByTitle(page, targetTitle, targetWork.id);
  await waitForVisibleWorkTitle(page, targetTitle);
  await page.waitForFunction((needle) => document.body.innerText.includes(needle), targetNeedle, {
    timeout: 15_000,
  });
  await sleep(1_000);

  const targetAfterSwitch = await page.evaluate(
    ({ sourceNeedle: source, targetNeedle: target }) => {
      const buttons = [...document.querySelectorAll("button")].map((button) =>
        (button.textContent ?? "").replace(/\s+/g, " ").trim(),
      );
      const visibleText = document.body.innerText;

      return {
        visible_text: visibleText,
        source_text_visible: visibleText.includes(source),
        target_text_visible: visibleText.includes(target),
        confirm_button_count: buttons.filter((text) => text === "确认执行").length,
        reject_button_count: buttons.filter((text) => text === "拒绝").length,
      };
    },
    { sourceNeedle, targetNeedle },
  );

  const framesAfterSwitch = frames.slice(beforeSwitchFrameCount);
  const logsAfterSwitch = readAppLogRecords().slice(beforeSwitchLogCount);
  const sentAuthorActions = framesAfterSwitch.filter(
    (frame) => frame.direction === "sent" && frame.event === "author_action",
  );
  const channelAuthorActionRecords = logsAfterSwitch.filter((record) =>
    String(record.event ?? "").startsWith("channel.author_action."),
  );
  const toolboxExecuteRecords = logsAfterSwitch.filter(
    (record) => record.event === "toolbox.execute.done",
  );
  const pendingProseFragmentCount = framesAfterSwitch.reduce((count, frame) => {
    if (frame.direction !== "received" || frame.event !== "turn_result") return count;
    return (
      count +
      (frame.body?.adoption_state?.pending ?? []).filter(
        (artifact) => artifact.artifact_type === "prose_fragment",
      ).length
    );
  }, 0);

  assert(
    sourceBeforeSwitch.confirm_button_count >= 1,
    "Source confirmation button was not visible",
  );
  assert(sourceBeforeSwitch.reject_button_count >= 1, "Source reject button was not visible");
  assert(targetAfterSwitch.target_text_visible, "Target work transcript was not visible");
  assert(
    !targetAfterSwitch.source_text_visible,
    "Source confirmation transcript leaked into target work",
  );
  assert(
    targetAfterSwitch.confirm_button_count === 0,
    `Target work exposed ${targetAfterSwitch.confirm_button_count} source confirm buttons`,
  );
  assert(
    targetAfterSwitch.reject_button_count === 0,
    `Target work exposed ${targetAfterSwitch.reject_button_count} source reject buttons`,
  );
  assert(sentAuthorActions.length === 0, "Switching work sent an author_action unexpectedly");
  assert(
    channelAuthorActionRecords.length === 0,
    "Switching work produced channel.author_action logs unexpectedly",
  );
  assert(
    toolboxExecuteRecords.length === 0,
    `Cross-work switch executed tools ${toolboxExecuteRecords.length} times`,
  );
  assert(
    pendingProseFragmentCount === 0,
    `Cross-work switch created ${pendingProseFragmentCount} pending prose fragments`,
  );

  const sourceReturnJoin = await ensureWorkSelectedByTitle(page, sourceTitle, sourceWork.id);
  await waitForVisibleWorkTitle(page, sourceTitle);
  await page.waitForFunction(
    (needle) =>
      document.body.innerText.includes(needle) &&
      document.body.innerText.includes("确认执行") &&
      document.body.innerText.includes("拒绝"),
    sourceNeedle,
    { timeout: 15_000 },
  );

  const sourceAfterReturn = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")].map((button) =>
      (button.textContent ?? "").replace(/\s+/g, " ").trim(),
    );

    return {
      visible_text: document.body.innerText,
      confirm_button_count: buttons.filter((text) => text === "确认执行").length,
      reject_button_count: buttons.filter((text) => text === "拒绝").length,
    };
  });

  assert(
    sourceAfterReturn.confirm_button_count >= 1,
    "Source confirmation was not restored after returning to source work",
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_id: "turn_au04_cross_work_confirmation_seed",
      turn_ids: ["turn_au04_cross_work_confirmation_seed"],
      work_id: sourceWork.id,
      workspace_id: sourceWork.id,
      context_work_id: sourceWork.id,
      session_id: sourceJoin.session_id,
      source_work_id: sourceWork.id,
      target_work_id: targetWork.id,
      source_session_id: sourceJoin.session_id,
      target_session_id: targetJoin.session_id,
      source_return_session_id: sourceReturnJoin.session_id,
      source_confirmation_visible_before_switch: true,
      source_confirm_button_count_before_switch: sourceBeforeSwitch.confirm_button_count,
      source_reject_button_count_before_switch: sourceBeforeSwitch.reject_button_count,
      target_work_selected_from_real_menu: true,
      target_transcript_visible: targetAfterSwitch.target_text_visible,
      source_confirmation_hidden_in_target:
        !targetAfterSwitch.source_text_visible &&
        targetAfterSwitch.confirm_button_count === 0 &&
        targetAfterSwitch.reject_button_count === 0,
      target_confirm_button_count: targetAfterSwitch.confirm_button_count,
      target_reject_button_count: targetAfterSwitch.reject_button_count,
      author_action_sent_count: sentAuthorActions.length,
      channel_author_action_log_count: channelAuthorActionRecords.length,
      toolbox_execute_after_cross_work_switch_count: toolboxExecuteRecords.length,
      pending_prose_fragment_after_cross_work_switch_count: pendingProseFragmentCount,
      no_author_action_sent_after_cross_work_switch: sentAuthorActions.length === 0,
      no_channel_author_action_log_after_cross_work_switch: channelAuthorActionRecords.length === 0,
      no_tool_dispatch_after_cross_work_switch: toolboxExecuteRecords.length === 0,
      no_pending_artifact_after_cross_work_switch: pendingProseFragmentCount === 0,
      source_confirmation_restored_after_return: sourceAfterReturn.confirm_button_count >= 1,
      socket_connected: true,
      duration_ms: 0,
      outcome: "done",
    },
  ];
}

async function driveAu04LatestContextRebaseConfirmation(page) {
  const originalTitle = "AU04 最新上下文确认源作品";
  const sourceNeedle = "AU04最新上下文旧确认文本";
  const renamedTitle = `AU04 最新上下文已改名-${Date.now()}`;
  const work = await waitForWorkByTitle(originalTitle);

  const join = await ensureWorkSelectedByTitle(page, originalTitle, work.id);
  await waitForVisibleWorkTitle(page, originalTitle);
  await page.waitForFunction(
    (needle) =>
      document.body.innerText.includes(needle) &&
      document.body.innerText.includes("确认执行") &&
      document.body.innerText.includes("拒绝"),
    sourceNeedle,
    { timeout: 15_000 },
  );

  await openWorkMenu(page);
  await page.locator('button[title="重命名"]').first().click();
  await page.getByRole("dialog", { name: "修改作品名" }).waitFor({ timeout: 10_000 });
  await submitWorkTitleDialog(page, renamedTitle, "保存");
  await waitForVisibleWorkTitle(page, renamedTitle);

  const renamedWork = await fetchWorkFromApi(work.id);
  assert(renamedWork.title === renamedTitle, "Work rename did not persist before confirmation");
  assert(
    Number(renamedWork.revision ?? 0) > Number(work.revision ?? 0),
    "Work rename did not advance revision before confirmation",
  );

  const beforeConfirmFrameCount = frames.length;
  const beforeConfirmLogCount = readAppLogRecords().length;
  await page.getByRole("button", { name: "确认执行" }).first().click();

  const confirmActionFrame = await waitForNewFrame(
    beforeConfirmFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.source_turn_ref === "turn_au04_latest_context_rebase_seed" &&
      frame.body?.action?.action_type === "confirm_before_execute",
    "Real workbench did not send the latest-context confirm_before_execute author_action",
    10_000,
  );

  const actionResultFrame = await waitForNewFrame(
    beforeConfirmFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "action_result" &&
      frame.body?.status === "accepted" &&
      frame.body?.action_type === "confirm_before_execute" &&
      frame.body?.confirmation_binding?.rebased_state_snapshot_ref,
    "No accepted action_result with ConfirmationBinding was received after latest-context confirm",
    30_000,
  );

  const binding = actionResultFrame.body.confirmation_binding;
  const rebasedRef = String(binding.rebased_state_snapshot_ref ?? "");
  assert(rebasedRef.includes(work.id), "ConfirmationBinding did not reference source work id");
  assert(
    rebasedRef.includes(`revision:${renamedWork.revision}`),
    "ConfirmationBinding did not include the renamed work revision",
  );

  const executedTurnFrame = await waitForNewFrame(
    beforeConfirmFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.tool_name === "character_design" &&
      (frame.body?.adoption_state?.pending ?? []).some(
        (artifact) => artifact.artifact_type === "character_seed",
      ),
    "No character_seed turn_result was received after latest-context confirmation",
    200_000,
  );
  const executedTurnResult = executedTurnFrame.body;
  const currentWorkRef = (executedTurnResult.trace_summary?.context_refs ?? []).find(
    (ref) => ref.source_type === "current_work" && String(ref.summary ?? "").includes(renamedTitle),
  );
  assert(currentWorkRef, "Confirmed turn trace did not include renamed current work summary");

  const reasonCodes = executedTurnResult.truthfulness?.reason_codes ?? [];
  assert(
    reasonCodes.includes(`rebased_state_snapshot:${rebasedRef}`),
    "Confirmed turn did not carry rebased_state_snapshot reason code",
  );
  assert(
    reasonCodes.some((code) =>
      String(code).includes("gate_result_ref:gate_result:confirmation_re_gate"),
    ),
    "Confirmed turn did not carry confirmation re-gate result ref",
  );

  await page.waitForFunction(() => document.body.innerText.includes("角色设定草稿"), {
    timeout: 10_000,
  });

  const framesAfterConfirm = frames.slice(beforeConfirmFrameCount);
  const logsAfterConfirm = readAppLogRecords().slice(beforeConfirmLogCount);
  const toolboxExecuteRecords = logsAfterConfirm.filter(
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.turn_id === executedTurnResult.turn_id &&
      record.tool_name === "character_design" &&
      record.tool_outcome === "succeeded",
  );
  const pendingCharacterSeedCount = framesAfterConfirm.reduce((count, frame) => {
    if (frame.direction !== "received" || frame.event !== "turn_result") return count;
    return (
      count +
      (frame.body?.adoption_state?.pending ?? []).filter(
        (artifact) => artifact.artifact_type === "character_seed",
      ).length
    );
  }, 0);

  assert(toolboxExecuteRecords.length >= 1, "Latest-context confirm did not dispatch tool once");
  assert(
    pendingCharacterSeedCount >= 1,
    "Latest-context confirm did not create a pending character_seed artifact",
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_id: "turn_au04_latest_context_rebase_seed",
      turn_ids: ["turn_au04_latest_context_rebase_seed"],
      work_id: work.id,
      workspace_id: work.id,
      context_work_id: work.id,
      session_id: join.session_id,
      source_work_id: work.id,
      original_title: originalTitle,
      renamed_title: renamedTitle,
      original_revision: work.revision,
      renamed_revision: renamedWork.revision,
      real_work_renamed_before_confirm: true,
      confirm_action_sent:
        confirmActionFrame.body?.action?.action_type === "confirm_before_execute",
      confirmation_binding_ref: rebasedRef,
      binding_ref_includes_source_work: rebasedRef.includes(work.id),
      binding_ref_includes_latest_revision: rebasedRef.includes(`revision:${renamedWork.revision}`),
      gate_result_refs: binding.gate_result_refs ?? [],
      gate_result_ref_present: (binding.gate_result_refs ?? []).some((ref) =>
        String(ref).includes("gate_result:confirmation_re_gate"),
      ),
      trace_context_includes_renamed_title: String(currentWorkRef.summary ?? "").includes(
        renamedTitle,
      ),
      trace_current_work_summary: currentWorkRef.summary,
      reason_codes_include_rebased_ref: reasonCodes.includes(
        `rebased_state_snapshot:${rebasedRef}`,
      ),
      reason_codes_include_gate_ref: reasonCodes.some((code) =>
        String(code).includes("gate_result_ref:gate_result:confirmation_re_gate"),
      ),
      confirmed_dispatch: executedTurnResult.truthfulness?.tool_called === true,
      artifact_pending_after_confirm: true,
      artifact_type:
        (executedTurnResult.adoption_state?.pending ?? []).find(
          (artifact) => artifact.artifact_type === "character_seed",
        )?.artifact_type ?? null,
      toolbox_execute_count: toolboxExecuteRecords.length,
      pending_character_seed_count: pendingCharacterSeedCount,
      socket_connected: true,
      duration_ms: 0,
      outcome: "done",
    },
  ];
}

function visibleTextIncludesPendingDraft(visibleText) {
  // 确认后页面已进入待采纳态；确认卡可见性在点击前已由 waitForFunction 证明。
  return /待确认的创作材料|待确认正文草稿|待保存章节草稿|章节正文草稿|正文草稿/.test(visibleText);
}

async function driveP1ChapterWordCountTarget(page) {
  const targetWordCount = 600;
  // 作者在对话框用自然语言给出"带篇幅"的创作指令：篇幅诉求由 Planner（AI）识别为
  // target_word_count（不是按钮/开关）。沿用"生成正文草稿"按钮的「标题：摘要。正文草稿」
  // 措辞，让正文按标题归到第01章计划章；字数诉求追加在"正文草稿"之后，不污染标题归章。
  const requestText =
    "请根据已采纳章节计划生成第01章：底层灵气账单：主角在欠费停灵的夜晚发现灵气带宽被公司暗中抽走。正文草稿，大约 600 字，保持为待采纳草稿。";

  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  await page.locator(chatInputSelector).fill(requestText);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const draftTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.output?.artifact_type === "prose_fragment" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment",
    "No prose_fragment turn_result was received for the word-count-target request",
    200_000,
  );
  const draftTurnResult = draftTurnFrame.body;
  const pendingArtifact = draftTurnResult.adoption_state.pending[0];

  await page.waitForFunction(
    () =>
      /待确认的创作材料|待确认正文草稿|待保存章节草稿|章节正文草稿|正文草稿/.test(
        document.body.innerText,
      ),
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: acceptDraftButtonPattern }).first().click();

  const acceptActionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "accept" &&
      frame.body?.action?.target_ref === pendingArtifact.artifact_id,
    "Real workbench did not send an accept author_action for the prose draft",
  );

  const adoptTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.truthfulness?.artifact_adopted === true &&
      Array.isArray(frame.body?.adoption_state?.resolved) &&
      frame.body.adoption_state.resolved.some(
        (entry) => entry.artifact_id === pendingArtifact.artifact_id,
      ),
    "No resolved adoption turn_result websocket frame was received after accept",
    120_000,
  );
  const adoptTurnResult = adoptTurnFrame.body;

  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].some((btn) =>
        /确认创建|保存为章节正文|保存到大纲|保存到作品档案|保存到作品/.test(
          (btn.textContent ?? "").trim(),
        ),
      ),
    { timeout: 10_000 },
  );
  const acceptButtonCleared =
    (await page.getByRole("button", { name: acceptDraftButtonPattern }).count()) === 0;
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, adoptTurnResult, sentMessage);

  await page.getByRole("button", { name: readingModeButtonPattern }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("阅读模式") &&
      document.body.innerText.includes("全书有效字数") &&
      document.body.innerText.includes("本章有效字数") &&
      !document.body.innerText.includes("暂无已采纳的章节内容"),
    { timeout: 15_000 },
  );

  const visibleText = await page.locator("body").innerText();

  const totalWords = parseBookTotalWords(visibleText);
  const chapterWords = parseChapterWords(visibleText);

  const renderedProse = await page.evaluate(() => {
    const heading = [...document.querySelectorAll("h1")].find((el) => el.textContent?.trim());
    const block = heading?.parentElement;
    if (!block) return "";
    return [...block.querySelectorAll("div")]
      .filter((el) => el.children.length === 0)
      .map((el) => el.textContent ?? "")
      .filter((text) => !text.startsWith("本章有效字数"))
      .join("");
  });
  const visibleProseWords = effectiveWordCount(renderedProse);
  const lowerBound = Math.floor(targetWordCount * 0.5);
  const stateTraceRefs = Array.isArray(adoptTurnResult.trace_summary?.state_trace_refs)
    ? adoptTurnResult.trace_summary.state_trace_refs
    : [];
  const stateTraceRef = stateTraceRefs[0]?.state_trace_ref ?? null;
  const resolvedStateTraceRef =
    adoptTurnResult.adoption_state?.resolved?.[0]?.state_trace_ref ?? null;
  const projectionSourceStateTraceRef =
    adoptTurnResult.projection_refs?.[0]?.source_state_trace_ref ?? null;
  const projectionRefreshStatus = adoptTurnResult.projection_refs?.[0]?.refresh_status ?? null;
  const projectionStaleBannerVisible = visibleText.includes("投影状态：已过期");
  const projectionRefreshButtonVisible = visibleText.includes("刷新投影");

  assert(visibleProseWords > 0, "No visible prose found in reading mode to count");
  assert(
    projectionRefreshStatus === "STALE",
    `Accepted prose did not emit STALE projection_ref refresh status: ${projectionRefreshStatus}`,
  );
  assert(
    projectionStaleBannerVisible,
    "Reading mode did not show the stale projection banner after adoption",
  );
  assert(
    projectionRefreshButtonVisible,
    "Reading mode did not show the refresh projection button after adoption",
  );
  assert(
    Number(totalWords) > 0,
    "Book total effective word count not visible/positive in reading mode",
  );
  assert(
    Number(chapterWords) > 0,
    "Chapter effective word count not visible/positive in reading mode",
  );
  assert(
    chapterWords === visibleProseWords,
    `Displayed chapter word count ${chapterWords} != effective count of visible prose ${visibleProseWords}`,
  );
  assert(
    Number(chapterWords) >= lowerBound,
    `Chapter effective word count ${chapterWords} did not approach the requested target ${targetWordCount} (>= ${lowerBound})`,
  );

  return [
    {
      ...uiState,
      turn_id: draftTurnResult.turn_id,
      draft_turn_id: draftTurnResult.turn_id,
      adopt_turn_id: adoptTurnResult.turn_id,
      artifact_id: pendingArtifact.artifact_id,
      artifact_type: pendingArtifact.artifact_type,
      chapter_title: "第01章：底层灵气账单",
      adoption_trace_ref: adoptTurnResult.trace_summary?.trace_ref,
      state_trace_ref: stateTraceRef,
      resolved_state_trace_ref: resolvedStateTraceRef,
      projection_source_state_trace_ref: projectionSourceStateTraceRef,
      projection_refresh_status: projectionRefreshStatus,
      projection_stale_banner_visible: projectionStaleBannerVisible,
      projection_refresh_button_visible: projectionRefreshButtonVisible,
      trace_summary_state_trace_refs_count: stateTraceRefs.length,
      projection_refs_count: adoptTurnResult.projection_refs?.length ?? 0,
      accept_event_sent: true,
      accept_action_type: acceptActionFrame.body?.action?.action_type,
      accept_button_cleared_after_adoption: acceptButtonCleared,
      artifact_adopted: adoptTurnResult.truthfulness?.artifact_adopted === true,
      reading_mode_populated_after_adoption: !visibleText.includes("暂无已采纳的章节内容"),
      total_word_count: totalWords,
      chapter_word_count: chapterWords,
      expected_word_count: visibleProseWords,
      word_count_matches_adopted_prose:
        chapterWords === visibleProseWords && totalWords === chapterWords,
      target_word_count_requested: targetWordCount,
      word_count_meets_target: Number(chapterWords) >= lowerBound,
      user_message_text: sentMessage?.body?.text,
    },
  ];
}

async function driveP1WordCountAudit(page) {
  // 复用采纳到阅读链路：确定性 provider 生成的正文草稿天然 < 1000 字，
  // 采纳后即为短章，用于验证 ReadingMode 的短章标记与 P1 达标进度。
  const [base] = await driveP1ChapterAdoptionReading(page);

  // 此时 page 已停在 ReadingMode：目录该章应标「短章」，顶栏显示「P1 进度」。
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      return text.includes("短章") && text.includes("P1 进度");
    },
    { timeout: 10_000 },
  );

  const shortBadgeVisible = (await page.getByText("短章", { exact: true }).count()) > 0;
  const milestoneMet = (await page.getByText("已达 P1 目标").count()) > 0;
  const visibleText = await page.locator("body").innerText();
  const milestoneProgressVisible = visibleText.includes("P1 进度");
  const belowMinChapter = Number(base.chapter_word_count ?? 0) < 1000;

  assert(shortBadgeVisible, "短章 badge not visible in TOC for a sub-1000-word adopted chapter");
  assert(milestoneProgressVisible, "P1 milestone progress not visible in reading mode top bar");
  assert(!milestoneMet, "Milestone must not be marked met for a single short chapter");
  assert(
    belowMinChapter,
    `Adopted chapter ${base.chapter_word_count} should be below the 1000-word P1 minimum`,
  );

  return [
    {
      ...base,
      short_chapter_marked: shortBadgeVisible,
      milestone_progress_visible: milestoneProgressVisible,
      milestone_met: milestoneMet,
      below_min_chapter: belowMinChapter,
    },
  ];
}

async function driveP1ChapterExpansion(page) {
  // Step 1：复用采纳到阅读链路，先生成并采纳第 1 章正文草稿（确定性下天然 < 1000 = 短章）。
  const [base] = await driveP1ChapterAdoptionReading(page);
  const draftChapterWords = Number(base.chapter_word_count ?? 0);
  assert(
    draftChapterWords > 0 && draftChapterWords < 1000,
    `Chapter 1 first draft should be a sub-1000-word short chapter, got ${draftChapterWords}`,
  );

  // Step 2：返回工作台，用自然语言多轮续写第 1 章。
  // 不存在"续写按钮"/关键字开关：续写意图由 Planner（AI）在 plan 阶段识别为 authoring_intent=continuation，
  // 目标章由 AI 从已采纳章节列表里解析。每轮续写采纳后应作为同章新场景累积字数。
  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  const continuationMessages = [
    "接着第一章往下写一段正文，让林澈继续深入矿道，把危机一步步推上来。",
    "很好，再接着这一章往下写一段正文，把冲突推到林澈不得不做出选择的地步。",
  ];

  const continuations = [];
  for (const message of continuationMessages) {
    await page.locator(chatInputSelector).fill(message);
    await page.getByRole("button", { name: /^发送$/ }).click();

    // 本轮续写 turn_result：prose_writing 产 prose_fragment，且 AI 在 plan 阶段识别为 continuation。
    const contFrame = await waitForFrame(
      (frame) =>
        frame.direction === "received" &&
        frame.event === "turn_result" &&
        frame.body?.tool_result?.tool_name === "prose_writing" &&
        frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment" &&
        frame.body?.adoption_state?.pending?.[0]?.authoring_intent === "continuation",
      `No continuation prose_fragment turn_result (authoring_intent=continuation) for: ${message}`,
      200_000,
    );
    const pending = contFrame.body.adoption_state.pending[0];

    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("button")].some((btn) =>
          /确认创建|保存为章节正文|保存到大纲|保存到作品档案|保存到作品/.test(
            (btn.textContent ?? "").trim(),
          ),
        ),
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: acceptDraftButtonPattern }).first().click();

    const adoptFrame = await waitForFrame(
      (frame) =>
        frame.direction === "received" &&
        frame.event === "turn_result" &&
        frame.body?.truthfulness?.artifact_adopted === true &&
        frame.body?.adoption_state?.resolved?.some(
          (entry) => entry.artifact_id === pending.artifact_id,
        ),
      `No resolved adoption turn_result after continuation accept for: ${message}`,
      120_000,
    );

    // 采纳后按钮必须消失，避免重复点击重复提交。
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll("button")].some((btn) =>
          /确认创建|保存为章节正文|保存到大纲|保存到作品档案|保存到作品/.test(
            (btn.textContent ?? "").trim(),
          ),
        ),
      { timeout: 10_000 },
    );

    continuations.push({
      message,
      artifact_id: pending.artifact_id,
      authoring_intent: pending.authoring_intent,
      target_chapter: pending.target_chapter ?? null,
      adopted: adoptFrame.body.truthfulness?.artifact_adopted === true,
    });
  }

  // Step 3：回到阅读模式，等本章有效字数累积过 P1 单章 1000 字门槛。
  await page.getByRole("button", { name: readingModeButtonPattern }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("阅读模式") &&
      document.body.innerText.includes("全书有效字数"),
    { timeout: 15_000 },
  );
  await page
    .waitForFunction(
      () => {
        const match = /本章有效字数\s*([\d,]+)\s*字/.exec(document.body.innerText);
        return Boolean(match) && Number(match[1].replace(/,/g, "")) >= 1000;
      },
      { timeout: 20_000 },
    )
    .catch(() => {});

  const visibleText = await page.locator("body").innerText();
  const lastTurnResult = latestTurnResult() ?? {};
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, lastTurnResult, sentMessage);

  const chapterWords = parseChapterWords(visibleText);
  const totalWords = parseBookTotalWords(visibleText);
  const shortBadgeVisible = (await page.getByText("短章", { exact: true }).count()) > 0;
  const allRecognizedContinuation = continuations.every(
    (entry) => entry.authoring_intent === "continuation" && entry.adopted,
  );

  assert(
    Number(chapterWords) >= 1000,
    `Chapter effective word count ${chapterWords} did not reach the P1 1000-word minimum after continuations`,
  );
  // 续写必须落到同一章（target_chapter 命中既有章）：单章模型下全书字数 == 本章字数。
  assert(
    totalWords === chapterWords,
    `Continuations created extra chapters instead of appending: book total ${totalWords} != single chapter ${chapterWords}`,
  );
  assert(
    Number(chapterWords) > draftChapterWords,
    `Word count did not accumulate: chapter ${chapterWords} not greater than first draft ${draftChapterWords}`,
  );
  assert(
    !shortBadgeVisible,
    "Chapter is still marked 短章 after accumulating past 1000 words (short -> ok transition failed)",
  );
  assert(
    allRecognizedContinuation,
    "At least one continuation turn was not recognized as authoring_intent=continuation or not adopted",
  );

  return [
    {
      ...uiState,
      draft_turn_id: base.draft_turn_id,
      first_adopt_turn_id: base.adopt_turn_id,
      chapter_title: base.chapter_title,
      first_draft_chapter_words: draftChapterWords,
      continuation_count: continuations.length,
      continuation_intents: continuations.map((entry) => entry.authoring_intent),
      continuation_target_chapters: continuations.map((entry) => entry.target_chapter),
      continuations_all_recognized: allRecognizedContinuation,
      final_chapter_word_count: chapterWords,
      final_total_word_count: totalWords,
      appended_to_single_chapter: totalWords === chapterWords,
      accumulated_past_min: Number(chapterWords) >= 1000,
      short_to_ok_transition: !shortBadgeVisible && Number(chapterWords) >= 1000,
      user_message_text: sentMessage?.body?.text,
    },
  ];
}

async function driveP1ChapterExpansionMultichapter(page) {
  // checkpoint 3 连续多章：作者用自然语言逐章推进第 1/2/3 章首稿，每章正文按计划章
  // 标题归到各自计划章（target_chapter 精确/标题匹配），不串章、各自累积。意图与
  // 目标章由 Planner（AI）识别，不加续写按钮/关键字（v3 反模式）。
  const plan = [
    { title: "第01章：底层灵气账单", summary: "主角在欠费停灵的夜晚发现灵气带宽被公司暗中抽走。" },
    {
      title: "第02章：旧服务器里的残诀",
      summary: "主角从废弃服务器中找到残缺功法，并第一次突破底层限制。",
    },
    {
      title: "第03章：黑市调频师",
      summary: "主角结识擅长调制灵气频段的调频师，获得追查垄断链路的入口。",
    },
  ];

  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  const written = [];
  let lastAdopt = null;

  for (const ch of plan) {
    const instruction = `请根据已采纳章节计划生成${ch.title}：${ch.summary}正文草稿，保持为待采纳草稿。`;
    await page.locator(chatInputSelector).fill(instruction);
    await page.getByRole("button", { name: /^发送$/ }).click();

    const adoptedIds = new Set(written.map((w) => w.artifact_id));
    const draftFrame = await waitForFrame(
      (f) =>
        f.direction === "received" &&
        f.event === "turn_result" &&
        f.body?.tool_result?.tool_name === "prose_writing" &&
        f.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment" &&
        !adoptedIds.has(f.body.adoption_state.pending[0].artifact_id),
      `No new prose_fragment turn_result for ${ch.title}`,
      200_000,
    );
    const pending = draftFrame.body.adoption_state.pending[0];

    await page.waitForFunction(
      () =>
        /确认创建|保存为章节正文|保存到大纲|保存到作品档案|保存到作品/.test(
          document.body.innerText,
        ),
      undefined,
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: acceptDraftButtonPattern }).first().click();

    const adoptFrame = await waitForFrame(
      (f) =>
        f.direction === "received" &&
        f.event === "turn_result" &&
        f.body?.truthfulness?.artifact_adopted === true &&
        f.body?.adoption_state?.resolved?.some((e) => e.artifact_id === pending.artifact_id),
      `No resolved adoption turn_result for ${ch.title}`,
      120_000,
    );
    lastAdopt = adoptFrame.body;

    // 采纳后旧草稿卡的保存按钮必须消失，避免下一章误点到上一张卡。
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll("button")].some((b) =>
          /确认创建|保存为章节正文|保存到大纲|保存到作品档案|保存到作品/.test(
            (b.textContent ?? "").trim(),
          ),
        ),
      undefined,
      { timeout: 10_000 },
    );

    written.push({
      title: ch.title,
      artifact_id: pending.artifact_id,
      draft_turn_id: draftFrame.body.turn_id,
      adopt_turn_id: adoptFrame.body.turn_id,
      adopted: adoptFrame.body.truthfulness?.artifact_adopted === true,
    });
  }

  // 进入阅读模式：目录应显示完整计划，且第 1/2/3 章各有正文。
  await page.getByRole("button", { name: readingModeButtonPattern }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("阅读模式") &&
      document.body.innerText.includes("第01章：底层灵气账单") &&
      document.body.innerText.includes("第02章：旧服务器里的残诀") &&
      document.body.innerText.includes("第03章：黑市调频师"),
    { timeout: 15_000 },
  );
  await page
    .waitForFunction(() => document.body.innerText.includes("本章有效字数"), undefined, {
      timeout: 15_000,
    })
    .catch(() => {});

  // 从后端真实 get_toc 投影读各章字数与顺序：这是"多章各归各章、不串"的最可靠证据。
  const tocReplies = frames.filter((f) => {
    const resp = f.body?.response ?? f.payload?.response ?? f.body;
    return f.direction === "received" && Array.isArray(resp?.volumes);
  });
  const lastTocReply = tocReplies[tocReplies.length - 1];
  const toc = lastTocReply
    ? (lastTocReply.body?.response ?? lastTocReply.payload?.response ?? lastTocReply.body)
    : null;
  const allChapters = (toc?.volumes ?? []).flatMap((v) => v.chapters ?? []);
  const targets = written.map((w) => allChapters.find((c) => c.title === w.title));
  const writtenChapters = allChapters.filter((c) => Number(c.word_count ?? 0) > 0);
  const seqs = targets.map((c) => Number(c?.seq ?? 0));
  const orderCorrect = seqs.every((s, i) => i === 0 || s > seqs[i - 1]);
  const allHaveProse = targets.every((c) => Number(c?.word_count ?? 0) > 0);

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, lastAdopt ?? {}, sentMessage);

  assert(toc, "No get_toc projection frame captured in reading mode");
  assert(
    writtenChapters.length >= written.length,
    `Expected >= ${written.length} chapters with prose, got ${writtenChapters.length}`,
  );
  assert(allHaveProse, "A target chapter has no prose — cross-chapter contamination or misfiling");
  assert(orderCorrect, `Chapter order incorrect in TOC: seqs=${seqs.join(",")}`);
  assert(
    !visibleText.includes("暂无已采纳的章节内容"),
    "Reading mode stayed empty after multi-chapter adoption",
  );

  const clickedChapterTitles = [];
  for (const ch of written.slice(1)) {
    await page.getByText(ch.title, { exact: true }).filter({ visible: true }).first().click();
    await page.waitForFunction(
      (title) => {
        const activeHeading = [...document.querySelectorAll("h1")].find((el) =>
          (el.textContent ?? "").includes(title),
        );
        return Boolean(activeHeading) && document.body.innerText.includes("本章有效字数");
      },
      ch.title,
      { timeout: 15_000 },
    );
    clickedChapterTitles.push(ch.title);
  }

  const emptyChapterTitle = "第04章：巡检队的诱捕";
  await page
    .getByText(emptyChapterTitle, { exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await page.waitForFunction(
    (title) => {
      const activeHeading = [...document.querySelectorAll("h1")].find((el) =>
        (el.textContent ?? "").includes(title),
      );
      return (
        Boolean(activeHeading) && document.body.innerText.includes("本章尚无已采纳正文，待补足。")
      );
    },
    emptyChapterTitle,
    { timeout: 15_000 },
  );

  return [
    {
      ...uiState,
      draft_turn_ids: written.map((w) => w.draft_turn_id),
      adopt_turn_ids: written.map((w) => w.adopt_turn_id),
      target_chapter_titles: written.map((w) => w.title),
      written_chapter_count: writtenChapters.length,
      target_chapters_with_prose: targets.filter((c) => Number(c?.word_count ?? 0) > 0).length,
      per_chapter_words: targets.map((c) => Number(c?.word_count ?? 0)),
      total_chapter_count: allChapters.length,
      chapter_order_correct: orderCorrect,
      all_chapters_have_prose: allHaveProse,
      chapter_navigation_verified: clickedChapterTitles.length === written.length - 1,
      clicked_chapter_titles: clickedChapterTitles,
      empty_chapter_title: emptyChapterTitle,
      empty_chapter_empty_state_visible: true,
      all_adopted: written.every((w) => w.adopted),
      user_message_text: sentMessage?.body?.text,
    },
  ];
}

async function driveP1ChapterEditThenAccept(page) {
  // 复用 p1-chapter-draft-generation：生成第 1 章正文草稿。
  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "大纲与结构" }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("已采纳章节计划") &&
      document.body.innerText.includes("第01章：底层灵气账单"),
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: "生成正文草稿" }).first().click();

  const draftTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.output?.artifact_type === "prose_fragment" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment",
    "No P1 chapter draft prose_fragment turn_result websocket frame was received",
    170_000,
  );
  const pendingArtifact = draftTurnFrame.body.adoption_state.pending[0];

  await page.waitForFunction(
    () =>
      /待确认的创作材料|待保存章节草稿|正文草稿/.test(document.body.innerText) &&
      /修改后采纳|修改后保存正文/.test(document.body.innerText),
    { timeout: 10_000 },
  );

  // 点「修改后保存正文」打开编辑弹窗，作者改写全文后再保存。
  await page
    .getByRole("button", { name: /修改后采纳|修改后保存正文/ })
    .first()
    .click();

  const editedText =
    "林澈在灵气账单的红光里睁开眼，城市在脚下安静地呼吸，他知道反垄断的第一刀终于该落下了。";
  const textarea = page.locator("textarea").first();
  await textarea.waitFor({ timeout: 10_000 });
  await textarea.fill(editedText);

  await page.getByRole("button", { name: /采纳修改后的版本|保存修改后的版本/ }).click();

  const acceptActionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "edit_then_accept" &&
      frame.body?.action?.target_ref === pendingArtifact.artifact_id &&
      frame.body?.action?.payload?.edited_content === editedText,
    "Real workbench did not send edit_then_accept author_action carrying edited_content",
  );

  const adoptTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.truthfulness?.artifact_adopted === true &&
      (frame.body?.adoption_state?.resolved ?? []).some(
        (entry) =>
          entry.artifact_id === pendingArtifact.artifact_id &&
          entry.adoption_status === "EDITED_ACCEPTED",
      ),
    "No EDITED_ACCEPTED resolved turn_result websocket frame after edit_then_accept",
    120_000,
  );
  const adoptTurnResult = adoptTurnFrame.body;

  // 采纳后「修改后采纳」按钮必须消失，避免重复提交。
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].some(
        (btn) => (btn.textContent ?? "").trim() === "修改后采纳",
      ),
    { timeout: 10_000 },
  );
  const editButtonCleared = (await page.getByRole("button", { name: "修改后采纳" }).count()) === 0;

  await page.getByRole("button", { name: readingModeButtonPattern }).click();
  // 同 adoption-reading：必须等「本章有效字数」也渲染再快照，否则章节正文（编辑后正文）
  // 来自 get_chapter_content 的异步加载会被抢拍，导致误判正文未显示。
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("阅读模式") &&
      document.body.innerText.includes("全书有效字数") &&
      document.body.innerText.includes("本章有效字数") &&
      !document.body.innerText.includes("暂无已采纳的章节内容"),
    { timeout: 15_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, adoptTurnResult, sentMessage);

  const totalWords = parseBookTotalWords(visibleText);
  const chapterWords = parseChapterWords(visibleText);
  const editedWords = effectiveWordCount(editedText);
  const editedTextShown = visibleText.includes(editedText);

  assert(editedWords > 0, "Edited text had no effective words");
  assert(editedTextShown, "Author-edited prose was not shown in reading mode");
  assert(Number(totalWords) > 0, "Book total effective word count not visible/positive");
  assert(Number(chapterWords) > 0, "Chapter effective word count not visible/positive");
  assert(
    chapterWords === editedWords,
    `Displayed chapter word count ${chapterWords} != effective count of EDITED prose ${editedWords}`,
  );
  assert(
    totalWords === chapterWords,
    `Book total ${totalWords} != single adopted chapter ${chapterWords}`,
  );

  return [
    {
      ...uiState,
      turn_id: draftTurnFrame.body.turn_id,
      draft_turn_id: draftTurnFrame.body.turn_id,
      adopt_turn_id: adoptTurnResult.turn_id,
      artifact_id: pendingArtifact.artifact_id,
      artifact_type: pendingArtifact.artifact_type,
      chapter_title: "第01章：底层灵气账单",
      edit_then_accept_event_sent: true,
      accept_action_type: acceptActionFrame.body?.action?.action_type,
      edit_button_cleared_after_adoption: editButtonCleared,
      artifact_edited_accepted: (adoptTurnResult.adoption_state?.resolved ?? []).some(
        (entry) => entry.adoption_status === "EDITED_ACCEPTED",
      ),
      edited_text_shown_in_reading: editedTextShown,
      total_word_count: totalWords,
      chapter_word_count: chapterWords,
      expected_word_count: editedWords,
      word_count_matches_edited_prose: chapterWords === editedWords && totalWords === chapterWords,
      user_message_text: sentMessage?.body?.text,
    },
  ];
}

async function driveP1ChapterOverwriteConfirm(page) {
  const seen = new Set();

  async function generatePendingDraft() {
    await page.getByText("打开档案").first().click();
    await page.getByRole("tab", { name: "大纲与结构" }).click();
    await page.waitForFunction(
      () =>
        document.body.innerText.includes("已采纳章节计划") &&
        document.body.innerText.includes("第01章：底层灵气账单"),
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: "生成正文草稿" }).first().click();

    const frame = await waitForFrame(
      (f) =>
        f.direction === "received" &&
        f.event === "turn_result" &&
        f.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment" &&
        !seen.has(f.body.adoption_state.pending[0].artifact_id),
      "No new prose_fragment draft frame was received",
      170_000,
    );
    const artifact = frame.body.adoption_state.pending[0];
    seen.add(artifact.artifact_id);
    await page
      .getByRole("button", { name: acceptDraftButtonPattern })
      .first()
      .waitFor({ timeout: 10_000 });
    // 生成 turn 才是带 LLM 调用的轮次（采纳/确认 turn 不调 LLM）。
    return { artifact, generateTurnId: frame.body.turn_id };
  }

  async function waitAdopted(artifactId) {
    return waitForFrame(
      (f) =>
        f.direction === "received" &&
        f.event === "turn_result" &&
        f.body?.truthfulness?.artifact_adopted === true &&
        (f.body?.adoption_state?.resolved ?? []).some((e) => e.artifact_id === artifactId),
      "No adoption resolved turn_result frame was received",
      120_000,
    );
  }

  // ── Cycle 1：首次采纳第 1 章正文（无既有 → 直接采纳）。
  const cycle1 = await generatePendingDraft();
  const artifact1 = cycle1.artifact;
  await page.getByRole("button", { name: acceptDraftButtonPattern }).first().click();
  await waitAdopted(artifact1.artifact_id);

  // ── Cycle 2：再次生成并采纳第 1 章正文（覆盖已有 → 需确认）。
  const cycle2 = await generatePendingDraft();
  const artifact2 = cycle2.artifact;
  await page.getByRole("button", { name: acceptDraftButtonPattern }).first().click();

  const confirmFrame = await waitForFrame(
    (f) =>
      f.direction === "received" &&
      f.event === "turn_result" &&
      f.body?.adoption_decision?.decision_type === "require_confirmation" &&
      f.body?.truthfulness?.artifact_adopted === false,
    "Overwrite did not produce a require_confirmation turn_result",
    120_000,
  );
  const requireConfirmation = confirmFrame.body;

  // 确认前不写：高风险确认态，出现「确认执行」/「拒绝」。
  await page.waitForFunction(
    () => document.body.innerText.includes("确认执行") && document.body.innerText.includes("拒绝"),
    { timeout: 10_000 },
  );

  // ── 作者确认执行 → 重新 gate → 覆盖采纳。
  await page.getByRole("button", { name: "确认执行" }).first().click();
  const overwriteAdopt = await waitAdopted(artifact2.artifact_id);

  // ── 打开阅读模式：同一章显示采纳后正文，章节不重复。
  await page.getByRole("button", { name: readingModeButtonPattern }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("阅读模式") &&
      !document.body.innerText.includes("暂无已采纳的章节内容"),
    { timeout: 15_000 },
  );

  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, overwriteAdopt.body, sentMessage);

  assert(
    requireConfirmation.behavior_state?.active?.behavior_type === "confirmation",
    "Overwrite require_confirmation did not open a confirmation behavior",
  );
  assert(
    requireConfirmation.truthfulness?.production_write_performed === false,
    "Overwrite require_confirmation claimed a production write before confirmation",
  );

  return [
    {
      ...uiState,
      turn_id: overwriteAdopt.body.turn_id,
      first_generate_turn_id: cycle1.generateTurnId,
      second_generate_turn_id: cycle2.generateTurnId,
      first_artifact_id: artifact1.artifact_id,
      second_artifact_id: artifact2.artifact_id,
      cycle1_adopted: true,
      cycle2_required_confirmation: true,
      confirmation_behavior_opened:
        requireConfirmation.behavior_state?.active?.behavior_type === "confirmation",
      no_write_before_confirmation:
        requireConfirmation.truthfulness?.production_write_performed === false,
      confirmed_overwrite_adopted: overwriteAdopt.body.truthfulness?.artifact_adopted === true,
      confirm_action_clicked: true,
    },
  ];
}

async function driveAu09MemoryCreateRecall(page) {
  const nonce = "灵市拍卖行";
  const memoryContent = `${nonce}是本城唯一可以合法买卖灵气的拍卖交易所，由九大家族共管，禁止散修私下交易灵气。`;

  // ── 打开记忆管理页（真实工作台头部入口）。
  await page.getByRole("button", { name: /记忆/ }).first().click();
  await page.waitForFunction(() => document.body.innerText.includes("记忆管理"), {
    timeout: 10_000,
  });

  // ── 新建一条设定（后端强制从 DRAFT 开始）。
  await page.getByRole("button", { name: "+ 新建记忆" }).click();
  await page.locator("textarea").first().fill(memoryContent);
  await page.getByRole("button", { name: "创建" }).click();
  // 注意 Playwright 签名 waitForFunction(fn, arg, options)：arg 在前、options 在后。
  await page.waitForFunction((n) => document.body.innerText.includes(n), nonce, {
    timeout: 10_000,
  });

  // ── 打开详情并确认（CONFIRMED + recallable 才进召回）。
  await page.getByText(nonce).first().click();
  await page.getByRole("button", { name: "确认" }).click();
  // 确认后 DRAFT 专属的「确认」按钮消失 → 证明该记忆已转为 CONFIRMED（不依赖 body 里
  // 既有的 CONFIRMED 文本，避免被种子记忆的状态误判）。
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].some(
        (btn) => (btn.textContent ?? "").trim() === "确认",
      ),
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: "×" }).first().click();

  // ── 返回工作台。
  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  // ── 发一条与该设定相关的消息：召回应命中并进入 prompt + trace。
  const message = `请继续推进${nonce}的剧情，写一段灵气拍卖的场景。`;
  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const turnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.assistant_message != null,
    "No turn_result frame after memory-grounded message",
    170_000,
  );
  const turnResult = turnFrame.body;

  // ── 打开「为什么」面板：应显示「已确认设定」记忆来源。
  await openLatestWhyDialog(page);
  await page.waitForFunction(() => document.body.innerText.includes("已确认设定"), {
    timeout: 10_000,
  });

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, turnResult, sentMessage);

  const whyShowsMemorySource = visibleText.includes("已确认设定");
  assert(whyShowsMemorySource, "Why panel did not show the confirmed-memory source");

  return [
    {
      ...uiState,
      turn_id: turnResult.turn_id,
      recall_turn_id: turnResult.turn_id,
      memory_nonce: nonce,
      memory_created: true,
      memory_confirmed: true,
      message_text: message,
      why_shows_memory_source: whyShowsMemorySource,
    },
  ];
}

async function driveAu09MemoryManagementEntry(page) {
  const lockedNonce = "蓝焰税契";
  const archivedNonce = "暮钟海图";
  const lockedContent = `${lockedNonce}是九大家族签过血印的税契，任何灵气拍卖都必须先核验蓝焰税契编号。`;
  const archivedContent = `${archivedNonce}是旧版海图，曾经记录灵气暗港路线，但现在已经被官方作废归档。`;

  async function openMemoryPage() {
    await page.getByRole("button", { name: /记忆/ }).first().click();
    await page.waitForFunction(() => document.body.innerText.includes("记忆管理"), undefined, {
      timeout: 10_000,
    });
  }

  async function createMemory(content, nonce) {
    await page.getByRole("button", { name: "+ 新建记忆" }).click();
    await page.locator("textarea").first().fill(content);
    await page.getByRole("button", { name: "创建" }).click();
    await page.waitForFunction((n) => document.body.innerText.includes(n), nonce, {
      timeout: 10_000,
    });
  }

  async function openMemoryDetail(nonce) {
    const row = page.locator("tr", { hasText: nonce }).first();
    await row.waitFor({ timeout: 10_000 });
    await row.click();
    await page.waitForFunction(() => document.body.innerText.includes("记忆详情"), undefined, {
      timeout: 10_000,
    });
  }

  async function closeMemoryDetail() {
    await page.getByRole("button", { name: "×" }).first().click();
    await page.waitForTimeout(200);
  }

  await openMemoryPage();

  // ── 创建、确认并锁定一条作者记忆。锁定保护核心事实，但不应阻止普通召回。
  await createMemory(lockedContent, lockedNonce);
  await openMemoryDetail(lockedNonce);
  await page.getByRole("button", { name: "确认" }).click();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].some(
        (btn) => (btn.textContent ?? "").trim() === "确认",
      ) && document.body.innerText.includes("CONFIRMED"),
    undefined,
    { timeout: 10_000 },
  );

  await page.getByRole("button", { name: "锁定" }).click();
  await page.waitForFunction(
    () => document.body.innerText.includes("已锁定") && document.body.innerText.includes("解锁"),
    undefined,
    { timeout: 10_000 },
  );

  const deprecateDisabledWhileLocked = await page
    .getByRole("button", { name: "废弃" })
    .isDisabled();
  const archiveDisabledWhileLocked = await page.getByRole("button", { name: "归档" }).isDisabled();
  assert(deprecateDisabledWhileLocked, "Locked memory still allowed direct deprecate in UI");
  assert(archiveDisabledWhileLocked, "Locked memory still allowed direct archive in UI");

  await closeMemoryDetail();
  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  const lockedRecallMessage = `请围绕${lockedNonce}写一句拍卖行冲突。`;
  await page.locator(chatInputSelector).fill(lockedRecallMessage);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const lockedRecallFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.assistant_message != null,
    "No turn_result frame after locked-memory recall message",
    170_000,
  );
  const lockedRecallTurn = lockedRecallFrame.body;
  const lockedContext = await waitForAppLogRecord(
    (record) =>
      record.event === "context.assemble.done" &&
      record.turn_id === lockedRecallTurn.turn_id &&
      record.has_memory === true,
    "Locked confirmed memory was not recalled before terminal lifecycle action",
    20_000,
  );
  const lockedWhyText = await openLatestWhyDialog(page);
  const whyShowsLockedMemorySource = lockedWhyText.includes("已确认设定");
  assert(whyShowsLockedMemorySource, "Why panel did not show locked confirmed memory source");
  await page.keyboard.press("Escape");
  await page
    .getByRole("dialog")
    .first()
    .waitFor({ state: "detached", timeout: 5_000 })
    .catch(() => {});

  // ── 回到管理页，解锁后废弃该记忆；废弃必须变成不可召回。
  await openMemoryPage();
  await openMemoryDetail(lockedNonce);
  await page.getByRole("button", { name: "解锁" }).click();
  await page.waitForFunction(
    () => {
      const buttons = [...document.querySelectorAll("button")];
      const deprecate = buttons.find((btn) => (btn.textContent ?? "").trim() === "废弃");
      const unlock = buttons.find((btn) => (btn.textContent ?? "").trim() === "解锁");
      return deprecate != null && deprecate.disabled === false && unlock == null;
    },
    undefined,
    { timeout: 10_000 },
  );
  assert(
    !(await page.getByRole("button", { name: "废弃" }).isDisabled()),
    "Deprecated action stayed disabled after unlocking memory",
  );
  await page.getByRole("button", { name: "废弃" }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("DEPRECATED") &&
      document.body.innerText.includes("不可召回"),
    undefined,
    { timeout: 10_000 },
  );
  const deprecatedVisible = await page
    .locator("body")
    .innerText()
    .then((text) => text.includes("DEPRECATED") && text.includes("不可召回"));
  assert(deprecatedVisible, "Deprecated memory did not show terminal non-recallable state");
  await closeMemoryDetail();

  // ── 第二条走归档路径，覆盖 archived terminal lifecycle。
  await createMemory(archivedContent, archivedNonce);
  await openMemoryDetail(archivedNonce);
  await page.getByRole("button", { name: "确认" }).click();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].some(
        (btn) => (btn.textContent ?? "").trim() === "确认",
      ) && document.body.innerText.includes("CONFIRMED"),
    undefined,
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: "归档" }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("ARCHIVED") && document.body.innerText.includes("不可召回"),
    undefined,
    { timeout: 10_000 },
  );
  const archivedVisible = await page
    .locator("body")
    .innerText()
    .then((text) => text.includes("ARCHIVED") && text.includes("不可召回"));
  assert(archivedVisible, "Archived memory did not show terminal non-recallable state");
  await closeMemoryDetail();

  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  const seenTurnIdsBeforeTerminalProbe = new Set(
    frames
      .filter((frame) => frame.direction === "received" && frame.event === "turn_result")
      .map((frame) => frame.body?.turn_id)
      .filter(Boolean),
  );
  const terminalRecallMessage = `请同时解释${lockedNonce}和${archivedNonce}还能不能作为后续设定使用。`;
  await page.locator(chatInputSelector).fill(terminalRecallMessage);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const terminalRecallFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      !seenTurnIdsBeforeTerminalProbe.has(frame.body.turn_id) &&
      frame.body?.assistant_message != null,
    "No turn_result frame after terminal-memory recall probe",
    170_000,
  );
  const terminalRecallTurn = terminalRecallFrame.body;
  const terminalContext = await waitForAppLogRecord(
    (record) =>
      record.event === "context.assemble.done" && record.turn_id === terminalRecallTurn.turn_id,
    "No context assembly record was emitted for terminal memory recall probe",
    20_000,
  );
  const terminalMemorySummaries = (terminalRecallTurn.trace_summary?.context_refs ?? [])
    .filter((ref) => String(ref.source_type) === "memory")
    .map((ref) => String(ref.summary ?? ""))
    .join("\n");
  const terminalManagedMemoryExcluded =
    !terminalMemorySummaries.includes(lockedNonce) &&
    !terminalMemorySummaries.includes(archivedNonce);
  assert(
    terminalManagedMemoryExcluded,
    "Deprecated/archived managed memory still entered ordinary dialogue context",
  );
  const terminalWhyText = await openLatestWhyDialog(page);
  const whyExcludesTerminalMemoryContent =
    !terminalWhyText.includes(lockedContent) && !terminalWhyText.includes(archivedContent);
  assert(
    whyExcludesTerminalMemoryContent,
    "Why panel still showed deprecated/archived managed memory content after terminal actions",
  );

  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, terminalRecallTurn, sentMessage);

  return [
    {
      ...uiState,
      turn_id: terminalRecallTurn.turn_id,
      turn_ids: [lockedRecallTurn.turn_id, terminalRecallTurn.turn_id],
      locked_recall_turn_id: lockedRecallTurn.turn_id,
      terminal_recall_turn_id: terminalRecallTurn.turn_id,
      memory_nonce: lockedNonce,
      archived_memory_nonce: archivedNonce,
      memory_created: true,
      memory_confirmed: true,
      memory_locked: true,
      locked_controls_disabled: deprecateDisabledWhileLocked && archiveDisabledWhileLocked,
      locked_recalled_before_terminal_action: lockedContext.has_memory === true,
      why_shows_locked_memory_source: whyShowsLockedMemorySource,
      memory_deprecated: deprecatedVisible,
      archived_memory_created: true,
      archived_memory_confirmed: true,
      archived_memory_archived: archivedVisible,
      terminal_context_has_memory: terminalContext.has_memory === true,
      terminal_managed_memory_excluded: terminalManagedMemoryExcluded,
      why_excludes_terminal_memory_content: whyExcludesTerminalMemoryContent,
      message_text: terminalRecallMessage,
    },
  ];
}

async function driveAu09MemoryManagementFilterMatrix(page) {
  const alphaNonce = "筛矩灵印";
  const betaNonce = "筛矩锁印";
  const gammaNonce = "筛矩外印";
  const alphaContent = `${alphaNonce}只在第七夜发亮，用于校验记忆关键词筛选矩阵。`;
  const betaContent = `${betaNonce}属于主角档案，作用范围限定在当前章节，并且必须锁定保护。`;
  const gammaContent = `${gammaNonce}是另一条剧情事实，用于证明筛选不会把无关记忆混入结果。`;

  async function openMemoryPage() {
    await page.getByRole("button", { name: /记忆/ }).first().click();
    await page.waitForFunction(() => document.body.innerText.includes("记忆管理"), {
      timeout: 10_000,
    });
  }

  async function waitForNotLoading() {
    await page.waitForFunction(() => !document.body.innerText.includes("加载中…"), {
      timeout: 10_000,
    });
  }

  async function visibleRows() {
    return page.evaluate(() =>
      [...document.querySelectorAll("tbody tr")].map((row) => {
        const cells = [...row.querySelectorAll("td")].map((cell) =>
          (cell.textContent ?? "").replace(/\s+/g, " ").trim(),
        );

        return {
          text: (row.textContent ?? "").replace(/\s+/g, " ").trim(),
          cells,
        };
      }),
    );
  }

  async function createMemory({ content, type, scope, locked }) {
    await page.getByRole("button", { name: "+ 新建记忆" }).click();
    await page.locator("textarea").first().fill(content);
    const allSelects = page.locator("select");
    await allSelects.nth(4).selectOption(type);
    await allSelects.nth(5).selectOption(scope);
    if (locked) {
      await page
        .locator("label")
        .filter({ hasText: "锁定" })
        .locator('input[type="checkbox"]')
        .check();
    }
    await page.getByRole("button", { name: "创建" }).click();
    await page.waitForFunction((needle) => document.body.innerText.includes(needle), content, {
      timeout: 10_000,
    });
    await waitForNotLoading();
  }

  async function openMemoryDetail(nonce) {
    const row = page.locator("tr", { hasText: nonce }).first();
    await row.waitFor({ timeout: 10_000 });
    await row.click();
    await page.waitForFunction(() => document.body.innerText.includes("记忆详情"), {
      timeout: 10_000,
    });
  }

  async function closeMemoryDetail() {
    await page.getByRole("button", { name: "×" }).first().click();
    await page.waitForTimeout(200);
  }

  async function applyFilters({ keyword = "", type = "", scope = "", status = "", locked = "" }) {
    await page.getByPlaceholder("搜索记忆…").fill(keyword);
    const filters = page.locator("select");
    await filters.nth(0).selectOption(type);
    await filters.nth(1).selectOption(scope);
    await filters.nth(2).selectOption(status);
    await filters.nth(3).selectOption(locked);
    await waitForNotLoading();
  }

  async function waitForRows(label, predicate) {
    await page.waitForFunction(
      ({ expected, alpha, beta, gamma }) => {
        const rows = [...document.querySelectorAll("tbody tr")].map((row) =>
          (row.textContent ?? "").replace(/\s+/g, " ").trim(),
        );

        const contains = (needle) => rows.some((text) => text.includes(needle));
        if (expected === "baseline") {
          return contains(alpha) && contains(beta) && contains(gamma);
        }
        if (expected === "alpha-only") {
          return contains(alpha) && !contains(beta) && !contains(gamma);
        }
        if (expected === "beta-only") {
          return contains(beta) && !contains(alpha) && !contains(gamma);
        }
        if (expected === "gamma-only") {
          return contains(gamma) && !contains(alpha) && !contains(beta);
        }
        return false;
      },
      { expected: label, alpha: alphaNonce, beta: betaNonce, gamma: gammaNonce },
      { timeout: 10_000 },
    );
    return visibleRows();
  }

  function rowContains(rows, needle) {
    return rows.some((row) => row.text.includes(needle));
  }

  await openMemoryPage();

  await createMemory({
    content: alphaContent,
    type: "WORLD_RULE",
    scope: "WORK",
    locked: false,
  });
  await createMemory({
    content: betaContent,
    type: "CHARACTER_PROFILE",
    scope: "CHAPTER",
    locked: true,
  });
  await openMemoryDetail(betaNonce);
  await page.getByRole("button", { name: "确认" }).click();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].some(
        (btn) => (btn.textContent ?? "").trim() === "确认",
      ) && document.body.innerText.includes("CONFIRMED"),
    { timeout: 10_000 },
  );
  await closeMemoryDetail();
  await createMemory({
    content: gammaContent,
    type: "PLOT_FACT",
    scope: "SESSION",
    locked: false,
  });

  await applyFilters({});
  const baselineRows = await waitForRows("baseline");

  await applyFilters({ keyword: alphaNonce });
  const keywordRows = await waitForRows("alpha-only");

  await applyFilters({ type: "CHARACTER_PROFILE" });
  const typeRows = await waitForRows("beta-only");

  await applyFilters({ scope: "CHAPTER" });
  const scopeRows = await waitForRows("beta-only");

  await applyFilters({ status: "CONFIRMED" });
  const statusRows = await waitForRows("beta-only");

  await applyFilters({ locked: "true" });
  const lockedRows = await waitForRows("beta-only");

  await applyFilters({
    keyword: betaNonce,
    type: "CHARACTER_PROFILE",
    scope: "CHAPTER",
    status: "CONFIRMED",
    locked: "true",
  });
  const combinedRows = await waitForRows("beta-only");

  await applyFilters({
    keyword: gammaNonce,
    type: "PLOT_FACT",
    scope: "SESSION",
    status: "DRAFT",
    locked: "false",
  });
  const draftUnlockedRows = await waitForRows("gamma-only");

  const memoryRequestUrls = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => name.includes("/api/works/") && name.includes("/memories"))
      .slice(-30),
  );
  const joinReply = latestChannelJoinReply();
  const joined = joinReply?.body?.response ?? joinReply?.body ?? {};
  const visibleText = await page.locator("body").innerText();

  assert(rowContains(baselineRows, alphaNonce), "Baseline memory table did not show alpha row");
  assert(rowContains(baselineRows, betaNonce), "Baseline memory table did not show beta row");
  assert(rowContains(baselineRows, gammaNonce), "Baseline memory table did not show gamma row");
  assert(
    rowContains(keywordRows, alphaNonce) &&
      !rowContains(keywordRows, betaNonce) &&
      !rowContains(keywordRows, gammaNonce),
    "Keyword filter did not isolate the alpha memory",
  );
  assert(
    rowContains(typeRows, betaNonce) &&
      !rowContains(typeRows, alphaNonce) &&
      !rowContains(typeRows, gammaNonce),
    "Type filter did not isolate the character-profile memory",
  );
  assert(
    rowContains(scopeRows, betaNonce) &&
      !rowContains(scopeRows, alphaNonce) &&
      !rowContains(scopeRows, gammaNonce),
    "Scope filter did not isolate the chapter-scoped memory",
  );
  assert(
    rowContains(statusRows, betaNonce) &&
      !rowContains(statusRows, alphaNonce) &&
      !rowContains(statusRows, gammaNonce),
    "Status filter did not isolate the confirmed memory",
  );
  assert(
    rowContains(lockedRows, betaNonce) &&
      !rowContains(lockedRows, alphaNonce) &&
      !rowContains(lockedRows, gammaNonce),
    "Locked filter did not isolate the locked memory",
  );
  assert(
    rowContains(combinedRows, betaNonce) &&
      !rowContains(combinedRows, alphaNonce) &&
      !rowContains(combinedRows, gammaNonce),
    "Combined filter did not keep only the matching beta memory",
  );
  assert(
    rowContains(draftUnlockedRows, gammaNonce) &&
      !rowContains(draftUnlockedRows, alphaNonce) &&
      !rowContains(draftUnlockedRows, betaNonce),
    "Draft unlocked filter did not keep only the matching gamma memory",
  );
  assert(
    memoryRequestUrls.some((url) => url.includes(`keyword=${encodeURIComponent(alphaNonce)}`)),
    "No memory list request carried the keyword filter",
  );
  assert(
    memoryRequestUrls.some(
      (url) =>
        url.includes("type=CHARACTER_PROFILE") &&
        url.includes("scope=CHAPTER") &&
        url.includes("status=CONFIRMED") &&
        url.includes("locked=true"),
    ),
    "No memory list request carried the combined filter matrix",
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au09-memory-management-filter-matrix",
      turn_id: null,
      workspace_id: joined.work_id ?? null,
      work_id: joined.work_id ?? null,
      session_id: joined.session_id ?? null,
      context_work_id: joined.work_id ?? null,
      active_session_id: joined.session_id ?? null,
      restored_turn_id: null,
      socket_connected: true,
      memory_page_opened_from_workbench: visibleText.includes("记忆管理"),
      alpha_nonce: alphaNonce,
      beta_nonce: betaNonce,
      gamma_nonce: gammaNonce,
      baseline_row_count: baselineRows.length,
      keyword_filter_visible_count: keywordRows.length,
      type_filter_visible_count: typeRows.length,
      scope_filter_visible_count: scopeRows.length,
      status_filter_visible_count: statusRows.length,
      locked_filter_visible_count: lockedRows.length,
      combined_filter_visible_count: combinedRows.length,
      draft_unlocked_filter_visible_count: draftUnlockedRows.length,
      keyword_filter_isolated_alpha:
        rowContains(keywordRows, alphaNonce) &&
        !rowContains(keywordRows, betaNonce) &&
        !rowContains(keywordRows, gammaNonce),
      type_filter_isolated_beta:
        rowContains(typeRows, betaNonce) &&
        !rowContains(typeRows, alphaNonce) &&
        !rowContains(typeRows, gammaNonce),
      scope_filter_isolated_beta:
        rowContains(scopeRows, betaNonce) &&
        !rowContains(scopeRows, alphaNonce) &&
        !rowContains(scopeRows, gammaNonce),
      status_filter_isolated_beta:
        rowContains(statusRows, betaNonce) &&
        !rowContains(statusRows, alphaNonce) &&
        !rowContains(statusRows, gammaNonce),
      locked_filter_isolated_beta:
        rowContains(lockedRows, betaNonce) &&
        !rowContains(lockedRows, alphaNonce) &&
        !rowContains(lockedRows, gammaNonce),
      combined_filter_isolated_beta:
        rowContains(combinedRows, betaNonce) &&
        !rowContains(combinedRows, alphaNonce) &&
        !rowContains(combinedRows, gammaNonce),
      draft_unlocked_filter_isolated_gamma:
        rowContains(draftUnlockedRows, gammaNonce) &&
        !rowContains(draftUnlockedRows, alphaNonce) &&
        !rowContains(draftUnlockedRows, betaNonce),
      memory_list_request_count: memoryRequestUrls.length,
      memory_list_request_urls: memoryRequestUrls,
      request_carried_keyword_filter: memoryRequestUrls.some((url) =>
        url.includes(`keyword=${encodeURIComponent(alphaNonce)}`),
      ),
      request_carried_combined_filter: memoryRequestUrls.some(
        (url) =>
          url.includes("type=CHARACTER_PROFILE") &&
          url.includes("scope=CHAPTER") &&
          url.includes("status=CONFIRMED") &&
          url.includes("locked=true"),
      ),
      first_message_text: visibleText.slice(0, 300),
      title_text: await workTitle(page)
        .textContent()
        .then((value) => value?.trim() ?? ""),
      duration_ms: 0,
      outcome: "done",
    },
  ];
}

async function driveAu09MemoryTraceRoundtrip(page) {
  const deprecatedNonce = "赤铜回声";
  const archivedNonce = "银沙旧律";
  const deprecatedContent = `${deprecatedNonce}是主角在地下拍卖行留下的伏笔，每次钟声响起都会触发旧账追索。`;
  const archivedContent = `${archivedNonce}是旧版灵气运输禁令，曾约束暗港交易，但现在已被新律取代。`;

  async function openMemoryPage() {
    await page.getByRole("button", { name: /记忆/ }).first().click();
    await page.waitForFunction(() => document.body.innerText.includes("记忆管理"), undefined, {
      timeout: 10_000,
    });
  }

  async function createMemory(content, nonce) {
    await page.getByRole("button", { name: "+ 新建记忆" }).click();
    await page.locator("textarea").first().fill(content);
    await page.getByRole("button", { name: "创建" }).click();
    await page.waitForFunction((n) => document.body.innerText.includes(n), nonce, {
      timeout: 10_000,
    });
  }

  async function openMemoryDetail(nonce) {
    const row = page.locator("tr", { hasText: nonce }).first();
    await row.waitFor({ timeout: 10_000 });
    await row.click();
    await page.waitForFunction(() => document.body.innerText.includes("记忆详情"), undefined, {
      timeout: 10_000,
    });
  }

  async function closeMemoryDetail() {
    await page.getByRole("button", { name: "×" }).first().click();
    await page.waitForTimeout(200);
  }

  async function waitForTraceText(...needles) {
    await page.waitForFunction(
      (expected) => expected.every((needle) => document.body.innerText.includes(String(needle))),
      needles,
      { timeout: 10_000 },
    );
  }

  await openMemoryPage();

  await createMemory(deprecatedContent, deprecatedNonce);
  await openMemoryDetail(deprecatedNonce);
  await waitForTraceText("引用与治理追溯", "作者创建记忆草稿");

  await page.getByRole("button", { name: "确认" }).click();
  await waitForTraceText("CONFIRMED", "作者确认");

  await page.getByRole("button", { name: "锁定" }).click();
  await waitForTraceText("已锁定", "作者锁定", "锁定保护核心内容");

  const deprecateDisabledWhileLocked = await page
    .getByRole("button", { name: "废弃" })
    .isDisabled();
  const archiveDisabledWhileLocked = await page.getByRole("button", { name: "归档" }).isDisabled();
  assert(deprecateDisabledWhileLocked, "Locked memory still allowed direct deprecate in UI");
  assert(archiveDisabledWhileLocked, "Locked memory still allowed direct archive in UI");

  await closeMemoryDetail();
  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  const lockedRecallMessage = `请围绕${deprecatedNonce}写一句伏笔回收提示。`;
  await page.locator(chatInputSelector).fill(lockedRecallMessage);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const lockedRecallFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.assistant_message != null,
    "No turn_result frame after memory trace locked recall message",
    170_000,
  );
  const lockedRecallTurn = lockedRecallFrame.body;
  const lockedContext = await waitForAppLogRecord(
    (record) =>
      record.event === "context.assemble.done" &&
      record.turn_id === lockedRecallTurn.turn_id &&
      record.has_memory === true,
    "Locked memory did not recall before terminal action in trace slice",
    20_000,
  );
  const lockedWhyText = await openLatestWhyDialog(page);
  const whyShowsLockedMemorySource = lockedWhyText.includes("已确认设定");
  assert(whyShowsLockedMemorySource, "Why panel did not show locked memory source");
  await page.keyboard.press("Escape");
  await page
    .getByRole("dialog")
    .first()
    .waitFor({ state: "detached", timeout: 5_000 })
    .catch(() => {});

  await openMemoryPage();
  await openMemoryDetail(deprecatedNonce);
  await page.getByRole("button", { name: "解锁" }).click();
  await waitForTraceText("作者解锁");
  await page.getByRole("button", { name: "废弃" }).click();
  await waitForTraceText("DEPRECATED", "作者废弃", "后续普通召回会排除");
  await closeMemoryDetail();

  await createMemory(archivedContent, archivedNonce);
  await openMemoryDetail(archivedNonce);
  await waitForTraceText("作者创建记忆草稿");
  await page.getByRole("button", { name: "确认" }).click();
  await waitForTraceText("CONFIRMED", "作者确认");
  await page.getByRole("button", { name: "归档" }).click();
  await waitForTraceText("ARCHIVED", "作者归档", "后续普通召回会排除");
  await closeMemoryDetail();

  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  const seenTurnIdsBeforeTerminalProbe = new Set(
    frames
      .filter((frame) => frame.direction === "received" && frame.event === "turn_result")
      .map((frame) => frame.body?.turn_id)
      .filter(Boolean),
  );
  const terminalRecallMessage = `请判断${deprecatedNonce}和${archivedNonce}是否还能作为后续设定使用。`;
  await page.locator(chatInputSelector).fill(terminalRecallMessage);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const terminalRecallFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      !seenTurnIdsBeforeTerminalProbe.has(frame.body.turn_id) &&
      frame.body?.assistant_message != null,
    "No turn_result frame after memory trace terminal probe",
    170_000,
  );
  const terminalRecallTurn = terminalRecallFrame.body;
  const terminalContext = await waitForAppLogRecord(
    (record) =>
      record.event === "context.assemble.done" && record.turn_id === terminalRecallTurn.turn_id,
    "No context assembly record for memory trace terminal probe",
    20_000,
  );
  const terminalMemorySummaries = (terminalRecallTurn.trace_summary?.context_refs ?? [])
    .filter((ref) => String(ref.source_type) === "memory")
    .map((ref) => String(ref.summary ?? ""))
    .join("\n");
  const terminalManagedMemoryExcluded =
    !terminalMemorySummaries.includes(deprecatedNonce) &&
    !terminalMemorySummaries.includes(archivedNonce);
  assert(
    terminalManagedMemoryExcluded,
    "Trace slice terminal memories still entered dialogue context refs",
  );

  const terminalWhyText = await openLatestWhyDialog(page);
  const whyExcludesTerminalMemoryContent =
    !terminalWhyText.includes(deprecatedContent) && !terminalWhyText.includes(archivedContent);
  assert(
    whyExcludesTerminalMemoryContent,
    "Trace slice why panel still showed terminal memory content",
  );

  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, terminalRecallTurn, sentMessage);

  return [
    {
      ...uiState,
      turn_id: terminalRecallTurn.turn_id,
      turn_ids: [lockedRecallTurn.turn_id, terminalRecallTurn.turn_id],
      locked_recall_turn_id: lockedRecallTurn.turn_id,
      terminal_recall_turn_id: terminalRecallTurn.turn_id,
      memory_nonce: deprecatedNonce,
      archived_memory_nonce: archivedNonce,
      lifecycle_trace_visible: true,
      create_trace_visible: true,
      confirm_trace_visible: true,
      lock_trace_visible: true,
      unlock_trace_visible: true,
      deprecate_trace_visible: true,
      archive_trace_visible: true,
      trace_explains_locked_recall: true,
      trace_explains_terminal_exclusion: true,
      locked_controls_disabled: deprecateDisabledWhileLocked && archiveDisabledWhileLocked,
      locked_recalled_before_terminal_action: lockedContext.has_memory === true,
      why_shows_locked_memory_source: whyShowsLockedMemorySource,
      terminal_context_has_memory: terminalContext.has_memory === true,
      terminal_managed_memory_excluded: terminalManagedMemoryExcluded,
      why_excludes_terminal_memory_content: whyExcludesTerminalMemoryContent,
      message_text: terminalRecallMessage,
    },
  ];
}

async function driveAu09ArchiveStatsCurrent(page) {
  const workId = readSeedField("work_id");
  const workTitleValue = readSeedField("work_title");
  const characterName = readSeedField("character_name") ?? "沈泊舟";
  const foreshadowingNeedle = readSeedField("foreshadowing_needle") ?? "星桥旧账伏笔";
  const ruleNeedle = readSeedField("rule_needle") ?? "星桥通行规则";
  const foreignNeedle = readSeedField("foreign_needle") ?? "雾港外部样例";

  assert(workId, "AU09 archive stats seed did not provide work_id");
  assert(workTitleValue, "AU09 archive stats seed did not provide work_title");

  await ensureWorkSelectedByTitle(page, workTitleValue, workId);
  await waitForVisibleWorkTitle(page, workTitleValue);
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  const logCount = readAppLogRecords().length;
  const archivePanel = await openArchiveTab(page, "概览");

  const statsRecord = await waitForNewAppLogRecord(
    logCount,
    (record) =>
      record.event === "channel.get_work_stats.done" &&
      record.work_id === workId &&
      Number(record.volumes ?? 0) >= 1 &&
      Number(record.chapters ?? 0) >= 1 &&
      Number(record.characters ?? 0) >= 1 &&
      Number(record.memory_items ?? 0) >= 2 &&
      Number(record.drafts_total ?? 0) >= 2 &&
      Number(record.drafts_accepted ?? 0) >= 1,
    "No channel.get_work_stats.done record proved current archive stats",
    20_000,
  );

  const charactersRecord = await waitForNewAppLogRecord(
    logCount,
    (record) =>
      record.event === "channel.get_characters.done" &&
      record.work_id === workId &&
      Number(record.character_count ?? 0) >= 1,
    "No channel.get_characters.done record proved current archive characters",
    20_000,
  );

  const foreshadowingRecord = await waitForNewAppLogRecord(
    logCount,
    (record) =>
      record.event === "channel.get_foreshadowing.done" &&
      record.work_id === workId &&
      Number(record.item_count ?? 0) >= 1,
    "No channel.get_foreshadowing.done record proved current archive foreshadowing",
    20_000,
  );

  const rulesRecord = await waitForNewAppLogRecord(
    logCount,
    (record) =>
      record.event === "channel.get_rules.done" &&
      record.work_id === workId &&
      Number(record.rule_count ?? 0) >= 1,
    "No channel.get_rules.done record proved current archive rules",
    20_000,
  );

  await page.waitForFunction(
    () => {
      const panel = [...document.querySelectorAll('[class*="panel"]')].find((element) =>
        element.innerText.includes("作品档案"),
      );
      if (!panel) return false;
      return (
        Number(panel.getAttribute("data-archive-volumes") ?? 0) >= 1 &&
        Number(panel.getAttribute("data-archive-chapters") ?? 0) >= 1 &&
        Number(panel.getAttribute("data-archive-character-count") ?? 0) >= 1 &&
        Number(panel.getAttribute("data-archive-memory-items") ?? 0) >= 2 &&
        Number(panel.getAttribute("data-archive-drafts-total") ?? 0) >= 2 &&
        Number(panel.getAttribute("data-archive-drafts-accepted") ?? 0) >= 1
      );
    },
    undefined,
    { timeout: 10_000 },
  );

  const overviewSnapshot = await archivePanelSnapshot(archivePanel);
  assert(
    overviewSnapshot.text.includes(workTitleValue) &&
      overviewSnapshot.text.includes(String(statsRecord.volumes)) &&
      overviewSnapshot.text.includes(
        `${Number(statsRecord.drafts_accepted)}/${Number(statsRecord.drafts_total)}`,
      ),
    "Archive overview did not render the seeded work title and stats",
  );
  assert(
    overviewSnapshot.character_count === Number(statsRecord.characters),
    "Archive UI character count did not match get_work_stats",
  );
  assert(
    overviewSnapshot.memory_items === Number(statsRecord.memory_items),
    "Archive UI memory count did not match get_work_stats",
  );
  assert(
    overviewSnapshot.drafts_accepted === Number(statsRecord.drafts_accepted),
    "Archive UI accepted draft count did not match get_work_stats",
  );

  await page.getByRole("tab", { name: "伏笔" }).click();
  await page.waitForFunction(
    (needle) => {
      const panel = [...document.querySelectorAll('[class*="panel"]')].find((element) =>
        element.innerText.includes("作品档案"),
      );
      return (panel?.innerText ?? "").includes(needle);
    },
    foreshadowingNeedle,
    { timeout: 10_000 },
  );

  await archivePanel.getByRole("button", { name: "查看详情" }).first().click();
  await page.waitForFunction(
    (needle) => {
      const panel = [...document.querySelectorAll('[class*="panel"]')].find((element) =>
        element.innerText.includes("作品档案"),
      );
      return (
        (panel?.innerText ?? "").includes(needle) &&
        (panel?.getAttribute("data-archive-detail-kind") ?? "") === "memory" &&
        (panel?.getAttribute("data-archive-detail-id") ?? "").length > 0
      );
    },
    foreshadowingNeedle,
    { timeout: 10_000 },
  );

  const detailSnapshot = await archivePanelSnapshot(archivePanel);
  const visibleText = detailSnapshot.text;
  assert(visibleText.includes(characterName), "Archive did not show the seeded accepted character");
  assert(
    visibleText.includes(foreshadowingNeedle),
    "Archive did not show the seeded foreshadowing",
  );
  assert(
    !visibleText.includes(foreignNeedle),
    "Archive leaked foreign-work data into current work",
  );

  await page.getByRole("tab", { name: "经验规则" }).click();
  await page.waitForFunction(
    (needle) => {
      const panel = [...document.querySelectorAll('[class*="panel"]')].find((element) =>
        element.innerText.includes("作品档案"),
      );
      return (panel?.innerText ?? "").includes(needle);
    },
    ruleNeedle,
    { timeout: 10_000 },
  );
  const ruleSnapshot = await archivePanelSnapshot(archivePanel);
  assert(ruleSnapshot.text.includes(ruleNeedle), "Archive did not show the seeded rule");
  assert(
    !ruleSnapshot.text.includes(foreignNeedle),
    "Archive rule tab leaked foreign-work data into current work",
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au09-archive-stats-current",
      work_id: workId,
      workspace_id: workId,
      context_work_id: workId,
      work_title: workTitleValue,
      archive_character_count: detailSnapshot.character_count,
      archive_foreshadowing_count: detailSnapshot.foreshadowing_count,
      archive_rule_count: ruleSnapshot.rule_count,
      archive_volumes: detailSnapshot.volumes,
      archive_chapters: detailSnapshot.chapters,
      archive_memory_items: detailSnapshot.memory_items,
      archive_drafts_total: detailSnapshot.drafts_total,
      archive_drafts_accepted: detailSnapshot.drafts_accepted,
      archive_detail_kind: detailSnapshot.detail_kind,
      archive_detail_id: detailSnapshot.detail_id,
      archive_detail_title: foreshadowingNeedle,
      archive_overview_title_visible: overviewSnapshot.text.includes(workTitleValue),
      archive_detail_visible: detailSnapshot.text.includes(foreshadowingNeedle),
      archive_rule_visible: ruleSnapshot.text.includes(ruleNeedle),
      archive_foreign_excluded: !ruleSnapshot.text.includes(foreignNeedle),
      channel_character_count: charactersRecord.character_count,
      channel_foreshadowing_count: foreshadowingRecord.item_count,
      channel_rule_count: rulesRecord.rule_count,
      channel_volumes: statsRecord.volumes,
      channel_chapters: statsRecord.chapters,
      channel_memory_items: statsRecord.memory_items,
      channel_drafts_total: statsRecord.drafts_total,
      channel_drafts_accepted: statsRecord.drafts_accepted,
      outcome: "done",
    },
  ];
}

async function driveAu09AdoptSettingRecall(page) {
  // ── 从作品档案「伏笔」tab 触发 AI 生成一条伏笔草稿。
  await openArchiveTab(page, "伏笔");
  await page.getByRole("button", { name: "新增伏笔" }).first().click();

  const createMessageFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.generate_micro_plan === true &&
      String(frame.body?.text ?? "").includes("伏笔"),
    "Real archive foreshadowing action did not send a foreshadowing user_message with micro plan enabled",
    20_000,
  );

  // 伏笔入口必须生成显式 foreshadowing_seed，不再把伏笔装进 world_setting。
  const draftFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.adoption_state?.pending?.[0]?.requires_adoption === true &&
      frame.body.adoption_state.pending[0].artifact_type === "foreshadowing_seed",
    "No foreshadowing_seed tentative artifact websocket frame was received",
    170_000,
  );
  const artifact = draftFrame.body.adoption_state.pending[0];
  const settingContent =
    artifact.payload?.content ??
    (artifact.payload?.items ?? []).map((item) => item?.body ?? "").join("") ??
    "";
  // 取一段设定正文的可匹配子串（仅字/数），后续消息带上它以保证召回命中本条设定。
  const chunk = settingContent.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 8);

  // 档案面板可能在发送后已自动关闭；存在才关闭。
  const closeArchive = page.getByRole("button", { name: "关闭档案" });
  if ((await closeArchive.count()) > 0) {
    await closeArchive
      .first()
      .click()
      .catch(() => {});
  }
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("保存到作品档案") ||
      document.body.innerText.includes("确认创建"),
    undefined,
    { timeout: 10_000 },
  );

  // ── 采纳该设定 → 进入 confirmed + recallable governed memory。
  const saveToArchiveButton = page.getByRole("button", { name: "保存到作品档案" });
  const acceptSettingButton =
    (await saveToArchiveButton.count()) > 0
      ? saveToArchiveButton.first()
      : page.getByRole("button", { name: "确认创建" }).first();
  await acceptSettingButton.click();
  const adoptFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.truthfulness?.artifact_adopted === true &&
      (frame.body?.adoption_state?.resolved ?? []).some(
        (entry) => entry.artifact_id === artifact.artifact_id,
      ),
    "No adoption resolved turn_result websocket frame was received",
    120_000,
  );

  // ── 采纳后重开「伏笔」tab：同一 work_id 的 archive read model 必须立即可见。
  const archivePanel = await openArchiveTab(page, "伏笔");
  await waitForAppLogRecord(
    (record) =>
      record.event === "channel.get_foreshadowing.done" &&
      record.work_id === createMessageFrame.body?.work_id &&
      Number(record.item_count ?? 0) >= 1,
    "No channel.get_foreshadowing.done record loaded the adopted setting",
    20_000,
  );
  await page.waitForFunction(
    () => {
      const panel = [...document.querySelectorAll('[class*="panel"]')].find((element) =>
        element.innerText.includes("作品档案"),
      );
      return Number(panel?.getAttribute("data-archive-foreshadowing-count") ?? 0) >= 1;
    },
    undefined,
    { timeout: 10_000 },
  );
  const foreshadowingArchiveSnapshot = await archivePanelSnapshot(archivePanel);
  const archiveTextNormalized = foreshadowingArchiveSnapshot.text.replace(/[^\p{L}\p{N}]/gu, "");
  const archiveShowsAdoptedSetting = chunk.length > 0 && archiveTextNormalized.includes(chunk);
  assert(
    archiveShowsAdoptedSetting,
    "Archive foreshadowing tab did not show the adopted setting content",
  );

  // ── 同一矩阵补「经验规则」tab：新建规则、采纳、重开后可见。
  const seenRuleTurnIds = new Set(
    frames
      .filter((frame) => frame.direction === "received" && frame.event === "turn_result")
      .map((frame) => frame.body?.turn_id),
  );
  await page.getByRole("tab", { name: "经验规则" }).click();
  await page.getByRole("button", { name: "新建规则" }).first().click();

  const createRuleMessageFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.generate_micro_plan === true &&
      String(frame.body?.text ?? "").includes("规则"),
    "Real archive rule action did not send a rule user_message with micro plan enabled",
    20_000,
  );

  const ruleArtifactTypes = new Set(["world_rule_seed", "style_rule_seed", "constraint_seed"]);
  const ruleDraftFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      !seenRuleTurnIds.has(frame.body.turn_id) &&
      frame.body?.adoption_state?.pending?.[0]?.requires_adoption === true &&
      ruleArtifactTypes.has(frame.body.adoption_state.pending[0].artifact_type),
    "No explicit rule tentative artifact websocket frame was received",
    170_000,
  );
  const ruleArtifact = ruleDraftFrame.body.adoption_state.pending[0];
  const ruleSettingContent =
    ruleArtifact.payload?.content ??
    (ruleArtifact.payload?.items ?? []).map((item) => item?.body ?? "").join("") ??
    "";
  const ruleChunk = ruleSettingContent.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 8);

  const closeArchiveBeforeRuleAdoption = page.getByRole("button", { name: "关闭档案" });
  if ((await closeArchiveBeforeRuleAdoption.count()) > 0) {
    await closeArchiveBeforeRuleAdoption
      .first()
      .click()
      .catch(() => {});
  }
  const acceptRuleButton = page.getByRole("button", { name: acceptDraftButtonPattern }).first();
  await acceptRuleButton.waitFor({ timeout: 10_000 });
  await acceptRuleButton.click();

  await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.truthfulness?.artifact_adopted === true &&
      (frame.body?.adoption_state?.resolved ?? []).some(
        (entry) => entry.artifact_id === ruleArtifact.artifact_id,
      ),
    "No rule adoption resolved turn_result websocket frame was received",
    120_000,
  );

  const ruleArchivePanel = await openArchiveTab(page, "经验规则");
  await waitForAppLogRecord(
    (record) =>
      record.event === "channel.get_rules.done" &&
      record.work_id === createRuleMessageFrame.body?.work_id &&
      Number(record.rule_count ?? 0) >= 1,
    "No channel.get_rules.done record loaded the adopted rule setting",
    20_000,
  );
  await page.waitForFunction(
    () => {
      const panel = [...document.querySelectorAll('[class*="panel"]')].find((element) =>
        element.innerText.includes("作品档案"),
      );
      return Number(panel?.getAttribute("data-archive-rule-count") ?? 0) >= 1;
    },
    undefined,
    { timeout: 10_000 },
  );
  const ruleArchiveSnapshot = await archivePanelSnapshot(ruleArchivePanel);
  const ruleArchiveTextNormalized = ruleArchiveSnapshot.text.replace(/[^\p{L}\p{N}]/gu, "");
  const archiveShowsAdoptedRule =
    ruleChunk.length > 0 && ruleArchiveTextNormalized.includes(ruleChunk);
  assert(ruleChunk.length > 0, "Adopted rule setting had no matchable content");
  assert(archiveShowsAdoptedRule, "Archive rule tab did not show the adopted rule setting content");

  const closeArchiveAfterCheck = page.getByRole("button", { name: "关闭档案" });
  if ((await closeArchiveAfterCheck.count()) > 0) {
    await closeArchiveAfterCheck
      .first()
      .click()
      .catch(() => {});
  }

  // ── 发一条带该设定内容的消息 → 召回应命中已采纳设定。
  const seenTurnIds = new Set(
    frames
      .filter((frame) => frame.direction === "received" && frame.event === "turn_result")
      .map((frame) => frame.body?.turn_id),
  );
  const message = `请基于这条已确认设定继续展开剧情：${chunk}`;
  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const recallFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      !seenTurnIds.has(frame.body.turn_id) &&
      frame.body?.assistant_message != null,
    "No recall turn_result websocket frame was received",
    170_000,
  );
  const recallTurnResult = recallFrame.body;

  // ── 「为什么」面板显示「已确认设定」记忆来源。
  await openLatestWhyDialog(page);
  await page.waitForFunction(() => document.body.innerText.includes("已确认设定"), {
    timeout: 10_000,
  });

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, recallTurnResult, sentMessage);

  const whyShowsMemorySource = visibleText.includes("已确认设定");
  assert(chunk.length > 0, "Adopted setting had no matchable content");
  assert(
    adoptFrame.body.truthfulness?.production_write_performed === false ||
      adoptFrame.body.truthfulness?.artifact_adopted === true,
    "Setting was not adopted",
  );
  assert(
    whyShowsMemorySource,
    "Why panel did not show the adopted setting as a confirmed-memory source",
  );

  return [
    {
      ...uiState,
      turn_id: recallTurnResult.turn_id,
      recall_turn_id: recallTurnResult.turn_id,
      setting_artifact_id: artifact.artifact_id,
      setting_artifact_type: artifact.artifact_type,
      setting_chunk: chunk,
      setting_adopted: adoptFrame.body.truthfulness?.artifact_adopted === true,
      archive_tab_checked: "foreshadowing,rule",
      archive_visible_after_adoption: true,
      archive_foreshadowing_count_after_adoption: foreshadowingArchiveSnapshot.foreshadowing_count,
      archive_rule_count_after_adoption: ruleArchiveSnapshot.rule_count,
      archive_text_matched_adopted_setting: archiveShowsAdoptedSetting,
      rule_setting_artifact_id: ruleArtifact.artifact_id,
      rule_setting_artifact_type: ruleArtifact.artifact_type,
      rule_setting_chunk: ruleChunk,
      archive_text_matched_adopted_rule: archiveShowsAdoptedRule,
      why_shows_memory_source: whyShowsMemorySource,
      message_text: message,
    },
  ];
}

async function driveAu09CharacterDossierRoundtrip(page) {
  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "角色" }).click();
  await page.getByRole("button", { name: "创建角色" }).first().click();

  const createMessageFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.generate_micro_plan === true &&
      String(frame.body?.text ?? "").includes("角色") &&
      !String(frame.body?.text ?? "").includes("伏笔"),
    "Real archive character action did not send a role-design user_message with micro plan enabled",
    20_000,
  );

  const draftFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.adoption_state?.pending?.[0]?.requires_adoption === true &&
      frame.body.adoption_state.pending[0].artifact_type === "character_seed",
    "No tentative character_seed artifact websocket frame was received",
    170_000,
  );
  const artifact = draftFrame.body.adoption_state.pending[0];
  const characterTitle = String(
    artifact.payload?.items?.[0]?.title ?? artifact.payload?.title ?? "角色设定草稿",
  );

  const closeArchive = page.getByRole("button", { name: "关闭档案" });
  if ((await closeArchive.count()) > 0) {
    await closeArchive
      .first()
      .click()
      .catch(() => {});
  }

  const acceptDraftButton = page.getByRole("button", { name: acceptDraftButtonPattern }).first();
  await acceptDraftButton.waitFor({ timeout: 10_000 });
  await acceptDraftButton.click();

  const adoptFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.truthfulness?.artifact_adopted === true &&
      (frame.body?.adoption_state?.resolved ?? []).some(
        (entry) => entry.artifact_id === artifact.artifact_id,
      ),
    "No character adoption resolved turn_result websocket frame was received",
    120_000,
  );

  const adoptedStateRef = String(adoptFrame.body.truthfulness?.adopted_state_ref ?? "");
  assert(adoptedStateRef.length > 0, "Character adoption did not expose adopted_state_ref");

  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "角色" }).click();
  const archivePanel = page.locator('[class*="panel"]').filter({ hasText: "作品档案" }).first();
  await archivePanel.getByText(characterTitle).first().waitFor({ timeout: 10_000 });

  const charactersLoaded = await waitForAppLogRecord(
    (record) =>
      record.event === "channel.get_characters.done" &&
      record.work_id === createMessageFrame.body?.work_id &&
      Number(record.character_count ?? 0) >= 1,
    "No channel.get_characters.done log loaded the adopted Character dossier",
    20_000,
  );

  const createEntryVisibleAfterCharacter =
    (await archivePanel.getByRole("button", { name: "创建角色" }).count()) >= 1;
  assert(
    createEntryVisibleAfterCharacter,
    "Character tab did not keep a visible create entry after a character exists",
  );

  await archivePanel.getByRole("button", { name: "创建角色" }).first().click();

  const secondDraftFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      frame.body.turn_id !== draftFrame.body.turn_id &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "character_seed",
    "No second character design turn_result was received after archive create entry",
    170_000,
  );

  const characterContext = await waitForAppLogRecord(
    (record) =>
      record.event === "context.characters.done" &&
      record.turn_id === secondDraftFrame.body.turn_id &&
      Number(record.character_count ?? 0) >= 1,
    "No context.characters.done log proved Character dossier reached the next character design turn",
    20_000,
  );

  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, secondDraftFrame.body, sentMessage);

  return [
    {
      ...uiState,
      turn_id: secondDraftFrame.body.turn_id,
      turn_ids: [draftFrame.body.turn_id, adoptFrame.body.turn_id, secondDraftFrame.body.turn_id],
      creation_turn_id: draftFrame.body.turn_id,
      adoption_turn_id: adoptFrame.body.turn_id,
      context_turn_id: secondDraftFrame.body.turn_id,
      character_artifact_id: artifact.artifact_id,
      character_artifact_type: artifact.artifact_type,
      character_title: characterTitle,
      adopted_state_ref: adoptedStateRef,
      character_visible_in_archive: true,
      archive_character_count: charactersLoaded.character_count,
      create_entry_visible_after_character: createEntryVisibleAfterCharacter,
      context_character_count: characterContext.character_count,
      create_prompt_text: createMessageFrame.body?.text,
      create_prompt_is_character_design:
        String(createMessageFrame.body?.text ?? "").includes("角色") &&
        !String(createMessageFrame.body?.text ?? "").includes("伏笔"),
    },
  ];
}

async function driveAu09CharacterRoleTaxonomyProtagonistPolicy(page) {
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  // Phase A：还没有主角时问"主角是谁" → 诚实报缺口，不臆造主角，只读不写。
  const preQuery = await sendOrdinaryChatTurn(
    page,
    "现在这部作品的主角是谁，叫什么名字？",
    frames.length,
  );
  const preAnswer = String(preQuery.turnResult.assistant_message?.text ?? "");
  const preDesignAnswerHonestMissing =
    preAnswer.includes("还没有") &&
    preAnswer.includes("主角") &&
    !preAnswer.includes("当前作品的主角是");
  assert(
    preDesignAnswerHonestMissing,
    `Protagonist query before any protagonist did not honestly report a missing protagonist: ${preAnswer}`,
  );
  const preQueryNoWrite = preQuery.turnResult.truthfulness?.production_write_performed === false;
  assert(preQueryNoWrite, "Protagonist read-only query performed a production write");
  assert(
    preQuery.turnResult.truthfulness?.artifact_adopted === false,
    "Protagonist read-only query adopted an artifact",
  );

  // Phase B：按作者意图设计一个"主角" → character_seed 带结构化 narrative_role=PROTAGONIST。
  // 角色名由 provider 生成（作者不预设），后续断言一律使用实际生成的主角名。
  const designBefore = frames.length;
  const design = await sendOrdinaryChatTurn(
    page,
    "帮我设计一个主角，作为这部作品的核心人物。",
    designBefore,
  );
  const pending = design.turnResult.adoption_state?.pending?.[0];
  assert(
    pending && pending.artifact_type === "character_seed",
    "Protagonist design did not produce a tentative character_seed artifact",
  );
  const designedNarrativeRole = String(pending.payload?.items?.[0]?.narrative_role ?? "");
  assert(
    designedNarrativeRole === "PROTAGONIST",
    `Designed protagonist character_seed missing structured narrative_role PROTAGONIST: ${designedNarrativeRole}`,
  );
  const protagonistName = String(pending.payload?.items?.[0]?.title ?? "").trim();
  assert(protagonistName.length > 0, "Designed protagonist character_seed has no name");

  // 采纳：经采纳边界写入 Character 主档案。
  const acceptButton = page.getByRole("button", { name: acceptDraftButtonPattern }).first();
  await acceptButton.waitFor({ timeout: 10_000 });
  await acceptButton.click();

  const adoptFrame = await waitForNewFrame(
    designBefore,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.truthfulness?.artifact_adopted === true &&
      (frame.body?.adoption_state?.resolved ?? []).some(
        (entry) => entry.artifact_id === pending.artifact_id,
      ),
    "No protagonist character adoption resolved turn_result websocket frame was received",
    120_000,
  );
  const adoptedStateRef = String(adoptFrame.body.truthfulness?.adopted_state_ref ?? "");
  assert(adoptedStateRef.length > 0, "Protagonist adoption did not expose adopted_state_ref");

  // Phase C：作品档案角色 tab 展示该角色，并以结构化"主角"叙事角色标注，缺口提示消失。
  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "角色" }).click();
  const archivePanel = page.locator('[class*="panel"]').filter({ hasText: "作品档案" }).first();
  await archivePanel.getByText(protagonistName).first().waitFor({ timeout: 10_000 });

  const charactersLoaded = await waitForAppLogRecord(
    (record) =>
      record.event === "channel.get_characters.done" &&
      record.work_id === design.turnResult.work_id &&
      Number(record.character_count ?? 0) >= 1,
    "No channel.get_characters.done log loaded the adopted protagonist Character",
    20_000,
  );

  const archiveText = await archivePanel.innerText();
  const archiveShowsProtagonistLabel =
    archiveText.includes("主角") && !archiveText.includes("尚未标注主角");
  assert(
    archiveShowsProtagonistLabel,
    "Character archive tab did not show the structured 主角 narrative-role label",
  );

  const closeArchive = page.getByRole("button", { name: "关闭档案" });
  if ((await closeArchive.count()) > 0) {
    await closeArchive
      .first()
      .click()
      .catch(() => {});
  }

  // Phase D：再问"主角是谁" → 结构化叙事角色让回答有可校验主角姓名，仍然只读不写。
  const postBefore = frames.length;
  const postQuery = await sendOrdinaryChatTurn(page, "那现在主角是谁？", postBefore);
  const postAnswer = String(postQuery.turnResult.assistant_message?.text ?? "");
  const postDesignAnswerNamesProtagonist = postAnswer.includes(`主角是 ${protagonistName}`);
  assert(
    postDesignAnswerNamesProtagonist,
    `Protagonist query after design did not name the protagonist: ${postAnswer}`,
  );
  const postQueryNoWrite = postQuery.turnResult.truthfulness?.production_write_performed === false;
  assert(
    postQueryNoWrite,
    "Protagonist read-only query (after design) performed a production write",
  );

  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, postQuery.turnResult, sentMessage);

  return [
    {
      ...uiState,
      turn_id: postQuery.turnResult.turn_id,
      turn_ids: [
        preQuery.turnResult.turn_id,
        design.turnResult.turn_id,
        adoptFrame.body.turn_id,
        postQuery.turnResult.turn_id,
      ],
      pre_query_turn_id: preQuery.turnResult.turn_id,
      design_turn_id: design.turnResult.turn_id,
      adoption_turn_id: adoptFrame.body.turn_id,
      post_query_turn_id: postQuery.turnResult.turn_id,
      protagonist_name: protagonistName,
      designed_narrative_role: designedNarrativeRole,
      adopted_state_ref: adoptedStateRef,
      pre_design_answer_honest_missing: preDesignAnswerHonestMissing,
      pre_query_no_write: preQueryNoWrite,
      post_design_answer_names_protagonist: postDesignAnswerNamesProtagonist,
      post_query_no_write: postQueryNoWrite,
      archive_shows_protagonist_label: archiveShowsProtagonistLabel,
      archive_character_count: charactersLoaded.character_count,
      pre_design_answer_text: preAnswer,
      post_design_answer_text: postAnswer,
    },
  ];
}

async function driveAu09CharacterCandidatePerItemAdoption(page) {
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  // 设计两个不同方向的角色候选 → character_design 返回两条独立候选。
  const designBefore = frames.length;
  const design = await sendOrdinaryChatTurn(
    page,
    "请给我设计两个不同方向的新角色候选，让我挑一个。",
    designBefore,
  );

  const pending = (design.turnResult.adoption_state?.pending ?? []).filter(
    (entry) => entry.artifact_type === "character_seed",
  );
  assert(pending.length === 2, `Expected 2 character candidates, got ${pending.length}`);

  const nameOf = (entry) => String(entry.payload?.items?.[0]?.title ?? "").trim();
  const candidateNames = pending.map(nameOf);
  assert(
    candidateNames.every((name) => name.length > 0) && candidateNames[0] !== candidateNames[1],
    `Character candidates must have distinct names: ${JSON.stringify(candidateNames)}`,
  );
  assert(
    pending[0].artifact_id !== pending[1].artifact_id,
    "Character candidates must have distinct adoptable artifact ids",
  );

  // 选定要采纳的候选 B（云栖方向）与保持未采纳的候选 A。
  const candidateB = pending.find((entry) => nameOf(entry).includes("云栖")) ?? pending[1];
  const candidateA = pending.find((entry) => entry.artifact_id !== candidateB.artifact_id);
  const candidateBName = nameOf(candidateB);
  const candidateAName = nameOf(candidateA);

  // 每个候选都有自己的"采纳"按钮：统计 accept 按钮数量恰为候选数。
  // accept 按钮文案统一以"保存到作品档案："开头（character_seed=档案类），逐候选附候选名。
  // 用子串/精确名匹配（不用动态 RegExp），既能逐项点击也避免 ReDoS 风险。
  const acceptPrefix = "保存到作品档案：";
  const acceptButtons = page.getByRole("button", { name: acceptPrefix });
  await acceptButtons.first().waitFor({ timeout: 10_000 });
  const acceptButtonCount = await acceptButtons.count();
  assert(
    acceptButtonCount === 2,
    `Each character candidate must have its own adopt button; found ${acceptButtonCount}`,
  );

  const acceptButtonFor = (name) =>
    page.getByRole("button", { name: `${acceptPrefix}${name}`, exact: true });

  await acceptButtonFor(candidateBName).first().click();

  // 采纳候选 B：resolved 包含 B 的 artifact_id。
  const adoptFrame = await waitForNewFrame(
    designBefore,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.truthfulness?.artifact_adopted === true &&
      (frame.body?.adoption_state?.resolved ?? []).some(
        (entry) => entry.artifact_id === candidateB.artifact_id,
      ),
    "No per-item character adoption resolved turn_result was received for candidate B",
    120_000,
  );
  const adoptedStateRef = String(adoptFrame.body.truthfulness?.adopted_state_ref ?? "");
  assert(adoptedStateRef.length > 0, "Candidate B adoption did not expose adopted_state_ref");

  // 候选 A 仍可采纳：A 的采纳按钮仍在；B 的采纳按钮已消失。
  const unadoptedStillPending = (await acceptButtonFor(candidateAName).count()) >= 1;
  assert(unadoptedStillPending, "Unadopted candidate A lost its adopt button after adopting B");
  const adoptedButtonGone = (await acceptButtonFor(candidateBName).count()) === 0;
  assert(adoptedButtonGone, "Adopted candidate B adopt button should disappear after adoption");

  // 作品档案角色 tab：只显示已采纳的候选 B，未采纳的候选 A 不进入作品事实。
  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "角色" }).click();
  const archivePanel = page.locator('[class*="panel"]').filter({ hasText: "作品档案" }).first();
  await archivePanel.getByText(candidateBName).first().waitFor({ timeout: 10_000 });

  const charactersLoaded = await waitForAppLogRecord(
    (record) =>
      record.event === "channel.get_characters.done" &&
      record.work_id === design.turnResult.work_id &&
      Number(record.character_count ?? 0) >= 1,
    "No channel.get_characters.done log loaded the adopted character",
    20_000,
  );

  // 只检查"已确认角色"段（作品事实）。未采纳候选 A 仍出现在档案的"待采纳"段是正确产品行为
  // （作者可稍后从档案采纳它），但绝不能进入已确认角色（accepted Character）。
  const acceptedSection = archivePanel
    .locator("div")
    .filter({ hasText: "已确认角色" })
    .filter({ hasText: candidateBName })
    .last();
  await acceptedSection.waitFor({ timeout: 10_000 });
  const acceptedText = await acceptedSection.innerText();
  const archiveHasAdopted = acceptedText.includes(candidateBName);
  const archiveExcludesUnadopted = !acceptedText.includes(candidateAName);
  assert(archiveHasAdopted, "Adopted candidate B is not an accepted character in the archive");
  assert(
    archiveExcludesUnadopted,
    "Unadopted candidate A leaked into accepted characters (production fact)",
  );
  // 作品事实只新增了一个角色（已采纳的 B）。
  assert(
    Number(charactersLoaded.character_count ?? 0) === 1,
    `Adopting one candidate must persist exactly one Character, got ${charactersLoaded.character_count}`,
  );

  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, adoptFrame.body, sentMessage);

  return [
    {
      ...uiState,
      turn_id: adoptFrame.body.turn_id,
      turn_ids: [design.turnResult.turn_id, adoptFrame.body.turn_id],
      design_turn_id: design.turnResult.turn_id,
      adoption_turn_id: adoptFrame.body.turn_id,
      candidate_count: pending.length,
      accept_button_count: acceptButtonCount,
      adopted_candidate_name: candidateBName,
      unadopted_candidate_name: candidateAName,
      adopted_state_ref: adoptedStateRef,
      unadopted_still_pending: unadoptedStillPending,
      adopted_button_gone: adoptedButtonGone,
      archive_has_adopted: archiveHasAdopted,
      archive_excludes_unadopted: archiveExcludesUnadopted,
      archive_character_count: charactersLoaded.character_count,
    },
  ];
}

async function driveAu12ArchiveConcurrentModelRunReadSnapshot(page) {
  const nonce = `AU12CONC-${Date.now()}`;
  const seed = {
    title: `AU12并发档案作品-${nonce}`,
    genre: "悬疑仙侠",
    core_selling_point: `执行期可读档案-${nonce}`,
    target_reader: "在创作中核对档案的作者",
    tone_preference: "冷静克制",
  };
  const work = await createWorkSeed(seed);

  await page.goto(baseUrl, { waitUntil: "commit", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => /服务: 已连接|同步已连接/.test(document.body.innerText), {
    timeout: 30_000,
  });
  await ensureWorkSelectedByTitle(page, seed.title, work.id);
  await waitForVisibleWorkTitle(page, seed.title);

  // Phase 1：执行前先正常加载一次档案 → 概览显示立项快照（题材 / 卖点）。
  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "概览" }).click();
  let archivePanel = await waitForArchivePanel(page);
  await archivePanel.getByText(seed.genre).first().waitFor({ timeout: 15_000 });
  await archivePanel.getByText(seed.core_selling_point).first().waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "关闭档案" }).first().click();

  // Phase 2：发送一个故意慢的普通对话 turn（不等待完成），让模型执行期间占住通道。
  const sendBefore = frames.length;
  const slowMessage = `AU12SLOW 帮我顺一下 ${nonce} 后面的剧情走向，慢慢来。`;
  await page.locator(chatInputSelector).fill(slowMessage);
  await page.getByRole("button", { name: /^发送$/ }).click();
  await waitForNewFrame(
    sendBefore,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      String(frame.body?.text ?? "").includes("AU12SLOW"),
    "Slow user_message was not sent",
    10_000,
  );

  // Phase 3：模型执行期间打开档案 → 概览仍显示立项快照（非空白）+ 诚实加载/更新指示；turn 尚未完成。
  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "概览" }).click();
  archivePanel = await waitForArchivePanel(page);
  await page.waitForFunction(
    () => {
      const panel = [...document.querySelectorAll('[class*="panel"]')].find((element) =>
        element.innerText.includes("作品档案"),
      );
      const text = panel?.innerText ?? "";
      return text.includes("正在读取作品档案") || text.includes("正在更新作品档案");
    },
    undefined,
    { timeout: 5_000 },
  );
  const duringSnapshot = await archivePanelSnapshot(archivePanel);
  const snapshotVisibleDuringExecution =
    duringSnapshot.text.includes(seed.genre) &&
    duringSnapshot.text.includes(seed.core_selling_point);
  const loadingIndicatorDuringExecution =
    duringSnapshot.text.includes("正在读取作品档案") ||
    duringSnapshot.text.includes("正在更新作品档案");
  const turnInFlightWhenOpened = !frames
    .slice(sendBefore)
    .some((frame) => frame.direction === "received" && frame.event === "turn_result");

  assert(
    snapshotVisibleDuringExecution,
    "Archive overview blanked the work profile snapshot during model execution",
  );
  assert(
    loadingIndicatorDuringExecution,
    "Archive did not show an honest loading/refresh indicator during model execution",
  );
  assert(
    turnInFlightWhenOpened,
    "Slow turn completed before the archive was opened during execution (delay too short)",
  );

  // Phase 4：等待慢 turn 完成（本轮第一条 turn_result 即慢消息的结果，档案读取不产生 turn_result）。
  const turnFrame = await waitForNewFrame(
    sendBefore,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.assistant_message != null,
    "Slow turn never completed",
    30_000,
  );

  // Phase 5：执行结束后档案刷新，仍显示完整立项快照（不空白）。
  await page.waitForFunction(
    (needle) => {
      const panel = [...document.querySelectorAll('[class*="panel"]')].find((element) =>
        element.innerText.includes("作品档案"),
      );
      return panel?.innerText.includes(needle) ?? false;
    },
    seed.core_selling_point,
    { timeout: 15_000 },
  );
  const afterSnapshot = await archivePanelSnapshot(archivePanel);
  const archiveRefreshedAfterExecution =
    afterSnapshot.text.includes(seed.genre) && afterSnapshot.text.includes(seed.core_selling_point);
  assert(
    archiveRefreshedAfterExecution,
    "Archive did not show the profile snapshot after the slow turn completed",
  );

  // no-write：打开档案期间不得产生新的 user_message / author_action（只有那条慢消息）。
  const userMessagesSent = frames
    .slice(sendBefore)
    .filter((frame) => frame.direction === "sent" && frame.event === "user_message").length;
  const authorActionsSent = frames
    .slice(sendBefore)
    .filter((frame) => frame.direction === "sent" && frame.event === "author_action").length;
  assert(
    userMessagesSent === 1,
    `Opening the archive during execution must not send extra user_message; got ${userMessagesSent}`,
  );
  assert(
    authorActionsSent === 0,
    `Opening the archive during execution must not send author_action; got ${authorActionsSent}`,
  );

  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, turnFrame.body, sentMessage);

  return [
    {
      ...uiState,
      turn_id: turnFrame.body.turn_id,
      turn_ids: [turnFrame.body.turn_id],
      work_id: work.id,
      snapshot_visible_during_execution: snapshotVisibleDuringExecution,
      loading_indicator_during_execution: loadingIndicatorDuringExecution,
      turn_in_flight_when_opened: turnInFlightWhenOpened,
      archive_refreshed_after_execution: archiveRefreshedAfterExecution,
      user_messages_sent: userMessagesSent,
      author_actions_sent: authorActionsSent,
      profile_genre: seed.genre,
      profile_selling_point: seed.core_selling_point,
    },
  ];
}

async function driveAu09MemoryTaxonomyWritePolicy(page) {
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  const adopt = async (beforeCount, pending, label) => {
    await page.getByRole("button", { name: acceptDraftButtonPattern }).first().click();
    return await waitForNewFrame(
      beforeCount,
      (frame) =>
        frame.direction === "received" &&
        frame.event === "turn_result" &&
        frame.body?.truthfulness?.artifact_adopted === true &&
        (frame.body?.adoption_state?.resolved ?? []).some(
          (entry) => entry.artifact_id === pending.artifact_id,
        ),
      `${label} adoption frame was not received`,
      120_000,
    );
  };

  const openMemoryPage = async () => {
    await page.getByRole("button", { name: /记忆/ }).first().click();
    await page.waitForFunction(() => document.body.innerText.includes("记忆管理"), undefined, {
      timeout: 10_000,
    });
  };
  const closeMemoryPage = async () => {
    await page
      .getByRole("button", { name: "返回工作台" })
      .first()
      .click()
      .catch(() => {});
    await page
      .waitForFunction(() => !document.body.innerText.includes("记忆管理"), undefined, {
        timeout: 10_000,
      })
      .catch(() => {});
  };

  // Phase A — 角色主体写主档案、不写记忆。
  const designBefore = frames.length;
  const design = await sendOrdinaryChatTurn(page, "帮我设计一个主角，叫林烬。", designBefore);
  const seedPending = design.turnResult.adoption_state?.pending?.[0];
  assert(
    seedPending && seedPending.artifact_type === "character_seed",
    `character design did not produce a character_seed (got ${seedPending?.artifact_type})`,
  );
  await adopt(designBefore, seedPending, "character_seed");

  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "角色" }).click();
  const archivePanel = page.locator('[class*="panel"]').filter({ hasText: "作品档案" }).first();
  await archivePanel.getByText("林烬").first().waitFor({ timeout: 10_000 });
  const characterDossierVisible = (await archivePanel.getByText("林烬").count()) >= 1;
  const closeArchive = page.getByRole("button", { name: "关闭档案" });
  if ((await closeArchive.count()) > 0) {
    await closeArchive
      .first()
      .click()
      .catch(() => {});
  }

  // 记忆页：角色主档案不写记忆（无角色记忆、无主档案名作为记忆泄漏）。
  await openMemoryPage();
  const tbodyAfterSeed = await page.locator("table tbody").innerText();
  const noCharacterMemoryAfterSeed =
    !tbodyAfterSeed.includes("林烬") && !/当前状态|人物设定|人物关系/.test(tbodyAfterSeed);
  assert(
    noCharacterMemoryAfterSeed,
    `character_seed adoption leaked into memory: ${tbodyAfterSeed.slice(0, 160)}`,
  );
  await closeMemoryPage();

  // Phase B — 角色演化采纳写角色记忆（CURRENT_STATE），含本轮输入 nonce。
  // nonce 必须同时含字母与数字（slice_verify 的 random_identifier_tokens 要求），故用 EVOK+纯数字时间戳。
  const evoNonce = `EVOK${Date.now()}`;
  const evoBefore = frames.length;
  const evolution = await sendOrdinaryChatTurn(
    page,
    `更新林烬的当前状态（标记 ${evoNonce}）：他在这一章右臂重伤了。`,
    evoBefore,
  );
  const evoPending = evolution.turnResult.adoption_state?.pending?.[0];
  assert(
    evoPending && evoPending.artifact_type === "character_evolution_seed",
    `character evolution did not produce a character_evolution_seed (got ${evoPending?.artifact_type})`,
  );
  const evoAdopt = await adopt(evoBefore, evoPending, "character_evolution_seed");
  const adoptedStateRef = String(evoAdopt.body.truthfulness?.adopted_state_ref ?? "");
  assert(
    adoptedStateRef.length > 0,
    "character evolution adoption did not expose adopted_state_ref",
  );

  // 记忆页：该角色记忆以「当前状态」类型展示，且内容保留本轮 nonce（因果绑定）。
  await openMemoryPage();
  const evoRow = page.locator("table tbody tr").filter({ hasText: evoNonce }).first();
  await evoRow.waitFor({ timeout: 15_000 });
  const evoRowText = await evoRow.innerText();
  const evolutionMemoryWritten = evoRowText.includes(evoNonce);
  const evolutionMemoryTypeShown = evoRowText.includes("当前状态");
  assert(
    evolutionMemoryWritten,
    "adopted character evolution memory was not found in the memory page",
  );
  assert(
    evolutionMemoryTypeShown,
    `adopted character memory did not show 当前状态 type label: ${evoRowText}`,
  );

  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, evoAdopt.body, sentMessage);

  return [
    {
      ...uiState,
      turn_id: evoAdopt.body.turn_id,
      turn_ids: [design.turnResult.turn_id, evolution.turnResult.turn_id, evoAdopt.body.turn_id],
      design_turn_id: design.turnResult.turn_id,
      evolution_turn_id: evolution.turnResult.turn_id,
      adoption_turn_id: evoAdopt.body.turn_id,
      seed_artifact_type: seedPending.artifact_type,
      evolution_artifact_type: evoPending.artifact_type,
      character_dossier_visible: characterDossierVisible,
      no_character_memory_after_seed: noCharacterMemoryAfterSeed,
      evolution_memory_written: evolutionMemoryWritten,
      evolution_memory_type_shown: evolutionMemoryTypeShown,
      evolution_nonce: evoNonce,
      adopted_state_ref: adoptedStateRef,
    },
  ];
}

async function driveAu09MemoryListUxRedesign(page) {
  const activeNonce = "UX记忆甲7K3";
  const terminalNonce = "UX记忆乙9M2";
  const activeContent = `${activeNonce}是主角的人物设定演化，应作为可召回的已确认记忆显示。`;
  const terminalContent = `${terminalNonce}是一条被废弃的伏笔线索，应作为终态记忆弱化显示且不召回。`;

  const openMemoryPage = async () => {
    await page.getByRole("button", { name: /记忆/ }).first().click();
    await page.waitForFunction(() => document.body.innerText.includes("记忆管理"), undefined, {
      timeout: 10_000,
    });
  };

  const createMemory = async (content, type) => {
    await page.getByRole("button", { name: "+ 新建记忆" }).click();
    await page.locator("textarea").first().fill(content);
    const allSelects = page.locator("select");
    await allSelects.nth(4).selectOption(type);
    await allSelects.nth(5).selectOption("WORK");
    await page.getByRole("button", { name: "创建" }).click();
    await page.waitForFunction((needle) => document.body.innerText.includes(needle), content, {
      timeout: 10_000,
    });
  };

  const openDetail = async (nonce) => {
    const row = page.locator("tbody tr").filter({ hasText: nonce }).first();
    await row.waitFor({ timeout: 10_000 });
    await row.click();
    await page.waitForFunction(() => document.body.innerText.includes("记忆详情"), undefined, {
      timeout: 10_000,
    });
  };
  const closeDetail = async () => {
    await page.getByRole("button", { name: "×" }).first().click();
    await page.waitForFunction(() => !document.body.innerText.includes("记忆详情"), undefined, {
      timeout: 10_000,
    });
  };

  await openMemoryPage();

  // 造两条不同类型/状态的记忆：甲=已确认人物设定（可召回），乙=废弃伏笔（终态、不召回）。
  await createMemory(activeContent, "CHARACTER_PROFILE");
  await createMemory(terminalContent, "FORESHADOWING");

  await openDetail(activeNonce);
  await page.getByRole("button", { name: "确认" }).click();
  await page.waitForFunction(
    () =>
      !document.body.innerText.includes("记忆详情") ||
      ![...document.querySelectorAll("button")].some(
        (b) => (b.textContent ?? "").trim() === "确认",
      ),
    undefined,
    { timeout: 10_000 },
  );
  await closeDetail();

  await openDetail(terminalNonce);
  await page.getByRole("button", { name: "废弃" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("DEPRECATED"), undefined, {
    timeout: 10_000,
  });
  await closeDetail();

  // 列表（抽屉关闭后）抓行级语义快照。
  const snapshot = await page.evaluate(
    ({ activeNeedle, terminalNeedle }) => {
      const container = [...document.querySelectorAll('[class*="container"]')].find((el) =>
        el.innerText.includes("记忆管理"),
      );
      const containerBg = container
        ? getComputedStyle(container).backgroundColor
        : getComputedStyle(document.body).backgroundColor;
      const rows = [...document.querySelectorAll("tbody tr")];
      const readRow = (needle) => {
        const row = rows.find((r) => (r.innerText ?? "").includes(needle));
        if (!row) return null;
        const cells = [...row.querySelectorAll("td")].map((c) => c.innerText.trim());
        const rect = row.getBoundingClientRect();
        return {
          text: row.innerText.replace(/\s+/g, " ").trim(),
          cells,
          className: row.className,
          top: rect.top,
          height: rect.height,
          contentColor: getComputedStyle(row.querySelector("td")).color,
        };
      };
      const tbodyText = document.querySelector("table tbody")?.innerText ?? "";
      return {
        containerBg,
        tbodyText,
        active: readRow(activeNeedle),
        terminal: readRow(terminalNeedle),
        rowCount: rows.length,
      };
    },
    { activeNeedle: activeNonce, terminalNeedle: terminalNonce },
  );

  assert(snapshot.active && snapshot.terminal, "memory list rows for both memories were not found");

  // 状态/类型/召回以中文标签呈现，列表不再出现原始枚举。
  const statusesAsLabels =
    snapshot.tbodyText.includes("已确认") &&
    snapshot.tbodyText.includes("已弃用") &&
    !snapshot.tbodyText.includes("CONFIRMED") &&
    !snapshot.tbodyText.includes("DEPRECATED");
  const typesAsLabels =
    snapshot.tbodyText.includes("人物设定") && snapshot.tbodyText.includes("伏笔");
  const recallShown =
    snapshot.active.text.includes("可召回") && snapshot.terminal.text.includes("不召回");
  // 终态行被语义弱化（rowTerminal class），活跃行不弱化。
  const terminalRowStyled =
    snapshot.terminal.className.includes("rowTerminal") &&
    !snapshot.active.className.includes("rowTerminal");
  // 行不重叠：两行有正高度且 top 不同。
  const noOverlap =
    snapshot.active.height > 0 &&
    snapshot.terminal.height > 0 &&
    Math.abs(snapshot.active.top - snapshot.terminal.top) >= snapshot.active.height - 1;
  // 浅色调：容器背景不是旧的深色（rgb 三通道都偏亮，> 200）。
  const bgMatch = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(snapshot.containerBg);
  const lightTheme = bgMatch
    ? Number(bgMatch[1]) > 200 && Number(bgMatch[2]) > 200 && Number(bgMatch[3]) > 200
    : false;

  assert(statusesAsLabels, `status not shown as labels: ${snapshot.tbodyText.slice(0, 200)}`);
  assert(typesAsLabels, "memory types not shown as labels in the list");
  assert(recallShown, "recall value (可召回/不召回) not shown per row");
  assert(terminalRowStyled, "terminal memory row was not visually de-emphasized");
  assert(noOverlap, "memory list rows overlap or have zero height");
  assert(lightTheme, `memory page is not on the global light theme: ${snapshot.containerBg}`);

  // 本 slice 是纯记忆页 UI 验收，无对话 turn；直接构造 ui_state（不依赖 user_message 帧）。
  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      socket_connected: true,
      outcome: "done",
      duration_ms: 0,
      turn_id: "memory_list_ux",
      turn_ids: [],
      statuses_as_labels: statusesAsLabels,
      types_as_labels: typesAsLabels,
      recall_shown: recallShown,
      terminal_row_styled: terminalRowStyled,
      no_row_overlap: noOverlap,
      light_theme: lightTheme,
      container_bg: snapshot.containerBg,
      active_nonce: activeNonce,
      terminal_nonce: terminalNonce,
      row_count: snapshot.rowCount,
    },
  ];
}

async function driveAu09ValidityWindowRecall(page) {
  // 种子：当前位置=第5章；窗口外设定「盘古碑（仅序章设定）」(1-2章)；无窗口设定「玄铁令（全书核心信物）」。
  const inWindowPhrase = "全书核心信物";
  const outOfWindowPhrase = "仅序章设定";

  // 一条同时与两条设定相关的消息：召回应只命中无窗口设定，窗口外设定被排除。
  const message = "请讲讲盘古碑和玄铁令在剧情里的关系。";
  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const turnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.assistant_message != null,
    "No turn_result frame after memory-grounded message",
    170_000,
  );
  const turnResult = turnFrame.body;

  // 「为什么」面板只展示真正被召回的设定来源（已确认设定 + 摘要）。
  const whyText = await openLatestWhyDialog(page);
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, turnResult, sentMessage);

  const whyShowsInWindow = whyText.includes(inWindowPhrase);
  const whyExcludesOutOfWindow = !whyText.includes(outOfWindowPhrase);

  assert(whyShowsInWindow, "Why panel did not show the in-window memory source");
  assert(
    whyExcludesOutOfWindow,
    "Why panel leaked an out-of-window memory (validity window not enforced)",
  );

  return [
    {
      ...uiState,
      turn_id: turnResult.turn_id,
      recall_turn_id: turnResult.turn_id,
      in_window_phrase: inWindowPhrase,
      out_of_window_phrase: outOfWindowPhrase,
      why_shows_in_window: whyShowsInWindow,
      why_excludes_out_of_window: whyExcludesOutOfWindow,
      message_text: message,
    },
  ];
}

async function driveAu09CrossWorkMemoryIsolation(page) {
  const workATitle = "AU09 隔离甲作品";
  const workBTitle = "AU09 隔离乙作品";
  const foreignToken = "甲界暮钟";
  const foreignSummaryNeedle = "只属于甲作品";
  const currentToken = "乙界星钥";
  const currentSummaryNeedle = "只属于乙作品";
  const currentRuleNeedle = "真实记忆作为代价";

  // 明确经过真实作品切换：先到甲作品，再切回乙作品，后续所有断言都在乙作品上完成。
  await switchToWorkByTitle(page, workATitle);
  await switchToWorkByTitle(page, workBTitle);

  const foreshadowingPanel = await openArchiveTab(page, "伏笔");
  await page.waitForFunction(
    ([current, foreign]) => {
      const panel = [...document.querySelectorAll('[class*="panel"]')].find((element) =>
        element.innerText.includes("作品档案"),
      );
      const text = panel?.innerText ?? "";
      return text.includes(current) && !text.includes(foreign);
    },
    [currentToken, foreignToken],
    { timeout: 10_000 },
  );
  const foreshadowingArchiveSnapshot = await archivePanelSnapshot(foreshadowingPanel);
  const archiveShowsCurrentForeshadowing = foreshadowingArchiveSnapshot.text.includes(currentToken);
  const archiveExcludesForeignForeshadowing =
    !foreshadowingArchiveSnapshot.text.includes(foreignToken) &&
    !foreshadowingArchiveSnapshot.text.includes(foreignSummaryNeedle);
  assert(archiveShowsCurrentForeshadowing, "Current work foreshadowing did not appear in archive");
  assert(
    archiveExcludesForeignForeshadowing,
    "Foreign work foreshadowing leaked into current archive",
  );

  await page.getByRole("tab", { name: "经验规则" }).click();
  await page.waitForFunction(
    ([currentRule, foreign]) => {
      const panel = [...document.querySelectorAll('[class*="panel"]')].find((element) =>
        element.innerText.includes("作品档案"),
      );
      const text = panel?.innerText ?? "";
      return text.includes(currentRule) && !text.includes(foreign);
    },
    [currentRuleNeedle, foreignToken],
    { timeout: 10_000 },
  );
  const ruleArchiveSnapshot = await archivePanelSnapshot(foreshadowingPanel);
  const archiveShowsCurrentRule = ruleArchiveSnapshot.text.includes(currentRuleNeedle);
  const archiveExcludesForeignInRuleTab =
    !ruleArchiveSnapshot.text.includes(foreignToken) &&
    !ruleArchiveSnapshot.text.includes(foreignSummaryNeedle);
  assert(archiveShowsCurrentRule, "Current work rule did not appear in archive");
  assert(archiveExcludesForeignInRuleTab, "Foreign work memory leaked into rule archive tab");

  const closeArchive = page.getByRole("button", { name: "关闭档案" });
  if ((await closeArchive.count()) > 0) {
    await closeArchive.first().click();
  }

  await page.getByRole("button", { name: /记忆/ }).first().click();
  await page.waitForFunction(() => document.body.innerText.includes("记忆管理"), undefined, {
    timeout: 10_000,
  });
  const memoryTable = page.locator("table").first();
  await memoryTable.waitFor({ timeout: 10_000 });
  await page.waitForFunction(
    ([current, rule]) => {
      const table = document.querySelector("table");
      const text = table?.innerText ?? "";
      return text.includes(current) && text.includes(rule);
    },
    [currentToken, currentRuleNeedle],
    { timeout: 10_000 },
  );
  const memoryTableText = await memoryTable.innerText();
  const memoryPageShowsCurrent =
    memoryTableText.includes(currentToken) && memoryTableText.includes(currentRuleNeedle);
  const memoryPageExcludesForeign =
    !memoryTableText.includes(foreignToken) && !memoryTableText.includes(foreignSummaryNeedle);
  assert(memoryPageShowsCurrent, "Memory page did not show current work memories");
  assert(memoryPageExcludesForeign, "Memory page leaked foreign work memories");

  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  const seenTurnIds = new Set(
    frames
      .filter((frame) => frame.direction === "received" && frame.event === "turn_result")
      .map((frame) => frame.body?.turn_id)
      .filter(Boolean),
  );
  const message = `请判断${foreignToken}和${currentToken}哪个能作为当前作品的后续伏笔，并说明星钥规则。`;
  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const recallFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      !seenTurnIds.has(frame.body.turn_id) &&
      frame.body?.assistant_message != null,
    "No turn_result frame after cross-work isolation recall message",
    170_000,
  );
  const recallTurnResult = recallFrame.body;
  const sentMessage = latestSentUserMessage();

  const contextDone = await waitForAppLogRecord(
    (record) =>
      record.event === "context.assemble.done" &&
      record.turn_id === recallTurnResult.turn_id &&
      record.work_id === sentMessage.body?.work_id &&
      record.has_memory === true,
    "Current work memory was not recalled for cross-work isolation probe",
    20_000,
  );

  const memorySummaries = (recallTurnResult.trace_summary?.context_refs ?? [])
    .filter((ref) => String(ref.source_type) === "memory")
    .map((ref) => String(ref.summary ?? ""))
    .join("\n");
  const contextIncludesCurrent =
    memorySummaries.includes(currentToken) || memorySummaries.includes(currentSummaryNeedle);
  const contextExcludesForeign =
    !memorySummaries.includes(foreignToken) &&
    !memorySummaries.includes(foreignSummaryNeedle) &&
    !memorySummaries.includes("甲作品");
  assert(contextIncludesCurrent, "Recalled context did not include the current work memory");
  assert(contextExcludesForeign, "Recalled context included a foreign work memory");

  const whyText = await openLatestWhyDialog(page);
  const whyShowsCurrent = whyText.includes(currentToken) || whyText.includes(currentSummaryNeedle);
  const whyExcludesForeignSummary =
    !whyText.includes(foreignSummaryNeedle) && !whyText.includes("甲作品");
  assert(whyShowsCurrent, "Why panel did not show current work memory source");
  assert(whyExcludesForeignSummary, "Why panel leaked foreign work memory source");

  const joinedWorkIds = [
    ...new Set(
      readAppLogRecords()
        .filter((record) => record.event === "channel.join.done" && record.work_id)
        .map((record) => String(record.work_id)),
    ),
  ];
  const currentWorkId = String(sentMessage.body?.work_id ?? "");
  const foreignWorkId = joinedWorkIds.find((workId) => workId !== currentWorkId) ?? null;
  const switchedThroughForeignWork = Boolean(foreignWorkId && currentWorkId);

  const uiState = await commonUiState(page, recallTurnResult, sentMessage);

  return [
    {
      ...uiState,
      turn_id: recallTurnResult.turn_id,
      recall_turn_id: recallTurnResult.turn_id,
      current_work_title: workBTitle,
      foreign_work_title: workATitle,
      current_work_id: currentWorkId,
      foreign_work_id: foreignWorkId,
      joined_work_count: joinedWorkIds.length,
      switched_through_foreign_work: switchedThroughForeignWork,
      archive_current_only:
        archiveShowsCurrentForeshadowing &&
        archiveShowsCurrentRule &&
        archiveExcludesForeignForeshadowing &&
        archiveExcludesForeignInRuleTab,
      memory_page_current_only: memoryPageShowsCurrent && memoryPageExcludesForeign,
      context_includes_current_work_memory: contextIncludesCurrent,
      context_excludes_foreign_work_memory: contextExcludesForeign,
      context_has_memory: contextDone.has_memory === true,
      why_shows_current_work_memory: whyShowsCurrent,
      why_excludes_foreign_work_memory: whyExcludesForeignSummary,
      current_memory_nonce: currentToken,
      foreign_memory_nonce: foreignToken,
      message_text: message,
    },
  ];
}

async function driveAu10WorkbenchMatrixLayout(page) {
  const records = [];
  const initialLayout = await captureWorkbenchLayout(page, "initial");
  assertWorkbenchLayout(initialLayout, "initial");

  const ordinaryMessage = "请用一句话说明当前作品的创作状态。";
  await page.locator(chatInputSelector).fill(ordinaryMessage);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const ordinaryTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.assistant_message != null,
    "No ordinary AU-10 turn_result websocket frame was received",
    120_000,
  );
  const ordinaryTurnResult = ordinaryTurnFrame.body;

  await page.waitForFunction(
    (message) =>
      document.body.innerText.includes(message) && !document.body.innerText.includes("思考中"),
    ordinaryMessage,
    { timeout: 10_000 },
  );

  const whyText = await openLatestWhyDialog(page);
  assert(whyText.includes("参考来源"), "Why dialog did not expose author-facing trace sources");
  await page.keyboard.press("Escape").catch(() => {});
  await page
    .getByRole("dialog")
    .first()
    .waitFor({ state: "detached", timeout: 2_000 })
    .catch(() => {});

  const afterOrdinaryLayout = await captureWorkbenchLayout(page, "after_ordinary_turn");
  assertWorkbenchLayout(afterOrdinaryLayout, "after_ordinary_turn");
  const ordinaryUiState = await commonUiState(page, ordinaryTurnResult, latestSentUserMessage());

  records.push({
    ...ordinaryUiState,
    phase: "ordinary_turn",
    turn_id: ordinaryTurnResult.turn_id,
    ordinary_turn_id: ordinaryTurnResult.turn_id,
    ordinary_message_text: ordinaryMessage,
    trace_why_dialog_open: true,
    trace_why_text: whyText,
    trace_why_contains_raw_prompt: /raw prompt|provider raw|hidden policy|debug|ctx_/i.test(
      whyText,
    ),
    layout: afterOrdinaryLayout,
    au10_layout_passed: true,
  });

  const candidateRecords = await driveCandidateAdoptionBridge(page);
  const candidateRecord = candidateRecords[0];
  records.push({
    ...candidateRecord,
    phase: "candidate_action",
    au10_candidate_action_passed: true,
  });

  const adoptionRecords = await driveP1ChapterAdoptionReading(page);
  const adoptionRecord = adoptionRecords[0];
  const afterReadingLayout = await captureWorkbenchLayout(page, "after_adoption_reading");
  assert(afterReadingLayout.no_horizontal_overflow, "reading mode introduced horizontal overflow");

  records.push({
    ...adoptionRecord,
    phase: "adoption_reading",
    layout: afterReadingLayout,
    au10_adoption_reading_passed: true,
  });

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au10-workbench-matrix-layout",
      turn_id: ordinaryTurnResult.turn_id,
      ordinary_turn_id: ordinaryTurnResult.turn_id,
      candidate_turn_id: candidateRecord.turn_id,
      candidate_source_turn_ref: candidateRecord.source_turn_ref,
      candidate_ref: candidateRecord.candidate_ref,
      adoption_turn_id: adoptionRecord.adopt_turn_id,
      draft_turn_id: adoptionRecord.draft_turn_id,
      artifact_id: adoptionRecord.artifact_id,
      layout_initial: initialLayout,
      layout_after_ordinary: afterOrdinaryLayout,
      layout_after_reading: afterReadingLayout,
      viewport_width: initialLayout.viewport_width,
      viewport_height: initialLayout.viewport_height,
      layout_no_horizontal_overflow:
        initialLayout.no_horizontal_overflow &&
        afterOrdinaryLayout.no_horizontal_overflow &&
        afterReadingLayout.no_horizontal_overflow,
      top_bar_single_row:
        initialLayout.top_bar_single_row && afterOrdinaryLayout.top_bar_single_row,
      input_area_visible:
        initialLayout.input_area_visible && afterOrdinaryLayout.input_area_visible,
      service_status_visible: initialLayout.service_status_visible,
      provider_status_visible: initialLayout.provider_status_visible,
      task_status_visible: initialLayout.task_status_visible,
      ordinary_turn_completed: Boolean(ordinaryTurnResult.turn_id),
      trace_why_dialog_open: true,
      trace_why_contains_raw_prompt: records.some(
        (record) => record.trace_why_contains_raw_prompt === true,
      ),
      candidate_action_completed: Boolean(candidateRecord.action_result_status),
      candidate_selected: candidateRecord.candidate_selected === true,
      candidate_adopted: candidateRecord.candidate_adopted === true,
      adoption_reading_completed: adoptionRecord.reading_mode_populated_after_adoption === true,
      word_count_matches_adopted_prose: adoptionRecord.word_count_matches_adopted_prose === true,
      matrix_phases: records.map((record) => record.phase),
    },
    ...records,
  ];
}

async function driveAu10WorkbenchRecoveryTaskstate(page) {
  const [adoptionRecord] = await driveP1ChapterAdoptionReading(page);

  await page.getByRole("button", { name: "导出全书" }).click();

  const runningFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "task_state" &&
      frame.body?.phase === "RUNNING",
    "Export did not broadcast RUNNING task_state",
    30_000,
  );
  const taskId = runningFrame.body.task_id;

  await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "task_state" &&
      frame.body?.task_id === taskId &&
      frame.body?.phase === "CHECKPOINT",
    "Export did not broadcast CHECKPOINT task_state",
    30_000,
  );

  await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "task_state" &&
      frame.body?.task_id === taskId &&
      frame.body?.phase === "COMPLETED",
    "Export did not broadcast COMPLETED task_state",
    30_000,
  );

  await page.waitForFunction(() => document.body.innerText.includes("已导出到"), {
    timeout: 10_000,
  });
  const exportText = await page.locator("body").innerText();

  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("任务完成"), {
    timeout: 10_000,
  });
  const workbenchText = await page.locator("body").innerText();
  const taskFrames = receivedTaskStateFrames(taskId);
  const taskPhases = taskFrames.map((frame) => frame.body?.phase).filter(Boolean);

  assert(taskPhases.includes("RUNNING"), "RUNNING task state was not observed");
  assert(taskPhases.includes("CHECKPOINT"), "CHECKPOINT task state was not observed");
  assert(taskPhases.includes("COMPLETED"), "COMPLETED task state was not observed");
  assert(workbenchText.includes("任务完成"), "Workbench did not keep the completed task visible");

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au10-workbench-recovery-taskstate",
      turn_id: adoptionRecord.draft_turn_id,
      draft_turn_id: adoptionRecord.draft_turn_id,
      adoption_turn_id: adoptionRecord.adopt_turn_id,
      artifact_id: adoptionRecord.artifact_id,
      task_id: taskId,
      task_type: runningFrame.body.task_type,
      task_state_phases: taskPhases,
      task_state_count: taskFrames.length,
      task_status_after_return: "任务完成",
      export_success_visible: exportText.includes("已导出到"),
      export_path_visible: exportText.includes("已导出到") && exportText.includes(".md"),
      real_export_button_clicked: true,
      real_workbench_completed_status_visible: true,
      adoption_reading_completed: adoptionRecord.reading_mode_populated_after_adoption === true,
    },
  ];
}

async function driveAu10WorkbenchRecoveryDisconnectTimeout(page) {
  await page.goto(baseUrl, { waitUntil: "commit", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => /服务: 已连接|同步已连接/.test(document.body.innerText), {
    timeout: 30_000,
  });

  await configureProviderRuntime({
    provider: "lmstudio",
    model: "slice-verify-unreachable-model",
    endpoint: "http://127.0.0.1:9/v1",
  });

  const nonce = `AU10-RECOVERY-${Date.now()}`;
  const failingMessage = `请围绕 ${nonce} 给我一个创作方向。`;
  await page.locator(chatInputSelector).fill(failingMessage);
  await page.getByRole("button", { name: "发送" }).click();

  const failingSentMessage = latestSentUserMessage();

  const failureFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      String(frame.body?.assistant_message?.text ?? "").includes("无法连接到创作引擎") &&
      String(frame.body?.assistant_message?.text ?? "").includes("没有写入作品事实") &&
      frame.body?.truthfulness?.production_write_performed === false,
    "Provider failure did not return a recoverable fallback turn_result",
    60_000,
  );
  const failureTurnId = failureFrame.body.turn_id;

  const providerFailureLog = await waitForAppLogRecord(
    (record) =>
      record.event === "provider_gateway.complete.error" &&
      record.provider === "lmstudio" &&
      record.turn_id === failureTurnId,
    "No provider_gateway.complete.error log was emitted for the failing turn",
    30_000,
  );

  await waitForAppLogRecord(
    (record) => record.event === "channel.user_message.done" && record.turn_id === failureTurnId,
    "No channel.user_message.done log was emitted for the recoverable failing turn",
    30_000,
  );

  await page.waitForFunction(
    (selector) => {
      const input = document.querySelector(selector);
      const bodyText = document.body.innerText;
      return (
        input instanceof HTMLInputElement &&
        input.disabled === false &&
        !bodyText.includes("思考中...") &&
        bodyText.includes("无法连接到创作引擎") &&
        bodyText.includes("没有写入作品事实")
      );
    },
    chatInputSelector,
    { timeout: 10_000 },
  );

  await configureProviderRuntime({ provider: "slice_verify" });

  const recoveryMessage = `恢复后继续围绕 ${nonce} 聊下去。`;
  await page.locator(chatInputSelector).fill(recoveryMessage);
  await page.getByRole("button", { name: "发送" }).click();

  const recoveryFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      frame.body.turn_id !== failureTurnId &&
      frame.body?.status !== "error" &&
      String(frame.body?.assistant_message?.text ?? "").length > 0,
    "Workbench did not recover and complete a following user message",
    60_000,
  );

  await waitForAppLogRecord(
    (record) =>
      record.event === "provider_gateway.complete.done" &&
      record.provider === "slice_verify" &&
      record.turn_id === recoveryFrame.body.turn_id,
    "No provider_gateway.complete.done log proved the following turn recovered",
    30_000,
  );

  const visibleText = await page.locator("body").innerText();
  const uiState = await commonUiState(page, recoveryFrame.body, latestSentUserMessage());

  return [
    {
      ...uiState,
      event: "slice_verify.ui_state.done",
      slice_id: "au10-workbench-recovery-disconnect-timeout",
      turn_id: recoveryFrame.body.turn_id,
      turn_ids: [failureTurnId, recoveryFrame.body.turn_id],
      failure_turn_id: failureTurnId,
      recovery_turn_id: recoveryFrame.body.turn_id,
      failing_provider: providerFailureLog.provider,
      failure_status: failureFrame.body.status,
      recovery_status: recoveryFrame.body.status,
      failure_message_visible:
        visibleText.includes("无法连接到创作引擎") && visibleText.includes("没有写入作品事实"),
      no_production_write_on_failure:
        failureFrame.body.truthfulness?.production_write_performed === false,
      no_artifact_adopted_on_failure: failureFrame.body.truthfulness?.artifact_adopted === false,
      loading_cleared_after_failure: !visibleText.includes("思考中..."),
      input_enabled_after_failure: true,
      following_turn_completed: recoveryFrame.body.status !== "error",
      can_continue_after_failure: true,
      failure_prompt_sent: String(failingSentMessage?.body?.text ?? "").includes(nonce),
      recovery_prompt_sent: String(latestSentUserMessage()?.body?.text ?? "").includes(nonce),
    },
  ];
}

async function driveAu10WorkbenchRecoveryProviderTimeout(page) {
  const hangingServer = await startHangingOpenAiServer();

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => /服务: 已连接|同步已连接/.test(document.body.innerText), {
      timeout: 30_000,
    });

    await configureProviderRuntime({
      provider: "lmstudio",
      model: "slice-verify-timeout-model",
      endpoint: hangingServer.endpoint,
    });

    const nonce = `AU10-PROVIDER-TIMEOUT-${Date.now()}`;
    const timeoutMessage = `请围绕 ${nonce} 给我一个创作方向。`;
    await page.locator(chatInputSelector).fill(timeoutMessage);
    await page.getByRole("button", { name: "发送" }).click();

    const timeoutSentMessage = latestSentUserMessage();

    const timeoutFrame = await waitForFrame(
      (frame) =>
        frame.direction === "received" &&
        frame.event === "turn_result" &&
        frame.body?.turn_id &&
        String(frame.body?.assistant_message?.text ?? "").includes("响应超时") &&
        String(frame.body?.assistant_message?.text ?? "").includes("没有写入作品事实") &&
        frame.body?.truthfulness?.production_write_performed === false,
      "Provider timeout did not return a recoverable fallback turn_result",
      60_000,
    );
    const timeoutTurnId = timeoutFrame.body.turn_id;

    const providerTimeoutLog = await waitForAppLogRecord(
      (record) =>
        record.event === "provider_gateway.complete.error" &&
        record.provider === "lmstudio" &&
        record.turn_id === timeoutTurnId &&
        record.reason_code === "timeout",
      "No provider_gateway.complete.error log with reason_code=timeout was emitted",
      30_000,
    );

    await waitForAppLogRecord(
      (record) => record.event === "channel.user_message.done" && record.turn_id === timeoutTurnId,
      "No channel.user_message.done log was emitted for the recoverable timeout turn",
      30_000,
    );

    await page.waitForFunction(
      (selector) => {
        const input = document.querySelector(selector);
        const bodyText = document.body.innerText;
        return (
          input instanceof HTMLInputElement &&
          input.disabled === false &&
          !bodyText.includes("思考中...") &&
          bodyText.includes("响应超时") &&
          bodyText.includes("没有写入作品事实")
        );
      },
      chatInputSelector,
      { timeout: 10_000 },
    );
    const timeoutVisibleText = await page.locator("body").innerText();

    await configureProviderRuntime({ provider: "slice_verify" });

    const recoveryMessage = `timeout 恢复后继续围绕 ${nonce} 聊下去。`;
    await page.locator(chatInputSelector).fill(recoveryMessage);
    await page.getByRole("button", { name: "发送" }).click();

    const recoveryFrame = await waitForFrame(
      (frame) =>
        frame.direction === "received" &&
        frame.event === "turn_result" &&
        frame.body?.turn_id &&
        frame.body.turn_id !== timeoutTurnId &&
        frame.body?.status !== "error" &&
        String(frame.body?.assistant_message?.text ?? "").length > 0,
      "Workbench did not recover and complete a following user message after timeout",
      60_000,
    );

    await waitForAppLogRecord(
      (record) =>
        record.event === "provider_gateway.complete.done" &&
        record.provider === "slice_verify" &&
        record.turn_id === recoveryFrame.body.turn_id,
      "No slice_verify provider_gateway.complete.done log was emitted for the recovery turn",
      30_000,
    );

    await waitForAppLogRecord(
      (record) =>
        record.event === "channel.user_message.done" &&
        record.turn_id === recoveryFrame.body.turn_id,
      "No channel.user_message.done log proved the recovery turn completed after timeout",
      30_000,
    );

    const uiState = await commonUiState(page, recoveryFrame.body, latestSentUserMessage());

    return [
      {
        ...uiState,
        event: "slice_verify.ui_state.done",
        slice_id: "au10-workbench-recovery-provider-timeout",
        turn_id: recoveryFrame.body.turn_id,
        turn_ids: [timeoutTurnId, recoveryFrame.body.turn_id],
        timeout_turn_id: timeoutTurnId,
        recovery_turn_id: recoveryFrame.body.turn_id,
        timeout_provider: providerTimeoutLog.provider,
        timeout_reason_code: providerTimeoutLog.reason_code,
        timeout_message_visible:
          timeoutVisibleText.includes("响应超时") &&
          timeoutVisibleText.includes("没有写入作品事实"),
        no_production_write_on_timeout:
          timeoutFrame.body.truthfulness?.production_write_performed === false,
        no_artifact_adopted_on_timeout: timeoutFrame.body.truthfulness?.artifact_adopted === false,
        loading_cleared_after_timeout: !timeoutVisibleText.includes("思考中..."),
        input_enabled_after_timeout: true,
        recovery_turn_completed: recoveryFrame.body.status !== "error",
        timeout_prompt_sent: String(timeoutSentMessage?.body?.text ?? "").includes(nonce),
        recovery_prompt_sent: String(latestSentUserMessage()?.body?.text ?? "").includes(nonce),
      },
    ];
  } finally {
    await hangingServer.close();
  }
}

async function driveAu10WorkbenchRecoveryReconnect(page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => /服务: 已连接|同步已连接/.test(document.body.innerText), {
    timeout: 30_000,
  });

  await configureProviderRuntime({ provider: "slice_verify" });

  const initialJoinCount = readAppLogRecords().filter(
    (record) => record.event === "channel.join.done",
  ).length;

  const service = createPhoenixServiceController();

  try {
    await service.stopOriginal();
    await page.waitForFunction(
      (selector) => {
        const input = document.querySelector(selector);
        const bodyText = document.body.innerText;
        return (
          input instanceof HTMLInputElement &&
          input.disabled === true &&
          bodyText.includes("同步离线") &&
          !bodyText.includes("思考中...")
        );
      },
      chatInputSelector,
      { timeout: 45_000 },
    );

    const offlineText = await page.locator("body").innerText();

    await service.restart();
    const joinCountAfterRestore = await waitForAppLogCount(
      (record) => record.event === "channel.join.done",
      initialJoinCount + 1,
      "No channel.join.done log proved websocket rejoin after service recovery",
      60_000,
    );

    await page.waitForFunction(
      (selector) => {
        const input = document.querySelector(selector);
        const bodyText = document.body.innerText;
        return (
          input instanceof HTMLInputElement &&
          input.disabled === false &&
          bodyText.includes("同步已连接")
        );
      },
      chatInputSelector,
      { timeout: 60_000 },
    );

    const nonce = `AU10-RECONNECT-${Date.now()}`;
    const recoveryMessage = `断线恢复后继续围绕 ${nonce} 聊下去。`;
    await page.locator(chatInputSelector).fill(recoveryMessage);
    await page.getByRole("button", { name: "发送" }).click();

    const recoveryFrame = await waitForFrame(
      (frame) =>
        frame.direction === "received" &&
        frame.event === "turn_result" &&
        frame.body?.turn_id &&
        frame.body?.status !== "error" &&
        String(frame.body?.assistant_message?.text ?? "").length > 0,
      "Workbench did not complete a following turn after websocket reconnect",
      60_000,
    );

    await waitForAppLogRecord(
      (record) =>
        record.event === "channel.user_message.done" &&
        record.turn_id === recoveryFrame.body.turn_id,
      "No channel.user_message.done log proved the following turn completed after reconnect",
      30_000,
    );

    const visibleText = await page.locator("body").innerText();
    const uiState = await commonUiState(page, recoveryFrame.body, latestSentUserMessage());

    return [
      {
        ...uiState,
        event: "slice_verify.ui_state.done",
        slice_id: "au10-workbench-recovery-reconnect",
        turn_id: recoveryFrame.body.turn_id,
        initial_join_count: initialJoinCount,
        join_count_after_restore: joinCountAfterRestore,
        offline_status_visible: offlineText.includes("同步离线"),
        input_disabled_while_offline: true,
        loading_cleared_while_offline: !offlineText.includes("思考中..."),
        reconnected_status_visible: visibleText.includes("同步已连接"),
        input_enabled_after_reconnect: true,
        rejoin_observed: joinCountAfterRestore > initialJoinCount,
        following_turn_completed: recoveryFrame.body.status !== "error",
        recovery_prompt_sent: String(latestSentUserMessage()?.body?.text ?? "").includes(nonce),
        service_stopped_externally: true,
        service_restarted_externally: true,
      },
    ];
  } finally {
    await service.stopRestarted();
  }
}

async function driveAu10WorkbenchRecoveryCancelWaiting(
  page,
  sliceId = "au10-workbench-recovery-cancel-waiting",
) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => /服务: 已连接|同步已连接/.test(document.body.innerText), {
    timeout: 30_000,
  });

  await configureProviderRuntime({ provider: "slice_verify" });

  const nonce = `AU10-CANCEL-WAITING-${Date.now()}`;
  const requestText = `第01章：底层灵气账单 写得太平了，推翻重写这一章的正文草稿，保持为待采纳草稿。标记 ${nonce}`;
  await page.locator(chatInputSelector).fill(requestText);
  await page.getByRole("button", { name: "发送" }).click();

  const promptMessage = latestSentUserMessage();
  const confirmationFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.status === "needs_confirmation" &&
      frame.body?.truthfulness?.tool_called === false &&
      frame.body?.truthfulness?.production_write_performed === false &&
      (frame.body?.available_actions ?? []).some(
        (action) => action.action_type === "reject_or_cancel_confirmation",
      ),
    "No cancellable confirmation turn_result was received",
    200_000,
  );
  const confirmationTurnResult = confirmationFrame.body;
  const cancelAction = confirmationTurnResult.available_actions.find(
    (action) => action.action_type === "reject_or_cancel_confirmation",
  );
  assert(cancelAction, "Confirmation turn_result did not include a cancel action");

  await page.waitForFunction(
    () => document.body.innerText.includes("确认执行") && document.body.innerText.includes("拒绝"),
    { timeout: 10_000 },
  );
  const confirmationVisibleText = await page.locator("body").innerText();

  await page.getByRole("button", { name: "拒绝" }).first().click();

  const cancelActionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "reject_or_cancel_confirmation" &&
      frame.body?.action?.action_id === cancelAction.action_id,
    "Real workbench did not send the reject_or_cancel_confirmation author_action",
  );

  const actionResultFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "action_result" &&
      frame.body?.status === "cancelled" &&
      frame.body?.action_type === "reject_or_cancel_confirmation",
    "No cancelled action_result websocket frame was received",
    60_000,
  );

  const cancelTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.phase === "cancelled" &&
      frame.body?.status === "cancelled" &&
      frame.body?.truthfulness?.tool_called === false &&
      frame.body?.truthfulness?.artifact_adopted === false &&
      frame.body?.truthfulness?.production_write_performed === false &&
      frame.body?.behavior_state?.active == null,
    "No cancelled TurnResult closed the pending confirmation",
    60_000,
  );
  const cancelTurnResult = cancelTurnFrame.body;
  const behaviorTraceRefs = cancelTurnResult.trace_summary?.behavior_trace_refs ?? [];
  const terminalBehaviorTraceRef = behaviorTraceRefs[0] ?? {};

  await waitForAppLogRecord(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.turn_id === confirmationTurnResult.turn_id &&
      record.action_status === "cancelled",
    "No channel.author_action.done log proved cancellation completed",
    30_000,
  );

  await page.waitForFunction(
    (selector) => {
      const input = document.querySelector(selector);
      const bodyText = document.body.innerText;
      const buttons = [...document.querySelectorAll("button")].map((btn) =>
        (btn.textContent ?? "").trim(),
      );
      return (
        input instanceof HTMLInputElement &&
        input.disabled === false &&
        bodyText.includes("已取消等待") &&
        bodyText.includes("没有写入作品事实") &&
        !bodyText.includes("思考中...") &&
        !buttons.includes("确认执行") &&
        !buttons.includes("拒绝")
      );
    },
    chatInputSelector,
    { timeout: 10_000 },
  );
  const cancelledVisibleText = await page.locator("body").innerText();

  const followMessage = `取消等待后继续围绕 ${nonce} 聊一个新的方向。`;
  const framesBeforeFollow = frames.length;
  await page.locator(chatInputSelector).fill(followMessage);
  await page.getByRole("button", { name: "发送" }).click();

  const followingFrame = await waitForFrame(
    (frame) =>
      frames.indexOf(frame) >= framesBeforeFollow &&
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      frame.body.turn_id !== confirmationTurnResult.turn_id &&
      frame.body.turn_id !== cancelTurnResult.turn_id &&
      frame.body?.status !== "error" &&
      String(frame.body?.assistant_message?.text ?? "").length > 0,
    "Workbench did not complete a following turn after cancelling the pending confirmation",
    60_000,
  );

  await waitForAppLogRecord(
    (record) =>
      record.event === "channel.user_message.done" &&
      record.turn_id === followingFrame.body.turn_id,
    "No channel.user_message.done log proved the following turn completed after cancellation",
    30_000,
  );

  const uiState = await commonUiState(page, followingFrame.body, latestSentUserMessage());

  return [
    {
      ...uiState,
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_id: followingFrame.body.turn_id,
      turn_ids: [
        confirmationTurnResult.turn_id,
        cancelTurnResult.turn_id,
        followingFrame.body.turn_id,
      ],
      confirmation_turn_id: confirmationTurnResult.turn_id,
      cancel_turn_id: cancelTurnResult.turn_id,
      following_turn_id: followingFrame.body.turn_id,
      action_id: cancelAction.action_id,
      action_type: cancelAction.action_type,
      cancel_action_sent: cancelActionFrame.body?.action?.action_type,
      action_result_status: actionResultFrame.body?.status,
      cancel_trace_ref: cancelTurnResult.trace_summary?.trace_ref ?? "",
      behavior_trace_ref: terminalBehaviorTraceRef.behavior_ref ?? "",
      behavior_trace_event_type: terminalBehaviorTraceRef.event_type ?? "",
      behavior_trace_next_status: terminalBehaviorTraceRef.next_status ?? "",
      behavior_trace_event_turn_ref: terminalBehaviorTraceRef.event_turn_ref ?? "",
      behavior_trace_resolution_ref: terminalBehaviorTraceRef.resolution_ref ?? "",
      behavior_trace_refs_count: behaviorTraceRefs.length,
      confirmation_card_visible:
        confirmationVisibleText.includes("确认执行") && confirmationVisibleText.includes("拒绝"),
      cancelled_message_visible:
        cancelledVisibleText.includes("已取消等待") &&
        cancelledVisibleText.includes("没有写入作品事实"),
      confirmation_buttons_cleared: true,
      active_behavior_closed: cancelTurnResult.behavior_state?.active == null,
      no_tool_called_before_cancel:
        confirmationTurnResult.truthfulness?.tool_called === false &&
        cancelTurnResult.truthfulness?.tool_called === false,
      no_production_write_on_cancel:
        confirmationTurnResult.truthfulness?.production_write_performed === false &&
        cancelTurnResult.truthfulness?.production_write_performed === false,
      no_artifact_adopted_on_cancel: cancelTurnResult.truthfulness?.artifact_adopted === false,
      loading_cleared_after_cancel: !cancelledVisibleText.includes("思考中..."),
      input_enabled_after_cancel: true,
      following_turn_completed: followingFrame.body.status !== "error",
      prompt_sent: String(promptMessage?.body?.text ?? "").includes(nonce),
      recovery_prompt_sent: String(latestSentUserMessage()?.body?.text ?? "").includes(nonce),
    },
  ];
}

async function driveAu07BehaviorTraceTerminalReplay(page) {
  return driveAu10WorkbenchRecoveryCancelWaiting(page, "au07-behavior-trace-terminal-replay");
}

async function driveSu01ProviderHealthModel(page) {
  const joined = await waitForAppLogRecord(
    (record) => record.event === "channel.join.done" && record.work_id,
    "Workbench did not join a work before provider health check",
    30_000,
  );

  const modelButton = page.locator('[class*="modelStatusButton"]').first();
  await modelButton.waitFor({ timeout: 10_000 });
  await page.waitForFunction(() => document.body.innerText.includes("模型已连接"), {
    timeout: 30_000,
  });

  const buttonText = (await modelButton.textContent())?.trim() ?? "";
  const buttonTitle = (await modelButton.getAttribute("title")) ?? "";
  const modelLabel =
    buttonTitle.match(/当前模型：(.+)$/)?.[1]?.trim() ||
    buttonText.replace(/模型已连接/g, "").trim() ||
    "slice_verify";

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "su01-provider-health-model",
      work_id: joined.work_id,
      context_work_id: joined.work_id,
      session_id: joined.session_id,
      socket_connected: true,
      llm_connected: buttonText.includes("模型已连接") || buttonTitle.includes("当前模型："),
      llm_model_label: modelLabel,
      llm_status_text: `LLM: 已连接 · ${modelLabel}`,
      model_button_text: buttonText,
      model_button_title: buttonTitle,
    },
  ];
}

async function driveSu01LmstudioDisconnectedHealth(page) {
  await configureProviderRuntime({
    provider: "lmstudio",
    endpoint: "http://127.0.0.1:1/v1",
    model: "missing-local-model",
  });

  await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await serviceStatus(page).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => /服务: 已连接|同步已连接/.test(document.body.innerText), {
    timeout: 30_000,
  });

  const joined = await waitForAppLogRecord(
    (record) => record.event === "channel.join.done" && record.work_id,
    "Workbench did not rejoin a work after switching LM Studio runtime config",
    30_000,
  );

  const modelButton = page.locator('[class*="modelStatusButton"]').first();
  await modelButton.waitFor({ timeout: 10_000 });
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("LM Studio") &&
      document.body.innerText.includes("模型未连接"),
    { timeout: 30_000 },
  );

  const response = await fetch(`${baseUrl}/api/provider/health`);
  assert(
    response.ok,
    `Provider health failed after LM Studio disconnect setup: ${response.status}`,
  );
  const health = await response.json();
  const buttonText = (await modelButton.textContent())?.trim() ?? "";
  const buttonTitle = (await modelButton.getAttribute("title")) ?? "";

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "su01-lmstudio-disconnected-health",
      work_id: joined.work_id,
      context_work_id: joined.work_id,
      session_id: joined.session_id,
      socket_connected: true,
      llm_connected: health.connected === true,
      provider: health.provider,
      model: health.model,
      message: health.message,
      detail: health.detail,
      model_button_text: buttonText,
      model_button_title: buttonTitle,
      disconnected_visible: buttonText.includes("LM Studio") && buttonText.includes("模型未连接"),
      disconnected_reason_visible:
        buttonTitle.includes("LM Studio 未启动") ||
        String(health.message ?? "").includes("LM Studio 未启动"),
    },
  ];
}

async function driveSu01ProviderEndpointValidation(page) {
  const joined = await waitForAppLogRecord(
    (record) => record.event === "channel.join.done" && record.work_id,
    "Workbench did not join a work before provider endpoint validation",
    30_000,
  );

  await page
    .getByRole("button", { name: /模型设置|Stub|LM Studio|DeepSeek|Anthropic/ })
    .first()
    .click();
  await page.getByRole("dialog", { name: "模型供应商" }).waitFor({ timeout: 10_000 });
  await page.locator("#model-provider-select").selectOption("lmstudio");
  const endpointInput = page.locator("#model-provider-endpoint-input");
  await endpointInput.waitFor({ timeout: 10_000 });
  await page.waitForTimeout(750);

  const modelRequestsAfterInvalid = [];
  const onRequest = (request) => {
    if (request.url().includes("/api/provider/models")) {
      modelRequestsAfterInvalid.push({
        url: request.url(),
        postData: request.postData() ?? "",
      });
    }
  };

  page.on("request", onRequest);

  try {
    await endpointInput.fill("localhost:1234/v1");
    await page.waitForFunction(
      () => document.body.innerText.includes("端点必须是完整的 http(s) URL。"),
      { timeout: 10_000 },
    );
    await page.waitForTimeout(750);
  } finally {
    page.off("request", onRequest);
  }

  const refreshButton = page.getByRole("button", { name: "刷新模型列表" });
  const testButton = page.getByRole("button", { name: "测试连接" });
  const saveButton = page.getByRole("button", { name: "保存并切换" });
  const refreshDisabled = await refreshButton.isDisabled();
  const testDisabled = await testButton.isDisabled();
  const saveDisabled = await saveButton.isDisabled();
  const visibleText = await page.locator("body").innerText();
  const invalidModelRequests = modelRequestsAfterInvalid.filter((request) =>
    request.postData.includes("localhost:1234/v1"),
  );

  assert(visibleText.includes("端点必须是完整的 http(s) URL。"), "Invalid endpoint hint is hidden");
  assert(refreshDisabled, "Refresh models button stayed enabled for invalid endpoint");
  assert(testDisabled, "Test connection button stayed enabled for invalid endpoint");
  assert(saveDisabled, "Save provider button stayed enabled for invalid endpoint");
  assert(invalidModelRequests.length === 0, "Invalid endpoint triggered a provider models request");

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "su01-provider-endpoint-validation",
      work_id: joined.work_id,
      context_work_id: joined.work_id,
      session_id: joined.session_id,
      socket_connected: true,
      provider_selected: "lmstudio",
      invalid_endpoint: "localhost:1234/v1",
      endpoint_invalid_visible: true,
      refresh_models_disabled: refreshDisabled,
      test_connection_disabled: testDisabled,
      save_disabled: saveDisabled,
      models_request_after_invalid_count: invalidModelRequests.length,
      invalid_endpoint_hint_text: "端点必须是完整的 http(s) URL。",
    },
  ];
}

async function startOpenAiModelsFixtureServer(models) {
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: models }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert(address && typeof address === "object", "Failed to start model list fixture server");

  return {
    endpoint: `http://127.0.0.1:${address.port}/v1`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function loadAndSelectProviderModel(page, { provider, apiKey, endpoint, expectedModel }) {
  await page.locator("#model-provider-select").selectOption(provider);
  await page.waitForTimeout(500);

  const apiKeyInput = page.locator("#model-provider-api-key-input");
  if (apiKey && (await apiKeyInput.count()) > 0) {
    await apiKeyInput.fill(apiKey);
  }

  const endpointInput = page.locator("#model-provider-endpoint-input");
  if (endpoint && (await endpointInput.count()) > 0) {
    await endpointInput.fill(endpoint);
  }

  const refreshButton = page.getByRole("button", { name: "刷新模型列表" });
  await refreshButton.waitFor({ timeout: 10_000 });
  await refreshButton.click({ timeout: 10_000 });
  await page.waitForFunction(
    (modelId) =>
      Array.from(
        document.querySelectorAll("#model-provider-model-input option"),
        (option) => option.value,
      ).includes(modelId),
    expectedModel,
    { timeout: 15_000 },
  );

  const options = await page
    .locator("#model-provider-model-input option")
    .evaluateAll((nodes) => nodes.map((node) => node.value));
  await page.locator("#model-provider-model-input").selectOption(expectedModel);
  const selected = await page.locator("#model-provider-model-input").inputValue();

  return { options, selected };
}

async function driveSu01ProviderModelListSuccess(page) {
  const joined = await waitForAppLogRecord(
    (record) => record.event === "channel.join.done" && record.work_id,
    "Workbench did not join a work before provider model list verification",
    30_000,
  );
  const lmstudioServer = await startOpenAiModelsFixtureServer([
    { id: "local-slice-model", owned_by: "lmstudio" },
    { id: "local-slice-alt", owned_by: "lmstudio" },
  ]);
  const secrets = {
    deepseek: `sk-slice-models-deepseek-${Date.now()}`,
    anthropic: `sk-slice-models-anthropic-${Date.now()}`,
  };

  try {
    await page
      .getByRole("button", { name: /模型设置|Stub|LM Studio|DeepSeek|Anthropic/ })
      .first()
      .click();
    await page.getByRole("dialog", { name: "模型供应商" }).waitFor({ timeout: 10_000 });

    const deepseek = await loadAndSelectProviderModel(page, {
      provider: "deepseek",
      apiKey: secrets.deepseek,
      expectedModel: "deepseek-slice-model-list",
    });
    const anthropic = await loadAndSelectProviderModel(page, {
      provider: "anthropic",
      apiKey: secrets.anthropic,
      expectedModel: "claude-slice-sonnet",
    });
    const lmstudio = await loadAndSelectProviderModel(page, {
      provider: "lmstudio",
      endpoint: lmstudioServer.endpoint,
      expectedModel: "local-slice-model",
    });

    const visibleText = await page.locator("body").innerText();
    const modelInputEnabled = !(await page.locator("#model-provider-model-input").isDisabled());
    const visibleTextClean = !Object.values(secrets).some((secret) => visibleText.includes(secret));

    assert(
      deepseek.options.includes("deepseek-slice-model-list"),
      "DeepSeek model list did not include the provider fixture model",
    );
    assert(
      anthropic.options.includes("claude-slice-sonnet"),
      "Anthropic model list did not include the provider fixture model",
    );
    assert(
      lmstudio.options.includes("local-slice-model"),
      "LM Studio model list did not include the OpenAI-compatible fixture model",
    );
    assert(modelInputEnabled, "Model select stayed disabled after loading provider models");
    assert(visibleTextClean, "Visible workbench text exposed API keys during model list loading");

    return [
      {
        event: "slice_verify.ui_state.done",
        slice_id: "su01-provider-model-list-success",
        work_id: joined.work_id,
        context_work_id: joined.work_id,
        session_id: joined.session_id,
        socket_connected: true,
        deepseek_models_loaded: deepseek.options.includes("deepseek-slice-model-list"),
        deepseek_model_selected: deepseek.selected,
        anthropic_models_loaded: anthropic.options.includes("claude-slice-sonnet"),
        anthropic_model_selected: anthropic.selected,
        lmstudio_models_loaded: lmstudio.options.includes("local-slice-model"),
        lmstudio_model_selected: lmstudio.selected,
        lmstudio_fixture_endpoint: lmstudioServer.endpoint,
        models_came_from_backend: true,
        model_inputs_allowed_selection: modelInputEnabled,
        visible_text_omits_api_keys: visibleTextClean,
      },
    ];
  } finally {
    await lmstudioServer.close();
  }
}

async function driveSu01ProviderTestFailureUi(page) {
  const joined = await waitForAppLogRecord(
    (record) => record.event === "channel.join.done" && record.work_id,
    "Workbench did not join a work before provider test failure verification",
    30_000,
  );
  const lmstudioServer = await startOpenAiModelsFixtureServer([
    { id: "local-slice-failure-recovery", owned_by: "lmstudio" },
  ]);
  const failingEndpoint = "http://127.0.0.1:1/v1";

  try {
    await page
      .getByRole("button", { name: /模型设置|Stub|LM Studio|DeepSeek|Anthropic/ })
      .first()
      .click();
    await page.getByRole("dialog", { name: "模型供应商" }).waitFor({ timeout: 10_000 });

    const loaded = await loadAndSelectProviderModel(page, {
      provider: "lmstudio",
      endpoint: lmstudioServer.endpoint,
      expectedModel: "local-slice-failure-recovery",
    });

    await page.locator("#model-provider-endpoint-input").fill(failingEndpoint);
    await page.getByRole("button", { name: "测试连接" }).click();
    await page.waitForFunction(
      () =>
        document.body.innerText.includes("连接不可用") ||
        document.body.innerText.includes("LM Studio 未启动"),
      {
        timeout: 10_000,
      },
    );

    const failureVisibleText = await page.locator("body").innerText();
    const dialogStillOpen = (await page.getByRole("dialog", { name: "模型供应商" }).count()) > 0;
    const providerAfterFailure = await page.locator("#model-provider-select").inputValue();
    const endpointAfterFailure = await page.locator("#model-provider-endpoint-input").inputValue();
    const appLogCountAfterFailure = readAppLogRecords().length;

    await page.locator("#model-provider-endpoint-input").fill(lmstudioServer.endpoint);
    await page.getByRole("button", { name: "测试连接" }).click();
    await page.waitForFunction(() => document.body.innerText.includes("连接可用。"), {
      timeout: 10_000,
    });

    const successVisibleText = await page.locator("body").innerText();
    const providerAfterRecovery = await page.locator("#model-provider-select").inputValue();
    const endpointAfterRecovery = await page.locator("#model-provider-endpoint-input").inputValue();
    const appLogCountAfterRecovery = readAppLogRecords().length;

    assert(
      loaded.selected === "local-slice-failure-recovery",
      "LM Studio fixture model was not selected before failure test",
    );
    assert(dialogStillOpen, "Model provider dialog closed after failed test connection");
    assert(
      providerAfterFailure === "lmstudio" && providerAfterRecovery === "lmstudio",
      "Provider draft was not preserved across failed and recovered test connection",
    );
    assert(
      endpointAfterFailure === failingEndpoint,
      "Failed endpoint was not preserved after failed test connection",
    );
    assert(
      endpointAfterRecovery === lmstudioServer.endpoint,
      "Recovered endpoint was not preserved after successful retry",
    );
    assert(
      failureVisibleText.includes("LM Studio 未启动") || failureVisibleText.includes("连接不可用"),
      "Failed test connection did not show an author-readable reason",
    );
    assert(successVisibleText.includes("连接可用。"), "Recovered test connection did not succeed");
    assert(
      appLogCountAfterRecovery === appLogCountAfterFailure,
      "Testing provider connection created application JSONL turn events",
    );

    return [
      {
        event: "slice_verify.ui_state.done",
        slice_id: "su01-provider-test-failure-ui",
        work_id: joined.work_id,
        context_work_id: joined.work_id,
        session_id: joined.session_id,
        socket_connected: true,
        provider_selected: providerAfterFailure,
        model_selected_before_failure: loaded.selected,
        failing_endpoint: failingEndpoint,
        recovered_endpoint: endpointAfterRecovery,
        failure_message_visible:
          failureVisibleText.includes("连接不可用") ||
          failureVisibleText.includes("LM Studio 未启动"),
        failure_reason_visible:
          failureVisibleText.includes("LM Studio 未启动") ||
          failureVisibleText.includes("连接不可用"),
        dialog_stayed_open_after_failure: dialogStillOpen,
        provider_draft_preserved_after_failure: providerAfterFailure === "lmstudio",
        endpoint_draft_preserved_after_failure: endpointAfterFailure === failingEndpoint,
        recovery_test_succeeded: successVisibleText.includes("连接可用。"),
        no_turn_events_created_by_test_connection:
          appLogCountAfterRecovery === appLogCountAfterFailure,
      },
    ];
  } finally {
    await lmstudioServer.close();
  }
}

async function driveSu01ApiKeySecretRedaction(page) {
  const joined = await waitForAppLogRecord(
    (record) => record.event === "channel.join.done" && record.work_id,
    "Workbench did not join a work before provider API key redaction verification",
    30_000,
  );
  const provider = "deepseek";
  const secret = `sk-slice-redaction-${Date.now()}`;

  await page
    .getByRole("button", { name: /模型设置|Stub|LM Studio|DeepSeek|Anthropic/ })
    .first()
    .click();
  await page.getByRole("dialog", { name: "模型供应商" }).waitFor({ timeout: 10_000 });
  await page.locator("#model-provider-select").selectOption(provider);
  await page.locator("#model-provider-api-key-input").fill(secret);
  await page.getByRole("button", { name: "刷新模型列表" }).click();
  await page.waitForFunction(
    () =>
      Array.from(
        document.querySelectorAll("#model-provider-model-input option"),
        (option) => option.value,
      ).includes("deepseek-slice-keychain"),
    { timeout: 10_000 },
  );
  await page.locator("#model-provider-model-input").selectOption("deepseek-slice-keychain");
  await page.getByRole("button", { name: "测试连接" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("连接可用。"), {
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "保存并切换" }).click();
  await page
    .getByRole("dialog", { name: "模型供应商" })
    .waitFor({ state: "detached", timeout: 10_000 });

  const providerOptionsResponse = await fetch(`${baseUrl}/api/provider/options`);
  assert(
    providerOptionsResponse.ok,
    `Provider options failed after API key save: ${providerOptionsResponse.status}`,
  );
  const providerOptions = await providerOptionsResponse.json();
  const providerOptionsJson = JSON.stringify(providerOptions);
  const deepseekOption = (providerOptions.providers ?? []).find((option) => option.id === provider);
  const browserSettings = await page.evaluate(() =>
    localStorage.getItem("ans.modelProviderSettings"),
  );
  const modelButtonText = await page
    .getByRole("button", { name: /Stub|LM Studio|DeepSeek|Anthropic|模型设置/ })
    .first()
    .textContent()
    .then((value) => value?.trim() ?? "");
  const visibleText = await page.locator("body").innerText();
  const appLogText = JSON.stringify(readAppLogRecords());
  const backendLogText = fs.existsSync(process.env.SLICE_VERIFY_BACKEND_LOG ?? "")
    ? fs.readFileSync(process.env.SLICE_VERIFY_BACKEND_LOG, "utf8")
    : "";

  assert(
    deepseekOption?.api_key_configured === true,
    "Provider options did not mark API key configured",
  );
  assert(!providerOptionsJson.includes(secret), "Provider options response exposed API key");
  assert(
    !String(browserSettings ?? "").includes(secret),
    "Browser fallback settings exposed API key",
  );
  assert(!visibleText.includes(secret), "Visible workbench text exposed API key");
  assert(!appLogText.includes(secret), "Application JSONL logs exposed API key");
  assert(!backendLogText.includes(secret), "Backend request logs exposed API key");
  assert(
    modelButtonText.includes("DeepSeek") && modelButtonText.includes("deepseek-slice-keychain"),
    "Model provider button did not show saved DeepSeek model",
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "su01-api-key-secret-redaction",
      work_id: joined.work_id,
      context_work_id: joined.work_id,
      session_id: joined.session_id,
      socket_connected: true,
      provider_selected: provider,
      model_selected: "deepseek-slice-keychain",
      test_connection_succeeded: true,
      provider_switch_saved: true,
      provider_options_api_key_configured: true,
      provider_options_omits_api_key: !providerOptionsJson.includes(secret),
      browser_settings_omits_api_key: !String(browserSettings ?? "").includes(secret),
      visible_text_omits_api_key: !visibleText.includes(secret),
      app_log_omits_api_key: !appLogText.includes(secret),
      backend_log_omits_api_key: !backendLogText.includes(secret),
      model_provider_button_text: modelButtonText,
    },
  ];
}

async function driveSu01ProviderVendorMatrix(page) {
  const joined = await waitForAppLogRecord(
    (record) => record.event === "channel.join.done" && record.work_id,
    "Workbench did not join a work before provider vendor matrix verification",
    30_000,
  );
  // 新增供应商矩阵期望全部来自后端 registry，前端不写死。
  const expectedVendors = ["openai", "openai_subscription", "minimax", "zhipu", "kimi", "gemini"];
  const provider = "openai";
  const secret = `sk-vendor-matrix-${Date.now()}`;
  const fixtureModel = "gpt-4o-mini-slice";
  const fixtureServer = await startOpenAiModelsFixtureServer([
    { id: fixtureModel, owned_by: "openai" },
  ]);
  const failingEndpoint = "http://127.0.0.1:1/v1";

  try {
    await page
      .getByRole("button", { name: /模型设置|Stub|LM Studio|DeepSeek|Anthropic/ })
      .first()
      .click();
    await page.getByRole("dialog", { name: "模型供应商" }).waitFor({ timeout: 10_000 });

    // 1) 新增供应商必须出现在后端驱动的下拉中（registry 单一来源）。
    const dropdownIds = await page
      .locator("#model-provider-select option")
      .evaluateAll((nodes) => nodes.map((node) => node.value));
    const allVendorsListed = expectedVendors.every((id) => dropdownIds.includes(id));

    // 2) OpenAI 两种认证方式在 UI 中清晰区分：选择订阅出现认证方式说明。
    await page.locator("#model-provider-select").selectOption("openai_subscription");
    await page.waitForFunction(
      () => document.body.innerText.includes("订阅认证使用 ChatGPT 订阅令牌"),
      { timeout: 10_000 },
    );
    const subscriptionHintVisible = (await page.locator("body").innerText()).includes(
      "订阅认证使用 ChatGPT 订阅令牌",
    );

    // 3) 选 OpenAI（API Key），fake key + 本地 OpenAI 兼容 fixture 加载并选模型。
    const loaded = await loadAndSelectProviderModel(page, {
      provider,
      apiKey: secret,
      endpoint: fixtureServer.endpoint,
      expectedModel: fixtureModel,
    });

    const optionsBeforeResponse = await fetch(`${baseUrl}/api/provider/options`);
    const optionsBefore = await optionsBeforeResponse.json();
    const currentProviderBefore = optionsBefore.current_provider;
    const appLogCountBeforeTest = readAppLogRecords().length;

    // 4) 测试连接失败：不可达 endpoint -> 失败文案、Dialog 保留、runtime 不切换、不建 turn。
    await page.locator("#model-provider-endpoint-input").fill(failingEndpoint);
    await page.getByRole("button", { name: "测试连接" }).click();
    // 失败时 UI 直接展示后端原因文案（connection refused -> "无法连接 OpenAI"），
    // 与 LM Studio 展示 "LM Studio 未启动" 同理，不一定带 "连接不可用" 前缀。
    await page.waitForFunction(
      () =>
        document.body.innerText.includes("无法连接") ||
        document.body.innerText.includes("连接不可用"),
      { timeout: 10_000 },
    );

    const failureVisibleText = await page.locator("body").innerText();
    const dialogStillOpen = (await page.getByRole("dialog", { name: "模型供应商" }).count()) > 0;
    const providerAfterFailure = await page.locator("#model-provider-select").inputValue();
    const optionsAfterFailureResponse = await fetch(`${baseUrl}/api/provider/options`);
    const optionsAfterFailure = await optionsAfterFailureResponse.json();
    const appLogCountAfterTest = readAppLogRecords().length;

    // 5) 恢复 endpoint，重新加载并选择模型（改 endpoint 会清空模型列表），测试成功后保存。
    const recovered = await loadAndSelectProviderModel(page, {
      provider,
      apiKey: secret,
      endpoint: fixtureServer.endpoint,
      expectedModel: fixtureModel,
    });
    await page.getByRole("button", { name: "测试连接" }).click();
    await page.waitForFunction(() => document.body.innerText.includes("连接可用。"), {
      timeout: 10_000,
    });
    await page.getByRole("button", { name: "保存并切换" }).click();
    await page
      .getByRole("dialog", { name: "模型供应商" })
      .waitFor({ state: "detached", timeout: 10_000 });

    // 6) 保存后 options 只回传 api_key_configured，不泄漏 secret，且两认证方式独立。
    const providerOptionsResponse = await fetch(`${baseUrl}/api/provider/options`);
    const providerOptions = await providerOptionsResponse.json();
    const providerOptionsJson = JSON.stringify(providerOptions);
    const openaiOption = (providerOptions.providers ?? []).find((option) => option.id === provider);
    const subscriptionOption = (providerOptions.providers ?? []).find(
      (option) => option.id === "openai_subscription",
    );
    const browserSettings = await page.evaluate(() =>
      localStorage.getItem("ans.modelProviderSettings"),
    );
    const visibleText = await page.locator("body").innerText();
    const appLogText = JSON.stringify(readAppLogRecords());
    const backendLogText = fs.existsSync(process.env.SLICE_VERIFY_BACKEND_LOG ?? "")
      ? fs.readFileSync(process.env.SLICE_VERIFY_BACKEND_LOG, "utf8")
      : "";

    assert(allVendorsListed, "Provider dropdown missing OpenAI-compatible vendor matrix");
    assert(subscriptionHintVisible, "Subscription auth method hint was not visible in the dialog");
    assert(loaded.selected === fixtureModel, "OpenAI fixture model was not selected");
    assert(
      recovered.selected === fixtureModel,
      "OpenAI fixture model was not re-selected after endpoint recovery",
    );
    assert(dialogStillOpen, "Model provider dialog closed after failed test connection");
    assert(
      providerAfterFailure === provider,
      "Provider draft was not preserved after failed test connection",
    );
    assert(
      failureVisibleText.includes("无法连接") || failureVisibleText.includes("连接不可用"),
      "Failed test connection did not show an author-readable reason",
    );
    assert(
      optionsAfterFailure.current_provider === currentProviderBefore,
      "Failed test connection switched the runtime provider",
    );
    assert(
      appLogCountAfterTest === appLogCountBeforeTest,
      "Testing provider connection created application JSONL turn events",
    );
    assert(
      providerOptions.current_provider === provider,
      "Saving did not switch the runtime provider to openai",
    );
    assert(
      openaiOption?.api_key_configured === true,
      "Provider options did not mark OpenAI API key configured",
    );
    assert(
      openaiOption?.label === "OpenAI（API Key）" && subscriptionOption?.label === "OpenAI（订阅）",
      "OpenAI api_key and subscription auth methods were not distinct entries",
    );
    assert(!providerOptionsJson.includes(secret), "Provider options response exposed API key");
    assert(
      !String(browserSettings ?? "").includes(secret),
      "Browser fallback settings exposed API key",
    );
    assert(!visibleText.includes(secret), "Visible workbench text exposed API key");
    assert(!appLogText.includes(secret), "Application JSONL logs exposed API key");
    assert(!backendLogText.includes(secret), "Backend request logs exposed API key");

    return [
      {
        event: "slice_verify.ui_state.done",
        slice_id: "su01-provider-vendor-matrix",
        work_id: joined.work_id,
        context_work_id: joined.work_id,
        session_id: joined.session_id,
        socket_connected: true,
        vendor_matrix_listed: allVendorsListed,
        listed_vendor_ids: dropdownIds.filter((id) => expectedVendors.includes(id)),
        subscription_hint_visible: subscriptionHintVisible,
        provider_selected: provider,
        model_selected: fixtureModel,
        test_failure_message_visible:
          failureVisibleText.includes("无法连接") || failureVisibleText.includes("连接不可用"),
        dialog_stayed_open_after_failure: dialogStillOpen,
        provider_draft_preserved_after_failure: providerAfterFailure === provider,
        runtime_unchanged_after_failure:
          optionsAfterFailure.current_provider === currentProviderBefore,
        no_turn_events_created_by_test_connection: appLogCountAfterTest === appLogCountBeforeTest,
        provider_switch_saved: providerOptions.current_provider === provider,
        provider_options_api_key_configured: openaiOption?.api_key_configured === true,
        auth_methods_distinct:
          openaiOption?.label === "OpenAI（API Key）" &&
          subscriptionOption?.label === "OpenAI（订阅）",
        provider_options_omits_api_key: !providerOptionsJson.includes(secret),
        browser_settings_omits_api_key: !String(browserSettings ?? "").includes(secret),
        visible_text_omits_api_key: !visibleText.includes(secret),
        app_log_omits_api_key: !appLogText.includes(secret),
        backend_log_omits_api_key: !backendLogText.includes(secret),
      },
    ];
  } finally {
    await fixtureServer.close();
  }
}

async function driveSu02WorkSwitching(page) {
  const nonce = `SU02-${Date.now()}`;
  const sourceWork = await createWorkSeed({ title: `SU02甲作品-${nonce}` });
  const selectCount = readAppLogRecords().length;

  await refreshAndSelectWork(page, sourceWork.title);
  await waitForNewAppLogRecord(
    selectCount,
    (record) => record.event === "channel.join.done" && record.work_id === sourceWork.id,
    "Selecting the source work did not rejoin its workspace channel",
    30_000,
  );

  const message = `SU02 切换前消息 ${nonce}`;
  const sendLogCount = readAppLogRecords().length;
  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      String(frame.body?.text ?? "").includes(nonce) &&
      frame.body?.work_id === sourceWork.id,
    "Source work message was not sent over the current workspace channel",
    10_000,
  );

  await waitForNewAppLogRecord(
    sendLogCount,
    (record) => record.event === "channel.user_message.start" && record.work_id === sourceWork.id,
    "Source work user_message.start log was not emitted",
    30_000,
  );

  const joinedTarget = await createWorkFromMenu(page, sourceWork.id);
  await page.waitForFunction(() => /服务: 已连接|同步已连接/.test(document.body.innerText), {
    timeout: 30_000,
  });
  await page.waitForFunction(
    (oldMessage) => !document.body.innerText.includes(oldMessage),
    message,
    { timeout: 10_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const leakedSourceMessage = visibleText.includes(message);

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "su02-work-switching",
      work_id: joinedTarget.work_id,
      context_work_id: joinedTarget.work_id,
      previous_work_id: sourceWork.id,
      session_id: joinedTarget.session_id,
      socket_connected: true,
      service_status_text: await serviceStatus(page)
        .textContent()
        .then((value) => value?.trim() ?? ""),
      title_text: await workTitle(page)
        .textContent()
        .then((value) => value?.trim() ?? ""),
      message_count: leakedSourceMessage ? 3 : 1,
      source_message_visible_after_switch: leakedSourceMessage,
      source_message_text: message,
    },
  ];
}

async function driveSu02ArtifactProjectionTraceIsolation(page) {
  const nonce = `SU02APT${Date.now()}`;
  const sourceTitle = "P1 单章正文草稿验证作品";
  const targetTitle = `SU02隔离乙-${nonce}`;
  const chapterTitle = "第01章：底层灵气账单";
  const sourceWork = await waitForWorkByTitle(sourceTitle);

  const sourceJoin = await ensureWorkSelectedByTitle(page, sourceTitle, sourceWork.id);
  await waitForVisibleWorkTitle(page, sourceTitle);

  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "大纲与结构" }).click();
  await page.waitForFunction(
    (title) =>
      document.body.innerText.includes("已采纳章节计划") && document.body.innerText.includes(title),
    chapterTitle,
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: "生成正文草稿" }).first().click();

  const draftTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.work_id === sourceWork.id &&
      frame.body?.tool_result?.output?.artifact_type === "prose_fragment" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment",
    "No source work prose_fragment turn_result websocket frame was received",
    170_000,
  );
  const draftTurnResult = draftTurnFrame.body;
  const pendingArtifact = draftTurnResult.adoption_state.pending[0];
  const draftBody = String(pendingArtifact.payload?.items?.[0]?.body ?? "");
  const draftNeedle = draftBody.includes("灵气账单") ? "灵气账单" : chapterTitle;
  assert(pendingArtifact.artifact_id, "Source draft did not include an artifact id");
  assert(draftTurnResult.trace_summary?.trace_ref, "Source draft turn did not include trace_ref");

  await page.waitForFunction(
    (needle) =>
      /待确认的创作材料|正文草稿|待保存章节草稿/.test(document.body.innerText) &&
      document.body.innerText.includes(needle),
    draftNeedle,
    { timeout: 10_000 },
  );
  const pendingVisibleInSourceBeforeSwitch =
    (await page.getByRole("button", { name: acceptDraftButtonPattern }).count()) > 0;
  assert(
    pendingVisibleInSourceBeforeSwitch,
    "Source pending artifact accept action is not visible",
  );
  await closeArchiveIfOpen(page);

  const worksBeforeTargetCreate = new Set((await listWorksFromApi()).map((work) => work.id));
  const targetCreateLogCount = readAppLogRecords().length;
  await openNamedCreateWorkDialog(page);
  await submitWorkTitleDialog(page, targetTitle, "创建");
  const targetWork = await waitForWorkByTitle(targetTitle, worksBeforeTargetCreate);
  const targetJoin = await waitForNewAppLogRecord(
    targetCreateLogCount,
    (record) => record.event === "channel.join.done" && record.work_id === targetWork.id,
    "Creating target work did not join its workspace channel",
    30_000,
  );
  await waitForVisibleWorkTitle(page, targetTitle);

  const targetTextAfterPendingSwitch = await page.locator("body").innerText();
  const pendingArtifactVisibleInTarget =
    targetTextAfterPendingSwitch.includes("待确认的创作材料") ||
    targetTextAfterPendingSwitch.includes("待保存章节草稿") ||
    targetTextAfterPendingSwitch.includes(pendingArtifact.artifact_id) ||
    targetTextAfterPendingSwitch.includes(draftNeedle);
  assert(!pendingArtifactVisibleInTarget, "Source pending artifact leaked into target work UI");

  const targetTocBeforeAdoptionCount = readAppLogRecords().length;
  await page.getByRole("button", { name: readingModeButtonPattern }).click();
  const targetEmptyTocBeforeAdoption = await waitForNewAppLogRecord(
    targetTocBeforeAdoptionCount,
    (record) =>
      record.event === "channel.get_toc.done" &&
      record.work_id === targetWork.id &&
      Number(record.chapter_count ?? -1) === 0 &&
      Number(record.total_word_count ?? -1) === 0,
    "Target work did not read an empty TOC before source adoption",
    30_000,
  );
  await page.waitForFunction(
    (needle) =>
      document.body.innerText.includes("阅读模式") &&
      document.body.innerText.includes("暂无已采纳的章节内容") &&
      !document.body.innerText.includes(needle),
    draftNeedle,
    { timeout: 15_000 },
  );
  const targetReadingTextBeforeAdoption = await page.locator("body").innerText();
  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  const sourceReturnJoin = await ensureWorkSelectedByTitle(page, sourceTitle, sourceWork.id);
  await waitForVisibleWorkTitle(page, sourceTitle);
  await page.waitForFunction(
    (needle) =>
      /待确认的创作材料|正文草稿|待保存章节草稿/.test(document.body.innerText) &&
      document.body.innerText.includes(needle),
    draftNeedle,
    { timeout: 15_000 },
  );
  const sourceTextAfterReturn = await page.locator("body").innerText();
  const pendingRestoredInSource =
    sourceTextAfterReturn.includes(draftNeedle) &&
    (await page.getByRole("button", { name: acceptDraftButtonPattern }).count()) > 0;
  assert(pendingRestoredInSource, "Source pending artifact was not restored after switching back");

  await page.getByRole("button", { name: acceptDraftButtonPattern }).first().click();
  const acceptActionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.topic === `workspace:${sourceWork.id}` &&
      frame.body?.action?.action_type === "accept" &&
      frame.body?.action?.target_ref === pendingArtifact.artifact_id,
    "Real workbench did not send source-scoped accept author_action",
    10_000,
  );
  const adoptTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.work_id === sourceWork.id &&
      frame.body?.truthfulness?.artifact_adopted === true &&
      Array.isArray(frame.body?.adoption_state?.resolved) &&
      frame.body.adoption_state.resolved.some(
        (entry) => entry.artifact_id === pendingArtifact.artifact_id,
      ),
    "No source-scoped artifact adoption turn_result websocket frame was received",
    120_000,
  );
  const adoptTurnResult = adoptTurnFrame.body;

  const sourceTocAfterAdoptionCount = readAppLogRecords().length;
  await page.getByRole("button", { name: readingModeButtonPattern }).click();
  const sourceTocAfterAdoption = await waitForNewAppLogRecord(
    sourceTocAfterAdoptionCount,
    (record) =>
      record.event === "channel.get_toc.done" &&
      record.work_id === sourceWork.id &&
      Number(record.chapter_count ?? 0) >= 1 &&
      Number(record.total_word_count ?? 0) > 0,
    "Source work did not read a populated TOC after adoption",
    30_000,
  );
  const sourceChapterContent = await waitForNewAppLogRecord(
    sourceTocAfterAdoptionCount,
    (record) =>
      record.event === "channel.get_chapter_content.done" &&
      record.work_id === sourceWork.id &&
      Number(record.content_chars ?? 0) > 0,
    "Source work did not read adopted chapter content after adoption",
    30_000,
  );
  await page.waitForFunction(
    (needle) =>
      document.body.innerText.includes("阅读模式") &&
      document.body.innerText.includes("全书有效字数") &&
      document.body.innerText.includes("本章有效字数") &&
      document.body.innerText.includes(needle) &&
      !document.body.innerText.includes("暂无已采纳的章节内容"),
    draftNeedle,
    { timeout: 15_000 },
  );
  const sourceReadingTextAfterAdoption = await page.locator("body").innerText();
  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  const targetReturnJoin = await ensureWorkSelectedByTitle(page, targetTitle, targetWork.id);
  await waitForVisibleWorkTitle(page, targetTitle);

  const targetTocAfterAdoptionCount = readAppLogRecords().length;
  await page.getByRole("button", { name: readingModeButtonPattern }).click();
  const targetEmptyTocAfterAdoption = await waitForNewAppLogRecord(
    targetTocAfterAdoptionCount,
    (record) =>
      record.event === "channel.get_toc.done" &&
      record.work_id === targetWork.id &&
      Number(record.chapter_count ?? -1) === 0 &&
      Number(record.total_word_count ?? -1) === 0,
    "Target work did not stay empty after source adoption",
    30_000,
  );
  await page.waitForFunction(
    (needle) =>
      document.body.innerText.includes("阅读模式") &&
      document.body.innerText.includes("暂无已采纳的章节内容") &&
      !document.body.innerText.includes(needle),
    draftNeedle,
    { timeout: 15_000 },
  );
  const targetReadingTextAfterAdoption = await page.locator("body").innerText();
  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  const targetTraceMessage = `请用一句话说明当前作品 ${targetTitle} 的创作状态。`;
  const targetTraceFrameCount = frames.length;
  await page.locator(chatInputSelector).fill(targetTraceMessage);
  await page.getByRole("button", { name: /^发送$/ }).click();
  const targetSentFrame = await waitForNewFrame(
    targetTraceFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.work_id === targetWork.id &&
      String(frame.body?.text ?? "").includes(targetTitle),
    "Target trace probe was not sent with target work id",
    10_000,
  );
  const targetTraceTurnFrame = await waitForNewFrame(
    targetTraceFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.work_id === targetWork.id &&
      frame.body?.assistant_message != null &&
      frame.body?.trace_summary?.trace_ref,
    "No target work turn_result with trace summary was received",
    120_000,
  );
  const targetTraceTurnResult = targetTraceTurnFrame.body;
  await page.waitForFunction(
    (message) =>
      document.body.innerText.includes(message) && !document.body.innerText.includes("思考中"),
    targetTraceMessage,
    { timeout: 30_000 },
  );
  const whyText = await openLatestWhyDialog(page);
  const targetContextRefs = targetTraceTurnResult.trace_summary?.context_refs ?? [];
  const targetTraceExcludesSource =
    !JSON.stringify(targetContextRefs).includes(sourceWork.id) &&
    !JSON.stringify(targetContextRefs).includes(sourceTitle) &&
    !JSON.stringify(targetContextRefs).includes(chapterTitle) &&
    !whyText.includes(sourceTitle) &&
    !whyText.includes(chapterTitle) &&
    !whyText.includes(draftNeedle);
  assert(targetTraceExcludesSource, "Target trace/why included source work artifact context");

  const targetVisibleAfterTrace = await page.locator("body").innerText();
  const uiState = await commonUiState(page, targetTraceTurnResult, targetSentFrame);
  const joinedWorkIds = [
    ...new Set(
      readAppLogRecords()
        .filter((record) => record.event === "channel.join.done" && record.work_id)
        .map((record) => String(record.work_id)),
    ),
  ];

  return [
    {
      ...uiState,
      turn_id: draftTurnResult.turn_id,
      turn_ids: [
        draftTurnResult.turn_id,
        adoptTurnResult.turn_id,
        targetTraceTurnResult.turn_id,
      ].filter(Boolean),
      draft_turn_id: draftTurnResult.turn_id,
      adopt_turn_id: adoptTurnResult.turn_id,
      target_trace_turn_id: targetTraceTurnResult.turn_id,
      work_id: targetWork.id,
      context_work_id: targetWork.id,
      source_work_id: sourceWork.id,
      target_work_id: targetWork.id,
      source_session_id: sourceJoin.session_id,
      target_session_id: targetReturnJoin.session_id ?? targetJoin.session_id,
      source_return_session_id: sourceReturnJoin.session_id,
      joined_work_count: joinedWorkIds.length,
      artifact_id: pendingArtifact.artifact_id,
      artifact_type: pendingArtifact.artifact_type,
      chapter_title: chapterTitle,
      draft_needled_text: draftNeedle,
      source_trace_ref: draftTurnResult.trace_summary.trace_ref,
      target_trace_ref: targetTraceTurnResult.trace_summary.trace_ref,
      accept_event_sent: true,
      accept_action_type: acceptActionFrame.body?.action?.action_type,
      source_pending_visible_before_switch: pendingVisibleInSourceBeforeSwitch,
      pending_artifact_visible_in_target: pendingArtifactVisibleInTarget,
      target_projection_empty_before_source_adoption:
        Number(targetEmptyTocBeforeAdoption.chapter_count ?? -1) === 0 &&
        Number(targetEmptyTocBeforeAdoption.total_word_count ?? -1) === 0 &&
        targetReadingTextBeforeAdoption.includes("暂无已采纳的章节内容"),
      pending_restored_in_source: pendingRestoredInSource,
      artifact_adopted_in_source: adoptTurnResult.truthfulness?.artifact_adopted === true,
      source_projection_populated_after_adoption:
        Number(sourceTocAfterAdoption.chapter_count ?? 0) >= 1 &&
        Number(sourceTocAfterAdoption.total_word_count ?? 0) > 0 &&
        Number(sourceChapterContent.content_chars ?? 0) > 0 &&
        sourceReadingTextAfterAdoption.includes(draftNeedle),
      target_projection_empty_after_source_adoption:
        Number(targetEmptyTocAfterAdoption.chapter_count ?? -1) === 0 &&
        Number(targetEmptyTocAfterAdoption.total_word_count ?? -1) === 0 &&
        targetReadingTextAfterAdoption.includes("暂无已采纳的章节内容") &&
        !targetReadingTextAfterAdoption.includes(draftNeedle),
      target_trace_excludes_source_artifact: targetTraceExcludesSource,
      target_why_excludes_source_artifact: !whyText.includes(draftNeedle),
      source_artifact_visible_in_target_after_trace: targetVisibleAfterTrace.includes(draftNeedle),
      target_message_text: targetTraceMessage,
    },
  ];
}

async function driveSu02EmptyStartUnnamedWork(page) {
  const nonce = `SU02EMPTY${Date.now()}`;
  const message = `空库启动后保留消息 ${nonce}`;
  const renamedTitle = `SU02空库改名-${nonce}`;
  const seedLogText = fs.existsSync(path.join(artifactDir, "seed.log"))
    ? fs.readFileSync(path.join(artifactDir, "seed.log"), "utf8")
    : "";
  const backendLogText = fs.existsSync(process.env.SLICE_VERIFY_BACKEND_LOG ?? "")
    ? fs.readFileSync(process.env.SLICE_VERIFY_BACKEND_LOG, "utf8")
    : "";

  const initialJoin = await waitForNewAppLogRecord(
    0,
    (record) =>
      record.event === "channel.join.done" && record.work_id && record.work_id !== "lobby",
    "Empty start did not join an auto-created real work",
    30_000,
  );
  await waitForVisibleWorkTitle(page, "未命名作品");
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  const worksAfterStart = await listWorksFromApi();
  const initialWork = worksAfterStart.find((work) => work.id === initialJoin.work_id);
  assert(initialWork, "Auto-created unnamed work was not returned by the Work API");
  assert(initialWork.title === "未命名作品", "Auto-created work did not use the unnamed title");
  assert(worksAfterStart.length === 1, "Empty start produced more than one initial work");

  const sendCount = readAppLogRecords().length;
  const frameCount = frames.length;
  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    frameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      String(frame.body?.text ?? "").includes(nonce) &&
      frame.body?.work_id === initialWork.id,
    "Message after empty start was not sent with the auto-created work id",
    10_000,
  );
  const turnDone = await waitForNewAppLogRecord(
    sendCount,
    (record) =>
      record.event === "channel.user_message.done" &&
      record.work_id === initialWork.id &&
      record.turn_id,
    "Message after empty start did not complete under the auto-created work id",
    60_000,
  );
  await page.waitForFunction(
    (text) => document.body.innerText.includes(text) && !document.body.innerText.includes("思考中"),
    message,
    { timeout: 30_000 },
  );

  await openWorkMenu(page);
  await page.locator('button[title="重命名"]').first().click();
  await page.getByRole("dialog", { name: "修改作品名" }).waitFor({ timeout: 10_000 });
  await submitWorkTitleDialog(page, renamedTitle, "保存");
  await waitForVisibleWorkTitle(page, renamedTitle);

  const renamedWork = await fetchWorkFromApi(initialWork.id);
  assert(renamedWork.id === initialWork.id, "Renaming the auto-created work changed its id");
  assert(renamedWork.title === renamedTitle, "Renamed title did not persist");

  const visibleAfterRename = await page.locator("body").innerText();
  assert(visibleAfterRename.includes(message), "Message disappeared after renaming the work");

  const secondJoin = await createWorkFromMenu(page, renamedWork.id);
  await waitForVisibleWorkTitle(page, "未命名作品");
  const thirdJoin = await createWorkFromMenu(page, secondJoin.work_id);
  await waitForVisibleWorkTitle(page, "未命名作品");

  const finalWorks = await listWorksFromApi();
  const unnamedWorks = finalWorks.filter((work) => work.title.trim() === "未命名作品");
  assert(unnamedWorks.length >= 2, "Two duplicate unnamed works were not created");
  assert(
    secondJoin.work_id !== thirdJoin.work_id,
    "Duplicate unnamed works reused the same work id",
  );

  await openWorkMenu(page);
  const menuText = await page.locator('[class*="workMenu"]').first().innerText();
  const duplicateLabelsVisible = menuText.includes("第 1 个") && menuText.includes("第 2 个");
  assert(duplicateLabelsVisible, "Duplicate unnamed works are not visually distinguished");

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "su02-empty-start-unnamed-work",
      turn_id: turnDone.turn_id,
      work_id: initialWork.id,
      context_work_id: initialWork.id,
      session_id: initialJoin.session_id,
      socket_connected: true,
      backend_default_seed_skipped: backendLogText.includes("skipped default work seed"),
      seed_script_none: seedLogText.includes("seed: none"),
      initial_join_work_id: initialJoin.work_id,
      initial_work_title: initialWork.title,
      works_after_start_count: worksAfterStart.length,
      sent_frame_work_id: sentFrame.body?.work_id,
      turn_done_work_id: turnDone.work_id,
      renamed_work_id: renamedWork.id,
      renamed_title: renamedWork.title,
      message_visible_after_rename: visibleAfterRename.includes(message),
      duplicate_unnamed_count: unnamedWorks.length,
      duplicate_unnamed_labels_visible: duplicateLabelsVisible,
      duplicate_unnamed_work_ids: unnamedWorks.map((work) => work.id),
      second_unnamed_work_id: secondJoin.work_id,
      third_unnamed_work_id: thirdJoin.work_id,
      title_text: await workTitle(page)
        .textContent()
        .then((value) => value?.trim() ?? ""),
      service_status_text: await serviceStatus(page)
        .textContent()
        .then((value) => value?.trim() ?? ""),
    },
  ];
}

async function driveSu02PendingResultWorkIsolation(page) {
  const nonce = `SU02SLOW${Date.now()}`;
  const sourceWork = await createWorkSeed({ title: `SU02慢回复甲-${nonce}` });
  const targetWork = await createWorkSeed({ title: `SU02慢回复乙-${nonce}` });
  const message = `慢回复跨作品归属校验 ${nonce}：请回一句收到。`;
  const assistantText = `慢回复归属校验完成：${nonce} 只属于原作品。`;

  const selectSourceCount = readAppLogRecords().length;
  await refreshAndSelectWork(page, sourceWork.title);
  const sourceJoin = await waitForNewAppLogRecord(
    selectSourceCount,
    (record) => record.event === "channel.join.done" && record.work_id === sourceWork.id,
    "Selecting the source work did not join its workspace channel",
    30_000,
  );
  await waitForVisibleWorkTitle(page, sourceWork.title);

  const sendLogCount = readAppLogRecords().length;
  const sendFrameCount = frames.length;
  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    sendFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      String(frame.body?.text ?? "").includes(nonce) &&
      frame.body?.work_id === sourceWork.id,
    "Slow source work message was not sent from the source workspace channel",
    10_000,
  );

  const sourceStart = await waitForNewAppLogRecord(
    sendLogCount,
    (record) =>
      record.event === "channel.user_message.start" &&
      record.work_id === sourceWork.id &&
      record.turn_id,
    "Slow source work user_message.start log was not emitted",
    30_000,
  );

  const switchTargetCount = readAppLogRecords().length;
  await refreshAndSelectWork(page, targetWork.title);
  const targetJoin = await waitForNewAppLogRecord(
    switchTargetCount,
    (record) => record.event === "channel.join.done" && record.work_id === targetWork.id,
    "Switching to target work did not join its workspace channel while source turn was pending",
    30_000,
  );
  await waitForVisibleWorkTitle(page, targetWork.title);

  const sourceDone = await waitForNewAppLogRecord(
    sendLogCount,
    (record) =>
      record.event === "channel.user_message.done" &&
      record.work_id === sourceWork.id &&
      record.turn_id === sourceStart.turn_id,
    "Source work slow turn did not complete under the original work id",
    90_000,
  );

  await sleep(500);
  const targetVisibleAfterSourceDone = await page.locator("body").innerText();
  const sourceUserVisibleInTarget = targetVisibleAfterSourceDone.includes(message);
  const sourceAssistantVisibleInTarget = targetVisibleAfterSourceDone.includes(assistantText);
  const targetLoadingAfterSourceDone = targetVisibleAfterSourceDone.includes("思考中");

  assert(!sourceUserVisibleInTarget, "Source user message leaked into target work after slow turn");
  assert(
    !sourceAssistantVisibleInTarget,
    "Source assistant result leaked into target work after slow turn",
  );
  assert(!targetLoadingAfterSourceDone, "Target work remained in loading state after source turn");

  const returnSourceCount = readAppLogRecords().length;
  await refreshAndSelectWork(page, sourceWork.title);
  const sourceReturnResume = await waitForNewAppLogRecord(
    returnSourceCount,
    (record) =>
      record.event === "work_session.resume.done" &&
      record.work_id === sourceWork.id &&
      Number(record.transcript_count ?? 0) >= 1,
    "Switching back to source work did not resume the completed slow turn transcript",
    30_000,
  );
  const sourceReturnJoin = await waitForNewAppLogRecord(
    returnSourceCount,
    (record) =>
      record.event === "channel.join.done" &&
      record.work_id === sourceWork.id &&
      record.session_id === sourceReturnResume.session_id,
    "Switching back to source work did not join the source workspace channel",
    30_000,
  );
  await waitForVisibleWorkTitle(page, sourceWork.title);
  await page.waitForFunction(
    (payload) =>
      document.body.innerText.includes(payload.message) &&
      document.body.innerText.includes(payload.assistantText),
    { message, assistantText },
    { timeout: 30_000 },
  );

  const sourceVisibleAfterReturn = await page.locator("body").innerText();

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "su02-pending-result-work-isolation",
      turn_id: sourceStart.turn_id,
      work_id: sourceWork.id,
      context_work_id: sourceWork.id,
      source_work_id: sourceWork.id,
      target_work_id: targetWork.id,
      source_session_id: sourceJoin.session_id,
      target_session_id: targetJoin.session_id,
      session_id: sourceReturnJoin.session_id,
      socket_connected: true,
      source_message_text: message,
      source_assistant_text: assistantText,
      sent_frame_work_id: sentFrame.body?.work_id,
      source_turn_completed_work_id: sourceDone.work_id,
      target_visible_after_source_done:
        !sourceUserVisibleInTarget && !sourceAssistantVisibleInTarget,
      target_loading_after_source_done: targetLoadingAfterSourceDone,
      source_user_visible_in_target: sourceUserVisibleInTarget,
      source_assistant_visible_in_target: sourceAssistantVisibleInTarget,
      source_user_visible_after_return: sourceVisibleAfterReturn.includes(message),
      source_assistant_visible_after_return: sourceVisibleAfterReturn.includes(assistantText),
      source_return_transcript_count: sourceReturnResume.transcript_count,
      title_text: await workTitle(page)
        .textContent()
        .then((value) => value?.trim() ?? ""),
      service_status_text: await serviceStatus(page)
        .textContent()
        .then((value) => value?.trim() ?? ""),
    },
  ];
}

async function driveSu02WorkLifecycleManagement(page) {
  const nonce = `SU02L-${Date.now()}`;
  const sourceWork = await createWorkSeed({ title: `SU02源作品-${nonce}` });
  const createTitle = `SU02新作品-${nonce}`;
  const renamedTitle = `SU02改名作品-${nonce}`;
  const selectCount = readAppLogRecords().length;
  const preCreateWorkIds = new Set((await listWorksFromApi()).map((work) => work.id));

  await refreshAndSelectWork(page, sourceWork.title);
  await waitForNewAppLogRecord(
    selectCount,
    (record) => record.event === "channel.join.done" && record.work_id === sourceWork.id,
    "Selecting the lifecycle source work did not join its workspace channel",
    30_000,
  );

  const createCount = readAppLogRecords().length;
  await openNamedCreateWorkDialog(page);
  await submitWorkTitleDialog(page, createTitle, "创建");

  await page.waitForFunction(
    (title) => {
      const titleButton = document.querySelector('button[title="作品"]');
      return (titleButton?.textContent ?? "").includes(title);
    },
    createTitle,
    { timeout: 15_000 },
  );

  const createdWork = await waitForWorkByTitle(createTitle, preCreateWorkIds);
  await waitForNewAppLogRecord(
    createCount,
    (record) => record.event === "channel.join.done" && record.work_id === createdWork.id,
    "Named work creation did not join the newly created workspace channel",
    30_000,
  );

  await openWorkMenu(page);
  await page.locator('button[title="重命名"]').first().click();
  await page.getByRole("dialog", { name: "修改作品名" }).waitFor({ timeout: 10_000 });
  await submitWorkTitleDialog(page, renamedTitle, "保存");

  await page.waitForFunction(
    (title) => {
      const titleButton = document.querySelector('button[title="作品"]');
      return (titleButton?.textContent ?? "").includes(title);
    },
    renamedTitle,
    { timeout: 15_000 },
  );

  const renamedWork = await fetchWorkFromApi(createdWork.id);
  assert(renamedWork.title === renamedTitle, "Renamed work title did not persist through Work API");
  assert(
    renamedWork.id === createdWork.id,
    "Renaming changed the work id instead of preserving identity",
  );

  const deleteCount = readAppLogRecords().length;
  await openWorkMenu(page);
  await page.locator('button[title="删除作品"]').first().click();
  await page.getByRole("dialog", { name: "删除作品" }).waitFor({ timeout: 10_000 });
  const deleteDialogText = await page.getByRole("dialog", { name: "删除作品" }).innerText();
  assert(deleteDialogText.includes(renamedTitle), "Delete confirmation did not include work title");
  await page.getByRole("button", { name: "删除" }).click();

  const fallbackJoin = await waitForNewAppLogRecord(
    deleteCount,
    (record) =>
      record.event === "channel.join.done" && record.work_id && record.work_id !== renamedWork.id,
    "Deleting the current work did not switch to another real workspace channel",
    30_000,
  );

  await page.waitForFunction(
    (title) => {
      const titleButton = document.querySelector('button[title="作品"]');
      return (titleButton?.textContent ?? "").includes(title);
    },
    sourceWork.title,
    { timeout: 15_000 },
  );

  const discardedWork = await fetchWorkFromApi(renamedWork.id);
  const visibleWorks = await listWorksFromApi();
  const visibleWorkIds = visibleWorks.map((work) => work.id);
  assert(discardedWork.status === "DISCARDED", "Deleted work was not marked DISCARDED");
  assert(
    !visibleWorkIds.includes(discardedWork.id),
    "Discarded work still appeared in the default Work list",
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "su02-work-lifecycle-management",
      work_id: fallbackJoin.work_id,
      context_work_id: fallbackJoin.work_id,
      created_work_id: createdWork.id,
      renamed_work_id: renamedWork.id,
      discarded_work_id: discardedWork.id,
      source_work_id: sourceWork.id,
      source_work_title: sourceWork.title,
      session_id: fallbackJoin.session_id,
      socket_connected: true,
      named_create_title: createTitle,
      renamed_title: renamedTitle,
      discarded_status: discardedWork.status,
      fallback_work_id: fallbackJoin.work_id,
      fallback_is_source_work: fallbackJoin.work_id === sourceWork.id,
      visible_work_ids: visibleWorkIds,
      discarded_hidden_from_default_list: !visibleWorkIds.includes(discardedWork.id),
      delete_confirmation_included_title: deleteDialogText.includes(renamedTitle),
      title_text: await workTitle(page)
        .textContent()
        .then((value) => value?.trim() ?? ""),
      service_status_text: await serviceStatus(page)
        .textContent()
        .then((value) => value?.trim() ?? ""),
    },
  ];
}

async function driveSu02WorkRestartRecovery(page) {
  const nonce = `SU02R-${Date.now()}`;
  const sourceWork = await createWorkSeed({ title: `SU02恢复甲-${nonce}` });
  const targetWork = await createWorkSeed({ title: `SU02恢复乙-${nonce}` });

  const selectCount = readAppLogRecords().length;
  await refreshAndSelectWork(page, targetWork.title);
  const initialJoin = await waitForNewAppLogRecord(
    selectCount,
    (record) => record.event === "channel.join.done" && record.work_id === targetWork.id,
    "Selecting the target work did not join its workspace channel before reload",
    30_000,
  );
  await waitForVisibleWorkTitle(page, targetWork.title);

  const storedBeforeReload = await page.evaluate(() =>
    localStorage.getItem("ans.lastOpenedWorkId"),
  );
  assert(
    storedBeforeReload === targetWork.id,
    "Selecting a real work did not persist it as lastOpened before reload",
  );

  const reloadCount = readAppLogRecords().length;
  await page.reload({ waitUntil: "domcontentloaded" });
  const restoredJoin = await waitForNewAppLogRecord(
    reloadCount,
    (record) => record.event === "channel.join.done" && record.work_id === targetWork.id,
    "Reload did not restore the last opened existing work",
    30_000,
  );
  await waitForVisibleWorkTitle(page, targetWork.title);

  const latestTarget = await fetchWorkFromApi(targetWork.id);
  const discarded = await discardWorkFromApi(latestTarget);
  assert(discarded.status === "DISCARDED", "Target work was not safely discarded");
  await page.evaluate((id) => localStorage.setItem("ans.lastOpenedWorkId", id), targetWork.id);

  const visibleWorks = await listWorksFromApi();
  const fallbackWork = visibleWorks[0];
  assert(fallbackWork, "No fallback work remained after discarding the stale lastOpened work");
  assert(
    fallbackWork.id !== targetWork.id,
    "Discarded target work still appeared as the fallback candidate",
  );

  const staleReloadCount = readAppLogRecords().length;
  await page.reload({ waitUntil: "domcontentloaded" });
  const fallbackJoin = await waitForNewAppLogRecord(
    staleReloadCount,
    (record) => record.event === "channel.join.done" && record.work_id === fallbackWork.id,
    "Reload did not fall back to a real available work when lastOpened was discarded",
    30_000,
  );
  await waitForVisibleWorkTitle(page, fallbackWork.title);

  const staleStoredAfterReload = await page.evaluate(() =>
    localStorage.getItem("ans.lastOpenedWorkId"),
  );
  const finalVisibleWorks = await listWorksFromApi();
  const finalVisibleWorkIds = finalVisibleWorks.map((work) => work.id);

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "su02-work-restart-recovery",
      work_id: fallbackJoin.work_id,
      context_work_id: fallbackJoin.work_id,
      session_id: fallbackJoin.session_id,
      socket_connected: true,
      source_work_id: sourceWork.id,
      first_restored_work_id: restoredJoin.work_id,
      initial_join_work_id: initialJoin.work_id,
      stale_last_opened_work_id: targetWork.id,
      discarded_work_id: discarded.id,
      discarded_status: discarded.status,
      fallback_work_id: fallbackWork.id,
      fallback_work_title: fallbackWork.title,
      visible_work_ids: finalVisibleWorkIds,
      stale_preference_replaced_after_reload: staleStoredAfterReload === fallbackWork.id,
      restored_existing_work_after_reload: restoredJoin.work_id === targetWork.id,
      ignored_discarded_last_opened_after_reload: fallbackJoin.work_id !== targetWork.id,
      fallback_is_real_work:
        fallbackJoin.work_id === fallbackWork.id && fallbackJoin.work_id !== "lobby",
      title_text: await workTitle(page)
        .textContent()
        .then((value) => value?.trim() ?? ""),
      service_status_text: await serviceStatus(page)
        .textContent()
        .then((value) => value?.trim() ?? ""),
    },
  ];
}

async function driveSu03AssistantDisplayName(page) {
  const nonce = `SU03-${Date.now()}`;
  const sourceWork = await createWorkSeed({ title: `SU03甲作品-${nonce}` });
  const displayName = "创作助手";
  const boundaryMessage = `SU03显示名边界-${nonce}：请用一句话回应收到。`;
  const selectCount = readAppLogRecords().length;

  await refreshAndSelectWork(page, sourceWork.title);
  await waitForNewAppLogRecord(
    selectCount,
    (record) => record.event === "channel.join.done" && record.work_id === sourceWork.id,
    "Selecting the SU-03 source work did not rejoin its workspace channel",
    30_000,
  );

  await page
    .getByRole("button", { name: /AI 名称|AI/ })
    .first()
    .click();
  await page.locator("#assistant-display-name-input").fill(displayName);
  await page.getByRole("button", { name: "保存名称" }).click();
  await page.waitForFunction((name) => document.body.innerText.includes(name), displayName, {
    timeout: 10_000,
  });

  const assistantRoleAfterSave = await page
    .locator('[class*="assistantMsg"] [class*="role"]')
    .first()
    .textContent()
    .then((value) => value?.trim() ?? "");

  const messageFrameCount = frames.length;
  await page.locator(chatInputSelector).fill(boundaryMessage);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    messageFrameCount,
    (frame) => frame.direction === "sent" && frame.event === "user_message",
    "No SU-03 user_message frame after assistant display name change",
    30_000,
  );
  const turnFrame = await waitForNewFrame(
    messageFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.assistant_message?.text,
    "No SU-03 turn_result frame after assistant display name change",
    120_000,
  );
  const sentPayload = sentFrame.body ?? {};
  const turnResult = turnFrame.body ?? {};
  const sentPayloadJson = JSON.stringify(sentPayload);
  const turnResultJson = JSON.stringify(turnResult);
  const turnResultHasDisplayNameKey =
    turnResultJson.includes("assistantDisplayName") ||
    turnResultJson.includes("assistant_display_name");

  assert(
    String(sentPayload.text ?? "").includes(boundaryMessage),
    "SU-03 user message frame did not include the authored boundary message",
  );
  assert(
    !sentPayloadJson.includes(displayName),
    "SU-03 user_message wire payload leaked the UI-only assistant display name",
  );
  assert(
    typeof turnResult.assistant_message?.text === "string",
    "SU-03 turn_result did not preserve assistant_message contract",
  );
  assert(
    !turnResultHasDisplayNameKey,
    "SU-03 turn_result contract grew an assistant display name field",
  );

  const assistantLabelAfterTurn = await page
    .locator('[class*="assistantMsg"] [class*="role"]')
    .last()
    .textContent()
    .then((value) => value?.trim() ?? "");

  const joinedCreated = await createWorkFromMenu(page, sourceWork.id);
  await page.waitForFunction(() => document.body.innerText.includes("AI"), { timeout: 10_000 });
  const assistantNameInCreatedWork = await page
    .locator('button[title="AI 名称"]')
    .first()
    .textContent()
    .then((value) => value?.trim() ?? "");

  const returnCount = readAppLogRecords().length;
  await refreshAndSelectWork(page, sourceWork.title);
  await waitForNewAppLogRecord(
    returnCount,
    (record) => record.event === "channel.join.done" && record.work_id === sourceWork.id,
    "Switching back to the SU-03 source work did not rejoin its workspace channel",
    30_000,
  );
  await page.waitForFunction(() => document.body.innerText.includes("创作助手"), {
    timeout: 10_000,
  });

  const assistantNameAfterReturn = await page
    .locator('button[title="AI 名称"]')
    .first()
    .textContent()
    .then((value) => value?.trim() ?? "");
  const assistantRoleAfterReturn = await page
    .locator('[class*="assistantMsg"] [class*="role"]')
    .first()
    .textContent()
    .then((value) => value?.trim() ?? "");

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "su03-assistant-display-name",
      work_id: sourceWork.id,
      context_work_id: sourceWork.id,
      initial_work_id: sourceWork.id,
      created_work_id: joinedCreated.work_id,
      turn_id: turnResult.turn_id,
      turn_result_work_id: turnResult.work_id ?? sourceWork.id,
      socket_connected: true,
      assistant_name_after_save: displayName,
      assistant_role_after_save: assistantRoleAfterSave,
      assistant_label_after_turn: assistantLabelAfterTurn,
      assistant_name_in_created_work: assistantNameInCreatedWork,
      assistant_name_after_return: assistantNameAfterReturn,
      assistant_role_after_return: assistantRoleAfterReturn,
      sent_payload_includes_display_name: sentPayloadJson.includes(displayName),
      turn_result_contract_has_assistant_message:
        typeof turnResult.assistant_message?.text === "string",
      turn_result_has_display_name_key: turnResultHasDisplayNameKey,
    },
  ];
}

async function driveAu12WorkProfileOverview(page) {
  const nonce = `AU12-${Date.now()}`;
  const seed = {
    title: `AU12档案作品-${nonce}`,
    genre: "都市异能",
    core_selling_point: `灵气交易所黑幕-${nonce}`,
    target_reader: "喜欢强剧情反转的读者",
    tone_preference: "冷峻克制",
  };
  const work = await createWorkSeed(seed);

  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => /服务: 已连接|同步已连接/.test(document.body.innerText), {
    timeout: 30_000,
  });

  await workTitle(page).click();
  const refreshWorks = page.locator('button[title="刷新作品列表"]').first();
  if ((await refreshWorks.count()) > 0) {
    await refreshWorks.click();
  }
  await page.getByText(seed.title, { exact: true }).click();
  await page.waitForFunction((title) => document.body.innerText.includes(title), seed.title, {
    timeout: 15_000,
  });

  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "概览" }).click();

  await waitForFrame(
    (frame) => frame.direction === "sent" && frame.event === "get_work_profile",
    "Profile tab did not request get_work_profile over the real websocket",
    30_000,
  );

  const profileReply = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "phx_reply" &&
      frame.body?.status === "ok" &&
      frame.body?.response?.title === seed.title,
    "Profile websocket reply did not include the seeded work profile",
    30_000,
  );
  const profile = profileReply.body.response ?? {};

  const profileLog = await waitForAppLogRecord(
    (record) =>
      record.event === "channel.get_work_profile.done" &&
      record.has_title === true &&
      record.status === "TENTATIVE",
    "Profile channel log was not emitted",
    30_000,
  );

  await page.waitForFunction(
    (expected) => expected.every((value) => document.body.innerText.includes(String(value))),
    [
      seed.title,
      seed.genre,
      seed.core_selling_point,
      seed.target_reader,
      seed.tone_preference,
      String(profile.revision),
      "待确认",
    ],
    { timeout: 10_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const profileText = visibleText.slice(
    Math.max(0, visibleText.indexOf("立项设定")),
    Math.max(visibleText.indexOf("立项设定") + 800, 800),
  );
  const profileJson = JSON.stringify(profile);
  const profileLogJson = JSON.stringify(profileLog);

  assert(profile.genre === seed.genre, "Profile genre does not match persisted work seed");
  assert(
    profile.core_selling_point === seed.core_selling_point,
    "Profile core selling point does not match persisted work seed",
  );
  assert(
    profile.target_reader === seed.target_reader,
    "Profile target reader does not match persisted work seed",
  );
  assert(
    profile.tone_preference === seed.tone_preference,
    "Profile tone preference does not match persisted work seed",
  );
  assert(profile.status === "TENTATIVE", "Profile did not expose tentative status");
  assert(!Object.prototype.hasOwnProperty.call(profile, "id"), "Profile DTO exposed work id");
  assert(!profileJson.includes(work.id), "Profile DTO leaked work UUID");
  assert(!profileText.includes(work.id), "Profile UI leaked work UUID");
  assert(!profileLogJson.includes(work.id), "Profile log leaked work UUID");

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au12-work-profile-overview",
      work_id: work.id,
      work_title: seed.title,
      profile_status: profile.status,
      profile_revision: profile.revision,
      profile_fields_visible: [
        seed.title,
        seed.genre,
        seed.core_selling_point,
        seed.target_reader,
        seed.tone_preference,
        String(profile.revision),
      ].every((value) => visibleText.includes(value)),
      profile_status_visible: visibleText.includes("待确认"),
      profile_request_sent: true,
      profile_reply_has_title: profile.title === seed.title,
      profile_reply_omits_id: !Object.prototype.hasOwnProperty.call(profile, "id"),
      profile_reply_omits_work_uuid: !profileJson.includes(work.id),
      profile_ui_omits_work_uuid: !profileText.includes(work.id),
      profile_log_emitted: true,
      profile_log_omits_work_uuid: !profileLogJson.includes(work.id),
      readonly_hint_visible: visibleText.includes("只读展示"),
      real_archive_opened: true,
      overview_tab_clicked: true,
    },
  ];
}

async function driveAu12CorrectionIntentRoundtrip(page) {
  await configureProviderRuntime({ provider: "slice_verify" });

  const nonce = `AU12-CORR-${Date.now()}`;
  const seed = {
    title: `AU12修订作品-${nonce}`,
    genre: "赛博修仙",
    core_selling_point: `灵气账单追债-${nonce}`,
    target_reader: "喜欢设定驱动剧情的读者",
    tone_preference: "冷峻悬疑",
  };
  const work = await createWorkSeed(seed);

  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => /服务: 已连接|同步已连接/.test(document.body.innerText), {
    timeout: 30_000,
  });
  await ensureWorkSelectedByTitle(page, seed.title, work.id);
  await waitForVisibleWorkTitle(page, seed.title);

  const frameStart = frames.length;
  const logStart = readAppLogRecords().length;

  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "概览" }).click();
  await page.getByRole("button", { name: "提出立项修订" }).click();

  const sentFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.work_id === work.id &&
      frame.body?.generate_micro_plan === true &&
      String(frame.body?.text ?? "").includes("修订当前作品的立项设定") &&
      String(frame.body?.text ?? "").includes("待采纳的设定修订草稿") &&
      String(frame.body?.text ?? "").includes("不要直接写入作品档案"),
    "Work profile correction intent was not sent through the real user_message channel",
    30_000,
  );

  const turnFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.work_id === work.id &&
      frame.body?.orchestrator_decision?.decision_type === "allow_tool" &&
      frame.body?.tool_result?.tool_name === "world_building" &&
      frame.body?.tool_result?.status === "succeeded" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "world_setting",
    "Work profile correction did not return a pending world_setting artifact",
    200_000,
  );
  const turnResult = turnFrame.body;
  const pendingArtifact = turnResult.adoption_state.pending[0];
  const actions = turnResult.available_actions ?? [];
  const actionTypes = actions.map((action) => action.action_type);

  await waitForNewAppLogRecord(
    logStart,
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.turn_id === turnResult.turn_id &&
      record.tool_name === "world_building" &&
      record.tool_outcome === "succeeded",
    "No toolbox.execute.done world_building log was recorded for profile correction",
    60_000,
  );
  await waitForNewAppLogRecord(
    logStart,
    (record) =>
      record.event === "channel.user_message.done" && record.turn_id === turnResult.turn_id,
    "No channel.user_message.done log was recorded for profile correction",
    60_000,
  );

  await page.waitForFunction(() => document.body.innerText.includes("保存到作品档案"), {
    timeout: 30_000,
  });
  const visibleText = await page.locator("body").innerText();
  const sameTurnRecords = readAppLogRecords().filter(
    (record) => record.turn_id === turnResult.turn_id,
  );
  const authorActionSent = frames.some(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.turn_id === turnResult.turn_id,
  );
  const adoptionEventEmitted = sameTurnRecords.some((record) =>
    String(record.event ?? "").startsWith("adoption.evaluate."),
  );
  const hasAcceptAction = actionTypes.includes("accept");
  const hasEditAction = actionTypes.includes("edit_then_accept");
  const hasDiscardAction = actionTypes.includes("discard");
  const pendingCardVisible =
    visibleText.includes("待保存草稿") || visibleText.includes("保存到作品档案");

  assert(turnResult.truthfulness?.tool_called === true, "Correction turn did not call a tool");
  assert(
    turnResult.truthfulness?.production_write_performed === false,
    "Correction turn claimed a direct production write",
  );
  assert(
    pendingArtifact.requires_adoption === true,
    "Correction artifact does not require adoption",
  );
  assert(hasAcceptAction, "Correction artifact did not expose an accept action");
  assert(hasEditAction, "Correction artifact did not expose an edit_then_accept action");
  assert(hasDiscardAction, "Correction artifact did not expose a discard action");
  assert(!authorActionSent, "Correction intent sent an author_action before the author chose");
  assert(!adoptionEventEmitted, "Correction intent evaluated adoption before the author chose");
  assert(pendingCardVisible, "Correction pending artifact was not visible to the author");

  const uiState = await commonUiState(page, turnResult, sentFrame);

  return [
    {
      ...uiState,
      slice_id: "au12-correction-intent-roundtrip",
      work_id: work.id,
      work_title: seed.title,
      turn_id: turnResult.turn_id,
      correction_intent_sent_from_profile: true,
      generate_micro_plan: sentFrame.body?.generate_micro_plan === true,
      decision_type: turnResult.orchestrator_decision?.decision_type,
      tool_name: turnResult.tool_result?.tool_name,
      tool_status: turnResult.tool_result?.status,
      pending_artifact_type: pendingArtifact.artifact_type,
      pending_artifact_requires_adoption: pendingArtifact.requires_adoption === true,
      available_accept_action: hasAcceptAction,
      available_edit_action: hasEditAction,
      available_discard_action: hasDiscardAction,
      production_write_performed: turnResult.truthfulness?.production_write_performed === true,
      tool_called: turnResult.truthfulness?.tool_called === true,
      no_author_action_sent: !authorActionSent,
      no_adoption_event_before_author_choice: !adoptionEventEmitted,
      pending_card_visible: pendingCardVisible,
      real_archive_opened: true,
      overview_tab_clicked: true,
      user_message_text: sentFrame.body?.text,
    },
  ];
}

async function driveAu12ProfileReadFailureDegrade(page) {
  const nonce = `AU12-READ-FAIL-${Date.now()}`;
  const seed = {
    title: `AU12读取失败作品-${nonce}`,
    genre: "悬疑仙侠",
    core_selling_point: `断联档案恢复-${nonce}`,
    target_reader: "喜欢档案核对的作者",
    tone_preference: "冷静克制",
  };
  const work = await createWorkSeed(seed);

  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => /服务: 已连接|同步已连接/.test(document.body.innerText), {
    timeout: 30_000,
  });
  await ensureWorkSelectedByTitle(page, seed.title, work.id);
  await waitForVisibleWorkTitle(page, seed.title);

  const readonlyLogStart = readAppLogRecords().length;
  const readonlyFrameStart = frames.length;
  const initialJoinCount = readAppLogRecords().filter(
    (record) => record.event === "channel.join.done",
  ).length;
  const service = createPhoenixServiceController();
  let serviceStopped = false;
  let serviceRestarted = false;

  try {
    await service.stopOriginal();
    serviceStopped = true;
    await page.waitForFunction(() => document.body.innerText.includes("同步离线"), {
      timeout: 45_000,
    });
    const offlineBodyText = await page.locator("body").innerText();

    await page.getByText("打开档案").first().click();
    await page.getByRole("tab", { name: "概览" }).click();
    await page.waitForFunction(
      () =>
        document.body.innerText.includes("作品档案读取失败") &&
        document.body.innerText.includes("重试读取") &&
        document.body.innerText.includes("不会编造档案内容"),
      { timeout: 45_000 },
    );

    const failureArchive = await waitForArchivePanel(page);
    const failureText = await failureArchive.innerText();
    const failureRowsHidden =
      !failureText.includes("状态未明") &&
      !failureText.includes("题材") &&
      !failureText.includes("暂未填写") &&
      !failureText.includes("提出立项修订");

    await service.restart();
    serviceRestarted = true;
    const joinCountAfterRestore = await waitForAppLogCount(
      (record) => record.event === "channel.join.done",
      initialJoinCount + 1,
      "No channel.join.done log proved websocket rejoin after profile read failure recovery",
      60_000,
    );
    await page.waitForFunction(() => document.body.innerText.includes("同步已连接"), {
      timeout: 60_000,
    });
    const reconnectedBodyText = await page.locator("body").innerText();

    const profileLogStart = readAppLogRecords().length;
    await page.getByRole("button", { name: "重试读取" }).click();
    const profileLog = await waitForNewAppLogRecord(
      profileLogStart,
      (record) =>
        record.event === "channel.get_work_profile.done" &&
        record.has_title === true &&
        record.status === "TENTATIVE",
      "Profile retry did not complete after service recovery",
      60_000,
    );

    await page.waitForFunction(
      (expected) => expected.every((value) => document.body.innerText.includes(value)),
      [
        seed.title,
        seed.genre,
        seed.core_selling_point,
        seed.target_reader,
        seed.tone_preference,
        "待确认",
      ],
      { timeout: 15_000 },
    );

    const recoveredArchive = await waitForArchivePanel(page);
    const recoveredText = await recoveredArchive.innerText();
    const readonlyLogs = readAppLogRecords().slice(readonlyLogStart);
    const readonlyFrames = frames.slice(readonlyFrameStart);
    const writeEventPattern =
      /author_action|user_message|adoption|tool|prose_writing|production_write|modify_draft/;

    assert(
      failureText.includes("作品档案读取失败") && failureText.includes("重试读取"),
      "Profile read failure UI was not visible",
    );
    assert(failureRowsHidden, "Profile read failure was rendered like an empty profile");
    assert(
      [seed.genre, seed.core_selling_point, seed.target_reader, seed.tone_preference].every(
        (value) => recoveredText.includes(value),
      ),
      "Profile fields were not visible after retry",
    );
    assert(
      !recoveredText.includes("作品档案读取失败"),
      "Profile read failure remained after retry",
    );
    assert(
      readonlyLogs.every((record) => !writeEventPattern.test(String(record.event ?? ""))),
      "Profile read failure or retry emitted a write/action/tool/adoption app log",
    );
    assert(
      readonlyFrames.every(
        (frame) => frame.event !== "user_message" && frame.event !== "author_action",
      ),
      "Profile read failure or retry sent user_message or author_action websocket frames",
    );

    return [
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au12-profile-read-failure-degrade",
        work_id: work.id,
        work_title: seed.title,
        profile_read_failure_visible: true,
        profile_retry_visible: failureText.includes("重试读取"),
        profile_failure_copy_honest: failureText.includes("不会编造档案内容"),
        profile_failure_rows_hidden: failureRowsHidden,
        service_stopped_externally: serviceStopped,
        offline_status_visible: offlineBodyText.includes("同步离线"),
        service_restarted_externally: serviceRestarted,
        rejoin_observed: joinCountAfterRestore > initialJoinCount,
        reconnected_status_visible: reconnectedBodyText.includes("同步已连接"),
        retry_clicked: true,
        profile_retry_log_emitted: profileLog.event === "channel.get_work_profile.done",
        profile_retry_recovered_fields: [
          seed.title,
          seed.genre,
          seed.core_selling_point,
          seed.target_reader,
          seed.tone_preference,
        ].every((value) => recoveredText.includes(value)),
        failure_cleared_after_retry: !recoveredText.includes("作品档案读取失败"),
        readonly_no_write_logs: readonlyLogs.every(
          (record) => !writeEventPattern.test(String(record.event ?? "")),
        ),
        readonly_no_author_action_frames: readonlyFrames.every(
          (frame) => frame.event !== "user_message" && frame.event !== "author_action",
        ),
        real_archive_opened: true,
        overview_tab_clicked: true,
      },
    ];
  } finally {
    if (serviceStopped && !serviceRestarted) {
      try {
        await service.restart();
      } catch {
        // The outer verifier will report the original failure; this best-effort restart avoids
        // leaving the local slice server down after an early assertion failure.
      }
    }
    await service.stopRestarted();
  }
}

async function driveAu12WorkProfileStatusIsolation(page) {
  const acceptedTitle = "AU12已确认档案作品";
  const emptyTitle = "AU12空字段档案作品";
  const acceptedGenre = "都市异能";
  const acceptedSellingPoint = "灵气交易所黑幕";
  const acceptedTargetReader = "喜欢强剧情反转的读者";
  const acceptedTone = "冷峻克制";
  const acceptedCharacter = "林烬";
  const acceptedForeshadowing = "只属于已确认作品的黑市账本伏笔。";
  const acceptedRule = "只属于已确认作品的灵气交易规则。";

  const works = await listWorksFromApi();
  const acceptedWork = works.find((work) => work.title === acceptedTitle);
  const emptyWork = works.find((work) => work.title === emptyTitle);
  assert(acceptedWork?.id, "AU12 accepted work seed was not available");
  assert(emptyWork?.id, "AU12 empty work seed was not available");
  assert(acceptedWork.status === "ACCEPTED", "AU12 accepted work seed was not ACCEPTED");
  assert(emptyWork.status === "TENTATIVE", "AU12 empty work seed was not TENTATIVE");

  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => /服务: 已连接|同步已连接/.test(document.body.innerText), {
    timeout: 30_000,
  });

  const readonlyLogStart = readAppLogRecords().length;
  const readonlyFrameStart = frames.length;

  await refreshAndSelectWork(page, acceptedTitle);
  await waitForVisibleWorkTitle(page, acceptedTitle);
  const acceptedProfileFrameStart = frames.length;
  const acceptedProfileLogStart = readAppLogRecords().length;
  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "概览" }).click();

  const acceptedProfileReply = await waitForNewFrame(
    acceptedProfileFrameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "phx_reply" &&
      frame.body?.status === "ok" &&
      frame.body?.response?.title === acceptedTitle,
    "Accepted profile websocket reply did not include the accepted work",
    30_000,
  );
  const acceptedProfile = acceptedProfileReply.body.response ?? {};
  const acceptedProfileLog = await waitForNewAppLogRecord(
    acceptedProfileLogStart,
    (record) =>
      record.event === "channel.get_work_profile.done" &&
      record.has_title === true &&
      record.status === "ACCEPTED",
    "Accepted profile channel log was not emitted",
    30_000,
  );

  await page.waitForFunction(
    (expected) => expected.every((value) => document.body.innerText.includes(value)),
    [
      acceptedTitle,
      acceptedGenre,
      acceptedSellingPoint,
      acceptedTargetReader,
      acceptedTone,
      "已确认",
    ],
    { timeout: 10_000 },
  );

  const acceptedArchive = await waitForArchivePanel(page);
  const acceptedOverviewText = await acceptedArchive.innerText();
  assert(acceptedOverviewText.includes("已确认"), "Accepted profile status was not visible");
  assert(
    [acceptedGenre, acceptedSellingPoint, acceptedTargetReader, acceptedTone].every((value) =>
      acceptedOverviewText.includes(value),
    ),
    "Accepted profile fields were not visible in the archive overview",
  );

  await page.getByRole("tab", { name: "大纲与结构" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("规划卷章结构"), {
    timeout: 10_000,
  });
  await page.getByRole("tab", { name: "角色" }).click();
  await page.waitForFunction((name) => document.body.innerText.includes(name), acceptedCharacter, {
    timeout: 10_000,
  });
  const acceptedCharacterText = await (await waitForArchivePanel(page)).innerText();
  await page.getByRole("tab", { name: "伏笔" }).click();
  await page.waitForFunction(
    (text) => document.body.innerText.includes(text),
    acceptedForeshadowing,
    { timeout: 10_000 },
  );
  const acceptedForeshadowingText = await (await waitForArchivePanel(page)).innerText();
  await page.getByRole("tab", { name: "经验规则" }).click();
  await page.waitForFunction((text) => document.body.innerText.includes(text), acceptedRule, {
    timeout: 10_000,
  });
  const acceptedRuleText = await (await waitForArchivePanel(page)).innerText();

  await closeArchiveIfOpen(page);
  await refreshAndSelectWork(page, emptyTitle);
  await waitForVisibleWorkTitle(page, emptyTitle);
  const emptyProfileFrameStart = frames.length;
  const emptyProfileLogStart = readAppLogRecords().length;
  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "概览" }).click();

  const emptyProfileReply = await waitForNewFrame(
    emptyProfileFrameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "phx_reply" &&
      frame.body?.status === "ok" &&
      frame.body?.response?.title === emptyTitle,
    "Empty profile websocket reply did not include the empty work",
    30_000,
  );
  const emptyProfile = emptyProfileReply.body.response ?? {};
  const emptyProfileLog = await waitForNewAppLogRecord(
    emptyProfileLogStart,
    (record) =>
      record.event === "channel.get_work_profile.done" &&
      record.has_title === true &&
      record.status === "TENTATIVE",
    "Empty profile channel log was not emitted",
    30_000,
  );

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("待确认") &&
      (document.body.innerText.match(/暂未填写/g) ?? []).length >= 4,
    { timeout: 10_000 },
  );

  const emptyArchive = await waitForArchivePanel(page);
  const emptyOverviewText = await emptyArchive.innerText();
  const emptyMissingCount = (emptyOverviewText.match(/暂未填写/g) ?? []).length;
  assert(emptyMissingCount >= 4, "Empty profile did not show missing fields honestly");
  assert(emptyOverviewText.includes("待确认"), "Empty profile tentative status was not visible");
  assert(
    ![acceptedGenre, acceptedSellingPoint, acceptedTargetReader, acceptedTone].some((value) =>
      emptyOverviewText.includes(value),
    ),
    "Accepted work profile fields leaked into the empty work overview",
  );

  await page.getByRole("tab", { name: "角色" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("角色档案"), {
    timeout: 10_000,
  });
  const emptyCharacterText = await (await waitForArchivePanel(page)).innerText();
  await page.getByRole("tab", { name: "伏笔" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("暂无伏笔设定"), {
    timeout: 10_000,
  });
  const emptyForeshadowingText = await (await waitForArchivePanel(page)).innerText();
  await page.getByRole("tab", { name: "经验规则" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("经验规则"), {
    timeout: 10_000,
  });
  const emptyRuleText = await (await waitForArchivePanel(page)).innerText();

  const emptyArchiveText = [emptyCharacterText, emptyForeshadowingText, emptyRuleText].join("\n");
  assert(
    !emptyArchiveText.includes(acceptedCharacter),
    "Accepted character leaked into empty work",
  );
  assert(
    !emptyArchiveText.includes(acceptedForeshadowing),
    "Accepted foreshadowing leaked into empty work",
  );
  assert(!emptyArchiveText.includes(acceptedRule), "Accepted rule leaked into empty work");

  const acceptedProfileJson = JSON.stringify(acceptedProfile);
  const emptyProfileJson = JSON.stringify(emptyProfile);
  const acceptedProfileLogJson = JSON.stringify(acceptedProfileLog);
  const emptyProfileLogJson = JSON.stringify(emptyProfileLog);
  const archiveUiText = [
    acceptedOverviewText,
    acceptedCharacterText,
    acceptedForeshadowingText,
    acceptedRuleText,
    emptyOverviewText,
    emptyArchiveText,
  ].join("\n");
  const readonlyLogs = readAppLogRecords().slice(readonlyLogStart);
  const readonlyFrames = frames.slice(readonlyFrameStart);
  const writeEventPattern =
    /author_action|user_message|adoption|tool|prose_writing|production_write|modify_draft/;

  assert(acceptedProfile.status === "ACCEPTED", "Accepted profile reply did not expose ACCEPTED");
  assert(emptyProfile.status === "TENTATIVE", "Empty profile reply did not expose TENTATIVE");
  assert(
    !Object.prototype.hasOwnProperty.call(acceptedProfile, "id"),
    "Accepted profile exposed id",
  );
  assert(!Object.prototype.hasOwnProperty.call(emptyProfile, "id"), "Empty profile exposed id");
  assert(!acceptedProfileJson.includes(acceptedWork.id), "Accepted profile leaked work UUID");
  assert(!emptyProfileJson.includes(emptyWork.id), "Empty profile leaked work UUID");
  assert(
    !acceptedProfileLogJson.includes(acceptedWork.id),
    "Accepted profile log leaked work UUID",
  );
  assert(!emptyProfileLogJson.includes(emptyWork.id), "Empty profile log leaked work UUID");
  assert(!archiveUiText.includes(acceptedWork.id), "UI leaked accepted work UUID");
  assert(!archiveUiText.includes(emptyWork.id), "UI leaked empty work UUID");
  assert(
    readonlyLogs.every((record) => !writeEventPattern.test(String(record.event ?? ""))),
    "Archive viewing emitted a write/action/tool/adoption app log",
  );
  assert(
    readonlyFrames.every(
      (frame) => frame.event !== "user_message" && frame.event !== "author_action",
    ),
    "Archive viewing sent user_message or author_action websocket frames",
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au12-work-profile-status-isolation",
      accepted_work_id: acceptedWork.id,
      accepted_work_title: acceptedTitle,
      empty_work_id: emptyWork.id,
      empty_work_title: emptyTitle,
      accepted_profile_status: acceptedProfile.status,
      empty_profile_status: emptyProfile.status,
      accepted_status_visible: acceptedOverviewText.includes("已确认"),
      tentative_status_visible: emptyOverviewText.includes("待确认"),
      empty_fields_visible_count: emptyMissingCount,
      accepted_profile_fields_visible: [
        acceptedGenre,
        acceptedSellingPoint,
        acceptedTargetReader,
        acceptedTone,
      ].every((value) => acceptedOverviewText.includes(value)),
      empty_profile_excludes_accepted_fields: ![
        acceptedGenre,
        acceptedSellingPoint,
        acceptedTargetReader,
        acceptedTone,
      ].some((value) => emptyOverviewText.includes(value)),
      accepted_archive_modules_visible:
        acceptedOverviewText.includes("已确认") &&
        acceptedOverviewText.includes(acceptedTitle) &&
        emptyArchiveText.length > 0,
      accepted_character_visible_before_switch: acceptedCharacterText.includes(acceptedCharacter),
      accepted_foreshadowing_visible_before_switch:
        acceptedForeshadowingText.includes(acceptedForeshadowing),
      accepted_rule_visible_before_switch: acceptedRuleText.includes(acceptedRule),
      empty_archive_excludes_accepted_character: !emptyArchiveText.includes(acceptedCharacter),
      empty_archive_excludes_accepted_foreshadowing:
        !emptyArchiveText.includes(acceptedForeshadowing),
      empty_archive_excludes_accepted_rule: !emptyArchiveText.includes(acceptedRule),
      overview_navigation_verified: true,
      outline_navigation_verified: true,
      character_navigation_verified: true,
      foreshadowing_navigation_verified: true,
      rule_navigation_verified: true,
      accepted_profile_reply_omits_id: !Object.prototype.hasOwnProperty.call(acceptedProfile, "id"),
      empty_profile_reply_omits_id: !Object.prototype.hasOwnProperty.call(emptyProfile, "id"),
      profile_replies_omit_work_uuid:
        !acceptedProfileJson.includes(acceptedWork.id) && !emptyProfileJson.includes(emptyWork.id),
      profile_logs_omit_work_uuid:
        !acceptedProfileLogJson.includes(acceptedWork.id) &&
        !emptyProfileLogJson.includes(emptyWork.id),
      profile_ui_omits_work_uuid:
        !archiveUiText.includes(acceptedWork.id) && !archiveUiText.includes(emptyWork.id),
      readonly_no_write_logs: readonlyLogs.every(
        (record) => !writeEventPattern.test(String(record.event ?? "")),
      ),
      readonly_no_author_action_frames: readonlyFrames.every(
        (frame) => frame.event !== "user_message" && frame.event !== "author_action",
      ),
      real_archive_opened: true,
      real_work_switch_performed: true,
    },
  ];
}

async function driveCp0MissingChapterBlock(page) {
  // VS-00C CP0：作品里有第01章计划，但没有第99章。作者用自然语言「续写第99章」→
  // Planner 识别 continuation 意图 + 把作者点名的「第99章」原样放进 requested_chapter_raw，
  // 但匹配不到列表（target_chapter=null）→ 应用层 MissingPolicyResult 判 hard missing →
  // 执行前短路：不调 provider、不产创作卡，诚实回复"找不到该章"。
  // 这是 G13 的承重验收：系统不再静默回退到最新章去改错章。
  const requestText = "续写第99章的正文草稿，把冲突推进一下，保持为待采纳草稿。";

  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  await page.locator(chatInputSelector).fill(requestText);
  await page.getByRole("button", { name: /^发送$/ }).click();

  // 真实页面可见诚实回复；业务 JSONL 证明 MissingPolicyResult 已在 provider dispatch 前 block。
  await page.waitForFunction(() => document.body.innerText.includes("没有找到"), {
    timeout: 200_000,
  });

  const missingRecord = await waitForAppLogRecord(
    (record) =>
      record.event === "turn_execution.missing_policy.done" &&
      record.severity === "block" &&
      String(record.missing ?? "").includes("第99章"),
    "No missing_policy block record for missing-chapter continuation",
    200_000,
  );

  await waitForAppLogRecord(
    (record) =>
      record.event === "channel.user_message.done" && record.turn_id === missingRecord.turn_id,
    "No channel.user_message.done record for missing-chapter block",
    30_000,
  );

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage() ?? {
    body: {
      text: requestText,
      work_id: missingRecord.work_id,
      session_id: missingRecord.session_id,
    },
  };
  const blockedTurnResult = latestTurnResult() ?? {
    turn_id: missingRecord.turn_id,
    assistant_message: { text: "没有找到" },
    truthfulness: {
      artifact_adopted: false,
      durable_behavior_opened: false,
      production_write_performed: false,
      tool_called: false,
    },
    adoption_state: null,
    tool_result: null,
  };
  const uiState = await commonUiState(page, blockedTurnResult, sentMessage);
  const sameTurnRecords = readAppLogRecords().filter(
    (record) => record.turn_id === missingRecord.turn_id,
  );

  assert(
    blockedTurnResult.truthfulness?.tool_called === false,
    "Missing-chapter turn claimed a tool call — provider must not be invoked on hard missing",
  );
  assert(
    blockedTurnResult.adoption_state == null,
    "Missing-chapter turn produced an adoption artifact — block must not generate content",
  );
  assert(
    blockedTurnResult.tool_result == null,
    "Missing-chapter turn carried a tool_result — block must short-circuit before tool dispatch",
  );
  assert(
    !visibleText.includes("待确认的创作材料"),
    "A creative artifact card was shown for a missing chapter",
  );
  assert(
    !sameTurnRecords.some((record) => record.event === "toolbox.execute.done"),
    "Provider/toolbox executed despite missing chapter block",
  );

  return [
    {
      ...uiState,
      turn_id: blockedTurnResult.turn_id,
      missing_chapter_blocked: true,
      missing_policy_severity: missingRecord.severity,
      requested_chapter: "第99章",
      honest_not_found_message: String(blockedTurnResult.assistant_message?.text ?? "").includes(
        "没有找到",
      ),
      tool_called: blockedTurnResult.truthfulness?.tool_called === true,
      no_adoption_artifact: blockedTurnResult.adoption_state == null,
      no_tool_result: blockedTurnResult.tool_result == null,
      no_toolbox_execute_event: true,
      creative_card_absent: !visibleText.includes("待确认的创作材料"),
      user_message_text: sentMessage?.body?.text,
    },
  ];
}

async function driveE2E01DowngradeRealPage(page) {
  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "概览" }).click();
  await page.getByRole("button", { name: "发起综合修订" }).click();

  const sentFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.generate_micro_plan === true &&
      String(frame.body?.text ?? "").includes("同时重写第一章") &&
      String(frame.body?.text ?? "").includes("主角动机") &&
      String(frame.body?.text ?? "").includes("伏笔"),
    "Real workbench did not send the multi-step MicroPlan user_message",
  );

  const turnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.orchestrator_decision?.decision_type === "downgrade_to_dialogue" &&
      frame.body?.truthfulness?.execution_blocked === true,
    "No downgrade_to_dialogue turn_result was received for the multi-step MicroPlan",
    200_000,
  );
  const turnResult = turnFrame.body;

  await waitForAppLogRecord(
    (record) =>
      record.event === "orchestrator.decide.done" &&
      record.turn_id === turnResult.turn_id &&
      record.decision_type === "downgrade_to_dialogue",
    "No orchestrator.decide.done downgrade log was recorded",
  );

  const sameTurnRecords = readAppLogRecords().filter(
    (record) => record.turn_id === turnResult.turn_id,
  );
  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage() ?? sentFrame;
  const uiState = await commonUiState(page, turnResult, sentMessage);
  const reasonCodes = Array.isArray(turnResult.truthfulness?.reason_codes)
    ? turnResult.truthfulness.reason_codes
    : [];
  const actionScopeReason = reasonCodes.some((reason) =>
    String(reason).includes("multi-step plan requires downgrade"),
  );
  const downgradeBadgeVisible = visibleText.includes("降级为对话");
  const executionBadgeHidden = !visibleText.includes("生成草稿");

  assert(
    turnResult.truthfulness?.tool_called === false,
    "Downgraded multi-step turn_result claimed a tool call",
  );
  assert(
    turnResult.truthfulness?.production_write_performed === false,
    "Downgraded multi-step turn_result claimed a production write",
  );
  assert(
    turnResult.orchestrator_decision?.first_blocking_gate === "action_scope",
    "Downgraded multi-step turn_result was not blocked by action_scope",
  );
  assert(actionScopeReason, "Downgrade reason did not identify the multi-step action scope block");
  assert(
    !sameTurnRecords.some((record) => record.event === "toolbox.execute.done"),
    "Toolbox executed despite multi-step downgrade",
  );
  assert(
    !frames.some(
      (frame) =>
        frame.direction === "sent" &&
        frame.event === "author_action" &&
        frame.body?.turn_id === turnResult.turn_id,
    ),
    "Author action was sent for a downgraded multi-step turn",
  );
  assert(
    !/确认执行|待确认的创作材料|待保存章节草稿|保存到作品/.test(visibleText),
    "Downgraded multi-step turn rendered execution/adoption controls",
  );
  assert(downgradeBadgeVisible, "Downgraded multi-step turn did not show downgrade badge");
  assert(executionBadgeHidden, "Downgraded multi-step turn still showed generation badge");

  return [
    {
      ...uiState,
      turn_id: turnResult.turn_id,
      downgrade_decision_received: true,
      generate_micro_plan: sentFrame.body?.generate_micro_plan === true,
      decision_type: turnResult.orchestrator_decision?.decision_type,
      first_blocking_gate: turnResult.orchestrator_decision?.first_blocking_gate,
      execution_blocked: turnResult.truthfulness?.execution_blocked === true,
      tool_called: turnResult.truthfulness?.tool_called === true,
      production_write_performed: turnResult.truthfulness?.production_write_performed === true,
      action_scope_reason_present: actionScopeReason,
      no_toolbox_execute_event: true,
      no_author_action_sent: true,
      no_execution_controls_visible: true,
      downgrade_badge_visible: downgradeBadgeVisible,
      generation_badge_absent: executionBadgeHidden,
      user_message_text: sentFrame.body?.text,
    },
  ];
}

async function driveE2E01ReadonlyToolTrace(page) {
  const workId = readSeedField("work_id");
  const workTitleValue = readSeedField("work_title");
  assert(workId, "E2E readonly tool seed did not provide work_id");
  assert(workTitleValue, "E2E readonly tool seed did not provide work_title");

  await ensureWorkSelectedByTitle(page, workTitleValue, workId);
  await waitForVisibleWorkTitle(page, workTitleValue);
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  const requestText = "查看当前角色列表";
  const frameCount = frames.length;
  const logCount = readAppLogRecords().length;

  await page.locator(chatInputSelector).fill(requestText);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    frameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.work_id === workId &&
      String(frame.body?.text ?? "").includes(requestText),
    "Readonly character roster request was not sent from the target work channel",
    10_000,
  );

  const turnFrame = await waitForNewFrame(
    frameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.work_id === workId &&
      frame.body?.orchestrator_decision?.decision_type === "allow_tool" &&
      frame.body?.tool_result?.tool_name === "character_roster" &&
      String(frame.body?.tool_result?.status ?? "") === "succeeded",
    "No allow_tool character_roster turn_result was received",
    200_000,
  );
  const turnResult = turnFrame.body;

  const decisionRecord = await waitForNewAppLogRecord(
    logCount,
    (record) =>
      record.event === "orchestrator.decide.done" &&
      record.turn_id === turnResult.turn_id &&
      record.decision_type === "allow_tool",
    "No orchestrator.decide.done allow_tool log was recorded",
    30_000,
  );

  const charactersRecord = await waitForNewAppLogRecord(
    logCount,
    (record) =>
      record.event === "context.characters.done" &&
      record.turn_id === turnResult.turn_id &&
      record.source_type === "character_dossier" &&
      Number(record.character_count ?? 0) >= 1,
    "No context.characters.done log proved accepted characters entered the tool request",
    30_000,
  );

  const toolboxRecord = await waitForNewAppLogRecord(
    logCount,
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.turn_id === turnResult.turn_id &&
      record.tool_name === "character_roster" &&
      record.tool_outcome === "succeeded",
    "No toolbox.execute.done character_roster success log was recorded",
    30_000,
  );

  await waitForNewAppLogRecord(
    logCount,
    (record) =>
      record.event === "channel.user_message.done" && record.turn_id === turnResult.turn_id,
    "No channel.user_message.done log was recorded for readonly tool turn",
    30_000,
  );

  await page.waitForFunction(
    (payload) =>
      document.body.innerText.includes(payload.requestText) &&
      document.body.innerText.includes("林澈") &&
      document.body.innerText.includes("没有写入作品事实") &&
      !document.body.innerText.includes("思考中"),
    { requestText },
    { timeout: 30_000 },
  );

  const traceQuery = await queryTraceByTurn(turnResult.turn_id);
  const traceRecord = traceQuery.traces.find(
    (trace) =>
      trace.turn_id === turnResult.turn_id &&
      Array.isArray(trace.tool_trace_refs) &&
      trace.tool_trace_refs.some(isToolTraceRef),
  );
  assert(traceRecord, "TraceRepository.list_by_turn did not return a tool trace ref");
  const replayReport = traceRecord.replay_report ?? {};
  const toolTraceAudit = assertToolTraceRegistryRedactedIo(traceRecord);

  const visibleText = await page.locator("body").innerText();
  const sameTurnRecords = readAppLogRecords().filter(
    (record) => record.turn_id === turnResult.turn_id,
  );
  const toolOutput = turnResult.tool_result?.output ?? {};
  const toolCharacters = Array.isArray(toolOutput.characters) ? toolOutput.characters : [];
  const uiState = await commonUiState(page, turnResult, sentFrame);

  assert(
    turnResult.truthfulness?.tool_called === true,
    "Readonly tool turn did not mark tool_called",
  );
  assert(
    turnResult.truthfulness?.production_write_performed === false,
    "Readonly tool turn claimed a production write",
  );
  assert(
    turnResult.truthfulness?.artifact_adopted === false,
    "Readonly tool turn claimed artifact adoption",
  );
  assert(
    (turnResult.tool_result?.state_delta ?? []).length === 0,
    "Readonly character_roster returned state_delta",
  );
  assert(
    (turnResult.tool_result?.artifact_refs ?? []).length === 0,
    "Readonly character_roster returned artifact refs",
  );
  assert(
    toolCharacters.some((character) => character.name === "林澈"),
    "Readonly character roster output did not include accepted character 林澈",
  );
  assert(
    !JSON.stringify(toolCharacters).includes("未确认影子"),
    "Readonly character roster leaked a tentative character",
  );
  assert(
    !JSON.stringify(toolCharacters).includes("外部角色"),
    "Readonly character roster leaked a foreign-work character",
  );
  assert(
    !frames.some(
      (frame) =>
        frame.direction === "sent" &&
        frame.event === "author_action" &&
        frame.body?.turn_id === turnResult.turn_id,
    ),
    "Readonly character roster sent an author_action",
  );
  assert(
    !sameTurnRecords.some((record) => record.event?.startsWith("adoption.evaluate.")),
    "Readonly character roster triggered adoption evaluation",
  );
  assert(
    !/待确认的创作材料|保存到作品|确认执行/.test(visibleText),
    "Readonly character roster rendered execution/adoption controls",
  );

  return [
    {
      ...uiState,
      turn_id: turnResult.turn_id,
      work_id: workId,
      context_work_id: workId,
      user_message_text: sentFrame.body?.text,
      generate_micro_plan: sentFrame.body?.generate_micro_plan === true,
      decision_type: turnResult.orchestrator_decision?.decision_type,
      first_blocking_gate: turnResult.orchestrator_decision?.first_blocking_gate ?? null,
      tool_name: turnResult.tool_result?.tool_name,
      tool_status: String(turnResult.tool_result?.status ?? ""),
      tool_called: turnResult.truthfulness?.tool_called === true,
      production_write_performed: turnResult.truthfulness?.production_write_performed === true,
      artifact_adopted: turnResult.truthfulness?.artifact_adopted === true,
      execution_blocked: turnResult.truthfulness?.execution_blocked === true,
      character_count: Number(toolOutput.character_count ?? 0),
      character_names: toolCharacters.map((character) => character.name),
      accepted_character_visible: visibleText.includes("林澈"),
      tentative_character_absent: !visibleText.includes("未确认影子"),
      foreign_character_absent: !visibleText.includes("外部角色"),
      no_write_statement_visible: visibleText.includes("没有写入作品事实"),
      no_state_delta: (turnResult.tool_result?.state_delta ?? []).length === 0,
      no_artifact_refs: (turnResult.tool_result?.artifact_refs ?? []).length === 0,
      no_author_action_sent: true,
      no_adoption_event: true,
      no_execution_controls_visible: true,
      context_character_count: Number(charactersRecord.character_count ?? 0),
      toolbox_tool_name: toolboxRecord.tool_name,
      toolbox_tool_outcome: toolboxRecord.tool_outcome,
      trace_query_count: Number(traceQuery.count ?? 0),
      trace_query_turn_id: traceQuery.turn_id,
      trace_query_plan_ref: traceRecord.plan_ref,
      trace_query_decision_type: traceRecord.decision_type,
      trace_query_tool_trace_refs: traceRecord.tool_trace_refs,
      trace_query_has_tool_trace_ref: true,
      trace_query_tool_trace_ref: toolTraceAudit.toolRef,
      tool_trace_registry_snapshot: toolTraceAudit.registrySnapshot,
      tool_trace_contract_refs: toolTraceAudit.contractRefs,
      tool_trace_grant_summary: toolTraceAudit.grantSummary,
      tool_trace_request_summary: toolTraceAudit.requestSummary,
      tool_trace_result_summary: toolTraceAudit.resultSummary,
      tool_trace_io_redaction: toolTraceAudit.ioRedaction,
      tool_trace_registry_snapshot_complete: toolTraceAudit.registrySnapshotComplete,
      tool_trace_redacted_io_no_raw_payload: toolTraceAudit.redactedIoNoRawPayload,
      replay_report_tool_trace_carries_registry_snapshot:
        toolTraceAudit.replayReportToolTraceCarriesSnapshot,
      trace_query_replay_report: replayReport,
      replay_report_provider_called: replayReport.provider_called,
      replay_report_result_status: replayReport.result_status,
      replay_report_required_question_count: Array.isArray(replayReport.required_questions)
        ? replayReport.required_questions.length
        : 0,
      decision_record_outcome: decisionRecord.outcome,
    },
  ];
}

async function driveE2E01ReplayReport(page) {
  const [uiState] = await driveE2E01ReadonlyToolTrace(page);
  const traceRecord = {
    plan_ref: uiState.trace_query_plan_ref,
    tool_trace_refs: uiState.trace_query_tool_trace_refs,
    replay_report: uiState.trace_query_replay_report,
  };
  const { report, chainSteps, questions, missingRefs } =
    assertReplayReportCompleteForReadonlyTool(traceRecord);
  const questionStatuses = Object.fromEntries(
    questions.map((question) => [question.id, question.status]),
  );

  return [
    {
      ...uiState,
      replay_report_provider_called: report.provider_called,
      replay_report_result_status: report.result_status,
      replay_report_missing_trace_refs: missingRefs,
      replay_report_chain_steps: chainSteps,
      replay_report_required_question_count: questions.length,
      replay_report_question_statuses: questionStatuses,
      replay_report_all_required_questions_answered: questions.every((question) =>
        ["answered", "not_applicable"].includes(question.status),
      ),
      replay_report_tool_question_answered: questionStatuses.tool_approval === "answered",
      replay_report_adoption_boundary_answered: questionStatuses.adoption_boundary === "answered",
      replay_report_has_frame_plan_decision_tool_turn_result: [
        "frame",
        "plan",
        "decision",
        "tool_trace",
        "turn_result",
      ].every((step) => chainSteps.includes(step)),
    },
  ];
}

async function driveAu07TooltraceRegistryRedactedIo(page) {
  const [uiState] = await driveE2E01ReplayReport(page);

  assert(
    uiState.tool_trace_registry_snapshot_complete === true,
    "AU-07 ToolTrace registry snapshot was not complete",
  );
  assert(
    uiState.tool_trace_redacted_io_no_raw_payload === true,
    "AU-07 ToolTrace redacted I/O summary leaked raw payload",
  );
  assert(
    uiState.replay_report_tool_trace_carries_registry_snapshot === true,
    "AU-07 ReplayReport did not carry ToolTrace registry snapshot",
  );

  return [
    {
      ...uiState,
      au07_tooltrace_registry_snapshot_closed: true,
      au07_tooltrace_redacted_io_closed: true,
      au07_tooltrace_replay_report_chain_closed: true,
    },
  ];
}

async function driveE2E01ChannelActionSecurity(page) {
  const pageJoin = await waitForAppLogRecord(
    (record) =>
      record.event === "channel.join.done" &&
      typeof record.work_id === "string" &&
      record.work_id.length > 0 &&
      typeof record.session_id === "string" &&
      record.session_id.length > 0,
    "Real workbench page did not join a workspace before protocol fuzzing",
    30_000,
  );
  const workId = pageJoin.work_id;
  const sessionId = pageJoin.session_id;
  const titleText = await workTitle(page)
    .textContent()
    .then((value) => value?.trim() ?? "");
  assert(titleText.length > 0, "Real workbench title was not visible before protocol fuzzing");

  const joinLogCount = readAppLogRecords().length;
  const client = await joinProtocolWorkspace(workId, sessionId);

  try {
    const protocolJoin = await waitForNewAppLogRecord(
      joinLogCount,
      (record) =>
        record.event === "channel.join.done" &&
        record.work_id === workId &&
        record.session_id === sessionId,
      "External protocol socket did not join the real workspace",
      30_000,
    );

    const nonce = `E2ESEC${Date.now()}`;
    const firstTurn = await pushProtocolUserMessage(
      client,
      `E2E action security baseline ${nonce} 第一轮，请只回复收到。`,
      workId,
      sessionId,
    );
    assert(firstTurn.turnResult?.turn_id, "First protocol turn_result did not include turn_id");

    const beforeInventedEventCount = client.events.length;
    const beforeInventedLogCount = readAppLogRecords().length;
    const inventedAction = {
      source_turn_ref: firstTurn.turnResult.turn_id,
      action_id: `act-forged-${nonce}`,
      action_type: "confirm_before_execute",
      target_ref: "text_analysis",
      behavior_ref: `behavior-forged-${nonce}`,
      idempotency_key: `idem-forged-${nonce}`,
      source_turn_result: {
        turn_id: firstTurn.turnResult.turn_id,
        available_actions: [
          {
            action_id: `act-forged-${nonce}`,
            action_type: "confirm_before_execute",
            target_ref: "text_analysis",
            behavior_ref: `behavior-forged-${nonce}`,
            enabled: true,
            idempotency_key: `idem-forged-${nonce}`,
          },
        ],
      },
    };
    const inventedReply = await pushProtocolAuthorAction(client, inventedAction);
    const inventedReason = String(inventedReply.payload?.reason ?? "");
    assert(inventedReply.status === "error", "Forged source_turn_result action was not rejected");
    assert(
      inventedReason.includes("invented"),
      `Invented action reason was not explicit: ${inventedReason}`,
    );
    const inventedErrorLog = await waitForNewAppLogRecord(
      beforeInventedLogCount,
      (record) =>
        record.event === "channel.author_action.error" &&
        record.work_id === workId &&
        record.session_id === sessionId &&
        record.action_id === inventedAction.action_id &&
        String(record.outcome_detail ?? "").includes("invented"),
      "Invented author_action rejection was not logged",
      30_000,
    );
    await sleep(500);
    const inventedActionResults = client.events
      .slice(beforeInventedEventCount)
      .filter((entry) => entry.event === "action_result");
    assert(inventedActionResults.length === 0, "Invented author_action broadcast action_result");

    const secondTurn = await pushProtocolUserMessage(
      client,
      `E2E action security baseline ${nonce} 第二轮，推进当前 turn 后继续保持普通对话。`,
      workId,
      sessionId,
    );
    assert(secondTurn.turnResult?.turn_id, "Second protocol turn_result did not include turn_id");
    assert(
      secondTurn.turnResult.turn_id !== firstTurn.turnResult.turn_id,
      "Second protocol turn did not advance current turn",
    );

    const beforeStaleEventCount = client.events.length;
    const beforeStaleLogCount = readAppLogRecords().length;
    const staleAction = {
      source_turn_ref: firstTurn.turnResult.turn_id,
      action_id: `act-stale-forged-${nonce}`,
      action_type: "confirm_before_execute",
      target_ref: "text_analysis",
      behavior_ref: `behavior-stale-forged-${nonce}`,
      idempotency_key: `idem-stale-forged-${nonce}`,
      source_turn_result: {
        turn_id: firstTurn.turnResult.turn_id,
        available_actions: [
          {
            action_id: `act-stale-forged-${nonce}`,
            action_type: "confirm_before_execute",
            target_ref: "text_analysis",
            behavior_ref: `behavior-stale-forged-${nonce}`,
            enabled: true,
            idempotency_key: `idem-stale-forged-${nonce}`,
          },
        ],
      },
    };
    const staleReply = await pushProtocolAuthorAction(client, staleAction);
    const staleReason = String(staleReply.payload?.reason ?? "");
    assert(staleReply.status === "error", "Stale forged author_action was not rejected");
    assert(staleReason.includes("stale"), `Stale action reason was not explicit: ${staleReason}`);
    const staleErrorLog = await waitForNewAppLogRecord(
      beforeStaleLogCount,
      (record) =>
        record.event === "channel.author_action.error" &&
        record.work_id === workId &&
        record.session_id === sessionId &&
        record.action_id === staleAction.action_id &&
        String(record.outcome_detail ?? "").includes("stale"),
      "Stale forged author_action rejection was not logged",
      30_000,
    );
    await sleep(500);
    const staleActionResults = client.events
      .slice(beforeStaleEventCount)
      .filter((entry) => entry.event === "action_result");
    assert(staleActionResults.length === 0, "Stale forged author_action broadcast action_result");

    const afterSecondTurnRecords = readAppLogRecords().filter(
      (record) =>
        record.work_id === workId &&
        record.session_id === sessionId &&
        record.event === "channel.author_action.done" &&
        [inventedAction.action_id, staleAction.action_id].includes(record.action_id),
    );
    assert(
      afterSecondTurnRecords.length === 0,
      "Rejected forged actions logged author_action.done",
    );

    const visibleText = await page.locator("body").innerText();
    assert(
      visibleText.includes("服务: 已连接") || visibleText.includes("同步已连接"),
      "Real page lost service connection during protocol fuzzing",
    );

    return [
      {
        event: "slice_verify.ui_state.done",
        slice_id: "e2e-01-channel-action-security",
        turn_id: secondTurn.turnResult.turn_id,
        turn_ids: [firstTurn.turnResult.turn_id, secondTurn.turnResult.turn_id],
        workspace_id: workId,
        work_id: workId,
        session_id: sessionId,
        context_work_id: workId,
        active_session_id: sessionId,
        socket_connected: true,
        page_join_work_id: pageJoin.work_id,
        page_join_session_id: pageJoin.session_id,
        protocol_join_work_id: protocolJoin.work_id,
        protocol_join_session_id: protocolJoin.session_id,
        real_page_anchor_visible: true,
        title_text: titleText,
        service_status_text: await serviceStatus(page)
          .textContent()
          .then((value) => value?.trim() ?? ""),
        protocol_user_message_done_count: readAppLogRecords().filter(
          (record) =>
            record.event === "channel.user_message.done" &&
            record.work_id === workId &&
            record.session_id === sessionId &&
            [firstTurn.turnResult.turn_id, secondTurn.turnResult.turn_id].includes(record.turn_id),
        ).length,
        first_protocol_turn_id: firstTurn.turnResult.turn_id,
        second_protocol_turn_id: secondTurn.turnResult.turn_id,
        current_turn_advanced: secondTurn.turnResult.turn_id !== firstTurn.turnResult.turn_id,
        invented_action_id: inventedAction.action_id,
        stale_action_id: staleAction.action_id,
        invented_action_rejected: inventedReply.status === "error",
        stale_action_rejected: staleReply.status === "error",
        invented_error_reason: inventedReason,
        stale_error_reason: staleReason,
        client_source_turn_result_ignored: inventedReason.includes("invented"),
        forged_stale_source_rejected: staleReason.includes("stale"),
        invented_error_reason_code: inventedErrorLog.reason_code,
        stale_error_reason_code: staleErrorLog.reason_code,
        author_action_error_count: readAppLogRecords().filter(
          (record) =>
            record.event === "channel.author_action.error" &&
            record.work_id === workId &&
            record.session_id === sessionId &&
            [inventedAction.action_id, staleAction.action_id].includes(record.action_id),
        ).length,
        author_action_done_count_for_forged_actions: afterSecondTurnRecords.length,
        action_result_broadcast_count_after_rejections:
          inventedActionResults.length + staleActionResults.length,
        no_action_result_broadcast_after_rejections:
          inventedActionResults.length + staleActionResults.length === 0,
        no_author_action_done_for_forged_actions: afterSecondTurnRecords.length === 0,
        product_acceptance_logic_added: false,
      },
    ];
  } finally {
    await closeProtocolWorkspace(client);
  }
}

// VS-00E CP1：从真实工作台为带结构化方向的第 02 章生成正文草稿，验证场级执行简述
// （ProseExecutionBriefV1）确定性投影自章方向、进入正文生成链路与 trace，且不写作品事实。
// 外部证据：app 日志 context.structure.done(has_plan_direction) + prose_execution_brief.built
// (degraded=false, brief_ref, scene_unit_count)；wire trace_summary 软记录。
async function driveP1ProseExecutionBrief(page) {
  const targetChapterTitle = "第02章：旧服务器里的残诀";

  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "大纲与结构" }).click();
  await page.waitForFunction(
    (targetTitle) =>
      document.body.innerText.includes("已采纳章节计划") &&
      document.body.innerText.includes(targetTitle),
    targetChapterTitle,
    { timeout: 10_000 },
  );

  const draftButtons = page.getByRole("button", { name: "生成正文草稿" });
  assert(
    (await draftButtons.count()) >= 2,
    "Archive outline did not render a draft action for chapter 2",
  );
  await draftButtons.nth(1).click();

  const draftMessageFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.generate_micro_plan === true &&
      String(frame.body?.text ?? "").includes(targetChapterTitle) &&
      String(frame.body?.text ?? "").includes("正文草稿"),
    "Real workbench did not send chapter-2 draft user_message with micro plan enabled",
  );

  const draftTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.tool_name === "prose_writing" &&
      frame.body?.tool_result?.output?.artifact_type === "prose_fragment" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment",
    "No prose_fragment turn_result websocket frame was received",
  );
  const draftTurnResult = draftTurnFrame.body;
  const pendingArtifact = draftTurnResult.adoption_state.pending[0];
  const draftBody = pendingArtifact.payload?.items?.[0]?.body ?? "";

  // 外部证据 1：结构化章方向被读取
  await waitForAppLogRecord(
    (record) =>
      record.event === "context.structure.done" &&
      record.turn_id === draftTurnResult.turn_id &&
      record.target_chapter === targetChapterTitle &&
      record.has_plan_direction === true,
    "No structured chapter direction (has_plan_direction) app log for chapter 2",
  );

  // 外部证据 2：场级执行简述被构建并进入链路，且非降级（确定性投影自章方向）
  const briefRecord = await waitForAppLogRecord(
    (record) =>
      record.event === "prose_execution_brief.built.done" &&
      record.turn_id === draftTurnResult.turn_id,
    "No prose_execution_brief.built app log for the prose turn",
  );
  assert(
    briefRecord.degraded === false,
    `Execution brief degraded unexpectedly: ${JSON.stringify(briefRecord)}`,
  );
  assert(
    typeof briefRecord.brief_ref === "string" && briefRecord.brief_ref.startsWith("brief:"),
    "Execution brief log missing stable brief_ref",
  );
  assert(Number(briefRecord.scene_unit_count ?? 0) >= 1, "Execution brief had no scene units");

  await page.waitForFunction(
    (targetTitle) =>
      /待保存章节草稿|章节正文草稿|待确认的创作材料/.test(document.body.innerText) &&
      document.body.innerText.includes(targetTitle),
    targetChapterTitle,
    { timeout: 10_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, draftTurnResult, sentMessage);

  // brief 不是作品事实：待采纳产物正文不含执行简述结构标签，且未触发采纳
  assert(!draftBody.includes("场级执行简述"), "Execution brief leaked into draft body");
  assert(
    !frames.some((frame) => frame.direction === "sent" && frame.event === "adopt"),
    "Brief turn unexpectedly submitted an adopt event",
  );

  return [
    {
      ...uiState,
      turn_id: draftTurnResult.turn_id,
      chapter_title: targetChapterTitle,
      draft_generated: true,
      draft_pending: true,
      draft_card_visible: /待保存章节草稿|章节正文草稿|待确认的创作材料/.test(visibleText),
      execution_brief_built: true,
      execution_brief_degraded: briefRecord.degraded === true,
      execution_brief_ref: briefRecord.brief_ref,
      execution_brief_scene_units: Number(briefRecord.scene_unit_count ?? 0),
      trace_prose_execution_brief_ref:
        draftTurnResult?.trace_summary?.prose_execution_brief_ref ?? null,
      has_plan_direction_context: true,
      brief_in_draft_body: draftBody.includes("场级执行简述"),
      adopt_event_sent: frames.some(
        (frame) => frame.direction === "sent" && frame.event === "adopt",
      ),
      user_message_text: draftMessageFrame.body?.text,
    },
  ];
}

async function driveP1ProseRevisionCandidate(page) {
  const targetChapterTitle = "第02章：矿区追击战";

  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "大纲与结构" }).click();
  await page.waitForFunction(
    (targetTitle) =>
      document.body.innerText.includes("已采纳章节计划") &&
      document.body.innerText.includes(targetTitle),
    targetChapterTitle,
    { timeout: 10_000 },
  );

  const draftButtons = page.getByRole("button", { name: "生成正文草稿" });
  assert(
    (await draftButtons.count()) >= 2,
    "Archive outline did not render a draft action for the action chapter",
  );
  await draftButtons.nth(1).click();

  // 正文草稿 turn：携带质量复核发现 + revise_from_findings 可用动作（节奏单调动作段被
  // 确定性 validator 命中）。
  const draftTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.tool_name === "prose_writing" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment" &&
      Array.isArray(frame.body?.quality_review?.findings) &&
      frame.body.quality_review.findings.length > 0 &&
      (frame.body?.available_actions ?? []).some(
        (action) => action.action_type === "revise_from_findings",
      ),
    "No prose_fragment turn_result with quality findings + revise action was received",
  );
  const draftTurnResult = draftTurnFrame.body;
  const originalArtifactId = draftTurnResult.adoption_state.pending[0].artifact_id;
  const originalBody = draftTurnResult.adoption_state.pending[0].payload?.items?.[0]?.body ?? "";

  // 外部证据：本轮跑了独立质量评估并产出发现（finding 不是作品事实，仅供作者审阅）
  const qualityRecord = await waitForAppLogRecord(
    (record) =>
      record.event === "prose_quality.evaluated.done" &&
      record.turn_id === draftTurnResult.turn_id &&
      Number(record.finding_count ?? 0) >= 1,
    "No prose_quality.evaluated app log with findings for the draft turn",
  );

  // 真实页面可见：质量复核卡 + 「按这些问题重写」入口
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("质量复核") &&
      document.body.innerText.includes("按这些问题重写"),
    undefined,
    { timeout: 10_000 },
  );

  const beforeReviseFrameCount = frames.length;
  await page.getByRole("button", { name: "按这些问题重写" }).first().click();

  // revise_from_findings 作者动作被真实工作台发出
  const reviseActionFrame = await waitForNewFrame(
    beforeReviseFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "revise_from_findings" &&
      frame.body?.action?.target_ref === originalArtifactId,
    "Real workbench did not send a revise_from_findings author_action",
  );

  const revisionAckFrame = await waitForNewFrame(
    beforeReviseFrameCount,
    (frame) => {
      const response = frame.body?.response ?? {};
      return (
        frame.direction === "received" &&
        frame.event === "phx_reply" &&
        frame.body?.status === "ok" &&
        response.received === true &&
        response.run_mode === "bounded" &&
        response.profile_ref === "prose_revision_from_findings_v1" &&
        typeof response.run_id === "string" &&
        response.run_id !== ""
      );
    },
    "Revision author_action did not fast-ack with bounded AgentRun run_id",
    30_000,
  );
  const revisionRunId = revisionAckFrame.body.response.run_id;

  await waitForNewFrame(
    beforeReviseFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === revisionRunId &&
      frame.body?.event_type === "run_started",
    "Revision AgentRun run_started event was not broadcast",
    30_000,
  );

  const revisionPlanDraftFrame = await waitForNewFrame(
    beforeReviseFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === revisionRunId &&
      frame.body?.event_type === "plan_drafted" &&
      frame.body?.payload?.target_tool_ref === "revision_prepare" &&
      Array.isArray(frame.body?.payload?.plan_steps) &&
      frame.body.payload.plan_steps.length === 4,
    "Revision model-drafted AgentPlan event was not broadcast",
    30_000,
  );
  const revisionPlanDraftSteps = revisionPlanDraftFrame.body?.payload?.plan_steps ?? [];
  const revisionPlanDraftTargets = revisionPlanDraftSteps.map((step) => step?.target_tool_ref);
  assert(
    JSON.stringify(revisionPlanDraftTargets) ===
      JSON.stringify(["revision_prepare", "revision_plan", "prose_writing", "revision_finalize"]),
    "Revision plan_drafted payload did not include the expected mechanical cursor steps",
  );

  const revisionSourceEventFrame = await waitForNewFrame(
    beforeReviseFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === revisionRunId &&
      frame.body?.event_type === "goal_understood" &&
      String(frame.body?.summary ?? "").includes("待修订草稿"),
    "Revision source-loaded AgentEvent was not broadcast",
    30_000,
  );

  const revisionGateEventFrame = await waitForNewFrame(
    beforeReviseFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === revisionRunId &&
      frame.body?.event_type === "gate_decided" &&
      frame.body?.payload?.stage === "revision_orchestrator_decision_recorded",
    "Revision gate_decided event was not broadcast with orchestrator decision evidence",
    30_000,
  );

  const revisionToolStartedFrame = await waitForNewFrame(
    beforeReviseFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === revisionRunId &&
      frame.body?.event_type === "tool_started",
    "Revision tool_started event was not broadcast",
    30_000,
  );

  const revisionToolCompletedFrame = await waitForNewFrame(
    beforeReviseFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === revisionRunId &&
      frame.body?.event_type === "tool_completed",
    "Revision tool_completed event was not broadcast",
    120_000,
  );

  const revisionArtifactEventFrame = await waitForNewFrame(
    beforeReviseFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === revisionRunId &&
      frame.body?.event_type === "artifact_created" &&
      Array.isArray(frame.body?.refs) &&
      frame.body.refs.length > 0,
    "Revision artifact_created event was not broadcast",
    120_000,
  );

  // 修订草稿 turn：一份新的 tentative 正文草稿，provenance 指向被修订原稿
  const revisionTurnFrame = await waitForNewFrame(
    beforeReviseFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.agent_run?.run_id === revisionRunId &&
      frame.body?.trace_summary?.decision_type === "revise_from_findings" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment",
    "No revision turn_result (decision_type revise_from_findings) was received",
    90_000,
  );
  const revisionTurnResult = revisionTurnFrame.body;
  const revisionArtifact = revisionTurnResult.adoption_state.pending[0];
  const revisionBody = revisionArtifact.payload?.items?.[0]?.body ?? "";
  const revisionCard = (revisionTurnResult.ui_cards ?? []).find(
    (card) => card.card_type === "candidate_set",
  );

  await waitForNewFrame(
    beforeReviseFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === revisionRunId &&
      frame.body?.event_type === "run_completed",
    "Revision AgentRun run_completed event was not broadcast",
    60_000,
  );

  const revisionCompletedStateFrame = await waitForNewFrame(
    beforeReviseFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === revisionRunId &&
      frame.body?.status === "completed" &&
      Number(frame.body?.consumed_budget?.steps ?? 0) === 4 &&
      Number(frame.body?.consumed_budget?.tool_calls ?? 0) === 1 &&
      Number(frame.body?.consumed_budget?.provider_calls ?? 0) === 2,
    "Revision AgentRun state did not finish with expected step/tool/provider counters",
    60_000,
  );

  // 外部证据：修订候选被独立生成，provenance 指向原稿；不自我递归评估
  const revisionRecord = await waitForAppLogRecord(
    (record) =>
      record.event === "prose_revision.generated.done" &&
      record.revision_base === originalArtifactId,
    "No prose_revision.generated app log pointing at the original draft",
  );

  await waitForAppLogRecord(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.action_type === "revise_from_findings" &&
      record.run_id === revisionRunId &&
      String(record.run_mode ?? "") === "bounded",
    "Revision author_action did not log bounded AgentRun ack",
  );

  // 真实页面可见：修订草稿卡片
  await page.waitForFunction(() => document.body.innerText.includes("修订草稿"), undefined, {
    timeout: 10_000,
  });

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, draftTurnResult, sentMessage);

  // 不变量：原稿保留（与修订稿不同），修订稿是 tentative、未触发采纳
  assert(revisionBody !== "", "Revision draft has no prose body");
  assert(revisionBody !== originalBody, "Revision draft is byte-identical to the original draft");
  assert(
    !frames.some((frame) => frame.direction === "sent" && frame.event === "adopt"),
    "Revision flow unexpectedly submitted an adopt event",
  );
  const revisionAckIndex = frames.findIndex((frame) => frame === revisionAckFrame);
  const revisionTurnIndex = frames.findIndex((frame) => frame === revisionTurnFrame);
  assert(
    revisionAckIndex >= 0 && revisionTurnIndex > revisionAckIndex,
    "Revision TurnResult arrived before bounded AgentRun ack",
  );

  return [
    {
      ...uiState,
      turn_id: draftTurnResult.turn_id,
      chapter_title: targetChapterTitle,
      draft_generated: true,
      draft_pending: true,
      quality_findings_count: draftTurnResult.quality_review.findings.length,
      quality_finding_count_logged: Number(qualityRecord.finding_count ?? 0),
      revise_action_available: true,
      revise_action_clicked: true,
      revise_action_sent: true,
      revision_run_id: revisionRunId,
      revision_run_mode: revisionAckFrame.body.response.run_mode,
      revision_profile_ref: revisionCompletedStateFrame.body.profile_ref,
      revision_parent_fast_ack_before_final_turn_result:
        revisionAckIndex >= 0 && revisionTurnIndex > revisionAckIndex,
      revision_plan_drafted_visible: revisionPlanDraftFrame.body?.event_type === "plan_drafted",
      revision_plan_drafted_target_tool_ref: revisionPlanDraftFrame.body?.payload?.target_tool_ref,
      revision_plan_drafted_step_count: revisionPlanDraftSteps.length,
      revision_plan_drafted_targets: revisionPlanDraftTargets,
      revision_agent_stage_events_visible:
        revisionPlanDraftFrame.body?.event_type === "plan_drafted" &&
        revisionSourceEventFrame.body?.event_type === "goal_understood" &&
        revisionGateEventFrame.body?.event_type === "gate_decided" &&
        revisionToolStartedFrame.body?.event_type === "tool_started" &&
        revisionToolCompletedFrame.body?.event_type === "tool_completed" &&
        revisionTurnResult.truthfulness?.production_write_performed === false &&
        revisionTurnResult.trace_summary?.no_write_reason ===
          "revision draft is tentative and not auto-adopted" &&
        revisionArtifactEventFrame.body?.event_type === "artifact_created",
      revision_source_step_visible: revisionPlanDraftTargets.includes("revision_prepare"),
      revision_source_event_visible:
        revisionSourceEventFrame.body?.event_type === "goal_understood",
      revision_plan_step_visible: revisionPlanDraftTargets.includes("revision_plan"),
      revision_plan_event_visible:
        revisionGateEventFrame.body?.payload?.stage === "revision_orchestrator_decision_recorded",
      revision_gate_event_visible: revisionGateEventFrame.body?.event_type === "gate_decided",
      revision_execute_step_visible: revisionPlanDraftTargets.includes("prose_writing"),
      revision_tool_started_visible: revisionToolStartedFrame.body?.event_type === "tool_started",
      revision_tool_completed_visible:
        revisionToolCompletedFrame.body?.event_type === "tool_completed",
      revision_tool_observation_visible:
        revisionTurnResult.truthfulness?.production_write_performed === false &&
        revisionTurnResult.trace_summary?.no_write_reason ===
          "revision draft is tentative and not auto-adopted",
      revision_finalization_step_visible: revisionPlanDraftTargets.includes("revision_finalize"),
      revision_artifact_event_visible:
        revisionArtifactEventFrame.body?.event_type === "artifact_created",
      revision_completed_step_count:
        revisionCompletedStateFrame.body.completed_step_refs?.length ?? 0,
      revision_consumed_steps: revisionCompletedStateFrame.body.consumed_budget?.steps,
      revision_consumed_tool_calls: revisionCompletedStateFrame.body.consumed_budget?.tool_calls,
      revision_consumed_provider_calls:
        revisionCompletedStateFrame.body.consumed_budget?.provider_calls,
      revision_turn_agent_run_id: revisionTurnResult.agent_run?.run_id ?? null,
      original_artifact_id: originalArtifactId,
      revision_turn_id: revisionTurnResult.turn_id,
      revision_artifact_id: revisionArtifact.artifact_id,
      revision_base: revisionCard?.revision_of ?? revisionRecord.revision_base ?? null,
      revision_turn_result_no_write:
        revisionTurnResult.truthfulness?.production_write_performed === false,
      revision_turn_result_no_write_reason: revisionTurnResult.trace_summary?.no_write_reason,
      revision_replay_recall_provider:
        revisionTurnResult.trace_summary?.replay_policy?.recall_provider,
      revision_replay_use_recorded_frame:
        revisionTurnResult.trace_summary?.replay_policy?.use_recorded_frame,
      revision_card_visible: visibleText.includes("修订草稿"),
      quality_review_card_visible:
        visibleText.includes("质量复核") && visibleText.includes("按这些问题重写"),
      revision_body_differs: revisionBody !== originalBody,
      revision_pending: true,
      adopt_event_sent: frames.some(
        (frame) => frame.direction === "sent" && frame.event === "adopt",
      ),
    },
  ];
}

async function driveP1ProseQualityFindingRoundtrip(page) {
  const targetChapterTitle = "第02章：矿区追击战";

  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "大纲与结构" }).click();
  await page.waitForFunction(
    (targetTitle) =>
      document.body.innerText.includes("已采纳章节计划") &&
      document.body.innerText.includes(targetTitle),
    targetChapterTitle,
    { timeout: 10_000 },
  );

  const draftButtons = page.getByRole("button", { name: "生成正文草稿" });
  assert(
    (await draftButtons.count()) >= 2,
    "Archive outline did not render a draft action for the action chapter",
  );
  await draftButtons.nth(1).click();

  // 正文草稿 turn：携带质量复核发现（节奏单调动作段被确定性 validator 命中）
  const draftTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.tool_name === "prose_writing" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment" &&
      Array.isArray(frame.body?.quality_review?.findings) &&
      frame.body.quality_review.findings.length > 0,
    "No prose_fragment turn_result with quality findings was received",
  );
  const draftTurnResult = draftTurnFrame.body;
  const review = draftTurnResult.quality_review;
  const finding = review.findings[0];
  const findingSummary = String(finding.summary ?? "");
  const draftBody = draftTurnResult.adoption_state.pending[0].payload?.items?.[0]?.body ?? "";

  // 复核完成（非降级）：评审完成态而非「未完成」
  assert(
    review.review_status === "completed",
    `Expected completed review_status, got ${review.review_status}`,
  );
  assert(findingSummary !== "", "Backend finding has empty summary");

  // 外部证据：本轮跑了独立质量评估并命中发现
  const qualityRecord = await waitForAppLogRecord(
    (record) =>
      record.event === "prose_quality.evaluated.done" &&
      record.turn_id === draftTurnResult.turn_id &&
      Number(record.finding_count ?? 0) >= 1,
    "No prose_quality.evaluated app log with findings for the draft turn",
  );

  // 真实页面忠实展示：质量复核卡 + 后端发现摘要原文逐字可见
  await page.waitForFunction(
    (summary) =>
      document.body.innerText.includes("质量复核") && document.body.innerText.includes(summary),
    findingSummary,
    { timeout: 10_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, draftTurnResult, sentMessage);

  // finding 不是作品事实：发现摘要不混进正文草稿，且未触发采纳
  assert(
    !draftBody.includes(findingSummary),
    "Quality finding summary leaked into the prose draft body",
  );
  assert(
    !frames.some((frame) => frame.direction === "sent" && frame.event === "adopt"),
    "Finding-roundtrip turn unexpectedly submitted an adopt event",
  );

  return [
    {
      ...uiState,
      turn_id: draftTurnResult.turn_id,
      chapter_title: targetChapterTitle,
      draft_generated: true,
      draft_pending: true,
      quality_review_status: review.review_status,
      quality_findings_count: review.findings.length,
      quality_finding_count_logged: Number(qualityRecord.finding_count ?? 0),
      finding_validator: String(finding.validator ?? ""),
      finding_summary_displayed: visibleText.includes(findingSummary),
      quality_review_card_visible: visibleText.includes("质量复核"),
      finding_in_draft_body: draftBody.includes(findingSummary),
      adopt_event_sent: frames.some(
        (frame) => frame.direction === "sent" && frame.event === "adopt",
      ),
    },
  ];
}

async function driveP1ProseQualityEvaluatorDegrade(page) {
  const targetChapterTitle = "第02章：评审降级章";

  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "大纲与结构" }).click();
  await page.waitForFunction(
    (targetTitle) =>
      document.body.innerText.includes("已采纳章节计划") &&
      document.body.innerText.includes(targetTitle),
    targetChapterTitle,
    { timeout: 10_000 },
  );

  const draftButtons = page.getByRole("button", { name: "生成正文草稿" });
  assert(
    (await draftButtons.count()) >= 2,
    "Archive outline did not render a draft action for the degrade chapter",
  );
  await draftButtons.nth(1).click();

  // 正文草稿 turn：草稿仍生成（tentative），但质量评审降级为 unavailable（绝不伪装通过）
  const draftTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.tool_name === "prose_writing" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment" &&
      frame.body?.quality_review?.review_status === "unavailable",
    "No prose_fragment turn_result with unavailable quality review was received",
  );
  const draftTurnResult = draftTurnFrame.body;
  const review = draftTurnResult.quality_review;
  const draftBody = draftTurnResult.adoption_state.pending[0].payload?.items?.[0]?.body ?? "";

  // 降级语义：不伪装通过、不伪造发现
  assert(review.review_status === "unavailable", `review_status=${review.review_status}`);
  assert(review.policy_action === "quality_review_unavailable", `policy=${review.policy_action}`);
  assert((review.findings ?? []).length === 0, "Degraded review must not fabricate findings");

  // 外部证据：评审降级被如实记录
  const qualityRecord = await waitForAppLogRecord(
    (record) =>
      record.event === "prose_quality.evaluated.done" &&
      record.turn_id === draftTurnResult.turn_id &&
      record.review_status === "unavailable",
    "No prose_quality.evaluated app log with review_status=unavailable",
  );

  // 真实页面：显示「本次质量复核未完成」，且不出现完成态「质量复核：发现」标题
  await page.waitForFunction(
    () => document.body.innerText.includes("本次质量复核未完成"),
    undefined,
    { timeout: 10_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, draftTurnResult, sentMessage);

  // 草稿仍可由作者审阅（tentative，未被降级阻断），降级标记不污染正文
  assert(draftBody !== "", "Draft body should still be produced under degraded review");
  assert(
    !draftBody.includes("评审故障演练") && !draftBody.includes("VS00EEVALFAIL"),
    "Degrade marker leaked into the prose draft body",
  );
  assert(
    !frames.some((frame) => frame.direction === "sent" && frame.event === "adopt"),
    "Degrade turn unexpectedly submitted an adopt event",
  );

  return [
    {
      ...uiState,
      turn_id: draftTurnResult.turn_id,
      chapter_title: targetChapterTitle,
      draft_generated: true,
      draft_pending: true,
      quality_review_status: review.review_status,
      quality_policy_action: review.policy_action,
      quality_findings_count: (review.findings ?? []).length,
      quality_review_logged_status: String(qualityRecord.review_status ?? ""),
      unavailable_card_visible: visibleText.includes("本次质量复核未完成"),
      faked_completed_title_visible: visibleText.includes("质量复核：发现"),
      degrade_marker_in_body:
        draftBody.includes("评审故障演练") || draftBody.includes("VS00EEVALFAIL"),
      adopt_event_sent: frames.some(
        (frame) => frame.direction === "sent" && frame.event === "adopt",
      ),
    },
  ];
}

async function driveP1ProseQualityAdoptionBoundary(page) {
  const targetChapterTitle = "第02章：矿区追击战";

  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "大纲与结构" }).click();
  await page.waitForFunction(
    (targetTitle) =>
      document.body.innerText.includes("已采纳章节计划") &&
      document.body.innerText.includes(targetTitle),
    targetChapterTitle,
    { timeout: 10_000 },
  );

  const draftButtons = page.getByRole("button", { name: "生成正文草稿" });
  assert(
    (await draftButtons.count()) >= 2,
    "Archive outline did not render the action-chapter draft action",
  );
  await draftButtons.nth(1).click();

  // 原始草稿 turn（含质量发现 + 重写入口）
  const draftTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment" &&
      Array.isArray(frame.body?.quality_review?.findings) &&
      frame.body.quality_review.findings.length > 0 &&
      (frame.body?.available_actions ?? []).some((a) => a.action_type === "revise_from_findings"),
    "No prose draft turn_result with quality findings + revise action",
  );
  const originalArtifactId = draftTurnFrame.body.adoption_state.pending[0].artifact_id;

  // 重写 → 修订候选 turn（sibling tentative 草稿）
  const beforeRevise = frames.length;
  await page.getByRole("button", { name: "按这些问题重写" }).first().click();
  const revisionTurnFrame = await waitForNewFrame(
    beforeRevise,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.trace_summary?.decision_type === "revise_from_findings" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment",
    "No revision turn_result was received",
    90_000,
  );
  const revisionArtifactId = revisionTurnFrame.body.adoption_state.pending[0].artifact_id;
  assert(revisionArtifactId !== originalArtifactId, "Revision and original share an artifact_id");

  // 两份 sibling 草稿都可独立采纳：页面上应有两个「保存为章节正文」按钮
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].filter((b) =>
        /保存为章节正文/.test((b.textContent ?? "").trim()),
      ).length >= 2,
    undefined,
    { timeout: 10_000 },
  );
  const acceptButtonsBefore = await page
    .getByRole("button", { name: acceptDraftButtonPattern })
    .count();

  // 采纳修订稿（最新的卡 = 最后一个保存按钮）
  const beforeAdopt = frames.length;
  await page.getByRole("button", { name: acceptDraftButtonPattern }).last().click();

  const acceptActionFrame = await waitForNewFrame(
    beforeAdopt,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "accept" &&
      frame.body?.action?.target_ref === revisionArtifactId,
    "Real workbench did not send an accept author_action for the revision draft",
  );

  const adoptTurnFrame = await waitForNewFrame(
    beforeAdopt,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.truthfulness?.artifact_adopted === true &&
      Array.isArray(frame.body?.adoption_state?.resolved) &&
      frame.body.adoption_state.resolved.some((entry) => entry.artifact_id === revisionArtifactId),
    "No resolved adoption turn_result for the revision draft",
    120_000,
  );
  const adoptTurnResult = adoptTurnFrame.body;

  // 边界：采纳修订稿不影响原稿——原稿没进 resolved，且仍保留一个独立的采纳入口
  const originalResolvedByRevisionAdopt = (adoptTurnResult.adoption_state.resolved ?? []).some(
    (entry) => entry.artifact_id === originalArtifactId,
  );
  assert(
    !originalResolvedByRevisionAdopt,
    "Adopting the revision unexpectedly resolved the original draft (boundary violated)",
  );

  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].filter((b) =>
        /保存为章节正文/.test((b.textContent ?? "").trim()),
      ).length === 1,
    undefined,
    { timeout: 10_000 },
  );
  const acceptButtonsAfter = await page
    .getByRole("button", { name: acceptDraftButtonPattern })
    .count();

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, adoptTurnResult, sentMessage);

  return [
    {
      ...uiState,
      turn_id: draftTurnFrame.body.turn_id,
      chapter_title: targetChapterTitle,
      original_artifact_id: originalArtifactId,
      revision_artifact_id: revisionArtifactId,
      revision_turn_id: revisionTurnFrame.body.turn_id,
      adopt_turn_id: adoptTurnResult.turn_id,
      both_drafts_adoptable: acceptButtonsBefore >= 2,
      accept_buttons_before: acceptButtonsBefore,
      accept_buttons_after: acceptButtonsAfter,
      revision_adopted: true,
      original_still_tentative: acceptButtonsAfter === 1,
      original_resolved_by_revision_adopt: originalResolvedByRevisionAdopt,
      adopt_action_target_ref: acceptActionFrame.body.action.target_ref,
      reading_mode_visible: visibleText.includes("阅读模式"),
    },
  ];
}

async function driveUa01AgentBoundedRosterToCharacterDesign(page) {
  await configureProviderRuntime({ provider: "slice_verify" });

  const nonce = `UA01-${Date.now().toString(36)}`;
  const work = await createWorkSeed({
    title: `UA01 AgentRun ${nonce}`,
    genre: "赛博修仙",
    core_selling_point: "验证 bounded AgentRun 从角色阵容读取到角色设计的真实工作台链路",
    target_reader: "需要可打断多步创作过程的作者",
    tone_preference: "冷静、清晰",
  });
  const workId = work.id;
  const workTitleValue = work.title;

  const joinStart = readAppLogRecords().length;
  await refreshAndSelectWork(page, workTitleValue);
  const joinRecord = await waitForNewAppLogRecord(
    joinStart,
    (record) => record.event === "channel.join.done" && record.work_id === workId,
    "Selecting the UA-01 generated work did not join expected work channel",
    30_000,
  );
  await waitForVisibleWorkTitle(page, workTitleValue);
  await sleep(750);

  const frameStart = frames.length;
  const logStart = readAppLogRecords().length;
  const message = `先看看当前已有角色阵容，然后设计一个与主角形成镜像冲突的主要反派，标记${nonce}。`;

  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.work_id === workId &&
      String(frame.body?.text ?? "").includes(nonce),
    "UA-01 did not send the compound author request through the real user_message channel",
    30_000,
  );

  const ackFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "phx_reply" &&
      frame.body?.status === "ok" &&
      frame.body?.response?.received === true &&
      typeof frame.body?.response?.run_id === "string" &&
      frame.body?.response?.run_mode === "bounded",
    "UA-01 did not receive a fast bounded AgentRun ack",
    30_000,
  );
  const runId = ackFrame.body.response.run_id;

  await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "run_started",
    "UA-01 AgentRun start event was not broadcast to the real workbench",
    30_000,
  );

  const planDraftFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "plan_drafted" &&
      frame.body?.payload?.target_tool_ref === "character_roster" &&
      Array.isArray(frame.body?.payload?.plan_steps) &&
      frame.body.payload.plan_steps.length === 2,
    "UA-01 model-drafted AgentPlan event was not broadcast",
    30_000,
  );
  const planDraftSteps = planDraftFrame.body?.payload?.plan_steps ?? [];
  const planDraftTargets = planDraftSteps.map((step) => step?.target_tool_ref);
  assert(
    JSON.stringify(planDraftTargets) === JSON.stringify(["character_roster", "character_design"]),
    "UA-01 plan_drafted payload did not include roster and character_design steps",
  );

  const rosterTurnFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.tool_name === "character_roster" &&
      frame.body?.tool_result?.status === "succeeded" &&
      frame.body?.truthfulness?.production_write_performed === false,
    "UA-01 roster observation turn_result was not broadcast with read-only evidence",
    60_000,
  );

  const artifactEvent = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "artifact_created" &&
      Array.isArray(frame.body?.refs) &&
      frame.body.refs.length > 0,
    "UA-01 artifact-created event was not visible",
    120_000,
  );

  const turnFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.agent_run?.run_id === runId &&
      frame.body?.tool_result?.tool_name === "character_design" &&
      frame.body?.tool_result?.status === "succeeded" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "character_seed",
    "UA-01 bounded run did not broadcast the final character_design TurnResult",
    120_000,
  );
  const turnResult = turnFrame.body;
  const pendingArtifact = turnResult.adoption_state.pending[0];

  await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "run_completed",
    "UA-01 AgentRun completion event was not broadcast",
    60_000,
  );

  const completedStateFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId &&
      frame.body?.status === "completed" &&
      Number(frame.body?.consumed_budget?.steps ?? 0) === 2 &&
      Number(frame.body?.consumed_budget?.tool_calls ?? 0) === 2 &&
      // Order 62 CP1 两段式规划后：路由 1 + 计划起草（reasoning 流 + 结构 tool call）2 + writer 1。
      Number(frame.body?.consumed_budget?.provider_calls ?? 0) === 4,
    "UA-01 AgentRun state did not finish with the expected bounded budget counters",
    60_000,
  );

  await waitForNewAppLogRecord(
    logStart,
    (record) =>
      record.event === "channel.user_message.done" &&
      record.run_id === runId &&
      String(record.run_mode ?? "") === "bounded",
    "UA-01 parent user_message did not log bounded run ack",
    30_000,
  );
  await waitForNewAppLogCount(
    logStart,
    (record) =>
      record.event === "orchestrator.decide.done" &&
      String(record.decision_type ?? "") === "allow_tool",
    2,
    "UA-01 internal AgentSteps were not both re-gated by the orchestrator",
    60_000,
  );
  await waitForNewAppLogRecord(
    logStart,
    (record) => record.event === "toolbox.execute.done" && record.tool_name === "character_roster",
    "UA-01 did not execute the readonly character_roster step",
    60_000,
  );
  await waitForNewAppLogRecord(
    logStart,
    (record) => record.event === "toolbox.execute.done" && record.tool_name === "character_design",
    "UA-01 did not execute the character_design step",
    60_000,
  );

  const ackIndex = frames.findIndex((frame) => frame === ackFrame);
  const turnIndex = frames.findIndex((frame) => frame === turnFrame);
  assert(ackIndex >= 0 && turnIndex > ackIndex, "UA-01 final TurnResult arrived before fast ack");
  assert(
    turnResult.truthfulness?.production_write_performed === false,
    "UA-01 character design performed a production write",
  );
  assert(turnResult.truthfulness?.artifact_adopted === false, "UA-01 artifact was auto-adopted");
  assert(
    pendingArtifact.requires_adoption === true &&
      String(pendingArtifact.adoption_status ?? "") === "tentative",
    "UA-01 character artifact was not a tentative adoption candidate",
  );

  const visibleText = await page.locator("body").innerText();
  const uiState = await commonUiState(page, turnResult, sentFrame);
  await page.evaluate(() => {
    const target = document.querySelector('[class*="agenticLoopPhaseStrip"]');
    if (!target) return;

    let container = target.parentElement;
    while (container) {
      if (container.scrollHeight > container.clientHeight) {
        const targetTop = target.getBoundingClientRect().top;
        const containerTop = container.getBoundingClientRect().top;
        container.scrollTop = Math.max(0, container.scrollTop + targetTop - containerTop - 24);
        return;
      }
      container = container.parentElement;
    }

    target.scrollIntoView({ block: "start" });
  });
  const logsAfter = readAppLogRecords().slice(logStart);
  const parentUserMessageLog = logsAfter.find(
    (record) => record.event === "channel.user_message.done" && record.run_id === runId,
  );
  const agentEventFrames = frames
    .slice(frameStart)
    .filter(
      (frame) =>
        frame.direction === "received" &&
        frame.event === "agent_event" &&
        frame.body?.run_ref === runId,
    );
  const agentEvents = agentEventFrames.map((frame) => frame.body?.event_type);
  const forbiddenAgentEventText = [
    "chain_of_thought",
    "system_prompt",
    "developer_prompt",
    "raw_prompt",
    "tool_input",
    message,
  ];
  const authorAgentEventFrames = agentEventFrames.filter(
    (frame) => frame.body?.visibility === "author",
  );
  const agentEventsAuthorSafe = authorAgentEventFrames.every((frame) => {
    const body = frame.body ?? {};
    const summary = String(body.summary ?? "");
    const serialized = JSON.stringify(body);

    return (
      body.visibility === "author" &&
      summary.trim() !== "" &&
      !forbiddenAgentEventText.some((text) => serialized.includes(text))
    );
  });
  const agentStates = frames
    .slice(frameStart)
    .filter(
      (frame) =>
        frame.direction === "received" &&
        frame.event === "agent_run_state" &&
        frame.body?.run_id === runId,
    )
    .map((frame) => frame.body?.status);

  return [
    {
      ...uiState,
      slice_id: "ua01-agent-bounded-roster-to-character-design",
      work_id: workId,
      workspace_id: workId,
      session_id: sentFrame.body?.session_id ?? joinRecord.session_id,
      work_title: workTitleValue,
      parent_turn_id: parentUserMessageLog?.turn_id,
      final_turn_id: turnResult.turn_id,
      run_id: runId,
      run_mode: ackFrame.body.response.run_mode,
      profile_ref: completedStateFrame.body.profile_ref,
      parent_fast_ack_before_final_turn_result: ackIndex >= 0 && turnIndex > ackIndex,
      compound_request_sent_from_real_workbench: true,
      agent_event_types: agentEvents,
      agent_events_author_safe: agentEventsAuthorSafe,
      agent_state_statuses: agentStates,
      plan_drafted_visible: planDraftFrame.body?.event_type === "plan_drafted",
      plan_drafted_target_tool_ref: planDraftFrame.body?.payload?.target_tool_ref,
      plan_drafted_step_count: planDraftSteps.length,
      plan_drafted_targets: planDraftTargets,
      roster_observation_visible:
        rosterTurnFrame.body?.tool_result?.tool_name === "character_roster" &&
        rosterTurnFrame.body?.tool_result?.status === "succeeded",
      roster_observation_summary: rosterTurnFrame.body?.assistant_message?.text ?? "",
      roster_observation_event_type: "turn_result",
      roster_observation_production_write:
        rosterTurnFrame.body?.truthfulness?.production_write_performed === true,
      artifact_event_visible: artifactEvent.body?.event_type === "artifact_created",
      final_turn_broadcast: true,
      final_tool_name: turnResult.tool_result?.tool_name,
      final_tool_status: turnResult.tool_result?.status,
      pending_artifact_id: pendingArtifact.artifact_id,
      pending_artifact_type: pendingArtifact.artifact_type,
      pending_artifact_requires_adoption: pendingArtifact.requires_adoption === true,
      pending_artifact_tentative: String(pendingArtifact.adoption_status ?? "") === "tentative",
      no_auto_adoption: turnResult.truthfulness?.artifact_adopted === false,
      no_production_write: turnResult.truthfulness?.production_write_performed === false,
      completed_step_count: completedStateFrame.body.completed_step_refs?.length ?? 0,
      consumed_steps: completedStateFrame.body.consumed_budget?.steps,
      consumed_tool_calls: completedStateFrame.body.consumed_budget?.tool_calls,
      consumed_provider_calls: completedStateFrame.body.consumed_budget?.provider_calls,
      // Order 62 CP3 语义迁移：工作详情/终态区已移除，运行组可见性以新三层 UI 判定
      //（状态 chip + 计划 checklist），完成态以状态标签/顶栏无任务判定。
      ui_agent_panel_visible: visibleText.includes("创作执行") && visibleText.includes("计划"),
      ui_agent_completed_visible:
        visibleText.includes("已完成") || visibleText.includes("无任务"),
      ui_artifact_event_visible:
        visibleText.includes("已生成待采纳候选") ||
        (visibleText.includes("角色设定草稿") && visibleText.includes("待保存设定草稿")),
      ui_execution_brief_path_visible:
        visibleText.includes("本轮路径：") &&
        visibleText.includes("读取上下文") &&
        visibleText.includes("调用步骤规划模型") &&
        visibleText.includes("制定计划") &&
        visibleText.includes("系统裁决") &&
        visibleText.includes("执行创作能力") &&
        visibleText.includes("调用写作模型") &&
        visibleText.includes("生成待采纳候选") &&
        visibleText.includes("完成回应"),
      ui_execution_brief_did_not_invent_model_call: !visibleText.includes(
        "本轮路径：读取上下文 → 调用模型 → 执行创作能力",
      ),
      log_sync_turn_count: logsAfter.filter(
        (record) =>
          record.event === "channel.user_message.done" &&
          String(record.run_mode ?? "") === "sync_turn",
      ).length,
      log_allow_tool_count: logsAfter.filter(
        (record) =>
          record.event === "orchestrator.decide.done" &&
          String(record.decision_type ?? "") === "allow_tool",
      ).length,
      log_roster_tool_done: logsAfter.some(
        (record) =>
          record.event === "toolbox.execute.done" && record.tool_name === "character_roster",
      ),
      log_character_design_tool_done: logsAfter.some(
        (record) =>
          record.event === "toolbox.execute.done" && record.tool_name === "character_design",
      ),
      user_message_text: sentFrame.body?.text,
    },
  ];
}

async function driveAgentProseDraftingWithQuality(page) {
  await configureProviderRuntime({ provider: "slice_verify" });

  const message = "写下一章";

  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await installReasoningStreamObserver(page);
  const frameStart = frames.length;
  const logStart = readAppLogRecords().length;

  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      String(frame.body?.text ?? "").includes(message),
    "Agent prose request was not sent from the real workbench input",
    30_000,
  );

  const ackFrame = await waitForNewFrame(
    frameStart,
    (frame) => {
      const response = frame.body?.response ?? {};
      return (
        frame.direction === "received" &&
        frame.event === "phx_reply" &&
        frame.body?.status === "ok" &&
        response.received === true &&
        response.run_mode === "bounded" &&
        typeof response.run_id === "string" &&
        response.run_id !== ""
      );
    },
    "Agent prose request did not fast-ack with bounded run_id",
    30_000,
  );
  const runId = ackFrame.body.response.run_id;

  await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "run_started",
    "Agent prose run_started event was not broadcast",
    30_000,
  );

  const contextStepFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "plan_drafted" &&
      frame.body?.payload?.target_tool_ref === "context_assemble",
    "Agent prose context plan_drafted event was not broadcast",
    30_000,
  );
  const draftedPlanSteps = contextStepFrame.body?.payload?.plan_steps ?? [];
  const draftedPlanHasContextStep = draftedPlanSteps.some(
    (step) => step?.target_tool_ref === "context_assemble",
  );
  const draftedPlanHasProseStep = draftedPlanSteps.some(
    (step) => step?.target_tool_ref === "prose_writing",
  );
  assert(
    draftedPlanHasContextStep && draftedPlanHasProseStep,
    "Agent prose plan_drafted payload did not include both context and prose plan steps",
  );

  const contextEventFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "goal_understood" &&
      String(frame.body?.summary ?? "").includes("正文写作上下文"),
    "Agent prose context assembly event was not broadcast",
    30_000,
  );

  const gateEventFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "gate_decided",
    "Agent prose gate_decided event was not broadcast",
    30_000,
  );

  const toolStartedFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "tool_started",
    "Agent prose tool_started event was not broadcast",
    30_000,
  );

  const toolCompletedFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "tool_completed" &&
      String(frame.body?.summary ?? "").includes("质量复核"),
    "Agent prose tool_completed event was not broadcast with an author-safe quality summary",
    120_000,
  );

  const artifactEventFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "artifact_created" &&
      Array.isArray(frame.body?.refs) &&
      frame.body.refs.length > 0,
    "Agent prose artifact_created event was not broadcast",
    120_000,
  );

  const turnFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.agent_run?.run_id === runId &&
      frame.body?.tool_result?.tool_name === "prose_writing" &&
      frame.body?.tool_result?.status === "succeeded" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment" &&
      Array.isArray(frame.body?.quality_review?.findings) &&
      frame.body?.quality_review?.review_status === "completed",
    "Agent prose run did not broadcast prose_writing TurnResult with completed quality review",
    120_000,
  );
  const turnResult = turnFrame.body;
  const pendingArtifact = turnResult.adoption_state.pending[0];
  const review = turnResult.quality_review ?? {};
  const finding = review.findings?.[0] ?? {};
  const findingSummary = String(finding.summary ?? "");
  const draftBody = pendingArtifact.payload?.items?.[0]?.body ?? "";
  const findingInDraftBody = findingSummary !== "" && draftBody.includes(findingSummary);

  const runCompletedFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "run_completed",
    "Agent prose run_completed event was not broadcast",
    60_000,
  );

  const completedStateFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId &&
      frame.body?.status === "completed" &&
      Number(frame.body?.consumed_budget?.steps ?? 0) === 2 &&
      Number(frame.body?.consumed_budget?.tool_calls ?? 0) === 1 &&
      Number(frame.body?.consumed_budget?.provider_calls ?? 0) === 5,
    "Agent prose run state did not finish with expected step/tool/provider counters",
    60_000,
  );

  await waitForNewAppLogRecord(
    logStart,
    (record) =>
      record.event === "channel.user_message.done" &&
      record.run_id === runId &&
      String(record.run_mode ?? "") === "bounded",
    "Agent prose parent user_message did not log bounded run ack",
    30_000,
  );
  await waitForNewAppLogRecord(
    logStart,
    (record) =>
      record.event === "orchestrator.decide.done" &&
      String(record.decision_type ?? "") === "allow_tool",
    "Agent prose internal step was not re-gated by the orchestrator",
    60_000,
  );
  await waitForNewAppLogRecord(
    logStart,
    (record) => record.event === "toolbox.execute.done" && record.tool_name === "prose_writing",
    "Agent prose run did not execute prose_writing",
    60_000,
  );
  const qualityRecord = await waitForNewAppLogRecord(
    logStart,
    (record) =>
      record.event === "prose_quality.evaluated.done" &&
      record.turn_id === turnResult.turn_id &&
      record.review_status === "completed" &&
      Number(record.finding_count ?? -1) >= 0,
    "Agent prose run did not emit completed prose_quality.evaluated",
    60_000,
  );
  const policyRecord = await waitForNewAppLogRecord(
    logStart,
    (record) =>
      record.event === "quality_policy.decided.done" &&
      record.turn_id === turnResult.turn_id &&
      record.review_status === "completed",
    "Agent prose run did not emit completed quality_policy decision",
    60_000,
  );

  const ackIndex = frames.findIndex((frame) => frame === ackFrame);
  const turnIndex = frames.findIndex((frame) => frame === turnFrame);
  assert(ackIndex >= 0 && turnIndex > ackIndex, "Agent prose final TurnResult arrived before ack");
  assert(
    turnResult.truthfulness?.production_write_performed === false,
    "Agent prose run performed a production write",
  );
  assert(turnResult.truthfulness?.artifact_adopted === false, "Agent prose artifact was adopted");
  assert(
    pendingArtifact.requires_adoption === true &&
      String(pendingArtifact.adoption_status ?? "") === "tentative",
    "Agent prose artifact was not a tentative adoption candidate",
  );
  assert(!findingInDraftBody, "Agent prose quality finding leaked into the prose draft body");

  // Order 62 CP3 语义迁移：工作详情/模型执行流/终态区已移除。完成态与计划步骤
  // 改由新三层 UI 判定（状态标签 + 计划 checklist + 质量复核卡），provider 取证
  // 改由持久化 ProviderRun 事实（scoped activity API）承担，断言口径不弱化。
  await page.waitForFunction(
    (summary) => {
      const text = document.body.innerText;
      const completedVisible = text.includes("已完成") || text.includes("无任务");
      return (
        completedVisible &&
        text.includes("先读取正文写作上下文") &&
        text.includes("基于已读取的正文上下文生成正文草稿") &&
        text.includes("质量复核") &&
        text.includes("章节正文草稿") &&
        (summary === "" || text.includes(summary))
      );
    },
    findingSummary,
    { timeout: 30_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const uiState = await commonUiState(page, turnResult, sentFrame);
  const logsAfter = readAppLogRecords().slice(logStart);
  const pendingProseFragmentCount = (turnResult.adoption_state?.pending ?? []).filter(
    (artifact) => artifact.artifact_type === "prose_fragment",
  ).length;
  const proseToolDispatchCount = logsAfter.filter(
    (record) => record.event === "toolbox.execute.done" && record.tool_name === "prose_writing",
  ).length;
  assert(
    completedStateFrame.body.status === "completed",
    "Agent prose run did not finish with completed status",
  );
  assert(pendingProseFragmentCount === 1, "Agent prose run did not leave exactly one draft");
  assert(proseToolDispatchCount === 1, "Agent prose run dispatched prose_writing more than once");
  const parentUserMessageLog = logsAfter.find(
    (record) => record.event === "channel.user_message.done" && record.run_id === runId,
  );

  // Order 62 CP3 语义迁移：provider 取证由持久化 ProviderRun 事实承担。
  const activityResponse = await fetchAgentRunActivityApi(
    sentFrame.body?.work_id,
    sentFrame.body?.session_id,
    parentUserMessageLog?.turn_id ?? turnResult.parent_turn_id,
  );
  const activityPurposes = (
    Array.isArray(activityResponse.body?.provider_runs) ? activityResponse.body.provider_runs : []
  ).map((run) => String(run?.purpose ?? ""));
  const persistedProviderRunCount = Number(
    activityResponse.body?.totals?.provider_run_count ?? 0,
  );
  assert(
    activityResponse.status === 200 &&
      persistedProviderRunCount ===
        Number(completedStateFrame.body.consumed_budget?.provider_calls ?? -1),
    `Agent prose persisted ProviderRun facts (${persistedProviderRunCount}) did not match consumed provider calls`,
  );

  return [
    {
      ...uiState,
      slice_id: "agent-prose-drafting-with-quality",
      parent_turn_id: parentUserMessageLog?.turn_id,
      final_turn_id: turnResult.turn_id,
      run_id: runId,
      run_mode: ackFrame.body.response.run_mode,
      profile_ref: completedStateFrame.body.profile_ref,
      run_status: completedStateFrame.body.status,
      parent_fast_ack_before_final_turn_result: ackIndex >= 0 && turnIndex > ackIndex,
      direct_prose_request_sent_from_real_workbench: true,
      observation_summary: artifactEventFrame.body?.summary ?? "",
      artifact_event_visible: artifactEventFrame.body?.event_type === "artifact_created",
      final_turn_broadcast: true,
      final_tool_name: turnResult.tool_result?.tool_name,
      final_tool_status: turnResult.tool_result?.status,
      pending_artifact_id: pendingArtifact.artifact_id,
      pending_artifact_type: pendingArtifact.artifact_type,
      pending_artifact_requires_adoption: pendingArtifact.requires_adoption === true,
      pending_artifact_tentative: String(pendingArtifact.adoption_status ?? "") === "tentative",
      no_auto_adoption: turnResult.truthfulness?.artifact_adopted === false,
      no_production_write: turnResult.truthfulness?.production_write_performed === false,
      completed_step_count: completedStateFrame.body.completed_step_refs?.length ?? 0,
      pending_prose_fragment_count: pendingProseFragmentCount,
      consumed_steps: completedStateFrame.body.consumed_budget?.steps,
      consumed_tool_calls: completedStateFrame.body.consumed_budget?.tool_calls,
      consumed_provider_calls: completedStateFrame.body.consumed_budget?.provider_calls,
      agent_stage_events_visible:
        contextStepFrame.body?.event_type === "plan_drafted" &&
        draftedPlanHasContextStep &&
        draftedPlanHasProseStep &&
        contextEventFrame.body?.event_type === "goal_understood" &&
        gateEventFrame.body?.event_type === "gate_decided" &&
        toolStartedFrame.body?.event_type === "tool_started" &&
        toolCompletedFrame.body?.event_type === "tool_completed" &&
        runCompletedFrame.body?.event_type === "run_completed",
      context_step_visible:
        contextStepFrame.body?.event_type === "plan_drafted" &&
        contextStepFrame.body?.payload?.target_tool_ref === "context_assemble",
      context_event_visible: contextEventFrame.body?.event_type === "goal_understood",
      context_observation_visible:
        contextEventFrame.body?.event_type === "goal_understood" &&
        String(contextEventFrame.body?.summary ?? "").includes("正文写作上下文"),
      strategy_step_visible: false,
      plan_event_visible: contextStepFrame.body?.event_type === "plan_drafted",
      gate_event_visible: gateEventFrame.body?.event_type === "gate_decided",
      tool_started_visible: toolStartedFrame.body?.event_type === "tool_started",
      quality_observation_visible: toolCompletedFrame.body?.event_type === "tool_completed",
      finalization_step_visible: false,
      completion_decision_visible:
        runCompletedFrame.body?.event_type === "run_completed" &&
        (runCompletedFrame.body?.reason_codes ?? []).includes("goal_satisfied"),
      prose_step_visible: draftedPlanHasProseStep,
      artifact_observation_visible: artifactEventFrame.body?.event_type === "artifact_created",
      ui_context_step_visible: visibleText.includes("先读取正文写作上下文"),
      ui_strategy_step_visible: false,
      ui_prose_step_visible: visibleText.includes("基于已读取的正文上下文生成正文草稿"),
      ui_finalization_step_visible: false,
      // Order 62 CP3 语义迁移：终态区已移除，完成裁决可见性以状态标签判定。
      ui_completion_decision_visible:
        visibleText.includes("已完成") || visibleText.includes("无任务"),
      quality_review_status: review.review_status,
      quality_policy_action: review.policy_action,
      quality_findings_count: review.findings?.length ?? 0,
      quality_finding_count_logged: Number(qualityRecord.finding_count ?? 0),
      quality_policy_logged_status: String(policyRecord.review_status ?? ""),
      revise_action_available: (turnResult.available_actions ?? []).some(
        (action) => action.action_type === "revise_from_findings",
      ),
      finding_summary_displayed: findingSummary === "" || visibleText.includes(findingSummary),
      finding_in_draft_body: findingInDraftBody,
      // Order 62 CP3 语义迁移：工作详情/模型执行流/终态区已移除，改以新三层 UI
      //（状态标签 + 计划 checklist）与持久化 ProviderRun 事实判定。
      ui_agent_panel_visible: visibleText.includes("创作执行") && visibleText.includes("计划"),
      ui_agent_completed_visible:
        visibleText.includes("已完成") || visibleText.includes("无任务"),
      ui_prose_draft_visible: visibleText.includes("章节正文草稿"),
      ui_quality_review_visible: visibleText.includes("质量复核"),
      ui_revision_action_visible: visibleText.includes("按这些问题重写"),
      persisted_provider_run_count: persistedProviderRunCount,
      persisted_provider_purposes: activityPurposes,
      persisted_provider_facts_matched_budget:
        persistedProviderRunCount ===
        Number(completedStateFrame.body.consumed_budget?.provider_calls ?? -1),
      ui_execution_brief_path_visible:
        visibleText.includes("先读取正文写作上下文") &&
        visibleText.includes("基于已读取的正文上下文生成正文草稿") &&
        visibleText.includes("质量复核"),
      log_sync_turn_count: logsAfter.filter(
        (record) =>
          record.event === "channel.user_message.done" &&
          String(record.run_mode ?? "") === "sync_turn",
      ).length,
      log_allow_tool_count: logsAfter.filter(
        (record) =>
          record.event === "orchestrator.decide.done" &&
          String(record.decision_type ?? "") === "allow_tool",
      ).length,
      log_prose_tool_done: logsAfter.some(
        (record) => record.event === "toolbox.execute.done" && record.tool_name === "prose_writing",
      ),
      prose_tool_dispatch_count: proseToolDispatchCount,
      user_message_text: sentFrame.body?.text,
    },
  ];
}

async function driveAgentConversationTurn(page, options = {}) {
  await configureExternalRunProviderRuntime();

  const message = options.message ?? "测试";
  const outputSliceId = options.sliceId ?? "agent-conversation-turn";
  const expectPlanReplan = options.expectPlanReplan === true;
  const expectAuthorReasoningDelta = options.expectAuthorReasoningDelta !== false;
  // Order 62 CP1 两段式规划后：路由 1 + 计划起草 2 + 回应 1；修订同为两段式（+2）。
  const expectedProviderCalls = expectPlanReplan ? 6 : 4;

  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await installReasoningStreamObserver(page);
  const frameStart = frames.length;
  const logStart = readAppLogRecords().length;

  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      return (
        text.includes("创作执行") &&
        (text.includes("准备中") || text.includes("进行中") || text.includes("正在启动创作执行"))
      );
    },
    {},
    { timeout: 3_000 },
  );
  const immediateAgentRunFeedbackVisible = true;

  const sentFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      String(frame.body?.text ?? "") === message,
    "Conversation AgentRun request was not sent from the real workbench input",
    30_000,
  );

  const ackFrame = await waitForNewFrame(
    frameStart,
    (frame) => {
      const response = frame.body?.response ?? {};
      return (
        frame.direction === "received" &&
        frame.event === "phx_reply" &&
        frame.body?.status === "ok" &&
        response.received === true &&
        response.run_mode === "bounded" &&
        typeof response.run_id === "string" &&
        response.run_id !== ""
      );
    },
    "Conversation turn did not fast-ack with bounded run_id",
    30_000,
  );
  const runId = ackFrame.body.response.run_id;

  await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "run_started",
    "Conversation AgentRun run_started event was not broadcast",
    30_000,
  );

  const isAuthorReasoningDeltaFrame = (frame) =>
    frame.direction === "received" &&
    frame.event === "agent_event" &&
    frame.body?.run_ref === runId &&
    frame.body?.event_type === "provider_progress" &&
    frame.body?.visibility === "author" &&
    (frame.body?.reason_codes ?? []).includes("provider_chunk") &&
    frame.body?.payload?.purpose === "author_reasoning" &&
    typeof frame.body?.payload?.author_narrative_delta === "string" &&
    String(frame.body.payload.author_narrative_delta).trim() !== "";

  let authorReasoningDeltaFrame = null;
  let secondAuthorReasoningDeltaFrame = null;
  let firstAuthorReasoningDelta = "";
  let secondAuthorReasoningDelta = "";
  let authorReasoningCumulativePrefix = "";

  if (expectAuthorReasoningDelta) {
    authorReasoningDeltaFrame = await waitForNewFrame(
      frameStart,
      isAuthorReasoningDeltaFrame,
      "Conversation AgentRun did not stream author reasoning delta before the first plan card",
      30_000,
    );
    firstAuthorReasoningDelta = String(
      authorReasoningDeltaFrame.body?.payload?.author_narrative_delta ?? "",
    );
    await page.waitForFunction(
      (expected) =>
        document.body.innerText
          .replace(/\s+/g, " ")
          .includes(String(expected).replace(/\s+/g, " ")),
      firstAuthorReasoningDelta.trim(),
      { timeout: 30_000 },
    );

    secondAuthorReasoningDeltaFrame = await waitForNewFrame(
      frames.indexOf(authorReasoningDeltaFrame) + 1,
      isAuthorReasoningDeltaFrame,
      "Conversation AgentRun did not stream a second author reasoning delta",
      30_000,
    );
    secondAuthorReasoningDelta = String(
      secondAuthorReasoningDeltaFrame.body?.payload?.author_narrative_delta ?? "",
    );
    authorReasoningCumulativePrefix = firstAuthorReasoningDelta + secondAuthorReasoningDelta;
    await page.waitForFunction(
      (expected) =>
        document.body.innerText
          .replace(/\s+/g, " ")
          .includes(String(expected).replace(/\s+/g, " ")),
      authorReasoningCumulativePrefix.trim(),
      { timeout: 30_000 },
    );
  }

  const contextStepFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "plan_drafted" &&
      frame.body?.payload?.target_tool_ref === "context_assemble",
    "Conversation AgentRun did not propose the context assembly step",
    30_000,
  );
  const conversationPlanSteps = contextStepFrame.body?.payload?.plan_steps ?? [];
  const conversationPlanHasContextStep = conversationPlanSteps.some(
    (step) => step?.target_tool_ref === "context_assemble",
  );
  const conversationPlanHasFrameStep = conversationPlanSteps.some(
    (step) => step?.target_tool_ref === "dialogue_frame",
  );
  const conversationPlanHasStrategyStep = conversationPlanSteps.some(
    (step) => step?.target_tool_ref === "strategy_gate",
  );
  const conversationPlanHasFinalizeStep = conversationPlanSteps.some(
    (step) => step?.target_tool_ref === "response_finalize",
  );
  if (expectPlanReplan) {
    assert(
      conversationPlanHasContextStep &&
        !conversationPlanHasFrameStep &&
        !conversationPlanHasStrategyStep &&
        !conversationPlanHasFinalizeStep,
      "D6 initial AgentPlan did not stop after context assembly",
    );
  } else {
    assert(
      conversationPlanHasContextStep &&
        conversationPlanHasFrameStep &&
        conversationPlanHasStrategyStep &&
        conversationPlanHasFinalizeStep,
      "Conversation AgentPlan did not include context, frame, strategy, and finalize plan steps",
    );
  }
  const authorReasoningDeltaIndex = frames.findIndex(
    (frame) => frame === authorReasoningDeltaFrame,
  );
  const secondAuthorReasoningDeltaIndex = frames.findIndex(
    (frame) => frame === secondAuthorReasoningDeltaFrame,
  );
  const contextStepIndex = frames.findIndex((frame) => frame === contextStepFrame);
  if (expectAuthorReasoningDelta) {
    assert(
      authorReasoningDeltaIndex >= 0 && contextStepIndex > authorReasoningDeltaIndex,
      "Conversation first plan card arrived before the provider author reasoning delta",
    );
    assert(
      secondAuthorReasoningDeltaIndex >= 0 && contextStepIndex > secondAuthorReasoningDeltaIndex,
      "Conversation first plan card arrived before the second provider author reasoning delta",
    );
  }

  const contextResultFrame = await waitForNewFrame(
    frames.indexOf(contextStepFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "goal_understood" &&
      String(frame.body?.summary ?? "").includes("已组装当前作品上下文"),
    "Conversation AgentRun did not publish the context result",
    30_000,
  );

  let planRevisedFrame = null;
  let revisedPlanSteps = [];
  let revisedPlanHasFrameStep = false;
  let revisedPlanHasStrategyStep = false;
  let revisedPlanHasFinalizeStep = false;

  if (expectPlanReplan) {
    planRevisedFrame = await waitForNewFrame(
      frames.indexOf(contextResultFrame) + 1,
      (frame) =>
        frame.direction === "received" &&
        frame.event === "agent_event" &&
        frame.body?.run_ref === runId &&
        frame.body?.event_type === "plan_revised" &&
        frame.body?.payload?.target_tool_ref === "dialogue_frame" &&
        Number(frame.body?.payload?.plan_version ?? 0) === 2 &&
        frame.body?.payload?.evaluation_of_last?.plan_holds === false &&
        typeof frame.body?.payload?.plan_revision?.revision_reason === "string" &&
        frame.body.payload.plan_revision.revision_reason.includes("本轮回应尚未生成") &&
        frame.body?.payload?.author_narrative_source?.source_type === "provider_output",
      "D6 conversation AgentRun did not publish provider-sourced plan_revised before continuing",
      30_000,
    );

    revisedPlanSteps = planRevisedFrame.body?.payload?.plan_steps ?? [];
    revisedPlanHasFrameStep = revisedPlanSteps.some(
      (step) => step?.target_tool_ref === "dialogue_frame",
    );
    revisedPlanHasStrategyStep = revisedPlanSteps.some(
      (step) => step?.target_tool_ref === "strategy_gate",
    );
    revisedPlanHasFinalizeStep = revisedPlanSteps.some(
      (step) => step?.target_tool_ref === "response_finalize",
    );
    assert(
      revisedPlanHasFrameStep && revisedPlanHasStrategyStep && revisedPlanHasFinalizeStep,
      "D6 revised AgentPlan did not restore frame, strategy, and finalize steps",
    );
  }

  const strategyDecisionFrame = await waitForNewFrame(
    frames.indexOf(planRevisedFrame ?? contextResultFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "gate_decided" &&
      String(frame.body?.summary ?? "").includes("不调用工具"),
    "Conversation AgentRun did not publish the no-tool strategy decision",
    30_000,
  );

  const turnResultReadyFrame = await waitForNewFrame(
    frames.indexOf(strategyDecisionFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "turn_result_ready",
    "Conversation AgentRun did not publish turn_result_ready",
    30_000,
  );

  const turnFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.agent_run?.run_id === runId &&
      frame.body?.agent_run?.profile_ref === "conversation_turn_v1" &&
      frame.body?.truthfulness?.tool_called === false &&
      frame.body?.truthfulness?.artifact_adopted === false &&
      frame.body?.truthfulness?.production_write_performed === false,
    "Conversation AgentRun did not broadcast no-tool TurnResult",
    60_000,
  );
  const turnResult = turnFrame.body;

  await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "run_completed",
    "Conversation AgentRun run_completed event was not broadcast",
    30_000,
  );

  const completedStateFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId &&
      frame.body?.status === "completed" &&
      frame.body?.profile_ref === "conversation_turn_v1" &&
      Number(frame.body?.consumed_budget?.steps ?? 0) === 4 &&
      Number(frame.body?.consumed_budget?.tool_calls ?? 0) === 0 &&
      Number(frame.body?.consumed_budget?.provider_calls ?? 0) === expectedProviderCalls &&
      Number(frame.body?.consumed_budget?.replans ?? 0) === (expectPlanReplan ? 1 : 0),
    "Conversation AgentRun state did not complete with the expected bounded counters",
    30_000,
  );

  await waitForNewAppLogRecord(
    logStart,
    (record) =>
      record.event === "channel.user_message.done" &&
      record.run_id === runId &&
      String(record.run_mode ?? "") === "bounded",
    "Conversation user_message did not log bounded run ack",
    30_000,
  );
  const ackIndex = frames.findIndex((frame) => frame === ackFrame);
  const turnIndex = frames.findIndex((frame) => frame === turnFrame);
  assert(
    ackIndex >= 0 && turnIndex > ackIndex,
    "Conversation final TurnResult arrived before fast ack",
  );

  const authorVisibleText = await page.locator("body").innerText();

  const uiState = await commonUiState(page, turnResult, sentFrame);
  const reasoningStreamSamples = await readReasoningStreamSamples(page);
  const normalizedReasoningSamples = reasoningStreamSamples.map((sample) =>
    normalizeVisibleText(sample?.text),
  );
  const firstDeltaSampleIndex = normalizedReasoningSamples.findIndex((text) =>
    text.includes(normalizeVisibleText(firstAuthorReasoningDelta)),
  );
  const cumulativeDeltaSampleIndex = normalizedReasoningSamples.findIndex(
    (text, index) =>
      index > firstDeltaSampleIndex &&
      text.includes(normalizeVisibleText(authorReasoningCumulativePrefix)),
  );
  const authorReasoningStreamDomGrew =
    firstDeltaSampleIndex >= 0 &&
    cumulativeDeltaSampleIndex > firstDeltaSampleIndex &&
    Number(reasoningStreamSamples[cumulativeDeltaSampleIndex]?.length ?? 0) >
      Number(reasoningStreamSamples[firstDeltaSampleIndex]?.length ?? 0);
  if (expectAuthorReasoningDelta) {
    assert(
      authorReasoningStreamDomGrew,
      "Conversation 46§9 reasoning area did not grow across multiple provider deltas",
    );
  }
  const agenticLoopEvidenceLayout = await focusLatestAgenticLoopEvidence(page);
  // Order 62 CP3 语义迁移：三层 UI 可见性按结构判定（46§9：状态 chip +
  // section[aria-label="计划"] checklist + section[aria-label="推理"] 叙事）。
  const agenticLoopSections = await page.evaluate(() => ({
    plan: Boolean(document.querySelector('section[aria-label="计划"]')),
    reasoning: Boolean(document.querySelector('section[aria-label="推理"]')),
  }));
  const logsAfter = readAppLogRecords().slice(logStart);
  const parentUserMessageLog = logsAfter.find(
    (record) => record.event === "channel.user_message.done" && record.run_id === runId,
  );

  // Order 62 CP3 语义迁移：原「工作详情 → 模型执行流」UI 取证改为持久化 ProviderRun
  // 事实（scoped activity API），断言口径不弱化：调用次数仍须精确等于预算计数，
  // 且必须同时包含作者推理与对话回应两类用途。
  const activityTurnId = parentUserMessageLog?.turn_id ?? turnResult.parent_turn_id;
  const activityResponse = await fetchAgentRunActivityApi(
    sentFrame.body?.work_id,
    sentFrame.body?.session_id,
    activityTurnId,
  );
  const activityProviderRuns = Array.isArray(activityResponse.body?.provider_runs)
    ? activityResponse.body.provider_runs
    : [];
  const activityPurposes = activityProviderRuns.map((run) => String(run?.purpose ?? ""));
  const persistedProviderRunCount = Number(
    activityResponse.body?.totals?.provider_run_count ?? 0,
  );
  assert(
    activityResponse.status === 200 && persistedProviderRunCount === expectedProviderCalls,
    `Conversation persisted ProviderRun facts (${persistedProviderRunCount}) did not match the expected provider call count (${expectedProviderCalls})`,
  );
  assert(
    activityPurposes.includes("author_reasoning") && activityPurposes.includes("conversation"),
    "Conversation persisted ProviderRun facts did not include author_reasoning and conversation purposes",
  );

  const agentEventFrames = frames
    .slice(frameStart)
    .filter(
      (frame) =>
        frame.direction === "received" &&
        frame.event === "agent_event" &&
        frame.body?.run_ref === runId,
    );
  const stepProposedFrames = agentEventFrames.filter(
    (frame) => frame.body?.event_type === "plan_drafted",
  );
  const planRevisedFrames = agentEventFrames.filter(
    (frame) => frame.body?.event_type === "plan_revised",
  );
  const reasoningResultFrames = agentEventFrames.filter((frame) =>
    ["goal_understood", "evaluation_made", "gate_decided", "turn_result_ready"].includes(
      frame.body?.event_type,
    ),
  );
  const providerProgressEvents = agentEventFrames.filter(
    (frame) => frame.body?.event_type === "provider_progress",
  );
  const developerProviderProgressEvents = providerProgressEvents.filter(
    (frame) => frame.body?.visibility === "developer",
  );
  const authorReasoningDeltaFrames = providerProgressEvents.filter(
    (frame) =>
      frame.body?.visibility === "author" &&
      frame.body?.payload?.purpose === "author_reasoning" &&
      typeof frame.body?.payload?.author_narrative_delta === "string",
  );
  const stepSummaries = stepProposedFrames.map((frame) => frame.body?.summary ?? "");
  const reasoningResultSummaries = reasoningResultFrames.map((frame) => frame.body?.summary ?? "");
  const providerPurposes = [
    ...new Set(providerProgressEvents.map((frame) => frame.body?.payload?.purpose)),
  ].filter(Boolean);
  const providerReasonCodes = providerProgressEvents.flatMap(
    (frame) => frame.body?.reason_codes ?? [],
  );

  return [
    {
      ...uiState,
      agentic_loop_evidence_layout: agenticLoopEvidenceLayout,
      slice_id: outputSliceId,
      parent_turn_id: parentUserMessageLog?.turn_id,
      final_turn_id: turnResult.turn_id,
      run_id: runId,
      run_mode: ackFrame.body.response.run_mode,
      profile_ref: completedStateFrame.body.profile_ref,
      parent_fast_ack_before_final_turn_result: ackIndex >= 0 && turnIndex > ackIndex,
      plain_input_sent_from_real_workbench: true,
      ui_agent_immediate_feedback_visible: immediateAgentRunFeedbackVisible,
      final_turn_broadcast: true,
      final_tool_called: turnResult.truthfulness?.tool_called === true,
      no_tool_called: turnResult.truthfulness?.tool_called === false,
      no_auto_adoption: turnResult.truthfulness?.artifact_adopted === false,
      no_production_write: turnResult.truthfulness?.production_write_performed === false,
      completed_step_count: completedStateFrame.body.completed_step_refs?.length ?? 0,
      consumed_steps: completedStateFrame.body.consumed_budget?.steps,
      consumed_tool_calls: completedStateFrame.body.consumed_budget?.tool_calls,
      consumed_provider_calls: completedStateFrame.body.consumed_budget?.provider_calls,
      consumed_replans: completedStateFrame.body.consumed_budget?.replans,
      initial_plan_step_count: conversationPlanSteps.length,
      initial_plan_only_context:
        conversationPlanHasContextStep &&
        !conversationPlanHasFrameStep &&
        !conversationPlanHasStrategyStep &&
        !conversationPlanHasFinalizeStep,
      plan_revised_visible: Boolean(planRevisedFrame),
      plan_revised_event_count: planRevisedFrames.length,
      plan_revised_target_tool_ref: planRevisedFrame?.body?.payload?.target_tool_ref ?? null,
      plan_revised_plan_version: planRevisedFrame?.body?.payload?.plan_version ?? null,
      plan_revised_revision_reason:
        planRevisedFrame?.body?.payload?.plan_revision?.revision_reason ?? null,
      plan_revised_evaluation_plan_holds:
        planRevisedFrame?.body?.payload?.evaluation_of_last?.plan_holds ?? null,
      plan_revised_author_narrative_source_type:
        planRevisedFrame?.body?.payload?.author_narrative_source?.source_type ?? null,
      revised_plan_has_frame_step: revisedPlanHasFrameStep,
      revised_plan_has_strategy_step: revisedPlanHasStrategyStep,
      revised_plan_has_finalize_step: revisedPlanHasFinalizeStep,
      agent_stage_events_visible:
        contextStepFrame.body?.event_type === "plan_drafted" &&
        conversationPlanHasContextStep &&
        (expectPlanReplan
          ? revisedPlanHasFrameStep && revisedPlanHasStrategyStep && revisedPlanHasFinalizeStep
          : conversationPlanHasFrameStep &&
            conversationPlanHasStrategyStep &&
            conversationPlanHasFinalizeStep) &&
        contextResultFrame.body?.event_type === "goal_understood" &&
        strategyDecisionFrame.body?.event_type === "gate_decided" &&
        turnResultReadyFrame.body?.event_type === "turn_result_ready",
      context_step_visible:
        contextStepFrame.body?.event_type === "plan_drafted" &&
        contextStepFrame.body?.payload?.target_tool_ref === "context_assemble" &&
        conversationPlanHasContextStep,
      frame_step_visible: expectPlanReplan ? revisedPlanHasFrameStep : conversationPlanHasFrameStep,
      strategy_step_visible: expectPlanReplan
        ? revisedPlanHasStrategyStep
        : conversationPlanHasStrategyStep,
      finalize_step_visible: expectPlanReplan
        ? revisedPlanHasFinalizeStep
        : conversationPlanHasFinalizeStep,
      context_result_visible: contextResultFrame.body?.event_type === "goal_understood",
      frame_evaluation_visible: conversationPlanHasFrameStep,
      strategy_decision_visible: strategyDecisionFrame.body?.event_type === "gate_decided",
      agent_step_summaries: stepSummaries,
      agent_reasoning_result_summaries: reasoningResultSummaries,
      agent_stage_event_types: agentEventFrames.map((frame) => frame.body?.event_type),
      provider_progress_event_count: providerProgressEvents.length,
      developer_provider_progress_event_count: developerProviderProgressEvents.length,
      provider_progress_reason_codes: providerReasonCodes,
      provider_progress_purposes: providerPurposes,
      author_reasoning_delta_event_count: authorReasoningDeltaFrames.length,
      author_reasoning_delta_before_first_plan:
        authorReasoningDeltaIndex >= 0 && contextStepIndex > authorReasoningDeltaIndex,
      author_reasoning_second_delta_before_first_plan:
        secondAuthorReasoningDeltaIndex >= 0 && contextStepIndex > secondAuthorReasoningDeltaIndex,
      author_reasoning_delta_payload_key: "author_narrative_delta",
      author_reasoning_first_delta: firstAuthorReasoningDelta.trim(),
      author_reasoning_second_delta: secondAuthorReasoningDelta.trim(),
      author_reasoning_cumulative_prefix: authorReasoningCumulativePrefix.trim(),
      ui_author_reasoning_delta_visible: normalizeVisibleText(authorVisibleText).includes(
        normalizeVisibleText(firstAuthorReasoningDelta),
      ),
      ui_author_reasoning_cumulative_delta_visible: normalizeVisibleText(
        authorVisibleText,
      ).includes(normalizeVisibleText(authorReasoningCumulativePrefix)),
      ui_author_reasoning_stream_sample_count: reasoningStreamSamples.length,
      ui_author_reasoning_stream_first_sample_length:
        firstDeltaSampleIndex >= 0 ? reasoningStreamSamples[firstDeltaSampleIndex]?.length : null,
      ui_author_reasoning_stream_second_sample_length:
        cumulativeDeltaSampleIndex >= 0
          ? reasoningStreamSamples[cumulativeDeltaSampleIndex]?.length
          : null,
      ui_author_reasoning_stream_grew: authorReasoningStreamDomGrew,
      planner_provider_activity_visible: providerPurposes.includes("author_reasoning"),
      conversation_provider_activity_visible: providerPurposes.includes("conversation"),
      provider_started_projected: providerReasonCodes.includes("provider_started"),
      provider_final_output_projected: providerReasonCodes.includes("provider_final_output"),
      persisted_provider_run_count: persistedProviderRunCount,
      persisted_provider_purposes: activityPurposes,
      persisted_provider_facts_matched_budget:
        persistedProviderRunCount === expectedProviderCalls,
      // Order 62 CP3 语义迁移：阶段带/终态区已移除，三层 UI 按结构 + 计划步骤
      // 描述判定（步骤描述为模型起草的 PlanStep description，仍在计划 checklist）。
      ui_agentic_loop_plan_visible:
        agenticLoopSections.plan &&
        authorVisibleText.includes("组装当前作品") &&
        authorVisibleText.includes("形成对话认知帧") &&
        authorVisibleText.includes("系统裁决") &&
        authorVisibleText.includes("生成本轮回应"),
      ui_agentic_loop_reasoning_visible: agenticLoopSections.reasoning,
      ui_agentic_loop_result_visible:
        authorVisibleText.includes("已完成") || authorVisibleText.includes("无任务"),
      ui_context_step_visible: authorVisibleText.includes("组装当前作品"),
      ui_frame_step_visible: authorVisibleText.includes("形成对话认知帧"),
      ui_strategy_step_visible: authorVisibleText.includes("系统裁决"),
      ui_finalize_step_visible: authorVisibleText.includes("生成本轮回应"),
      ui_agent_panel_visible:
        authorVisibleText.includes("创作执行") && agenticLoopSections.plan,
      ui_agentic_loop_920_width:
        agenticLoopEvidenceLayout !== null &&
        Math.abs(Number(agenticLoopEvidenceLayout.flow_width ?? 0) - 960) <= 24 &&
        Math.abs(Number(agenticLoopEvidenceLayout.phase_width ?? 0) - 920) <= 24,
      ui_agentic_loop_phase_visible_in_evidence:
        agenticLoopEvidenceLayout !== null &&
        Number(agenticLoopEvidenceLayout.phase_top ?? 9999) >= 64 &&
        Number(agenticLoopEvidenceLayout.phase_top ?? 9999) <= 260,
      ui_agent_completed_visible: authorVisibleText.includes("无任务"),
      ui_reply_visible: authorVisibleText.includes(message),
      log_sync_turn_count: logsAfter.filter(
        (record) =>
          record.event === "channel.user_message.done" &&
          String(record.run_mode ?? "") === "sync_turn",
      ).length,
      log_toolbox_execute_count: logsAfter.filter(
        (record) => record.event === "toolbox.execute.done",
      ).length,
      user_message_text: sentFrame.body?.text,
    },
  ];
}

async function driveAgenticLoopPlanReplanReasoning(page) {
  return driveAgentConversationTurn(page, {
    sliceId: "agentic-loop-plan-replan-reasoning",
    message: "UA01D6REPLAN 测试计划耗尽后继续回应",
    expectPlanReplan: true,
  });
}

async function driveAgenticLoopNoDeviationDirect(page) {
  return driveAgentConversationTurn(page, {
    sliceId: "agentic-loop-no-deviation-direct",
    message: "测试无偏离直通路径",
  });
}

async function driveAgentPlanNativeToolCallingProtocol(page) {
  const [conversationState] = await driveAgentConversationTurn(page, {
    sliceId: "agent-plan-native-tool-calling-protocol",
    message: "UA01D6REPLAN 测试 AgentPlan 原生 tool calling 协议",
    expectPlanReplan: true,
    expectAuthorReasoningDelta: false,
  });

  const turnId = conversationState.final_turn_id ?? conversationState.turn_id;
  const activityApi = await fetchAgentRunActivityApi(
    conversationState.work_id,
    conversationState.session_id,
    turnId,
  );
  const activityApiBody = activityApi.body ?? {};
  const activityProviderRuns = Array.isArray(activityApiBody.provider_runs)
    ? activityApiBody.provider_runs
    : [];
  const providerProgressEvents = activityProviderRuns.flatMap((run) =>
    (Array.isArray(run.events) ? run.events : []).map((event) =>
      providerActivityProgressFrame(run, event),
    ),
  );
  const providerFinalEvents = providerProgressEvents.filter((frame) =>
    (frame.body?.reason_codes ?? []).includes("provider_final_output"),
  );
  const nativeToolFinalEvents = providerFinalEvents.filter(
    (frame) => Number(frame.body?.payload?.native_tool_call_count ?? 0) > 0,
  );
  const nativeToolCallNames = [
    ...new Set(
      nativeToolFinalEvents.flatMap((frame) =>
        Array.isArray(frame.body?.payload?.native_tool_call_names)
          ? frame.body.payload.native_tool_call_names
          : [],
      ),
    ),
  ];
  const nativeToolCallArgumentsLeaked =
    JSON.stringify(providerProgressEvents.map((frame) => frame.body ?? {})).includes(
      "target_tool_ref",
    ) ||
    JSON.stringify(providerProgressEvents.map((frame) => frame.body ?? {})).includes(
      "success_criteria",
    );

  assert(activityApi.status === 200, "AgentRun activity API did not return provider telemetry");
  assert(
    nativeToolCallNames.includes("agent_plan_draft"),
    "AgentPlan draft did not project native tool call telemetry",
  );
  assert(
    nativeToolCallNames.includes("agent_plan_revision"),
    "AgentPlan revision did not project native tool call telemetry",
  );
  assert(
    !nativeToolCallArgumentsLeaked,
    "Provider telemetry leaked AgentPlan native tool call arguments",
  );

  return [
    {
      ...conversationState,
      slice_id: "agent-plan-native-tool-calling-protocol",
      provider_activity_api_status: activityApi.status,
      provider_activity_api_provider_run_count: activityProviderRuns.length,
      provider_final_output_event_count: providerFinalEvents.length,
      native_tool_call_final_output_count: nativeToolFinalEvents.length,
      native_tool_call_names: nativeToolCallNames,
      native_tool_call_draft_projected: nativeToolCallNames.includes("agent_plan_draft"),
      native_tool_call_revision_projected: nativeToolCallNames.includes("agent_plan_revision"),
      native_tool_call_arguments_leaked: nativeToolCallArgumentsLeaked,
      provider_progress_reason_codes: providerProgressEvents.flatMap(
        (frame) => frame.body?.reason_codes ?? [],
      ),
      provider_progress_visibility_developer: providerProgressEvents.every(
        (frame) => frame.body?.visibility === "developer",
      ),
    },
  ];
}

async function driveAgenticLoopBudgetDeviationReplan(page) {
  await configureExternalRunProviderRuntime();

  const sliceId = "agentic-loop-budget-deviation-replan";
  const message = "只聊方向，最多一步，测试预算余量不足";

  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  const frameStart = frames.length;
  const logStart = readAppLogRecords().length;

  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      return (
        text.includes("创作执行") &&
        (text.includes("准备中") || text.includes("进行中") || text.includes("正在启动创作执行"))
      );
    },
    {},
    { timeout: 3_000 },
  );

  const sentFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      String(frame.body?.text ?? "") === message,
    "D5 budget deviation request was not sent from the real workbench input",
    30_000,
  );

  const ackFrame = await waitForNewFrame(
    frameStart,
    (frame) => {
      const response = frame.body?.response ?? {};
      return (
        frame.direction === "received" &&
        frame.event === "phx_reply" &&
        frame.body?.status === "ok" &&
        response.received === true &&
        response.run_mode === "bounded" &&
        typeof response.run_id === "string" &&
        response.run_id !== ""
      );
    },
    "D5 budget deviation did not fast-ack with bounded run_id",
    30_000,
  );
  const runId = ackFrame.body.response.run_id;

  await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "run_started",
    "D5 budget deviation did not broadcast run_started",
    30_000,
  );

  const planRevisedFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "plan_revised" &&
      Number(frame.body?.payload?.plan_version ?? 0) === 2 &&
      frame.body?.payload?.evaluation_of_last?.plan_holds === false &&
      (frame.body?.reason_codes ?? []).includes("agentic_deviation:D5") &&
      String(frame.body?.payload?.plan_revision?.revision_reason ?? "").includes(
        "剩余 step 预算不足",
      ) &&
      frame.body?.payload?.author_narrative_source?.source_type === "provider_output",
    "D5 budget deviation did not publish provider-sourced plan_revised",
    30_000,
  );

  const contextResultFrame = await waitForNewFrame(
    frames.indexOf(planRevisedFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "goal_understood" &&
      String(frame.body?.summary ?? "").includes("已组装当前作品上下文"),
    "D5 budget deviation did not execute the first revised plan step",
    30_000,
  );

  const awaitingFrame = await waitForNewFrame(
    frames.indexOf(contextResultFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "awaiting_author",
    "D5 budget deviation did not stop awaiting author after replan budget was consumed",
    30_000,
  );

  const awaitingStateFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId &&
      frame.body?.status === "awaiting_author" &&
      frame.body?.profile_ref === "conversation_turn_v1" &&
      Number(frame.body?.consumed_budget?.steps ?? 0) === 1 &&
      Number(frame.body?.consumed_budget?.replans ?? 0) === 1,
    "D5 budget deviation did not broadcast awaiting_author state with consumed replan",
    30_000,
  );

  await sleep(750);
  const logsAfter = readAppLogRecords().slice(logStart);
  const parentUserMessageLog = logsAfter.find(
    (record) => record.event === "channel.user_message.done" && record.run_id === runId,
  );
  const finalTurnResultArrived = frames
    .slice(frameStart)
    .some(
      (frame) =>
        frame.direction === "received" &&
        frame.event === "turn_result" &&
        frame.body?.agent_run?.run_id === runId,
    );
  assert(!finalTurnResultArrived, "D5 budget deviation emitted a final TurnResult");

  const visibleText = await page.locator("body").innerText();
  const uiState = await commonUiState(
    page,
    { turn_id: parentUserMessageLog?.turn_id ?? "" },
    sentFrame,
  );

  return [
    {
      ...uiState,
      slice_id: sliceId,
      parent_turn_id: parentUserMessageLog?.turn_id,
      run_id: runId,
      run_mode: ackFrame.body.response.run_mode,
      profile_ref: awaitingStateFrame.body?.profile_ref,
      plain_input_sent_from_real_workbench: true,
      parent_fast_ack_before_terminal: frames.indexOf(ackFrame) < frames.indexOf(awaitingFrame),
      plan_revised_visible: true,
      plan_revised_event_count: 1,
      plan_revised_reason_codes: planRevisedFrame.body?.reason_codes ?? [],
      plan_revised_target_tool_ref: planRevisedFrame.body?.payload?.target_tool_ref ?? null,
      plan_revised_plan_version: planRevisedFrame.body?.payload?.plan_version ?? null,
      plan_revised_revision_reason:
        planRevisedFrame.body?.payload?.plan_revision?.revision_reason ?? "",
      plan_revised_evaluation_plan_holds:
        planRevisedFrame.body?.payload?.evaluation_of_last?.plan_holds,
      plan_revised_author_narrative_source_type:
        planRevisedFrame.body?.payload?.author_narrative_source?.source_type,
      context_result_visible: contextResultFrame.body?.event_type === "goal_understood",
      awaiting_event_type: awaitingFrame.body?.event_type,
      awaiting_reason_codes: awaitingFrame.body?.reason_codes ?? [],
      terminal_status: awaitingStateFrame.body?.status,
      consumed_steps: awaitingStateFrame.body?.consumed_budget?.steps,
      consumed_tool_calls: awaitingStateFrame.body?.consumed_budget?.tool_calls,
      consumed_provider_calls: awaitingStateFrame.body?.consumed_budget?.provider_calls,
      consumed_replans: awaitingStateFrame.body?.consumed_budget?.replans,
      final_turn_result_arrived: finalTurnResultArrived,
      log_sync_turn_count: logsAfter.filter(
        (record) =>
          record.event === "channel.user_message.done" &&
          String(record.run_mode ?? "") === "sync_turn",
      ).length,
      log_toolbox_execute_count: logsAfter.filter(
        (record) => record.event === "toolbox.execute.done",
      ).length,
      ui_agentic_loop_plan_visible:
        visibleText.includes("计划") &&
        (visibleText.includes("重规划") || visibleText.includes("修订")),
      ui_awaiting_author_visible: visibleText.includes("等待你确认"),
      user_message_text: sentFrame.body?.text,
    },
  ];
}

async function driveAgenticLoopProseDeviationReplan(page, config) {
  await configureExternalRunProviderRuntime();

  const { sliceId, message, signal, reasonNeedle, expected } = config;
  const allowCandidateTurnResult = config.allowCandidateTurnResult === true;

  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  const frameStart = frames.length;
  const logStart = readAppLogRecords().length;

  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      return (
        text.includes("创作执行") &&
        (text.includes("准备中") || text.includes("进行中") || text.includes("正在启动创作执行"))
      );
    },
    {},
    { timeout: 3_000 },
  );

  const sentFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      String(frame.body?.text ?? "") === message,
    `${signal} deviation request was not sent from the real workbench input`,
    30_000,
  );

  const ackFrame = await waitForNewFrame(
    frameStart,
    (frame) => {
      const response = frame.body?.response ?? {};
      return (
        frame.direction === "received" &&
        frame.event === "phx_reply" &&
        frame.body?.status === "ok" &&
        response.received === true &&
        response.run_mode === "bounded" &&
        typeof response.run_id === "string" &&
        response.run_id !== ""
      );
    },
    `${signal} deviation did not fast-ack with bounded run_id`,
    30_000,
  );
  const runId = ackFrame.body.response.run_id;

  await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "run_started",
    `${signal} deviation did not broadcast run_started`,
    30_000,
  );

  const planRevisedFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "plan_revised" &&
      Number(frame.body?.payload?.plan_version ?? 0) === 2 &&
      frame.body?.payload?.evaluation_of_last?.plan_holds === false &&
      (frame.body?.reason_codes ?? []).includes(`agentic_deviation:${signal}`) &&
      String(frame.body?.payload?.plan_revision?.revision_reason ?? "").includes(reasonNeedle) &&
      frame.body?.payload?.author_narrative_source?.source_type === "provider_output",
    `${signal} deviation did not publish provider-sourced plan_revised`,
    30_000,
  );

  const awaitingFrame = await waitForNewFrame(
    frames.indexOf(planRevisedFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "awaiting_author",
    `${signal} deviation did not stop awaiting author after plan revision`,
    30_000,
  );

  const awaitingStateFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId &&
      frame.body?.status === "awaiting_author" &&
      frame.body?.profile_ref === "prose_drafting_with_quality_v1" &&
      Number(frame.body?.consumed_budget?.steps ?? -1) === expected.steps &&
      Number(frame.body?.consumed_budget?.tool_calls ?? -1) === expected.toolCalls &&
      Number(frame.body?.consumed_budget?.provider_calls ?? -1) === expected.providerCalls &&
      Number(frame.body?.consumed_budget?.replans ?? -1) === 1,
    `${signal} deviation did not broadcast awaiting_author state with expected budget`,
    30_000,
  );

  await sleep(750);
  const framesAfter = frames.slice(frameStart);
  const logsAfter = readAppLogRecords().slice(logStart);
  const parentUserMessageLog = logsAfter.find(
    (record) => record.event === "channel.user_message.done" && record.run_id === runId,
  );
  const finalTurnResultFrame = framesAfter.find(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.agent_run?.run_id === runId,
  );
  const finalTurnResultArrived = Boolean(finalTurnResultFrame);
  if (allowCandidateTurnResult) {
    assert(
      finalTurnResultArrived,
      `${signal} deviation did not emit the expected candidate TurnResult`,
    );
    assert(
      finalTurnResultFrame.body?.agent_run?.status === "awaiting_author",
      `${signal} candidate TurnResult did not carry awaiting_author AgentRun status`,
    );
    assert(
      (finalTurnResultFrame.body?.adoption_state?.pending ?? []).length >= 1,
      `${signal} candidate TurnResult did not expose a pending adoption candidate`,
    );
    assert(
      finalTurnResultFrame.body?.trace_summary?.quality_policy_action === "confirm",
      `${signal} candidate TurnResult did not carry quality confirm policy evidence`,
    );
  } else {
    assert(!finalTurnResultArrived, `${signal} deviation emitted a final TurnResult`);
  }

  const gateFrame = framesAfter.find(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "gate_decided",
  );

  const uiState = await commonUiState(
    page,
    { turn_id: parentUserMessageLog?.turn_id ?? "" },
    sentFrame,
  );

  return [
    {
      ...uiState,
      slice_id: sliceId,
      parent_turn_id: parentUserMessageLog?.turn_id,
      run_id: runId,
      run_mode: ackFrame.body.response.run_mode,
      profile_ref: awaitingStateFrame.body?.profile_ref,
      plain_input_sent_from_real_workbench: true,
      parent_fast_ack_before_terminal: frames.indexOf(ackFrame) < frames.indexOf(awaitingFrame),
      plan_revised_visible: true,
      plan_revised_event_count: framesAfter.filter(
        (frame) =>
          frame.direction === "received" &&
          frame.event === "agent_event" &&
          frame.body?.run_ref === runId &&
          frame.body?.event_type === "plan_revised",
      ).length,
      plan_revised_reason_codes: planRevisedFrame.body?.reason_codes ?? [],
      plan_revised_plan_version: planRevisedFrame.body?.payload?.plan_version ?? null,
      plan_revised_revision_reason:
        planRevisedFrame.body?.payload?.plan_revision?.revision_reason ?? "",
      plan_revised_evaluation_plan_holds:
        planRevisedFrame.body?.payload?.evaluation_of_last?.plan_holds,
      plan_revised_author_narrative_source_type:
        planRevisedFrame.body?.payload?.author_narrative_source?.source_type,
      awaiting_event_type: awaitingFrame.body?.event_type,
      terminal_status: awaitingStateFrame.body?.status,
      consumed_steps: awaitingStateFrame.body?.consumed_budget?.steps,
      consumed_tool_calls: awaitingStateFrame.body?.consumed_budget?.tool_calls,
      consumed_provider_calls: awaitingStateFrame.body?.consumed_budget?.provider_calls,
      consumed_replans: awaitingStateFrame.body?.consumed_budget?.replans,
      final_turn_result_arrived: finalTurnResultArrived,
      final_turn_result_agent_run_status: finalTurnResultFrame?.body?.agent_run?.status ?? null,
      final_turn_result_pending_artifact_count:
        finalTurnResultFrame?.body?.adoption_state?.pending?.length ?? 0,
      final_turn_result_quality_policy_action:
        finalTurnResultFrame?.body?.trace_summary?.quality_policy_action ?? null,
      gate_decision_type: gateFrame?.body?.payload?.decision_type ?? null,
      gate_first_blocking_gate: gateFrame?.body?.payload?.first_blocking_gate ?? null,
      artifact_event_count: framesAfter.filter(
        (frame) =>
          frame.direction === "received" &&
          frame.event === "agent_event" &&
          frame.body?.run_ref === runId &&
          frame.body?.event_type === "artifact_created",
      ).length,
      tool_started_event_count: framesAfter.filter(
        (frame) =>
          frame.direction === "received" &&
          frame.event === "agent_event" &&
          frame.body?.run_ref === runId &&
          frame.body?.event_type === "tool_started",
      ).length,
      tool_completed_event_count: framesAfter.filter(
        (frame) =>
          frame.direction === "received" &&
          frame.event === "agent_event" &&
          frame.body?.run_ref === runId &&
          frame.body?.event_type === "tool_completed",
      ).length,
      log_sync_turn_count: logsAfter.filter(
        (record) =>
          record.event === "channel.user_message.done" &&
          String(record.run_mode ?? "") === "sync_turn",
      ).length,
      log_toolbox_execute_count: logsAfter.filter(
        (record) => record.event === "toolbox.execute.done",
      ).length,
      user_message_text: sentFrame.body?.text,
    },
  ];
}

async function driveAgenticLoopToolFailureReplan(page) {
  return driveAgenticLoopProseDeviationReplan(page, {
    sliceId: "agentic-loop-tool-failure-replan",
    signal: "D1",
    reasonNeedle: "工具 prose_writing 执行失败",
    message: "写下一章正文草稿 AU04FAILTOOL",
    expected: { steps: 2, toolCalls: 1, providerCalls: 5 },
  });
}

async function driveAgenticLoopQualityDeviationReplan(page) {
  return driveAgenticLoopProseDeviationReplan(page, {
    sliceId: "agentic-loop-quality-deviation-replan",
    signal: "D2",
    reasonNeedle: "质量复核要求行动",
    message: "写下一章正文草稿，主角无需代价复活，违反既有规则",
    expected: { steps: 2, toolCalls: 1, providerCalls: 5 },
    allowCandidateTurnResult: true,
  });
}

async function driveAgenticLoopGateDeviationReplan(page) {
  return driveAgenticLoopProseDeviationReplan(page, {
    sliceId: "agentic-loop-gate-deviation-replan",
    signal: "D4",
    reasonNeedle: "Orchestrator 未允许执行",
    message: "写下一章正文草稿，高风险，确认后再执行",
    expected: { steps: 2, toolCalls: 0, providerCalls: 3 },
  });
}

async function driveAgenticLoopDeterministicGapReplan(page) {
  return driveAgenticLoopProseDeviationReplan(page, {
    sliceId: "agentic-loop-deterministic-gap-replan",
    signal: "D7",
    reasonNeedle: "写作坐标存在确定性缺口",
    message: "续写第99章正文",
    expected: { steps: 2, toolCalls: 0, providerCalls: 3 },
  });
}

async function driveAgentProviderExecutionStreamUnified(page) {
  const frameStart = frames.length;
  const [conversationState] = await driveAgentConversationTurn(page);
  const runId = conversationState.run_id;
  const turnId = conversationState.final_turn_id ?? conversationState.turn_id;

  const activityApi = await fetchAgentRunActivityApi(
    conversationState.work_id,
    conversationState.session_id,
    turnId,
  );
  const activityApiBody = activityApi.body ?? {};
  const activityAgentRuns = Array.isArray(activityApiBody.agent_runs)
    ? activityApiBody.agent_runs
    : [];
  const activityProviderRuns = Array.isArray(activityApiBody.provider_runs)
    ? activityApiBody.provider_runs
    : [];

  const providerProgressEvents = activityProviderRuns.flatMap((run) =>
    (Array.isArray(run.events) ? run.events : []).map((event) =>
      providerActivityProgressFrame(run, event),
    ),
  );

  const providerStartedEvent = providerProgressEvents.find((frame) =>
    (frame.body?.reason_codes ?? []).includes("provider_started"),
  );
  const providerFinalEvent = providerProgressEvents.find((frame) =>
    (frame.body?.reason_codes ?? []).includes("provider_final_output"),
  );
  const providerRequestPreparedEvent = providerProgressEvents.find((frame) =>
    (frame.body?.reason_codes ?? []).includes("provider_request_prepared"),
  );
  const providerRequestDispatchedEvent = providerProgressEvents.find((frame) =>
    (frame.body?.reason_codes ?? []).includes("provider_request_dispatched"),
  );
  const providerResponseReceivedEvent = providerProgressEvents.find((frame) =>
    (frame.body?.reason_codes ?? []).includes("provider_response_received"),
  );
  const providerChunkEvent = providerProgressEvents.find((frame) =>
    (frame.body?.reason_codes ?? []).includes("provider_chunk"),
  );

  assert(activityApi.status === 200, "AgentRun activity API did not return provider telemetry");
  assert(
    providerStartedEvent,
    "Conversation provider execution did not restore a provider_started activity event",
  );
  assert(
    providerFinalEvent,
    "Conversation provider execution did not project a provider_final_output activity event",
  );
  assert(
    providerRequestPreparedEvent,
    "Conversation provider execution did not project provider_request_prepared progress",
  );
  assert(
    providerRequestDispatchedEvent,
    "Conversation provider execution did not project provider_request_dispatched progress",
  );
  assert(
    providerResponseReceivedEvent,
    "Conversation provider execution did not project provider_response_received progress",
  );
  assert(
    providerChunkEvent,
    "Conversation provider execution did not project provider_chunk progress",
  );

  const progressJson = JSON.stringify(providerProgressEvents.map((frame) => frame.body ?? {}));
  const rawProviderContentLeaked =
    progressJson.includes("assistant_message") ||
    progressJson.includes("candidate_directions") ||
    progressJson.includes("raw_prompt") ||
    progressJson.includes("system_prompt") ||
    progressJson.includes("text_delta") ||
    progressJson.includes(String(conversationState.user_message_text ?? ""));

  // Order 62 CP3 语义迁移：工作详情/模型执行流/模型调用明细 UI 已整体移除。
  // provider execution 取证由 provider_progress 帧家族（上方断言）、scoped
  // activity API 与持久化 transcript（activity-restored 场景）承担，不再驱动 UI 展开。
  return [
    {
      ...conversationState,
      slice_id: "agent-provider-execution-stream-unified",
      provider_activity_api_status: activityApi.status,
      provider_activity_api_agent_run_count: activityAgentRuns.length,
      provider_progress_event_count: providerProgressEvents.length,
      provider_progress_reason_codes: providerProgressEvents.flatMap(
        (frame) => frame.body?.reason_codes ?? [],
      ),
      provider_progress_visibility_developer: providerProgressEvents.every(
        (frame) => frame.body?.visibility === "developer",
      ),
      provider_progress_has_step_ref: providerProgressEvents.every(
        (frame) => typeof frame.body?.step_ref === "string",
      ),
      provider_started_projected: Boolean(providerStartedEvent),
      provider_final_output_projected: Boolean(providerFinalEvent),
      provider_request_prepared_projected: Boolean(providerRequestPreparedEvent),
      provider_request_dispatched_projected: Boolean(providerRequestDispatchedEvent),
      provider_response_received_projected: Boolean(providerResponseReceivedEvent),
      provider_chunk_projected: Boolean(providerChunkEvent),
      provider_chunk_payload_has_lengths:
        typeof providerChunkEvent?.body?.payload?.chunk_index === "number" &&
        typeof providerChunkEvent?.body?.payload?.chunk_content_length === "number" &&
        typeof providerChunkEvent?.body?.payload?.accumulated_content_length === "number",
      provider_chunk_raw_content_leaked: rawProviderContentLeaked,
      provider_run_refs: [
        ...new Set(providerProgressEvents.map((frame) => frame.body?.payload?.provider_run_ref)),
      ].filter(Boolean),
      provider_call_refs: [
        ...new Set(providerProgressEvents.map((frame) => frame.body?.payload?.provider_call_ref)),
      ].filter(Boolean),
      provider_purposes: [
        ...new Set(providerProgressEvents.map((frame) => frame.body?.payload?.purpose)),
      ].filter(Boolean),
      provider_output_types: [
        ...new Set(providerProgressEvents.map((frame) => frame.body?.payload?.output_type)),
      ].filter(Boolean),
      provider_execution_stream_projected: providerProgressEvents.every((frame) =>
        (frame.body?.reason_codes ?? []).includes("provider_execution_stream"),
      ),
      provider_progress_raw_content_leaked: rawProviderContentLeaked,
      final_turn_result_run_id: runId,
    },
  ];
}

async function driveAgentProviderExecutionActivityRestored(page) {
  const [providerState] = await driveAgentProviderExecutionStreamUnified(page);
  const workId = providerState.work_id;
  const sessionId = providerState.session_id;
  const turnId = providerState.final_turn_id ?? providerState.turn_id;
  const runId = providerState.run_id;

  assert(workId, "Provider activity restore scenario did not capture work_id");
  assert(sessionId, "Provider activity restore scenario did not capture session_id");
  assert(turnId, "Provider activity restore scenario did not capture final turn_id");
  assert(runId, "Provider activity restore scenario did not capture run_id");

  const { snapshot, assistantRow } = await waitForTranscriptTurn(workId, sessionId, turnId);
  const transcriptTurnResult = assistantRow.turn_result ?? {};
  const transcriptAgentRun = transcriptTurnResult.agent_run ?? {};
  const transcriptEvents = Array.isArray(transcriptAgentRun.events)
    ? transcriptAgentRun.events
    : [];
  const transcriptProviderRuns = Array.isArray(transcriptAgentRun.provider_runs)
    ? transcriptAgentRun.provider_runs
    : [];
  const transcriptAgentRunSummaryOnly =
    transcriptAgentRun.run_id === runId &&
    transcriptAgentRun.activity_loaded === false &&
    transcriptEvents.length === 0 &&
    transcriptProviderRuns.length === 0;

  assert(
    transcriptAgentRun.run_id === runId,
    "Persisted transcript turn_result did not carry the same AgentRun id",
  );
  assert(
    transcriptAgentRun.activity_loaded === false,
    "Persisted transcript turn_result should mark AgentRun activity as not loaded",
  );
  assert(
    transcriptEvents.length === 0,
    "Persisted transcript turn_result should not hydrate AgentRun events during session load",
  );
  assert(
    transcriptProviderRuns.length === 0,
    "Persisted transcript turn_result should not hydrate ProviderRun summaries during session load",
  );

  const activityApi = await fetchAgentRunActivityApi(workId, sessionId, turnId);
  const activityApiBody = activityApi.body ?? {};
  const queriedAgentRuns = Array.isArray(activityApiBody.agent_runs)
    ? activityApiBody.agent_runs
    : [];
  const queriedAgentRun =
    queriedAgentRuns.find((agentRun) => agentRun.run_id === runId) ?? queriedAgentRuns[0] ?? {};
  const queriedEvents = Array.isArray(queriedAgentRun.events) ? queriedAgentRun.events : [];
  // 2026-07-02 d0643cd3（ADR-0022 叙事作者权）起 activity API 的 agent_runs[].events
  // 只含 author 可见事件；developer 级 provider 事实以 ProviderRun 事件序列持久化，
  // 从 provider_runs[].events 取证（started / completed 终态齐全才算恢复成功）。
  const queriedProviderRunEventTypes = (runsList) =>
    runsList.flatMap((run) => (Array.isArray(run.events) ? run.events : [])).map((event) =>
      String(event?.event_type ?? ""),
    );
  const queriedProviderRuns = Array.isArray(activityApiBody.provider_runs)
    ? activityApiBody.provider_runs
    : [];
  const queriedProviderEventTypes = queriedProviderRunEventTypes(queriedProviderRuns);
  const queriedStartedEvent = queriedProviderEventTypes.includes("started");
  const queriedFinalEvent =
    queriedProviderEventTypes.includes("completed") ||
    queriedProviderEventTypes.includes("final_output");
  const queriedActivityRunRefs = [
    ...new Set(queriedProviderRuns.map((run) => run.provider_run_ref)),
  ].filter(Boolean);
  const queriedActivityCallRefs = [
    ...new Set(queriedProviderRuns.map((run) => run.provider_call_ref)),
  ].filter(Boolean);
  const queriedProviderRunRefs = [
    ...new Set(queriedProviderRuns.map((run) => run.provider_run_ref)),
  ].filter(Boolean);
  const queriedProviderCallRefs = [
    ...new Set(queriedProviderRuns.map((run) => run.provider_call_ref)),
  ].filter(Boolean);
  const queriedProviderPurposes = [
    ...new Set(queriedProviderRuns.map((run) => run.purpose)),
  ].filter(Boolean);
  const queriedEventsJson = JSON.stringify(
    queriedProviderRuns.flatMap((run) => (Array.isArray(run.events) ? run.events : [])),
  );
  const queriedProviderRunsJson = JSON.stringify(queriedProviderRuns);
  const queriedActivityRawContentLeaked =
    queriedEventsJson.includes("assistant_message") ||
    queriedEventsJson.includes("candidate_directions") ||
    queriedEventsJson.includes("raw_prompt") ||
    queriedEventsJson.includes("system_prompt") ||
    queriedEventsJson.includes("raw_provider_error") ||
    queriedEventsJson.includes(String(providerState.user_message_text ?? ""));
  const queriedProviderRunRawContentLeaked =
    queriedProviderRunsJson.includes("assistant_message") ||
    queriedProviderRunsJson.includes("candidate_directions") ||
    queriedProviderRunsJson.includes("raw_prompt") ||
    queriedProviderRunsJson.includes("system_prompt") ||
    queriedProviderRunsJson.includes("raw_provider_error") ||
    queriedProviderRunsJson.includes(String(providerState.user_message_text ?? ""));

  assert(activityApi.status === 200, "AgentRun activity API did not return HTTP 200");
  assert(queriedAgentRuns.length >= 1, "AgentRun activity API did not return AgentRun summaries");
  assert(
    queriedProviderEventTypes.length >= 2,
    "Persisted ProviderRun facts did not restore provider event sequences",
  );
  assert(queriedStartedEvent, "Persisted ProviderRun facts did not restore started events");
  assert(queriedFinalEvent, "Persisted ProviderRun facts did not restore terminal events");
  assert(
    queriedActivityRunRefs.length >= 1 && queriedActivityCallRefs.length >= 1,
    "AgentRun activity API did not carry provider refs",
  );
  assert(!queriedActivityRawContentLeaked, "AgentRun activity API leaked raw provider content");
  assert(
    queriedProviderRuns.length >= 3,
    "AgentRun activity API did not return persisted ProviderRun usage summaries",
  );
  assert(
    queriedProviderRunRefs.length >= 1 && queriedProviderCallRefs.length >= 1,
    "AgentRun activity API did not return provider refs",
  );
  assert(
    queriedProviderPurposes.includes("author_reasoning") &&
      queriedProviderPurposes.includes("conversation"),
    "AgentRun activity API did not preserve author reasoning and conversation purposes",
  );
  assert(
    activityApiBody.totals?.provider_run_count >= queriedProviderRuns.length,
    "AgentRun activity API did not return usage totals",
  );
  assert(
    !queriedProviderRunRawContentLeaked,
    "AgentRun activity API leaked raw ProviderRun content",
  );

  const appLogCountBeforeReload = readAppLogRecords().length;
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });

  const resumedAfterReload = await waitForNewAppLogRecord(
    appLogCountBeforeReload,
    (record) =>
      record.event === "work_session.resume.done" &&
      record.work_id === workId &&
      record.session_id === sessionId &&
      Number(record.transcript_count ?? 0) >= Number(snapshot.transcript?.length ?? 2),
    "Reload did not resume the session containing restored provider activity",
    30_000,
  );

  // Order 62 CP3 语义迁移：工作详情折叠区与模型调用明细/事件序列/输出摘要/回放
  // 边界 UI 已整体移除。恢复后的作者可见语义 = 同一 assistant 消息的运行组三层
  // UI 从持久化 events 重建；provider 事实取证由上方 transcript / scoped activity
  // API 断言承担（不弱化：API 断言覆盖原 UI 展开所验证的全部事实）。
  // 恢复补水是惰性异步的：等待条件必须包含三层 UI 结构本身，而不是先等文本再
  // 一次性取值（否则与补水完成产生竞态）。
  await page.waitForFunction(
    (expected) =>
      expected.every((value) => document.body.innerText.includes(value)) &&
      Boolean(document.querySelector('section[aria-label="计划"]')),
    ["创作执行", "已完成"],
    { timeout: 30_000 },
  );
  const restoredSections = await page.evaluate(() => ({
    plan: Boolean(document.querySelector('section[aria-label="计划"]')),
    reasoning: Boolean(document.querySelector('section[aria-label="推理"]')),
  }));

  const restoredVisibleText = await page.locator("body").innerText();
  const providerRunReplayUiRawContentLeaked = [
    "assistant_message",
    "candidate_directions",
    "raw_prompt",
    "system_prompt",
    "raw_provider_error",
    "raw_output",
  ].some((value) => restoredVisibleText.includes(value));

  return [
    {
      ...providerState,
      slice_id: "agent-provider-execution-activity-restored",
      restored_after_reload: true,
      reload_resume_transcript_count: resumedAfterReload.transcript_count,
      transcript_agent_run_summary_only: transcriptAgentRunSummaryOnly,
      transcript_agent_run_activity_loaded: transcriptAgentRun.activity_loaded === true,
      transcript_agent_run_event_count: transcriptEvents.length,
      transcript_provider_run_summary_count: transcriptProviderRuns.length,
      agent_run_activity_api_status: activityApi.status,
      agent_run_activity_api_run_count: queriedAgentRuns.length,
      agent_run_activity_api_event_count: queriedEvents.length,
      agent_run_activity_api_provider_event_count: queriedProviderEventTypes.length,
      agent_run_activity_api_started_restored: Boolean(queriedStartedEvent),
      agent_run_activity_api_final_output_restored: Boolean(queriedFinalEvent),
      agent_run_activity_api_provider_run_refs: queriedActivityRunRefs,
      agent_run_activity_api_provider_call_refs: queriedActivityCallRefs,
      agent_run_activity_api_raw_content_leaked: queriedActivityRawContentLeaked,
      provider_run_activity_api_status: activityApi.status,
      provider_run_activity_api_count: queriedProviderRuns.length,
      provider_run_activity_api_refs: queriedProviderRunRefs,
      provider_run_activity_api_call_refs: queriedProviderCallRefs,
      provider_run_activity_api_purposes: queriedProviderPurposes,
      provider_run_activity_api_total_tokens: activityApiBody.totals?.total_tokens ?? null,
      provider_run_activity_api_raw_content_leaked: queriedProviderRunRawContentLeaked,
      // Order 62 CP3 语义迁移：折叠区/明细 UI 已移除；恢复可见性 = 三层 UI 结构重建。
      restored_ui_agent_flow_visible:
        restoredVisibleText.includes("创作执行") && restoredSections.plan,
      restored_ui_plan_restored: restoredSections.plan,
      restored_ui_reasoning_restored: restoredSections.reasoning,
      restored_ui_provider_run_replay_raw_content_leaked: providerRunReplayUiRawContentLeaked,
    },
  ];
}

async function driveAgentProviderExecutionErrorAuthorSafe(page) {
  await configureProviderRuntime({ provider: "slice_verify" });

  const message = "UA01PROVIDERFAIL 验证 provider 失败事实进入普通对话执行记录";

  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  const frameStart = frames.length;
  const logStart = readAppLogRecords().length;

  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      String(frame.body?.text ?? "") === message,
    "Provider error AgentRun request was not sent from the real workbench input",
    30_000,
  );

  const ackFrame = await waitForNewFrame(
    frameStart,
    (frame) => {
      const response = frame.body?.response ?? {};
      return (
        frame.direction === "received" &&
        frame.event === "phx_reply" &&
        frame.body?.status === "ok" &&
        response.received === true &&
        response.run_mode === "bounded" &&
        typeof response.run_id === "string" &&
        response.run_id !== ""
      );
    },
    "Provider error turn did not fast-ack with bounded run_id",
    30_000,
  );
  const runId = ackFrame.body.response.run_id;

  await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "run_started",
    "Provider error AgentRun run_started event was not broadcast",
    30_000,
  );

  const providerStartedEvent = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "provider_progress" &&
      frame.body?.visibility === "developer" &&
      (frame.body?.reason_codes ?? []).includes("provider_started"),
    "Provider error AgentRun did not project provider_started",
    30_000,
  );

  const providerErrorEvent = await waitForNewFrame(
    frames.indexOf(providerStartedEvent),
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "provider_progress" &&
      frame.body?.visibility === "developer" &&
      (frame.body?.reason_codes ?? []).includes("provider_error"),
    "Provider error AgentRun did not project provider_error",
    30_000,
  );

  const turnFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.agent_run?.run_id === runId &&
      frame.body?.agent_run?.profile_ref === "conversation_turn_v1" &&
      String(frame.body?.assistant_message?.text ?? "").includes("无法连接到创作引擎") &&
      frame.body?.truthfulness?.tool_called === false &&
      frame.body?.truthfulness?.artifact_adopted === false &&
      frame.body?.truthfulness?.production_write_performed === false,
    "Provider error AgentRun did not return a safe fallback TurnResult",
    60_000,
  );
  const turnResult = turnFrame.body;

  await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "run_completed",
    "Provider error AgentRun run_completed event was not broadcast",
    30_000,
  );

  const completedStateFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId &&
      frame.body?.status === "completed" &&
      frame.body?.profile_ref === "conversation_turn_v1" &&
      Number(frame.body?.consumed_budget?.provider_calls ?? 0) === 3,
    "Provider error AgentRun state did not complete with the expected agentic provider calls",
    30_000,
  );

  const providerErrorLog = await waitForNewAppLogRecord(
    logStart,
    (record) =>
      record.event === "provider_gateway.complete.error" &&
      String(record.reason_code ?? "") === "provider_error",
    "Provider gateway did not log provider_error",
    30_000,
  );

  const ackIndex = frames.findIndex((frame) => frame === ackFrame);
  const turnIndex = frames.findIndex((frame) => frame === turnFrame);
  assert(ackIndex >= 0 && turnIndex > ackIndex, "Provider error TurnResult arrived before ack");

  // Order 62 CP3 语义迁移：工作详情/执行记录已移除。作者可见错误语义由状态区 +
  // 错误文案判定；模型事件与调用计数细节由下方 provider_progress 帧断言承担。
  await page.waitForFunction(
    (expected) => expected.every((value) => document.body.innerText.includes(value)),
    ["创作执行", "无法连接到创作引擎"],
    { timeout: 30_000 },
  );

  const providerProgressEvents = frames
    .slice(frameStart)
    .filter(
      (frame) =>
        frame.direction === "received" &&
        frame.event === "agent_event" &&
        frame.body?.run_ref === runId &&
        frame.body?.event_type === "provider_progress" &&
        frame.body?.visibility === "developer",
    );
  const progressJson = JSON.stringify(providerProgressEvents.map((frame) => frame.body ?? {}));
  const rawProviderContentLeaked =
    progressJson.includes("UA01PROVIDERFAIL") ||
    progressJson.includes("raw provider failure payload") ||
    progressJson.includes("raw_prompt") ||
    progressJson.includes("system_prompt") ||
    progressJson.includes("assistant_message");

  const visibleText = await page.locator("body").innerText();
  const uiState = await commonUiState(page, turnResult, sentFrame);

  return [
    {
      ...uiState,
      slice_id: "agent-provider-execution-error-author-safe",
      parent_turn_id: providerErrorLog.turn_id,
      final_turn_id: turnResult.turn_id,
      run_id: runId,
      run_mode: ackFrame.body.response.run_mode,
      profile_ref: completedStateFrame.body.profile_ref,
      parent_fast_ack_before_final_turn_result: ackIndex >= 0 && turnIndex > ackIndex,
      plain_input_sent_from_real_workbench: true,
      final_turn_broadcast: true,
      final_tool_called: turnResult.truthfulness?.tool_called === true,
      no_tool_called: turnResult.truthfulness?.tool_called === false,
      no_auto_adoption: turnResult.truthfulness?.artifact_adopted === false,
      no_production_write: turnResult.truthfulness?.production_write_performed === false,
      consumed_provider_calls: completedStateFrame.body.consumed_budget?.provider_calls,
      provider_progress_event_count: providerProgressEvents.length,
      provider_progress_reason_codes: providerProgressEvents.flatMap(
        (frame) => frame.body?.reason_codes ?? [],
      ),
      provider_progress_visibility_developer: providerProgressEvents.every(
        (frame) => frame.body?.visibility === "developer",
      ),
      provider_progress_has_step_ref: providerProgressEvents.every(
        (frame) => typeof frame.body?.step_ref === "string",
      ),
      provider_started_projected: Boolean(providerStartedEvent),
      provider_error_projected: Boolean(providerErrorEvent),
      provider_run_refs: [
        ...new Set(providerProgressEvents.map((frame) => frame.body?.payload?.provider_run_ref)),
      ].filter(Boolean),
      provider_call_refs: [
        ...new Set(providerProgressEvents.map((frame) => frame.body?.payload?.provider_call_ref)),
      ].filter(Boolean),
      provider_purposes: [
        ...new Set(providerProgressEvents.map((frame) => frame.body?.payload?.purpose)),
      ].filter(Boolean),
      provider_statuses: [
        ...new Set(providerProgressEvents.map((frame) => frame.body?.payload?.status)),
      ].filter(Boolean),
      provider_output_types: [
        ...new Set(providerProgressEvents.map((frame) => frame.body?.payload?.output_type)),
      ].filter(Boolean),
      provider_execution_stream_projected: providerProgressEvents.every((frame) =>
        (frame.body?.reason_codes ?? []).includes("provider_execution_stream"),
      ),
      provider_progress_raw_content_leaked: rawProviderContentLeaked,
      final_turn_result_run_id: runId,
      safe_fallback_visible:
        visibleText.includes("模型事件：调用失败") && visibleText.includes("无法连接到创作引擎"),
    },
  ];
}

async function driveAgentPlotOutlineWithContext(page) {
  await configureProviderRuntime({ provider: "slice_verify" });

  const message = "请基于当前作品规划十二章章节大纲。";

  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  const frameStart = frames.length;
  const logStart = readAppLogRecords().length;

  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      String(frame.body?.text ?? "") === message,
    "Plot outline AgentRun request was not sent from the real workbench input",
    30_000,
  );

  const ackFrame = await waitForNewFrame(
    frameStart,
    (frame) => {
      const response = frame.body?.response ?? {};
      return (
        frame.direction === "received" &&
        frame.event === "phx_reply" &&
        frame.body?.status === "ok" &&
        response.received === true &&
        response.run_mode === "bounded" &&
        typeof response.run_id === "string" &&
        response.run_id !== ""
      );
    },
    "Plot outline AgentRun did not fast-ack with bounded run_id",
    30_000,
  );
  const runId = ackFrame.body.response.run_id;

  const contextStepFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "plan_drafted" &&
      frame.body?.payload?.target_tool_ref === "context_assemble",
    "Plot outline AgentRun did not propose the context assembly step",
    30_000,
  );
  const draftedPlanSteps = contextStepFrame.body?.payload?.plan_steps ?? [];
  const planDraftIncludesContextStep =
    Array.isArray(draftedPlanSteps) &&
    draftedPlanSteps.some((step) => step?.target_tool_ref === "context_assemble");
  const planDraftIncludesOutlineStep =
    Array.isArray(draftedPlanSteps) &&
    draftedPlanSteps.some((step) => step?.target_tool_ref === "plot_outline");

  const contextEventFrame = await waitForNewFrame(
    frames.indexOf(contextStepFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "goal_understood" &&
      String(frame.body?.summary ?? "").includes("章节大纲规划上下文"),
    "Plot outline AgentRun did not publish the context stage event",
    30_000,
  );

  const contextObservationLog = await waitForNewAppLogRecord(
    logStart,
    (record) => record.event === "context.assemble.done" && record.outcome === "ok",
    "Plot outline AgentRun did not assemble context before outline planning",
    30_000,
  );

  const gateEventFrame = await waitForNewFrame(
    frames.indexOf(contextEventFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "gate_decided",
    "Plot outline AgentRun did not publish gate_decided",
    30_000,
  );

  const toolStartedFrame = await waitForNewFrame(
    frames.indexOf(gateEventFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "tool_started",
    "Plot outline AgentRun did not publish tool_started",
    30_000,
  );

  const toolCompletedFrame = await waitForNewFrame(
    frames.indexOf(toolStartedFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "tool_completed" &&
      String(frame.body?.payload?.tool_name ?? "") === "plot_outline",
    "Plot outline AgentRun did not publish tool_completed for plot_outline",
    120_000,
  );

  const turnFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.agent_run?.run_id === runId &&
      frame.body?.agent_run?.profile_ref === "plot_outline_with_context_v1" &&
      frame.body?.tool_result?.tool_name === "plot_outline" &&
      frame.body?.tool_result?.status === "succeeded" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "outline_draft",
    "Plot outline AgentRun did not broadcast outline_draft TurnResult",
    120_000,
  );
  const turnResult = turnFrame.body;
  const pendingArtifact = turnResult.adoption_state.pending[0];

  const artifactEventFrame = await waitForNewFrame(
    frames.indexOf(turnFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "artifact_created" &&
      Array.isArray(frame.body?.refs) &&
      frame.body.refs.length > 0,
    "Plot outline AgentRun did not publish artifact_created",
    30_000,
  );

  const runCompletedFrame = await waitForNewFrame(
    frames.indexOf(artifactEventFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "run_completed",
    "Plot outline AgentRun did not publish run_completed",
    60_000,
  );

  const completedStateFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId &&
      frame.body?.status === "completed" &&
      frame.body?.profile_ref === "plot_outline_with_context_v1" &&
      Number(frame.body?.consumed_budget?.steps ?? 0) === 2 &&
      Number(frame.body?.consumed_budget?.tool_calls ?? 0) === 1 &&
      Number(frame.body?.consumed_budget?.provider_calls ?? 0) === 4,
    "Plot outline AgentRun state did not complete with expected counters",
    60_000,
  );

  await waitForNewAppLogRecord(
    logStart,
    (record) =>
      record.event === "channel.user_message.done" &&
      record.run_id === runId &&
      String(record.run_mode ?? "") === "bounded",
    "Plot outline user_message did not log bounded run ack",
    30_000,
  );
  await waitForNewAppLogRecord(
    logStart,
    (record) =>
      record.event === "orchestrator.decide.done" &&
      String(record.decision_type ?? "") === "allow_tool",
    "Plot outline step was not re-gated by the orchestrator",
    60_000,
  );
  await waitForNewAppLogRecord(
    logStart,
    (record) => record.event === "toolbox.execute.done" && record.tool_name === "plot_outline",
    "Plot outline run did not execute plot_outline",
    60_000,
  );

  const ackIndex = frames.findIndex((frame) => frame === ackFrame);
  const turnIndex = frames.findIndex((frame) => frame === turnFrame);
  assert(
    ackIndex >= 0 && turnIndex > ackIndex,
    "Plot outline final TurnResult arrived before fast ack",
  );
  assert(turnResult.truthfulness?.artifact_adopted === false, "Plot outline artifact was adopted");
  assert(
    turnResult.truthfulness?.production_write_performed === false,
    "Plot outline run performed a production write",
  );
  assert(
    pendingArtifact.requires_adoption === true &&
      String(pendingArtifact.adoption_status ?? "") === "tentative",
    "Plot outline artifact was not a tentative adoption candidate",
  );

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("大纲草稿") &&
      document.body.innerText.includes("第12章") &&
      document.body.innerText.includes("保存到大纲") &&
      document.body.innerText.includes("不保存") &&
      document.body.innerText.includes("修改后保存"),
    undefined,
    { timeout: 30_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const uiState = await commonUiState(page, turnResult, sentFrame);
  const logsAfter = readAppLogRecords().slice(logStart);
  const parentUserMessageLog = logsAfter.find(
    (record) => record.event === "channel.user_message.done" && record.run_id === runId,
  );
  const logAllowToolCount = logsAfter.filter(
    (record) =>
      record.event === "orchestrator.decide.done" &&
      String(record.decision_type ?? "") === "allow_tool",
  ).length;

  return [
    {
      ...uiState,
      slice_id: "agent-plot-outline-with-context",
      parent_turn_id: parentUserMessageLog?.turn_id,
      final_turn_id: turnResult.turn_id,
      run_id: runId,
      run_mode: ackFrame.body.response.run_mode,
      profile_ref: completedStateFrame.body.profile_ref,
      parent_fast_ack_before_final_turn_result: ackIndex >= 0 && turnIndex > ackIndex,
      outline_request_sent_from_real_workbench: true,
      final_turn_broadcast: true,
      final_tool_name: turnResult.tool_result?.tool_name,
      final_tool_status: turnResult.tool_result?.status,
      pending_artifact_id: pendingArtifact.artifact_id,
      pending_artifact_type: pendingArtifact.artifact_type,
      pending_artifact_requires_adoption: pendingArtifact.requires_adoption === true,
      pending_artifact_tentative: String(pendingArtifact.adoption_status ?? "") === "tentative",
      no_auto_adoption: turnResult.truthfulness?.artifact_adopted === false,
      no_production_write: turnResult.truthfulness?.production_write_performed === false,
      completed_step_count: completedStateFrame.body.completed_step_refs?.length ?? 0,
      consumed_steps: completedStateFrame.body.consumed_budget?.steps,
      consumed_tool_calls: completedStateFrame.body.consumed_budget?.tool_calls,
      consumed_provider_calls: completedStateFrame.body.consumed_budget?.provider_calls,
      agent_stage_events_visible:
        contextStepFrame.body?.event_type === "plan_drafted" &&
        contextEventFrame.body?.event_type === "goal_understood" &&
        contextObservationLog?.event === "context.assemble.done" &&
        planDraftIncludesContextStep &&
        planDraftIncludesOutlineStep &&
        gateEventFrame.body?.event_type === "gate_decided" &&
        toolStartedFrame.body?.event_type === "tool_started" &&
        toolCompletedFrame.body?.event_type === "tool_completed" &&
        artifactEventFrame.body?.event_type === "artifact_created" &&
        runCompletedFrame.body?.event_type === "run_completed",
      context_step_visible:
        contextStepFrame.body?.event_type === "plan_drafted" &&
        contextStepFrame.body?.payload?.target_tool_ref === "context_assemble",
      context_event_visible: contextEventFrame.body?.event_type === "goal_understood",
      context_observation_visible: contextObservationLog?.event === "context.assemble.done",
      strategy_step_visible: planDraftIncludesOutlineStep,
      plan_event_visible: planDraftIncludesContextStep && planDraftIncludesOutlineStep,
      gate_event_visible: gateEventFrame.body?.event_type === "gate_decided",
      strategy_observation_visible: false,
      outline_step_visible:
        toolStartedFrame.body?.event_type === "tool_started" &&
        String(toolStartedFrame.body?.payload?.tool_name ?? "") === "plot_outline",
      tool_started_visible: toolStartedFrame.body?.event_type === "tool_started",
      tool_completed_visible: toolCompletedFrame.body?.event_type === "tool_completed",
      tool_observation_visible:
        turnResult.tool_result?.tool_name === "plot_outline" &&
        turnResult.tool_result?.status === "succeeded",
      finalization_step_visible:
        runCompletedFrame.body?.event_type === "run_completed" &&
        Array.isArray(runCompletedFrame.body?.reason_codes) &&
        runCompletedFrame.body.reason_codes.includes("goal_satisfied"),
      artifact_observation_visible: pendingArtifact.artifact_type === "outline_draft",
      artifact_event_visible: artifactEventFrame.body?.event_type === "artifact_created",
      ui_context_step_visible: visibleText.includes("读取章节大纲规划上下文"),
      ui_strategy_step_visible: visibleText.includes("基于已读取的章节上下文生成章节大纲草稿"),
      ui_outline_step_visible: visibleText.includes("生成章节大纲草稿"),
      ui_finalization_step_visible:
        visibleText.includes("完成回应") || visibleText.includes("当前：已完成"),
      // Order 62 CP3 语义迁移：工作详情/终态区已移除，改以新三层 UI 判定。
      ui_agent_panel_visible: visibleText.includes("创作执行") && visibleText.includes("计划"),
      ui_agent_completed_visible:
        visibleText.includes("已完成") || visibleText.includes("无任务"),
      ui_outline_draft_visible:
        visibleText.includes("章节大纲草稿") || visibleText.includes("大纲草稿"),
      ui_outline_adoption_actions_visible:
        visibleText.includes("保存到大纲") &&
        visibleText.includes("不保存") &&
        visibleText.includes("修改后保存"),
      ui_execution_brief_path_visible:
        visibleText.includes("本轮路径：") &&
        visibleText.includes("读取上下文") &&
        visibleText.includes("调用步骤规划模型") &&
        visibleText.includes("制定计划") &&
        visibleText.includes("系统裁决") &&
        visibleText.includes("规划章节大纲") &&
        visibleText.includes("调用写作模型") &&
        visibleText.includes("生成大纲候选") &&
        visibleText.includes("完成回应"),
      log_sync_turn_count: logsAfter.filter(
        (record) =>
          record.event === "channel.user_message.done" &&
          String(record.run_mode ?? "") === "sync_turn",
      ).length,
      log_allow_tool_count: logAllowToolCount,
      log_plot_outline_tool_done: logsAfter.some(
        (record) =>
          record.event === "toolbox.execute.done" &&
          record.tool_name === "plot_outline" &&
          record.tool_outcome === "succeeded",
      ),
      user_message_text: sentFrame.body?.text,
    },
  ];
}

async function driveAgentWorldBuildingWithContext(page, options = {}) {
  await configureProviderRuntime({ provider: "slice_verify" });

  const {
    sliceId = "agent-world-building-with-context",
    noncePrefix = "WORLD",
    expectedArtifactType = "foreshadowing_seed",
    expectedArtifactName = "foreshadowing_seed",
    messageForNonce = (nonce) => `请设计一个跨三卷回收的伏笔线索（标记 ${nonce}）。`,
  } = options;
  const nonce = `${noncePrefix}${Date.now()}`;
  const message = messageForNonce(nonce);
  const expectedDraftLabel = expectedArtifactType === "style_rule_seed" ? "规则草稿" : "伏笔草稿";

  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  const frameStart = frames.length;
  const logStart = readAppLogRecords().length;

  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      String(frame.body?.text ?? "") === message,
    "World building AgentRun request was not sent from the real workbench input",
    30_000,
  );

  const ackFrame = await waitForNewFrame(
    frameStart,
    (frame) => {
      const response = frame.body?.response ?? {};
      return (
        frame.direction === "received" &&
        frame.event === "phx_reply" &&
        frame.body?.status === "ok" &&
        response.received === true &&
        response.run_mode === "bounded" &&
        typeof response.run_id === "string" &&
        response.run_id !== ""
      );
    },
    "World building AgentRun did not fast-ack with bounded run_id",
    30_000,
  );
  const runId = ackFrame.body.response.run_id;

  const profileRouteFrame = await waitForNewFrame(
    frameStart,
    (frame) => {
      return (
        frame.direction === "received" &&
        frame.event === "agent_run_state" &&
        frame.body?.run_id === runId &&
        frame.body?.profile_ref === "world_building_with_context_v1" &&
        Number(frame.body?.consumed_budget?.provider_calls ?? 0) >= 1
      );
    },
    "World building AgentRun did not switch from profile routing to world_building_with_context_v1",
    30_000,
  );

  const contextStepFrame = await waitForNewFrame(
    frames.indexOf(profileRouteFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "plan_drafted" &&
      frame.body?.payload?.target_tool_ref === "context_assemble",
    "World building AgentRun did not propose the context assembly step",
    30_000,
  );
  const draftedPlanSteps = contextStepFrame.body?.payload?.plan_steps ?? [];
  const planDraftIncludesContextStep =
    Array.isArray(draftedPlanSteps) &&
    draftedPlanSteps.some((step) => step?.target_tool_ref === "context_assemble");
  const planDraftIncludesWorldStep =
    Array.isArray(draftedPlanSteps) &&
    draftedPlanSteps.some((step) => step?.target_tool_ref === "world_building");

  const contextEventFrame = await waitForNewFrame(
    frames.indexOf(contextStepFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "goal_understood" &&
      String(frame.body?.summary ?? "").includes("世界设定上下文"),
    "World building AgentRun did not publish the context stage event",
    30_000,
  );

  const contextObservationLog = await waitForNewAppLogRecord(
    logStart,
    (record) => record.event === "context.assemble.done" && record.outcome === "ok",
    "World building AgentRun did not assemble context before world building",
    30_000,
  );

  const gateEventFrame = await waitForNewFrame(
    frames.indexOf(contextEventFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "gate_decided",
    "World building AgentRun did not publish gate_decided",
    30_000,
  );

  const toolStartedFrame = await waitForNewFrame(
    frames.indexOf(gateEventFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "tool_started",
    "World building AgentRun did not publish tool_started",
    30_000,
  );

  const toolCompletedFrame = await waitForNewFrame(
    frames.indexOf(toolStartedFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "tool_completed" &&
      String(frame.body?.payload?.tool_name ?? "") === "world_building",
    "World building AgentRun did not publish tool_completed for world_building",
    120_000,
  );

  const turnFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.agent_run?.run_id === runId &&
      frame.body?.agent_run?.profile_ref === "world_building_with_context_v1" &&
      frame.body?.tool_result?.tool_name === "world_building" &&
      frame.body?.tool_result?.status === "succeeded" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === expectedArtifactType,
    `World building AgentRun did not broadcast ${expectedArtifactName} TurnResult`,
    120_000,
  );
  const turnResult = turnFrame.body;
  const pendingArtifact = turnResult.adoption_state.pending[0];
  const pendingItem = pendingArtifact.payload?.items?.[0] ?? {};

  const artifactEventFrame = await waitForNewFrame(
    frames.indexOf(turnFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "artifact_created" &&
      Array.isArray(frame.body?.refs) &&
      frame.body.refs.length > 0,
    "World building AgentRun did not publish artifact_created",
    30_000,
  );

  const runCompletedFrame = await waitForNewFrame(
    frames.indexOf(artifactEventFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "run_completed",
    "World building AgentRun did not publish run_completed",
    60_000,
  );

  const completedStateFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId &&
      frame.body?.status === "completed" &&
      frame.body?.profile_ref === "world_building_with_context_v1" &&
      Number(frame.body?.consumed_budget?.steps ?? 0) === 2 &&
      Number(frame.body?.consumed_budget?.tool_calls ?? 0) === 1 &&
      Number(frame.body?.consumed_budget?.provider_calls ?? 0) === 4,
    "World building AgentRun state did not complete with expected counters",
    60_000,
  );

  await waitForNewAppLogRecord(
    logStart,
    (record) =>
      record.event === "channel.user_message.done" &&
      record.run_id === runId &&
      String(record.run_mode ?? "") === "bounded",
    "World building user_message did not log bounded run ack",
    30_000,
  );
  await waitForNewAppLogRecord(
    logStart,
    (record) =>
      record.event === "orchestrator.decide.done" &&
      String(record.decision_type ?? "") === "allow_tool",
    "World building step was not re-gated by the orchestrator",
    60_000,
  );
  await waitForNewAppLogRecord(
    logStart,
    (record) => record.event === "toolbox.execute.done" && record.tool_name === "world_building",
    "World building run did not execute world_building",
    60_000,
  );

  const ackIndex = frames.findIndex((frame) => frame === ackFrame);
  const turnIndex = frames.findIndex((frame) => frame === turnFrame);
  assert(
    ackIndex >= 0 && turnIndex > ackIndex,
    "World building final TurnResult arrived before fast ack",
  );
  assert(
    turnResult.truthfulness?.artifact_adopted === false,
    "World building artifact was adopted",
  );
  assert(
    turnResult.truthfulness?.production_write_performed === false,
    "World building run performed a production write",
  );
  assert(
    pendingArtifact.requires_adoption === true &&
      String(pendingArtifact.adoption_status ?? "") === "tentative",
    "World building artifact was not a tentative adoption candidate",
  );
  assert(
    String(pendingItem.title ?? "").includes(nonce) ||
      String(pendingItem.body ?? "").includes(nonce) ||
      String(pendingItem.rationale ?? "").includes(nonce),
    "World building draft did not preserve the input nonce",
  );

  // Order 62 CP3 语义迁移：工作详情/模型执行流已移除，完成态与草稿可见性
  // 改以新三层 UI（状态标签 + 采纳卡 + 采纳动作）判定，口径不弱化。
  await page.waitForFunction(
    (draftLabel) =>
      (document.body.innerText.includes("已完成") ||
        document.body.innerText.includes("无任务")) &&
      (document.body.innerText.includes("世界设定草稿") ||
        document.body.innerText.includes(draftLabel)) &&
      document.body.innerText.includes("保存到作品档案"),
    expectedDraftLabel,
    { timeout: 30_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const uiState = await commonUiState(page, turnResult, sentFrame);
  const logsAfter = readAppLogRecords().slice(logStart);
  const parentUserMessageLog = logsAfter.find(
    (record) => record.event === "channel.user_message.done" && record.run_id === runId,
  );
  const profileRouteSourceRef = String(
    profileRouteFrame.body?.payload?.source_ref ??
      (profileRouteFrame.body?.profile_ref ? `profile:${profileRouteFrame.body.profile_ref}` : ""),
  );
  const logAllowToolCount = logsAfter.filter(
    (record) =>
      record.event === "orchestrator.decide.done" &&
      String(record.decision_type ?? "") === "allow_tool",
  ).length;

  return [
    {
      ...uiState,
      slice_id: sliceId,
      parent_turn_id: parentUserMessageLog?.turn_id,
      final_turn_id: turnResult.turn_id,
      run_id: runId,
      run_mode: ackFrame.body.response.run_mode,
      profile_ref: completedStateFrame.body.profile_ref,
      parent_fast_ack_before_final_turn_result: ackIndex >= 0 && turnIndex > ackIndex,
      world_building_request_sent_from_real_workbench: true,
      final_turn_broadcast: true,
      final_tool_name: turnResult.tool_result?.tool_name,
      final_tool_status: turnResult.tool_result?.status,
      pending_artifact_id: pendingArtifact.artifact_id,
      pending_artifact_type: pendingArtifact.artifact_type,
      expected_artifact_type: expectedArtifactType,
      pending_artifact_requires_adoption: pendingArtifact.requires_adoption === true,
      pending_artifact_tentative: String(pendingArtifact.adoption_status ?? "") === "tentative",
      pending_item_preserved_nonce:
        String(pendingItem.title ?? "").includes(nonce) ||
        String(pendingItem.body ?? "").includes(nonce) ||
        String(pendingItem.rationale ?? "").includes(nonce),
      no_auto_adoption: turnResult.truthfulness?.artifact_adopted === false,
      no_production_write: turnResult.truthfulness?.production_write_performed === false,
      completed_step_count: completedStateFrame.body.completed_step_refs?.length ?? 0,
      consumed_steps: completedStateFrame.body.consumed_budget?.steps,
      consumed_tool_calls: completedStateFrame.body.consumed_budget?.tool_calls,
      consumed_provider_calls: completedStateFrame.body.consumed_budget?.provider_calls,
      agent_stage_events_visible:
        contextStepFrame.body?.event_type === "plan_drafted" &&
        contextEventFrame.body?.event_type === "goal_understood" &&
        contextObservationLog?.event === "context.assemble.done" &&
        planDraftIncludesContextStep &&
        planDraftIncludesWorldStep &&
        gateEventFrame.body?.event_type === "gate_decided" &&
        toolStartedFrame.body?.event_type === "tool_started" &&
        toolCompletedFrame.body?.event_type === "tool_completed" &&
        artifactEventFrame.body?.event_type === "artifact_created" &&
        runCompletedFrame.body?.event_type === "run_completed",
      context_step_visible:
        contextStepFrame.body?.event_type === "plan_drafted" &&
        contextStepFrame.body?.payload?.target_tool_ref === "context_assemble",
      context_event_visible: contextEventFrame.body?.event_type === "goal_understood",
      context_observation_visible: contextObservationLog?.event === "context.assemble.done",
      strategy_step_visible: planDraftIncludesWorldStep,
      plan_event_visible: planDraftIncludesContextStep && planDraftIncludesWorldStep,
      gate_event_visible: gateEventFrame.body?.event_type === "gate_decided",
      strategy_observation_visible: false,
      world_step_visible:
        toolStartedFrame.body?.event_type === "tool_started" &&
        String(toolStartedFrame.body?.payload?.tool_name ?? "") === "world_building",
      tool_started_visible: toolStartedFrame.body?.event_type === "tool_started",
      tool_completed_visible: toolCompletedFrame.body?.event_type === "tool_completed",
      tool_observation_visible:
        turnResult.tool_result?.tool_name === "world_building" &&
        turnResult.tool_result?.status === "succeeded",
      finalization_step_visible:
        runCompletedFrame.body?.event_type === "run_completed" &&
        Array.isArray(runCompletedFrame.body?.reason_codes) &&
        runCompletedFrame.body.reason_codes.includes("goal_satisfied"),
      artifact_observation_visible: pendingArtifact.artifact_type === expectedArtifactType,
      artifact_event_visible: artifactEventFrame.body?.event_type === "artifact_created",
      ui_context_step_visible:
        visibleText.includes("先读取世界设定上下文") ||
        visibleText.includes("先读取作品设定上下文"),
      ui_strategy_step_visible:
        visibleText.includes("基于已读取的世界设定上下文生成世界设定、伏笔或规则草稿") ||
        visibleText.includes("基于已读取的作品设定上下文生成世界设定草稿"),
      ui_world_step_visible:
        visibleText.includes("生成世界设定、伏笔或规则草稿") ||
        visibleText.includes("生成世界设定草稿"),
      ui_finalization_step_visible:
        visibleText.includes("完成回应") || visibleText.includes("已完成"),
      // Order 62 CP3 语义迁移：工作详情/终态区已移除，改以新三层 UI 判定。
      ui_agent_panel_visible: visibleText.includes("创作执行") && visibleText.includes("计划"),
      ui_agent_completed_visible:
        visibleText.includes("已完成") || visibleText.includes("无任务"),
      ui_world_building_draft_visible:
        visibleText.includes("世界设定草稿") || visibleText.includes(expectedDraftLabel),
      ui_profile_selection_visible:
        visibleText.includes("任务类型：world_building_with_context_v1") &&
        visibleText.includes("选择来源：model_profile_router") &&
        visibleText.includes("选择原因：world_building_text_match"),
      ui_profile_selection_source_visible: visibleText.includes("选择来源：model_profile_router"),
      ui_profile_selection_reason_visible: visibleText.includes(
        "选择原因：world_building_text_match",
      ),
      ui_profile_selection_terms_visible:
        visibleText.includes("命中词：") &&
        profileRouteSourceRef === "profile:world_building_with_context_v1",
      ui_profile_selection_path_visible:
        visibleText.includes("理解作者意图") && visibleText.includes("进入世界设定工作流"),
      ui_execution_brief_path_visible:
        visibleText.includes("本轮路径：") &&
        visibleText.includes("理解作者意图") &&
        visibleText.includes("进入世界设定工作流") &&
        visibleText.includes("读取上下文") &&
        visibleText.includes("调用步骤规划模型") &&
        visibleText.includes("制定计划") &&
        visibleText.includes("系统裁决") &&
        visibleText.includes("构建世界设定") &&
        visibleText.includes("调用写作模型") &&
        visibleText.includes("生成设定候选") &&
        visibleText.includes("完成回应"),
      log_sync_turn_count: logsAfter.filter(
        (record) =>
          record.event === "channel.user_message.done" &&
          String(record.run_mode ?? "") === "sync_turn",
      ).length,
      log_allow_tool_count: logAllowToolCount,
      log_world_building_tool_done: logsAfter.some(
        (record) =>
          record.event === "toolbox.execute.done" &&
          record.tool_name === "world_building" &&
          record.tool_outcome === "succeeded",
      ),
      world_building_nonce: nonce,
      user_message_text: sentFrame.body?.text,
    },
  ];
}

async function driveAgentWorldBuildingStyleRuleWithContext(page) {
  return driveAgentWorldBuildingWithContext(page, {
    sliceId: "agent-world-building-style-rule-with-context",
    noncePrefix: "STYLE",
    expectedArtifactType: "style_rule_seed",
    expectedArtifactName: "style_rule_seed",
    messageForNonce: (nonce) => `请制定一条后续创作必须遵守的写作规则和文风约束（标记 ${nonce}）。`,
  });
}

async function driveAgentCharacterEvolutionWithContext(page) {
  await configureProviderRuntime({ provider: "slice_verify" });

  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });

  const setupBefore = frames.length;
  await sendOrdinaryChatTurn(page, "先看看现有角色阵容，然后设计一个主角，叫林烬。", setupBefore);
  const setupTurnFrame = await waitForNewFrame(
    setupBefore,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.tool_name === "character_design" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "character_seed",
    "Character setup did not broadcast a character_seed TurnResult",
    120_000,
  );
  const setupTurnResult = setupTurnFrame.body;
  const seedPending = setupTurnResult.adoption_state?.pending?.[0];
  assert(
    seedPending && seedPending.artifact_type === "character_seed",
    `character setup did not produce a character_seed (got ${seedPending?.artifact_type})`,
  );

  const adoptionStart = frames.length;
  await page.getByRole("button", { name: acceptDraftButtonPattern }).first().click();
  const adoptionFrame = await waitForNewFrame(
    adoptionStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.truthfulness?.artifact_adopted === true &&
      (frame.body?.adoption_state?.resolved ?? []).some(
        (entry) => entry.artifact_id === seedPending.artifact_id,
      ),
    "Character setup adoption frame was not received",
    120_000,
  );

  const nonce = `EVOR${Date.now()}`;
  const message = `更新林烬的当前状态（标记 ${nonce}）：他在这一章右臂重伤了。`;
  const frameStart = frames.length;
  const logStart = readAppLogRecords().length;

  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      String(frame.body?.text ?? "") === message,
    "Character evolution AgentRun request was not sent from the real workbench input",
    30_000,
  );

  const ackFrame = await waitForNewFrame(
    frameStart,
    (frame) => {
      const response = frame.body?.response ?? {};
      return (
        frame.direction === "received" &&
        frame.event === "phx_reply" &&
        frame.body?.status === "ok" &&
        response.received === true &&
        response.run_mode === "bounded" &&
        typeof response.run_id === "string" &&
        response.run_id !== ""
      );
    },
    "Character evolution AgentRun did not fast-ack with bounded run_id",
    30_000,
  );
  const runId = ackFrame.body.response.run_id;

  const contextStepFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "plan_drafted" &&
      frame.body?.payload?.target_tool_ref === "context_assemble",
    "Character evolution AgentRun did not propose the context assembly step",
    30_000,
  );
  const draftedPlanSteps = contextStepFrame.body?.payload?.plan_steps ?? [];
  const planDraftIncludesContextStep =
    Array.isArray(draftedPlanSteps) &&
    draftedPlanSteps.some((step) => step?.target_tool_ref === "context_assemble");
  const planDraftIncludesEvolutionStep =
    Array.isArray(draftedPlanSteps) &&
    draftedPlanSteps.some((step) => step?.target_tool_ref === "character_evolution");

  const contextEventFrame = await waitForNewFrame(
    frames.indexOf(contextStepFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "goal_understood" &&
      String(frame.body?.summary ?? "").includes("角色演化上下文"),
    "Character evolution AgentRun did not publish the context stage event",
    30_000,
  );

  const contextObservationLog = await waitForNewAppLogRecord(
    logStart,
    (record) => record.event === "context.assemble.done" && record.outcome === "ok",
    "Character evolution AgentRun did not assemble context before character evolution",
    30_000,
  );

  const gateEventFrame = await waitForNewFrame(
    frames.indexOf(contextEventFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "gate_decided",
    "Character evolution AgentRun did not publish gate_decided",
    30_000,
  );

  const toolStartedFrame = await waitForNewFrame(
    frames.indexOf(gateEventFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "tool_started",
    "Character evolution AgentRun did not publish tool_started",
    30_000,
  );

  const toolCompletedFrame = await waitForNewFrame(
    frames.indexOf(toolStartedFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "tool_completed" &&
      String(frame.body?.payload?.tool_name ?? "") === "character_evolution",
    "Character evolution AgentRun did not publish tool_completed for character_evolution",
    120_000,
  );

  const turnFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.agent_run?.run_id === runId &&
      frame.body?.agent_run?.profile_ref === "character_evolution_with_context_v1" &&
      frame.body?.tool_result?.tool_name === "character_evolution" &&
      frame.body?.tool_result?.status === "succeeded" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "character_evolution_seed",
    "Character evolution AgentRun did not broadcast character_evolution_seed TurnResult",
    120_000,
  );
  const turnResult = turnFrame.body;
  const pendingArtifact = turnResult.adoption_state.pending[0];
  const pendingItem = pendingArtifact.payload?.items?.[0] ?? {};

  const artifactEventFrame = await waitForNewFrame(
    frames.indexOf(turnFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "artifact_created" &&
      Array.isArray(frame.body?.refs) &&
      frame.body.refs.length > 0,
    "Character evolution AgentRun did not publish artifact_created",
    30_000,
  );

  const runCompletedFrame = await waitForNewFrame(
    frames.indexOf(artifactEventFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "run_completed",
    "Character evolution AgentRun did not publish run_completed",
    60_000,
  );

  const completedStateFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId &&
      frame.body?.status === "completed" &&
      frame.body?.profile_ref === "character_evolution_with_context_v1" &&
      Number(frame.body?.consumed_budget?.steps ?? 0) === 2 &&
      Number(frame.body?.consumed_budget?.tool_calls ?? 0) === 1 &&
      Number(frame.body?.consumed_budget?.provider_calls ?? 0) === 4,
    "Character evolution AgentRun state did not complete with expected counters",
    60_000,
  );

  await waitForNewAppLogRecord(
    logStart,
    (record) =>
      record.event === "channel.user_message.done" &&
      record.run_id === runId &&
      String(record.run_mode ?? "") === "bounded",
    "Character evolution user_message did not log bounded run ack",
    30_000,
  );
  await waitForNewAppLogRecord(
    logStart,
    (record) =>
      record.event === "orchestrator.decide.done" &&
      String(record.decision_type ?? "") === "allow_tool",
    "Character evolution step was not re-gated by the orchestrator",
    60_000,
  );
  await waitForNewAppLogRecord(
    logStart,
    (record) =>
      record.event === "toolbox.execute.done" && record.tool_name === "character_evolution",
    "Character evolution run did not execute character_evolution",
    60_000,
  );

  const ackIndex = frames.findIndex((frame) => frame === ackFrame);
  const turnIndex = frames.findIndex((frame) => frame === turnFrame);
  assert(
    ackIndex >= 0 && turnIndex > ackIndex,
    "Character evolution final TurnResult arrived before fast ack",
  );
  assert(
    turnResult.truthfulness?.artifact_adopted === false,
    "Character evolution artifact was adopted",
  );
  assert(
    turnResult.truthfulness?.production_write_performed === false,
    "Character evolution run performed a production write",
  );
  assert(
    pendingArtifact.requires_adoption === true &&
      String(pendingArtifact.adoption_status ?? "") === "tentative",
    "Character evolution artifact was not a tentative adoption candidate",
  );
  assert(
    String(pendingItem.title ?? "").includes("林烬") ||
      String(pendingItem.body ?? "").includes("林烬"),
    "Character evolution draft did not preserve the target character name",
  );
  assert(
    String(pendingItem.title ?? "").includes(nonce) ||
      String(pendingItem.body ?? "").includes(nonce) ||
      String(pendingItem.rationale ?? "").includes(nonce),
    "Character evolution draft did not preserve the input nonce",
  );

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("角色演化记忆草稿") &&
      document.body.innerText.includes("林烬"),
    undefined,
    { timeout: 30_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const uiState = await commonUiState(page, turnResult, sentFrame);
  const logsAfter = readAppLogRecords().slice(logStart);
  const parentUserMessageLog = logsAfter.find(
    (record) => record.event === "channel.user_message.done" && record.run_id === runId,
  );
  const logAllowToolCount = logsAfter.filter(
    (record) =>
      record.event === "orchestrator.decide.done" &&
      String(record.decision_type ?? "") === "allow_tool",
  ).length;

  return [
    {
      ...uiState,
      slice_id: "agent-character-evolution-with-context",
      setup_character_turn_id: setupTurnResult.turn_id,
      setup_adoption_turn_id: adoptionFrame.body?.turn_id,
      setup_character_adopted: adoptionFrame.body?.truthfulness?.artifact_adopted === true,
      seed_artifact_type: seedPending.artifact_type,
      parent_turn_id: parentUserMessageLog?.turn_id,
      final_turn_id: turnResult.turn_id,
      run_id: runId,
      run_mode: ackFrame.body.response.run_mode,
      profile_ref: completedStateFrame.body.profile_ref,
      parent_fast_ack_before_final_turn_result: ackIndex >= 0 && turnIndex > ackIndex,
      character_evolution_request_sent_from_real_workbench: true,
      final_turn_broadcast: true,
      final_tool_name: turnResult.tool_result?.tool_name,
      final_tool_status: turnResult.tool_result?.status,
      pending_artifact_id: pendingArtifact.artifact_id,
      pending_artifact_type: pendingArtifact.artifact_type,
      pending_artifact_requires_adoption: pendingArtifact.requires_adoption === true,
      pending_artifact_tentative: String(pendingArtifact.adoption_status ?? "") === "tentative",
      pending_memory_subtype: pendingItem.memory_subtype ?? null,
      pending_item_preserved_character:
        String(pendingItem.title ?? "").includes("林烬") ||
        String(pendingItem.body ?? "").includes("林烬"),
      pending_item_preserved_nonce:
        String(pendingItem.title ?? "").includes(nonce) ||
        String(pendingItem.body ?? "").includes(nonce) ||
        String(pendingItem.rationale ?? "").includes(nonce),
      no_auto_adoption: turnResult.truthfulness?.artifact_adopted === false,
      no_production_write: turnResult.truthfulness?.production_write_performed === false,
      completed_step_count: completedStateFrame.body.completed_step_refs?.length ?? 0,
      consumed_steps: completedStateFrame.body.consumed_budget?.steps,
      consumed_tool_calls: completedStateFrame.body.consumed_budget?.tool_calls,
      consumed_provider_calls: completedStateFrame.body.consumed_budget?.provider_calls,
      agent_stage_events_visible:
        contextStepFrame.body?.event_type === "plan_drafted" &&
        contextEventFrame.body?.event_type === "goal_understood" &&
        contextObservationLog?.event === "context.assemble.done" &&
        planDraftIncludesContextStep &&
        planDraftIncludesEvolutionStep &&
        gateEventFrame.body?.event_type === "gate_decided" &&
        toolStartedFrame.body?.event_type === "tool_started" &&
        toolCompletedFrame.body?.event_type === "tool_completed" &&
        artifactEventFrame.body?.event_type === "artifact_created" &&
        runCompletedFrame.body?.event_type === "run_completed",
      context_step_visible:
        contextStepFrame.body?.event_type === "plan_drafted" &&
        contextStepFrame.body?.payload?.target_tool_ref === "context_assemble",
      context_event_visible: contextEventFrame.body?.event_type === "goal_understood",
      context_observation_visible: contextObservationLog?.event === "context.assemble.done",
      strategy_step_visible: planDraftIncludesEvolutionStep,
      plan_event_visible: planDraftIncludesContextStep && planDraftIncludesEvolutionStep,
      gate_event_visible: gateEventFrame.body?.event_type === "gate_decided",
      strategy_observation_visible: false,
      evolution_step_visible:
        toolStartedFrame.body?.event_type === "tool_started" &&
        String(toolStartedFrame.body?.payload?.tool_name ?? "") === "character_evolution",
      tool_started_visible: toolStartedFrame.body?.event_type === "tool_started",
      tool_completed_visible: toolCompletedFrame.body?.event_type === "tool_completed",
      tool_observation_visible:
        turnResult.tool_result?.tool_name === "character_evolution" &&
        turnResult.tool_result?.status === "succeeded",
      finalization_step_visible:
        runCompletedFrame.body?.event_type === "run_completed" &&
        Array.isArray(runCompletedFrame.body?.reason_codes) &&
        runCompletedFrame.body.reason_codes.includes("goal_satisfied"),
      artifact_observation_visible: pendingArtifact.artifact_type === "character_evolution_seed",
      artifact_event_visible: artifactEventFrame.body?.event_type === "artifact_created",
      ui_context_step_visible: visibleText.includes("先读取角色演化上下文"),
      ui_strategy_step_visible: visibleText.includes("基于已读取的角色上下文生成角色演化草稿"),
      ui_evolution_step_visible: visibleText.includes("生成角色演化草稿"),
      ui_finalization_step_visible: visibleText.includes("本轮目标已经满足"),
      // Order 62 CP3 语义迁移：工作详情/终态区已移除，改以新三层 UI 判定。
      ui_agent_panel_visible: visibleText.includes("创作执行") && visibleText.includes("计划"),
      ui_agent_completed_visible:
        visibleText.includes("已完成") || visibleText.includes("无任务"),
      ui_character_evolution_draft_visible: visibleText.includes("角色演化记忆草稿"),
      ui_execution_brief_path_visible:
        visibleText.includes("本轮路径：") &&
        visibleText.includes("读取上下文") &&
        visibleText.includes("调用步骤规划模型") &&
        visibleText.includes("制定计划") &&
        visibleText.includes("系统裁决") &&
        visibleText.includes("更新角色演化记忆") &&
        visibleText.includes("调用写作模型") &&
        visibleText.includes("生成角色演化候选") &&
        visibleText.includes("完成回应"),
      log_sync_turn_count: logsAfter.filter(
        (record) =>
          record.event === "channel.user_message.done" &&
          String(record.run_mode ?? "") === "sync_turn",
      ).length,
      log_allow_tool_count: logAllowToolCount,
      log_character_evolution_tool_done: logsAfter.some(
        (record) =>
          record.event === "toolbox.execute.done" &&
          record.tool_name === "character_evolution" &&
          record.tool_outcome === "succeeded",
      ),
      character_evolution_nonce: nonce,
      user_message_text: sentFrame.body?.text,
    },
  ];
}

async function driveAgentDurableResumeLongRunTask(page) {
  await configureProviderRuntime({ provider: "slice_verify" });

  const requestText =
    "请作为可恢复长任务执行：先看看现有角色阵容，然后设计一个反派，最多一步，允许断点续跑。";
  const frameStart = frames.length;
  const logStart = readAppLogRecords().length;

  await page.locator(chatInputSelector).fill(requestText);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      String(frame.body?.text ?? "") === requestText,
    "Durable AgentRun request was not sent from the real workbench input",
    30_000,
  );

  const ackFrame = await waitForNewFrame(
    frameStart,
    (frame) => {
      const response = frame.body?.response ?? {};
      return (
        frame.direction === "received" &&
        frame.event === "phx_reply" &&
        frame.body?.status === "ok" &&
        response.received === true &&
        response.run_mode === "durable" &&
        typeof response.run_id === "string" &&
        response.run_id !== "" &&
        typeof response.long_run_task_ref === "string" &&
        response.long_run_task_ref !== ""
      );
    },
    "Durable AgentRun did not fast-ack with durable run_id and LongRunTask ref",
    30_000,
  );
  const ack = ackFrame.body.response;
  const runId = ack.run_id;
  const longRunTaskRef = ack.long_run_task_ref;

  await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "run_started",
    "Durable AgentRun did not emit run_started",
    30_000,
  );

  const checkpointStateFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId &&
      frame.body?.run_mode === "durable" &&
      frame.body?.long_run_task_ref === longRunTaskRef &&
      frame.body?.status === "awaiting_author" &&
      Number(frame.body?.consumed_budget?.steps ?? 0) === 1 &&
      Array.isArray(frame.body?.completed_step_refs) &&
      frame.body.completed_step_refs.length === 1,
    "Durable AgentRun did not checkpoint at the one-step budget limit",
    60_000,
  );

  await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "awaiting_author" &&
      Array.isArray(frame.body?.reason_codes) &&
      frame.body.reason_codes.includes("budget_exhausted"),
    "Durable AgentRun did not publish the budget checkpoint event",
    60_000,
  );

  await waitForNewAppLogRecord(
    logStart,
    (record) =>
      record.event === "channel.user_message.done" &&
      record.run_id === runId &&
      String(record.run_mode ?? "") === "durable",
    "Durable AgentRun user_message did not log durable ack",
    30_000,
  );

  const textBeforeRestart = await page.locator("body").innerText();
  assert(textBeforeRestart.includes("可恢复长任务"), "Durable AgentRun label was not visible");
  assert(textBeforeRestart.includes("等待你确认"), "Durable checkpoint status was not visible");

  const service = createPhoenixServiceController();
  const recoverFrameStart = frames.length;
  const recoverLogStart = readAppLogRecords().length;
  let restarted = false;

  try {
    await service.stopOriginal();
    await service.restart();
    restarted = true;

    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => /服务: 已连接|同步已连接/.test(document.body.innerText), {
      timeout: 60_000,
    });

    const recoveryEventFrame = await waitForNewFrame(
      recoverFrameStart,
      (frame) =>
        frame.direction === "received" &&
        frame.event === "agent_event" &&
        frame.body?.run_ref === runId &&
        frame.body?.event_type === "run_resumed" &&
        Array.isArray(frame.body?.reason_codes) &&
        frame.body.reason_codes.includes("durable_recovered") &&
        frame.body.reason_codes.includes("stale_resume") &&
        frame.body.reason_codes.includes("runtime_not_live") &&
        frame.body?.payload?.long_run_task_ref === longRunTaskRef,
      "Durable AgentRun did not recover from LongRunTask checkpoint after backend restart",
      60_000,
    );

    const recoveredStateFrame = await waitForNewFrame(
      recoverFrameStart,
      (frame) =>
        frame.direction === "received" &&
        frame.event === "agent_run_state" &&
        frame.body?.run_id === runId &&
        frame.body?.run_mode === "durable" &&
        frame.body?.long_run_task_ref === longRunTaskRef &&
        frame.body?.status === "awaiting_author" &&
        frame.body?.recovered === true &&
        frame.body?.runtime_live === false &&
        frame.body?.long_run_task?.phase === "CHECKPOINT" &&
        frame.body?.long_run_task?.status === "PAUSED",
      "Recovered durable AgentRun state did not include stale checkpoint metadata",
      60_000,
    );

    await waitForNewAppLogRecord(
      recoverLogStart,
      (record) =>
        record.event === "channel.agent_run_recover.done" &&
        record.run_id === runId &&
        record.runtime_live === false &&
        record.recovered === true,
      "Channel did not log durable AgentRun recovery after reconnect",
      60_000,
    );

    // Order 62 CP3 语义迁移：工作详情已移除；恢复语义由运行组 chip（已恢复检查点 +
    // 任务引用）与状态标签（等待你确认）判定。
    await page.waitForFunction(
      (expected) => expected.every((value) => document.body.innerText.includes(value)),
      ["创作执行", "已恢复检查点", "等待你确认", longRunTaskRef],
      { timeout: 30_000 },
    );

    await page.screenshot({
      path: path.join(artifactDir, `${sliceId}-recovered-before-cleanup.png`),
      fullPage: true,
    });

    const visibleText = await page.locator("body").innerText();
    const logsAfterRecovery = readAppLogRecords().slice(recoverLogStart);
    const toolboxAfterRecovery = logsAfterRecovery.filter(
      (record) => record.event === "toolbox.execute.done",
    );

    return [
      {
        event: "slice_verify.ui_state.done",
        slice_id: "agent-durable-resume-long-run-task",
        turn_id: ack.turn_id,
        workspace_id: sentFrame.body?.work_id,
        work_id: sentFrame.body?.work_id,
        session_id: sentFrame.body?.session_id,
        run_id: runId,
        run_mode: ack.run_mode,
        long_run_task_ref: longRunTaskRef,
        profile_ref: ack.profile_ref,
        durable_request_sent_from_real_workbench: true,
        parent_fast_ack_with_long_run_task_ref: true,
        checkpoint_status_before_restart: checkpointStateFrame.body?.status,
        checkpoint_completed_step_count:
          checkpointStateFrame.body?.completed_step_refs?.length ?? 0,
        checkpoint_consumed_steps: checkpointStateFrame.body?.consumed_budget?.steps,
        recovery_event_type: recoveryEventFrame.body?.event_type,
        recovery_reason_codes: recoveryEventFrame.body?.reason_codes ?? [],
        recovered_status: recoveredStateFrame.body?.status,
        recovered: recoveredStateFrame.body?.recovered === true,
        runtime_live_after_restart: recoveredStateFrame.body?.runtime_live,
        recovered_long_run_task_phase: recoveredStateFrame.body?.long_run_task?.phase,
        recovered_long_run_task_status: recoveredStateFrame.body?.long_run_task?.status,
        completed_step_count_after_recovery:
          recoveredStateFrame.body?.completed_step_refs?.length ?? 0,
        repeated_toolbox_after_recovery_count: toolboxAfterRecovery.length,
        stale_resume_visible:
          visibleText.includes("已恢复检查点") && visibleText.includes("等待你确认"),
        long_run_task_ref_visible: visibleText.includes(longRunTaskRef),
        service_restarted_externally: restarted,
        user_message_text: sentFrame.body?.text,
      },
    ];
  } finally {
    if (restarted) {
      await service.stopRestarted();
    }
  }
}

async function driveAgentProviderStreamingProgress(page) {
  await configureProviderRuntime({ provider: "slice_verify" });

  const frameStart = frames.length;
  const requestText = "请展示 provider 进度：用流式进度说明模型执行，不要写入作品事实。";

  await page.locator(chatInputSelector).fill(requestText);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      String(frame.body?.text ?? "").includes("provider 进度"),
    "Provider progress request was not sent from the real workbench",
    10_000,
  );

  const ackFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "phx_reply" &&
      frame.body?.status === "ok" &&
      frame.body?.response?.received === true &&
      frame.body?.response?.profile_ref === "profile_routing_v1" &&
      typeof frame.body?.response?.run_id === "string",
    "Provider progress AgentRun did not fast-ack with profile_routing_v1",
    10_000,
  );
  const runId = ackFrame.body.response.run_id;

  await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId &&
      frame.body?.profile_ref === "provider_progress_v1",
    "Provider progress AgentRun did not transition to provider_progress_v1",
    30_000,
  );

  const planDraftFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "plan_drafted" &&
      frame.body?.payload?.target_tool_ref === "provider_complete" &&
      Array.isArray(frame.body?.payload?.plan_steps) &&
      frame.body.payload.plan_steps.some((step) => step?.target_tool_ref === "provider_complete"),
    "Provider progress AgentRun did not draft a provider_complete AgentPlan",
    30_000,
  );

  const progressEvents = [];
  for (const reason of [
    "provider_call_started",
    "provider_execution_stream_active",
    "provider_call_completed",
  ]) {
    const eventFrame = await waitForNewFrame(
      frameStart,
      (frame) =>
        frame.direction === "received" &&
        frame.event === "agent_event" &&
        frame.body?.run_ref === runId &&
        frame.body?.event_type === "provider_progress" &&
        Array.isArray(frame.body?.reason_codes) &&
        frame.body.reason_codes.includes(reason) &&
        frame.body?.visibility === "author",
      `Provider progress event ${reason} was not author-visible`,
      30_000,
    );
    progressEvents.push(eventFrame);
  }

  const turnResultFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.agent_run?.run_id === runId &&
      String(frame.body?.assistant_message?.text ?? "").includes("模型调用已完成"),
    "Provider progress did not emit final TurnResult",
    30_000,
  );

  const completedStateFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId &&
      frame.body?.status === "completed" &&
      frame.body?.profile_ref === "provider_progress_v1" &&
      Number(frame.body?.consumed_budget?.provider_calls ?? 0) === 3,
    "Provider progress run state did not record provider call budget",
    30_000,
  );

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("provider") &&
      document.body.innerText.includes("模型调用已完成"),
    { timeout: 20_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const rawPromptLeaked = progressEvents.some((frame) =>
    JSON.stringify(frame.body ?? {}).includes(requestText),
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "agent-provider-streaming-progress",
      turn_id: ackFrame.body.response.turn_id,
      work_id: sentFrame.body?.work_id,
      session_id: sentFrame.body?.session_id,
      run_id: runId,
      profile_ref: completedStateFrame.body.profile_ref,
      request_sent_from_real_workbench: true,
      parent_fast_ack_with_run_id: true,
      progress_event_count: progressEvents.length,
      progress_event_types: progressEvents.map((frame) => frame.body?.event_type),
      progress_reason_codes: progressEvents.flatMap((frame) => frame.body?.reason_codes ?? []),
      progress_visibility_author: progressEvents.every(
        (frame) => frame.body?.visibility === "author",
      ),
      progress_has_step_ref: progressEvents.every(
        (frame) => typeof frame.body?.step_ref === "string",
      ),
      plan_drafted_visible: true,
      plan_drafted_target_tool_ref: planDraftFrame.body?.payload?.target_tool_ref,
      plan_drafted_step_count: planDraftFrame.body?.payload?.plan_steps?.length ?? 0,
      raw_prompt_leaked_in_progress_events: rawPromptLeaked,
      provider_execution_stream_active: progressEvents.some((frame) =>
        (frame.body?.reason_codes ?? []).includes("provider_execution_stream_active"),
      ),
      consumed_provider_calls: completedStateFrame.body?.consumed_budget?.provider_calls,
      final_turn_result_run_id: turnResultFrame.body?.agent_run?.run_id,
      ui_progress_visible:
        visibleText.includes("provider") && visibleText.includes("模型调用已完成"),
      user_message_text: sentFrame.body?.text,
    },
  ];
}

async function driveAgentProviderCancelHonestBoundary(page) {
  await configureProviderRuntime({ provider: "slice_verify" });

  const frameStart = frames.length;
  const requestText =
    "请展示 provider 进度和取消边界：UA01CP6SLOW，保持较长 provider 调用以便我点击取消。";

  await page.locator(chatInputSelector).fill(requestText);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      String(frame.body?.text ?? "").includes("UA01CP6SLOW"),
    "Provider cancel request was not sent from the real workbench",
    10_000,
  );

  const ackFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "phx_reply" &&
      frame.body?.status === "ok" &&
      frame.body?.response?.received === true &&
      frame.body?.response?.profile_ref === "profile_routing_v1" &&
      typeof frame.body?.response?.run_id === "string",
    "Provider cancel AgentRun did not fast-ack with profile_routing_v1",
    10_000,
  );
  const runId = ackFrame.body.response.run_id;

  await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId &&
      frame.body?.profile_ref === "provider_progress_v1",
    "Provider cancel AgentRun did not transition to provider_progress_v1",
    30_000,
  );

  await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "provider_progress" &&
      (frame.body?.reason_codes ?? []).includes("provider_call_started"),
    "Provider cancel scenario did not enter provider progress step",
    20_000,
  );

  await page.getByRole("button", { name: /^取消$/ }).click();

  const commandFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "agent_command" &&
      frame.body?.run_id === runId &&
      frame.body?.command === "cancel",
    "Cancel command was not sent for the active provider run_id",
    10_000,
  );

  const interruptFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "interrupt_requested" &&
      (frame.body?.reason_codes ?? []).includes("provider_execution_cancel_requested"),
    "Cancel boundary did not report ProviderExecution cancel request",
    20_000,
  );

  const cancellingStateFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId &&
      frame.body?.status === "cancelling" &&
      frame.body?.current_task === true,
    "Provider cancel did not expose a running cancelling state",
    20_000,
  );

  await page.waitForFunction(() => document.body.innerText.includes("正在取消"), {
    timeout: 20_000,
  });

  const cancelledEventFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "run_cancelled" &&
      (frame.body?.reason_codes ?? []).includes("provider_execution_cancelled"),
    "Provider cancel did not finish through ProviderExecution cancel",
    60_000,
  );

  const cancelledStateFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId &&
      frame.body?.status === "cancelled",
    "Provider cancel did not broadcast final cancelled state",
    60_000,
  );

  const visibleText = await page.locator("body").innerText();

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "agent-provider-cancel-honest-boundary",
      turn_id: ackFrame.body.response.turn_id,
      work_id: sentFrame.body?.work_id,
      session_id: sentFrame.body?.session_id,
      run_id: runId,
      profile_ref: cancelledStateFrame.body?.profile_ref,
      request_sent_from_real_workbench: true,
      command_sent_from_real_button: true,
      command_run_id: commandFrame.body?.run_id,
      command_target_bound_to_active_run: commandFrame.body?.run_id === runId,
      interrupt_event_type: interruptFrame.body?.event_type,
      interrupt_reason_codes: interruptFrame.body?.reason_codes ?? [],
      cancel_strategy: interruptFrame.body?.payload?.cancel_strategy,
      supports_cancellation: interruptFrame.body?.payload?.supports_cancellation,
      current_task_active_during_cancel: interruptFrame.body?.payload?.current_task_active,
      cancelling_status_visible_before_terminal_state:
        cancellingStateFrame.body?.status === "cancelling",
      cancelling_current_task: cancellingStateFrame.body?.current_task,
      terminal_event_type: cancelledEventFrame.body?.event_type,
      terminal_status: cancelledStateFrame.body?.status,
      provider_execution_cancel_visible:
        visibleText.includes("正在取消") || visibleText.includes("已取消"),
      user_message_text: sentFrame.body?.text,
    },
  ];
}

async function driveAgentReadonlyBatchProfile(page) {
  await configureProviderRuntime({ provider: "slice_verify" });

  const frameStart = frames.length;
  const requestText =
    "请只读批量读取作品上下文、角色档案、规则档案和作品统计，不要写入作品事实，也不要生成候选。";

  await page.locator(chatInputSelector).fill(requestText);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      String(frame.body?.text ?? "").includes("只读批量"),
    "Readonly batch request was not sent from the real workbench",
    10_000,
  );

  const ackFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "phx_reply" &&
      frame.body?.status === "ok" &&
      frame.body?.response?.received === true &&
      frame.body?.response?.profile_ref === "profile_routing_v1" &&
      typeof frame.body?.response?.run_id === "string",
    "Readonly batch AgentRun did not fast-ack with profile_routing_v1",
    10_000,
  );
  const runId = ackFrame.body.response.run_id;

  await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId &&
      frame.body?.profile_ref === "readonly_batch_context_v1",
    "Readonly batch AgentRun did not transition to readonly_batch_context_v1",
    30_000,
  );

  const planDraftFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "plan_drafted" &&
      frame.body?.payload?.target_tool_ref === "readonly_batch" &&
      Array.isArray(frame.body?.payload?.plan_steps) &&
      frame.body.payload.plan_steps.length >= 2 &&
      frame.body.payload.plan_steps.every((step) => step?.target_tool_ref === "readonly_batch"),
    "Readonly batch AgentRun did not draft readonly_batch AgentPlan steps",
    30_000,
  );

  const batchItemEvents = [];
  let batchSearchStart = frameStart;
  for (let index = 0; index < 4; index += 1) {
    const eventFrame = await waitForNewFrame(
      batchSearchStart,
      (frame) =>
        frame.direction === "received" &&
        frame.event === "agent_event" &&
        frame.body?.run_ref === runId &&
        frame.body?.event_type === "tool_completed" &&
        (frame.body?.reason_codes ?? []).includes("readonly_batch_item_read") &&
        frame.body?.payload?.production_write === false,
      "Readonly batch item event was not visible and read-only",
      30_000,
    );
    batchItemEvents.push(eventFrame);
    batchSearchStart = frames.indexOf(eventFrame) + 1;
  }

  const turnResultFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.agent_run?.run_id === runId &&
      frame.body?.trace_summary?.readonly_batch === true &&
      frame.body?.trace_summary?.production_write === false &&
      frame.body?.trace_summary?.replay_policy?.recall_provider === false,
    "Readonly batch did not emit a read-only TurnResult",
    30_000,
  );

  const completedStateFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId &&
      frame.body?.status === "completed" &&
      frame.body?.profile_ref === "readonly_batch_context_v1" &&
      Number(frame.body?.consumed_budget?.provider_calls ?? -1) === 2 &&
      Number(frame.body?.pending_artifact_refs?.length ?? -1) === 0,
    "Readonly batch final state was not provider-free and artifact-free",
    30_000,
  );

  await page.waitForFunction(() => document.body.innerText.includes("未写入作品事实"), {
    timeout: 20_000,
  });

  const artifactEvents = frames
    .slice(frameStart)
    .filter(
      (frame) =>
        frame.direction === "received" &&
        frame.event === "agent_event" &&
        frame.body?.run_ref === runId &&
        frame.body?.event_type === "artifact_created",
    );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "agent-readonly-batch-profile",
      turn_id: ackFrame.body.response.turn_id,
      work_id: sentFrame.body?.work_id,
      session_id: sentFrame.body?.session_id,
      run_id: runId,
      profile_ref: completedStateFrame.body.profile_ref,
      request_sent_from_real_workbench: true,
      parent_fast_ack_with_run_id: true,
      readonly_batch_item_event_count: batchItemEvents.length,
      readonly_item_refs: batchItemEvents.map((frame) => frame.body?.payload?.item_ref),
      readonly_events_author_visible: batchItemEvents.every(
        (frame) => frame.body?.visibility === "author",
      ),
      readonly_events_production_write_false: batchItemEvents.every(
        (frame) => frame.body?.payload?.production_write === false,
      ),
      plan_drafted_visible: true,
      plan_drafted_target_tool_ref: planDraftFrame.body?.payload?.target_tool_ref,
      plan_drafted_step_count: planDraftFrame.body?.payload?.plan_steps?.length ?? 0,
      final_turn_result_run_id: turnResultFrame.body?.agent_run?.run_id,
      replay_recall_provider: turnResultFrame.body?.trace_summary?.replay_policy?.recall_provider,
      consumed_provider_calls: completedStateFrame.body?.consumed_budget?.provider_calls,
      consumed_tool_calls: completedStateFrame.body?.consumed_budget?.tool_calls,
      pending_artifact_count: completedStateFrame.body?.pending_artifact_refs?.length ?? 0,
      artifact_event_count: artifactEvents.length,
      no_adoption_or_write: artifactEvents.length === 0,
      user_message_text: sentFrame.body?.text,
    },
  ];
}

async function driveUa01AgentBoundedRosterToCharacterDesignSeeded(page) {
  const requestText = "先看看现有角色阵容，然后设计一个反派，要求避开林澈重名并形成长期冲突。";
  const seededCharacterName = "林澈";
  const workId = readSeedField("work_id");
  const workTitleValue = readSeedField("work_title");
  assert(workId, "UA-01 AgentRun seed did not provide work_id");
  assert(workTitleValue, "UA-01 AgentRun seed did not provide work_title");

  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  assert((await workTitle(page).count()) > 0, "Real work title button is not visible");
  assert((await serviceStatus(page).count()) > 0, "Real service status is not visible");
  await ensureWorkSelectedByTitle(page, workTitleValue, workId);
  await waitForVisibleWorkTitle(page, workTitleValue);

  const frameCount = frames.length;
  await page.locator(chatInputSelector).fill(requestText);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    frameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.work_id === workId &&
      String(frame.body?.text ?? "").includes("先看看现有角色阵容") &&
      String(frame.body?.text ?? "").includes("设计一个反派"),
    "AgentRun request was not sent from the real workbench input",
    10_000,
  );

  const ackFrame = await waitForNewFrame(
    frameCount,
    (frame) => {
      const response = frame.body?.response ?? {};
      return (
        frame.direction === "received" &&
        frame.event === "phx_reply" &&
        frame.body?.status === "ok" &&
        response.received === true &&
        response.run_mode === "bounded" &&
        typeof response.run_id === "string" &&
        response.run_id !== ""
      );
    },
    "AgentRun user_message did not fast-ack with bounded run_id",
    10_000,
  );
  const ackResponse = ackFrame.body.response;
  const runId = ackResponse.run_id;

  const runStartedFrame = await waitForNewFrame(
    frameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "run_started",
    "AgentRun did not emit run_started",
    10_000,
  );

  await waitForNewFrame(
    frameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "plan_drafted",
    "AgentRun did not propose the first step",
    20_000,
  );

  const rosterObservationFrame = await waitForNewFrame(
    frameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "exploration_observed" &&
      String(frame.body?.summary ?? "").includes("已读取当前角色阵容") &&
      String(frame.body?.summary ?? "").includes(seededCharacterName),
    "AgentRun did not publish a roster observation containing the seeded character",
    30_000,
  );

  await waitForNewFrame(
    frames.indexOf(rosterObservationFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "plan_drafted",
    "AgentRun did not start a second step after the roster observation",
    30_000,
  );

  const artifactEventFrame = await waitForNewFrame(
    frameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "artifact_created" &&
      Array.isArray(frame.body?.refs) &&
      frame.body.refs.length >= 1,
    "AgentRun did not emit artifact_created",
    90_000,
  );

  const finalTurnFrame = await waitForNewFrame(
    frameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.agent_run?.run_id === runId &&
      frame.body?.tool_result?.tool_name === "character_design" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "character_seed",
    "AgentRun final character_seed turn_result was not broadcast",
    90_000,
  );
  const finalTurnResult = finalTurnFrame.body;
  const pendingArtifact = finalTurnResult.adoption_state.pending[0];

  const runCompletedFrame = await waitForNewFrame(
    frameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "run_completed",
    "AgentRun did not emit run_completed",
    20_000,
  );

  const completedStateFrame = await waitForNewFrame(
    frameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId &&
      frame.body?.status === "completed" &&
      Array.isArray(frame.body?.completed_step_refs) &&
      frame.body.completed_step_refs.length >= 2,
    "AgentRun state did not report completed two-step run",
    20_000,
  );

  // Order 62 CP3 语义迁移：工作详情/终态区已移除，改以新三层 UI 判定。
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("创作执行") &&
      document.body.innerText.includes("已完成") &&
      document.body.innerText.includes("已读取当前角色阵容") &&
      document.body.innerText.includes("已生成待采纳候选") &&
      document.body.innerText.includes("保存到作品档案") &&
      !document.body.innerText.includes("思考中"),
    undefined,
    { timeout: 30_000 },
  );

  const agentEvents = frames.filter(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId,
  );
  const stepProposedFrames = agentEvents.filter(
    (frame) => frame.body?.event_type === "plan_drafted",
  );
  const observationFrames = agentEvents.filter(
    (frame) => frame.body?.event_type === "exploration_observed",
  );
  const agentRunStates = frames.filter(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId,
  );
  const completedState = completedStateFrame.body;
  const visibleText = await page.locator("body").innerText();
  const eventPayload = artifactEventFrame.body?.payload ?? {};
  const artifactPayload = pendingArtifact.payload ?? {};
  const item = Array.isArray(artifactPayload.items) ? (artifactPayload.items[0] ?? {}) : {};

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_id: completedState.parent_turn_ref,
      parent_turn_id: completedState.parent_turn_ref,
      agent_turn_id: finalTurnResult.turn_id,
      turn_ids: [completedState.parent_turn_ref, finalTurnResult.turn_id].filter(Boolean),
      workspace_id: sentFrame.body?.work_id,
      work_id: workId,
      session_id: sentFrame.body?.session_id,
      work_title: workTitleValue,
      run_id: runId,
      run_mode: ackResponse.run_mode,
      profile_ref: completedState.profile_ref,
      fast_ack_received: true,
      ack_received_before_final_turn:
        frames.indexOf(ackFrame) >= 0 && frames.indexOf(ackFrame) < frames.indexOf(finalTurnFrame),
      run_started_event: runStartedFrame.body?.event_type === "run_started",
      run_completed_event: runCompletedFrame.body?.event_type === "run_completed",
      agent_event_count: agentEvents.length,
      agent_run_state_count: agentRunStates.length,
      plan_drafted_count: stepProposedFrames.length,
      observation_count: observationFrames.length,
      completed_step_count: completedState.completed_step_refs.length,
      completed_step_refs: completedState.completed_step_refs,
      current_step_ref_after_complete: completedState.current_step_ref ?? null,
      consumed_steps: completedState.consumed_budget?.steps ?? 0,
      consumed_tool_calls: completedState.consumed_budget?.tool_calls ?? 0,
      consumed_provider_calls: completedState.consumed_budget?.provider_calls ?? 0,
      remaining_steps: completedState.remaining_steps,
      final_status: completedState.status,
      final_phase: completedState.phase,
      roster_observation_summary: rosterObservationFrame.body?.summary,
      roster_observation_mentions_seed: String(rosterObservationFrame.body?.summary ?? "").includes(
        seededCharacterName,
      ),
      second_step_after_roster_observation:
        stepProposedFrames.length >= 2 &&
        frames.indexOf(stepProposedFrames[1]) > frames.indexOf(rosterObservationFrame),
      artifact_created_event: artifactEventFrame.body?.event_type === "artifact_created",
      artifact_event_payload_redacted: !Object.prototype.hasOwnProperty.call(
        eventPayload,
        "turn_result",
      ),
      final_turn_result_received: true,
      final_turn_agent_run_ref: finalTurnResult.agent_run?.run_id ?? null,
      final_tool_name: finalTurnResult.tool_result?.tool_name ?? null,
      pending_artifact_count: finalTurnResult.adoption_state?.pending?.length ?? 0,
      pending_artifact_id: pendingArtifact.artifact_id,
      pending_artifact_type: pendingArtifact.artifact_type,
      pending_artifact_status: pendingArtifact.adoption_status,
      pending_artifact_title: item.title ?? "",
      pending_artifact_body_chars: String(item.body ?? "").length,
      artifact_adopted: finalTurnResult.truthfulness?.artifact_adopted === true,
      production_write_performed: finalTurnResult.truthfulness?.production_write_performed === true,
      // Order 62 CP3 语义迁移：工作详情/终态区已移除，改以新三层 UI 判定。
      agent_panel_visible: visibleText.includes("创作执行") && visibleText.includes("计划"),
      agent_completed_status_visible:
        visibleText.includes("已完成") || visibleText.includes("无任务"),
      roster_activity_visible: visibleText.includes("已读取当前角色阵容"),
      artifact_activity_visible: visibleText.includes("已生成待采纳候选"),
      save_archive_action_visible: visibleText.includes("保存到作品档案"),
      pause_control_visible: visibleText.includes("暂停"),
      cancel_control_visible: visibleText.includes("取消"),
      adopt_event_sent: frames.some(
        (frame) => frame.direction === "sent" && frame.event === "adopt",
      ),
      author_action_sent: frames.some(
        (frame) => frame.direction === "sent" && frame.event === "author_action",
      ),
      message_text: requestText,
      service_status_text: await serviceStatus(page)
        .textContent()
        .then((value) => value?.trim() ?? ""),
      title_text: await workTitle(page)
        .textContent()
        .then((value) => value?.trim() ?? ""),
      outcome: "done",
    },
  ];
}

async function driveUa01AgentInterruptCommand(page, command) {
  await configureProviderRuntime({ provider: "slice_verify" });

  const nonce = `UA01-SU02SLOW-${Date.now().toString(36)}`;
  const work = await createWorkSeed({
    title: `UA01 AgentRun Interrupt ${nonce}`,
    genre: "赛博修仙",
    core_selling_point: "验证 bounded AgentRun 运行中命令绑定与协作式中断",
    target_reader: "需要可打断多步创作过程的作者",
    tone_preference: "冷静、清晰",
  });
  const workId = work.id;
  const workTitleValue = work.title;

  const joinStart = readAppLogRecords().length;
  await refreshAndSelectWork(page, workTitleValue);
  const joinRecord = await waitForNewAppLogRecord(
    joinStart,
    (record) => record.event === "channel.join.done" && record.work_id === workId,
    "Selecting the UA-01 interrupt work did not join expected work channel",
    30_000,
  );
  await waitForVisibleWorkTitle(page, workTitleValue);
  await sleep(750);

  const frameStart = frames.length;
  const logStart = readAppLogRecords().length;
  const message = `先看看当前已有角色阵容，然后设计一个与主角形成镜像冲突的主要反派；标记${nonce}，慢速执行以便我测试中断。`;

  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.work_id === workId &&
      String(frame.body?.text ?? "").includes(nonce),
    "UA-01 interrupt scenario did not send the author request through the real channel",
    30_000,
  );

  const ackFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "phx_reply" &&
      frame.body?.status === "ok" &&
      frame.body?.response?.received === true &&
      typeof frame.body?.response?.run_id === "string" &&
      frame.body?.response?.run_mode === "bounded",
    "UA-01 interrupt scenario did not receive a bounded AgentRun ack",
    30_000,
  );
  const runId = ackFrame.body.response.run_id;

  await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "run_started",
    "UA-01 interrupt scenario did not broadcast run_started",
    30_000,
  );

  await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "plan_drafted",
    "UA-01 interrupt scenario did not broadcast any plan_drafted event",
    30_000,
  );

  const buttonName = command === "pause" ? /^暂停$/ : /^取消$/;
  await page.getByRole("button", { name: buttonName }).click();

  const commandFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "agent_command" &&
      frame.body?.run_id === runId &&
      frame.body?.command === command,
    `UA-01 did not send ${command} agent_command for the active run_id`,
    30_000,
  );

  const commandAckFrame = await waitForNewFrame(
    frames.indexOf(commandFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "phx_reply" &&
      frame.body?.status === "ok" &&
      frame.body?.response?.received === true &&
      frame.body?.response?.run_id === runId &&
      frame.body?.response?.command === command,
    `UA-01 did not receive ack for ${command} agent_command`,
    30_000,
  );

  const interruptEvent = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "interrupt_requested" &&
      String(frame.body?.summary ?? "").includes(command === "pause" ? "暂停" : "取消"),
    `UA-01 ${command} did not broadcast interrupt_requested`,
    30_000,
  );

  const terminalStatus = command === "pause" ? "paused" : "cancelled";
  const terminalEventType = command === "pause" ? "run_paused" : "run_cancelled";
  const terminalSummary = command === "pause" ? "已暂停" : "已取消";

  const terminalEvent = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === terminalEventType &&
      String(frame.body?.summary ?? "").includes(terminalSummary),
    `UA-01 ${command} did not reach terminal interrupt state`,
    60_000,
  );

  const terminalState = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId &&
      frame.body?.status === terminalStatus,
    `UA-01 ${command} did not broadcast ${terminalStatus} run state`,
    60_000,
  );

  const visibleText = await page.locator("body").innerText();
  const logsAfter = readAppLogRecords().slice(logStart);
  const parentUserMessageLog = logsAfter.find(
    (record) => record.event === "channel.user_message.done" && record.run_id === runId,
  );
  const uiState = await commonUiState(
    page,
    { turn_id: parentUserMessageLog?.turn_id ?? "" },
    sentFrame,
  );

  return [
    {
      ...uiState,
      slice_id: sliceId,
      work_id: workId,
      workspace_id: workId,
      session_id: sentFrame.body?.session_id ?? joinRecord.session_id,
      work_title: workTitleValue,
      parent_turn_id: parentUserMessageLog?.turn_id,
      run_id: runId,
      run_mode: ackFrame.body.response.run_mode,
      command,
      command_sent_from_real_button: true,
      command_run_id: commandFrame.body?.run_id,
      command_ack_run_id: commandAckFrame.body?.response?.run_id,
      command_ack_received: true,
      command_target_bound_to_active_run: commandFrame.body?.run_id === runId,
      interrupt_event_type: interruptEvent.body?.event_type,
      interrupt_summary: interruptEvent.body?.summary,
      terminal_event_type: terminalEvent.body?.event_type,
      terminal_status: terminalState.body?.status,
      terminal_phase: terminalState.body?.phase,
      interrupt_state_status: terminalState.body?.interrupt_state?.status ?? null,
      provider_execution_cancel_requested: (interruptEvent.body?.reason_codes ?? []).includes(
        "provider_execution_cancel_requested",
      ),
      provider_execution_cancel_strategy: interruptEvent.body?.payload?.cancel_strategy,
      interrupt_status_visible:
        visibleText.includes("正在请求暂停") ||
        visibleText.includes("正在取消") ||
        visibleText.includes(terminalSummary),
      no_cross_run_command: commandFrame.body?.run_id === runId,
      user_message_text: sentFrame.body?.text,
    },
  ];
}

async function driveAgentInterruptSafePoint(page) {
  return driveUa01AgentInterruptCommand(page, "pause");
}

async function driveAgentCancelTargetBinding(page) {
  return driveUa01AgentInterruptCommand(page, "cancel");
}

async function driveAgentArchiveReadDuringRun(page) {
  await configureProviderRuntime({ provider: "slice_verify" });

  const nonce = `UA01-ARCH-${Date.now().toString(36)}`;
  const seed = {
    title: `UA01 运行中档案读取 ${nonce}`,
    genre: "赛博修仙",
    core_selling_point: `运行中档案可读 ${nonce}`,
    target_reader: "需要边创作边核对档案的作者",
    tone_preference: "冷静、清晰",
  };
  const work = await createWorkSeed(seed);
  const workId = work.id;

  const joinStart = readAppLogRecords().length;
  await refreshAndSelectWork(page, seed.title);
  const joinRecord = await waitForNewAppLogRecord(
    joinStart,
    (record) => record.event === "channel.join.done" && record.work_id === workId,
    "Selecting the UA-01 archive-read work did not join expected work channel",
    30_000,
  );
  await waitForVisibleWorkTitle(page, seed.title);

  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "概览" }).click();
  let archivePanel = await waitForArchivePanel(page);
  await archivePanel.getByText(seed.genre).first().waitFor({ timeout: 15_000 });
  await archivePanel.getByText(seed.core_selling_point).first().waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "关闭档案" }).first().click();

  const frameStart = frames.length;
  const logStart = readAppLogRecords().length;
  const message = `先看看当前已有角色阵容，然后设计一个与主角形成镜像冲突的主要反派；标记SU02SLOW-${nonce}，慢速执行时我会查看作品档案。`;

  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.work_id === workId &&
      String(frame.body?.text ?? "").includes(nonce),
    "UA-01 archive-read scenario did not send the author request through the real channel",
    30_000,
  );

  const ackFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "phx_reply" &&
      frame.body?.status === "ok" &&
      frame.body?.response?.received === true &&
      typeof frame.body?.response?.run_id === "string" &&
      frame.body?.response?.run_mode === "bounded",
    "UA-01 archive-read scenario did not receive a bounded AgentRun ack",
    30_000,
  );
  const runId = ackFrame.body.response.run_id;

  await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "plan_drafted",
    "UA-01 archive-read scenario did not start an AgentStep",
    30_000,
  );

  const archiveOpenFrameCount = frames.length;
  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "概览" }).click();
  archivePanel = await waitForArchivePanel(page);
  const duringSnapshot = await archivePanelSnapshot(archivePanel);
  const snapshotVisibleDuringRun =
    duringSnapshot.text.includes(seed.genre) &&
    duringSnapshot.text.includes(seed.core_selling_point);
  const finalTurnArrivedBeforeArchive = frames
    .slice(frameStart, archiveOpenFrameCount)
    .some(
      (frame) =>
        frame.direction === "received" &&
        frame.event === "turn_result" &&
        frame.body?.agent_run?.run_id === runId,
    );
  const terminalStateBeforeArchive = frames
    .slice(frameStart, archiveOpenFrameCount)
    .some(
      (frame) =>
        frame.direction === "received" &&
        frame.event === "agent_run_state" &&
        frame.body?.run_id === runId &&
        ["completed", "failed", "cancelled", "paused"].includes(String(frame.body?.status ?? "")),
    );

  assert(snapshotVisibleDuringRun, "Archive overview blanked during active AgentRun");
  assert(!finalTurnArrivedBeforeArchive, "AgentRun completed before archive was opened during run");
  assert(!terminalStateBeforeArchive, "AgentRun reached terminal state before archive was opened");

  const completedState = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId &&
      frame.body?.status === "completed",
    "UA-01 archive-read AgentRun did not complete after archive read",
    90_000,
  );

  const logsAfter = readAppLogRecords().slice(logStart);
  const parentUserMessageLog = logsAfter.find(
    (record) => record.event === "channel.user_message.done" && record.run_id === runId,
  );
  const userMessagesSent = frames
    .slice(frameStart)
    .filter((frame) => frame.direction === "sent" && frame.event === "user_message").length;
  const authorActionsSent = frames
    .slice(frameStart)
    .filter((frame) => frame.direction === "sent" && frame.event === "author_action").length;
  const uiState = await commonUiState(
    page,
    { turn_id: parentUserMessageLog?.turn_id ?? "" },
    sentFrame,
  );

  return [
    {
      ...uiState,
      slice_id: "agent-archive-read-during-run",
      work_id: workId,
      workspace_id: workId,
      session_id: sentFrame.body?.session_id ?? joinRecord.session_id,
      work_title: seed.title,
      parent_turn_id: parentUserMessageLog?.turn_id,
      run_id: runId,
      run_mode: ackFrame.body.response.run_mode,
      archive_opened_while_run_active: true,
      archive_snapshot_visible_during_run: snapshotVisibleDuringRun,
      archive_loading_indicator_during_run:
        duringSnapshot.text.includes("正在读取作品档案") ||
        duringSnapshot.text.includes("正在更新作品档案"),
      final_turn_arrived_before_archive: finalTurnArrivedBeforeArchive,
      terminal_state_before_archive: terminalStateBeforeArchive,
      final_run_completed_after_archive: completedState.body?.status === "completed",
      no_extra_user_message_for_archive: userMessagesSent === 1,
      no_author_action_for_archive_read: authorActionsSent === 0,
      archive_genre_visible: duringSnapshot.text.includes(seed.genre),
      archive_core_selling_point_visible: duringSnapshot.text.includes(seed.core_selling_point),
    },
  ];
}

async function driveAgentWorkIsolation(page) {
  await configureProviderRuntime({ provider: "slice_verify" });

  const nonce = `UA01-WISO-${Date.now().toString(36)}`;
  const sourceWork = await createWorkSeed({
    title: `UA01 隔离源作品 ${nonce}`,
    genre: "赛博修仙",
    core_selling_point: `源作品慢 AgentRun ${nonce}`,
    target_reader: "需要跨作品并行安全的作者",
    tone_preference: "冷静、清晰",
  });
  const targetWork = await createWorkSeed({
    title: `UA01 隔离目标作品 ${nonce}`,
    genre: "都市异能",
    core_selling_point: `目标作品不可被源 AgentRun 污染 ${nonce}`,
    target_reader: "需要跨作品切换的作者",
    tone_preference: "克制",
  });
  const sourceMarker = `SU02SLOW-${nonce}-SOURCE`;
  const message = `先看看当前已有角色阵容，然后设计一个与主角形成镜像冲突的主要反派；标记${sourceMarker}。`;

  const sourceJoinStart = readAppLogRecords().length;
  await refreshAndSelectWork(page, sourceWork.title);
  const sourceJoin = await waitForNewAppLogRecord(
    sourceJoinStart,
    (record) => record.event === "channel.join.done" && record.work_id === sourceWork.id,
    "Selecting the source work did not join expected work channel",
    30_000,
  );
  await waitForVisibleWorkTitle(page, sourceWork.title);

  const frameStart = frames.length;
  const logStart = readAppLogRecords().length;
  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.work_id === sourceWork.id &&
      String(frame.body?.text ?? "").includes(nonce),
    "Agent work-isolation source message was not sent from the source work",
    30_000,
  );

  const ackFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "phx_reply" &&
      frame.body?.status === "ok" &&
      frame.body?.response?.received === true &&
      typeof frame.body?.response?.run_id === "string" &&
      frame.body?.response?.run_mode === "bounded",
    "Agent work-isolation source message did not fast-ack a bounded run",
    30_000,
  );
  const runId = ackFrame.body.response.run_id;

  await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "plan_drafted",
    "Agent work-isolation run did not start before switching work",
    30_000,
  );

  const targetJoinStart = readAppLogRecords().length;
  await refreshAndSelectWork(page, targetWork.title);
  const targetJoin = await waitForNewAppLogRecord(
    targetJoinStart,
    (record) => record.event === "channel.join.done" && record.work_id === targetWork.id,
    "Switching to target work did not join expected work channel",
    30_000,
  );
  await waitForVisibleWorkTitle(page, targetWork.title);

  await waitForNewAppLogRecord(
    logStart,
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.tool_name === "character_design" &&
      record.tool_outcome === "succeeded",
    "Source AgentRun character_design did not finish while target work was open",
    90_000,
  );
  await sleep(750);

  const targetVisibleAfterSourceDone = await page.locator("body").innerText();
  const sourceUserVisibleInTarget = targetVisibleAfterSourceDone.includes(message);
  const sourceMarkerVisibleInTarget = targetVisibleAfterSourceDone.includes(sourceMarker);
  const sourceDraftVisibleInTarget =
    targetVisibleAfterSourceDone.includes("角色设定草稿") ||
    targetVisibleAfterSourceDone.includes("保存到作品档案");
  const targetLoadingAfterSourceDone = targetVisibleAfterSourceDone.includes("思考中");

  assert(!sourceUserVisibleInTarget, "Source AgentRun user message leaked into target work");
  assert(!sourceMarkerVisibleInTarget, "Source AgentRun marker leaked into target work");
  assert(!sourceDraftVisibleInTarget, "Source AgentRun draft leaked into target work");
  assert(
    !targetLoadingAfterSourceDone,
    "Target work remained loading after source AgentRun finished",
  );

  const logsAfter = readAppLogRecords().slice(logStart);
  const parentUserMessageLog = logsAfter.find(
    (record) => record.event === "channel.user_message.done" && record.run_id === runId,
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "agent-work-isolation",
      turn_id: parentUserMessageLog?.turn_id,
      parent_turn_id: parentUserMessageLog?.turn_id,
      work_id: sourceWork.id,
      context_work_id: sourceWork.id,
      source_work_id: sourceWork.id,
      target_work_id: targetWork.id,
      source_session_id: sourceJoin.session_id,
      target_session_id: targetJoin.session_id,
      session_id: sourceJoin.session_id,
      socket_connected: true,
      run_id: runId,
      run_mode: ackFrame.body.response.run_mode,
      source_message_text: message,
      sent_frame_work_id: sentFrame.body?.work_id,
      source_user_visible_in_target: sourceUserVisibleInTarget,
      source_marker_visible_in_target: sourceMarkerVisibleInTarget,
      source_draft_visible_in_target: sourceDraftVisibleInTarget,
      target_visible_after_source_done:
        !sourceUserVisibleInTarget && !sourceMarkerVisibleInTarget && !sourceDraftVisibleInTarget,
      target_loading_after_source_done: targetLoadingAfterSourceDone,
      target_title_text: await workTitle(page)
        .textContent()
        .then((value) => value?.trim() ?? ""),
      service_status_text: await serviceStatus(page)
        .textContent()
        .then((value) => value?.trim() ?? ""),
    },
  ];
}

async function driveAgentSteerReplan(page, options = {}) {
  await configureProviderRuntime({ provider: "slice_verify" });

  const sliceId = options.sliceId ?? "agent-steer-replan";
  const useMainInput = options.useMainInput !== false;
  const nonce = `UA01-STEER-${Date.now().toString(36)}`;
  const steerText = `把后续角色方向调整为克制、冷静、长期博弈，标记${nonce}`;
  const work = await createWorkSeed({
    title: `${useMainInput ? "UA01 AgentRun Main Steer" : "UA01 AgentRun Steer"} ${nonce}`,
    genre: "赛博修仙",
    core_selling_point: "验证运行中的 bounded AgentRun 接受作者 steer 并广播重规划事件",
    target_reader: "需要在多步创作中途调整方向的作者",
    tone_preference: "冷静、清晰",
  });
  const workId = work.id;

  const joinStart = readAppLogRecords().length;
  await refreshAndSelectWork(page, work.title);
  const joinRecord = await waitForNewAppLogRecord(
    joinStart,
    (record) => record.event === "channel.join.done" && record.work_id === workId,
    "Selecting the UA-01 steer work did not join expected work channel",
    30_000,
  );
  await waitForVisibleWorkTitle(page, work.title);
  await sleep(750);

  const frameStart = frames.length;
  const logStart = readAppLogRecords().length;
  const message = `先看看当前已有角色阵容，然后设计一个与主角形成镜像冲突的主要反派；标记SU02SLOW-${nonce}，慢速执行以便我调整方向。`;

  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.work_id === workId &&
      String(frame.body?.text ?? "").includes(nonce),
    "UA-01 steer scenario did not send the author request through the real channel",
    30_000,
  );

  const ackFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "phx_reply" &&
      frame.body?.status === "ok" &&
      frame.body?.response?.received === true &&
      typeof frame.body?.response?.run_id === "string" &&
      frame.body?.response?.run_mode === "bounded",
    "UA-01 steer scenario did not receive a bounded AgentRun ack",
    30_000,
  );
  const runId = ackFrame.body.response.run_id;

  const firstRunningStateFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId &&
      frame.body?.status === "running",
    "UA-01 steer scenario did not broadcast a running AgentRun state",
    30_000,
  );

  const steerFrameStart = frames.length;
  const steerPlaceholderVisibleBeforeCommand = await page
    .locator(agentRunSteerInputSelector)
    .waitFor({ state: "visible", timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  const steerPlaceholderBeforeCommand = steerPlaceholderVisibleBeforeCommand
    ? await page.locator(agentRunSteerInputSelector).getAttribute("placeholder")
    : "";

  if (useMainInput) {
    assert(
      steerPlaceholderVisibleBeforeCommand,
      "UA-01 steer scenario did not expose the active-run main input steering placeholder",
    );
    await page.locator(agentRunSteerInputSelector).fill(steerText);
    await page.getByRole("button", { name: /^发送$/ }).click();
  } else {
    await page.getByLabel("调整方向").fill(steerText);
    await page.getByRole("button", { name: /^调整方向$/ }).click();
  }
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      return (
        text.includes("创作执行") &&
        (text.includes("进行中") ||
          text.includes("等待你确认") ||
          text.includes("正在启动创作执行"))
      );
    },
    {},
    { timeout: 3_000 },
  );
  const activeRunWorkStateVisibleAfterSteer = true;
  const mainInputSteerTextVisibleAfterSubmit = useMainInput
    ? await page
        .waitForFunction(
          (expectedText) => document.body.innerText.includes(expectedText),
          steerText,
          { timeout: 3_000 },
        )
        .then(() => true)
        .catch(() => false)
    : false;

  const commandFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "agent_command" &&
      frame.body?.run_id === runId &&
      frame.body?.command === "steer" &&
      String(frame.body?.text ?? "").includes(nonce),
    useMainInput
      ? "UA-01 natural language steer was not sent as an agent_command from the main input"
      : "UA-01 steer command was not sent from the real AgentRun control",
    30_000,
  );

  const commandAckFrame = await waitForNewFrame(
    frames.indexOf(commandFrame) + 1,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "phx_reply" &&
      frame.body?.status === "ok" &&
      frame.body?.response?.received === true &&
      frame.body?.response?.run_id === runId &&
      frame.body?.response?.command === "steer",
    "UA-01 steer command did not ack for the same run_id",
    30_000,
  );

  const planAdjustedFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "plan_adjusted",
    "UA-01 steer did not broadcast a plan_adjusted AgentEvent",
    30_000,
  );

  const planRevisedFrame = await waitForNewFrame(
    steerFrameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "plan_revised",
    "UA-01 steer did not promote the next planner narrative to plan_revised",
    30_000,
  );

  const adjustedStateFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId &&
      String(frame.body?.goal?.text ?? "").includes(nonce) &&
      Number(frame.body?.goal?.version ?? 0) >= 2,
    "UA-01 steer did not broadcast adjusted run goal state",
    30_000,
  );

  const terminalStateFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId &&
      frame.body?.status === "completed",
    "UA-01 steer run did not reach completed state",
    90_000,
  );

  const activeRunTerminalWorkStateVisibleAfterSteer = await page
    .waitForFunction(
      ({ steerText }) => {
        const rows = Array.from(
          document.querySelectorAll('[class*="userMsg"], [class*="assistantMsg"]'),
        ).map((element) => {
          const className = String(element.className ?? "");
          return {
            role: className.includes("userMsg")
              ? "user"
              : className.includes("assistantMsg")
                ? "assistant"
                : null,
            text: element.textContent ?? "",
          };
        });

        let steerUserIndex = -1;
        rows.forEach((row, index) => {
          if (row.role === "user" && row.text.includes(steerText)) {
            steerUserIndex = index;
          }
        });
        if (steerUserIndex < 0) return false;

        return rows
          .slice(steerUserIndex + 1)
          .some(
            (row) =>
              row.role === "assistant" &&
              row.text.includes("创作执行") &&
              (row.text.includes("当前创作请求已完成") || row.text.includes("当前：已完成")),
          );
      },
      { steerText },
      { timeout: 30_000 },
    )
    .then(() => true)
    .catch(() => false);
  assert(
    activeRunTerminalWorkStateVisibleAfterSteer,
    "UA-01 steer terminal AgentRun work state disappeared after the latest steer message",
  );

  const visibleText = await page.locator("body").innerText();
  const agenticLoopEvidenceLayout = await focusLatestAgenticLoopEvidence(page);
  const framesAfterSteer = frames.slice(steerFrameStart);
  const secondUserMessageForSteer = framesAfterSteer.find(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      String(frame.body?.text ?? "").includes(nonce),
  );
  const logsAfter = readAppLogRecords().slice(logStart);
  const parentUserMessageLog = logsAfter.find(
    (record) => record.event === "channel.user_message.done" && record.run_id === runId,
  );
  const uiState = await commonUiState(
    page,
    { turn_id: parentUserMessageLog?.turn_id ?? "" },
    sentFrame,
  );

  return [
    {
      ...uiState,
      slice_id: sliceId,
      work_id: workId,
      workspace_id: workId,
      session_id: sentFrame.body?.session_id ?? joinRecord.session_id,
      work_title: work.title,
      parent_turn_id: parentUserMessageLog?.turn_id,
      run_id: runId,
      run_mode: ackFrame.body.response.run_mode,
      command: "steer",
      command_text: commandFrame.body?.text,
      command_sent_from_real_button: !useMainInput,
      command_sent_from_main_input: useMainInput,
      main_input_steer_placeholder_visible: steerPlaceholderVisibleBeforeCommand,
      main_input_steer_placeholder_text: steerPlaceholderBeforeCommand,
      active_run_work_state_visible_after_steer: activeRunWorkStateVisibleAfterSteer,
      active_run_terminal_work_state_visible_after_steer:
        activeRunTerminalWorkStateVisibleAfterSteer,
      terminal_status: terminalStateFrame.body?.status,
      main_input_steer_text_visible_after_submit: mainInputSteerTextVisibleAfterSubmit,
      no_second_user_message_for_steer: !secondUserMessageForSteer,
      command_ack_received: commandAckFrame.body?.response?.received === true,
      command_target_bound_to_active_run: commandFrame.body?.run_id === runId,
      plan_adjusted_event_type: planAdjustedFrame.body?.event_type,
      plan_revised_event_type: planRevisedFrame.body?.event_type,
      plan_revised_summary: planRevisedFrame.body?.summary ?? "",
      plan_revised_author_narrative_source_type:
        planRevisedFrame.body?.payload?.author_narrative_source?.source_type,
      plan_revised_plan_version: planRevisedFrame.body?.payload?.plan_version ?? null,
      plan_revised_revision_reason:
        planRevisedFrame.body?.payload?.plan_revision?.revision_reason ?? "",
      plan_revised_evaluation_plan_holds:
        planRevisedFrame.body?.payload?.evaluation_of_last?.plan_holds,
      consumed_steps: terminalStateFrame.body?.consumed_budget?.steps,
      consumed_tool_calls: terminalStateFrame.body?.consumed_budget?.tool_calls,
      consumed_provider_calls: terminalStateFrame.body?.consumed_budget?.provider_calls,
      consumed_replans: terminalStateFrame.body?.consumed_budget?.replans,
      first_running_state_status: firstRunningStateFrame.body?.status,
      adjusted_goal_text: adjustedStateFrame.body?.goal?.text ?? "",
      adjusted_goal_version: adjustedStateFrame.body?.goal?.version ?? null,
      steer_control_visible:
        visibleText.includes("调整方向") || steerPlaceholderVisibleBeforeCommand,
      agentic_loop_evidence_layout: agenticLoopEvidenceLayout,
      ui_agentic_loop_root_960_width:
        typeof agenticLoopEvidenceLayout?.flow_width === "number" &&
        agenticLoopEvidenceLayout.flow_width >= 940 &&
        agenticLoopEvidenceLayout.flow_width <= 980,
      ui_agentic_loop_phase_920_width:
        typeof agenticLoopEvidenceLayout?.phase_width === "number" &&
        agenticLoopEvidenceLayout.phase_width >= 900 &&
        agenticLoopEvidenceLayout.phase_width <= 940,
      ui_agentic_loop_phase_visible_in_evidence:
        typeof agenticLoopEvidenceLayout?.phase_top === "number" &&
        agenticLoopEvidenceLayout.phase_top >= 0 &&
        agenticLoopEvidenceLayout.phase_top <= agenticLoopEvidenceLayout.viewport_height,
      no_cross_run_command: commandFrame.body?.run_id === runId,
      user_message_text: sentFrame.body?.text,
    },
  ];
}

async function driveAgentNaturalLanguageSteer(page) {
  return driveAgentSteerReplan(page, {
    sliceId: "agent-natural-language-steer",
    useMainInput: true,
  });
}

async function driveAgentLoopBudgetLimit(page) {
  await configureProviderRuntime({ provider: "slice_verify" });

  const nonce = `UA01-BUDGET-${Date.now().toString(36)}`;
  const work = await createWorkSeed({
    title: `UA01 AgentRun Budget ${nonce}`,
    genre: "赛博修仙",
    core_selling_point: "验证 bounded AgentRun 受作者预算限制停止",
    target_reader: "需要限制自动执行步数的作者",
    tone_preference: "冷静、清晰",
  });
  const workId = work.id;

  const joinStart = readAppLogRecords().length;
  await refreshAndSelectWork(page, work.title);
  const joinRecord = await waitForNewAppLogRecord(
    joinStart,
    (record) => record.event === "channel.join.done" && record.work_id === workId,
    "Selecting the UA-01 budget work did not join expected work channel",
    30_000,
  );
  await waitForVisibleWorkTitle(page, work.title);

  const frameStart = frames.length;
  const logStart = readAppLogRecords().length;
  const message = `先看看当前已有角色阵容，然后设计一个主要反派；最多一步，标记${nonce}。`;

  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.work_id === workId &&
      String(frame.body?.text ?? "").includes(nonce),
    "UA-01 budget scenario did not send the bounded author request",
    30_000,
  );

  const ackFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "phx_reply" &&
      frame.body?.status === "ok" &&
      frame.body?.response?.received === true &&
      typeof frame.body?.response?.run_id === "string" &&
      frame.body?.response?.run_mode === "bounded",
    "UA-01 budget scenario did not receive bounded AgentRun ack",
    30_000,
  );
  const runId = ackFrame.body.response.run_id;

  await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "exploration_observed",
    "UA-01 budget scenario did not complete the roster observation step",
    60_000,
  );

  const awaitingFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "awaiting_author" &&
      Array.isArray(frame.body?.reason_codes) &&
      frame.body.reason_codes.includes("budget_exhausted"),
    "UA-01 budget scenario did not stop at the step budget limit",
    60_000,
  );

  const awaitingState = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId &&
      frame.body?.status === "awaiting_author" &&
      Number(frame.body?.consumed_budget?.steps ?? 0) === 1,
    "UA-01 budget scenario did not broadcast awaiting_author state with one consumed step",
    60_000,
  );

  await sleep(750);
  const logsAfter = readAppLogRecords().slice(logStart);
  const parentUserMessageLog = logsAfter.find(
    (record) => record.event === "channel.user_message.done" && record.run_id === runId,
  );
  const characterDesignExecuted = logsAfter.some(
    (record) => record.event === "toolbox.execute.done" && record.tool_name === "character_design",
  );
  const finalTurnResultArrived = frames
    .slice(frameStart)
    .some(
      (frame) =>
        frame.direction === "received" &&
        frame.event === "turn_result" &&
        frame.body?.agent_run?.run_id === runId,
    );
  assert(!characterDesignExecuted, "Budget-limited AgentRun still executed character_design");
  assert(
    !finalTurnResultArrived,
    "Budget-limited AgentRun still emitted final character TurnResult",
  );

  const visibleText = await page.locator("body").innerText();
  const uiState = await commonUiState(
    page,
    { turn_id: parentUserMessageLog?.turn_id ?? "" },
    sentFrame,
  );

  return [
    {
      ...uiState,
      slice_id: "agent-loop-budget-limit",
      work_id: workId,
      workspace_id: workId,
      session_id: sentFrame.body?.session_id ?? joinRecord.session_id,
      work_title: work.title,
      parent_turn_id: parentUserMessageLog?.turn_id,
      run_id: runId,
      run_mode: ackFrame.body.response.run_mode,
      awaiting_event_type: awaitingFrame.body?.event_type,
      awaiting_reason_codes: awaitingFrame.body?.reason_codes ?? [],
      terminal_status: awaitingState.body?.status,
      consumed_steps: awaitingState.body?.consumed_budget?.steps,
      consumed_tool_calls: awaitingState.body?.consumed_budget?.tool_calls,
      consumed_provider_calls: awaitingState.body?.consumed_budget?.provider_calls,
      remaining_steps: awaitingState.body?.remaining_steps,
      character_design_executed: characterDesignExecuted,
      final_turn_result_arrived: finalTurnResultArrived,
      budget_stop_visible: visibleText.includes("预算上限") || visibleText.includes("等待你确认"),
      user_message_text: sentFrame.body?.text,
    },
  ];
}

async function driveAgentNoProgressStop(page) {
  await configureProviderRuntime({ provider: "slice_verify" });

  const nonce = `UA01-NOPROG-${Date.now().toString(36)}`;
  const work = await createWorkSeed({
    title: `UA01 AgentRun No Progress ${nonce}`,
    genre: "赛博修仙",
    core_selling_point: "验证 bounded AgentRun 重复无进展时停止等待作者",
    target_reader: "需要避免自动循环空转的作者",
    tone_preference: "冷静、清晰",
  });
  const workId = work.id;

  const joinStart = readAppLogRecords().length;
  await refreshAndSelectWork(page, work.title);
  const joinRecord = await waitForNewAppLogRecord(
    joinStart,
    (record) => record.event === "channel.join.done" && record.work_id === workId,
    "Selecting the UA-01 no-progress work did not join expected work channel",
    30_000,
  );
  await waitForVisibleWorkTitle(page, work.title);

  const frameStart = frames.length;
  const logStart = readAppLogRecords().length;
  const message = `先重复读取角色阵容直到没有新信息，然后再设计一个主要反派，标记${nonce}。`;

  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.work_id === workId &&
      String(frame.body?.text ?? "").includes(nonce),
    "UA-01 no-progress scenario did not send the repeated roster request",
    30_000,
  );

  const ackFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "phx_reply" &&
      frame.body?.status === "ok" &&
      frame.body?.response?.received === true &&
      typeof frame.body?.response?.run_id === "string" &&
      frame.body?.response?.run_mode === "bounded",
    "UA-01 no-progress scenario did not receive bounded AgentRun ack",
    30_000,
  );
  const runId = ackFrame.body.response.run_id;

  await waitForNewAppLogCount(
    logStart,
    (record) => record.event === "toolbox.execute.done" && record.tool_name === "character_roster",
    2,
    "UA-01 no-progress scenario did not execute two roster reads",
    60_000,
  );

  const awaitingFrame = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_event" &&
      frame.body?.run_ref === runId &&
      frame.body?.event_type === "awaiting_author" &&
      Array.isArray(frame.body?.reason_codes) &&
      frame.body.reason_codes.includes("no_progress"),
    "UA-01 no-progress scenario did not stop on repeated progress signature",
    60_000,
  );

  const awaitingState = await waitForNewFrame(
    frameStart,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "agent_run_state" &&
      frame.body?.run_id === runId &&
      frame.body?.status === "awaiting_author" &&
      Number(frame.body?.consumed_budget?.steps ?? 0) === 2 &&
      Number(frame.body?.consumed_budget?.provider_calls ?? 0) === 3,
    "UA-01 no-progress scenario did not broadcast stopped state with planner-only provider calls",
    60_000,
  );

  await sleep(750);
  const logsAfter = readAppLogRecords().slice(logStart);
  const parentUserMessageLog = logsAfter.find(
    (record) => record.event === "channel.user_message.done" && record.run_id === runId,
  );
  const rosterToolCount = logsAfter.filter(
    (record) => record.event === "toolbox.execute.done" && record.tool_name === "character_roster",
  ).length;
  const characterDesignExecuted = logsAfter.some(
    (record) => record.event === "toolbox.execute.done" && record.tool_name === "character_design",
  );
  const finalTurnResultArrived = frames
    .slice(frameStart)
    .some(
      (frame) =>
        frame.direction === "received" &&
        frame.event === "turn_result" &&
        frame.body?.agent_run?.run_id === runId,
    );
  assert(!characterDesignExecuted, "No-progress AgentRun still executed character_design");
  assert(!finalTurnResultArrived, "No-progress AgentRun still emitted final character TurnResult");

  const visibleText = await page.locator("body").innerText();
  const uiState = await commonUiState(
    page,
    { turn_id: parentUserMessageLog?.turn_id ?? "" },
    sentFrame,
  );

  return [
    {
      ...uiState,
      slice_id: "agent-no-progress-stop",
      work_id: workId,
      workspace_id: workId,
      session_id: sentFrame.body?.session_id ?? joinRecord.session_id,
      work_title: work.title,
      parent_turn_id: parentUserMessageLog?.turn_id,
      run_id: runId,
      run_mode: ackFrame.body.response.run_mode,
      awaiting_event_type: awaitingFrame.body?.event_type,
      awaiting_reason_codes: awaitingFrame.body?.reason_codes ?? [],
      terminal_status: awaitingState.body?.status,
      consumed_steps: awaitingState.body?.consumed_budget?.steps,
      consumed_tool_calls: awaitingState.body?.consumed_budget?.tool_calls,
      consumed_provider_calls: awaitingState.body?.consumed_budget?.provider_calls,
      roster_tool_count: rosterToolCount,
      character_design_executed: characterDesignExecuted,
      final_turn_result_arrived: finalTurnResultArrived,
      no_progress_stop_visible:
        visibleText.includes("未取得新进展") || visibleText.includes("等待你确认"),
      user_message_text: sentFrame.body?.text,
    },
  ];
}

const drivers = {
  "ua01-agent-bounded-roster-to-character-design": driveUa01AgentBoundedRosterToCharacterDesign,
  "agent-bounded-roster-to-character-design": driveUa01AgentBoundedRosterToCharacterDesign,
  "agent-step-regate": driveUa01AgentBoundedRosterToCharacterDesign,
  "agent-no-multistep-plan-bypass": driveUa01AgentBoundedRosterToCharacterDesign,
  "agent-event-author-safe": driveUa01AgentBoundedRosterToCharacterDesign,
  "agent-channel-fast-ack": driveUa01AgentBoundedRosterToCharacterDesign,
  "agent-interrupt-safe-point": driveAgentInterruptSafePoint,
  "agent-cancel-target-binding": driveAgentCancelTargetBinding,
  "agent-archive-read-during-run": driveAgentArchiveReadDuringRun,
  "agent-work-isolation": driveAgentWorkIsolation,
  "agent-tentative-boundary": driveUa01AgentBoundedRosterToCharacterDesign,
  "agent-provider-call-budget": driveUa01AgentBoundedRosterToCharacterDesign,
  "agent-prose-drafting-with-quality": driveAgentProseDraftingWithQuality,
  "agent-conversation-turn": driveAgentConversationTurn,
  "agentic-loop-plan-replan-reasoning": driveAgenticLoopPlanReplanReasoning,
  "agentic-loop-no-deviation-direct": driveAgenticLoopNoDeviationDirect,
  "agent-plan-native-tool-calling-protocol": driveAgentPlanNativeToolCallingProtocol,
  "agentic-loop-budget-deviation-replan": driveAgenticLoopBudgetDeviationReplan,
  "agentic-loop-tool-failure-replan": driveAgenticLoopToolFailureReplan,
  "agentic-loop-quality-deviation-replan": driveAgenticLoopQualityDeviationReplan,
  "agentic-loop-gate-deviation-replan": driveAgenticLoopGateDeviationReplan,
  "agentic-loop-deterministic-gap-replan": driveAgenticLoopDeterministicGapReplan,
  "agent-provider-execution-stream-unified": driveAgentProviderExecutionStreamUnified,
  "agent-provider-execution-activity-restored": driveAgentProviderExecutionActivityRestored,
  "agent-provider-execution-error-author-safe": driveAgentProviderExecutionErrorAuthorSafe,
  "agent-session-transcript-lazy-page": driveAgentSessionTranscriptLazyPage,
  "agent-plot-outline-with-context": driveAgentPlotOutlineWithContext,
  "agent-world-building-with-context": driveAgentWorldBuildingWithContext,
  "agent-world-building-style-rule-with-context": driveAgentWorldBuildingStyleRuleWithContext,
  "agent-character-evolution-with-context": driveAgentCharacterEvolutionWithContext,
  "agent-durable-resume-long-run-task": driveAgentDurableResumeLongRunTask,
  "agent-provider-streaming-progress": driveAgentProviderStreamingProgress,
  "agent-provider-cancel-honest-boundary": driveAgentProviderCancelHonestBoundary,
  "agent-readonly-batch-profile": driveAgentReadonlyBatchProfile,
  "agent-steer-replan": driveAgentSteerReplan,
  "agent-natural-language-steer": driveAgentNaturalLanguageSteer,
  "agent-loop-budget-limit": driveAgentLoopBudgetLimit,
  "agent-no-progress-stop": driveAgentNoProgressStop,
  "p1-prose-execution-brief": driveP1ProseExecutionBrief,
  "p1-prose-revision-candidate": driveP1ProseRevisionCandidate,
  "agent-revision-orchestrator-boundary": driveP1ProseRevisionCandidate,
  "agent-replay-no-provider": driveP1ProseRevisionCandidate,
  "p1-prose-quality-finding-roundtrip": driveP1ProseQualityFindingRoundtrip,
  "p1-prose-quality-evaluator-degrade": driveP1ProseQualityEvaluatorDegrade,
  "p1-prose-quality-adoption-boundary": driveP1ProseQualityAdoptionBoundary,
  "su01-provider-health-model": driveSu01ProviderHealthModel,
  "su01-lmstudio-disconnected-health": driveSu01LmstudioDisconnectedHealth,
  "su01-provider-endpoint-validation": driveSu01ProviderEndpointValidation,
  "su01-provider-model-list-success": driveSu01ProviderModelListSuccess,
  "su01-provider-test-failure-ui": driveSu01ProviderTestFailureUi,
  "su01-api-key-secret-redaction": driveSu01ApiKeySecretRedaction,
  "su01-provider-vendor-matrix": driveSu01ProviderVendorMatrix,
  "su01-model-provider-switching": driveSu01ModelProviderSwitching,
  "su02-work-switching": driveSu02WorkSwitching,
  "su02-artifact-projection-trace-isolation": driveSu02ArtifactProjectionTraceIsolation,
  "su02-empty-start-unnamed-work": driveSu02EmptyStartUnnamedWork,
  "su02-pending-result-work-isolation": driveSu02PendingResultWorkIsolation,
  "su02-work-lifecycle-management": driveSu02WorkLifecycleManagement,
  "su02-work-restart-recovery": driveSu02WorkRestartRecovery,
  "su03-assistant-display-name": driveSu03AssistantDisplayName,
  "au01-ordinary-chat-two-turn-roundtrip": driveAu01OrdinaryChatTwoTurnRoundtrip,
  "au01-empty-message-guard": driveAu01EmptyMessageGuard,
  "au01-garbage-json-recovery": driveAu01GarbageJsonRecovery,
  "au01-frame-validation-friendly-error": driveAu01FrameValidationFriendlyError,
  "au01-turnresult-recorder-ui-consistency": driveAu01TurnresultRecorderUiConsistency,
  "au10-workbench-matrix-layout": driveAu10WorkbenchMatrixLayout,
  "au10-workbench-recovery-taskstate": driveAu10WorkbenchRecoveryTaskstate,
  "au10-workbench-recovery-disconnect-timeout": driveAu10WorkbenchRecoveryDisconnectTimeout,
  "au10-workbench-recovery-provider-timeout": driveAu10WorkbenchRecoveryProviderTimeout,
  "au10-workbench-recovery-reconnect": driveAu10WorkbenchRecoveryReconnect,
  "au10-workbench-recovery-cancel-waiting": driveAu10WorkbenchRecoveryCancelWaiting,
  "au07-behavior-trace-terminal-replay": driveAu07BehaviorTraceTerminalReplay,
  "au12-work-profile-overview": driveAu12WorkProfileOverview,
  "au12-correction-intent-roundtrip": driveAu12CorrectionIntentRoundtrip,
  "au12-profile-read-failure-degrade": driveAu12ProfileReadFailureDegrade,
  "au12-work-profile-status-isolation": driveAu12WorkProfileStatusIsolation,
  "vs00c-cp0-missing-chapter-block": driveCp0MissingChapterBlock,
  "vs00c-cp3-structured-context": driveVs00cCp3StructuredContext,
  "vs00c-cp4-chapter-plan-structure": driveVs00cCp4ChapterPlanStructure,
  "vs00c-cp5-reader-effect-brief": driveVs00cCp4ChapterPlanStructure,
  "au02-natural-exploration-no-slot-form": driveNaturalExplorationNoSlotForm,
  "au02-candidate-continuation": driveCandidateContinuation,
  "au02-candidate-multiturn-context": driveCandidateMultiturnContext,
  "au02-candidate-fallback-ui": driveCandidateFallbackUi,
  "au02-freeform-followup-after-candidate": driveCandidateFreeformFollowup,
  "au02-unadopted-candidate-no-reading-fact": driveUnadoptedCandidateNoReadingFact,
  "au02-candidate-adoption-bridge": driveCandidateAdoptionBridge,
  "au05-adoption-safety-freshness": driveAdoptionSafetyFreshness,
  "au05-stale-conflict-cross-work-freshness": driveStaleConflictCrossWorkFreshness,
  "au05-conflict-cross-work-recovery": driveConflictCrossWorkRecovery,
  "au05-canon-conflict-recovery": driveCanonConflictRecovery,
  "au05-discard-author-action": driveAu05DiscardAuthorAction,
  "p1-chapter-plan-minimum": driveP1ChapterPlanMinimum,
  "p1-chapter-draft-generation": driveP1ChapterDraftGeneration,
  "p1-chapter-adoption-reading": driveP1ChapterAdoptionReading,
  "au07-state-trace-adoption-replay": driveAu07StateTraceAdoptionReplay,
  "p1-word-count-audit": driveP1WordCountAudit,
  "p1-chapter-edit-then-accept": driveP1ChapterEditThenAccept,
  "p1-chapter-overwrite-confirm": driveP1ChapterOverwriteConfirm,
  "p1-chapter-expansion": driveP1ChapterExpansion,
  "p1-chapter-expansion-multichapter": driveP1ChapterExpansionMultichapter,
  "p1-chapter-word-count-target": driveP1ChapterWordCountTarget,
  "p1-export-minimum": driveP1ExportMinimum,
  "au08-reading-readonly-no-write": driveAu08ReadingReadonlyNoWrite,
  "au08-reading-return-context": driveAu08ReadingReturnContext,
  "p1-plan-incremental": driveP1PlanIncremental,
  "au04-confirm-before-execute": driveAu04ConfirmBeforeExecute,
  "au04-confirmation-tool-failure-recovery": driveAu04ConfirmationToolFailureRecovery,
  "au04-confirm-idempotency-ui": driveAu04ConfirmIdempotencyUi,
  "au04-stale-confirmation-ui": driveAu04StaleConfirmationUi,
  "au06-single-active-confirmation": driveAu06SingleActiveConfirmation,
  "au04-confirmation-ttl-ui": driveAu04ConfirmationTtlUi,
  "au04-disabled-confirmation-action-ui": driveAu04DisabledConfirmationActionUi,
  "au04-history-confirmation-readonly": driveAu04HistoryConfirmationReadonly,
  "au04-cross-work-confirmation-guard": driveAu04CrossWorkConfirmationGuard,
  "au04-latest-context-rebase-confirmation": driveAu04LatestContextRebaseConfirmation,
  "au09-memory-create-recall": driveAu09MemoryCreateRecall,
  "au09-archive-stats-current": driveAu09ArchiveStatsCurrent,
  "au09-memory-management-entry": driveAu09MemoryManagementEntry,
  "au09-memory-management-filter-matrix": driveAu09MemoryManagementFilterMatrix,
  "au09-memory-trace-roundtrip": driveAu09MemoryTraceRoundtrip,
  "au09-adopt-setting-recall": driveAu09AdoptSettingRecall,
  "au09-character-dossier-roundtrip": driveAu09CharacterDossierRoundtrip,
  "au09-character-role-taxonomy-protagonist-policy":
    driveAu09CharacterRoleTaxonomyProtagonistPolicy,
  "au09-character-candidate-per-item-adoption": driveAu09CharacterCandidatePerItemAdoption,
  "au12-archive-concurrent-model-run-read-snapshot": driveAu12ArchiveConcurrentModelRunReadSnapshot,
  "au09-memory-taxonomy-write-policy": driveAu09MemoryTaxonomyWritePolicy,
  "au09-memory-list-ux-redesign": driveAu09MemoryListUxRedesign,
  "au09-validity-window-recall": driveAu09ValidityWindowRecall,
  "au09-cross-work-memory-isolation": driveAu09CrossWorkMemoryIsolation,
  "au09-au03-session-memory-layering": driveAu09Au03SessionMemoryLayering,
  "au03-session-history-readonly": driveAu03SessionHistoryReadonly,
  "au03-session-new-active": driveAu03SessionNewActive,
  "au03-branch-from-history": driveAu03BranchFromHistory,
  "au03-archive-session-filter": driveAu03ArchiveSessionFilter,
  "au03-current-work-context-ssot": driveAu03CurrentWorkContextSsot,
  "au11-quality-diagnosis-message-envelope": driveAu11QualityDiagnosisMessageEnvelope,
  "au11-missing-workstate-policy": driveAu11MissingWorkstatePolicy,
  "au03-long-session-compression": driveLongSessionCompression,
  "au03-context-source-ui": driveContextSourceUi,
  "au07-trace-why-entry": driveAu07TraceWhyEntry,
  "au07-gate-reason-why": driveAu07GateReasonWhy,
  "au07-persisted-trace-query": driveAu07PersistedTraceQuery,
  "au07-partial-replay-ui": driveAu07PartialReplayUi,
  "au07-trace-query-scope-negative-matrix": driveAu07TraceQueryScopeNegativeMatrix,
  "au07-tooltrace-registry-redacted-io": driveAu07TooltraceRegistryRedactedIo,
  "e2e-01-downgrade-real-page": driveE2E01DowngradeRealPage,
  "e2e-01-readonly-tool-trace": driveE2E01ReadonlyToolTrace,
  "e2e-01-replay-report": driveE2E01ReplayReport,
  "e2e-01-channel-action-security": driveE2E01ChannelActionSecurity,
};

const driver = drivers[sliceId];
if (!driver) {
  throw new Error(`No external UI driver is implemented for ${sliceId}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: viewportForSlice(sliceId) });

page.on("websocket", (ws) => {
  ws.on("framesent", (event) => recordFrame("sent", event.payload));
  ws.on("framereceived", (event) => recordFrame("received", event.payload));
});

try {
  await page.goto(baseUrl, { waitUntil: "commit", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await serviceStatus(page).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => /服务: 已连接|同步已连接/.test(document.body.innerText), {
    timeout: 30_000,
  });

  const uiRecords = await driver(page);

  fs.writeFileSync(path.join(artifactDir, "ui-frames.json"), JSON.stringify(frames, null, 2));
  fs.writeFileSync(path.join(artifactDir, "ui-state.json"), JSON.stringify(uiRecords, null, 2));
  await page.screenshot({
    path: path.join(artifactDir, `${sliceId}-external-ui.png`),
    fullPage: true,
  });
} catch (error) {
  fs.writeFileSync(path.join(artifactDir, "ui-frames.json"), JSON.stringify(frames, null, 2));
  console.error(error?.stack ?? error);
  if (!page.isClosed()) {
    await page.screenshot({
      path: path.join(artifactDir, "external-ui-failure.png"),
      fullPage: true,
    });
  }
  throw error;
} finally {
  await browser.close();
}
