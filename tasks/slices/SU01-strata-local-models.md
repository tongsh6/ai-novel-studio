# SU01 Strata 本机模型发现 / 模型列表列出本机 Strata 已安装模型

- 状态：**browser 面 closed（2026-10-21，真实工作台 26/26 断言 PASS）；native Tauri 面未闭环（后续 checkpoint，见 §7/§9）**
- 类型：System Slice（Provider Runtime）+ UI Contract Slice + Acceptance Infrastructure
- 来源：作者 2026-10-21 真实使用反馈——模型设置里 Strata 模型列表只有一个（`qwen3.8-flash-next-q2_0`）且「无法连接 Strata」，而本机实际有正在运行的 `IQ3_S`（8082）与 q2_0（8081）两个 Strata profile；作者拍板「加本机 Strata 模型发现」。
- 所属验收：`docs/design/acceptance/system/SU-01-model-provider.md`
- 关联既有 slice：`tasks/slices/SU01-strata-local-provider.md`（2026-10-21 的 Strata provider 接入）

## 0. 问题事实（2026-10-21 排查）

真实链路证据：

- 模型设置 Dialog 的模型下拉只渲染「当前端点 `GET /v1/models`」返回的模型；请求失败时把**已保存/默认模型**（q2_0）当作唯一占位，并在下方显示 `无法连接 Strata`（`OpenAICompatible.models_result/2` 的 connection_refused 文案）。
- 本机 Strata（strata-engine）是**一进程一模型**：8081 = `strata-q2_0.json` → `qwen3.8-flash-next-q2_0`；8082 = `strata-iq3_s.json` → `qwen3.8-flash-next-iq3_s`。因此单端点 `/v1/models` 永远只可能返回该引擎自己的模型（+别名/图像模型）。
- 2026-10-21 23:30:24 IQ3_S 引擎（`http://127.0.0.1:8082/v1`）被内存守护停止；产品默认端点写死 8081 + q2_0，于是既不连、也看不到另一个 profile。
- Strata 安装目录（本机）：`~/.local/share/strata/install`，内含 `strata-q2_0.json`、`strata-iq3_s.json`（字段见 §2）。

结论：单端点实时列表在本机 Strata 场景下不足以表达「本机有哪些模型可用」，需要产品级「本机 Strata 模型发现」，而不是前端硬编码、不是读验收开关。

## 1. 开工检查（七问）

- **Contract**：
  - 既有：`docs/design/acceptance/system/SU-01-model-provider.md`（provider options/models/config/test 运行时合同、SU-I1..I4 不变量）。
  - 新增（本 slice）：本机 Strata 模型发现合同
    - 后端入口：`NovelAgent.Provider.Strata.local_models/1` + `NovelAgent.Provider.Gateway.provider_local_models/1` + `NovelApplication.provider_local_models/1` + `GET /api/provider/local-models?provider=strata`。
    - 发现源：**本机 Strata 安装目录中的 `strata-*.json` profile 配置**（真实产品数据），解析 `model_name` / `port` / `host`；对每个 profile 的 `http://host:port/v1/models` 做真实探活得到 `running`。不读 Strata 私有 API、不扫端口、不硬编码模型名/端口。
    - UI 合同：Strata + 本机回环端点时，模型下拉显示本机已安装 profile（label + `运行中`/`未运行`）；选中带 endpoint 的 profile 时模型与端点**同一动作原子绑定**（endpoint 变成该 profile 的端口）；发现为空/远端端点时回退既有「实时 `/v1/models`」行为。
  - 响应 schema（`GET /api/provider/local-models?provider=strata`，200）：
    ```json
    {
      "ok": true,
      "provider": "strata",
      "models": [
        {
          "id": "qwen3.8-flash-next-iq3_s",
          "label": "qwen3.8-flash-next-iq3_s",
          "endpoint": "http://127.0.0.1:8082/v1",
          "host": "127.0.0.1",
          "port": 8082,
          "running": false,
          "config": "strata-iq3_s.json"
        }
      ]
    }
    ```
    - 未实现本机发现的 provider（lmstudio 等）：200 `{ok: true, provider: "<id>", models: []}`。
    - 未知/缺失 provider：422 `{ok: false, models: [], message, detail}`（与既有 provider 端点错误口径一致）。
- **Invariant**：
  - 供应商列表仍只来自后端 registry（前端不写死 provider）；模型名仍不由作者手输、不由前端预制。
  - 本机模型列表只来自「本机 Strata profile 配置 + 真实端点探活」；不猜测、不伪造 running；探活失败/超时 → `running=false`，不发明模型。
  - 选中 profile 时 model 与 endpoint 必须一起生效；不得出现「模型是 IQ3_S、端点仍是 8081」的半切换状态。
  - 发现失败/目录不存在 → 空列表安静回退既有实时列表，不阻断既有 provider 流程。
  - 产品代码不得新增验收感知逻辑（不读 slice id/query/localStorage、不做自动点击/上报）。
- **Boundary**：
  - 允许改：`apps/novel_agent`（Strata 发现 + Gateway）、`apps/novel_application`（单行代理）、`apps/novel_web`（router/controller + 编码）、`frontend/src`（`modelProvider.ts` / `WorkspaceChat.tsx` / `copy.ts`）、`config/config.exs`、`config/test.exs`（测试环境发现目录注入，见 §3）、`frontend/slice-verify`、`quality/acceptance`、`scripts/slice_verify.sh`（usage 列表）、`docs/design/acceptance`、`tasks/`。
  - 明确不改：domain / persistence / agent 主链；不注册验收 provider；不引入前端新依赖（继续 Zod/Tailwind/Radix/Lucide 既有栈，本 slice 不新增依赖）。
- **Consumer**：真实工作台 → 模型设置 Dialog（`WorkspaceChat`）→ `/api/provider/local-models` → Gateway → `Strata.local_models/1` → 本机 Strata profile 配置与引擎；保存后 `/api/provider/config` → 下一轮真实 turn 使用选中 profile 的端点+模型（由既有 provider 链路保证）。
- **Proof**：
  - 后端：`mix test apps/novel_agent/test/novel_agent/provider/strata_local_models_test.exs`、`gateway_test.exs`、`apps/novel_web/test/novel_web/controllers/provider_controller_test.exs`。
  - 前端：`cd frontend && pnpm typecheck && pnpm lint && pnpm test`。
  - 外部自动化（browser 真实工作台）：`bash scripts/slice_verify.sh su01-strata-local-models`（spec 自起 2 个 OpenAI 兼容本机替身服务 + 向测试发现目录写 2 个 profile 夹具，驱动真实 Dialog 断言"两个模型/运行状态/选中绑定端点/测试连接/保存"）。
  - manuallive（真实数据）：在真实 Strata 安装机上以 `mix run` 调用 `Strata.local_models/1` 断言解析出 q2_0(8081)/iq3_s(8082)，且 running 状态与真实进程一致。
- **Acceptance Driver**：`frontend/slice-verify/su01-strata-local-models.mjs`（Playwright，外部 harness），由 `scripts/slice_verify.sh` 启动隔离 test backend + Vite；场景 manifest `quality/acceptance/scenarios/su01-strata-local-models.yml`。产品代码新增验收感知逻辑：**no**。
- **Exploration**：不适用（非要素物化 slice，不新增 artifact/entity/记忆类型，也无新探索面工具）。

## 2. 后端设计（实现 SSOT）

### 2.1 发现目录解析顺序（`NovelAgent.Provider.Strata.LocalModels`）

1. `opts[:install_dir]`（单测/内部注入）
2. `System.get_env("NOVEL_STRATA_MODELS_DIR")`（运维覆盖，便于不重编译换目录）
3. `Application.get_env(:novel_agent, NovelAgent.Provider.Strata, [])[:models_dir]`（产品配置；test 环境注入确定目录）
4. 平台默认（与 Strata 应用自身默认一致）：
   - POSIX：`Path.join(System.get_env("XDG_DATA_HOME") || Path.expand("~/.local/share"), "strata/install")`
   - Windows：`Path.join(System.get_env("LOCALAPPDATA") || Path.expand("~/AppData/Local"), "Strata/install")`

目录不存在/不可读/不是目录 → 返回 `[]`；任何文件读取/解析错误只跳过该项，绝不 raise。

### 2.2 profile 解析

- 只读 `Path.join(install_dir, "strata-*.json")` 的普通文件。
- JSON object 且 `model_name` 非空字符串、`port` 为 1..65535 整数才收录；否则跳过。
- `host`：非空字符串，默认 `"127.0.0.1"`。
- `endpoint`：`"http://#{host}:#{port}/v1"`。
- `label`：`model_name`（不猜测友好名）。
- `running`：对 `endpoint <> "/models"` 真实 GET（`NovelAgent.Provider.HTTP.get/2`，`receive_timeout: 800, connect_timeout: 500`），`{:ok, 2xx, _}` → true；其它 → false。探活可注入（`:probe` 一元函数）以便单测。
- 并发探活：`Task.async_stream(max_concurrency: 4, timeout: 4_000, on_timeout: :kill_task)`。
- 去重：按 `id`（`model_name`）去重，保持确定性；排序：`running` 优先，其次 `id` 升序。
- 返回 `[%{id, label, endpoint, host, port, running, config}]`（`config` 为配置文件名）。

### 2.3 API 形状

见 §1 Contract。另：
- `Gateway.provider_local_models/1` 只对声明 `local_models/1`（或 `/0`）的 adapter 调用发现，其它 provider 返回空列表；未知 provider 走既有 `unknown provider` 错误。
- `ProviderController.local_models/2` 不落库、不改运行时 provider（与 `/api/provider/models` 同语义）。
- 全部列表条目只含非 secret 的本地配置元数据。

## 3. 测试环境注入（不是验收 hook）

- `config/test.exs` 为本 slice 增加：
  ```elixir
  config :novel_agent, NovelAgent.Provider.Strata,
    ...（与 config.exs 同源写全）,
    models_dir: Path.expand("../tmp/test-strata-install", __DIR__)
  ```
  目的：`mix test` 不依赖开发机真实 Strata 安装目录（否则结果随机器不同漂移）；该目录由 slice-verify spec 在 `tmp/` 写入夹具，不进入产品生产路径。
- 验收/其它环境用 `NOVEL_STRATA_MODELS_DIR` 覆盖（运维能力，非验收开关）。

## 4. 前端设计

- `modelProvider.ts`：
  - 新增 `ProviderLocalModelOption` / `ProviderLocalModelsResponse` 类型与 `listProviderLocalModels(provider)`（`GET /api/provider/local-models?provider=`，错误抛 `Error(message)`，响应做 normalize：id/label/endpoint 非空、running 布尔、port 数字或 null）。
  - 新增纯函数 `isLoopbackProviderEndpoint(endpoint)`（`127.0.0.1` / `localhost` / `::1`），供 Dialog 判定是否走本机发现；导出以便单测。
- `WorkspaceChat.tsx`：
  - 新增 state：`modelProviderLocalModels`、加载/错误消息。
  - `loadModelProviderModels`：既有的实时 `/api/provider/models` 行为保留；当 `provider === "strata"` 且端点为回环地址时并行请求本机发现：
    - 发现非空 → 模型下拉使用本机发现列表（label 后缀 `运行中`/`未运行`），实时列表失败消息不再显示（避免「已发现模型」同时报「无法连接」）；下方显示本机发现 hint。
    - 发现为空 → 完全回退既有实时列表行为（其它 provider 不变）。
  - 选中本机 profile → `model = option.id` 且 `endpoint = option.endpoint` 同一 setState；`按用途指定模型` 的选项也使用同一可用模型集合。
  - 保存禁用条件改用当前可用模型集合长度（发现列表非空时可保存）。
  - 所选 profile `running=false` 时显示 hint（提示先启动对应 Strata 引擎）；不禁止保存（作者可先配置后启动）。
- `copy.ts`：新增用户文案（运行中/未运行/hint/发现失败），不在组件内硬编码。
- 不新增依赖；不内联样式。

## 5. 任务清单

| # | 任务 | 负责 | Status |
|---|---|---|---|
| T1 | 后端：`Strata.LocalModels` 发现模块 + Strata/Gateway/Application/Controller/Router + 测试 + config | backend teammate | **done**（聚焦测试 172/0、compile --warnings-as-errors、arch/xref；真实数据解析出 iq3_s/8082 + q2_0/8081） |
| T2 | 前端：`modelProvider.ts` + `WorkspaceChat.tsx` + `copy.ts` + 单测 | frontend teammate | **done**（typecheck/lint 绿、497/0 前端测试、audit 27、design trace 16） |
| T3 | 验收：browser spec + 场景 manifest + scenarios.yml/README + slice_verify usage | acceptance teammate | **done**（静态校验绿、quality_accept --list 可识别） |
| T4 | 文档：本 slice 登记 `tasks/slices/README.md`、`tasks/NEXT.md`、SU-01 验收文档、决策日志 | Lead | **done** |
| T5 | 集成：全量后端/前端门禁、`quality_manifest_check`、`check_design_trace`、`ai_static_scan` | Lead | **done（带登记项）**：全量后端 1,633/0、前端 497/0、I1/I2/I3/N-NARR/I-CACHE-1 绿、静态扫描仅剩既有 gitleaks（已处置）与 task-done Tauri-manifest 门禁（deferred，见 §9） |
| T6 | 真实页面验收执行 + 证据落盘 | Lead + acceptance | **done（browser 面）**：`bash scripts/slice_verify.sh su01-strata-local-models` exit 0，26/26 断言 PASS；native Tauri 面未跑 |

## 6. 验证

- [x] `mix compile --warnings-as-errors`（COMPILE_OK）
- [x] 聚焦后端测试：`strata_local_models_test.exs` + `gateway_test.exs` + `provider_controller_test.exs`（novel_agent 56/0、novel_web 14/0；provider 全目录 172/0）
- [x] 全量 `mix test`（umbrella 7 app：95+38+215+275+256+624+130 = 1,633 tests / 0 failures）
- [x] `mix xref graph --format cycles --label compile-connected --fail-above 0`（No cycles found）
- [x] `mix run scripts/arch_check.exs`（✅ 通过）
- [x] `cd frontend && pnpm typecheck && pnpm lint && pnpm test`（31 files / 497 tests passed）
- [x] `bash scripts/frontend_audit.sh`（Pass 27 / Warn 0 / Fail 0）
- [x] `bash scripts/check_design_trace.sh`（通过 16 / 失败 0）
- [x] `bash scripts/slice_verify.sh su01-strata-local-models`（退出 0，26/26 断言 PASS，证据见 §8）
- [x] 真实数据手工核对：`mix run -e 'IO.inspect(NovelAgent.Provider.Strata.local_models())'` → iq3_s/8082 + q2_0/8081（当时引擎未运行，running=false 已用 lsof 核对）
- [x] 场景不变量：I1/I2/I3/N-NARR/I-CACHE-1 全 PASS（本次不触主链，仍随全量扫描执行）
- [x] `bash scripts/ai_static_scan.sh --top 10`（最终：17 PASS / 3 FAIL，4 findings、0 touched、0 blocking；FAIL 项均有处置——gitleaks 2 项历史 false_positive/accepted_risk、Credo Nesting 历史 deferred、task-done Tauri-manifest 本 slice deferred，见 §9）
- [ ] native Tauri surface 场景（`tauri_slice_verify.sh su01-strata-local-models`）：**未闭环**（driver/native verifier/scenario 未注册；登记后续 checkpoint）
- [ ] `bash scripts/quality_manifest_check.sh`：新 manifest 零报错；整命令因两个**既有**未登记 driver（`au10-workbench-render-stability.mjs`、`q1c-adopted-content-revision-audit.mjs`，HEAD 基线即存在）exit 1，与本次改动无关

## 7. 诚实边界

- `running` 只证明该 profile 端点 `GET /models` 可达，不证明模型权重/引擎健康或回复质量。
- 发现源是本机 Strata 安装目录的 profile 配置；自定义安装目录目前经 `NOVEL_STRATA_MODELS_DIR` / 应用配置覆盖，尚未做 Strata 应用内设置的自动发现。
- 本 slice 只覆盖 macOS/Linux/Windows 默认目录规则的解析与单测；非 macOS 真实页面未跑。
- 外部自动化使用本机 OpenAI 兼容替身服务 + `tmp/` 夹具；它证明真实工作台 → 真实后端 API → 发现/探活/绑定/保存链路，不证明真实引擎推理。
- 既有 `su01-provider-strata-local`（nightly/live Tauri）仍由原场景负责；本 slice 不替代其 live 证据。

## 8. 证据路径

- `artifacts/slice-verify/su01-strata-local-models/`
  - `summary.json`：`status=passed`、`surface=browser`、`tier=pr-smoke`、26/26 断言、`missing_evidence=[]`、cleanup 全 true
  - `ui-state.json`（逐条断言 + observations/steps）、`ui-frames.json`（4 帧）、`local-models.json`（真实页面 response 200 JSON + direct probe + 夹具）、`backend.log`/`frontend.log`/`app-log/`
  - 截图：`01-dialog-local-models.png`（Strata + 两个本机模型 + 运行中）、`02-dialog-connection-test.png`（iq3_s + 端点 18082 + 「连接可用。」）、`03-workbench-after-save.png`（Dialog 关闭、顶栏模型已连接）
- slice spec：`frontend/slice-verify/su01-strata-local-models.mjs`
- scenario：`quality/acceptance/scenarios/su01-strata-local-models.yml`（scenarios.yml 已注册；entrypoint `scripts/quality_accept.sh su01-strata-local-models --surface browser`）
- 后端真实数据探测：`mix run -e 'IO.inspect(NovelAgent.Provider.Strata.local_models())'`
- 关联回归：既有 `su01-provider-strata-local`（nightly/live Tauri）由原场景负责，本 slice 不替代其 live 证据。

## 9. 收口结果与登记缺口（2026-10-21）

**已闭环（browser 面）**：作者反馈的「Strata 模型列表只有一个 / 看不到本机 IQ3_S」已由本机 profile 发现 + Dialog profile 列表 + 模型/端点原子绑定解决；真实工作台 browser 场景 26/26 断言 PASS；本机真实数据确认可解析 q2_0(8081) 与 iq3_s(8082)。

**未闭环（登记后续 checkpoint）**：

1. **native Tauri surface 场景**：`tauri_slice_verify.sh` 注册 + `frontend/slice-verify/external-ui-driver.mjs` driver + `native-tauri-verifier.mjs` evidence/behavior 均未做；当前外部自动化是 browser 真实工作台（证据等级 Browser slice verify）。`bash scripts/task_done.sh` 的 UI 证据门禁因此无法生成 fresh manifest（`scripts/task_done_check.mjs` 要求 `surface=tauri`），静态扫描该 finding 已按 `deferred` 登记到 `reports/static-scan/dispositions.json`（handling/recommendation 见台账），不是产品缺陷。
2. **真实引擎换 profile 后的真实 turn**：本 slice 只证明「发现 → 选择 → 端点绑定 → 测试连接（替身 /v1/models）→ 保存」；未证明保存 IQ3_S 后下一轮真实 turn 由 8082 引擎处理（该链路由既有 `su01-provider-strata-local` live 场景按单一 profile 覆盖，跨 profile 需真实引擎）。
3. **`quality_manifest_check.sh` 整命令 exit 1**：两个 HEAD 既有未登记 browser driver（`au10-workbench-render-stability.mjs`、`q1c-adopted-content-revision-audit.mjs`），本次改动前即存在（`git show HEAD:quality/acceptance/scenarios.yml` 0 引用），本 slice 新 manifest 零报错。

**静态扫描处置（T5）**：最终 `bash scripts/ai_static_scan.sh --top 10` → 17 PASS / 3 FAIL、4 findings、0 touched、**0 blocking**（exit 0）：touched-file 2 个 Credo AliasUsage 已修复（strata.ex / provider_controller_test.exs）；task-done Tauri-manifest 门禁 deferred（fingerprint 已登记 `reports/static-scan/dispositions.json`，handling/recommendation 见上）；gitleaks 2 项为历史已处置项（false_positive / accepted_risk）；Credo Nesting 为历史 deferred 项。

