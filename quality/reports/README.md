# Reports and Artifacts

Generated reports are not source files.

Local and CI runs may create:

- `artifacts/slice-verify/**`
- `artifacts/scenario-invariants/**`
- `artifacts/static-scan/**`
- `artifacts/smoke-test/**`

CI should upload these as workflow artifacts.

Long-lived disposition records may remain under:

- `reports/static-scan/dispositions.json`

Do not commit one-off screenshots, frames, JSONL logs, or static scan generated reports unless a task explicitly requires a curated fixture.

The only source-controlled file under `artifacts/` should normally be:

- `artifacts/.gitkeep`

Historical smoke-test outputs were removed from the Git index because they are runtime evidence, not curated fixtures.

Do not commit `.gitleaksignore` entries to hide provider tokens or historical credentials. If a leaked credential is found in current branch history and the integration is not in scope, remove the source file or secret from history and re-run `bash scripts/ai_static_scan.sh --top 10 --quick`.
