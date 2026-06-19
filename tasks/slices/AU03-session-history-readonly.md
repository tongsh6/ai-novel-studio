# AU03 Session History Readonly / 历史会话只读回看

- 状态：done
- 类型：Acceptance Slice / UI Contract Slice / Persistence Slice
- 启动日期：2026-06-19
- 来源：`docs/design/acceptance/author/AU-03-context.md` SC-AU03-C4、`docs/design/acceptance/SCENARIO-BLUEPRINT.md` P0 作品内会话管理闭环。

## 1. 用户 / 系统目标

作者在当前作品里搜索并打开历史会话时，系统只能展示历史 transcript，不能恢复旧的 loading、pending action、pending adoption 或确认状态；回到当前会话后，当前 active session 的 transcript 和输入能力必须恢复。

## 2. 开工检查

- Contract: `WorkSessionService` / `WorkSessionsController` / `WorkSessionRepo.transcript`、`docs/design/acceptance/author/AU-03-context.md` SC-AU03-C4、`docs/engineering/scenario-acceptance.md`。
- Invariant: 历史 session 是 exited/read-only；旧 pending adoption 不恢复；当前 active session 可返回；会话搜索限定当前 Work。
- Boundary: 切过 `novel_persistence` 种子数据、`novel_web` sessions API、真实 Tauri 工作台 UI、外部验收 harness；不修改生产代码以识别 slice id 或验收开关。
- Consumer: 真实工作台 `WorkspaceChat` 的会话搜索、历史会话只读查看、返回当前会话。
- Proof: `bash scripts/tauri_slice_verify.sh au03-session-history-readonly`、`bash scripts/quality_accept.sh au03-session-history-readonly --surface tauri`、`pnpm --dir frontend test -- native-tauri-verifier`、`bash scripts/quality_manifest_check.sh`。
- Acceptance Driver: `frontend/slice-verify/external-ui-driver.mjs` 从产品外部操作真实页面：搜索“林瑶旧线索”、打开“林瑶旧线索讨论”、检查只读提示和禁用输入，再返回当前会话。产品代码不新增验收感知逻辑。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不改纯工具层 |
| novel_domain | no | 不改领域规则 |
| novel_agent | no | 不改 provider/runtime |
| novel_application | no | 复用已有 WorkSessionService |
| novel_persistence | yes | 新增验收种子，复用 WorkSessionRepo/MemoryLog |
| novel_web | no | 复用现有 sessions API 和日志 |
| frontend | yes | 新增外部验收 driver 和 verifier 单测，不改生产组件 |
| docs/design | yes | 更新 AU-03 / blueprint / README 覆盖口径 |
| quality | yes | 新增场景 manifest 与总表索引 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 补历史只读会话 seed 与外部 UI driver | done | 只操作真实页面和公开 API |
| T2 | 补 verifier 单测与 tauri_slice_verify 入口 | done | 防止证据字段漂移 |
| T3 | 补 quality manifest 和目录索引 | done | 纳入质量运行体系 |
| T4 | 同步 AU-03/blueprint/acceptance README 口径 | done | 避免继续误判 AU-03 为 0/20 |
| T5 | 跑真实 Tauri 验收和质量闭环 | done | 通过后登记证据 |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh au03-session-history-readonly`
- [x] 质量入口：`bash scripts/quality_accept.sh au03-session-history-readonly --surface tauri`
- [x] verifier 单测：`pnpm --dir frontend test -- native-tauri-verifier`
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/ai_static_scan.sh --top 10`

通过证据：

- Tauri 外部验收：`artifacts/slice-verify/au03-session-history-readonly-tauri/summary.json`
- UI frame/state：`artifacts/slice-verify/au03-session-history-readonly-tauri/ui-frames.json`、`ui-state.json`
- 截图：`artifacts/slice-verify/au03-session-history-readonly-tauri/au03-session-history-readonly-external-ui.png`

## 6. 决策日志

- 2026-06-19 — 先补 SC-AU03-C4 的当前可复跑 Tauri checkpoint。历史 artifact 中存在多条 AU-03 证据，但当前 `tauri_slice_verify --list` 未暴露旧 id；本 slice 只把历史会话只读回看重新接入当前质量入口。

## 7. 试行反馈

- 旧文档把多条历史 AU-03 artifact 当成当前可复跑证据，容易误导后续实现判断。AU-03 文档需要区分“历史 artifact 存在”和“当前入口可复跑”。
