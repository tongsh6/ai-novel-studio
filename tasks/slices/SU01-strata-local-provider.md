# SU01 Strata Local Provider / 本地 Strata provider 真实页面验收基建

- 状态：**closed（2026-10-21 首版；2026-10-22 方案修正为 Strata App 统一推理后台并重新实跑 PASS）**——后端 `Provider.Strata` / 前端 ProviderId / Rust provider id 白名单 / 验收基建 / 文档均已交付；当前口径见 §10。
- 类型：System Slice（Provider Runtime）+ Acceptance Infrastructure + UI Contract Slice
- 启动日期：2026-10-21
- 来源：用户定向插单「新增本地 strata provider」
- 所属验收：`docs/design/acceptance/system/SU-01-model-provider.md`
- 验收场景：`quality/acceptance/scenarios/su01-provider-strata-local.yml`（tier: nightly / surface: tauri / default_provider: strata）

## 1. 用户 / 系统目标

作者可以在真实工作台里把模型供应商切到本机 Strata（strata-engine）并正常对话：设置 Dialog 中出现后端 registry 提供的「Strata」选项，默认端点 `http://127.0.0.1:8081/v1`，从真实 Strata `/v1/models` 刷新并选择 `qwen3.8-flash-next-q2_0`，测试连接显示可用，保存后顶栏显示 Strata 与当前模型，下一轮真实对话确实由 Strata 处理且回复可见。

本 slice 聚焦**验收基建与文档**：让上述链路可以由外部自动化在真实页面上重复验证，并且证据不能被命令日志或 UI 文案冒充。产品实现（`NovelAgent.Provider.Strata`、Gateway registry、前端 ProviderId/Dialog 渲染）由并行 teammate 负责，本 slice 不修改 `apps/`、`frontend/src/`、`frontend/src-tauri/src`。

## 2. 开工检查（七问）

- **Contract**：
  - `docs/design/acceptance/system/SU-01-model-provider.md`（provider options / models / config / test 运行时合同与 SU-I1..I4 不变量）
  - `docs/design/foundation/08-provider-abstraction.md`（Provider Abstraction；Domain 不直接调用供应商）
  - `docs/design/tech-stack/05-desktop.md`（Tauri 桌面与 provider 偏好/密钥边界）
  - 新增 `strata` descriptor：`label="Strata"`、`requires_api_key=false`、`supports_api_key/endpoint/thinking/streaming/cancellation=true`；默认端点 `http://127.0.0.1:8081/v1`、默认模型 `qwen3.8-flash-next-q2_0`；思考控制走请求级顶层 `reasoning_effort`（默认关闭 → 发 `"none"`，不发 `thinking` 对象）。
- **Invariant**：
  - Provider 列表只能来自后端 registry（前端不写死供应商/模型），Strata 不做特例。
  - 模型名必须来自供应商实时模型列表，不由作者手输或前端预制。
  - `api_key` 可选：无 Key 请求本机 loopback 服务合法；配置了 `serving.apiKey` 才带 `Authorization: Bearer`。
  - 保存 provider 选择必须改变后续真实 turn 的 runtime 路由；关键证据是 `provider_gateway.complete.done provider=strata` + 相关 turn 的真实 `POST /v1/chat/completions` HTTP 2xx LLM 日志。
  - live 本地依赖不得冒充 CI 确定性场景：scenario 标 nightly，`known_limits` 明确要求本机 Strata 运行，runner 启动前探测 `/models` 并在不可达时快速失败。
  - 产品代码不得新增验收感知逻辑（不读 slice id/query/localStorage，不做自动点击/自动上报）。
- **Boundary**：
  - 本 slice 只改 `scripts/`、`frontend/slice-verify/`、`quality/acceptance/`、`docs/design/acceptance/system/SU-01-model-provider.md`、`tasks/slices/`。
  - **不改**：`apps/`（`NovelAgent.Provider.Strata`、Gateway registry、config 由并行实现者负责）、`frontend/src/`（ProviderId / Dialog 渲染）、`frontend/src-tauri/src/`（provider id 白名单）。
  - `--provider strata` 只在验收脚本/服务启动器里生效；它只是把后端运行时选中 provider 显式注入为 strata，并让 verifier 读取对应 LLM 日志，不属于产品行为开关。
- **Consumer**：真实 Tauri 工作台（模型设置 Dialog → `/api/provider/options|models|test|config` → Gateway → `Provider.Strata` → 聊天 turn）、native verifier 的 evidence/behavior 判定、quality acceptance manifest（nightly gate 素材）。
- **Proof**：
  - 静态：`bash -n` / `node --check` / YAML 解析 / `bash scripts/tauri_slice_verify.sh --list` / `bash scripts/quality_manifest_check.sh`（见 §5）。
  - 真实页面（2026-10-21 已执行 PASS）：`bash scripts/tauri_slice_verify.sh --provider strata su01-provider-strata-local` 通过，`artifacts/slice-verify/su01-provider-strata-local-tauri-strata/summary.json` 记录 ui_state（provider=Strata、默认端点、选中模型、连接测试通过、turn_id、assistant 非空且可见）、behavior 断言、`live_provider`（同 turn LLM 日志 `POST /v1/chat/completions` 2×HTTP 200）。
- **Acceptance Driver**：`frontend/slice-verify/external-ui-driver.mjs` 新增 `driveSu01ProviderStrataLocal(page)`，由 `scripts/tauri_slice_verify.sh --provider strata su01-provider-strata-local` 在真实 Tauri 窗口上运行；产品代码新增验收感知逻辑：**no**。
- **Exploration**：不适用。本 slice 不物化新的创作要素/数据模型（无新 artifact/entity/记忆类型，也无新的探索面工具目录），只是新增一个外部模型 transport 的验收基建；探索面同步律约束的是要素物化 slice，本条不触发。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | |
| novel_domain | no | Domain 不见 provider |
| novel_agent | no（本 slice） | `Provider.Strata` / Gateway registry 由并行实现者负责；本 slice 只读取其日志事件与 registry API |
| novel_application | no | provider_health/options/models/config/test 复用现有代理 |
| novel_persistence | no | |
| novel_web | no | |
| frontend | no（本 slice） | ProviderId / Dialog 渲染由并行实现者负责；本 slice 只驱动真实页面 |
| frontend/src-tauri | no | |
| scripts | yes | `--provider strata` 支持、Runner 注册、Strata 可达性预检 |
| frontend/slice-verify | yes | 新外部 driver + native verifier 注册/证据/行为判定 |
| quality/acceptance | yes | 新 scenario manifest + 总表/README 注册 |
| docs/design/acceptance | yes | SU-01 provider 列表与对账结论登记 |
| tasks/slices | yes | 本文件 + README 索引 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | `--provider strata` 脚本支持 | done | `scripts/tauri_slice_verify.sh`：provider 白名单、`ARTIFACT_SUFFIX=-tauri-strata`、usage/描述、两处 slice allowlist、seed 为空、Strata `/models` 启动前可达性预检；`scripts/slice_verify_server.exs` 增加 `:strata -> Application.get_env(:novel_agent, NovelAgent.Provider.Strata, [])`；`scripts/quality_accept.sh` 的 tauri 路径本就透传 `--provider`，只补 usage 文档 |
| T2 | 新外部 Playwright 场景 `su01-provider-strata-local` | done | `driveSu01ProviderStrataLocal`：真实工作台打开模型设置 → 选 Strata → 断言默认端点 → 刷新真实 `/v1/models` 并选 `qwen3.8-flash-next-q2_0` → 测试连接「连接可用。」→ 保存并切换（Dialog detached、顶栏显示 Strata+模型）→ 发送真实聊天 → 等待非空 assistant 的 `turn_result` 并断言可见，产出 `commonUiState` 证据 |
| T3 | native verifier 注册与判定 | done | `nativeSliceIds`、required events（`channel.join.done`、`channel.user_message.start`、`provider_gateway.complete.start|done`、`channel.user_message.done`、`slice_verify.ui_state.done`）、`findSu01ProviderStrataLocalEvidence`、`su01ProviderStrataLocalBehavior`；`findLiveProviderEvidence` 的 live provider 白名单加入 `strata`；behavior 要求 `--provider strata` 且 LLM 日志存在同 turn 的 `POST /v1/chat/completions` 2xx；`native-tauri-verifier.test.mjs` 补正反例单测 |
| T4 | scenario manifest 注册 | done | `quality/acceptance/scenarios/su01-provider-strata-local.yml`（contract/invariants/user_flow/evidence/assertions/known_limits/anti_hooks、`setup.provider: strata`、tier nightly）+ `scenarios.yml`（`default_provider: strata`）+ `scenarios/README.md` 索引 |
| T5 | 文档 | done | SU-01 对账结论/能力表/证据表/命令/规划表登记；本 slice 文件 + `tasks/slices/README.md` 行 |
| T6 | 真实 Tauri 场景实跑 | **done（2026-10-21 PASS）** | `bash scripts/tauri_slice_verify.sh --provider strata su01-provider-strata-local` 退出 0，verified `turn_id=message_91839ede-6d46-4abe-b4a0-dd13c5b234fc`；`summary.json` 记录 `live_provider={"provider":"strata","request_count":2,"status_codes":[200],"urls":["http://127.0.0.1:8081/v1/chat/completions"]}`、`assistant_reply_visible=true`、`provider_after_switch=strata`、`model_after_switch=qwen3.8-flash-next-q2_0` |

## 5. 验证

静态校验（本阶段已执行，全部通过；`quality_manifest_check` 的失败项是 HEAD 既有问题，见下）：

- [x] `bash -n scripts/tauri_slice_verify.sh && bash -n scripts/quality_accept.sh`
- [x] `node --check frontend/slice-verify/external-ui-driver.mjs && node --check frontend/slice-verify/native-tauri-verifier.mjs`
- [x] `ruby -ryaml -e 'YAML.load_file("quality/acceptance/scenarios.yml"); YAML.load_file("quality/acceptance/scenarios/su01-provider-strata-local.yml")'`
- [x] `bash scripts/tauri_slice_verify.sh --list`（正常启动；Implemented external UI driver slice ids 含 `su01-provider-strata-local`，usage 含 `--provider strata`）
- [x] `grep` 全链路核对：新 slice id 出现在两处 allowlist、usage、描述 case、scenarioMap、required events、scenarios.yml/manifest
- [x] 脚本护栏实测（不启动场景）：`--provider strata <unknown-id>` → exit 64；`--provider bogus-provider su01-provider-strata-local` → exit 64；`NOVEL_STRATA_ENDPOINT=http://127.0.0.1:1/v1 --provider strata su01-provider-strata-local` → exit 65 并给出明确原因（Strata 不可达时不会启动 mix/Tauri）
- [x] `cd frontend && ./node_modules/.bin/vitest run slice-verify/native-tauri-verifier.test.mjs`（218 tests 通过，含新增 Strata evidence/behavior 正反例）
- [x] verifier 合成证据自测：完整 ui_state + required events + `provider_gateway.complete.done provider=strata` + LLM `POST /v1/chat/completions` 200 → evidence/behavior 通过；缺 LLM 日志、`--provider slice_verify`、gateway 走了别的 provider、缺 channel join 均不通过
- [ ] `bash scripts/quality_manifest_check.sh`：新场景相关检查通过；当前整命令 exit 1，唯一 error 是 `frontend/slice-verify/q1c-adopted-content-revision-audit.mjs: real browser driver is not registered in quality/acceptance/scenarios.yml`——该文件与缺失注册在 HEAD 已存在（`git ls-files` 有文件、`git show HEAD:quality/acceptance/scenarios.yml` 无条目），与本 slice 无关，登记给 Lead/Q1c owner 处理

真实页面验收（**2026-10-21 已执行 PASS**）：

```bash
# 前置：本机 Strata 应用运行中，http://127.0.0.1:8081/v1/models 返回 qwen3.8-flash-next-q2_0
curl -s http://127.0.0.1:8081/v1/models
bash scripts/tauri_slice_verify.sh --provider strata su01-provider-strata-local
# 或经 quality acceptance：
bash scripts/quality_accept.sh su01-provider-strata-local --surface tauri
```

执行结果：退出 0；`[tauri-slice-verify] passed: su01-provider-strata-local`；证据目录
`artifacts/slice-verify/su01-provider-strata-local-tauri-strata/` 已产出（见 §6）。

后端 / 前端局部验证（由并行实现者负责，本 slice 不代替）：

```bash
mix test apps/novel_agent/test/novel_agent/provider/strata_test.exs
mix test apps/novel_agent/test/novel_agent/provider/gateway_test.exs
cd frontend && pnpm test -- --run src/lib/__tests__/modelProvider.test.ts
cd frontend/src-tauri && cargo test accepts_local_provider_ids_and_rejects_unknown
```

## 6. 证据路径

- runner 证据目录：`artifacts/slice-verify/su01-provider-strata-local-tauri-strata/`
  - `summary.json`：slice evidence + behavior 断言 + `live_provider`（LLM 日志 2xx 证据）
  - `app-log.json` / `app-log/YYYY-MM-DD.jsonl`：关联 turn 的业务事件
  - `strata-log.json` / `llm-calls/YYYY-MM-DD.jsonl`：真实 `POST /v1/chat/completions` LLM 日志（含 turn_id/provider/status）
  - `ui-state.json`：外部 driver 从真实页面采集的 ui_state（含 turn_id、provider/endpoint/model、连接测试、顶栏、assistant 回复可见性）
  - `ui-frames.json`：真实 websocket 帧（user_message / turn_result）
  - `su01-provider-strata-local-external-ui.png`：真实工作台截图
- scenario manifest：`quality/acceptance/scenarios/su01-provider-strata-local.yml`
- 文档：`docs/design/acceptance/system/SU-01-model-provider.md`（2026-10-21 对账结论）
- **当前状态（2026-10-21 已产出）**：`summary.json` 记录 turn_id `message_91839ede-6d46-4abe-b4a0-dd13c5b234fc`、work_id `87e19c49-f7bf-40ec-b5a4-5362c454abfd`、`provider_selected=strata`、`endpoint_default=http://127.0.0.1:8081/v1`、`strata_model_selected=qwen3.8-flash-next-q2_0`、`connection_test_passed=true`、`assistant_reply_non_empty/visible=true`、`live_provider.request_count=2 / status_codes=[200]`。后端真实适配器探活在 `artifacts/provider-strata/live-probe.log`（health :ok、流式 content "ok"、tool_calls judgment_decision）。

## 7. 诚实边界

1. **依赖本机 live Strata**：scenario 是 nightly/live，不是 CI 确定性场景。需要本机安装并运行 Strata（strata-engine），监听 `127.0.0.1:8081`，并已加载 `qwen3.8-flash-next-q2_0`。`tauri_slice_verify.sh --provider strata` 启动前会探测 `${NOVEL_STRATA_ENDPOINT:-http://127.0.0.1:8081/v1}/models`，不可达时 exit 65 并给出明确原因。
2. **Tauri 场景已实跑（2026-10-21 PASS）**：后端 `Provider.Strata` / Gateway registry / 前端 ProviderId / Rust 白名单已集成；真实 Tauri `su01-provider-strata-local` 由外部 Playwright driver 驱动真实工作台通过，证据见 §6。仍需注意：这是 nightly/live 场景，换机器/换模型需重跑，不得把本机一次 PASS 当成 CI 确定性 gate。
3. **可选 Key 只覆盖离线/适配器层**：本机默认 Strata 服务无鉴权，因此 live 场景只证明 keyless 路径可用；`serving.apiKey` 的 Bearer 分支由 `strata_test.exs` 等适配器测试覆盖，不冒充 live key 场景。
4. **不证明模型质量**：场景只断言 assistant 回复非空且在页面可见、且该 turn 真实走了 Strata 的 `/v1/chat/completions`；不评价回复内容质量。
5. **模型名假设**：断言固定期望 `qwen3.8-flash-next-q2_0`（当前 Strata 默认加载模型）。若本机 Strata 换成别的模型，场景应失败而非静默通过；换模型时同步更新 scenario/driver/verifier 与 SU-01 文档。
6. **`--provider strata` 不是产品开关**：它只作用于验收脚本的运行时注入和 LLM 日志读取；产品代码不知道验收存在，也没有任何 slice id / query / localStorage 分支。
7. **live 场景存在本机模型抖动，需按证据重跑**：第一次实跑 PASS；在代码重构后的复跑中，本机 Strata 对一次强制 `judgment_decision` tool-call 返回了 `finish_reason=length / completion_tokens=0 / content=null` 的空响应（LLM 日志可查），backend 如实记为 `Strata 响应内容为空`（`invalid_response`）并进入 `run_failed`，runner 因无有效证据超时失败——这是本机 live 服务/模型抖动，不是验收造假或产品静默通过。随后 Strata 引擎自行恢复（`/v1/status` loaded=true）并用同一命令重跑 PASS（最终 turn_id `message_91839ede-6d46-4abe-b4a0-dd13c5b234fc`）。该场景不得在 CI 冒充确定性 gate；夜间执行需接受这种可能需要重跑一次的边界。

## 8. 决策日志

- 2026-10-21 — 新增本地 Strata provider 的验收基建。选择：
  - 复用既有 live provider 模式（`--provider lmstudio|deepseek` 的 LLM HTTP 日志证据链），增加第三种 `strata`：`findLiveProviderEvidence` 白名单扩展，证据要求同 turn 的 `POST /v1/chat/completions` 2xx，避免只看 UI 文案或命令日志。
  - 顶栏模型入口当前可见文本是健康状态（`模型已连接` 等），provider/model 在 `title` 里；driver 用真实可见状态文本定位入口、同时读取 `title` 与可见文本做断言（不新增 data-testid）。这兼容既有 health badge 层级收束后的真实 DOM。
  - 场景 tier 定为 nightly/live，并在 manifest `known_limits`、SU-01 文档和本文件三处写明「需本机 Strata 运行」，防止被当 CI 确定性 gate；runner 启动前快速探测，避免失败信息埋进页面错误。
  - seed 显式置空：本场景只需真实工作台默认 seeded work，不注入长会话语义。
  - 未改产品源码；`--provider strata` 与 driver/verifier 都位于验收侧。
- 2026-10-21 — 最终实跑证据：验收首跑 PASS（turn `message_459e93b8-...`）；后端 `list_models` 为清 credo P2 抽取私有 helper 后复跑时，本机 Strata 一次强制 tool-call 返回 0-token 空响应导致 run_failed（见 §7.7），引擎恢复后同一命令重跑 PASS，最终证据 turn `message_91839ede-6d46-4abe-b4a0-dd13c5b234fc`、`live_provider.request_count=2 / status_codes=[200]`。首跑证据目录被复跑覆盖（runner 每次清空 artifact 目录），以最终 PASS 目录为准。

## 9. 试行反馈

- 本 slice 的验收基建严格位于脚本/外部 harness；如果后续要把 Strata 纳入 release gate，必须另立 runner 策略（自托管 Strata 服务或固定 fixture），不能把 nightly/live 场景直接提升为确定性 CI gate。

## 10. 2026-10-22 方案修正（当前口径，作者指令）

作者指令：「修改方案 只一套由 Strata App 管理的推理后台统一连接 `http://127.0.0.1:47831/v1`」。
此前 2026-10-21 的 per-profile 接入（8081/8082 引擎端口、`Strata.LocalModels` 按安装目录
`strata-*.json` 发现 profile、设置页列出 profile 并在选中时把模型与端点原子绑定）已被
本方案取代；对应 `tasks/slices/SU01-strata-local-models.md` 标记 **superseded**，其
`LocalModels` 模块、`GET /api/provider/local-models`、前端 profile 列表与 browser 场景
已移除。

### 当前实现（SSOT）

- **Contract**：`NovelAgent.Provider.Strata` 只连接 Strata App 管理的唯一统一推理后台
  `http://127.0.0.1:47831/v1`；Gateway descriptor `supports_endpoint=false`，设置页不提供
  端点输入框；旧版保存的 per-profile 端点在 Gateway `normalize_provider_config/2` 中被忽略，
  `NOVEL_STRATA_ENDPOINT` 仅作部署侧覆盖。
- **模型**：由 Strata App 管理。统一后台 `GET /v1/models` 返回当前已加载模型
  （`id` + `meta.label` + `aliases`）；设置页刷新后从真实列表选择并保存显式模型 id。
  `NOVEL_STRATA_MODEL` 未配置时 adapter 请求体不带 `model` 字段，由 App 路由到当前模型；
  `usage.model` 取响应真实模型名。模型切换在 App 侧完成后，产品侧重新刷新/选择即可；
  陈旧模型 id 由统一后台 `400 Choose a loaded model ID.` 如实拒绝。
- **Invariant**：只存在一套 Strata 推理后台连接；端点/模型列表必须来自 App 统一后台真实
  数据；前端不写死模型；产品代码无验收感知。
- **Boundary**：`apps/novel_agent`（adapter/Gateway/macro）、config、验收 scripts/driver/
  verifier/scenario、SU-01 与 slice 文档；不改 domain/persistence 主链。
- **Consumer**：真实 Tauri 工作台模型设置 Dialog → `/api/provider/{options,models,test,config}`
  → Gateway → `Provider.Strata` → Strata App 统一后台。
- **Acceptance Driver**：`frontend/slice-verify/external-ui-driver.mjs` 的
  `driveSu01ProviderStrataLocal` + `scripts/tauri_slice_verify.sh --provider strata`。
- **Exploration**：不适用（provider transport 修正，不物化创作要素）。

### 验证（2026-10-22）

- 真实 Strata App 统一后台 live 探活：`health_check` → `:ok`；流式 `Gateway.execute`
  无模型配置时真实返回 `"ok"`（usage model `iq3_s`）；真实 tool-call 返回
  `judgment_decision`；`/v1/models` 返回 `iq3_s` + `meta.label`。
- 真实 Tauri 场景 PASS：
  `bash scripts/tauri_slice_verify.sh --provider strata su01-provider-strata-local`
  （默认端口被用户 stage 占用，使用脚本官方 env `PHOENIX_PORT=4661 VITE_DEV_PORT=5771`）→
  turn `message_f68a2fbf-c01a-442e-9a8c-fef64d703895`，provider options 固定端点
  `http://127.0.0.1:47831/v1`、`supports_endpoint=false`、设置页无端点输入、模型列表
  来自真实 `/v1/models` 并选中 `iq3_s`、连接测试通过、保存切换后真实 turn
  `live_provider.request_count=3 / status_codes=[200]`、assistant 回复可见。
  证据：`artifacts/slice-verify/su01-provider-strata-local-tauri-strata/summary.json`。
- 诚实边界：该场景仍是 nightly/live（依赖 Strata App 在 47831 运行），不是 CI 确定性
  gate；可选 Bearer 路径只由 adapter 单测覆盖；模型名不写死，随 App 当前加载模型变化。

