# quality/acceptance/scenarios/

单场景验收 manifest 目录。总表入口是 `../scenarios.yml`；本目录文件只描述验收标准、证据要求和 anti-hook 边界，不替代外部 driver。

## Files

| 文件 | 场景 |
|---|---|
| `au01-empty-message-guard.yml` | 空消息不会创建聊天 turn |
| `au01-frame-validation-friendly-error.yml` | frame 校验失败时作者友好提示 |
| `au01-garbage-json-recovery.yml` | LLM 乱码 JSON 时友好降级并恢复聊天 |
| `au01-ordinary-chat-two-turn-roundtrip.yml` | 普通聊天两轮真实工作台闭环 |
| `au01-turnresult-recorder-ui-consistency.yml` | TurnResult、recorder 与恢复 UI 一致 |
| `ua01-agent-bounded-roster-to-character-design.yml` | 复合角色任务启动 bounded AgentRun 并产出待采纳角色草稿 |
| `agent-bounded-roster-to-character-design.yml` | AgentRun 角色阵容 Observation 传递到角色设计 |
| `agent-step-regate.yml` | 每个 AgentStep 重新经过 Orchestrator gate |
| `agent-no-multistep-plan-bypass.yml` | AgentRun 不把多步计划作为 ToolRequest 批量旁路执行 |
| `agent-event-author-safe.yml` | AgentEvent 只暴露作者安全摘要和引用 |
| `agent-channel-fast-ack.yml` | Channel 快速返回 bounded run_id 后异步广播结果 |
| `agent-interrupt-safe-point.yml` | AgentRun pause 在协作式 safe point 停止 |
| `agent-cancel-target-binding.yml` | AgentRun cancel 绑定 active run_id 并协作式取消 |
| `agent-steer-replan.yml` | AgentRun steer 绑定 active run_id 并广播重规划状态 |
| `agent-natural-language-steer.yml` | 运行中主输入框自然语言 steering 绑定 active AgentRun |
| `agent-loop-budget-limit.yml` | AgentRun 受作者预算限制停止等待作者 |
| `agent-no-progress-stop.yml` | AgentRun 重复无进展时停止等待作者 |
| `agent-archive-read-during-run.yml` | AgentRun 运行中作品档案仍可读取 |
| `agent-tentative-boundary.yml` | Agent 产物保持 tentative，不自动采纳或写主档案 |
| `agent-revision-orchestrator-boundary.yml` | 修订候选动作重新经过 Orchestrator 后再执行 |
| `agent-replay-no-provider.yml` | Agent/修订 replay policy 不重新调用 provider |
| `agent-work-isolation.yml` | 源作品 AgentRun 迟到输出不污染切换后的目标作品 |
| `agent-provider-call-budget.yml` | AgentRun step/tool/provider 调用预算可追踪 |
| `agent-durable-resume-long-run-task.yml` | Durable AgentRun 关联 LongRunTask 并可恢复（CP5，active/nightly） |
| `agent-provider-execution-stream-unified.yml` | 普通对话 ProviderExecution facts 投影为 author-safe 工作轨迹，并可见 request_prepared / request_dispatched / provider_chunk / response_received 中间进展（CP4D/CP5/CP6，active/nightly） |
| `agent-provider-execution-activity-restored.yml` | ProviderExecution activity 从持久 AgentRun events 恢复到同一对话流，并通过 scoped ProviderRun API 查询 author-safe usage/event/output summary；加严断言要求 ProviderRun 事件序列、输出摘要和 no-provider-recall 边界在同一 assistant 工作详情中可见（CP6，active/nightly） |
| `agent-provider-execution-error-author-safe.yml` | 普通对话 ProviderExecution error facts 投影为 author-safe 工作轨迹（CP6，nightly active） |
| `agent-provider-streaming-progress.yml` | Provider execution progress 进入 AgentRun author-safe 事件流（CP6 历史场景名，nightly active） |
| `agent-provider-cancel-honest-boundary.yml` | Provider cancel 通过统一 ProviderExecution 取消（CP6，nightly active） |
| `agent-readonly-batch-profile.yml` | AgentRun 只读 batch profile 可并行读取且不写作品事实（CP6，nightly active） |
| `agent-prose-drafting-with-quality.yml` | AgentRun 正文草稿 Profile 复用正文质量复核链路 |
| `agent-conversation-turn.yml` | 普通对话输入统一进入 AgentRun |
| `agent-plot-outline-with-context.yml` | AgentRun 章节大纲 Profile 生成待采纳大纲草稿 |
| `agent-character-evolution-with-context.yml` | AgentRun 角色演化 Profile 生成待采纳角色记忆草稿 |
| `au02-candidate-adoption-bridge.yml` | 候选方向选择与采纳边界 |
| `au02-candidate-continuation.yml` | 候选方向继续讨论 |
| `au02-candidate-fallback-ui.yml` | 候选坏格式 fallback 仍渲染可用候选卡 |
| `au02-candidate-multiturn-context.yml` | 候选方向继续讨论后的多轮上下文保持 |
| `au02-freeform-followup-after-candidate.yml` | 候选卡出现后仍可自由追问 |
| `au02-natural-exploration-no-slot-form.yml` | 模糊想法自然探索且不弹机械表单 |
| `au02-unadopted-candidate-no-reading-fact.yml` | 未采纳候选不进入阅读或作品事实 |
| `au03-archive-session-filter.yml` | 归档会话默认隐藏且可搜索回看 |
| `au03-branch-from-history.yml` | 从历史会话继续创建新分支会话 |
| `au03-context-source-ui.yml` | 上下文来源可见解释 |
| `au03-current-work-context-ssot.yml` | 最新作品背景与当前会话 transcript 分层 |
| `au03-long-session-compression.yml` | 长会话压缩上下文 |
| `au03-session-history-readonly.yml` | 历史会话只读回看 |
| `au03-session-new-active.yml` | 新建会话成为当前 ACTIVE，原 ACTIVE 转为只读历史 |
| `au07-behavior-trace-terminal-replay.yml` | Behavior terminal close/resolution refs 可回放 |
| `au07-gate-reason-why.yml` | action_scope 降级为什么解释 |
| `au07-partial-replay-ui.yml` | 旧 turn partial replay 诚实提示 |
| `au07-persisted-trace-query.yml` | 旧 turn 为什么入口通过持久 trace scoped replay 回查 |
| `au07-trace-query-scope-negative-matrix.yml` | trace 查询跨作品/会话负向矩阵 |
| `au07-tooltrace-registry-redacted-io.yml` | ToolTrace registry snapshot 与 redacted I/O |
| `au07-state-trace-adoption-replay.yml` | 采纳与阅读投影携带可回放 StateTrace |
| `au07-trace-why-entry.yml` | 工作台为什么入口与 author-safe trace 摘要 |
| `au08-reading-return-context.yml` | 阅读返回工作台后保持同一 work/session 上下文 |
| `au08-reading-readonly-no-write.yml` | 阅读模式查看、导出和返回保持只读 |
| `au09-adopt-setting-recall.yml` | 档案伏笔规则采纳为可召回设定 |
| `au09-archive-stats-current.yml` | 作品档案概览统计读取当前作品真实事实 |
| `au09-au03-session-memory-layering.yml` | AU-03 会话与 AU-09 记忆来源分层 |
| `au09-character-dossier-roundtrip.yml` | 角色主档案采纳回写并进入后续上下文 |
| `au09-cross-work-memory-isolation.yml` | 跨作品记忆与档案隔离 |
| `au09-memory-create-recall.yml` | 作者创建确认记忆后进入对话召回 |
| `au09-memory-management-entry.yml` | 记忆管理入口与生命周期终态不召回 |
| `au09-memory-management-filter-matrix.yml` | 记忆管理筛选矩阵 |
| `au09-memory-trace-roundtrip.yml` | 记忆生命周期与引用追溯 |
| `au09-validity-window-recall.yml` | 章节有效期窗口过滤记忆召回 |
| `au04-confirm-before-execute.yml` | 高风险执行先确认并重新 gate |
| `au04-confirmation-tool-failure-recovery.yml` | 确认后工具失败可恢复且不生成待采纳草稿 |
| `au04-confirm-idempotency-ui.yml` | 高风险确认重复点击不重复执行 |
| `au04-stale-confirmation-ui.yml` | 旧确认在上下文推进后不能执行 |
| `au06-single-active-confirmation.yml` | 单一活跃 confirmation 只允许最新等待态执行；同时为 AU-03 A4 提供开放 behavior author-safe context ref 证据 |
| `au04-confirmation-ttl-ui.yml` | 过期确认不能执行 |
| `au04-disabled-confirmation-action-ui.yml` | 禁用确认动作不可提交 |
| `au04-history-confirmation-readonly.yml` | 历史确认只读不可执行 |
| `au04-cross-work-confirmation-guard.yml` | 跨作品切换后源作品确认不可执行 |
| `au04-latest-context-rebase-confirmation.yml` | 确认执行前作品变化会被重新组装进 re-gate |
| `au05-adoption-safety-freshness.yml` | 采纳安全与新鲜度 |
| `au05-canon-conflict-recovery.yml` | 正典冲突恢复 |
| `au05-conflict-cross-work-recovery.yml` | 跨作品冲突恢复 |
| `au05-discard-author-action.yml` | 放弃待采纳草稿不写入作品事实 |
| `au05-stale-conflict-cross-work-freshness.yml` | 过期候选跨作品新鲜度拒绝 |
| `au10-micro-plan-entry.yml` | 微计划入口 |
| `au10-workbench-matrix-layout.yml` | 工作台 1280x800 基线矩阵 |
| `au10-workbench-recovery-cancel-waiting.yml` | 取消确认等待后工作台可继续 |
| `au10-workbench-recovery-disconnect-timeout.yml` | Provider 不可达后工作台可恢复 |
| `au10-workbench-recovery-provider-timeout.yml` | Provider 超时后工作台可恢复 |
| `au10-workbench-recovery-reconnect.yml` | WebSocket 断线重连后工作台可继续 |
| `au10-workbench-recovery-taskstate.yml` | 工作台 task_state 生命周期可见 |
| `au11-quality-diagnosis-message-envelope.yml` | AI 引导式创作质量诊断 message envelope |
| `au11-missing-workstate-policy.yml` | AI 引导式创作缺 WorkState 不编造 |
| `au12-work-profile-overview.yml` | 作品档案立项概览只读视图 |
| `au12-profile-read-failure-degrade.yml` | 作品档案读取失败诚实降级与重试恢复 |
| `au12-correction-intent-roundtrip.yml` | 作品档案立项修订意图回到对话与采纳边界 |
| `au12-work-profile-status-isolation.yml` | 作品档案状态、空字段与跨作品隔离 |
| `dogfood-runner.yml` | P1 长篇狗粮运行器 |
| `e2e-01-downgrade-real-page.yml` | E2E-01 真实页面多步 MicroPlan 降级 |
| `e2e-01-full-chain.yml` | E2E-01 端到端全链路聚合验收 |
| `e2e-01-readonly-tool-trace.yml` | E2E-01 只读工具调度与 trace 回查 |
| `e2e-01-replay-report.yml` | E2E-01 ReplayReport 六问结构化回放 |
| `e2e-01-channel-action-security.yml` | E2E-01 Channel action 来源与授权安全回归 |
| `p1-chapter-adoption-reading.yml` | 已采纳章节正文进入阅读投影 |
| `p1-chapter-draft-generation.yml` | 章节草稿生成闭环 |
| `p1-chapter-edit-then-accept.yml` | 修改后保存正文进入阅读投影 |
| `p1-chapter-expansion.yml` | 自然续写累积单章达标 |
| `p1-chapter-expansion-multichapter.yml` | 多章正文各归各章并可导航阅读 |
| `p1-chapter-overwrite-confirm.yml` | 覆盖已有章节必须确认并原位替换 |
| `p1-chapter-plan-minimum.yml` | 章节计划最小闭环 nightly |
| `p1-chapter-word-count-target.yml` | 作者目标字数进入正文生成链路 |
| `p1-export-minimum.yml` | 阅读投影导出全书 Markdown |
| `p1-plan-incremental.yml` | 增量章节规划追加新章且不改旧章 |
| `p1-word-count-audit.yml` | 阅读投影短章审计与 P1 进度 |
| `su01-api-key-secret-redaction.yml` | API Key 配置流与 secret redaction |
| `su01-local-secret-file-roundtrip.yml` | 真实 Tauri WebView 本地密钥文件写读与脱敏 |
| `su01-lmstudio-disconnected-health.yml` | LM Studio 未启动时的模型断开态 |
| `su01-model-provider-switching.yml` | 模型供应商运行时切换 |
| `su01-provider-endpoint-validation.yml` | 供应商 endpoint URL 校验 |
| `su01-provider-health-model.yml` | 供应商健康状态与模型徽标 |
| `su01-provider-model-list-success.yml` | 供应商实时模型列表成功矩阵 |
| `su01-provider-test-failure-ui.yml` | 模型测试连接失败反馈与恢复 |
| `su02-artifact-projection-trace-isolation.yml` | 作品间 artifact / projection / trace 隔离 |
| `su02-empty-start-unnamed-work.yml` | 空工作区自动启动未命名作品 |
| `su02-work-lifecycle-management.yml` | 作品生命周期命名新增、改名与安全移出 |
| `su02-pending-result-work-isolation.yml` | 慢回复迟到结果按作品归属 |
| `su02-work-restart-recovery.yml` | 作品重启恢复与 stale lastOpened 降级 |
| `su02-work-switching.yml` | 运行时作品切换与 Channel 重连 |
| `su03-assistant-display-name.yml` | AI 显示名按作品隔离 |
| `vs00c-cp3-structured-context.yml` | VS-00C CP3 结构化章节上下文 |
| `vs00c-cp4-chapter-plan-structure.yml` | VS-00C CP4 结构化章方向 |
| `vs00c-cp5-reader-effect-brief.yml` | VS-00C CP5 读者效果与自报告 |
| `vs00c-cp0-missing-chapter-block.yml` | VS-00C CP0 缺失目标章阻断写作 |
| `vs10-observability-spine.yml` | 浏览器可观测性主链 |
