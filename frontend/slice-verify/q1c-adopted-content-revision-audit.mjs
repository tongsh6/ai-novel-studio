import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const baseUrl = process.env.SLICE_VERIFY_BASE_URL ?? "http://127.0.0.1:5768";
const artifactDir =
  process.env.SLICE_VERIFY_ARTIFACT_DIR ??
  path.resolve("..", "artifacts", "slice-verify", "q1c-adopted-content-revision-audit");

fs.mkdirSync(artifactDir, { recursive: true });

const chatInputSelector = 'input[placeholder="输入你的想法、问题或指令..."]';
const acceptPattern = /确认创建|保存为章节正文|保存到大纲|保存到作品档案|保存到作品/;
// 结构验收使用确定性 provider；任何单轮超过 180s 即视为 provider_stall，
// 不再沿用真实模型长跑时的 900s 等待。
const TURN_TIMEOUT_MS = Number(process.env.Q1C_TURN_TIMEOUT_MS ?? 180_000);
const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
const sourceText = `岑舟今年二十五岁，是青云宗宗主，掌管东洲灵脉。资料校验标识${nonce}。`;

const frames = [];
const steps = [];

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

function dbPath() {
  const dir = process.env.NOVEL_TEST_DB_DIR || os.tmpdir();
  const partition = process.env.MIX_TEST_PARTITION || "";
  return path.join(dir, `ai_novel_studio_test${partition}.sqlite3`);
}

function readMemoryRows(workId) {
  const file = dbPath();
  if (!fs.existsSync(file)) return { error: `db missing: ${file}`, rows: [] };
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `SELECT id, work_id, type, status, source_type, content
           FROM memory_items
          WHERE work_id = ?
            AND (instr(content, ?) > 0 OR instr(content, '岑舟') > 0 OR instr(content, '青云宗') > 0)
          ORDER BY inserted_at ASC`,
      )
      .all(workId, nonce);
    return { file, rows };
  } catch (error) {
    return { file, error: String(error), rows: [] };
  } finally {
    db.close();
  }
}

async function waitForFrame(predicate, message, timeout = TURN_TIMEOUT_MS) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const found = frames.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${message} (after ${timeout}ms)`);
}

async function waitForRunSettled(result, timeout = TURN_TIMEOUT_MS) {
  const runId = result?.agent_run?.run_id;
  if (!runId) return;
  await waitForFrame(
    (f) => {
      if (f.direction !== "received") return false;
      const state = f.event === "agent_run_state" ? f.body : f.body?.response?.agent_run_state;
      return (
        state?.run_id === runId &&
        ["completed", "awaiting_author", "failed", "cancelled"].includes(state.status)
      );
    },
    `agent run 未收束: ${runId}`,
    timeout,
  );
}

async function waitForActionSent(artifactRef, timeout = 30_000) {
  return waitForFrame(
    (f) =>
      f.direction === "sent" &&
      f.event === "author_action" &&
      f.body?.action?.target_ref === artifactRef,
    `采纳动作未绑定目标 ${artifactRef}`,
    timeout,
  );
}

async function send(page, text, label = "turn") {
  const started = Date.now();
  const before = frames.length;
  await page.locator(chatInputSelector).fill(text);
  await page.getByRole("button", { name: /^发送$/ }).click();
  const sent = await waitForFrame(
    (f) => f.direction === "sent" && f.event === "user_message" && frames.indexOf(f) >= before,
    `未发出消息: ${text.slice(0, 24)}`,
    30_000,
  );
  const turnId = sent.body.turn_id;
  const resultFrame = await waitForFrame(
    (f) => {
      if (f.direction !== "received") return false;
      if (f.event === "turn_result" && f.body?.turn_id === turnId) return true;
      if (f.event === "phx_reply") {
        return (f.body?.response?.turn_results ?? []).some((r) => r.turn_id === turnId);
      }
      return false;
    },
    `未收到 turn_result (${label}): ${text.slice(0, 24)}`,
    TURN_TIMEOUT_MS,
  );
  const result =
    resultFrame.event === "turn_result"
      ? resultFrame.body
      : resultFrame.body.response.turn_results.find((r) => r.turn_id === turnId);
  await page.waitForTimeout(1_000);
  const elapsedMs = Date.now() - started;
  console.log(
    `[q1c] ${label} turn=${turnId} status=${result.status} elapsed=${elapsedMs}ms`,
  );
  return { turnId, result, elapsedMs };
}

async function clickAcceptIfPresent(page, stepName) {
  const buttons = page.getByRole("button", { name: acceptPattern });
  if ((await buttons.count()) === 0) return false;
  await buttons.first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(artifactDir, `${stepName}-after-accept.png`), fullPage: true });
  return { clicked: true };
}

async function waitForAcceptOutcome(artifactRef, timeout = TURN_TIMEOUT_MS) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const adopted = frames.find(
      (f) =>
        f.direction === "received" &&
        f.event === "turn_result" &&
        f.body?.truthfulness?.artifact_adopted === true &&
        (f.body?.adoption_state?.resolved ?? []).some(
          (entry) => entry.artifact_id === artifactRef,
        ),
    );
    if (adopted) return { type: "adopted", frame: adopted };

    const confirmation = frames.find(
      (f) =>
        f.direction === "received" &&
        f.event === "turn_result" &&
        (f.body?.status === "needs_confirmation" ||
          f.body?.adoption_decision?.decision_type === "require_confirmation" ||
          (f.body?.truthfulness?.reason_codes ?? []).includes("overwrite_existing_canon")) &&
        (f.body?.behavior_state?.active?.target_ref === artifactRef ||
          (f.body?.adoption_state?.pending ?? []).some(
            (entry) => entry.artifact_id === artifactRef,
          )),
    );
    if (confirmation) return { type: "confirmation", frame: confirmation };

    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`采纳结果未收束: ${artifactRef}`);
}

async function clickConfirmation(page) {
  const button = page.getByRole("button", { name: /确认执行|确认保存|确认替代/ }).first();
  await button.waitFor({ timeout: 20_000 });
  await button.click();
  await page.waitForTimeout(500);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on("websocket", (ws) => {
  ws.on("framesent", (event) => recordFrame("sent", event.payload));
  ws.on("framereceived", (event) => recordFrame("received", event.payload));
});

const report = {
  audit: "q1c-adopted-content-revision-audit",
  generated_at: new Date().toISOString(),
  provider: process.env.SLICE_VERIFY_PROVIDER ?? "slice_verify",
  nonce,
  source_text: sourceText,
  db: dbPath(),
  steps: [],
  source: null,
  source_facts: null,
  revision: null,
  revision_accept: null,
  revision_facts: null,
  observations: {},
};

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await page.getByText(/同步已连接|服务: 已连接/).first().waitFor({ timeout: 30_000 });
  await page.screenshot({ path: path.join(artifactDir, "00-start.png"), fullPage: true });

  // 1. 先通过作者原文登记建立一条已采纳的 world_setting 事实。
  const sourceMessage = `请把以下原文登记为作品设定，不要改写：${sourceText}`;
  const source = await send(page, sourceMessage, "source");
  steps.push({
    step: "source-send",
    text: sourceMessage,
    turn_id: source.turnId,
    status: source.result.status,
    elapsed_ms: source.elapsedMs,
  });
  await waitForRunSettled(source.result);
  await page.screenshot({ path: path.join(artifactDir, "01-source-turn.png"), fullPage: true });

  const sourcePending = source.result.adoption_state?.pending?.[0];
  report.source = {
    turn_id: source.turnId,
    work_id: source.result.work_id,
    status: source.result.status,
    assistant_message: source.result.assistant_message?.text,
    pending: sourcePending ?? null,
    truthfulness: source.result.truthfulness,
  };

  if (sourcePending) {
    const accept = await clickAcceptIfPresent(page, "01-source");
    report.source.accept = accept;
    await waitForActionSent(sourcePending.artifact_id);
    const sourceOutcome = await waitForAcceptOutcome(sourcePending.artifact_id);
    report.source.confirmation_required = sourceOutcome.type === "confirmation";
    let adopted = sourceOutcome.frame;
    if (sourceOutcome.type === "confirmation") {
      await clickConfirmation(page);
      adopted = await waitForFrame(
        (f) =>
          f.direction === "received" &&
          f.event === "turn_result" &&
          f.body?.truthfulness?.artifact_adopted === true &&
          (f.body?.adoption_state?.resolved ?? []).some(
            (entry) => entry.artifact_id === sourcePending.artifact_id,
          ),
        "来源设定采纳未完成",
      );
    }
    report.source.adopted_turn = {
      turn_id: adopted.body.turn_id,
      status: adopted.body.status,
      resolved: adopted.body.adoption_state?.resolved ?? [],
      truthfulness: adopted.body.truthfulness,
    };
    await page.waitForTimeout(1_500);
    report.source_facts = readMemoryRows(source.result.work_id);
    await page.screenshot({ path: path.join(artifactDir, "02-source-adopted.png"), fullPage: true });
  }

  // 2. 请求修订已采纳的设定。这里不提供 candidate ref，模拟真实作者的自然语言。
  const revisionMessage = `请把已保存的设定里岑舟的年龄从二十五岁改成三十岁，其他内容保持不变。资料校验标识${nonce}。`;
  let revision = await send(page, revisionMessage, "revision");
  steps.push({
    step: "revision-send",
    text: revisionMessage,
    turn_id: revision.turnId,
    status: revision.result.status,
    elapsed_ms: revision.elapsedMs,
  });
  await waitForRunSettled(revision.result);
  let revisionAttempts = 1;
  while (revision.result.status === "failed" && revisionAttempts < 3) {
    const previousError = revision.result.assistant_message;
    await page.waitForTimeout(2_000);
    revision = await send(page, revisionMessage, `revision-retry-${revisionAttempts + 1}`);
    steps.push({
      step: "revision-retry",
      attempt: revisionAttempts + 1,
      previous_error: previousError,
      turn_id: revision.turnId,
      status: revision.result.status,
      elapsed_ms: revision.elapsedMs,
    });
    await waitForRunSettled(revision.result);
    revisionAttempts += 1;
  }
  await page.screenshot({ path: path.join(artifactDir, "03-revision-turn.png"), fullPage: true });

  const revisionPending = revision.result.adoption_state?.pending?.[0];
  const revisionActions = revision.result.available_actions ?? [];
  report.revision = {
    turn_id: revision.turnId,
    work_id: revision.result.work_id,
    status: revision.result.status,
    attempts: revisionAttempts,
    assistant_message: revision.result.assistant_message?.text,
    candidate_directions: revision.result.candidate_directions ?? [],
    pending: revisionPending ?? null,
    resolved: revision.result.adoption_state?.resolved ?? [],
    available_actions: revisionActions.map((action) => ({
      action_type: action.action_type,
      target_ref: action.target_ref ?? null,
      label: action.label ?? null,
    })),
    truthfulness: revision.result.truthfulness,
    trace_summary: revision.result.trace_summary ?? null,
  };

  if (revisionPending) {
    const accept = await clickAcceptIfPresent(page, "03-revision");
    report.revision_accept = accept;
    if (accept) {
      try {
        await waitForActionSent(revisionPending.artifact_id);
        const revisionOutcome = await waitForAcceptOutcome(revisionPending.artifact_id);
        report.revision_accept.confirmation_required =
          revisionOutcome.type === "confirmation";
        let adopted = revisionOutcome.frame;
        if (revisionOutcome.type === "confirmation") {
          report.revision_accept.confirmation = {
            turn_id: revisionOutcome.frame.body.turn_id,
            status: revisionOutcome.frame.body.status,
            decision_type: revisionOutcome.frame.body.adoption_decision?.decision_type,
            reason_codes: revisionOutcome.frame.body.truthfulness?.reason_codes,
            behavior_ref: revisionOutcome.frame.body.behavior_state?.active?.behavior_id,
          };
          await clickConfirmation(page);
          adopted = await waitForFrame(
            (f) =>
              f.direction === "received" &&
              f.event === "turn_result" &&
              f.body?.truthfulness?.artifact_adopted === true &&
              (f.body?.adoption_state?.resolved ?? []).some(
                (entry) => entry.artifact_id === revisionPending.artifact_id,
              ),
            "修订候选采纳未完成",
            TURN_TIMEOUT_MS,
          );
        }
        report.revision_accept.adopted_turn = {
          turn_id: adopted.body.turn_id,
          status: adopted.body.status,
          resolved: adopted.body.adoption_state?.resolved ?? [],
          truthfulness: adopted.body.truthfulness,
        };
        await page.waitForTimeout(1_500);
        report.revision_facts = readMemoryRows(revision.result.work_id);
      } catch (error) {
        report.revision_accept.error = String(error);
      }
    }
  }

  // 3. 采纳后追问：验证后续上下文读的是新版本，不是旧版。
  if (report.revision_accept?.adopted_turn) {
    const followupMessage = "岑舟今年多少岁？请依据当前已保存的作品设定回答。";
    const followup = await send(page, followupMessage, "followup");
    steps.push({
      step: "followup-send",
      text: followupMessage,
      turn_id: followup.turnId,
      status: followup.result.status,
      elapsed_ms: followup.elapsedMs,
    });
    await waitForRunSettled(followup.result);
    report.followup = {
      turn_id: followup.turnId,
      status: followup.result.status,
      assistant_message: followup.result.assistant_message?.text,
      trace_summary: followup.result.trace_summary ?? null,
      truthfulness: followup.result.truthfulness,
    };
    await page.screenshot({ path: path.join(artifactDir, "05-followup.png"), fullPage: true });
  }

  await page.screenshot({ path: path.join(artifactDir, "04-final.png"), fullPage: true });

  const rows = report.revision_facts?.rows ?? report.source_facts?.rows ?? [];
  const confirmed = rows.filter((row) => row.status === "CONFIRMED");
  const superseded = rows.filter((row) => row.status === "SUPERSEDED");
  const oldConfirmed = confirmed.filter((row) => row.content.includes("二十五岁"));
  const newConfirmed = confirmed.filter((row) => row.content.includes("三十岁"));
  const revisionOf = revisionPending?.payload?.revision_of ?? revisionPending?.payload?.items?.[0]?.revision_of ?? null;
  const acceptedTargetIdentified = Boolean(revisionOf && sourcePending?.artifact_id === revisionOf);

  report.observations = {
    source_pending_created: Boolean(sourcePending),
    source_adopted: Boolean(report.source?.adopted_turn),
    revision_turn_status: revision.result.status,
    revision_candidate_created: Boolean(revisionPending),
    revision_of_present: Boolean(revisionOf),
    accepted_target_identified: acceptedTargetIdentified,
    overwrite_confirmation_required: Boolean(report.revision_accept?.confirmation_required),
    duplicate_confirmed_facts: confirmed.length,
    old_version_still_confirmed: oldConfirmed.length > 0,
    new_version_confirmed: newConfirmed.length > 0,
    superseded_facts: superseded.length,
    assistant_claimed_done_without_candidate:
      !revisionPending && /已(修改|更新|保存|替换)/.test(revision.result.assistant_message?.text ?? ""),
    capability_gap_visible: /做不到|没有.*能力|无法.*直接|不能.*直接/.test(
      revision.result.assistant_message?.text ?? "",
    ),
    followup_status: report.followup?.status ?? null,
    followup_uses_new_version:
      /三十岁/.test(report.followup?.assistant_message ?? "") &&
      (!/二十五岁/.test(report.followup?.assistant_message ?? "") ||
        /此前|已被.*替代|历史|旧版本|修订|原设定|采纳后的版本/.test(
          report.followup?.assistant_message ?? "",
        )),
    followup_memory_context_is_new: (() => {
      const memoryRefs = (report.followup?.trace_summary?.context_refs ?? []).filter(
        (ref) => ref.source_type === "memory",
      );
      return (
        memoryRefs.length > 0 &&
        !memoryRefs.some((ref) => /二十五岁/.test(ref.summary ?? "")) &&
        /三十岁/.test(report.followup?.assistant_message ?? "")
      );
    })(),
    facts: rows.map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      source_type: row.source_type,
      content: row.content,
    })),
  };
} catch (error) {
  report.error = String(error);
  try {
    await page.screenshot({ path: path.join(artifactDir, "error.png"), fullPage: true });
  } catch {
    // ignore screenshot failure
  }
} finally {
  report.steps = steps;
  report.frames = {
    turn_results: frames
      .filter((f) => f.direction === "received" && f.event === "turn_result")
      .map((f) => ({
        turn_id: f.body?.turn_id,
        status: f.body?.status,
        assistant_message: f.body?.assistant_message?.text,
        pending_count: f.body?.adoption_state?.pending?.length ?? 0,
        resolved_count: f.body?.adoption_state?.resolved?.length ?? 0,
        truthfulness: f.body?.truthfulness,
      })),
    author_actions: frames
      .filter((f) => f.event === "author_action")
      .map((f) => ({ direction: f.direction, body: f.body })),
  };
  fs.writeFileSync(
    path.join(artifactDir, "audit-report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}

const failedChecks = [];
const check = (name, condition) => {
  if (!condition) failedChecks.push(name);
};

check("source_pending_created", report.observations.source_pending_created);
check("source_adopted", report.observations.source_adopted);
check("revision_candidate_created", report.observations.revision_candidate_created);
check("revision_of_present", report.observations.revision_of_present);
check("accepted_target_identified", report.observations.accepted_target_identified);
check("overwrite_confirmation_required", report.observations.overwrite_confirmation_required);
check("exactly_one_confirmed_fact", report.observations.duplicate_confirmed_facts === 1);
check("old_version_not_confirmed", !report.observations.old_version_still_confirmed);
check("new_version_confirmed", report.observations.new_version_confirmed);
check("one_superseded_fact", report.observations.superseded_facts === 1);
check(
  "assistant_did_not_claim_done_without_candidate",
  !report.observations.assistant_claimed_done_without_candidate,
);
check("followup_uses_new_version", report.observations.followup_uses_new_version);
check(
  "followup_memory_context_is_new",
  report.observations.followup_memory_context_is_new,
);

const summary = {
  audit: report.audit,
  provider: report.provider,
  nonce: report.nonce,
  error:
    report.error ??
    (failedChecks.length > 0 ? `failed observations: ${failedChecks.join(", ")}` : null),
  observations: report.observations,
  failed_checks: failedChecks,
  steps: report.steps,
  db: report.db,
};
fs.writeFileSync(
  path.join(artifactDir, "summary.json"),
  JSON.stringify(summary, null, 2),
);
console.log(JSON.stringify(summary, null, 2));

if (report.error || failedChecks.length > 0) process.exitCode = 1;
