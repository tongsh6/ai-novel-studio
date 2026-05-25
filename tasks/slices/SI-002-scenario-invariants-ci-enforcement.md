# SI-002 场景化验收不变量 · CI 强制力 + Layer-A 闭环

- 状态：done
- 类型：Verification Slice（不变量机制）
- 启动日期：2026-05-25
- 完成日期：2026-05-25

## 1. 用户 / 系统目标

[SI-001](./SI-001-scenario-invariants-i3-nonce.md) 建立了 I3 不变量机制并修复了三处 hardcoded 违规。但当前机制还缺：

1. **强制力**：driver 还没接入 CI、不在 PR 必跑列表里 — AI 下次"再犯"时还能溜过去
2. **Layer-A 闭环**：driver Layer-A（主链 handle_input → Planner）当前 3/3 fail，因为 stub provider 收到 frame/plan prompt 时仍返回 echo 而非合法 JSON，触发 Planner recovery 回退

本 slice 补齐这两条：

- 升级 stub provider 让它识别 frame/plan prompt 返回最小合法 JSON → driver Layer-A 转绿，主链端到端验证 nonce 透传
- 接入 `scripts/ai_static_scan.sh` + GitHub Actions CI + AGENTS.md 强制规则，让 I3 违规不可能在 PR 中存活

I1（因果绑定）+ I2（差异化输入）的实现留 [SI-003](./SI-003-scenario-invariants-trace-causality.md)（待创建）。

## 2. 开工检查

- **Contract**：[`docs/engineering/scenario-invariants.md`](../../docs/engineering/scenario-invariants.md) §2.3（I3）+ §5（实施层）+ §6（诚实退路）
- **Invariant**：I3 不变量必须在 CI 强制；driver 退出码非 0 → CI 红
- **Boundary**：
  - 修改 `apps/novel_agent/lib/novel_agent/provider/stub.ex`（扩展 prompt 识别）
  - 修改 `scripts/ai_static_scan.sh`（增加 I3 lane）
  - 修改 `.github/workflows/ci.yml`（增加 I3 step）
  - 修改 `AGENTS.md`（增加完成后强制规则）
  - 不修产品业务代码（除 stub fixture 增强）
- **Consumer**：`scripts/ai_static_scan.sh` 聚合扫描入口、GitHub Actions CI、AGENTS.md 工作流
- **Proof**：driver Layer-A + Layer-B 全 pass；`bash scripts/ai_static_scan.sh --top 10` 包含 i3 lane；CI workflow 显示 "Scenario invariants (I3 nonce)" step
- **Acceptance Driver**：`MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs` exit 0 且 Layer-A 3/3 pass
- **产品代码新增验收感知**：**no**。stub provider 升级属于合法 fixture provider 增强（scenario-acceptance.md §3 允许）；它根据 prompt 中显式声明的输出格式契约识别请求类型，不是验收钩子。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | — |
| novel_domain | no | — |
| novel_agent | yes | stub provider 增加 frame/plan prompt 识别 |
| novel_application | no | — |
| novel_persistence | no | — |
| novel_web | no | — |
| frontend | no | — |
| docs | yes | AGENTS.md 增加强制规则 |
| scripts | yes | ai_static_scan.sh 增加 i3 lane |
| .github/workflows | yes | ci.yml 增加 i3 step |
| tasks/slices | yes | 本文件 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 写本 slice 任务 | done | — |
| T2 | stub.ex 增加 frame prompt 识别 → 返回最小合法 frame JSON | done | needs_tool=false 兼容 reply-only；user 文本字节透传到 assistant_message；context_used 根据 prompt 段落动态判断 |
| T3 | stub.ex 增加 plan prompt 识别 → 返回最小合法 plan JSON | done | proposed_actions 含 creative_generation capability_invocation |
| T4 | 跑 driver 确认 Layer-A 转绿 | done | Layer-A 3/3 + Layer-B 3/3 全 pass，driver 改为直接走 Gateway.complete（test env 自动用升级后的 Stub） |
| T5 | 接入 `scripts/ai_static_scan.sh` 新增 i3 lane | done | run_check "scenario-invariants-i3" category=correctness severity=critical |
| T6 | 增加 `.github/workflows/ci.yml` I3 step | done | Elixir job 在 Architecture check 之后 |
| T7 | AGENTS.md 增加完成后强制规则 + 禁绕过条款 | done | "场景化验收不变量（机器强制）" 节，列明 I3 命令、禁绕过、豁免登记位置 |
| T8 | DialogueGateway.dispatch_tool 抽函数（顺手清理 Credo 复杂度回归） | done | execute_tool 复杂度从 10 降回 9，Credo 通过 |
| T9 | mix compile --warnings-as-errors + mix test 全绿 | done | 零警告；mix test --max-cases 1 全 583 测试通过 |
| T10 | ai_static_scan.sh 完整跑通含 i3 lane | done | i3 lane: PASS |

## 5. 不在本 slice 范围（下一 checkpoint）

- I1 因果绑定 trace 全链路：Provider 中间件记录 prompt_hash/response_hash、`TentativeArtifactSet.artifact_item.provider_call_ref`、driver 强制 hash 集合包含关系判定 — 留 SI-003
- I2 差异化输入参数化框架：driver 升级支持 N 个独立输入、item_id 集合两两不相交断言 — 留 SI-004
- 删除 `DialogueGateway.creative_direction/2` 中文关键词路由 — 留 SI-005（属于"结构性反不变量"清理，不在 I3 直接命中范围）
- pre-commit hook（.husky/lefthook）— 项目尚未引入 husky；CI 强制力已足够，pre-commit 留下次评估
