# Scenario Acceptance

本目录保存场景化验收 manifest。Manifest 说明验收标准和证据要求，不替代 driver。真实执行仍由外部 Playwright / Tauri 自动化驱动真实页面完成。

## Entrypoints

```bash
bash scripts/quality_accept.sh --list
bash scripts/quality_accept.sh <scenario-id>
bash scripts/quality_accept.sh <scenario-id> --surface browser
bash scripts/quality_accept.sh <scenario-id> --surface tauri
bash scripts/quality_accept.sh e2e-01-full-chain --provider lmstudio
bash scripts/quality_accept.sh --tier pr-smoke
bash scripts/quality_accept.sh --tier nightly --surface tauri
```

## Files

- `scenarios.yml` 是总表。
- `scenarios/README.md` 是单场景 manifest 索引；`scenarios/*.yml` 是单场景 manifest。
- `evidence-schema.json` 描述证据字段。
- `tiers.md` 描述 PR / nightly / release 分层。
- `known-gaps.md` 登记当前不可作为 gate 执行的 blocked 场景，并用 `implementation_missing / driver_stale / evidence_missing / retired / reanchor_pending / credential_blocked` 区分根因类型（B41 CP5）；类型不等于修复，重锚/退役由 B40 承接。
- `fixtures/prose-quality/` 是 VS-00E 质量基线坏样本（CP0 建立），供 CP2 validator / acceptance 对照固定输入衡量质量；见该目录 `README.md`。
- `fixtures/b27-semantic-cases/` 是 B27 §6.1 真实模型语义验收的 20 例案例卡、原始输入快照与旧规则臂 hash（CP0 建立）；不执行 40 episode 门槛、不调模型、不改提示词。见该目录 `README.md`。
- `author-behavior/` 是 B70 冻结的作者行为语料/状态/oracle/覆盖报告格式
- B27 §9 CP3 入口：`b27-request-source-native`（tauri/release-real-llm/blocked，真实模型 scoped 证据批次 cp3c）——外部原生 Tauri M1/M2，供给声明/memory 观察回流/Why-trace/zero-write；复跑需预注册+Strata 单槽资源窗口。
- B70 场景入口：`author-behavior-corpus`（固定回放，pr-smoke/browser）、`author-behavior-explore`（seeded 状态探索，nightly/browser）、`author-behavior-real-llm-subset`（release-real-llm，blocked 预注册入口）；运行 `bash scripts/quality_accept.sh <id> --surface browser`，证据落 `artifacts/slice-verify/<id>/`；覆盖报告/失败缩化/预注册/PR 子集工具见 `scripts/README.md`。
（`author-behavior-*/v1`）：少量人工目标族 + 合成状态矩阵 + 冻结表达（dev/regression/holdout）+ 可机器判卷硬 oracle；不含产品 runtime，不另立 verdict。见该目录 `README.md`；设计语义与实施边界见 `docs/design/acceptance/author-behavior-corpus-and-state-exploration.md`。校验：`node scripts/author_behavior_check.mjs [--report artifacts/author-behavior/<report>.json]`。

## Anti Hooks

Manifest 中的 `anti_hooks` 必须明确声明产品代码不需要验收专用逻辑：

```yaml
anti_hooks:
  product_acceptance_logic_added: false
  data_testid_required: false
  hidden_dom_metadata_required: false
  product_autorun_required: false
```

## Manifest 解析与校验（B41 CP1）

- **标准解析器（唯一）**：manifest 与 `scenarios.yml` 一律经 PyYAML 6.0.3（`scripts/lib/quality/yaml_bridge.py`）解析；非法 YAML、重复键、非单文档直接失败。**禁止**用正则/手写逻辑再实现 YAML 解析（`quality_manifest_check.sh` 与 `quality_accept.sh` 都只经 `scripts/lib/quality/manifest.mjs` 读取 registry）。
- **本地依赖**：`python3 -m pip install 'pyyaml==6.0.3'`。缺失时门禁硬失败并给出安装提示，不静默放行。CI 在 quality-manifest job 内用固定版本 venv 安装。
- **入口**：校验 `bash scripts/quality_manifest_check.sh`；查询 `node scripts/lib/quality/manifest_cli.mjs list|ids-by-tier|field|registry-status`；执行入口 `bash scripts/quality_accept.sh ...` 会先失败即停地跑一次 manifest 校验（失败退出 66）。
- **draft 注册**：不执行的 manifest 必须在 `scenarios.yml` 顶层 `drafts:` 登记 `{id, manifest, reason}`，且 manifest 含 `status_note`。`scenarios/` 下每个 yml 必须被 `scenarios` 或 `drafts` 引用，否则失败；draft 永不执行、永不计 PASS。
- **证据词表 v2（闭集）**：`evidence.required` 只允许 canonical kind（`screenshot, websocket_frames, app_jsonl, turn_result, action_result, ui_state, backend_log, llm_http_log, provider_secrets_metadata, persistence_snapshot, summary_json, replay_api_response, seed_log, export_artifact, progress_jsonl, word_count_json, native_screenshots, native_transport_jsonl, persisted_session, memory_facts, audit_report`）。场景特定文件放 `evidence.required_artifacts`（`artifacts/` 下 repo 相对路径）；按 provider 条件出现的证据用 `evidence.conditional_required: [{kind, when}]`。旧 token 迁移映射见 `tasks/slices/B41-quality-evidence-foundation.md` §6。
- **manifest 状态**：`status: active|blocked`（blocked 必须 `blocked_reason`；draft 只经 `drafts:` 注册）；执行结果状态 `pass|fail|skipped|not_run|evidence_missing` 与退出码见 B41 CP2 与 verdict schema（CP4）。

## 批次执行与退出码（B41 CP2）

```bash
bash scripts/quality_accept.sh --tier <tier> [--surface browser|tauri] [--provider <p>]
```

- **active-only**：`--tier` 只执行 registry `status: active` 的场景；`blocked` 场景记 `skipped` + `reason`（不执行、不计 PASS、不中止整批）。
- **结果分层**：`pass | fail | skipped | not_run | evidence_missing`；runner 成功但无任何证据产物 → `evidence_missing`（exit 67），不得记 PASS。
- **批次汇总**：写出 `artifacts/quality-accept/batches/<tier>[-<surface>]-<UTC>/batch.json`（counts + 每场景 status/reason/artifact_dir）与 `logs/<scenario>.log`（完整输出）。
- **退出码**：`0` pass（批量：无 fail/evidence_missing 且至少 1 个 pass）；`1` fail；`64` usage；`65` blocked（单场景）或空 tier / 整批无执行；`66` manifest/gate 配置错误（执行前校验失败）；`67` evidence_missing；`69` not_run（批量中未执行任何场景）。整批不得因 skipped 变 PASS。
- **单场景**：`bash scripts/quality_accept.sh <id> [--surface ...] [--provider ...]`，退出码同上；blocked 场景返回 65 + reason。

## B41 CP3：E2E 聚合器可信状态

- `scripts/e2e_01_full_chain_check.sh` 的 E1–E13 状态由 `scripts/lib/quality/e2e_status.mjs` 按真实证据计算（CP1 registry + CP4 verdict / legacy summary 回落 + `git_head`/`current` freshness + provider/surface/断言来源匹配），不再硬编码「已验收/已测试」。
- 旧 `summary.json` 存在不等于 PASS：无 `git_head`/`current` 标记的旧证据一律 `stale`。
- E4 `e2e-01-downgrade-real-page` 在 registry 为 blocked：即使旧 summary 存在，聚合也只写 `blocked` + `blocked_reason`，不写已验收；B40 重锚/退役前 aggregate 不会 PASS。
- 聚合 summary 内嵌 `verdict` 使用聚合专有 `schema_version=quality-aggregate/v1`（不是 CP4 `quality-verdict/v2`；blocked 批内记 `skipped`），显式列 `blocked_scenarios/stale_scenarios/evidence_missing_scenarios/not_run_scenarios`。
- 退出码：`0` pass / `1` fail（优先）/ `67` evidence_missing / `65` 整批全 blocked 且无执行 / `69` 全 skipped/not_run / `66` config。
- E10 持久化闭环无独立真实页面 artifact，按 `evidence_missing` 处理（AU-07 cross-reference）；补 artifact 前 aggregate 不会 PASS。

## 证据 verdict v2（B41 CP4）

- **位置**：每次场景运行后写 `artifacts/slice-verify/<scenario-id>/verdict.json`。契约：`quality/acceptance/verdict-schema.json`（JSON Schema draft 2020-12，`schema_version=quality-verdict/v2`；additive，旧证据不改写）。
- **必填**：`schema_version, scenario_id, tier, surface, status, artifact_dir, generated_at, git_head`；`git_head` 取 `git rev-parse HEAD`，无法取得写 `null`（读取方按 stale 处理，不得据此 PASS）。
- **status（执行结果闭集）**：`pass | fail | skipped | not_run | evidence_missing`。`blocked` 是 manifest 状态不是执行结果；批次内 blocked 场景记 `skipped` + `reason`（CLI 退出码 65）。
- **其余字段**：`reason / reason_codes`、`driver / provider / model / actual_model`、`attempt / timeouts / started_at / finished_at / duration_ms`、`artifact_links[{kind,path,role:required|optional|failure|scoped}]`、`evidence_required / evidence_present / evidence_missing`、`mechanism{status,evidence_refs}` 与 `model_behavior{status,evidence_refs}`（机制/模型行为分层，stub 批次只能 `not_applicable`）、`final_refs / failure_refs / scoped_refs`、可选 `batch{id,index,total}`。
- **读取规则（硬约束）**：缺 `verdict.json`、缺 `status` 或结构无效一律 `evidence_missing`（CLI exit 67），**绝不默认 PASS**；旧 `summary.json` 只算 artifact，读取时 `legacy_summary=true` 且 `status=evidence_missing`。
- **PASS 反假绿**：`status=pass` 时 `evidence_required` 每项必须出现在 `evidence_present`（显式空 `evidence_missing` 不能绕过）、`evidence_missing` 为空、`mechanism`/`model_behavior` 必须显式且 ∈ `pass|not_applicable`（unknown/fail 不能 PASS）。
- **B41 入口接线**：`scripts/quality_accept.sh` 在每次运行后经 `scripts/lib/quality/accept_verdict.mjs` 写 verdict：确定性 provider（`slice_verify`）的 pass 记 `mechanism=pass` + `model_behavior=not_applicable`；真实 provider 的 pass 需 B42 的模型行为证据，B41 不写 PASS verdict（读方为 evidence_missing，不冒充）。runner 成功但必需证据缺失时 verdict 降级 `evidence_missing` 且入口 exit 67。
- **生成/读取同源**：唯一实现 `scripts/lib/quality/verdict.mjs`；CLI `node scripts/lib/quality/verdict_cli.mjs read <artifact_dir> | write <artifact_dir> <json> | validate <file>`。`read` 退出码：0 pass / 1 fail / 65 skipped / 67 evidence_missing / 69 not_run；`validate` 有效 0、无效 1；用法错误 64。测试 `node --test scripts/lib/quality/verdict.test.mjs`。

## B42 CP0：机制证据 / 模型行为证据冻结（2026-10-27）

- **两类结果不得互相代签**：机制证据由确定性 provider/runner 证明计划、工具、观察、状态、持久化、恢复、页面操作与采纳边界；模型行为证据只由真实 provider 的自然输入运行证明模型自主求证/使用观察/承认未知。确定性/stub 批次的 `model_behavior` 只能是 `not_applicable`；HTTP 200、局部证据、单次运行、supplied refs、工具日志不得写成模型语义 PASS。
- **冻结参数**：自然输入措辞、provider/model/参数/actual_model、独立重复（关键缺事实场景 ≥2 次且全过）、未参与调词的保留措辞、失败分母（timeout/格式失败入分母）、禁答集、凭据 blocked（永不 PASS）、失败证据只读保留。完整契约见 [B42](../../tasks/slices/B42-model-behavior-evidence-tier.md) §6。
- **additive 版本策略**：B41 `quality-verdict/v2` 冻结不改；B42 新增三份 sidecar：`quality-evidence-chain/v1`、`quality-native-run/v1`、`quality-release-layer/v1`，以 `evidence-schema.json` 的 `$defs` additive 描述（缺 sidecar/字段 = unknown/evidence_missing，不得默认 PASS）。

## B42 CP1：release / release-real-llm 分层结果

```bash
node scripts/lib/quality/release_layer_cli.mjs summarize --tier release [--batch <batch.json>] [--json]
node scripts/lib/quality/release_layer_cli.mjs summarize --tier release-real-llm [--out <dir>]
```

- **接线（B42 CP1，Lead 批准）**：`bash scripts/quality_accept.sh --tier release|release-real-llm` 在写完 `batch.json` 后自动调用 `release_layer_cli summarize`，写 `artifacts/quality-accept/batches/<batch>/release-layer.json`（+ `release-layer.log`）；**不改变既有批次退出码与既有 tier 行为**，release 层错误只告警。fixture 集成测试：`scripts/lib/quality/release_layer_accept.test.mjs`。
- 读 registry + B41 `batch.json` + 每场景 verdict + CP2 证据链 + CP3 原生 run，输出 `quality-release-layer/v1`：counts / layers{mechanism, model_behavior} / separation（`single_verdict_allowed=false`）/ replay 身份 / failure_denominator / blocked·not_run·evidence_missing 列表 / 空 tier 已知事实。
- 退出码：pass `0`、fail `1`、blocked/skipped `65`、evidence_missing `67`、not_run `69`、usage `64`、config（非法 tier/跨 tier batch）`66`。
- **真实 provider passthrough（K5，Lead 裁决）**：runner 成功但 `record_verdict pass` 返回 2（无 B42 模型行为证据）时，单场景 exit `67`、批量记 `evidence_missing`，不写 `passed`、不计 batch PASS（B41 CP4「真实 provider PASS 需模型行为证据」的入口一致化）。
- **当前两个 tier 均 0 场景**（已知事实）：空 tier = `not_run` + `empty_tier` + exit 65，不是 PASS；tier 非空归 B42 CP4（设计已 Accepted；真实运行待产品/driver/预注册/资源前置）。
- 真实模型 PASS 判据：真实 provider 响应正文（非 HTTP 200）、≥2 独立重复全过、未调词保留措辞、model/actual_model/params/driver 可回放、CP2 观察链接无违规、CP3 原生 run 非 fail；缺凭据只能 blocked。

## B42 CP2：求证证据链（quality-evidence-chain/v1）

- 模块：`scripts/lib/quality/evidence_chain.mjs`；sidecar：`evidence-chain.json`（写入拒绝覆盖）。
- **集合关系**：`used_context_refs ⊆ Base refs ∪ 实际观察 refs`（`observed/empty/ambiguous/conflict` 可获信用；`error`=未读取、`stale`=过期、缺 outcome=unknown 均不获信用）；Base 未记录时非法 ref 记 `unresolved`（unknown）而非越界；Base 已记录时越界 → `unbound_ref` 违规。
- **包含与顺序（B42 §13）**：inclusion 只由请求侧同源记录（`provider_calls[].request_observation_refs`，`request_observation_refs_status=recorded`）授予；`time_order` 只证明先后、不授包含信用（`includes_observation=null`）。`observed_in_calls` 只作交叉核对（与请求记录矛盾 → `observation_link_conflict` 违规）。缺失（unknown）与显式空数组（recorded）分开：缺失只算 evidence_missing；显式未包含且场景 required → fail（`observation_not_linked`）。观察晚于后续真实请求 → 违规。used refs 只从产生该自报告的调用（`used_context_refs_provider_call_ref`）请求中实际包含的观察授信，不能借整 run 并集补证；无法定位报告调用 → `used_context_refs_call_unknown`（evidence_missing）。判定从原始字段重算，序列化 links/blockers/violations 缓存不一致 → `evidence_chain_derived_mismatch`（不 PASS）。
- **诚实未知**：未返回 used refs → `used_context_refs=null` + `status=unknown`，不得由 supplied/Base 推导；`preparation_outcome`/`stale_on_restore`/`replay_provider_called` 显式记录，replay 重调 provider 不得作为 replay 信用。
- 历史 artifact（ws frames / native-transport / app-log / llm-calls）可只读读取作验证资产；历史证据缺 Base/outcome/coverage → binding 只能是 unknown/partial（不得冒充 evidence-bound PASS）。测试：`node --test scripts/lib/quality/evidence_chain.test.mjs`。

## B42 CP3：原生 run manifest（quality-native-run/v1）

- 模块：`scripts/lib/quality/native_run_manifest.mjs`；sidecar：`native-run-manifest.json`。
- 扫描一个原生 artifact 目录（兼容 `run/` 嵌套与扁平历史布局），统一输出 run/final/failure/scoped checks/termination/native-transport/AX/DB snapshot/生产指纹/driver/provider/model/scope 与判定：
  - `failure.json` 存在 → fail（即使 final 也存在：`final_failure_coexist`，不得只看 final 写 PASS）；
  - termination 非 0/非 EXIT → fail；checks 失败 → fail；跨来源 identity 冲突 → fail；
  - 无 final 且无 failure（旧 summary 存在）→ evidence_missing；
  - `scope_class=scoped` 可 pass 但 `pass_scope=scoped_scope_only`、`full_matrix_established=false`。
- 测试：`node --test scripts/lib/quality/native_run_manifest.test.mjs`（真实历史目录在 artifacts 缺失时自动跳过）。
