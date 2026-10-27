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
