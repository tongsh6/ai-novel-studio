# Scripts Index

本目录是项目内可复跑工程脚本入口。脚本应只服务构建、验收、扫描、开发启动、seed 或调试，不作为设计真源；设计和任务仍登记到 `docs/design/` 与 `tasks/`。

## 子目录

| 路径 | 角色 |
|---|---|
| `lib/` | 被多个脚本复用的 helper（shell + driver 模块）；原生 UI 驱动见 [`lib/native_ui/`](lib/native_ui/README.md)。 |
| `scenario_invariants/` | I1/I2/I3、N-NARR 与 I-CACHE 前缀共享度量 driver。 |
| `model_contracts/` | [模型契约索引](model_contracts/README.md)：计划/判断 MBC、VS-00I 真实单调用缓存与独立控制样本与原生 HTTP/SSE 证据，支持 Gateway 注册的真实 Provider；exit 65=凭据/环境阻塞。 |

## 顶层脚本

| 文件 | 角色 |
|---|---|
| `adr_trace.exs` | **ADR 追溯硬门禁（B13a）**：校验每个 Accepted ADR 的 `## enforced_by` 实装证据清单存在且引用路径有效；缺失/空清单/坏引用 exit 1。Proposed/Superseded/Deferred 不参与门禁。CI `backend` job 已强制运行。 |
| `ai_static_scan.sh` | AI 静态扫描统一入口。 |
| `ai_static_scan_report.mjs` | 静态扫描报告生成器。 |
| `arch_check.exs` | Umbrella 架构边界检查。 |
| `before-tauri-dev.sh` | Tauri `beforeDevCommand` 启动 Vite 的入口。 |
| `build_sidecar.sh` | Tauri sidecar 构建辅助。 |
| `check_coverage.sh` | 覆盖率检查入口。 |
| `check_design_trace.sh` | 前端组件设计追溯检查。 |
| `check_log_noise.sh` | **业务日志噪声静态门禁（B13b BB-10 / ADR-0018 §6）**：扫生产 lib 的 `Logger.warning`，只允许既有 17 处 provider 适配器 unknown-error 分支（allowlist 显式登记）；新增 warning exit 1。CI `backend` job 强制运行；运行时 per-base-turn 行数/error 级断言由 Tauri verifier `log_noise` 通用断言承担。 |
| `chapter_identity_audit.exs` | **B25 CP0 章节身份历史数据审计（只读）**：扫 chapters 的重复 `(work_id,title)` / 重复 `(work_id,seq)` / 空 title，输出 `artifacts/chapter-identity/audit.{md,json}`；不修复、不静默合并，修复动作由 B25 CP3 显式执行。 |
| `chapter_identity_repair.exs` | **B25 CP3 章节身份历史数据显式修复**：默认只读报告重复 `(work_id,title)` / `(work_id,seq)` / 空 title；`--fix-dup-seq` 显式重排重复 seq（每 work 1..n、保持相对顺序、事务、永不合并/删除/改 title）。修复后再执行唯一索引迁移；回滚 `mix ecto.rollback`。 |
| `dev.sh` | 本地开发启动入口。 |
| `dogfood_run.sh` | 狗粮运行入口。 |
| `dogfood_run_detached.sh` | B37 独立 session 监督入口；默认 dogfood，`--runner native-slice` 监督原生 slice，保留 pid/心跳/退出记录。 |
| `probe_run.sh` | 模型契约探针统一入口（端口/构建隔离、原始日志 tee、并发预警——历史事故的机械化）。 |
| `e2e_01_full_chain_check.sh` | E2E-01 聚合检查脚本。 |
| `frontend_audit.sh` | 前端依赖、Tauri 配置和桌面约束审计。 |
| `grep_turn.sh` | 按 turn 检索日志/证据辅助。 |
| `grep_workspace.sh` | 按 workspace 检索日志/证据辅助。 |
| `lint_enum_literals.exs` | 枚举字面量 lint 辅助。 |
| `macos_cgevent_local_secret_file_driver.swift` | macOS 本地 secret 文件 UI 驱动辅助。 |
| `macos_cgevent_plan_matrix_driver.swift` | **B26 计划矩阵原生驱动**：CGEvent/AX 操作真实 Tauri 窗口完成同批计划/独立起草/核对后修订三路径，写 `native-ui-complete.json`；配合 `TAURI_NATIVE_SYSTEM_DRIVER=1 TAURI_NATIVE_TRANSPORT_PROXY=1` 与 `scripts/native_plan_evidence_check.mjs` 使用。 |
| `b27_case_freeze.exs` | **B27 CP0 案例冻结**：在隔离 test DB 中用真实生产入口组装 20 例语义案例请求快照并计算旧规则臂 hash（`quality/acceptance/fixtures/b27-semantic-cases/`）；`--check` 校验快照/规则漂移。 |
| `next_task_check.mjs` | 检查 NEXT 三段简表、当前项唯一、任务来源/锚点/非终态与长度；拒绝旅程双写排期，不再要求旅程维护 next。 |
| `next_task_check.test.mjs` | 排期/源状态/链接/体积与差距扫描迁移、快照保护反例；运行 `node --test scripts/next_task_check.test.mjs`，无需前端依赖。 |
| `gap_ledger.sh` | 从既有差距表生成开放清单及跨次快照，落点见 `reports/gap-ledger/README.md`。 |
| `quality_accept.sh` | quality acceptance 统一入口。 |
| `quality_manifest_check.sh` | quality manifest 门禁：PyYAML 标准解析 + `scripts/lib/quality/manifest.mjs` 语义校验（非法 YAML/重复键/词表/未注册/draft 硬失败；B41 CP1）。 |
| `seed_au03_context_source_ui.exs` | AU-03 context source UI 验收 seed。 |
| `seed_au03_current_work_context_ssot.exs` | AU-03 当前作品上下文 SSOT seed。 |
| `seed_au03_long_session_compression.exs` | AU-03 长会话压缩 seed。 |
| `seed_au03_session_history_readonly.exs` | AU-03 历史会话只读 seed。 |
| `seed_au04_confirmation_ttl_ui.exs` | AU-04 confirmation TTL UI seed。 |
| `seed_au04_cross_work_confirmation_guard.exs` | AU-04 跨作品 confirmation guard seed。 |
| `seed_au04_disabled_confirmation_action_ui.exs` | AU-04 disabled confirmation action seed。 |
| `seed_au04_history_confirmation_readonly.exs` | AU-04 历史 confirmation 只读 seed。 |
| `seed_au04_latest_context_rebase_confirmation.exs` | AU-04 latest context rebase confirmation seed。 |
| `seed_au05_canon_conflict_recovery.exs` | AU-05 canon conflict recovery seed。 |
| `seed_au05_conflict_cross_work_recovery.exs` | AU-05 跨作品 conflict recovery seed。 |
| `seed_au05_stale_conflict_cross_work_freshness.exs` | AU-05 stale conflict freshness seed。 |
| `seed_au08_volume_planning.exs` | AU-08 分卷规划 seed（只立 planned_volumes=2 骨架，卷/章由真实链路产出）。 |
| `seed_au09_archive_real_data.exs` | AU-09 档案真实数据 seed。 |
| `seed_au09_archive_stats_current.exs` | AU-09 当前档案统计 seed。 |
| `seed_au09_au03_session_memory_layering.exs` | AU-09/AU-03 session memory layering seed。 |
| `seed_au09_cross_work_memory_isolation.exs` | AU-09 跨作品记忆隔离 seed。 |
| `seed_au09_memory_recall_context.exs` | AU-09 记忆召回上下文 seed。 |
| `seed_au09_validity_window.exs` | AU-09 validity window seed。 |
| `seed_au11_quality_diagnosis_message_envelope.exs` | AU-11 质量诊断消息 envelope seed。 |
| `seed_au12_work_profile_status_isolation.exs` | AU-12 作品档案状态隔离 seed。 |
| `seed_e2e_01_readonly_tool_trace.exs` | E2E-01 只读工具 trace seed。 |
| `seed_p1_chapter_draft_generation.exs` | P1 章节正文草稿生成 seed。 |
| `seed_b25_chapter_identity_unification.exs` | **B25 CP4 章节身份统一 seed**：一个作品/两章完全同名（seq 1/2，第二章预置已采纳旧正文）+ 恢复一条 `target_chapter_ref` 指向第二章的续写候选；真实 Tauri 场景据此验证「同名章不合并、采纳只落 ref 目标章」。 |
| `seed_p1_prose_execution_brief.exs` | P1 prose execution brief seed。 |
| `seed_p1_prose_quality_evaluator_degrade.exs` | P1 prose quality evaluator degrade seed。 |
| `seed_p1_prose_revision_candidate.exs` | P1 prose revision candidate seed。 |
| `seed_quality_revision_action_run_anchoring.exs` | 质量修订动作回执、同 run 暂停/刷新/继续验收 seed。 |
| `seed_stage_startup_context.exs` | stage startup context seed。 |
| `slice_verify.sh` | legacy/browser slice verify 入口。 |
| `slice_verify_server.exs` | slice verify server 辅助入口。 |
| `smoke_test.sh` | smoke test 入口。 |
| `stage.sh` | stage 桌面启动入口。 |
| `task_done.sh` | 任务完成统一门禁入口。 |
| `task_done_check.mjs` | task-done manifest 与 UI evidence 检查。 |
| `tauri_slice_verify.sh` | 启动 Tauri 的验收入口；默认交互为 Chromium，summary 如实标 browser；B26 的 `TAURI_NATIVE_SYSTEM_DRIVER=1` 使用外部系统 UI 驱动原生窗口。 |
| `native_question_transport_proxy.mjs` | B26 原生验收外部 WebSocket/HTTP 代理；复用已安装 ws，按证据目录 control 文件丢 ack/断线或改绑负例，生产代码无感知。 |
| `native_business_evidence_check.mjs` | B26 原生业务结果与续行问题验收；按实际用户操作、传输和持久事实核对来源、幂等、采纳边界与缺口收尾。 |
| `native_plan_evidence_check.mjs` | B26 既有多步计划场景的额外原生矩阵：同响应计划、独立起草与耗尽修订，核对来源、实际调用、编排和待采纳持久结果。 |
| `native_question_evidence_check.mjs` | B26 原生问题回复：本次启动 nonce、原生截图、源动作日志与持久输入字节对账；不驱动产品、不接受 Chromium 证据。 |
| `native_ui_wait.mjs` | B37 原生外部驱动的 begin/finish/status/wait 账本，分型预算、10秒心跳、进程/后端异常快速失败；产品不读取。 |
| `native_ui_wait.test.mjs` | 原生等待账本超时、重复身份、迟到完成及进程丢失的边界测试。 |
| `native_b31_evidence.mjs` | B31 原生五 trial 前提与证据对账；prepare 仅创建隔离作品及 T3–T5 允许的协议 seed，verify 读取真实 UI/WS/持久结果。 |
| `native_b28_evidence.mjs` | B28 原生前提、只读快照及矩阵对账；支持受限测试库副本scoped复验并逐项注明父批证据；T2按B36目标段与完整采纳结果校验。 |
| `native_b28_evidence.test.mjs` | B28 全章覆盖、源版本、同章身份、排版保真与越界拒绝的证据检查回归。 |
| `native_b30_drive.mjs` | B30 原生外部系统 UI 驱动（AX/CGEvent）：两场景确定性矩阵 + strata scoped 真实模型流程；作品切换经真实重开+测试数据准备；模型生命周期记录/结束 unload 验证。 |
| `native_b30_evidence.mjs` | B30 原生证据核验：场景1 30 项 + 类型边界 T8 6 项、场景2 12 项；strata scoped 模式 26 项（不冒充全矩阵）；只读 DB/transport/app-log/llm-calls/AX/生产指纹。 |
| `native_b29_drive.mjs` | B29 原生外部系统 UI 驱动（AX/CGEvent）：确定性 T1–T5 + strata scoped T1/T2；关闭重开恢复、档案角色 roster、「谁是主角」追问；失败首因 JSON。 |
| `native_b29_evidence.mjs` | B29 原生证据核验：确定性 23 checks 1:1 + strata scoped 21 checks（provider 来源/生命周期/author_question_events）；summary 明示 scope，不冒充全矩阵。 |
| `native_p1_drive.mjs` / `native_p1_evidence.mjs` | P1 原生实模 scoped 创作旅程：创作/排版维护/真实关闭重开恢复+续写/真实目录面板导出；模型生命周期 before/after-unload、导出文件 hash、wait-ledger 全分型。 |
| `verify_stage_process_ownership.sh` | stage/Tauri 进程 ownership 验收脚本。 |
| `walkthrough_template.ts` | 产品体验走查脚本模板。 |

- `task_done_check.mjs`：校验本轮改动哈希与真实 Tauri 证据；可用 `--manifest` 或 `TASK_DONE_MANIFEST` 显式指向 `artifacts/slice-verify/<slice>/manifest.json`，不新增历史 `artifacts/task-done/` 目录。


### B26 原生系统 UI 验收

运行 `TAURI_NATIVE_SYSTEM_DRIVER=1 TAURI_SLICE_VERIFY_TIMEOUT_SECONDS=1200 CARGO_NET_OFFLINE=true bash scripts/quality_accept.sh b26-author-question-roundtrip --surface tauri`。读取 `artifacts/slice-verify/b26-author-question-roundtrip-tauri-native/native-driver-ready.json`；外部 CUA 按 `app_path` 选择本次原生窗口。wrapper 仅为现有 debug binary 补 macOS app 元数据，独立 desktop profile，不修改产品逻辑或安装应用。默认 Vite/后端仍由标准 Tauri dev runner 启动。

1. 在可见主输入发送“结尾有两个方向，先让我选择。”，保存原生截图并点击“保留悬念”。
2. 发送“结尾还没想清楚，请先问我一个问题。”；点击该问题“回复此问题”，输入带首尾空格的原话并“发送回复”。
3. 关闭并重新打开该原生窗口，确认源问题显示“已收到回复”、输入原话可见；保存原生截图与可访问性状态。
4. 用只读 session API 与 app JSONL 取得本次真实 question/run/submission/action ID，写入 `native-ui-complete.json`（字段见 checker）。expected answer 使用实际输入原文，不从输出推导；截图保存其真实 PNG/JPEG 格式。checker 核对 nonce/时间/格式、同 run 一次持久化、源动作 accepted 与 open 集合关闭，输出 summary。
5. 通过 CUA 关闭 wrapper 窗口；标准 runner 回收其 Phoenix/Tauri 进程。更广泛的浏览器问答矩阵和原生两轮核心链分别报告，不能互相替代。


B26 扩展故障/分页模式额外设置 `TAURI_NATIVE_TRANSPORT_PROXY=1`：外部驱动可在产物目录写 `transport-control.json`，`drop_next_author_ack: true` 在下一次问题回答已被服务器接受后丢 ack 并断线，`tamper_next_author_action: {target_ref: ...}` 只改变外部 wire 作为跨 run 负例。生产代码无感知。完整帧进入 `native-transport.jsonl`；完成记录可声明 `transport_replay`、`paged_question_refs`、`cross_run_rejection`，checker 核对实际帧/分页/持久状态，不接受仅凭人工布尔断言。分页16轮必须成功且零方向/产物；失败批次应独立保留，不覆盖为成功。


原生验收可加 `TAURI_NATIVE_ARTIFACT_TAG=scope` 等目录标签（仅小写字母/数字/连字符，最多32字符），保留不同矩阵批次；标签只用于脚本证据路径，不进入产品。B26 作用域变体先完成两种问题答复，再创建未答问题、开启新会话并从历史入口只读查看，切换到新作品后用外部代理构造跨作品 target 负例；保存历史只读快照及完整帧，`scope_switch` 对账原问题版本/状态与两个作品输入均未改变。

B26 业务回环命令：`TAURI_NATIVE_SYSTEM_DRIVER=1 TAURI_NATIVE_TRANSPORT_PROXY=1 bash scripts/quality_accept.sh b26-business-output-roundtrip --surface tauri`。由 CUA 在独立 app_path 完成其 manifest 用户流；`drop_next_committed_result` 在真实结果已落盘后丢掉首次 TurnResult 并断线，重传/恢复必须复用原产物。关闭窗口前备份完整 session、待采纳 payload 和独立 profile，避免丢失任何测试草稿；不采纳草稿来换取关闭许可。

## B41 质量证据 verdict（CP4）

- 契约：`quality/acceptance/verdict-schema.json`（quality-verdict/v2，draft 2020-12，additionalProperties=false）。
- `scripts/lib/quality/verdict.mjs`：verdict 生成/读取/校验唯一实现（无外部依赖），被 runner 与聚合器共用；缺 verdict/缺 status 一律 evidence_missing，绝不默认 PASS。
- `scripts/lib/quality/verdict_cli.mjs`：bash runner 调用入口。`read <artifact_dir>` 输出 JSON 并按 status 映射退出码：0 pass / 1 fail / 65 skipped（批次内 blocked）/ 67 evidence_missing（缺 verdict.json、缺 status、结构无效）/ 69 not_run；`write <artifact_dir> <verdict.json>` 与 `validate <verdict.json>` 无效输入 exit 1，用法错误 exit 64。
- `scripts/lib/quality/verdict.test.mjs`：负例矩阵与 schema/实现同源回归；运行 `node --test scripts/lib/quality/verdict.test.mjs`。

## B41 CP3 E2E 聚合器语义（blocked/freshness/来源）

`scripts/e2e_01_full_chain_check.sh` 不再把「旧 summary.json 存在」或硬编码「已验收/已测试」当作通过：E1–E13 状态全部由 `scripts/lib/quality/e2e_status.mjs` 按真实证据计算（CP1 `manifest_cli.mjs registry-status` + CP4 `verdict_cli.mjs read` 及 legacy summary 回落 + `git_head`/`current` freshness + provider/surface/断言来源匹配），旧字段保留但不得与内嵌 verdict 矛盾。

- 场景状态词表：`pass|fail|blocked|stale|evidence_missing|not_run`；`blocked` 只来自 registry（E4 `e2e-01-downgrade-real-page` 在 B40 重锚/退役前恒为 blocked，旧 summary 存在也不写已验收）。
- 聚合 summary 内嵌 `verdict` 使用聚合专有 `schema_version: "quality-aggregate/v1"`（不是 CP4 `quality-verdict/v2`；blocked 批内记 skipped），并显式列出 `blocked_scenarios`/`stale_scenarios`/`evidence_missing_scenarios`/`not_run_scenarios` 与 reason。
- freshness：证据记录 `git_head` 与当前 HEAD 一致或显式 `current` 标记才可 pass；旧证据无 `git_head` → stale，存在不等于 PASS。
- 退出码（批量语义）：0 pass / 1 fail（命令失败或内容断言、provider 错配，优先）/ 67 evidence_missing（stale/缺失）/ 65 整批场景全 blocked、无任何验收执行 / 69 全 skipped/not_run / 66 registry/verdict CLI 缺失或查询失败。
- 测试：`node --test scripts/lib/quality/e2e_status.test.mjs`（纯 fixture，不依赖真实 artifacts、不跑 Tauri/模型）。
