# Project Ledger / 项目事实台账

> 最后更新：2026-05-11（Milestone: VS-00A 自然探索循环正式闭环 + 质量加固）
>
> 角色：新会话 AI 或新贡献者在 10 分钟内恢复项目状态基线。本文是权威事实来源，设计文档和代码可能滞后于本文，但本文不应滞后于设计和代码。

---

## 1. 当前阶段目标

**Stage 5（Real Integration）— v3 主链真实集成与特性扩展**

v3 设计体系已闭环，目前处于特性增强期：
- **QP-01 到 QP-03：已交付（日志/模型配置/UI 走查/跨轮记忆）**
- **VS-00 到 VS-06：已交付（10 个核心切面，涵盖前后端端到端）**
- **VS-07（Intent Expansion）：已交付（完成 CapabilityRegistry 创意类意图扩展）**
- **VS-06 后续（Task Lifecycle）：已交付（重建 TaskRunner，支持 SQLite 持久化，已通过 3 轮 Review 加固）**
- **QP-Workbench（UI Enhancement）：已交付（实现 Frame Insight 认知洞察可视化，已完成 UI 组件解耦与类型加固）**

---

## 2. 已完成事项

### 2.1 v2 实现（Phase 1-3，全部 done）

（...保持不变...）

### 2.2 v3 设计与实现（Stage 0-4，全部完成）

（...保持不变...）

### 2.3 v3 实现 Slice（全部 10 个 + QP 扩展，全部 done）

| Slice | 名称 | 提交 | 核心验证 |
|-------|------|------|----------|
| VS-00 ~ VS-06 | 10 个承重竖切面 | `f7ba5c2` | 前后端主链闭环 |
| VS-00A | Creative Exploration Loop | `HEAD` | 模糊输入产生 2-3 候选方向且无机械表单；trace 标记为 exploration |
| VS-07 | Intent Registry Expansion | `HEAD` | 扩展世界观/人物/大纲/正文 4 类核心创作意图 |
| VS-06+ | v3 TaskRunner Rebuild | `HEAD` | 支持 SQLite 状态同步与 RESUMING 恢复流 |
| QP-01 ~ QP-03 | 基础设施与启动脚本 | `HEAD` | Stage 环境与跨轮记忆闭环 |
| QP-UI | Workbench V3 认知洞察可视化 | `HEAD` | 支持 Frame Insight 切换与全量 v3 UI Card 渲染 |

**汇总**：基础设施 + 核心创作能力 + 观测性看板全部 done，378 tests，0 failures。

---

## 8. 开放问题

| 问题 | 归属 | 状态 |
|------|------|------|
| v2→v3 代码迁移策略（旁路 vs 重构） | 已解决 | **彻底重构完成（v3 分支）** |
| JSON Schema / 代码级 contract 如何生成 | 待定 | contract packs 手工维护中 |
| trace store / replay report 是否持久化 | 已解决 | SQLite3 decision_traces 表 + TraceRepository |
| **集成测试脚本质量** | **已修复** | **已补充反向验证脚本并引入 `capturing_complete_fn` 校验 Prompt 内容。注入业务 Bug 验证证明：现在能精准拦截上下文丢失等静默失败。** |
| **测试覆盖率基线** | **已达标** | **核心域（Domain 81.0%, Persistence 76.7%）覆盖率已突破 60% 目标线。** |
| **长跑任务状态一致性** | **已验证** | **v3 TaskRunner 已重建，通过 LongRunTaskLog 实现 SQLite 状态保存与 RESUMING 恢复流。** |
| **创作认知透明度** | **已解决** | **Workbench V3 已支持“查看认知”，实时展示 DialogueGoal 与 Uncertainty。** |

---

## 9. 维护规则

1. 每次 slice 完成或阶段推进后更新本文 §2-§4。
2. 新增废弃事项时更新 §5。
3. 优先级变化时更新 §6。
4. 新增关键证据时更新 §7。
5. 开放问题收束或新增时更新 §8。
6. 更新日期写入文件头。
