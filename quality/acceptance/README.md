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
- `known-gaps.md` 登记当前不可作为 gate 执行的 blocked 场景。
- `fixtures/prose-quality/` 是 VS-00E 质量基线坏样本（CP0 建立），供 CP2 validator / acceptance 对照固定输入衡量质量；见该目录 `README.md`。
- `fixtures/b27-semantic-cases/` 是 B27 §6.1 真实模型语义验收的 20 例案例卡、原始输入快照与旧规则臂 hash（CP0 建立）；不执行 40 episode 门槛、不调模型、不改提示词。见该目录 `README.md`。

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
