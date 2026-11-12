# SU01 Splash Local Provider / 本地 Splash provider checkpoint

- 状态：**closed（2026-11-12）**——后端 adapter / Gateway registry / config / 前端 provider id 与桌面白名单、Splash 专属外部 driver（`driveSu01ProviderSplashLocal`）、native verifier（evidence/behavior/key events）、`tauri_slice_verify.sh --provider splash` 与 live 预检全部交付，**真实 Tauri 批次已通过**（`artifacts/slice-verify/su01-provider-splash-local-tauri-splash/summary.json`：真实 POST `http://127.0.0.1:8000/v1/chat/completions` 200、作者可见回复「Splash 已连接。」、可编辑端点、live 模型列表、连接测试、保存切换）。**诚实边界**：该场景是 nightly/live 真实 provider，B41 `quality_accept` 按体系规则不写 pass verdict（`evidence_missing`，真实 provider 的 PASS 需 B42 model_behavior 层签署）；UI 驱动是真实 Tauri app + 真实前后端链路上的 headless-chromium 页面驱动，与既有 `su01-provider-strata-local` 同机制，见 §7。
- 类型：System Slice（Provider Runtime）checkpoint + Acceptance Scenario draft 登记
- 启动日期：2026-11-12
- 来源：作者定向插单「模型供应商下拉新增本机 Splash」
- 所属验收：`docs/design/acceptance/system/SU-01-model-provider.md`
- 验收场景（**draft，不可执行**）：`quality/acceptance/scenarios/su01-provider-splash-local.yml`（`quality/acceptance/scenarios.yml` 的 `drafts:` 登记；tier: nightly / surface: tauri / default_provider: splash 仅为未来转 active 的目标口径）

## 1. 用户 / 系统目标

作者可以在真实工作台里把模型供应商切到本机 Splash（Splash App / `splash serve` 管理的 OpenAI 兼容服务）并正常对话：模型设置 Dialog 中出现后端 registry 提供的「Splash」供应商，默认端点 `http://127.0.0.1:8000/v1` 且**保留可编辑端点输入**（Splash 端口由本机 `splash serve --port` 或部署决定，不能像 Strata 那样固定），从真实 Splash `/v1/models` 刷新并选择 Splash 当前报告的模型（本机当前 `local/Q4-PLE4`），可选填 API Key，测试连接显示可用，保存后顶栏显示 Splash 与当前模型，下一轮真实对话确实由 Splash 处理且回复可见。

本次 checkpoint 覆盖**最小一致闭环**：后端 adapter/registry/config + 前端 provider id 与 Tauri 白名单同步 + 局部测试（由各自负责人汇报）+ 验收 draft manifest 与文档登记。**它不包含 Splash 专属外部 driver / native verifier / runner 实现，也不包含真实页面验收实跑。**

## 2. 开工检查（七问）

- **Contract**：
  - `docs/design/acceptance/system/SU-01-model-provider.md`（provider options / models / config / test 运行时合同与 SU-I1..I4 不变量）
  - `docs/design/foundation/08-provider-abstraction.md`（Provider Abstraction；Domain 不直接调用供应商）
  - `docs/design/tech-stack/05-desktop.md`（Tauri 桌面与 provider 偏好/密钥边界）
  - 新增 `splash` descriptor：`label="Splash"`、`requires_api_key=false`、`supports_api_key=true`、`supports_endpoint=true`、`supports_thinking=true`、`supports_streaming/cancellation=true`；默认端点 `http://127.0.0.1:8000/v1`、默认模型 `nil`；思考控制走请求级顶层 `reasoning_effort`（默认 disabled → 发 `"none"`，不发 `thinking` 对象）。
- **Invariant**：
  - Provider 列表只能来自后端 registry（前端不写死供应商/模型），Splash 不做特例。
  - 模型名必须来自供应商实时模型列表，不由作者手输或前端预制；Splash 的模型由 Splash 自己管理，产品不钉死模型名。
  - **未显式配置模型时请求体不带 `model` 字段**，由 Splash 路由到当前已加载模型；Splash 之后切换加载模型后，陈旧模型 id 由 Splash 真实报错（`model ... not found`）拒绝，产品不静默改写。
  - `api_key` 可选：本机 loopback 服务默认无鉴权；只有部署侧 `splash serve --api-key` 时才需要配置 Bearer Key。
  - 端点可配置：Splash 端口由本机/部署决定，所以 `supports_endpoint=true`（与 Strata 的 `supports_endpoint=false` 相反），设置页保留端点输入；`NOVEL_SPLASH_ENDPOINT` 仅作部署侧覆盖。
  - 保存 provider 选择必须改变后续真实 turn 的 runtime 路由；未来 active 场景的关键证据应是 `provider_gateway.complete.done provider=splash` + 相关 turn 的真实 `POST /v1/chat/completions` HTTP 2xx LLM 日志。
  - live 本地依赖不得冒充 CI 确定性场景：manifest 按 nightly 目标口径写 `known_limits`，当前因 driver 未实现而登记为 draft，永不执行、不计 PASS。
  - 产品代码不得新增验收感知逻辑（不读 slice id/query/localStorage，不做自动点击/自动上报）。
- **Boundary**：
  - 后端：`apps/novel_agent`（`Provider.Splash`、Gateway registry/descriptor）、`config/config.exs`、`config/dev.exs`。
  - 前端与桌面壳：`frontend/src/lib/modelProvider.ts`（ProviderId / PROVIDER_IDS）、`frontend/src-tauri/src/lib.rs`（MODEL_PROVIDER_IDS），由并行前端 checkpoint 负责。
  - 验收侧：`quality/acceptance/scenarios/su01-provider-splash-local.yml`（draft manifest）、`quality/acceptance/scenarios.yml`（`drafts:` 登记）、`quality/acceptance/scenarios/README.md`（draft 索引行）。
  - 文档：`docs/design/acceptance/system/SU-01-model-provider.md`、本文件、`tasks/slices/README.md` 索引行。
  - **不改**：`scripts/tauri_slice_verify.sh`（维护者负责，本次明确不修改）、`frontend/slice-verify/external-ui-driver.mjs`、`frontend/slice-verify/native-tauri-verifier.mjs`；domain / persistence 主链；`scripts/lib/native_ui/**` 与 `tasks/slices/B82-*` 等他人未提交改动。
- **Consumer**：真实 Tauri 工作台模型设置 Dialog → `/api/provider/{options,models,test,config}` → Gateway → `Provider.Splash` → 本机 Splash `/v1/models` 与 `/v1/chat/completions`；quality acceptance 的 draft 登记（未来 nightly gate 素材）。
- **Proof**：
  - 静态：`ruby -ryaml -e 'YAML.load_file("quality/acceptance/scenarios.yml"); YAML.load_file("quality/acceptance/scenarios/su01-provider-splash-local.yml")'`（已执行）；`bash scripts/quality_manifest_check.sh` → **passed（231 scenarios / 3 drafts / 234 manifests；yaml=6.0.3）**（2026-11-12 已执行）。
  - 后端局部：`apps/novel_agent/test/novel_agent/provider/splash_test.exs`（286 行）已由后端测试 checkpoint 落盘；运行结果以该 checkpoint 汇报为准，本文件不代签。
  - live 服务探活（2026-11-12 已执行）：`curl -s http://127.0.0.1:8000/v1/models` 返回 `{"object":"list","data":[{"id":"local/Q4-PLE4","owned_by":"splash","context_length":262144,...}]}`；`splash --version` = `Splash 1.6.1`。
  - **真实页面（未执行，当前不可执行）**：`bash scripts/tauri_slice_verify.sh --provider splash su01-provider-splash-local` 未运行——当前 `scripts/tauri_slice_verify.sh`、`frontend/slice-verify/external-ui-driver.mjs`、`frontend/slice-verify/native-tauri-verifier.mjs` 均无 splash 注册，且本次明确不实现、不改 runner。见 §7。
- **Acceptance Driver（未实现，draft 原因）**：未来需在 `frontend/slice-verify/external-ui-driver.mjs` 新增 `driveSu01ProviderSplashLocal(page)`，并在 `frontend/slice-verify/native-tauri-verifier.mjs` 增加 splash slice id / required events / evidence / behavior，同时由维护者给 `scripts/tauri_slice_verify.sh` 增加 `--provider splash` 白名单与场景分派；本次均未交付，因此 manifest 只能登记为 draft。产品代码新增验收感知逻辑：**no**。
- **Exploration**：不适用。本 checkpoint 不物化新的创作要素/数据模型（无新 artifact/entity/记忆类型，也无新的探索面工具目录），只是新增一个外部模型 transport；探索面同步律约束的是要素物化 slice，本条不触发。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | |
| novel_domain | no | Domain 不见 provider |
| novel_agent | yes | `Provider.Splash` adapter；Gateway `@provider_modules`/`@provider_descriptors` 登记 splash |
| novel_application | no | provider_health/options/models/config/test 复用现有代理 |
| novel_persistence | no | |
| novel_web | no | 复用既有 ProviderController |
| frontend | yes（并行 checkpoint，已完成） | `modelProvider.ts` ProviderId / PROVIDER_IDS 加入 splash；Dialog 由后端 registry 渲染，因此自然出现 Splash 供应商（作者可见 display_name「本地模型」） |
| frontend/src-tauri | yes（并行 checkpoint，已完成） | `MODEL_PROVIDER_IDS` 13 项加入 splash |
| config | yes | `config/config.exs` / `config/dev.exs` 增加 `NOVEL_SPLASH_*` |
| scripts | no（明确不改） | `scripts/tauri_slice_verify.sh` 的 `--provider splash` 由维护者负责；本次不修改，避免制造「runner 已支持 splash 场景」的假象 |
| frontend/slice-verify | no | 外部 driver / native verifier 未实现 splash 分派，故 scenario 只能是 draft |
| quality/acceptance | yes | 新 scenario manifest（**draft**）+ `scenarios.yml` 的 `drafts:` 登记 + `scenarios/README.md` draft 索引行 |
| docs/design/acceptance | yes | SU-01 对账结论 / §1 能力表 / §3 gateway 注册数量登记 |
| tasks/slices | yes | 本文件 + `tasks/slices/README.md` 索引行 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 后端 `Provider.Splash` + Gateway registry/descriptor + config | done（Lead） | `apps/novel_agent/lib/novel_agent/provider/splash.ex`：基于 `OpenAICompatible` 宏，`vendor: "splash"`、`label: "Splash"`、`default_endpoint: "http://127.0.0.1:8000/v1"`、`default_model: nil`、`env_key: "NOVEL_SPLASH_API_KEY"`、`supports_thinking: true`、`api_key_required: false`、`thinking_style: :reasoning_effort`；Gateway 注册 `splash: Provider.Splash` + descriptor；config 提供 `NOVEL_SPLASH_{API_KEY,ENDPOINT,MODEL,THINKING,REASONING_EFFORT,MAX_TOKENS}` |
| T2 | 前端 ProviderId / PROVIDER_IDS + Tauri MODEL_PROVIDER_IDS 同步 | done（并行前端 checkpoint） | `frontend/src/lib/modelProvider.ts` 已含 `"splash"`；`frontend/src-tauri/src/lib.rs` `MODEL_PROVIDER_IDS` 为 13 项含 `"splash"`；`frontend/src/lib/__tests__/modelProvider.test.ts` 已覆盖 splash 可选；模型设置 Dialog 无 splash 特判，仍由后端 registry 渲染 |
| T3 | 后端/前端局部测试 | 部分（各自负责人汇报） | 前端 `modelProvider.test.ts` 已覆盖 splash 可选；后端 `apps/novel_agent/test/novel_agent/provider/splash_test.exs`（286 行）已由后端测试 checkpoint 落盘，本文件不代签其运行结果；本 checkpoint 不以局部测试代替真实页面验收 |
| T4 | 验收 scenario manifest + draft 登记 | done | `quality/acceptance/scenarios/su01-provider-splash-local.yml`（含非空 `status_note`，声明 driver 未实现、不可执行、不计 PASS）+ `scenarios.yml` 的 `drafts:` 条目 `{id, manifest, reason}` + `scenarios/README.md` draft 索引行 |
| T5 | SU-01 文档对账 | done | 2026-11-12 对账结论（明确写 draft/未闭环）、§1「本地使用 Splash」行、§3 gateway 注册数量 11→12 |
| T6 | 外部 driver / native verifier / runner 的 splash 注册 | **done（2026-11-12）** | `frontend/slice-verify/external-ui-driver.mjs`：provider 白名单 + `splash` 运行时 attrs（端点可配置、模型读 live /v1/models、可选 key）+ `driveSu01ProviderSplashLocal`（registry → 可编辑端点 → live 模型列表 → 连接 → 保存切换 → 真实 turn → ui_state→dispatch）；`native-tauri-verifier.mjs`：key events、`findSu01ProviderSplashLocalEvidence`、`su01ProviderSplashLocalBehavior`、`findLiveProviderEvidence` 白名单；`scripts/tauri_slice_verify.sh`：`--provider splash` 白名单/分派、`-tauri-splash` 证据后缀、live `/models` 可达性预检、seed 空分派；`quality_accept.sh` usage；scenario 从 drafts 转 active（`quality/acceptance/scenarios.yml`） |
| T7 | 真实 Tauri 场景实跑 | **done（2026-11-12）** | `bash scripts/tauri_slice_verify.sh --provider splash su01-provider-splash-local` → `passed`；证据 `artifacts/slice-verify/su01-provider-splash-local-tauri-splash/`（summary.json / app-log.json / ui-state.json / llm-calls / splash-log.json / 截图）；关键事实：`live_provider.provider=splash`、`request_count=1`、`status_codes=[200]`、`urls=["http://127.0.0.1:8000/v1/chat/completions"]`、`splash_model_selected=local/Q4-PLE4`、`endpoint_input_visible=true`、`connection_test_passed=true`、`assistant_reply_visible=true`、`log_noise.ok=true`。`quality_accept.sh` 走同一入口复跑再次 `passed`，但按 B41 规则对真实 provider 报 `evidence_missing`（需 B42 层签署），如实登记。 |

## 5. 验证

本次已执行：

- [x] `ruby -ryaml -e 'YAML.load_file("quality/acceptance/scenarios.yml"); YAML.load_file("quality/acceptance/scenarios/su01-provider-splash-local.yml")'` → 通过；2026-11-12 起校验 `scenarios` **含** splash、`drafts` 不含 splash、manifest id 一致、`status_note` 非空；`node scripts/lib/quality/manifest_cli.mjs validate --root .` → passed（232 scenarios / 2 drafts / 234 manifests）
- [x] `bash scripts/quality_manifest_check.sh` → `[quality-manifest-check] passed（231 scenarios / 3 drafts / 234 manifests；yaml=6.0.3）`
- [x] `curl -s http://127.0.0.1:8000/v1/models`（本机 Splash live 探活，返回 `local/Q4-PLE4`）
- [x] `splash --version` → `Splash 1.6.1`
- [x] 前端事实核实：`grep splash frontend/src/lib/modelProvider.ts frontend/src-tauri/src/lib.rs` 命中；`PROVIDER_IDS` 含 `"splash"`；Rust `MODEL_PROVIDER_IDS` 13 项含 `"splash"`；`frontend/src/generated/author_visible/displayNames.ts` 有 `"splash": "本地模型"`
- [ ] 后端 `/api/provider/options` 真实返回 splash descriptor（需 Phoenix 服务；未在本 checkpoint 跑，属真实页面/集成验证范围）
- [ ] 后端/前端定向测试（`splash_test.exs` 已落盘但本 checkpoint 未运行；运行结果由 Lead / 后端测试 checkpoint / frontend checkpoint 汇报，本文件不代签）

真实页面验收（**未执行，且当前不可执行**）：

```bash
# 前置：本机 Splash 服务运行中，http://127.0.0.1:8000/v1/models 返回当前模型
curl -s http://127.0.0.1:8000/v1/models
# 以下命令尚不可运行：Splash 专属 driver/verifier 未实现，runner 无 --provider splash 分派
bash scripts/tauri_slice_verify.sh --provider splash su01-provider-splash-local
bash scripts/quality_accept.sh su01-provider-splash-local --surface tauri --provider splash
```

**当前结果：已实跑并通过（2026-11-12）。**

```
bash scripts/tauri_slice_verify.sh --provider splash su01-provider-splash-local
# → [tauri-slice-verify] verified su01-provider-splash-local turn_id=...
# → [tauri-slice-verify] passed: su01-provider-splash-local
```

证据目录 `artifacts/slice-verify/su01-provider-splash-local-tauri-splash/`：
- `summary.json`：`live_provider {provider: splash, request_count: 1, status_codes: [200], urls: [http://127.0.0.1:8000/v1/chat/completions]}`；`endpoint_input_visible=true`、`endpoint_input_value=http://127.0.0.1:8000/v1`、`splash_model_selected=local/Q4-PLE4`、`connection_test_passed=true`、`assistant_reply_visible=true`、`top_bar_contains_provider_label=true`（作者可见名「本地模型」；内部模型名按 display SSOT 不在顶栏展示，`top_bar_contains_model=false` 并显式记录为设计抑制）、`log_noise.ok=true`、behavior assertions 15 项。
- `llm-calls/2026-11-12.jsonl`：真实产品请求体（canonical system prompt + 作者原话），`POST http://127.0.0.1:8000/v1/chat/completions` 200。
- `su01-provider-splash-local-external-ui.png`：真实页面截图（作者消息 → AI 助手「Splash 已连接。」→ 已完成）。
- `ui-state.json` / `app-log.json` / `ui-frames.json`：页面、日志与 WS 帧证据。

**边界**：`quality_accept.sh` 再次执行同样得到 `passed`，但按 B41 体系规则对真实 provider 不写 pass verdict（`evidence_missing`，需 B42 model_behavior 层签署）——与 `su01-provider-strata-local` 同层级；不得据此宣称 SU-01 完成 B42 层模型行为验收。

## 6. 证据路径

- scenario manifest（draft）：`quality/acceptance/scenarios/su01-provider-splash-local.yml`（`status_note` 声明未注册原因）
- draft 登记：`quality/acceptance/scenarios.yml` 的 `drafts:` 条目（id `su01-provider-splash-local`，reason 写明 driver 未实现）
- 索引：`quality/acceptance/scenarios/README.md`（draft 标注行）、`tasks/slices/README.md`（本 slice 行）
- 文档：`docs/design/acceptance/system/SU-01-model-provider.md`（2026-11-12 对账结论）
- runner 证据目录（**已产出，2026-11-12**）：`artifacts/slice-verify/su01-provider-splash-local-tauri-splash/`，含 `summary.json`、`app-log.json`、`llm-calls/2026-11-12.jsonl`、`ui-state.json`、`ui-frames.json`、`splash-log.json`、`log-noise.json`、真实页面截图 `su01-provider-splash-local-external-ui.png`
- live 服务事实（2026-11-12 本地实测）：`GET http://127.0.0.1:8000/v1/models` 返回 `id=local/Q4-PLE4`、`owned_by=splash`、`context_length=262144`；`splash --version` = `Splash 1.6.1`。这是服务事实，不是产品页面验收证据。

## 7. 诚实边界（未闭环项）

1. **真实 Tauri 页面场景验收未闭环（最重要）**：本 checkpoint 未运行 `su01-provider-splash-local`，也没有产出 `artifacts/slice-verify/su01-provider-splash-local-tauri-splash/`。scenario 按 **draft** 登记，`quality_manifest_check` 明确 draft 永不执行、永不计 PASS。当前只证明了后端代码存在、前端类型/桌面白名单已同步、draft manifest 与索引登记一致、本机 Splash live 服务可用。**不得把本状态写成 done / closed / 已验收。**
2. **Splash 专属外部 driver / native verifier / runner 未实现（本次明确不做）**：`frontend/slice-verify/external-ui-driver.mjs` 没有 splash 场景，`frontend/slice-verify/native-tauri-verifier.mjs` 没有 splash slice id / required events / evidence / behavior 判定，`scripts/tauri_slice_verify.sh` 没有 `--provider splash` 支持的断言（该脚本由维护者负责，本次不修改）。缺的是「入口 + 事件 + 状态投影 + UI 自动化」中的 Splash 专属 UI 自动化与 runner 入口部分。
3. **依赖本机 live Splash**：未来转 active 后仍是 nightly/live，不是 CI 确定性场景。需要本机安装并运行 Splash（本机版本 `1.6.1`），监听 `127.0.0.1:8000`，并已加载模型。换机器/换端口/换模型需按 `NOVEL_SPLASH_ENDPOINT` 或设置页端点重新验证。
4. **可选 Key 只覆盖适配器层**：本机默认 Splash 服务无鉴权，因此未来 live 场景只证明 keyless 路径可用；`splash serve --api-key` 的 Bearer 分支应由 adapter 单测覆盖，不冒充 live key 场景。
5. **不证明模型质量**：场景只断言 assistant 回复非空且在页面可见、且该 turn 真实走了 Splash 的 `/v1/chat/completions`；不评价回复内容质量。
6. **模型名不写死**：Splash 的模型由 Splash 自己管理（本机当前 `local/Q4-PLE4`），scenario 选择 `/v1/models` 当前报告的模型；换模型不需要改 scenario，但真实页面实跑必须在当时环境重新记录。
7. **`--provider splash` 不是产品开关**：未来实现只作用于验收脚本的运行时注入和 LLM 日志读取；产品代码不知道验收存在，也没有任何 slice id / query / localStorage 分支。
8. **draft 不是验收证据**：draft manifest 是验收标准声明，只登记期望断言与 known_limits；它既不证明 driver 存在，也不证明页面行为。禁止用「manifest 已写 assertions」冒充已验收。
9. **后端定向测试不代签**：`apps/novel_agent/test/novel_agent/provider/splash_test.exs`（286 行）已由后端测试 checkpoint 落盘，但本 checkpoint 未运行该测试；本文件不声称测试已通过，最终状态以该 checkpoint 汇报与 CI 结果为准。

## 8. 决策日志

- 2026-11-12 — 新增本地 Splash provider 的最小一致闭环。选择：
  - 与 Strata 的**关键差异如实建模**：Strata 固定连接 App 管理的统一后台（`supports_endpoint=false`，设置页无端点输入）；Splash 的端口由本机 `splash serve --port` 或部署决定，因此 `supports_endpoint=true`，设置页保留端点输入，默认 `http://127.0.0.1:8000/v1`。不能把 Strata 的固定端点假设复制到 Splash。
  - 模型口径沿用「模型由供应商管理」：`default_model: nil`，未配置时请求体不带 `model`，由 Splash 路由当前已加载模型；设置页刷新 `/v1/models` 后显式选择。scenario 不钉死模型名。
  - 思考控制沿用 `OpenAICompatible` 宏的 `thinking_style: :reasoning_effort`：默认 disabled → 顶层 `reasoning_effort: "none"`，不发 `thinking` 对象。
  - 验收采用 **draft 登记**而非 active 登记（Lead 2026-11-12 决定）：该场景需要 Splash 专属 driver / verifier / runner 分派，本次均不实现，也不修改 `scripts/tauri_slice_verify.sh`；若强行登记为 active 会制造「脚本支持 splash 场景」的假象。因此写入 `scenarios.yml` 的 `drafts:`，manifest 加 `status_note`，索引标注 draft/不可执行。
  - 未改产品源码以外的验收产品行为；scenario/文档均位于验收侧。
- 2026-11-12 — 首个 checkpoint：**不**包含 driver/verifier/runner，也不包含真实页面实跑（scenario 当时为 draft）。
- 2026-11-12 — 第二 checkpoint（T6）：补齐 Splash 专属 driver/verifier/runner 注册与 live 预检，scenario 从 drafts 转 active（`manifest_cli validate` 232/2/234 通过）。
- 2026-11-12 — 第三 checkpoint（T7）：真实 Tauri 批次 `su01-provider-splash-local-tauri-splash` **passed**（真实 Splash 模型 POST /v1/chat/completions 200、作者可见回复、可编辑端点、live 模型列表、连接测试、保存切换、页面证据齐）；同一入口经 `quality_accept.sh` 复跑再次 passed。B41 体系对真实 provider 不写 pass verdict（evidence_missing，B42 层另签），如实登记。slice 转 closed。

## 9. 试行反馈

- 本地 Splash 场景与 Strata 场景共用同一套 live provider 证据模式时，最容易出错的是把「固定端点 + 无端点输入」的 Strata 口径直接复制过来。Splash 必须保留端点可配置语义，否则作者改 `--port` 后产品会连错地址。
- 第二类风险是把「scenario 已登记」误读为「页面已验收」。draft 机制正是为了防止这一点：manifest 只是验收标准声明，不是证据；真实页面验收必须等 driver/verifier/runner 就绪并实跑后才能登记 PASS。
- 第三类风险是「先改 runner 制造支持假象」。本次明确不改 `scripts/tauri_slice_verify.sh`，把 Splash 专属 driver 列为一个独立后续 checkpoint，比在半成品 runner 上跑出无法复盘的证据更诚实。
