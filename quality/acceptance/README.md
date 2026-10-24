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
