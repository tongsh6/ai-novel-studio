# Phase 0 · Week 3 · 横切层 + Provider Gateway

- 启动日期：2026-04-28
- 范围依据：`docs/design-v2/tech-stack/14-roadmap.md` §4（任务定义在那里，本文件仅跟踪状态）
- 完成标准依据：同上 §4.2
- 上一周：`tasks/2026-04-27-phase-0-week-2-supervision-persistence.md`（10/10 done）

## 任务清单

引自 `14-roadmap.md` §4.1。

| # | 任务 | Status | 关联 commit | 备注 |
|---|---|---|---|---|
| T1 | Provider Gateway behaviour + Stub 实现 | done | `46c7cb7` | `NovelAgent.Provider` behaviour（complete/3 + name/0）+ `Provider.Stub`（08-provider-abstraction.md §2.4：stub 作为正式实现）；3 tests |
| T2 | 第一个 capability — simple_complete | done | `46c7cb7` | `NovelAgent.Capabilities.SimpleComplete.execute/3`；集成 Authority Gate + Budget Meter + Telemetry；2 tests |
| T3 | Authority Gate 骨架（GenServer） | done | `46c7cb7` | `NovelAgent.AuthorityGate`（Phase 0 全放行，`authorize/2` → `:allowed`）；纳入监督树；2 tests |
| T4 | Budget Meter 骨架（GenServer + telemetry） | done | `46c7cb7` | `NovelAgent.BudgetMeter`（`record/2` + `usage/0`）；cast 触发 `:telemetry.execute`；纳入监督树；2 tests（含 telemetry 事件验证） |
| T5 | Telemetry 事件处理 + Audit Log JSONL | done | `46c7cb7` | `NovelAgent.Telemetry.attach_all/0` 注册 capability/authority/budget 三大事件；`NovelAgent.AuditLog.append/1` JSONL 文件追加；2 tests |
| T6 | CI 完善 — dialyzer + credo + arch_check | done | `46c7cb7` | CI workflow 加 `mix dialyzer`（PLT 缓存到 `priv/plts/`）；`.gitignore` 加 `/priv/plts/` + `/log/`；format/credo/xref/arch_check 全部门禁通过 |

完成标准（来自 `14-roadmap.md` §4.2）：
- [x] 调用 SimpleComplete.execute 返回 provider 响应（Stub echo）
- [x] Authority denied 时 capability 拒绝执行（代码路径已建立，Phase 0 全放行模式）
- [x] Budget Meter telemetry 事件可被 handler 接收
- [x] Audit log 文件有正确 JSONL 条目
- [ ] 完整 OTel trace（留待 Phase 1 — 当前用 `:telemetry` + stdout + JSONL 代替）
- [x] CI dialyzer/credo/arch_check 全部集成

## 决策日志

倒序，最新在上。

- **2026-04-28** — Week 3 全部 6/6 完成（commit `46c7cb7`）。关键决策：
  - **Provider behaviour 最小接口**：仅 `complete/3` + `name/0`。设计文档 `08-provider-abstraction.md` §4.1 要求 complete/stream/estimate/describe 四个接口，stream/estimate/describe 留待后续 Phase 按需添加（YAGNI）。
  - **Stub provider 是正式实现**：按 08-provider-abstraction.md §2.4 设计，stub 不放在 test/ 目录，而是正式模块 `NovelAgent.Provider.Stub`。
  - **Authority Gate 用 GenServer**：Phase 0 全放行模式，但走 GenServer.call 路径，后续加 policy 时改 handle_call 即可。
  - **Budget Meter 用 GenServer.cast**：异步记录，不影响 capability 执行热路径；telemetry 在 handle_cast 内同步发射。
  - **Audit log 路径可配置**：`Application.get_env(:novel_agent, :audit_log_dir, "log")`，测试可覆盖到 tmp_dir。
  - **OTel 完整集成推迟**：Phase 0 Week 3 用 `:telemetry` + stdout Logger + JSONL audit log 覆盖可观测性需求。完整 OpenTelemetry-erlang 集成（含 span context propagation、exporter）在 Phase 1 有真实分布式调用后再实施。
  - **`:telemetry` 作为 novel_agent 显式依赖**：虽然 umbrella 共享 deps（telemetry 已是 Phoenix 传递依赖），但显式加到 mix.exs 以表明依赖方向。
  - **CI dialyzer PLT 缓存**：`config.exs` 加 `plt_local_path: "priv/plts"`，CI 用 actions/cache 缓存，避免每次冷构建 PLT。

## 卡点 / TBD

- **OTel 完整集成**：推迟到 Phase 1。当前 telemetry 事件已发射，handler 已附加，stdout + JSONL 已覆盖 Phase 0 可观测性需求。
- **Provider 真实实现**（OpenAI 兼容 / LM Studio）：Week 4+ 或 Phase 1，当 capability 需要真 LLM 时接入。

## 下次会话恢复指引

接手者按以下顺序读取上下文：

1. `docs/design-v2/tech-stack/14-roadmap.md` §4（Week 3 任务源）+ §4.2（完成标准）
2. `docs/design-v2/08-provider-abstraction.md`（Provider 设计 contract）
3. 本文件 §任务清单（当前到哪）+ §决策日志（为什么这么走）

**当前状态：Week 3 全部 6/6 完成。** Agent Runtime 基石已就绪（Provider + Authority + Budget + Telemetry + Audit），准备进入 Week 4（端到端 smoke test）。
