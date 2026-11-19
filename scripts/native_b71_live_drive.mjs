// B71 CP3b 实模外部驱动：像作者一样在真实窗口输入自然语言创作请求，等待 run 终局，
// 采集 AX/WS/llm-calls/DB 证据与 Strata 单槽生命周期；不轮询固定回复文本、不假设
// 工具调用次数、不修改产品 prompt。判据与本文件分离（authoring_live_evidence）。
import path from "node:path";
import {
  authorVisibleScenario,
  readConfig,
} from "./lib/native_ui/authoring_capture_evidence.mjs";
import {
  NativeScenarioHarness,
  ROOT,
  ensureWorkSelected,
  frameBody,
  isVisibleNode,
  runEvidenceMode,
} from "./lib/native_ui/scenario_driver.mjs";
import { textOf } from "./lib/native_ui/driver.mjs";
import { authorBoundary, axTurnOutcome, countAxAuthorMessages, readingPageFailure,
  withinAuthorBoundary } from "./lib/native_ui/authoring_g2_evidence.mjs";
import { all, assertRecordFresh, createAxObservation, frameOf, logs, sentUserMessages, turnFacts, withDb, write } from "./lib/native_ui/scenario_evidence.mjs";
import { lastCompletedTurn } from "./lib/native_ui/authoring_run_evidence.mjs";
import { capturePendingItemViews } from "./lib/native_ui/authoring_pending_driver.mjs";
import {
  classifyTurnBody,
  summarizeModelBehavior,
  wireTerminal,
} from "./lib/native_ui/live_run_wait.mjs";
import {
  DEFAULT_STRATA_ENDPOINT,
  readStrataState,
  strataLifecycleRecord,
  strataSlotCheck,
  unloadStrata,
} from "./lib/native_ui/strata_lifecycle.mjs";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir) {
  console.error("usage: node scripts/native_b71_live_drive.mjs <batch-run-dir>");
  process.exit(64);
}

const evidence = path.join(ROOT, "scripts/native_b71_evidence.mjs");
const harness = new NativeScenarioHarness(dir);
const strataEndpoint = (() => {
  const configured = process.env.NOVEL_STRATA_ENDPOINT ?? DEFAULT_STRATA_ENDPOINT;
  return String(configured).replace(/\/v1\/?$/u, "").replace(/\/+$/u, "");
})();
const TURN_TIMEOUT_MS = Number(process.env.B71_LIVE_TURN_TIMEOUT_MS ?? 360_000);
const INPUT_TIMEOUT_MS = Number(process.env.B71_LIVE_INPUT_TIMEOUT_MS ?? 120_000);
const READY_TIMEOUT_MS = Number(process.env.B71_LIVE_READY_TIMEOUT_MS ?? 180_000);

// R05 已观察终局之后只读同一次发送的 pending，作为滚动定位输入，不推进模型或采纳。
async function captureR05Candidates(config) {
  const wire = harness.transport(), sent = sentUserMessages(wire, config.message);
  if (sent.length !== 1) throw new Error("r05_visible_author_send_not_unique");
  const facts = turnFacts(wire, sent[0]), author = frameBody(sent[0]);
  const body = lastCompletedTurn(wire, {
    turnId: facts.turnId, runId: frameBody(facts.ack)?.response?.run_id,
    topic: frameOf(sent[0])[2], workId: author.work_id, sessionId: author.session_id, since: sent[0].at,
  }, "R05 可见终局缺少同次完成结果");
  const pending = Array.isArray(body.adoption_state?.pending) ? body.adoption_state.pending : [];
  const itemsOf = (artifact) => Array.isArray(artifact.payload?.items) ? artifact.payload.items : [];
  const knownItems = pending.flatMap(itemsOf).map((item) => ({ itemTitle: item.title, itemBody: item.body }));
  const items = pending.filter((artifact) => artifact.artifact_type === "prose_fragment").flatMap(itemsOf);
  if (items.length === 0) throw new Error("r05_visible_prose_candidate_missing");
  const views = [];
  for (const [index, item] of items.entries()) {
    views.push(...await capturePendingItemViews(harness, {
      itemTitle: item.title, itemBody: item.body, knownItems, prefix: `r05-candidate-${index + 1}`,
    }));
  }
  return views;
}

// B82 G2/G3 只按作者可见页面动作：作品名、章名、阅读原文、自然原话、可见终局。
// 不读应用 DB、turn/run refs 或 wire 来推进；原始 wire/日志仍由外部代理采集供诊断。
const excerptNode = (nodes, excerpt) =>
  nodes.find((node) => String(textOf(node)).includes(excerpt) && isVisibleNode(node)) ??
  nodes.find((node) => String(textOf(node)).includes(excerpt)) ??
  null;

// 只点作者真实可见的按钮：旧 workbench.openReading/closeReading 未导入 findByText，
// 真实执行会 ReferenceError；这里复用同 harness 的可见按钮定位与安全点击。
const visibleButton = (nodes, title) => {
  const button = harness.findButton(nodes, title);
  return button && isVisibleNode(button) ? button : null;
};

async function clickVisibleButton(name, title) {
  const observed = await harness.pollAx(
    (_text, nodes) => Boolean(visibleButton(nodes, title)),
    30_000,
    `b82-visible:${name}:${title}`,
  );
  harness.safeClick(visibleButton(observed.nodes, title), `${name}:${title}`);
}

async function captureReadingPage(name, target) {
  await harness.runStep("maintenance", `reading_page:${name}`, async () => {
    await clickVisibleButton(`${name}:open`, "阅读");
    // 与 verifier 共用同一读取判定：作品/章/原文可见且非加载中、投影已 fresh。
    // 已读到作者冻结摘录、仅缺带章序的目标标题时，真实终局已确定：
    // 立即保留当前 AX/截图并据实失败，不再等满有界窗口。
    const page = await harness.pollAx(
      (text, nodes) => {
        const failure = readingPageFailure(text, target);
        return (
          failure === null ||
          (failure === "chapter_title_missing" &&
            Boolean(visibleButton(nodes, "返回工作台")) &&
            Boolean(excerptNode(nodes, target.reading_excerpt)))
        );
      },
      60_000,
      `b82-visible:${name}`,
    );
    const failure = readingPageFailure(page.text, target);
    if (failure !== null) {
      harness.capture(name);
      harness.log.push({
        op: "reading_target_label_missing",
        name,
        reason: failure,
        frozen_chapter_title: target.chapter_title,
        at: harness.nowIso(),
      });
      throw new Error(`reading_target_label_missing:${name}:${target.chapter_title}`);
    }
    const node = excerptNode(page.nodes, target.reading_excerpt);
    if (!node?.path) throw new Error(`reading_excerpt_node_missing:${name}`);
    // 末页原文必须真的进入视口：始终执行 AXScrollToVisible，已可见时是无操作。
    // 个别 Web 文本节点不支持该 action；只有原文已可见时才允许继续，否则如实失败。
    try {
      const scroll = harness.ensureInput().scrollTo(node.path);
      harness.log.push({ op: "reading_scroll", name, path: node.path, scroll, at: harness.nowIso() });
    } catch (error) {
      harness.log.push({
        op: "reading_scroll_failed",
        name,
        path: node.path,
        error: error.message,
        at: harness.nowIso(),
      });
      if (!isVisibleNode(node)) throw error;
    }
    await harness.pollAx(
      (_text, nodes) => nodes.some((candidate) =>
        String(textOf(candidate)).includes(target.reading_excerpt) && isVisibleNode(candidate)),
      20_000,
      `b82-visible:${name}:visible`,
    );
    harness.capture(name);
  });
}

async function closeReadingPage(name) {
  await harness.runStep("maintenance", `reading_close:${name}`, async () => {
    await clickVisibleButton(`${name}:close`, "返回工作台");
    // 不能按整页文本判「阅读模式」消失：回到工作台后候选卡说明里也含这四个字。
    await harness.pollAx(
      (_text, nodes) => Boolean(visibleButton(nodes, "阅读")),
      30_000,
      `b82-visible:${name}:closed`,
    );
  });
}

async function waitAuthorMessageVisible(message, baselineAuthorCount) {
  return harness.pollAx(
    (text, nodes) => {
      const composer = harness.findComposer(nodes);
      return countAxAuthorMessages(nodes, message) > baselineAuthorCount &&
        String(composer?.value ?? "").trim() === "";
    },
    45_000,
    "b82-visible:author_message",
  );
}

async function waitVisibleOutcome(message, { baselineAuthorCount, observation, candidateGrace = true }) {
  const terminal = new Set(["waiting", "failed", "completed", "capability_gap"]);
  const observe = (nodes, completed = false) => {
    const outcome = axTurnOutcome(nodes, { message, baselineAuthorCount });
    observation.record(nodes, { data: { outcome }, change: { kind: outcome.kind } },
      { terminal: completed });
    return outcome;
  };
  try {
    const polled = await harness.tryPollAx(
      (_text, nodes) => terminal.has(observe(nodes).kind),
      TURN_TIMEOUT_MS,
      "b71-visible:outcome",
    );
    if (!polled) {
      observation.finalize({ wait_error: "author_visible_outcome_timeout" });
      return { kind: "timeout" };
    }
    const outcome = observe(polled.nodes, true);
    if (outcome.kind !== "completed" || !candidateGrace) return outcome;
    // G2 的卡片渲染宽限只等本轮可见动作；不再把卡片文案当作第二套终局协议。
    // R05 的整章/风格候选由既有 capturePendingItemViews 独立有界定位。
    await harness.tryPollAx((_text, nodes) => {
      observe(nodes, true);
      const boundary = authorBoundary(nodes, message, baselineAuthorCount);
      return boundary.author && nodes.some((node) =>
        node.role === "AXButton" && node.title === "保存修订稿" &&
        node.enabled !== false && isVisibleNode(node) && withinAuthorBoundary(node, {
          container: boundary.container, afterPath: boundary.authorGroup,
          beforePath: boundary.nextAuthor?.path ?? null,
        }));
    }, 10_000, "b71-visible:candidate_grace");
    return outcome;
  } catch (error) {
    observation.finalize({ wait_error: error.message });
    throw error;
  }
}
const readProviderCounts = () => ({
  llm_records: logs(path.join(dir, "llm-calls")).length,
  provider_runs: withDb(dir, (db) => Number(all(db, "SELECT COUNT(*) AS c FROM provider_runs")[0].c)),
});

function readRunRow({ turnId, runId }) {
  return withDb(dir, (db) => all(db,
    "SELECT id, status, parent_turn_ref, run_mode, workspace_id, work_id, session_id, goal_version " +
      "FROM agent_runs WHERE id = ? AND parent_turn_ref = ?", [runId, turnId])[0] ?? null);
}

// 持久事实和已交付运行回包须一致；不能在页面仍 active 时凭 DB 终态推进下一输入。
async function waitRunTerminal(identity) {
  return harness.runStep("turn", "live_run_terminal", () => harness.pollWire((wire) =>
    wireTerminal(wire, { ...identity, runRow: readRunRow(identity), requireWireTerminal: true }),
  TURN_TIMEOUT_MS, "b71-live:terminal"));
}

async function collectModelBehavior({ terminal, turnBody, runStatus }) {
  const llmRecords = logs(path.join(dir, "llm-calls")).filter((record) => record?.provider === "strata");
  return summarizeModelBehavior({ turnBody, llmRecords, runStatus: runStatus ?? terminal?.status ?? null });
}

// Why/replay 只读面板：有按钮则打开并在前后记录 Provider 计数；找不到按钮/打开失败
// 如实记录 why_not_observed，不判产品失败（判据侧 L11 记为未触发）。
async function observeWhy() {
  // 真实创作 run 后 Why 按钮可能在长消息流下方（视口外）：先找可见按钮，
  // 找不到时从完整 AX 树定位 enabled 的「为什么」按钮并滚到可见位置再找。
  // 记录 scroll 尝试，便于区分「按钮不存在」与「存在但不可见」。
  const scroll = { needed: false, ok: null, path: null, reason: null };
  let nodes = null;
  try {
    const probe = await harness.tryPollAx(
      (_text, candidate) => Boolean(harness.findWhyButton(candidate)),
      20_000,
    );
    nodes = probe?.nodes ?? null;
  } catch (error) {
    scroll.reason = `why_button_probe_failed:${error.message}`;
  }
  if (!nodes || !harness.findWhyButton(nodes)) {
    scroll.needed = true;
    try {
      const all = harness.dumpNodes();
      const candidates = all.filter(
        (node) =>
          node.role === "AXButton" &&
          (node.title === "为什么" || String(node.desc ?? "").includes("查看这轮回应的依据")),
      );
      const target = candidates.at(-1) ?? null;
      if (!target || !target.path) {
        scroll.ok = false;
        scroll.reason = "why_button_not_in_ax_tree";
      } else {
        scroll.path = target.path;
        harness.ensureInput().scrollTo(target.path);
        const retry = await harness.tryPollAx(
          (_text, candidate) => Boolean(harness.findWhyButton(candidate)),
          20_000,
        );
        nodes = retry?.nodes ?? null;
        scroll.ok = Boolean(nodes && harness.findWhyButton(nodes));
        if (!scroll.ok) scroll.reason = "why_button_scrolled_but_not_visible";
      }
    } catch (error) {
      scroll.ok = false;
      scroll.reason = `why_button_scroll_failed:${error.message}`;
    }
  }
  if (!nodes || !harness.findWhyButton(nodes)) {
    return {
      opened: false,
      reason: scroll.reason ?? "why_button_not_found",
      ...(scroll.needed ? { scroll } : {}),
    };
  }
  const before = readProviderCounts();
  let opened = false;
  let panelText = null;
  try {
    await harness.runStep("maintenance", "why_open", () => harness.rawOpenWhy("b71-live"));
    opened = true;
    panelText = await harness.pollAx(
      (text) => text.includes("参考来源") && text.includes("不会重新调用模型"),
      30_000,
      "b71-live:why_panel",
    );
    harness.capture("why");
  } catch (error) {
    if (!opened) return { opened: false, reason: `why_open_failed:${error.message}`, before };
  }
  // Why 面板已打开：Provider 计数必须只读不变；关闭失败单独记录，不影响已完成的前后计数。
  const after = readProviderCounts();
  let closeError = null;
  try {
    harness.ensureInput().key("escape", { focusRequired: false });
    await harness.runStep("maintenance", "why_close", () =>
      harness.pollAx((text) => !text.includes("不会重新调用模型"), 20_000, "b71-live:why_closed"),
    );
  } catch (error) {
    closeError = error.message;
  }
  return {
    opened: true,
    before,
    after,
    ...(scroll.needed ? { scroll } : {}),
    ...(panelText ? { panel_excerpt: panelText.text.slice(0, 800) } : {}),
    ...(closeError ? { close_error: closeError } : {}),
  };
}

async function run() {
  runEvidenceMode(evidence, "prepare", dir);
  const config = readConfig(dir);
  if (config.journey !== "live") throw new Error(`live driver 只接受 journey=live，实测: ${config.journey}`);
  if (!["strata", "splash"].includes(config.provider)) throw new Error(`live driver 未注册 provider: ${config.provider}`);
  const strata = config.provider === "strata";
  const model = config.preregistration?.model ?? config.target?.model ?? process.env.B71_STRATA_MODEL ?? "iq3_s";
  // b82-g2/b82-g3 新批次必须有冻结的作者可见目标；旧缺 visible_target 的批次只能读旧报告。
  const visibleMode = authorVisibleScenario(config.scenario_id);
  const authorVisible = visibleMode !== null;
  const visibleTarget = config.author_visible_target ?? null;
  if (authorVisible && !visibleTarget) {
    throw new Error(`${config.scenario_id}_author_visible_target_missing`);
  }
  const flowLabel = authorVisible ? config.scenario_id : "b71-live";

  const before = strata ? await readStrataState({ endpoint: strataEndpoint }).catch((error) => ({
    ok: false,
    error: error.message,
  })) : null;
  // 证据文件不得覆盖：开始只落 before 观测（不同名），卸载核验后的完整记录只在
  // finally 写一次 strata-slot.json。
  if (strata) write(dir, "strata-slot-before.json", strataLifecycleRecord({ before, after: before, unload: null }));

  let driverLog = null;
  try {
    await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
    await harness.runStep("maintenance", "workbench_ready", () =>
      harness.rawWaitWorkbenchSettled(flowLabel, READY_TIMEOUT_MS),
    );
    // B82 只按冻结的作者可见作品名选中作品，不从 config.target 隐式回退；
    // 其它 live 入口保持原 target 行为。
    await ensureWorkSelected(
      harness,
      authorVisible ? visibleTarget.work_title : config.target.work_title,
      flowLabel,
    );
    harness.capture("01-workbench");
    // G2/G3 保持原页面路径；R05 的未采纳零写入需同批前后 Canon 快照。
    if (!authorVisible || config.r05_goal) runEvidenceMode(evidence, "capture", dir, ["start"]);

    const afterLaunch = strata ? await readStrataState({ endpoint: strataEndpoint }).catch((error) => ({
      ok: false,
      error: error.message,
    })) : null;
    const launchSlot = strata ? strataSlotCheck(afterLaunch) : null;
    if (strata) harness.log.push({ op: "strata_after_launch", slot: launchSlot, at: harness.nowIso() });

    if (authorVisible) {
      await captureReadingPage("02-reading-before", visibleTarget);
      await closeReadingPage("before");
    }
    await harness.runStep("maintenance", "input_ready", () =>
      harness.rawWaitInputReady(flowLabel, INPUT_TIMEOUT_MS),
    );
    if (authorVisible) {
      const baselineNodes = harness.capture("before-input", { allowFullScreenFallback: false });
      assertRecordFresh(dir, "before-input", harness.ready.ready_at);
      const baselineAuthorCount = countAxAuthorMessages(baselineNodes, config.message);
      const observation = createAxObservation(harness, {
        file: "native-b71-turn-observation.json",
        meta: { schema: "native-turn-observation/v1", harness_run_ref: harness.target.run_ref,
          author_message: config.message, baseline_author_count: baselineAuthorCount,
          baseline_capture: "before-input", baseline_nodes: baselineNodes },
      });
      // 唯一一次作者原话提交：只走可见输入/点击，等待仍由作者可见页面推进。
      await harness.runStep("input", "author_creation_request", () =>
        harness.rawSubmitAuthorText(config.message, flowLabel),
      );
      harness.capture("after-input");
      await harness.runStep("turn", "author_message_visible", () =>
        waitAuthorMessageVisible(config.message, baselineAuthorCount),
      );
      const outcome = await harness.runStep("turn", "author_visible_outcome", () =>
        waitVisibleOutcome(config.message, { baselineAuthorCount, observation,
          candidateGrace: visibleMode === "candidate" && !config.r05_goal }),
      );
      // 先保留本次终局现场，再回阅读页核对已采纳正文未变；等待/失败也照实截证。
      const finalNodes = harness.capture("final", { allowFullScreenFallback: false });
      const finalOutcome = axTurnOutcome(finalNodes, { message: config.message, baselineAuthorCount });
      observation.record(finalNodes, { data: { outcome: finalOutcome }, change: { kind: finalOutcome.kind } },
        { terminal: true });
      observation.finalize({ capture: "final", terminal: true });
      assertRecordFresh(dir, "final", harness.ready.ready_at);
      await captureReadingPage("03-reading-after", visibleTarget);
      await closeReadingPage("after");
      const candidateViews = config.r05_goal && visibleMode === "candidate"
        ? await captureR05Candidates(config) : [];
      if (config.r05_goal) runEvidenceMode(evidence, "capture", dir, ["final"]);
      driverLog = {
        slice_id: config.slice_id,
        provider: config.provider,
        model,
        author_visible_target: visibleTarget,
        author_visible_outcome: { kind: finalOutcome.kind, waited_kind: outcome.kind,
          observed_at: harness.nowIso() },
        ...(config.r05_goal ? { r05_candidate_views: candidateViews } : {}),
        ...(strata ? { strata: { endpoint: strataEndpoint, after_launch: launchSlot } } : { runtime: config.runtime }),
      };
      harness.writeDriverLog("native-b71-driver-log.json", driverLog);
      console.log(
        `B82 ${config.scenario_id} 作者可见驱动完成: outcome=${outcome.kind} screenshots=${harness.screenshots.length}`,
      );
      return;
    }
    const sent = await harness.runStep("input", "author_creation_request", () =>
      harness.rawTypeAndSend(config.message, "b71-live"),
    );
    const turnId = String(frameBody(sent)?.turn_id ?? "");
    if (!turnId) throw new Error("user_message_without_turn_id");
    harness.capture("after-input");
    const ack = await harness.runStep("ack", "user_message_ack", () =>
      harness.pollWire((wire) => harness.ackFor(wire, sent), 25_000, "b71-live:ack"),
    );
    const runId = String(frameBody(ack)?.response?.run_id ?? "");

    const terminal = await waitRunTerminal({ turnId, runId, topic: frameOf(sent)[2],
      workId: frameBody(sent).work_id, sessionId: frameBody(sent).session_id, since: sent.at });
    if (!terminal) throw new Error("live_run_terminal_missing");
    harness.capture("final");
    const turnBody = terminal.body ?? null;
    const turnClassified = turnBody ? classifyTurnBody(turnBody) : null;

    const why = await observeWhy();
    const behavior = await collectModelBehavior({
      terminal,
      turnBody,
      runStatus: turnClassified?.run_status ?? terminal.status ?? null,
    });

    runEvidenceMode(evidence, "capture", dir, ["final"]);
    driverLog = {
      slice_id: config.slice_id,
      provider: config.provider,
      model,
      turn: {
        turn_id: turnId,
        run_id: runId || terminal.body?.agent_run?.run_id || null,
        terminal_kind: terminal.kind,
        terminal_status: terminal.status ?? null,
        terminal_source: terminal.source,
      },
      run: { status: turnClassified?.run_status ?? terminal.status ?? null },
      model_behavior: behavior,
      why,
      strata: { endpoint: strataEndpoint, after_launch: launchSlot },
    };
    harness.writeDriverLog("native-b71-driver-log.json", driverLog);
    // ui-complete 是 runner 的「驱动完成」信号：必须在 finally 证据（strata-slot /
    // driver-log 卸载核验）全部落盘之后写，避免 runner 在 strata-slot.json 落盘前
    // 开始 verify（2026-11-07 q2-0-02 实测的时序竞争）。
    console.log(
      `B71 CP3b 实模驱动完成: turn=${turnId} run=${driverLog.turn.run_id ?? "none"} terminal=${terminal.kind}/${terminal.source} provider_calls=${behavior.provider_calls} tool_calls=${behavior.tool_call_count} why=${why.opened ? "opened" : "not_observed"}`,
    );
  } finally {
    // Strata 保留其现役单槽责任；外部 Splash 不执行 load/unload/stop。
    if (strata) {
      const unload = await unloadStrata({ endpoint: strataEndpoint }).catch((error) => ({
        unload: { ok: false, error: error.message },
        state: { error: error.message },
        slot: { ok: false, loaded: null, reason: `unload_failed:${error.message}` },
      }));
      write(dir, "strata-slot.json", strataLifecycleRecord({ before, after: unload.state, unload: unload.unload }));
      if (driverLog) {
        harness.writeDriverLog("native-b71-driver-log.json", {
          ...driverLog,
          strata: {
            ...driverLog.strata,
            unload: unload.unload,
            after: unload.state,
            slot_after: unload.slot,
          },
        });
      }
    }
    harness.writeUiComplete(config.slice_id);
  }
}

await harness.runJourney(run);
