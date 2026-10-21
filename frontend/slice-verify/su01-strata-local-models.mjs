// Contract: tasks/slices/SU01-strata-local-models.md §1 / §4 / §8
// Design: docs/design/acceptance/system/SU-01-model-provider.md
// Harness: 外部 Playwright 自动化（scripts/slice_verify.sh <slice-id> 调用）。
//
// 场景：本机 Strata 模型发现 —— 真实工作台「模型供应商」Dialog 从后端
// `GET /api/provider/local-models?provider=strata` 发现本机 Strata 安装目录里的
// profile，展示「运行中」并让模型与端点原子绑定，随后测试连接、保存并切换。
//
// 边界（AGENTS.md § 场景化验收红线）：
// - 本文件在产品之外；不修改产品代码、不依赖 data-testid/验收专用 DOM hook。
// - 两个本机 OpenAI 兼容替身（GET /v1/models）只通过真实 HTTP 端点提供服务，
//   不注册进产品 app/runtime；产品侧只走真实 registry 的 Strata adapter。
// - fixtures 写入 repo tmp/test-strata-install/（config/test.exs 的 models_dir），
//   由 test 环境显式注入，不进入生产路径；运行结束清理 fixtures 与替身。
//
// 本场景只证明：本机 profile 发现 + 真实 /v1/models 探活 + 选中绑定 + 连接测试 +
// 保存切换。running=true 只代表替身 /v1/models 可达，不代表真实引擎推理。

import { chromium } from "playwright";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sliceId = "su01-strata-local-models";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const modelsDir = path.join(repoRoot, "tmp", "test-strata-install");
const baseUrl = process.env.SLICE_VERIFY_BASE_URL ?? "http://127.0.0.1:5768";
const artifactDir =
  process.env.SLICE_VERIFY_ARTIFACT_DIR ??
  path.join(repoRoot, "artifacts", "slice-verify", sliceId);
const backendLogPath =
  process.env.SLICE_VERIFY_BACKEND_LOG ?? path.join(artifactDir, "backend.log");
const appLogDir = process.env.SLICE_VERIFY_APP_LOG_DIR ?? path.join(artifactDir, "app-log");

const chatInputSelector = 'input[placeholder="输入你的想法、问题或指令..."]';
const providerDialogName = "模型供应商";
const strataProviderId = "strata";
const strataProviderLabel = "Strata";

// Strata 是「一进程一模型」：两个 profile 对应两个本机引擎端口。
// 本 spec 用两个本机 OpenAI 兼容替身分别代表这两台引擎的 /v1/models。
const fixtures = [
  {
    configFile: "strata-q2_0.json",
    modelId: "qwen3.8-flash-next-q2_0",
    host: "127.0.0.1",
    port: 18081,
  },
  {
    configFile: "strata-iq3_s.json",
    modelId: "qwen3.8-flash-next-iq3_s",
    host: "127.0.0.1",
    port: 18082,
  },
];
const expectedModelIds = fixtures.map((fixture) => fixture.modelId);
const selectedFixture = fixtures[1];
const selectedModelId = selectedFixture.modelId;
const selectedEndpoint = `http://${selectedFixture.host}:${selectedFixture.port}/v1`;
const selectedPort = selectedFixture.port;
const startedAt = new Date().toISOString();

fs.mkdirSync(artifactDir, { recursive: true });

const frames = [];
const steps = [];
const consoleMessages = [];
const pageFailures = [];
const capturedLocalModelsResponses = [];
const observations = {
  base_url: baseUrl,
  artifact_dir: artifactDir,
  models_dir: modelsDir,
  fixtures: fixtures.map((fixture) => ({
    config_file: path.join(modelsDir, fixture.configFile),
    model_id: fixture.modelId,
    host: fixture.host,
    port: fixture.port,
    endpoint: `http://${fixture.host}:${fixture.port}/v1`,
  })),
  expected: {
    provider_id: strataProviderId,
    provider_label: strataProviderLabel,
    discovered_models: expectedModelIds,
    selected_model: selectedModelId,
    selected_endpoint: selectedEndpoint,
  },
  screenshots: [],
  console_messages: consoleMessages,
  page_errors: pageFailures,
  captured_local_models_response_count: 0,
};
const assertions = {};

let localModelsCaptureCount = 0;
let fakeServerClosed = 0;
let browserClosed = false;
let fixturesRemoved = false;
let fixturesDirRemoved = false;
let fixtureSetup = null;
let fakeServers = [];
let browser = null;
let page = null;
let failure = null;
let providerOptionsAfterSave = null;
let directLocalModelsProbe = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// 验收断言逐条留痕：哪条过、哪条不过都会写进 ui-state.json / summary.json。
function check(name, condition, message) {
  assertions[name] = Boolean(condition);
  if (!condition) {
    throw new Error(`[${name}] ${message}`);
  }
}

function recordStep(step, details = {}) {
  steps.push({ step, at: new Date().toISOString(), ...details });
}

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

// ---------------------------------------------------------------------------
// 本机 Strata 引擎替身：只提供 GET /v1/models，让产品侧真实探活/连接测试可达。
// ---------------------------------------------------------------------------

function startFakeStrataEngine(fixture) {
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    const requestUrl = request.url ?? "/";
    const isModelsRequest =
      request.method === "GET" &&
      (requestUrl === "/v1/models" || requestUrl.startsWith("/v1/models?"));

    if (!isModelsRequest) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: { message: "not found", type: "invalid_request_error", code: "not_found" },
        }),
      );
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        object: "list",
        data: [{ id: fixture.modelId, object: "model", created: 0, owned_by: "strata" }],
      }),
    );
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  return new Promise((resolve, reject) => {
    const onError = (error) => {
      reject(
        new Error(
          `无法启动替身引擎 ${fixture.modelId}：127.0.0.1:${fixture.port} 监听失败` +
            `（${error.code ?? "unknown"}: ${error.message}）。端口被占用时本 spec 快速失败；` +
            "请释放该端口后重跑（profile 端口固定，不自动换端口）。",
        ),
      );
    };

    server.once("error", onError);
    server.listen(fixture.port, fixture.host, () => {
      server.off("error", onError);
      resolve({
        fixture,
        close: async () => {
          for (const socket of sockets) socket.destroy();
          await new Promise((resolveClose) => server.close(() => resolveClose()));
        },
      });
    });
  });
}

function installFixtures() {
  fs.mkdirSync(modelsDir, { recursive: true });
  // 该目录是本 slice 的测试注入目录（config/test.exs models_dir），只清理由本 spec
  // 管理的 strata-*.json，保证发现结果只来自本次两个 profile，避免上次崩溃残留。
  for (const entry of fs.readdirSync(modelsDir)) {
    if (/^strata-.*\.json$/.test(entry)) {
      fs.rmSync(path.join(modelsDir, entry), { force: true });
    }
  }

  for (const fixture of fixtures) {
    const configPath = path.join(modelsDir, fixture.configFile);
    const config = {
      model_name: fixture.modelId,
      port: fixture.port,
      host: fixture.host,
    };
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }
}

function removeFixtures() {
  try {
    for (const fixture of fixtures) {
      fs.rmSync(path.join(modelsDir, fixture.configFile), { force: true });
    }
    fixturesRemoved = true;

    if (fs.existsSync(modelsDir) && fs.readdirSync(modelsDir).length === 0) {
      fs.rmdirSync(modelsDir);
      fixturesDirRemoved = true;
    }
  } catch (error) {
    observations.fixture_cleanup_error = String(error?.message ?? error);
  }
}

// ---------------------------------------------------------------------------
// 网络证据：真实工作台发起的本机模型发现请求（非 spec 直接调用）。
// ---------------------------------------------------------------------------

function attachNetworkCapture(targetPage) {
  targetPage.on("response", (response) => {
    const responseUrl = response.url();
    if (!responseUrl.includes("/api/provider/local-models")) return;

    localModelsCaptureCount += 1;
    capturedLocalModelsResponses.push(
      (async () => {
        const record = {
          url: responseUrl,
          method: response.request().method(),
          // Playwright Response.status() 是方法（Node fetch 的 response.status 才是属性）。
          status: response.status(),
          captured_at: new Date().toISOString(),
          body: null,
          parse_error: null,
        };

        try {
          record.body = await response.json();
        } catch (error) {
          record.parse_error = String(error?.message ?? error);
        }

        return record;
      })(),
    );
  });
}

async function collectCapturedLocalModels(timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (localModelsCaptureCount === 0 && Date.now() < deadline) {
    await sleep(50);
  }

  const settled = await Promise.allSettled(capturedLocalModelsResponses);
  return settled.map((result) =>
    result.status === "fulfilled"
      ? result.value
      : {
          url: null,
          status: null,
          body: null,
          parse_error: String(result.reason),
        },
  );
}

async function probeLocalModelsApi() {
  const probeUrl = `${baseUrl}/api/provider/local-models?provider=${strataProviderId}`;
  const response = await fetch(probeUrl);
  const body = await response.json().catch(() => null);
  return {
    url: probeUrl,
    status: response.status,
    body,
    note: "spec 直接调用同一条公开 API 的补充证据；前端是否真实发起请求以上面 page response 为准。",
  };
}

// ---------------------------------------------------------------------------
// 真实页面操作 helpers（只用用户可见语义 + 产品既有可访问 id）。
// ---------------------------------------------------------------------------

async function screenshot(targetPage, fileName) {
  await targetPage.screenshot({
    path: path.join(artifactDir, fileName),
    fullPage: true,
  });
  observations.screenshots.push(fileName);
}

async function waitForWorkbench(targetPage) {
  await targetPage.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await targetPage.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  // 真实工作台可见连接状态：既有 UI 是「同步已连接」；同时兼容「服务: 已连接」旧文案。
  await targetPage.waitForFunction(
    () => /服务: 已连接|同步已连接/.test(document.body.innerText),
    null,
    { timeout: 30_000 },
  );
  recordStep("workbench.connected", { url: baseUrl });
}

async function openModelProviderSettings(targetPage) {
  const byName = targetPage.getByRole("button", {
    name: /模型设置|模型已连接|模型未连接|模型检测中/,
  });
  const trigger =
    (await byName.count()) > 0
      ? byName.first()
      : targetPage
          .locator(
            'button[title*="当前模型"], button[title*="模型未连接"], button[title*="请检查当前模型供应商配置"]',
          )
          .first();

  await trigger.waitFor({ state: "visible", timeout: 30_000 });
  // Radix Dialog 打开后会对背景内容设置 aria-hidden，role 定位器将解析不到顶栏按钮，
  // 因此必须在点击前取 trigger 的 title（真实产品语义），点击后只用 dialog 内元素。
  const triggerTitle = (await trigger.getAttribute("title")) ?? "";
  await trigger.click();

  const dialog = targetPage.getByRole("dialog", { name: providerDialogName });
  await dialog.waitFor({ state: "visible", timeout: 15_000 });
  recordStep("dialog.open", { trigger_title: triggerTitle });

  return { trigger, dialog };
}

async function waitForButtonEnabled(targetPage, buttonName, timeoutMs = 15_000) {
  await targetPage.waitForFunction(
    (name) => {
      const button = Array.from(document.querySelectorAll("button")).find(
        (candidate) => (candidate.textContent ?? "").trim() === name,
      );
      return Boolean(button) && !button.disabled;
    },
    buttonName,
    { timeout: timeoutMs },
  );
}

async function waitForLocalModelOptions(targetPage) {
  try {
    await targetPage.waitForFunction(
      (expectedIds) => {
        const select = document.querySelector("#model-provider-model-input");
        if (!select) return false;
        const values = Array.from(select.querySelectorAll("option"), (option) => option.value);
        return expectedIds.every((modelId) => values.includes(modelId));
      },
      expectedModelIds,
      { timeout: 30_000 },
    );
  } catch (error) {
    const diagnostics = await targetPage.evaluate(() => ({
      dialog_text: document.querySelector('[role="dialog"]')?.innerText ?? "",
      provider_value: document.querySelector("#model-provider-select")?.value ?? null,
      endpoint_value: document.querySelector("#model-provider-endpoint-input")?.value ?? null,
      model_options: Array.from(
        document.querySelectorAll("#model-provider-model-input option"),
        (option) => ({ value: option.value, label: (option.textContent ?? "").trim() }),
      ),
    }));
    throw new Error(
      `选择 Strata 后模型下拉未出现本机 profile ${JSON.stringify(expectedModelIds)}；` +
        `诊断：${JSON.stringify(diagnostics)}；底层错误：${error.message}`,
      { cause: error },
    );
  }
}

async function waitForTopBarModel(targetPage, label, modelId, timeoutMs = 30_000) {
  try {
    await targetPage.waitForFunction(
      ({ expectedLabel, expectedModel }) => {
        // 顶栏模型入口：可见文本是连接状态，title 携带 provider/model（真实作者可见语义）。
        const buttons = Array.from(document.querySelectorAll("button"));
        const target = buttons.find((button) =>
          /模型已连接|模型未连接|模型检测中/.test(button.textContent ?? ""),
        );
        const text = `${target?.textContent ?? ""} ${target?.getAttribute("title") ?? ""}`;
        return text.includes(expectedLabel) && text.includes(expectedModel);
      },
      { expectedLabel: label, expectedModel: modelId },
      { timeout: timeoutMs },
    );
  } catch (error) {
    const diagnostics = await targetPage.evaluate(() =>
      Array.from(document.querySelectorAll("button"))
        .filter((button) => /模型已连接|模型未连接|模型检测中/.test(button.textContent ?? ""))
        .map((button) => ({
          text: (button.textContent ?? "").trim(),
          title: button.getAttribute("title") ?? "",
        })),
    );
    throw new Error(
      `保存后顶栏模型状态按钮未出现 ${label} / ${modelId}；诊断：${JSON.stringify(diagnostics)}；` +
        `底层错误：${error.message}`,
      { cause: error },
    );
  }
}

function assertLocalModelsResponses(responses) {
  const strataResponses = responses.filter(
    (response) =>
      response.status === 200 &&
      response.body?.ok === true &&
      response.body?.provider === strataProviderId,
  );

  check(
    "local_models_requested_by_real_ui",
    responses.length > 0,
    `真实工作台选择 Strata 后未捕获 GET /api/provider/local-models 响应；` +
      `captured=${JSON.stringify(responses.map((response) => response.url))}`,
  );
  check(
    "local_models_response_ok",
    strataResponses.length > 0,
    `本机模型发现接口未返回 200/ok=true/provider=strata；` +
      `captured=${JSON.stringify(
        responses.map((response) => ({
          url: response.url,
          status: response.status,
          body: response.body,
        })),
      )}`,
  );
  check(
    "local_models_request_via_page",
    responses.some((response) => /[?&]provider=strata(&|$)/.test(response.url ?? "")),
    `本机模型发现请求未携带 provider=strata 查询参数；captured=${JSON.stringify(
      responses.map((response) => response.url),
    )}`,
  );

  const models = strataResponses.flatMap((response) =>
    Array.isArray(response.body?.models) ? response.body.models : [],
  );

  for (const fixture of fixtures) {
    const model = models.find((candidate) => candidate.id === fixture.modelId);
    check(
      `local_model_${fixture.modelId}_discovered`,
      Boolean(model),
      `本机模型发现响应缺少 ${fixture.modelId}；models=${JSON.stringify(models)}`,
    );
    check(
      `local_model_${fixture.modelId}_running`,
      model.running === true,
      `${fixture.modelId} 的 running 应为 true（替身 /v1/models 可达），实际 ${model.running}`,
    );
    check(
      `local_model_${fixture.modelId}_endpoint`,
      model.endpoint === `http://${fixture.host}:${fixture.port}/v1` &&
        model.host === fixture.host &&
        model.port === fixture.port,
      `${fixture.modelId} 的 endpoint/host/port 与 profile 不一致：` +
        `${JSON.stringify({ endpoint: model.endpoint, host: model.host, port: model.port })}`,
    );
    check(
      `local_model_${fixture.modelId}_config_file`,
      model.config === fixture.configFile,
      `${fixture.modelId} 的 config 文件名应为 ${fixture.configFile}，实际 ${model.config}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 场景主体
// ---------------------------------------------------------------------------

async function runScenario(targetPage) {
  await waitForWorkbench(targetPage);

  const { dialog } = await openModelProviderSettings(targetPage);

  // 1) 供应商下拉来自后端 registry（前端不写死），选择 Strata。
  const providerSelect = targetPage.locator("#model-provider-select");
  await providerSelect.waitFor({ state: "visible", timeout: 15_000 });
  await targetPage.waitForFunction(
    () => {
      const select = document.querySelector("#model-provider-select");
      return Boolean(select) && !select.disabled;
    },
    null,
    { timeout: 15_000 },
  );
  const providerOptions = await providerSelect
    .locator("option")
    .evaluateAll((options) =>
      options.map((option) => ({ value: option.value, label: (option.textContent ?? "").trim() })),
    );
  observations.provider_options = providerOptions;
  check(
    "provider_registry_lists_strata",
    providerOptions.some((option) => option.value === strataProviderId),
    `供应商下拉没有后端 registry 提供的 strata：${JSON.stringify(providerOptions)}`,
  );

  await providerSelect.selectOption(strataProviderId);
  observations.provider_selected = await providerSelect.inputValue();
  check(
    "strata_selected",
    observations.provider_selected === strataProviderId,
    `供应商下拉未选中 strata，实际 ${observations.provider_selected}`,
  );
  recordStep("provider.selected", { provider: strataProviderId });

  // 2) 等本机发现模型出现在模型下拉（两个 profile id 都出现）。
  await waitForLocalModelOptions(targetPage);
  const modelSelect = targetPage.locator("#model-provider-model-input");
  const modelOptions = await modelSelect
    .locator("option")
    .evaluateAll((options) =>
      options.map((option) => ({ value: option.value, label: (option.textContent ?? "").trim() })),
    );
  observations.model_options = modelOptions;

  for (const modelId of expectedModelIds) {
    const option = modelOptions.find((candidate) => candidate.value === modelId);
    check(
      `model_option_${modelId}_visible`,
      Boolean(option),
      `模型下拉缺少本机 profile ${modelId}；options=${JSON.stringify(modelOptions)}`,
    );
    check(
      `model_option_${modelId}_running_label`,
      option.label.includes("运行中"),
      `本机 profile ${modelId} 的模型 option 可见文案应含「运行中」，实际 ${JSON.stringify(option.label)}`,
    );
  }

  // 3) 本机发现接口响应证据（真实工作台发起，含 running/endpoint）。
  const capturedResponses = await collectCapturedLocalModels();
  observations.local_models_page_responses = capturedResponses;
  observations.captured_local_models_response_count = capturedResponses.length;
  assertLocalModelsResponses(capturedResponses);

  // 4) 发现非空时，实时列表失败文案不应与「已发现模型」并存（SU01 §4）。
  await targetPage.waitForTimeout(1_200);
  const dialogTextAfterDiscovery = await dialog.innerText();
  observations.dialog_text_after_discovery = dialogTextAfterDiscovery;
  const realtimeFailureVisible =
    dialogTextAfterDiscovery.includes("无法连接 Strata") ||
    dialogTextAfterDiscovery.includes("模型列表加载失败");
  check(
    "realtime_failure_hidden_when_discovered",
    !realtimeFailureVisible,
    `本机发现已列出模型，但 Dialog 仍显示实时列表失败文案：${JSON.stringify(
      dialogTextAfterDiscovery.slice(0, 600),
    )}`,
  );

  await screenshot(targetPage, "01-dialog-local-models.png");

  // 5) 选中 IQ3_S：模型名与端点必须原子绑定到该 profile 的端口。
  await modelSelect.selectOption(selectedModelId);
  observations.model_selected = await modelSelect.inputValue();
  check(
    "selected_local_model",
    observations.model_selected === selectedModelId,
    `模型下拉未选中 ${selectedModelId}，实际 ${observations.model_selected}`,
  );

  await targetPage.waitForFunction(
    (expectedEndpoint) => {
      const input = document.querySelector("#model-provider-endpoint-input");
      return Boolean(input) && input.value === expectedEndpoint;
    },
    selectedEndpoint,
    { timeout: 10_000 },
  );
  const endpointValue = await targetPage.locator("#model-provider-endpoint-input").inputValue();
  observations.endpoint_value = endpointValue;
  check(
    "model_endpoint_atomic_binding",
    endpointValue === selectedEndpoint,
    `选中 ${selectedModelId} 后端点应为 ${selectedEndpoint}，实际 ${endpointValue}`,
  );
  recordStep("local-profile.selected", {
    model: selectedModelId,
    endpoint: endpointValue,
    port: selectedPort,
  });

  // 6) 测试连接：产品真实请求该 profile 的 /v1/models。
  await waitForButtonEnabled(targetPage, "测试连接");
  await targetPage.getByRole("button", { name: "测试连接", exact: true }).click();
  await targetPage.waitForFunction(() => document.body.innerText.includes("连接可用。"), null, {
    timeout: 30_000,
  });
  check("connection_test_passed", true, "测试连接未显示「连接可用。」");
  recordStep("connection.tested", { endpoint: endpointValue, model: selectedModelId });
  await screenshot(targetPage, "02-dialog-connection-test.png");

  // 7) 保存并切换：Dialog 关闭，运行时 provider 切换为 strata + IQ3_S。
  await waitForButtonEnabled(targetPage, "保存并切换");
  await targetPage.getByRole("button", { name: "保存并切换", exact: true }).click();
  await dialog.waitFor({ state: "detached", timeout: 30_000 });
  check("dialog_closed_after_save", true, "保存并切换后 Dialog 未关闭");
  recordStep("provider.saved");

  const providerOptionsResponse = await fetch(`${baseUrl}/api/provider/options`);
  assert(
    providerOptionsResponse.ok,
    `保存后 GET /api/provider/options 失败：HTTP ${providerOptionsResponse.status}`,
  );
  const optionsAfterSave = await providerOptionsResponse.json();
  const currentProvider = optionsAfterSave.current_provider;
  const currentOption =
    (optionsAfterSave.providers ?? []).find((option) => option.current === true) ??
    (optionsAfterSave.providers ?? []).find((option) => option.id === currentProvider);
  providerOptionsAfterSave = { current_provider: currentProvider, current_option: currentOption };
  observations.provider_options_after_save = providerOptionsAfterSave;

  check(
    "runtime_current_provider_strata",
    currentProvider === strataProviderId,
    `保存后 /api/provider/options current_provider 应为 strata，实际 ${currentProvider}`,
  );
  check(
    "runtime_current_model_selected",
    currentOption?.model === selectedModelId,
    `保存后当前 provider 的 model 应为 ${selectedModelId}，实际 ${currentOption?.model}`,
  );
  check(
    "runtime_current_endpoint_selected",
    currentOption?.endpoint === selectedEndpoint,
    `保存后当前 provider 的 endpoint 应为 ${selectedEndpoint}，实际 ${currentOption?.endpoint}`,
  );

  // 8) 顶栏含 Strata / IQ3_S（可见状态文本 + title 的产品语义）。
  await waitForTopBarModel(targetPage, strataProviderLabel, selectedModelId);
  const topBarBadge = targetPage
    .getByRole("button", { name: /模型已连接|模型未连接|模型检测中/ })
    .first();
  const topBarVisibleText = ((await topBarBadge.textContent()) ?? "").trim();
  const topBarTitle = (await topBarBadge.getAttribute("title")) ?? "";
  observations.top_bar = { visible_text: topBarVisibleText, title: topBarTitle };
  check(
    "top_bar_shows_strata_and_model",
    `${topBarVisibleText} ${topBarTitle}`.includes(strataProviderLabel) &&
      `${topBarVisibleText} ${topBarTitle}`.includes(selectedModelId),
    `顶栏模型入口未同时显示 Strata 与 ${selectedModelId}：text=${JSON.stringify(
      topBarVisibleText,
    )} title=${JSON.stringify(topBarTitle)}`,
  );

  // 补充运行态证据（不替代必需断言）。
  try {
    const healthResponse = await fetch(`${baseUrl}/api/provider/health`);
    observations.provider_health_after_save = {
      status: healthResponse.status,
      body: await healthResponse.json().catch(() => null),
    };
  } catch (error) {
    observations.provider_health_after_save = { error: String(error?.message ?? error) };
  }

  observations.body_text_sample = (await targetPage.locator("body").innerText()).slice(0, 2_000);
  await screenshot(targetPage, "03-workbench-after-save.png");
  recordStep("acceptance.verified", {
    provider: currentProvider,
    model: currentOption?.model ?? null,
    endpoint: currentOption?.endpoint ?? null,
  });

  // 页面发起的本机模型发现响应（保存后不再存在，仅作最终快照）。
  observations.local_models_page_responses = await collectCapturedLocalModels(1_000);
}

// ---------------------------------------------------------------------------
// 证据落盘：ui-state.json / ui-frames.json / local-models.json / summary.json
// ---------------------------------------------------------------------------

function writeJson(fileName, value) {
  fs.writeFileSync(path.join(artifactDir, fileName), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function screenshotFiles() {
  return fs
    .readdirSync(artifactDir)
    .filter((name) => name.endsWith(".png"))
    .sort();
}

function readBackendLogTail(maxLines = 120) {
  if (!fs.existsSync(backendLogPath)) return null;
  const lines = fs.readFileSync(backendLogPath, "utf8").trimEnd().split("\n");
  return lines.slice(-maxLines).join("\n");
}

function buildSummary(status, cleanup) {
  const screenshots = screenshotFiles();
  const required = ["screenshot", "websocket_frames", "summary_json"];
  const produced = {
    screenshot: screenshots.length > 0,
    websocket_frames: frames.length > 0,
    ui_state: fs.existsSync(path.join(artifactDir, "ui-state.json")),
    local_models_json: fs.existsSync(path.join(artifactDir, "local-models.json")),
    summary_json: true,
    backend_log: fs.existsSync(backendLogPath),
    app_jsonl_dir: fs.existsSync(appLogDir),
  };

  const missingEvidence = [];
  if (!produced.screenshot) missingEvidence.push("screenshot");
  if (!produced.websocket_frames) missingEvidence.push("websocket_frames");
  if (!produced.backend_log) missingEvidence.push("backend_log");
  if (!produced.app_jsonl_dir) missingEvidence.push("app_jsonl");

  return {
    scenario_id: sliceId,
    title: "本机 Strata 模型发现与选中端点原子绑定（browser 真实工作台）",
    surface: "browser",
    tier: "pr-smoke",
    artifact_dir: artifactDir,
    status,
    ran_at: {
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    },
    required,
    produced,
    evidence_files: {
      ui_state: path.join(artifactDir, "ui-state.json"),
      ui_frames: path.join(artifactDir, "ui-frames.json"),
      local_models: path.join(artifactDir, "local-models.json"),
      summary: path.join(artifactDir, "summary.json"),
      screenshots,
      backend_log: backendLogPath,
      app_jsonl_dir: appLogDir,
    },
    missing_evidence: missingEvidence,
    // 本场景形态决定的缺项，如实登记而不是伪造证据。
    not_applicable_evidence: [
      {
        item: "turn_result",
        reason:
          "本场景验证模型发现/端点绑定/连接测试/保存切换，不发送聊天 turn，因此没有 turn_result。",
      },
      {
        item: "llm_http_log",
        reason:
          "替身只提供 GET /v1/models（发现探活与连接测试），不是产品 LLM 生成调用；产品 test/health 调用不写 llm-calls 日志。",
      },
      {
        item: "persistence_snapshot",
        reason: "provider 运行时配置按产品设计仅内存保存、不落 DB，无持久化快照可抓。",
      },
      {
        item: "action_result",
        reason: "本场景不经过 Channel author_action 链路。",
      },
    ],
    assertions,
    observations,
    verification_limits: [
      "running=true 只证明替身 profile 端点的 GET /v1/models 可达，不证明 Strata 引擎真实推理、权重健康或回复质量。",
      "fixtures 写入 repo tmp/test-strata-install/（config/test.exs models_dir，test 环境注入）；不覆盖真实用户安装目录、自定义目录与 NOVEL_STRATA_MODELS_DIR 覆盖路径。",
      "不发送聊天 turn，不证明保存后的下一轮真实创作调用使用新 profile；该链路由 su01-provider-strata-local（live/tauri）覆盖。",
      "仅覆盖本机 loopback 场景；Windows 路径规则与远端 Strata 端点不在本场景范围。",
    ],
    cleanup,
    failure: failure ? String(failure.stack ?? failure.message ?? failure) : null,
  };
}

function writeEvidenceArtifacts(status, cleanup) {
  const uiState = {
    event: status === "passed" ? "slice_verify.ui_state.done" : "slice_verify.ui_state.failed",
    slice_id: sliceId,
    surface: "browser",
    tier: "pr-smoke",
    status,
    assertions,
    observations,
    steps,
    frames_count: frames.length,
    fixture_setup: fixtureSetup,
    failure: failure ? String(failure.stack ?? failure.message ?? failure) : null,
  };
  writeJson("ui-state.json", [uiState]);
  writeJson("ui-frames.json", frames);
  writeJson("local-models.json", {
    scenario_id: sliceId,
    provider: strataProviderId,
    models_dir: modelsDir,
    fixtures: observations.fixtures,
    // 真实工作台发起的 GET /api/provider/local-models 响应（由 page response 监听捕获）。
    page_responses: observations.local_models_page_responses ?? [],
    // spec 直连同一公开 API 的补充快照；不替代 page_responses 证据。
    direct_probe: directLocalModelsProbe,
  });
  writeJson("summary.json", buildSummary(status, cleanup));
}

function writeFailureDiagnostics() {
  if (!failure) return;

  const backendTail = readBackendLogTail();
  if (backendTail) {
    fs.writeFileSync(path.join(artifactDir, "backend-log-tail.txt"), `${backendTail}\n`, "utf8");
  }
}

// 本场景依赖 config/test.exs 注入的发现目录与回环默认端点；运维 env 覆盖优先级更高，
// 若被继承覆盖会静默换目录/端点，因此快速失败并说明原因，避免难懂的等待超时。
function assertNoInheritedDiscoveryOverride() {
  const modelsDirOverride = (process.env.NOVEL_STRATA_MODELS_DIR ?? "").trim();
  if (modelsDirOverride) {
    throw new Error(
      `NOVEL_STRATA_MODELS_DIR=${modelsDirOverride} 会覆盖 config/test.exs 的 models_dir，` +
        "本场景依赖 repo tmp/test-strata-install 夹具；请 unset 该环境变量后重跑。",
    );
  }

  const endpointOverride = (process.env.NOVEL_STRATA_ENDPOINT ?? "").trim();
  if (!endpointOverride) return;

  let host = "";
  try {
    host = new URL(endpointOverride).hostname.toLowerCase();
  } catch {
    // URL 解析失败时 host 保持空串，走下方非回环端点失败分支。
  }

  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    throw new Error(
      `NOVEL_STRATA_ENDPOINT=${endpointOverride} 不是回环端点，本场景不会触发本机模型发现；` +
        "请 unset 该环境变量后重跑。",
    );
  }
}

async function main() {
  fixtureSetup = fixtures.map((fixture) => ({
    config: { model_name: fixture.modelId, port: fixture.port, host: fixture.host },
    config_file: path.join(modelsDir, fixture.configFile),
    endpoint: `http://${fixture.host}:${fixture.port}/v1`,
  }));
  observations.inherited_env = {
    NOVEL_STRATA_MODELS_DIR: process.env.NOVEL_STRATA_MODELS_DIR ?? null,
    NOVEL_STRATA_ENDPOINT: process.env.NOVEL_STRATA_ENDPOINT ?? null,
  };

  try {
    assertNoInheritedDiscoveryOverride();

    // 先起替身（端口被占快速失败并给出原因），再写 profile 夹具。
    for (const fixture of fixtures) {
      const server = await startFakeStrataEngine(fixture);
      fakeServers.push(server);
      recordStep("fake_engine.started", {
        model: fixture.modelId,
        endpoint: `http://${fixture.host}:${fixture.port}/v1`,
      });
    }

    installFixtures();
    recordStep("fixtures.installed", {
      models_dir: modelsDir,
      config_files: fixtures.map((fixture) => fixture.configFile),
    });

    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    attachNetworkCapture(page);
    page.on("websocket", (webSocket) => {
      webSocket.on("framesent", (event) => recordFrame("sent", event.payload));
      webSocket.on("framereceived", (event) => recordFrame("received", event.payload));
    });
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        consoleMessages.push({ type: message.type(), text: message.text() });
      }
    });
    page.on("pageerror", (error) => {
      pageFailures.push(String(error?.message ?? error));
    });

    await runScenario(page);
    recordStep("scenario.passed");
  } catch (error) {
    failure = error;
    recordStep("scenario.failed", { message: String(error?.message ?? error) });

    if (page) {
      try {
        await screenshot(page, "failure.png");
      } catch (screenshotError) {
        observations.failure_screenshot_error = String(screenshotError?.message ?? screenshotError);
      }
    }

    console.error(`[slice-verify:${sliceId}] failed: ${error?.stack ?? error}`);
  } finally {
    // 收尾顺序：先抓页面网络证据与公开 API 快照（替身仍在线），再关资源、清夹具。
    try {
      observations.local_models_page_responses =
        observations.local_models_page_responses ?? (await collectCapturedLocalModels());
    } catch (error) {
      observations.local_models_page_responses_error = String(error?.message ?? error);
    }

    if (!directLocalModelsProbe && fakeServers.length > 0) {
      try {
        directLocalModelsProbe = await probeLocalModelsApi();
      } catch (error) {
        directLocalModelsProbe = { error: String(error?.message ?? error) };
      }
    }
    observations.direct_local_models_probe = directLocalModelsProbe;

    if (browser) {
      try {
        await browser.close();
        browserClosed = true;
      } catch (error) {
        observations.browser_close_error = String(error?.message ?? error);
      }
    }

    for (const server of fakeServers.slice().reverse()) {
      try {
        await server.close();
        fakeServerClosed += 1;
      } catch (error) {
        observations.fake_server_close_error = String(error?.message ?? error);
      }
    }
    fakeServers = [];

    removeFixtures();

    const cleanup = {
      fake_servers_closed: fakeServerClosed,
      fake_servers_total: fixtures.length,
      fixtures_removed: fixturesRemoved,
      fixtures_dir_removed: fixturesDirRemoved,
      browser_closed: browserClosed,
    };
    observations.cleanup = cleanup;

    const status = failure ? "failed" : "passed";
    recordStep(`cleanup.${status}`);
    try {
      writeFailureDiagnostics();
      writeEvidenceArtifacts(status, cleanup);
    } catch (error) {
      console.error(`[slice-verify:${sliceId}] could not write evidence: ${error?.stack ?? error}`);
    }
  }

  if (failure) {
    process.exitCode = 1;
    return;
  }

  console.log(`[slice-verify:${sliceId}] passed; artifacts: ${artifactDir}`);
}

await main();
