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
| `au04-confirm-before-execute.yml` | 高风险执行先确认并重新 gate |
| `au04-confirm-idempotency-ui.yml` | 高风险确认重复点击不重复执行 |
| `au04-stale-confirmation-ui.yml` | 旧确认在上下文推进后不能执行 |
| `au04-confirmation-ttl-ui.yml` | 过期确认不能执行 |
| `au04-history-confirmation-readonly.yml` | 历史确认只读不可执行 |
| `au04-cross-work-confirmation-guard.yml` | 跨作品切换后源作品确认不可执行 |
| `au04-latest-context-rebase-confirmation.yml` | 确认执行前作品变化会被重新组装进 re-gate |
| `au05-adoption-safety-freshness.yml` | 采纳安全与新鲜度 |
| `au05-canon-conflict-recovery.yml` | 正典冲突恢复 |
| `au05-conflict-cross-work-recovery.yml` | 跨作品冲突恢复 |
| `au05-stale-conflict-cross-work-freshness.yml` | 过期候选跨作品新鲜度拒绝 |
| `au10-micro-plan-entry.yml` | 微计划入口 |
| `au11-quality-diagnosis-message-envelope.yml` | AI 引导式创作质量诊断 message envelope |
| `dogfood-runner.yml` | P1 长篇狗粮运行器 |
| `p1-chapter-draft-generation.yml` | 章节草稿生成闭环 |
| `p1-chapter-plan-minimum.yml` | 章节计划最小闭环 known-gap |
| `su01-api-key-secret-redaction.yml` | API Key 配置流与 secret redaction |
| `su01-keychain-webview-roundtrip.yml` | 真实 Tauri WebView Keychain 写读与脱敏 |
| `su01-lmstudio-disconnected-health.yml` | LM Studio 未启动时的模型断开态 |
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
| `vs10-observability-spine.yml` | 浏览器可观测性主链 |
