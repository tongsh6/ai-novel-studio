# Scripts Index

> 离线模型交互设计候选校验：[model_contracts/model_interaction](model_contracts/model_interaction/README.md)。它不调用模型或生产数据库，报告进入 `artifacts/model-contracts/vs00m-design/`；生产协议与正式场景入口不变。

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
| `ai_static_scan.sh` | AI 静态扫描统一入口。B84：解析参数后、资源初始化前经 `novel_node_test_scope_ensure` 申请一次 owned run（嵌套入口继承父 scope）；原始 argv/退出码透传，`--help`/非法参数不构造 run。 |
| `ai_static_scan_report.mjs` | 静态扫描报告生成器。 |
| `arch_check.exs` | Umbrella 架构边界检查。 |
| `before-tauri-dev.sh` | Tauri `beforeDevCommand` 启动 Vite 的入口。 |
| `build_sidecar.sh` | Tauri sidecar 构建辅助。 |
| `check_coverage.sh` | 覆盖率检查入口。 |
| `check_module_size.mjs` | **模块规模 ratchet 门禁（docs/coding-standards/03 §3.2）**：扫描 `apps/*/lib`、`apps/*/test`、`frontend/src`；已登记观察文件只减不增（R1），新增超关注门槛文件必须拆分或登记豁免（R2）。`--check` 门禁 / `--report` 拆分排期报告 / `--write-baseline` 生成或降上限（新增观察文件需显式 `--register-new`）。接入 `scripts/ai_static_scan.sh` 与 CI `static-scan` job。 |
| `check_module_size.test.mjs` | 上述门禁的正式测试（`node --test scripts/check_module_size.test.mjs`）：百分位、观察名单判定、ratchet/未登记/豁免/删除、baseline 只降不升与首次生成。 |
| `check_design_trace.sh` | 前端组件设计追溯检查。 |
| `check_single_call_protocol.exs` | **单调用协议源码守卫（B26 CP2，L2 静态门禁）**：扫 `apps/*/lib/**/*.ex`，禁止旧两段式判断/计划协议构造（`request_narrative(`、`narrative_fn`、`draft_reasoning_prompt(`、`revision_reasoning_prompt(`、`tool_choice: "none"`）。行为级守卫见 `scripts/model_contracts/single_call_compliance.exs`。2026-11-04 从 application 测试迁出（原测试每次 `mix test` 全量扫描约 2.45s），CI `backend` job 强制运行。 |
| `check_log_noise.sh` | **业务日志噪声静态门禁（B13b BB-10 / ADR-0018 §6）**：扫生产 lib 的 `Logger.warning`，只允许既有 17 处 provider 适配器 unknown-error 分支（allowlist 显式登记）；新增 warning exit 1。CI `backend` job 强制运行；运行时 per-base-turn 行数/error 级断言由 Tauri verifier `log_noise` 通用断言承担。 |
| `chapter_identity_audit.exs` | **B25 CP0 章节身份历史数据审计（只读）**：扫 chapters 的重复 `(work_id,title)` / 重复 `(work_id,seq)` / 空 title，输出 `artifacts/chapter-identity/audit.{md,json}`；不修复、不静默合并，修复动作由 B25 CP3 显式执行。 |
| `chapter_identity_repair.exs` | **B25 CP3 章节身份历史数据显式修复**：默认只读报告重复 `(work_id,title)` / `(work_id,seq)` / 空 title；`--fix-dup-seq` 显式重排重复 seq（每 work 1..n、保持相对顺序、事务、永不合并/删除/改 title）。修复后再执行唯一索引迁移；回滚 `mix ecto.rollback`。 |
| `dev.sh` | 本地开发启动入口。 |
| `dogfood_run.sh` | 狗粮运行入口。 |
| `dogfood_run_detached.sh` | B37 独立 session 监督入口；默认 dogfood，`--runner native-slice` 监督原生 slice，保留 pid/心跳/退出记录。 |
| `probe_run.sh` | 模型契约探针统一入口（端口/构建隔离、原始日志 tee、并发预警——历史事故的机械化）；B84 起经统一 run scope 运行，作者模型服务仅借用、原始日志保留在 `artifacts/model-contracts/logs/`。 |
| `e2e_01_full_chain_check.sh` | E2E-01 聚合检查脚本。 |
| `frontend_audit.sh` | 前端依赖、Tauri 配置和桌面约束审计。 |
| `grep_turn.sh` | 按 turn 检索日志/证据辅助。 |
| `grep_workspace.sh` | 按 workspace 检索日志/证据辅助。 |
| `lint_enum_literals.exs` | 枚举字面量 lint 辅助。 |
| `macos_cgevent_local_secret_file_driver.swift` | macOS 本地 secret 文件 UI 驱动辅助。 |
| `macos_cgevent_plan_matrix_driver.swift` | **B26 计划矩阵原生驱动**：CGEvent/AX 操作真实 Tauri 窗口完成同批计划/独立起草/核对后修订三路径，写 `native-ui-complete.json`；配合 `TAURI_NATIVE_SYSTEM_DRIVER=1 TAURI_NATIVE_TRANSPORT_PROXY=1` 与 `scripts/native_plan_evidence_check.mjs` 使用。 |
| ~~`b27_case_freeze.exs`~~ | **已退役（2026-11-06 作者裁决）**：B27 CP0 案例冻结器在 R1 后不可运行（`SystemIdentity.inject/1` 已删除、请求形态改为 canonical IR）；历史快照（`quality/acceptance/fixtures/b27-semantic-cases/`）只读保留，不再提供 `--check` 可复跑性；需要规则臂对照时按 R1 形态作为独立任务重建。 |
| `node_test.sh` | **Node 测试统一入口（B84 A1）**：`bash scripts/node_test.sh <files...>` 为测试族建立 owned run scope（同一次 run 的 TMPDIR/scratch 贯穿所有文件）；`--self` 供作用域自身测试直接自持 scope。CI `node-tests` job 与 quality parser 步骤使用此入口，裸 `node --test` 不再是现役入口。 |
| `next_task_check.mjs` | 检查 NEXT 三段简表、唯一状态来源、当前/候选可推进、锚点与说明篇幅；候选无数量上限，阻塞/延期另列引用；拒绝借子标题状态及旅程双写。`--open` 只读列出原任务/小节开放项、是否排期及未识别历史状态，不生成第二份台账。 |
| `next_task_check.test.mjs` | 排期/源状态/链接/体积与差距扫描迁移、快照保护反例；运行 `node --test scripts/next_task_check.test.mjs`，无需前端依赖。 |
| `gap_ledger.sh` | 从既有差距表生成开放清单及跨次快照，落点见 `reports/gap-ledger/README.md`。 |
| `quality_accept.sh` | quality acceptance 统一入口。 |
| `lib/quality/au15_evidence.mjs` | B39 CP1d AU-15 证据 sidecar：解析 llm-calls 请求字节，对照 trace base/observation/used refs，产出机制/模型行为分层与 observed_in_calls；CLI `au15_evidence.mjs verify <dir> --scenario A0|A1|A2`。 |
| `quality_manifest_check.sh` | quality manifest 门禁：PyYAML 标准解析 + `scripts/lib/quality/manifest.mjs` 语义校验（非法 YAML/重复键/词表/未注册/draft 硬失败；B41 CP1）；经统一 Node 运行作用域执行，owned scratch 自回收且不建库。CI 的 `scripts/lib/quality/*.test.mjs` parser 测试也经 `novel_node_test_scope` 覆盖整次调用；作用域自测单独直接运行。 |
| `author_behavior_check.mjs` | B70 CP0 author-behavior 冻结语料/状态/oracle/覆盖报告格式校验（PyYAML 标准解析；schema/引用/provenance/split/holdout 泄漏/覆盖报告一致性；exit 66 格式错误）。 |
| `author_behavior_offline_generate.mjs` | B72 离线生成唯一 CLI：仅显式 `--offline` 运行确定性执行器，真实模型校准未接线；生成 manifest/candidates/coverage 且旧文件不可覆盖，不自动改正式 corpus。 |
| `lib/quality/author_behavior_offline_generator.mjs` / `.test.mjs` | B72 离线生成器与 12 条正反例：manifest/persona/semantic cell 校验、expected seed 派生、去重/holdout 泄漏、失败留痕、multi_turn 候选、审核与原子落盘；mutation 未闭环见 B72。 |
| `lib/quality/author_behavior_oracle.mjs` | B70 CP1 author-behavior 确定性 oracle 评估器：allowed action/effect、硬违规（错对象/未授权写/重复副作用/虚假完成/讨论强制写）、unknown 不判 PASS、覆盖报告生成（`author-behavior-coverage-report/v1`）。 |
| `lib/quality/author_behavior_pr_subset.mjs` | B70 CP3 PR 受影响子集：变更路径→应跑 case/场景映射（docs-only 空集、未知路径保守全选）；CLI `author_behavior_pr_subset.mjs`。 |
| `author_behavior_real_llm_plan.mjs` | B70 CP3 真实模型 holdout-only 预注册生成器（不加载模型；单槽/卸载/预算/判据/I10 不代签）；对应 scenario release-real-llm blocked。 |
| `author_behavior_live_case.mjs` / `lib/quality/author_behavior_live_cases.mjs` | B71 实模作者行为输入选择器与 CLI：只从 B70 冻结 cases 取 `expression` 原文（`expression_frozen=true`；`generated_frozen` 必须带 generator/generated_at），按已批准 pilot 组/目标族/状态/split 选 case，persona 仅记录表达风格（不评分）；`--case/--field state_env` 供批次入口读取；拒绝现场造输入/未批准 case，explore split 默认拒绝。 |
| `native_b71_behavior_drive.mjs` | B71 作者行为覆盖外部驱动（journey=behavior）：输入取 prepare 写入的冻结 case expression，真实窗口输入并等待 run 终局，采集 llm-calls/AX/WS/canon/usage/strata 生命周期；批次入口 `B71_SLICE=b71-first-consumer B71_PROVIDER=strata B71_BEHAVIOR_CASE=C-F1-003 bash scripts/native_b71_batch.sh <tag>`，输出 `b71-first-consumer-behavior-<tag>`（behavior-case.json/behavior-verdict.json/summary.json 分层），seed 用 `seed_author_behavior_states.exs --state` 或 `B70_AUTHOR_BEHAVIOR_STATE`；1 case 1 批、单槽 iq3_s、前后 loaded=null 核验。 |
| `native_b71_confirmation_drive.mjs` / `lib/native_ui/authoring_confirmation_evidence.mjs` | B71 §16.14 非采纳工具确认/拒绝原生场景：真实作者高风险请求 → needs_confirmation（awaiting_author behavior + confirm_before_execute/reject_or_cancel_confirmation）→ 按用户可见语义与所属消息块定位「确认执行」/「拒绝」→ 确认子执行/拒绝零 Provider → Why 前后 Provider delta → 重复点击幂等 → 重启恢复不可再触发；C1–C11 判据（source 持久、受理身份、run 绑定、行为唯一消费、重复幂等、拒绝零副作用、确认子执行真实、作者字节、Why/replay、恢复、cleanup）。批次入口 `B71_SLICE=b71-first-consumer B71_PROVIDER=slice_verify B71_CONFIRMATION_ACTION=confirm|reject bash scripts/native_b71_batch.sh <tag>`，seed=`seed_p1_chapter_draft_generation.exs`，输出 `b71-authoring-confirmation-tauri-native-<tag>`；不手造 needs_confirmation 帧、不改产品代码。 |
| `author_behavior_nightly.sh` | B70 CP3 夜间/后台多 seed 探索 runner：必须带预注册 JSON，逐 seed 预算/心跳/pidfile/termination，失败只读保留。 |
| `lib/quality/author_behavior_promote.mjs` | B70 CP3 失败→regression 候选：只接受 G1–G6 硬违规、指纹去重、写 regressions.json 台账；fixture 不兼容/驱动失败拒转。 |
| `lib/quality/author_behavior_real_llm.mjs` | B70 CP3 实模预注册构造（holdout-only/单槽/卸载/语义与 I10 边界）；CLI 为 `author_behavior_real_llm_plan.mjs`。 |
| `lib/quality/author_behavior_explorer.mjs` | B70 CP2 seeded 状态探索器：确定性 PRNG/探索计划、逐步状态转移与覆盖汇总、失败缩化（保同一类别最小序列）、去重指纹；正反例见同目录测试。 |
| `lib/quality/author_behavior_generator.mjs` | B70 CP1 离线确定性语料生成器：模板生成候选 + generated_frozen provenance（source_refs/generator/时间），只产候选、不自动冻结/不标 holdout；正反例见同目录测试。 |
| `seed_vs00g_trigger_c.exs` / `native_vs00g_trigger_c_{drive,evidence}.mjs` / `native_vs00g_trigger_c_batch.sh` | VS00G 触发 C：两作品 R5 提议、未关闭/关闭后去重、原生恢复、活跃 finding 重绑与显式盘点；detached 批次 + 只读证据。 |
| `native_vs00g_trigger_c_startup_{drive,evidence}.mjs` / `native_vs00g_trigger_c_startup_batch.sh` | VS00G scoped 前置诊断：仅窗口激活与作品选择，不签业务 CP。 |
| `native_vs00g_trigger_c_observe_{drive,evidence}.mjs` / `native_vs00g_trigger_c_observe_batch.sh` | VS00G 菜单根因观察：记录 safeClick、frontmost、AX 菜单角色与点击后传输，不重启、不执行业务动作。 |
| `native_vs00g_trigger_c_input_{drive,evidence}.mjs` / `native_vs00g_trigger_c_input_batch.sh` | VS00G AXShowMenu/CGEvent 输入对照：各一次菜单输入，验证目标 Radix 菜单项，不签业务。 |
| `native_vs00g_trigger_c_click_batch.sh` | VS00G 新窗口普通 CGEvent 单点批次：禁用其它输入，证明目标菜单输入路径。 |
| `seed_au03_context_source_ui.exs` | AU-03 context source UI 验收 seed。 |
| `seed_b27_request_source.exs` | B27 §9 CP3 原生实模 seed：合成作品 + 已确认 memory + 1 章 accepted 正文。 |
| `native_b27_request_source_drive.mjs` | B27 §9 CP3 外部原生 Tauri 驱动：M1/M2 自然输入、Why 面板、问题预算、strata 单槽生命周期。 |
| `native_b27_request_source_evidence.mjs` | B27 §9 CP3 证据核验：请求字节/供给声明/memory 观察回流/Why/trace/zero-write/卸载；含正反例测试。 |
| `native_b27_request_source_batch.sh` | B27 §9 CP3 批次编排：预注册校验、detached 运行、结束 unload 核验。 |
| `seed_author_behavior_states.exs` | B70 CP1 author-behavior 状态夹具 seed（S1 部分多章/S2 空骨架/S3 待采纳候选），仅浏览器隔离 DB 使用。 |
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
| `au15_preregistration_check.mjs` | B42-PREP AU-15 准备检查：`--root` 指定项目根（默认本 repo）；reader 只读预注册 JSON、场景 YAML（经 `manifest.mjs` 标准解析桥）与 harness 存在性，纯判定区分 ready/blocked/unknown，unknown 与 blocked 都阻止 overall ready；身份只核对已声明项（`default_provider`、存在的 `setup.provider` 与 model 均须非空且一致），资源窗口条件文本只证明要求存在、状态恒为 unknown，预算标签只声称声明值与 v1 约定一致；报告原样转录输入 `status` 只作声明，不当作完成/授权证据。读取校验全部通过后才写 `artifacts/b42-prep/readiness.{json,md}`。不加载模型、不调 provider、不写产品数据，不授予运行资格。 |
| `b45_schema_inventory.mjs` | B45 CP0 schema 盘点：38 份 JSON schema 的 $ref 解析、生成物 z.any、前端/后端消费者与 legacy/active 分类；输出 artifacts/b45-schema-inventory。只读，不改 codegen/schema。 |
| `verify_b65_origin_boundary.sh` / `b65_origin_probe_server.exs` | B65 隔离来源探针：test env 独立端口启动真实 Phoenix Endpoint，外部 curl 构造允许/拒绝 Origin 的 HTTP 与 WebSocket 握手；输出 WS 101/403、HTTP CORS 头证据。 |
| `seed_b47_c07_character_freshness.exs` | B47-C07 CP3 角色 stale/fresh 页面种子：两隔离作品的 pending character_profile_revision 候选；stale 候选 base fingerprint 取 summary 更新前，fresh 与当前一致；供 `b47-c07-character-freshness` 真实页面矩阵使用。 |
| `seed_b47_canon_freshness.exs` | B47 CP3 场景种子：三个真实持久 canon 作品（stale/conflict/fresh），构造产品同形 pending 正文修订候选（TurnResult.adoption_state.pending + available_actions + candidate_set），seed.log 输出每作品基线/版本/DB 快照字段供外部 driver/verifier 消费；`--check` 复验。 |
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
| `seed_request_cost_work.exs` | B87 R01 完整副本的声明准备：通过现役 WorkService/WorkSessionService 为目标作品改可见名并建立新会话；独立 setup 对账由成本采集入口完成，不裁剪源数据。 |
| `slice_verify.sh` | legacy/browser slice verify 入口。 |
| `slice_verify_server.exs` | slice verify server 辅助入口；R01 可在同一进程写白名单 runtime facts（`SLICE_VERIFY_RUNTIME_FACTS_PATH`，不改产品/provider 行为）。 |
| `request_cost_runtime_facts.exs` | B87 R01 白名单 runtime facts 观察模块：只读 Gateway 现有 `provider_metadata/0` 与 `provider_options/0` 及 Application 配置，输出实际 provider/model、脱敏 endpoint、ContextPressure.window、自动维护/摘要策略、pid/mix env；thinking/effort/max_tokens/timeout 在配置层标记为未观察（`settings_observed=false`），请求层事实由 `llm-calls` 的 `request.body` 单独记录，不冒充 raw HTTP/SSE 或模型内部思考；不读密钥、不 dump 全 env。 |
| `request_cost_splash_body_check.exs` | R01 无模型请求体核对：现役 Splash adapter 从 Application 配置构造流式 body，经 test-only eventsource 边界输出 model/reasoning_effort/has_thinking。 |
| `native_request_cost_drive.test.mjs` | R01 外部驱动测试：当前可见输入模式、原始 AX 节点点击、作者归属与完成/等待/能力缺口终态；只用合成或保存的观察，不启动模型或原生窗口。 |
| `smoke_test.sh` | smoke test 入口。 |
| `stage.sh` | stage 桌面启动入口。 |
| `task_done.sh` | 任务完成统一门禁入口。B84：资源初始化前接入同一 run scope；`task_done → ai_static_scan` 嵌套共用父 run，不重复创建/不结束父 scope。 |
| `task_done_check.mjs` | task-done manifest 与 UI evidence 检查。 |
| `tauri_slice_verify.sh` | 启动 Tauri 的验收入口；默认交互为 Chromium，summary 如实标 browser；B26 的 `TAURI_NATIVE_SYSTEM_DRIVER=1` 使用外部系统 UI 驱动原生窗口。 |
| `native_question_transport_proxy.mjs` | B26/AU08/B71 原生验收外部 WebSocket/HTTP 代理；复用已安装 ws，按证据目录 control 文件丢 ack/断线、改绑负例，或对 `get_toc`/`get_chapter_content` 注入一次性 error/有界 delay；HTTP 只对真实 session resume / turn replay 额外记录 method/完整 path/status/request_id/scope 与有界 response JSON 完成状态（非候选路径保持旧日志字段），对外原样透传压缩字节、仅对证据副本解压（gzip/x-gzip/deflate/br）后判定完整 JSON，未知编码标 unsupported、超限/截断/非法 JSON 不冒充完整；不改请求头、不记录密钥，生产代码无感知。 |
| `native_question_transport_proxy.test.mjs` | AU08 channel 故障契约与真实 WS/HTTP 代理自检：error 零上游、ref/topic 绑定、耗次恢复、delay 上限与真实转发；HTTP chunked resume/replay 完整 capture、scope/request id、gzip/br 解压后完整、非法 JSON/坏压缩/未知编码/超限拒绝。 |
| `native_au08_projection_drive.mjs` / `native_au08_projection_evidence.mjs` | AU08 原生 ReadingMode 故障恢复：真实生成/采纳→STALE→一次章节读取 error→FAILED→重试恢复；核验同 ref、AX、恢复帧与只读 DB 快照。 |
| `native_au08_projection_batch.sh` | AU08 原生批次 detached/状态编排；预注册 `artifacts/model-contracts/au08-channel-fault/preregistration.json`，失败目录只读。 |
| `native_au08_projection_evidence.test.mjs` | AU08 agent step `turn_result` 以 `agent_run.parent_turn_ref` 关联源消息的回归；防止误等父 turn_id 超时。 |
| `native_ua01_run_failed_drive.mjs` / `native_ua01_run_failed_evidence.mjs` | UA01-LOG 原生最终 run_failed：既有 SliceVerify 标记触发，核验 wire/app-log/AgentRunLog/AgentEvent 的 turn/work/session/run 关联与作者安全；2026-10-31 `ua01-cp1-01` 原生 8/8 PASS。 |
| `native_ua01_run_failed_batch.sh` | UA01-LOG 原生 detached 批次；预注册 `artifacts/model-contracts/ua01-run-failed/preregistration.json`，失败目录只读。 |
| `native_q1c_drive.mjs` / `native_q1c_evidence.mjs` / `native_q1c_batch.sh` | Q1c 原生补验 WIP（blocked）：已采纳设定修订与版本链原生 driver/evidence/批次编排；registry 已按原生接线登记 `surface: tauri`（driver=`native_q1c_batch.sh`），但登记不等于原生 PASS，当前预算耗尽，不得作为原生 PASS 入口。 |
| `native_q1c_evidence.test.mjs` | Q1c 现役候选 payload/revision_of、覆盖确认和回执目标绑定契约测试。 |
| `native_business_evidence_check.mjs` | B26 原生业务结果与续行问题验收；按实际用户操作、传输和持久事实核对来源、幂等、采纳边界与缺口收尾。 |
| `native_plan_evidence_check.mjs` | B26 既有多步计划场景的额外原生矩阵：同响应计划、独立起草与耗尽修订，核对来源、实际调用、编排和待采纳持久结果。 |
| `native_question_evidence_check.mjs` | B26 原生问题回复：本次启动 nonce、原生截图、源动作日志与持久输入字节对账；不驱动产品、不接受 Chromium 证据。 |
| `native_ui_wait.mjs` | B37 原生外部驱动的 begin/finish/status/wait 账本，分型预算（Splash 与既有实模同 360 秒 turn）、10秒心跳、进程/后端异常快速失败；`observeNativeLifecycle`（命令消费/进程来源/首次窗口缺席）与 `maybeHeartbeat` 是可测的公开边界，owned 进程观测走 `lib/native_ui/process_observation.mjs`，实际方式与 fallback 原因写入 `wait-stats.json.process_observation`；产品不读取。 |
| `native_ui_wait.test.mjs` | 原生等待账本超时、重复身份、迟到完成、命令起点消费/wait-events、完成时有活动等待、跨轮询心跳/原生首次无窗口、存活探测不投递信号及进程丢失的边界测试。 |
| `native_b31_evidence.mjs` | B31 原生五 trial 前提与证据对账；prepare 仅创建隔离作品及 T3–T5 允许的协议 seed，verify 读取真实 UI/WS/持久结果。 |
| `native_b28_evidence.mjs` | B28 原生前提、只读快照及矩阵对账；支持受限测试库副本scoped复验并逐项注明父批证据；T2按B36目标段与完整采纳结果校验。 |
| `native_b28_evidence.test.mjs` | B28 全章覆盖、源版本、同章身份、排版保真与越界拒绝的证据检查回归。 |
| `native_b30_drive.mjs` | B30 原生外部系统 UI 驱动（AX/CGEvent）：两场景确定性矩阵 + strata scoped 真实模型流程；作品切换经真实重开+测试数据准备；模型生命周期记录/结束 unload 验证。 |
| `native_b30_evidence.mjs` | B30 原生证据核验：场景1 30 项 + 类型边界 T8 6 项、场景2 12 项；strata scoped 模式 26 项（不冒充全矩阵）；只读 DB/transport/app-log/llm-calls/AX/生产指纹。 |
| `native_b33_drive.mjs` | B33 §元原则整改 CP3 外部原生 Tauri 真实模型驱动（6 场景串行：条件性 no-op/只解释/讨论/守卫/重编号/写章；作者问答自动应答；strata 单槽生命周期记录）。 |
| `native_b33_evidence.mjs` | B33 CP3 证据 prepare/capture/verify（strata provider、零写入差分、seq/正文/角色不变断言、模型 unload 核验、summary）。 |
| `native_b28_scope_drive.mjs` | B28-SCOPE CP3 外部原生 Tauri 真实模型驱动（7 场景串行：字面替换/否定整章+局部/通读后局部/只读拒改/条件整章/整章重写/仅排版；作者问答与运行暂停自动应答；strata 单槽生命周期记录、结束卸载）。 |
| `native_b28_scope_evidence.mjs` | B28-SCOPE CP3 证据 prepare/capture/verify（strata provider、候选 scope/effect、采纳回执、目标段外字节逐字、零写入差分、对照章/章节身份不变、模型 unload 核验、summary）。 |
| `native_au03_drive.mjs` | AU03-CONTEXT CP3 外部原生 Tauri 真实模型驱动（H3 baseline→外部注入投影表故障→H1 fault→解除→H2 recovery；故障仅外部 harness 执行 DDL，产品无感知；strata 单槽生命周期/卸载）。 |
| `native_au03_evidence.mjs` | AU03-CONTEXT CP3 证据 prepare/capture/verify（同一 turn provider 请求可用性段、context.assemble source_status、trace unavailable_sources、零 canon 写入、投影表恢复与 unload 核验、summary）。 |
| `native_b29_drive.mjs` | B29 原生外部系统 UI 驱动（AX/CGEvent）：确定性 T1–T5 + strata scoped T1/T2；关闭重开恢复、档案角色 roster、「谁是主角」追问；失败首因 JSON。 |
| `native_b29_evidence.mjs` | B29 原生证据核验：确定性 23 checks 1:1 + strata scoped 21 checks（provider 来源/生命周期/author_question_events）；summary 明示 scope，不冒充全矩阵。 |
| `native_p1_drive.mjs` / `native_p1_evidence.mjs` | P1 原生实模 scoped 创作旅程：创作/排版维护/真实关闭重开恢复+续写/真实目录面板导出；模型生命周期 before/after-unload、导出文件 hash、wait-ledger 全分型。 |
| `native_au11_drive.mjs` / `native_au11_evidence.mjs` | B61 AU11×2 原生验收（AX/CGEvent 真实 Tauri 窗口）：打开工作台→发送质量诊断/缺 WorkState 用户话术→等回复可见→点「为什么」；核验 frame_type/decision_type/reply_record 覆盖/prompt 作品事实/回复字节/provider-free why/无工具无采纳无写入。 |
| `native_au07_drive.mjs` / `native_au07_evidence.mjs` | B61 AU07×3 原生验收：发送角色阵容请求→等 AgentRun 内部只读 character_roster 步与最终回复→按 step turn_id 回查产品持久 trace（TraceRepository.list_by_turn）+ no-provider ReplayReport 六问；核验 registry snapshot/合同 refs/grant summary/redacted I/O/无生产写入。 |
| `native_b40_family_drive.mjs` / `native_b40_family_evidence.mjs` | B62 B40 CP3 家族 6 个 tauri 场景原生验收（AX/CGEvent 真实 Tauri 窗口，按 `native-driver-ready.json` 的 `slice_id` 分流）：普通聊天两轮（au01-ordinary-chat / pr-smoke-core-reply）、空消息守卫、frame 校验友好错误、au02 自然探索候选卡、agent-step-regate（AgentRun 多步 12 门 allow + author-safe why）；证据含 AX/截图/app-log/llm-calls/等待账/只读 DB，检查项与 browser canonical 同源。 |
| `native_request_cost_drive.mjs` / `native_request_cost_batch.sh` / `model_contracts/request_cost_baseline.mjs` | B87 R01 真实起点与同源原生多轮：`rebuild-snapshot` 从冻结 v2 full 生成字节一致的完整副本（不裁剪作品），`restore-snapshot` 到隔离 DB，`preflight` 在 runner 启动前校验 native frozen/快照 hash/目标作品/运行清单（拒绝可能自动恢复的运行/非终态长期任务，不把历史数量写成规则），`prepare` 独立对账 seed 的 title/revision/updated_at + 新 session 并冻结 target 映射，`analyze` 只读历史日志复算。驱动每轮按当前真实 AX 选输入模式（普通 composer+发送优先，否则可见「开始新讨论」点一次再等普通入口），操作始终用同一次 observed.nodes 的完整 node；终局只按本轮 AX 作者归属（含 capability_gap 结构与下一作者边界），失败/超时保留最新原始 AX，turn/pcall/prun 仅事后 join；`verify` 产出 canon 内容权威、内容 UTF-8/稳定 JSON、raw HTTP/SSE not_collected、usage/缓存/TTFT/互斥分类守恒、语义待审表与 measurement/model_behavior 分离。批次入口 `REQUEST_COST_MANIFEST=<frozen> REQUEST_COST_SNAPSHOT=<dir> REQUEST_COST_LENGTH=3|10|20 bash scripts/native_request_cost_batch.sh <tag>`；未冻结 manifest/history 不能启动 native。受控实验 runtime 参数（Splash thinking enabled+effort high、ContextPressure 262144、自动维护 true/keep4、摘要异步）由 `lib/native_ui/request_cost_runtime_recipe.mjs` 单点生成，batch 只消费数据行；`slice_verify_server.exs` 在同一后端进程写白名单 runtime facts，`prepare/verify` 核对失败即明确失败。无模型复核入口：`bash scripts/model_contracts/request_cost_runtime_bootstrap_check.sh`、`bash scripts/model_contracts/request_cost_splash_body_check.sh`。 |
| `native_b71_drive.mjs` / `native_b71_evidence.mjs` / `native_b71_batch.sh` | B71 原生请求验收：默认驱动全章阅读并核验观察回流；`B71_SLICE=b71-authoring-transcript` 驱动超时后的同 run 续行，核验原生创作/质量、应用结果闭合、阶段工具、严格前缀、durable checkpoint 与作者安全文案；`B71_SLICE=b71-authoring-profiles` 驱动角色设计 durable run，核验前序判断与创作共享 canonical transcript；`B71_SLICE=b71-authoring-planning` 驱动独立计划→重规划→角色与世界设定双候选，核验逐call闭合、durable版本/预算及Why无模型调用。 | `B71_SLICE=b71-authoring-pending` 驱动空作品 Q1B 原稿→对话修订→采纳/放弃→重启恢复→新请求，核验三 run、两稿、Why 0 调用、精确 receipt/canon 与 followup 真实 ACCEPTED/DISCARDED scope。 |
| `native_b71_live_drive.mjs` / `native_b71_strata_state.mjs` | B71 CP3b 实模（真实 provider=strata、单槽预注册模型；历史 iq3_s，2026-11-07 起按 `B71_STRATA_MODEL` 可指定 q2_0）外部驱动与槽位核验 CLI：`B71_PROVIDER=strata B71_SLICE=b71-first-consumer bash scripts/native_b71_batch.sh <tag>` 使用 live 证据目录 `b71-first-consumer-live-<tag>`；驱动只像作者一样输入自然语言创作请求并等待 WS/DB run 终局（不轮询固定回复文本、不假设工具调用次数），采集 AX/WS/llm-calls/DB/canon（live 表级内容签名）/usage/Why 前后 Provider 计数，开始落 `strata-slot-before.json`、finally 只写一次 `strata-slot.json`（证据不可覆盖）并核验 loaded=null；Why 按钮在长消息流下方不可见时先按完整 AX 树定位并滚动后重试（记录 scroll 证据，区分“不存在”与“存在但不可见”）；`native_b71_strata_state.mjs` 供 batch 前后读取/卸载 /v1/models 与 /api/models。判据见 `lib/native_ui/authoring_live_evidence.mjs`（L1–L12 分层 mechanism/model_behavior/not_signed，模型未触发切片如实登记、不代签 G2–G6/I10）。 |
| `StreamingSliceVerify`（test-support）+ `native_b71_drive.mjs` streaming preview journey | B71 R2 后续 checkpoint 真实页面流式正文预览：`B71_PROVIDER=streaming_slice_verify B71_SLICE=b71-authoring-transcript bash scripts/native_b71_batch.sh <tag>`；`novel_agent/test/support/provider/streaming_slice_verify.ex` 仅由 `slice_verify_server.exs` 显式注册（不入生产 registry），把确定性写作 fixture 经真实 OpenAI-compatible SSE 发送（`submit_tentative_artifact` arguments 分片 + 逐片延迟），由统一 SSEStream/decoder 产出 author_content_delta；driver 在生成中从真实窗口 AX 采样「正文生成中」与真实正文片段，`native_b71_evidence.mjs` 的 `verifyStreamPreview` 校验预览不泄漏协议字节（submit_tentative_artifact/item_id）、最终 turn_result 完成；输出 `b71-authoring-transcript-tauri-native-<tag>`（02-prose-preview.*、03-final.*、summary.json）。 |
| `native_b71_evidence.test.mjs` | B71 原生历史核验的正反例：按实际请求逐项比较调用 ID 与顺序，拒绝丢失、错序和伪造，不固定续行次数；计划场景覆盖错序/改写前缀/漏或重复结果/错误工具与预算，以及Why观察窗新增Provider调用的反例。 |
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

AU08 只读 channel 故障复用同一 control 文件，例如 `{"channel_faults":{"get_toc":{"mode":"error","count":1},"get_chapter_content":{"mode":"delay","count":1,"delay_ms":200}}}`。事件仅限 `get_toc` / `get_chapter_content`；`error` 返回同 ref/topic 的 `phx_reply(status=error, reason=external_channel_fault)` 且不调用上游，`delay` 上限 30000ms、到期真实转发；次数 1–10，耗尽自动恢复。代理日志以 `channel_error_injected` / `channel_delay_started` / `channel_delay_released` 记录实际命中，不能用控制文件本身冒充故障已发生。自检：`node --test scripts/native_question_transport_proxy.test.mjs`。


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
