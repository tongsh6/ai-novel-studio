# Phase 1 · Multi-Agent Composition（Agent behaviour + 身份体系）

- 启动日期：2026-04-28
- 范围依据：`docs/design-v2/tech-stack/14-roadmap.md` §6（Phase 1 推荐顺序第 5 项）
- 设计依据：`docs/design-v2/12-multi-agent-composition.md`
- 上一阶段：`tasks/2026-04-28-phase-1-consistency.md`（T1-T3 done）

## 任务清单

| # | 任务 | Status | 关联 commit | 备注 |
|---|---|---|---|---|
| T1 | Agent behaviour 定义 | done | (pending) | `NovelAgent.Agent` behaviour（identity/0 + handle_task/2）|
| T2 | Agent.Writer 真实实现 | done | (pending) | GenServer + behaviour callbacks + Provider.Stub |
| T3 | API 升级：spawn_dummy_agent → spawn_agent | done | (pending) | 公开 API 加 agent_type 参数（默认 `:writer`）；DynamicSupervisor.spawn_agent/4 |
| T4 | 移除 Agent.Dummy | done | (pending) | `git rm` dummy.ex；测试改用 spawn_agent + Process.exit crash |

## 决策日志

- **2026-04-28** — Phase 1 Step 4 启动。实施 Multi-Agent Composition。关键决策：
  - Agent behaviour 最小接口：`identity/0`（返回 agent 身份元数据）+ `handle_task/2`（处理任务请求）
  - Writer 作为第一个真实 Agent 类型，使用 Provider.Stub 做文本生成
  - 保留 spawn agent 的 API 不变但增加 type 参数
  - Reviewer / Planner 留待 Phase 1 后续
