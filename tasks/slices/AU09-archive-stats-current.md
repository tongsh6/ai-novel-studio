# AU09 Archive Stats Current

- 状态：done
- 类型：Acceptance Driver Slice / Archive Read Model Regression
- 启动日期：2026-06-22
- Primary Acceptance File: `docs/design/acceptance/author/AU-09-story-memory.md`
- Affected Acceptance Files: `docs/design/acceptance/system/SU-02-work-switching.md`、`docs/design/acceptance/author/AU-08-reading-mode.md`、`docs/design/acceptance/author/AU-12-author-profile.md`

## 1. 依赖调度说明

| 字段 | 内容 |
|---|---|
| 原 blueprint 位置 | AU-09 故事设定/记忆，位于 AU-08 之后、AU-10 之前 |
| 被提前处理的原因 | 未提前；本轮进入 AU-09 后优先关闭 `SC-AU09-A1` 的 P1 current-runnable driver 缺口 |
| 阻塞场景/文件 | AU-09 A1；同时为 AU-12 档案概览、SU-02 current work isolation、AU-08 TOC/reading cross-reference 提供补充证据 |
| 回填方式 | 回填到 AU-09 A1、quality scenarios、acceptance README、SCENARIO-BLUEPRINT、project ledger 和 slice 索引 |
| 恢复 blueprint 顺序 | A1 已有真实 Tauri evidence；AU-09 剩余 P1 继续登记为 pending inbox / developer replay / multi-type replay；可恢复到 AU-10 覆盖收口 |

## 2. 开工检查

- Contract: `docs/design/acceptance/author/AU-09-story-memory.md` 的 `SC-AU09-A1`；`WorkArchiveService.stats/1`；`WorkspaceChannel.get_work_stats`；`StructurePanel` 作品档案概览。
- Invariant: 档案概览只读取当前 `work_id` 的 accepted character、confirmed/stabilized + recallable memory、结构和草稿统计；不得混入外部作品、non-recallable 事实或固定样例。
- Boundary: 只改 seed、外部 driver、native verifier、quality manifest、docs/tasks/ledger。生产 `frontend/src` 与 umbrella runtime 不改；不新增验收 env/query/localStorage/DOM hook；不把 fixture provider 注册进 production runtime。
- Consumer: 作者在真实 Tauri 工作台从“打开档案”进入作品档案概览、伏笔详情和经验规则 tab。
- Proof: native verifier 单测；真实 Tauri quality acceptance；`quality_manifest_check.sh`；`task_done` 与 static scan 收口。
- Acceptance Driver: `scripts/quality_accept.sh au09-archive-stats-current --surface tauri` 启动真实 Tauri 工作台，选择 seeded work，打开作品档案，校验 websocket/app log 与 UI 统计、详情、规则 tab 一致。产品代码新增验收感知逻辑：no。

## 3. 实现与证据

| 项 | 当前结果 |
|---|---|
| Seed | `scripts/seed_au09_archive_stats_current.exs` 生成 current work、foreign work、accepted character、confirmed recallable 伏笔/规则/灵感、non-recallable 对照、卷/章/场景、accepted + tentative draft |
| 外部 driver | `frontend/slice-verify/external-ui-driver.mjs` 新增 `au09-archive-stats-current`，从真实工作台打开档案概览、伏笔详情和经验规则 tab |
| native verifier | `frontend/slice-verify/native-tauri-verifier.mjs` 新增当前 slice id，复用 archive stats/detail 证据提取与行为断言 |
| quality manifest | `quality/acceptance/scenarios/au09-archive-stats-current.yml` 登记 Tauri entrypoint 与 anti-hooks |
| 真实页面证据 | `artifacts/slice-verify/au09-archive-stats-current-tauri/summary.json` |

关键 evidence：

- `bash scripts/quality_accept.sh au09-archive-stats-current --surface tauri` 已通过。
- `summary.json` 记录 `work_id=978551ab-6aa2-485c-85cf-850079e649e2`，`archive_volumes=1`、`archive_chapters=1`、`archive_memory_items=3`、`archive_drafts_total=2`、`archive_drafts_accepted=1`。
- `ui-state.json` 记录 `context_work_id` 与 `work_id` 相同，且 `channel_*` 计数与 `archive_*` UI 计数一致。
- `archive_detail_kind=memory`、`archive_detail_title=星桥旧账伏笔`，证明伏笔详情从档案列表打开。
- `archive_foreign_excluded=true`，证明 seeded foreign work 事实未混入当前作品档案。

## 4. 剩余缺口矩阵

| 场景 ID / 名称 | 第一轮状态 | 第二轮状态 | 剩余缺口 | 类型 | 优先级 | 当前证据 | 是否应在 AU-09 内关闭 | 建议 checkpoint | 退出标准 |
|---|---|---|---|---|---|---|---|---|---|
| SC-AU09-A1 打开档案看到真实作品全貌 | 部分实现 | 已验收 | 无 | 验收缺口已关闭 | - | `au09-archive-stats-current-tauri` 真实页面证据 | 已关闭 | 保持 quality regression | 满足 |
| SC-AU09-A3 待审核设定入口 | 部分实现 | 部分实现 | pending adoption inbox 与档案入口联动依赖 AU-05 persistent adoption inbox | P1 / cross-file dependency | P1 | AU-09 一轮台账登记 | 否，依赖 AU-05 上游 | `au05-persistent-adoption-inbox` 后回填 | 不阻塞本 checkpoint |
| SC-AU09-D2 开发者 replay 与多类型 UI | 部分实现 | 部分实现 | developer replay、多类型 replay UI、MemoryTrace/StateTrace aggregate 仍依赖 AU-07 trace/replay 后续 | P1 / cross-file dependency | P1 | AU-07 已部分回填旧 turn/partial replay；完整 multi-type 仍缺 | 否，依赖 AU-07 后续 | `au07-multi-type-replay-ui` | 不阻塞本 checkpoint |

二轮退出判断：`SC-AU09-A1` 已有真实页面 evidence，可回填 AU-09 并恢复 blueprint 顺序；`SC-AU09-A3` 与 `SC-AU09-D2` 继续登记为 cross-owner P1，不在本 checkpoint 内伪关闭。
