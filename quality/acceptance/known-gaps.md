# Known Acceptance Gaps

本文件登记已经进入 manifest、但当前不能作为质量 gate 执行的场景。Known gap 不是通过状态，也不能进入 `pr-smoke`。

## p1-chapter-plan-minimum

- Status: blocked
- Tier: `known-gap`
- Surface: `tauri`
- Driver: `frontend/slice-verify/external-ui-driver.mjs`
- Entrypoint: `scripts/quality_accept.sh p1-chapter-plan-minimum --surface tauri`
- Failure fact: actual turn_result currently reports `chapter_count=1` while manifest/driver expect `chapter_count=12`.
- Last observed behavior: the external Tauri driver receives `plot_outline / outline_draft`, but the generated pending artifact contains one item instead of a 12-chapter plan.
- Gate rule: this scenario must not be listed as `pr-smoke` until the real product chain produces and verifies the 12-chapter plan without product-side acceptance hooks.

## au02-candidate-continuation

- Status: blocked
- Tier: `known-gap`
- Surface: `browser`
- Driver: `frontend/slice-verify/au02-candidate-continuation.mjs`
- Entrypoint: `scripts/quality_accept.sh au02-candidate-continuation --surface browser`
- Failure fact: browser driver currently fails because candidate continuation did not send `candidate_selection`.
- Gate rule: this scenario must not be listed as `pr-smoke` until the browser driver and real workbench action path agree on the externally observed event.
