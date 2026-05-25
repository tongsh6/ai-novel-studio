# SI-004 场景化验收不变量 · I2 输入差异

- 状态：done
- 类型：Verification Slice（不变量机制）
- 启动日期：2026-05-25
- 完成日期：2026-05-25

## 1. 用户 / 系统目标

[SI-001](./SI-001-scenario-invariants-i3-nonce.md) + [SI-002](./SI-002-scenario-invariants-ci-enforcement.md) + [SI-003](./SI-003-scenario-invariants-i1-causal.md) 已落地 I3 + I1 并 CI 强制。本 slice 落地最后一条 [I2 输入差异](../../docs/engineering/scenario-invariants.md#i2--输入差异input-variation)：

> 对同一 slice 的同一 tool action，用 N 个语义独立的输入跑 N 次，N 次产出的 artifact item_id 集合必须**两两不相交**。

I3 抓 hardcoded（nonce 不出现）。I1 抓字节修补（hash 不等）。但 I3+I1 不防住 **"产品代码按输入分支返回不同 hardcoded"**：

```elixir
def generate_items(input) do
  cond do
    String.contains?(input, "赛博") -> [hardcoded_set_a]
    String.contains?(input, "末日") -> [hardcoded_set_b]
    String.contains?(input, "古风") -> [hardcoded_set_c]
  end
end
```

只要 hardcoded set 的 body 偶然含 nonce（被人为 inject）或经过 I1 字节透传，I3+I1 都看不见。但 I2 立刻 catch：第 4 个输入主题（如"科幻"）会让 cond 树爆炸；或者三个语义独立输入（输入 A/B/C）若 hardcoded 共享 item_id 命名（如 `stub_item_1`），item_id 集合不两两不相交 → fail。

I2 把"按输入分支预制"的伪造路径堵死。

## 2. 预期的现状违规

当前 `NovelAgent.Provider.Stub.creative_items_json/1` 返回固定 `item_id = "stub_item_1"`，与 user input 无关。这是 stub 的当前实现 — 它**自己就违反了 I2**。

跑 I2 driver baseline 应该 fail（3 个 case 的 item_id 集合全部包含 `stub_item_1`，两两相交）。SI-004 修复 stub 让 item_id 基于 user input fingerprint，把违规变为 pass。

## 3. 开工检查

- **Contract**：[`docs/engineering/scenario-invariants.md`](../../docs/engineering/scenario-invariants.md) §2.2（I2 形式化）+ §3（捕获关系）
- **Invariant**：I2 · N 个语义独立输入跑 N 次，artifact item_id 集合两两不相交
- **Boundary**：
  - 修改 `apps/novel_agent/lib/novel_agent/provider/stub.ex` — `creative_items_json` 把 user input fingerprint 注入 item_id
  - 新增 `scripts/scenario_invariants/run_i2_variation.exs` — driver
  - 修改 `scripts/ai_static_scan.sh` + `.github/workflows/ci.yml` — 接入 I2 lane
  - 修改 `AGENTS.md` + `docs/engineering/scenario-invariants.md` — 更新 I2 状态
- **Consumer**：driver、ai_static_scan、CI、AGENTS.md
- **Proof**：driver 跑 N=3 独立输入 → item_id 集合两两不相交 → pass
- **Acceptance Driver**：`MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs` exit 0
- **产品代码新增验收感知**：**no**。stub `item_id` 从输入派生是合法的 fixture provider 行为（真实 LLM 也会基于 prompt 上下文生成不同 id），符合 scenario-acceptance.md §3 允许项。

## 4. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | — |
| novel_domain | no | — |
| novel_agent | yes | stub.ex item_id 含输入 fingerprint |
| novel_application | no | — |
| novel_persistence | no | — |
| novel_web | no | — |
| frontend | no | — |
| docs | yes | scenario-invariants.md 更新 I2 状态；AGENTS.md 加 I2 driver 命令 |
| scripts | yes | scenario_invariants/run_i2_variation.exs；ai_static_scan.sh I2 lane |
| .github/workflows | yes | ci.yml I2 step |
| tasks/slices | yes | 本文件 |

## 5. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 写本 slice 任务 | done | — |
| T2 | 跑 I2 driver baseline（修 stub 前），预期 fail | done | 3 对全相交 exit 1，命中现状违规 |
| T3 | 修复 stub.creative_items_json — item_id 含 user input fingerprint | done | `stub_item_<phash2_base36>_1` |
| T4 | 跑 I2 driver 确认 pass | done | 3 pairs disjoint, 0 violations, exit 0 |
| T5 | 接入 `scripts/ai_static_scan.sh` 新增 i2 lane | done | scenario-invariants-i2 (correctness/critical) |
| T6 | 增加 `.github/workflows/ci.yml` I2 step | done | "Scenario invariants — I2 input variation" 在 I1 step 后 |
| T7 | AGENTS.md + scenario-invariants.md 更新 I2 状态为"已落地，CI 强制" | done | 三条全部"已落地、CI 强制"|
| T8 | mix compile + mix test 全绿 | done | 零警告；mix test --max-cases 1 全 583 通过 |
| T9 | I1 + I3 driver 仍 pass | done | 无 regression |
| T10 | 负向验证：临时让 stub 回到固定 item_id，I2 应当 fail | done | 验证通过：3 对全相交 exit 1，revert 后回 disjoint |

## 6. 不在本 slice 范围

- 删除 `DialogueGateway.creative_direction/2` 中文关键词路由 — 留 SI-005
- TurnResult 持久化 provider_calls 集合（trace 全链路）— 留更后续
- pre-commit hook — 项目尚未引入 husky，CI 强制力已足够

## 7. 验收形态（done 判定）

driver 跑 N=3 独立输入，输出 3 个 item_id 集合，pairwise_disjoint 全部为 true。driver exit 0 = done。

负向验证（临时回退 stub）driver 必须 exit 1，证明机制真的 catch。
