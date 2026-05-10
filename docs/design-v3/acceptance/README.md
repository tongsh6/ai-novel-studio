# v3 验收场景全景

> 最后更新：2026-05-10
>
> 本目录包含 AI Novel Studio v3 的完整验收场景文档。按两种用户视角组织：**系统用户**（自然人，配置和运行软件）和**作者用户**（核心用户，用 AI 写小说）。

---

## 用户模型

```
自然人（系统用户）                    作者（核心用户）
─────────────────                    ─────────────────
配置模型供应商                        与 AI 聊创作
切换作品项目                          探索创作方向
给 AI 起名字                          AI 基于作品上下文给建议
                                     审核 AI 执行计划并确认
                                     采纳 AI 生成的候选内容
                                     处理系统的追问和确认
                                     理解 AI 的决策过程
```

---

## 文档索引

### 系统用户验收（3 文档）

| 文档 | 能力 | 场景 | 覆盖率 | 状态 |
|------|------|------|--------|------|
| [SU-01](system/SU-01-model-provider.md) | 切换模型供应商 | 9 | 22% | 基础实现 |
| [SU-02](system/SU-02-work-switching.md) | 切换作品 | 9 | 11% | 基础实现 |
| [SU-03](system/SU-03-model-nickname.md) | 给模型起名 | 3 | 0% | 未实现 |

### 作者用户验收（7 文档）

| 文档 | 能力 | 场景 | 覆盖率 | 状态 |
|------|------|------|--------|------|
| [AU-01](author/AU-01-chat.md) | 与 AI 聊创作 | 10 | 80% | 核心已实现 |
| [AU-02](author/AU-02-explore.md) | 探索创作方向 | 6 | 67% | 核心已实现 |
| [AU-03](author/AU-03-context.md) | AI 了解我的作品 | 6 | 100% | 已实现 |
| [AU-04](author/AU-04-execute-and-confirm.md) | 执行任务与确认 | 7 | 86% | 核心已实现 |
| [AU-05](author/AU-05-artifact-adoption.md) | 采纳创作产物 | 5 | 100% | 已实现 |
| [AU-06](author/AU-06-behavior-lifecycle.md) | 行为生命周期 | 7 | 86% | 核心已实现 |
| [AU-07](author/AU-07-trace-and-replay.md) | 决策溯源透明度 | 5 | 80% | 核心已实现 |

---

## 不变量覆盖矩阵

v3 系统 15 个不变量（来自 `00c` §7）与验收文档的映射：

| 不变量 | AU-01 | AU-02 | AU-03 | AU-04 | AU-05 | AU-06 | AU-07 |
|--------|:-----:|:-----:|:-----:|:-----:|:-----:|:-----:|:-----:|
| #1 每 turn 必有 frame | ● | ● | ● | | | | |
| #2 MicroPlan 只是建议 | | | | ● | | | |
| #3 Orchestrator 唯一门禁 | | | | ● | | | |
| #4 默认只允许下一步 | | | | ● | | | |
| #5 工具调用有 trace | | | | | | | ● |
| #6 写入默认 tentative | | | | ● | ● | | |
| #7 behavior 有生命周期 | | | | | | ● | |
| #8 缺 slot 不自动表单 | | ● | ● | | | ● | |
| #9 TurnResult canonical | ● | ● | | | | | ● |
| #10 UI 只能提交 action | | | | | | ● | |
| #11 selection ≠ adoption | | | | | ● | | |
| #12 确认后重新 gate | | | | ● | ● | ● | |
| #13 trace summary 脱敏 | | | ● | | | | ● |
| #14 replay 不调 LLM | ● | | | | | ● | ● |
| #15 projection 只刷新 | | | | | ● | | |

**不变量覆盖率：15/15（100%）**

---

## 测试总览

```bash
# 全部验收关联测试 — 一键运行
mix test apps/novel_application/test/novel_application/
mix test apps/novel_web/test/novel_web/channels/
```

| 测试文件 | 关联文档 | 测试数 |
|---------|---------|--------|
| `dialogue_gateway_test.exs` | AU-01, AU-02 | 13 |
| `context_grounding_test.exs` | AU-03 | 12 |
| `execution_authority_test.exs` | AU-04 | 18 |
| `adoption_boundary_test.exs` | AU-05 | 9 |
| `creative_artifact_test.exs` | AU-05 | 12 |
| `behavior_lifecycle_test.exs` | AU-06 | 8 |
| `action_roundtrip_test.exs` | AU-06, AU-07 | 8 |
| `replay_service_test.exs` | AU-07 | 6 |
| `workspace_channel_v3_test.exs` | AU-01, AU-04, SU-02 | 12 |

**总计：98 个测试，0 个失败，13 个被排除（需 real LLM / integration）**

---

## 缺口总览

| 缺口 | 关联文档 | 类型 | 优先级 |
|------|---------|------|--------|
| LLM 不可用降级测试 | AU-01 GAP-01 | 缺测试 | P0 |
| LLM 乱码降级测试 | AU-01 GAP-02 | 缺测试 | P0 |
| 持续追问多轮测试 | AU-02 GAP-01 | 缺测试 | P1 |
| 探索阶段不强制 action | AU-02 GAP-02 | 缺测试 | P1 |
| 部分上下文场景 | AU-03 GAP-01 | 缺测试 | P1 |
| 确认幂等性测试 | AU-04 GAP-01 | 缺测试 | P0 |
| 确认过期处理 | AU-04 GAP-02 | 缺测试 | P1 |
| 高风险候选二次确认 | AU-05 GAP-01 | 缺测试 | P1 |
| ProjectionHint 验证 | AU-05 GAP-02 | 缺测试 | P1 |
| 取消行为端到端 | AU-06 GAP-01 | 缺测试 | P1 |
| 行为过期 TTL | AU-06 GAP-02 | 缺设计 | P2 |
| 行为覆盖 Superseded | AU-06 GAP-03 | 缺设计 | P2 |
| reason_code 人类可读 | AU-07 GAP-01 | 缺实现 | P2 |
| 可视化溯源 | AU-07 GAP-02 | 缺前端 | P2 |
| 脱敏专用测试 | AU-07 GAP-03 | 缺测试 | P1 |
| 供应商 UI 全套 | SU-01 GAP-01~04 | 缺实现 | P0 |
| 作品 CRUD 全套 | SU-02 GAP-01~05 | 缺实现 | P0 |
| 显示名存储 | SU-03 GAP-01~02 | 缺实现 | P2 |

**总缺口：18 个 | P0: 5 | P1: 9 | P2: 4**

---

## 文档结构约定

每个验收文档统一使用 8 节结构：

```
# Title
> 视角概述
## 1. 我能做什么          — 用户能力表（我能做什么 | 系统怎么回应）
## 2. 不变量               — 映射到 00c §7（AU）或自定义（SU）
## 3. 契约引用             — ADR / Contract Pack / 代码文件
## 4. 验收场景             — Given/When/Then 格式，按场景组分节
## 5. 场景覆盖状态          — 表格 + 通过率
## 6. 缺口                 — 表格：影响 + 建议处理
## 7. 已知限制 / 现有基础设施 — 可选
## 8. 验收命令              — 可执行的测试命令
```
