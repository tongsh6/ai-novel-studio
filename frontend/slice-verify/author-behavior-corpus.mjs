// B70 CP1：author-behavior 冻结语料的数据驱动浏览器验收 driver（product-external）。
//
// 外部 Playwright 操作真实工作台可见语义；按冻结 corpus 子集切换合成状态作品、发送自然
// 表达、从隔离 DB 采集真实 agent/持久化事实，调用确定性 oracle 判卷并输出覆盖报告。
// 产品代码不感知本 driver、corpus、env 或判卷逻辑。
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  buildExplorationPlan,
  failureFingerprint,
  shrinkFailureTrace,
  summarizeExploration,
} from "../../scripts/lib/quality/author_behavior_explorer.mjs";
import { evaluateCase } from "../../scripts/lib/quality/author_behavior_oracle.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const baseUrl = process.env.SLICE_VERIFY_BASE_URL ?? "http://127.0.0.1:5768";
const artifactDir =
  process.env.SLICE_VERIFY_ARTIFACT_DIR ??
  path.resolve(repoRoot, "artifacts", "slice-verify", "author-behavior-corpus");
const corpusPath = process.env.AUTHOR_BEHAVIOR_CORPUS_JSON ?? path.join(artifactDir, "corpus.json");
const dbPath = process.env.AUTHOR_BEHAVIOR_DB_PATH ?? "";
const caseIdsEnv = process.env.AUTHOR_BEHAVIOR_CASE_IDS ?? "";
const subsetCaseIds = (caseIdsEnv ? caseIdsEnv.split(",") : [
  "C-F1-001",
  "C-F3-001",
  "C-F2-002",
  "C-F1-002",
  "C-F3-003",
  "C-F3-005"
])
  .map((value) => value.trim())
  .filter(Boolean);

const stateWorkTitles = {
  "S1-partial-multichapter": "B70 S1 部分多章",
  "S2-empty-skeleton": "B70 S2 空骨架",
  "S3-pending-candidate-context": "B70 S3 待采纳候选",
};

const artifact = (name) => path.join(artifactDir, name);
fs.mkdirSync(artifactDir, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function exportCorpus() {
  execFileSync(
    "node",
    [path.join(repoRoot, "scripts/author_behavior_check.mjs"), "--export-json", corpusPath],
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "ignore", "inherit"] },
  );
  return JSON.parse(fs.readFileSync(corpusPath, "utf8"));
}

function dbCounts() {
  assert(dbPath && fs.existsSync(dbPath), `隔离 DB 不存在: ${dbPath}`);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const count = (table) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
    return {
      chapters: count("chapters"),
      drafts: count("drafts"),
      scenes: count("scenes"),
      author_action_receipts: count("author_action_receipts"),
    };
  } finally {
    db.close();
  }
}

function latestJudgmentEvent({ afterRowId = 0 } = {}) {
  assert(dbPath && fs.existsSync(dbPath), `隔离 DB 不存在: ${dbPath}`);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `SELECT rowid AS row_id, event_type, payload FROM agent_events
          WHERE event_type IN ('judgment_decided', 'awaiting_author') AND rowid > ?
          ORDER BY rowid ASC`,
      )
      .all(afterRowId);
    return rows
      .map((row) => {
        let payload;
        try {
          payload = JSON.parse(String(row.payload));
        } catch {
          payload = null;
        }
        payload = payload ?? {};
        if (!payload.action && row.event_type === "awaiting_author") {
          payload = { ...payload, action: "await_author" };
        }
        return { row_id: Number(row.row_id), payload };
      })
      .filter((entry) => typeof entry.payload.action === "string");
  } finally {
    db.close();
  }
}

function maxAgentEventRowId() {
  assert(dbPath && fs.existsSync(dbPath), `隔离 DB 不存在: ${dbPath}`);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare("SELECT COALESCE(MAX(rowid), 0) AS max_row FROM agent_events").get();
    return Number(row.max_row);
  } finally {
    db.close();
  }
}

function latestAssistantText() {
  assert(dbPath && fs.existsSync(dbPath), `隔离 DB 不存在: ${dbPath}`);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db
      .prepare("SELECT content FROM interactions WHERE role = 'assistant' ORDER BY rowid DESC LIMIT 1")
      .get();
    if (!row) return "";
    try {
      const parsed = JSON.parse(String(row.content));
      return collectStrings(parsed).join("\n");
    } catch {
      return String(row.content);
    }
  } finally {
    db.close();
  }
}

function collectStrings(value, acc = []) {
  if (typeof value === "string") acc.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, acc));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectStrings(item, acc));
  return acc;
}

const chatInputSelector = 'input[placeholder="输入你的想法、问题或指令..."]';

async function waitWorkbench(page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  // 真实工作台特征：作品切换菜单 + 可输入 composer；不依赖具体连接状态文案。
  await page.getByTitle("作品").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1_200);
}

async function waitComposerUsable(page) {
  const composer = page.locator(chatInputSelector).first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });
  // 不同真实状态可能把发送按钮换成“发送指示/回答”等可见语义；只做有界等待，
  // 具体发送在 sendAndObserve 里按可见语义选择真实控件（失败回退 Enter）。
  await page
    .getByRole("button", { name: /发送|回答|提交/ })
    .first()
    .waitFor({ state: "visible", timeout: 8_000 })
    .catch(() => {});
  await page.waitForTimeout(200);
}

async function switchWork(page, workTitle) {
  const header = page.getByTitle("作品").first();
  await header.click();
  const item = page.getByRole("menuitem").filter({ hasText: workTitle }).first();
  await item.waitFor({ timeout: 10_000 });
  const itemText = ((await item.innerText().catch(() => "")) ?? "").trim();
  if (itemText.includes("当前")) {
    // 已是当前作品：真实菜单里该项不可再切换，关闭菜单后按当前页面继续。
    await page.keyboard.press("Escape");
    await waitComposerUsable(page);
    return;
  }
  await item.click();
  await page.waitForFunction(
    (title) => document.body.innerText.includes(title),
    workTitle,
    { timeout: 20_000 },
  );
  // 作品切换加载期间 composer 可能保留但发送不可用；等到真实发送控件可用再继续。
  await waitComposerUsable(page);
}

async function sendAndObserve(page, expression, label) {
  const beforeCounts = dbCounts();
  const maxRow = maxAgentEventRowId();
  const startedAt = Date.now();

  const composer = page.locator(chatInputSelector).first();
  await composer.waitFor({ state: "visible", timeout: 20_000 });
  await composer.fill(expression);
  await page.waitForTimeout(400);

  const sendButton = page.getByRole("button", { name: /发送|回答|提交/ }).first();
  try {
    await sendButton.waitFor({ state: "visible", timeout: 15_000 });
    if (await sendButton.isDisabled()) {
      await page.waitForFunction(
        () => {
          const buttons = Array.from(document.querySelectorAll("button"));
          const send = buttons.find((button) => /发送|回答|提交/u.test(button.textContent ?? ""));
          return send && !send.disabled;
        },
        { timeout: 10_000 },
      );
    }
    await sendButton.click();
  } catch {
    // 真实产品同样支持 Enter 发送；按钮语义变化时用键盘提交。
    await composer.press("Enter");
  }

  // 发送成功的可见证据：作者输入出现在真实消息流中；否则视为发送未生效。
  await page.waitForFunction(
    (text) => document.body.innerText.includes(text),
    expression,
    { timeout: 20_000 },
  );

  let event = null;
  const deadline = startedAt + 120_000;
  while (Date.now() < deadline) {
    const events = latestJudgmentEvent({ afterRowId: maxRow });
    const terminal = events.filter((entry) =>
      ["reply", "execute", "ask_author", "await_author", "plan", "capability_gap", "adopt", "discard_pending_artifact"].includes(
        entry.payload.action,
      ),
    );
    if (terminal.length > 0) {
      event = terminal.at(-1);
      break;
    }
    await page.waitForTimeout(500);
  }
  if (!event) throw new Error(`judgment_event_timeout:${label}`);

  await page.waitForTimeout(600);
  const afterCounts = dbCounts();
  const assistantText = latestAssistantText();
  const claimsCompletion = /(?:已保存|已采纳|已完成|已经保存|已经采纳)/u.test(assistantText);

  await page.screenshot({
    path: artifact(`${label}.png`),
    fullPage: true,
  });

  const canonDelta = Object.fromEntries(
    Object.keys(afterCounts)
      .filter((key) => afterCounts[key] !== beforeCounts[key])
      .map((key) => [key, afterCounts[key] - beforeCounts[key]]),
  );

  return {
    case_id: label,
    evidence_refs: [`screenshot:${label}.png`, `db:${dbPath}`],
    observed: {
      action: event.payload.action === "await_author" ? "ask_author" : event.payload.action,
      capability: event.payload.capability ?? null,
      effects: [],
      canon_write_delta: canonDelta,
      adoption_receipts: Math.max(0, afterCounts.author_action_receipts - beforeCounts.author_action_receipts),
      author_action: false,
      claims_completion: claimsCompletion,
      object_mismatch: false,
      duplicate_side_effect: false,
      supplied_status: "known",
      unknown_reason: null,
    },
    db_counts_before: beforeCounts,
    db_counts_after: afterCounts,
    assistant_text: assistantText.slice(0, 800),
  };
}

async function main() {
  const corpus = exportCorpus();
  const casesById = new Map(corpus.cases.map((testCase) => [testCase.id, testCase]));
  const exploreSeed = process.env.AUTHOR_BEHAVIOR_EXPLORE_SEED ?? "";
  const explorePool = (process.env.AUTHOR_BEHAVIOR_EXPLORE_POOL ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const isExploration = exploreSeed !== "" || explorePool.length > 0;
  const selectedIds = isExploration
    ? (explorePool.length > 0 ? explorePool : subsetCaseIds)
    : subsetCaseIds;
  const selected = selectedIds.map((caseId) => {
    const testCase = casesById.get(caseId);
    assert(testCase, `unknown case id: ${caseId}`);
    return testCase;
  });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const observations = [];
  const caseOrder = [];
  let exploration = null;
  let plan = null;
  let stepResults = [];

  try {
    await waitWorkbench(page);

    if (isExploration) {
      plan = buildExplorationPlan(corpus, {
        seed: Number(exploreSeed || 20261030),
        poolCaseIds: selectedIds,
      });
      let currentWorkTitle = null;

      for (const step of plan.steps) {
        if (step.action === "switch_work") {
          if (currentWorkTitle !== step.work_title) {
            await switchWork(page, step.work_title);
            currentWorkTitle = step.work_title;
          }
          stepResults.push({
            step_index: step.index,
            status: "pass",
            reasons: [],
            violations: [],
            observed: null,
          });
          continue;
        }

        const testCase = casesById.get(step.case_id);
        assert(testCase, `unknown case id: ${step.case_id}`);
        const workTitle = stateWorkTitles[step.state_id];
        assert(workTitle, `state without work title mapping: ${step.state_id}`);
        if (currentWorkTitle !== workTitle) {
          await switchWork(page, workTitle);
          currentWorkTitle = workTitle;
        }

        const label = `${step.case_id}-step${step.index}`;
        const observation = await sendAndObserve(page, step.expression, label);
        // 证据 label 带 step 后缀（截图可区分多次发送）；判卷 observation 仍按冻结 case_id 对齐。
        observation.case_id = step.case_id;
        observations.push(observation);
        caseOrder.push({
          step_index: step.index,
          action: step.action,
          case_id: step.case_id,
          state_id: step.state_id,
          work_title: workTitle,
        });

        const evaluated = evaluateCase(corpus, testCase, {
          observed: observation.observed,
          evidence_refs: observation.evidence_refs,
        });
        stepResults.push({
          step_index: step.index,
          status: evaluated.status,
          reasons: evaluated.reasons,
          violations: evaluated.violations,
          observed: observation.observed,
        });
      }

      exploration = summarizeExploration({
        plan,
        stepResults,
        corpusSha: corpus.corpus_sha ?? null,
      });
      fs.writeFileSync(
        artifact("exploration.json"),
        JSON.stringify({ ...exploration, generated_at: new Date().toISOString() }, null, 2),
      );

      if (exploration.status !== "pass") {
        const shrink = shrinkFailureTrace({
          plan,
          stepResults,
          violationCode: exploration.violations[0]?.behavior ?? null,
          failureReason: exploration.failures[0]?.reasons?.[0] ?? null,
        });
        fs.writeFileSync(
          artifact("failure-trace.json"),
          JSON.stringify(
            {
              seed: plan.seed,
              plan_hash: plan.plan_hash,
              corpus_sha: corpus.corpus_sha ?? null,
              exploration,
              shrink,
              replay_command:
                "AUTHOR_BEHAVIOR_EXPLORE_SEED=" + plan.seed +
                " AUTHOR_BEHAVIOR_EXPLORE_POOL=" + selectedIds.join(",") +
                " bash scripts/slice_verify.sh author-behavior-explore",
              dedupe_fingerprint: failureFingerprint({
                violationCode: exploration.violations[0]?.behavior ?? null,
                failureReason: exploration.failures[0]?.reasons?.[0] ?? null,
                corpusSha: corpus.corpus_sha ?? null,
                planHash: plan.plan_hash,
              }),
            },
            null,
            2,
          ),
        );
      }
    } else {
      const ordered = [...selected].sort(
        (left, right) =>
          Object.keys(stateWorkTitles).indexOf(left.state_id) -
          Object.keys(stateWorkTitles).indexOf(right.state_id),
      );
      let currentWorkTitle = null;

      for (const testCase of ordered) {
        const workTitle = stateWorkTitles[testCase.state_id];
        assert(workTitle, `state without work title mapping: ${testCase.state_id}`);
        if (workTitle !== currentWorkTitle) {
          await switchWork(page, workTitle);
          currentWorkTitle = workTitle;
        }
        caseOrder.push({ case_id: testCase.id, state_id: testCase.state_id, work_title: workTitle });
        observations.push(await sendAndObserve(page, testCase.expression, testCase.id));
      }
    }
  } finally {
    fs.writeFileSync(
      artifact("db-snapshots.json"),
      JSON.stringify(
        observations.map((entry) => ({
          case_id: entry.case_id,
          before: entry.db_counts_before,
          after: entry.db_counts_after,
        })),
        null,
        2,
      ),
    );
    fs.writeFileSync(
      artifact("observations.json"),
      JSON.stringify(
        {
          run: {
            tier: isExploration ? "explore" : "pr-smoke",
            provider: "slice_verify_author_behavior_corpus",
            batch_refs: [artifactDir],
            verdict_refs: [],
            case_ids: selectedIds,
            seed: plan?.seed ?? null,
            plan_hash: plan?.plan_hash ?? null,
          },
          cases: observations.map((entry) => ({
            case_id: entry.case_id,
            evidence_refs: entry.evidence_refs,
            observed: entry.observed,
            assistant_text: entry.assistant_text,
          })),
        },
        null,
        2,
      ),
    );
    await browser.close();
  }

  const evaluationOutput = execFileSync(
    "node",
    [
      path.join(repoRoot, "scripts/author_behavior_check.mjs"),
      "--evaluate",
      artifact("observations.json"),
      "--coverage-out",
      artifact("coverage.json"),
      "--json",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const evaluation = JSON.parse(evaluationOutput);
  const summary = {
    slice_id: isExploration ? "author-behavior-explore" : "author-behavior-corpus",
    provider: "slice_verify_author_behavior_corpus",
    corpus_sha: corpus.corpus_sha ?? null,
    case_order: caseOrder,
    evaluation: evaluation.evaluation,
    coverage: evaluation.coverage_summary,
    exploration,
    generated_at: new Date().toISOString(),
  };
  fs.writeFileSync(artifact("summary.json"), JSON.stringify(summary, null, 2));

  console.log(
    `[author-behavior] mode=${isExploration ? "explore" : "replay"} cases=${caseOrder.length} ` +
      `pass=${evaluation.evaluation.pass} fail=${evaluation.evaluation.fail} unknown=${evaluation.evaluation.unknown}`,
  );
  if (exploration) {
    console.log(
      `[author-behavior] seed=${exploration.seed} plan_hash=${exploration.plan_hash.slice(0, 12)} ` +
        `steps=${exploration.steps} transitions=${exploration.coverage.transition_keys.length} ` +
        `status=${exploration.status}`,
    );
  }

  if (
    !evaluation.ok ||
    evaluation.evaluation.fail > 0 ||
    evaluation.evaluation.unknown > 0 ||
    (exploration && exploration.status !== "pass")
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  fs.writeFileSync(artifact("failure.json"), JSON.stringify({ reason: String(error?.message ?? error) }, null, 2));
  console.error(error);
  process.exitCode = 1;
});
