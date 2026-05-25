# SI-003 场景化验收不变量 · I1 因果绑定

- 状态：done
- 类型：Verification Slice（不变量机制）
- 启动日期：2026-05-25
- 完成日期：2026-05-25

## 1. 用户 / 系统目标

[SI-001](./SI-001-scenario-invariants-i3-nonce.md) + [SI-002](./SI-002-scenario-invariants-ci-enforcement.md) 已落地 I3 种子贯通并 CI 强制。本 slice 落地 [I1 因果绑定](../../docs/engineering/scenario-invariants.md#i1--因果绑定causal-binding)：

> TurnResult 中每个 user-facing 创作 artifact 的每个 item 的内容字段（`:title` / `:body` / `:rationale` / `:content`），其字节序列必须 **精确等于** 同一 turn 内某次 Provider 调用响应中对应 item 的字段。

I3 抓 "产品代码 hardcoded"（nonce 不可能在 hardcoded 内容里）。但 I3 不防住 **"产品代码修补 Provider 响应"** ——即 LLM 真返回了 items，但产品代码在 items 上做了改写、补齐、翻译、合并。这些动作 nonce 仍能透传，所以 I3 看不到。

I1 通过 0/1 精确字节相等判定堵这条路径：
1. driver 注入 traced complete_fn 包裹真实 Provider 调用，记录每次调用的 prompt + raw_response + provider_call_id
2. Toolbox 在 items 上写入 provider_call_ref（指回产生该 item 的 Provider 调用）
3. driver 对每个 artifact item 做 forall-exists 判定：`item.provider_call_ref` 必须在 trace 中找到，且解析该 call 的 raw_response 得到的同 item_id 的 raw_item 的 title/body/rationale 必须 **精确字节相等**

任何修补 → driver 判定 fail。

I2（输入差异）留 SI-004。

## 2. 开工检查

- **Contract**：[`docs/engineering/scenario-invariants.md`](../../docs/engineering/scenario-invariants.md) §2.1（I1 形式化）+ §3（捕获关系）+ §5（实施层）
- **Invariant**：I1 · 产品 artifact items 必须能精确字节追溯到本 turn 某次 Provider 响应；不可修补
- **Boundary**：
  - 修改 `apps/novel_domain/lib/novel_domain/tentative_artifact_set.ex` — artifact_item type 加 `provider_call_ref`
  - 修改 `apps/novel_application/lib/novel_application/toolbox.ex` — handle_provider_content 从 complete_fn 返回值读取 provider_call_id 写入 items
  - 新增 `scripts/scenario_invariants/run_i1_causal.exs` — driver
  - 修改 `scripts/ai_static_scan.sh` + `.github/workflows/ci.yml` — 接入 I1 lane
  - 修改 `AGENTS.md` + `docs/engineering/scenario-invariants.md` — 更新 I1 状态
  - 不修改 `NovelAgent.Provider.*`（保持 novel_agent 关注点纯净；trace 责任放在 application 层 + driver）
- **Consumer**：driver、ai_static_scan、CI、AGENTS.md 工作流
- **Proof**：driver 通过 traced complete_fn 注入精确字节追溯链；任何 item 字段与 raw_response 字节不等即 fail
- **Acceptance Driver**：`MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs` exit 0
- **产品代码新增验收感知**：**no**。`provider_call_ref` 字段是合法的因果追溯元数据，等同于 `tool_result_id` / `frame_ref` 等已有的 ID 链；不是验收钩子。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | — |
| novel_domain | yes | TentativeArtifactSet.artifact_item type 加 provider_call_ref |
| novel_agent | no | Provider Gateway / Result struct 不动；trace 责任在 application/driver |
| novel_application | yes | Toolbox.handle_provider_content 从 result 读 provider_call_id 写入 items |
| novel_persistence | no | — |
| novel_web | no | — |
| frontend | no | — |
| docs | yes | scenario-invariants.md 更新 I1 状态；AGENTS.md 加 I1 driver 命令 |
| scripts | yes | scenario_invariants/run_i1_causal.exs；ai_static_scan.sh I1 lane |
| .github/workflows | yes | ci.yml I1 step |
| tasks/slices | yes | 本文件 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 写本 slice 任务 | done | — |
| T2 | TentativeArtifactSet.artifact_item 加 provider_call_ref 字段（type spec） | done | optional 字段，默认 nil 向后兼容 |
| T3 | Toolbox.handle_provider_content 读取 result.provider_call_id 写入 items | done | extract_call_id 兼容 :provider_call_id / "provider_call_id" 两种 key |
| T4 | 写 `scripts/scenario_invariants/run_i1_causal.exs` driver | done | wrap Gateway.complete 注入 trace，forall-exists 精确字节判定 |
| T5 | 跑 driver 确认通过 | done | 3/3 pass，item.title/body/rationale 全字节回溯到 raw_response |
| T6 | 接入 `scripts/ai_static_scan.sh` 新增 i1 lane | done | scenario-invariants-i1 (correctness/critical) |
| T7 | 增加 `.github/workflows/ci.yml` I1 step | done | "Scenario invariants — I1 causal binding" 在 I3 step 后 |
| T8 | AGENTS.md + scenario-invariants.md 更新 I1 状态为"已落地，CI 强制" | done | I1 driver 命令已加入必跑清单 |
| T9 | mix compile + mix test 全绿 | done | 零警告；mix test --max-cases 1 --seed 0 全 583 通过 |
| T10 | I3 driver 仍 pass | done | 无 regression |
| T11 | 负向验证：临时修补 items.body 加后缀，I1 应当 fail | done | 验证通过：3/3 fail + exit 1，revert 后 3/3 pass + exit 0 |

## 5. 不在本 slice 范围（下一 checkpoint）

- I2 差异化输入参数化框架 — 留 SI-004
- 删除 DialogueGateway.creative_direction 中文关键词路由 — 留 SI-005
- TurnResult 持久化 provider_calls 集合（trace 全链路）— 留更后续 slice；本 slice driver 自己 wrap complete_fn 收集 trace，不要求生产路径持久化
- Provider Gateway / NovelAgent.Provider.Result struct 增加 provider_call_id 字段 — 留更后续 slice；本 slice 用 plain map 兼容路径

## 6. 主链覆盖

I1 切穿的链路：

```text
driver 注入 traced complete_fn
→ DialogueGateway.handle_input
→ Planner.form_frame / form_micro_plan（用 traced complete_fn，但 frame/plan 不约束 I1）
→ Toolbox.execute(req, complete_fn) creative_dispatch
→ complete_fn.(prompt) 返回 %{content, provider_call_id}
→ handle_provider_content 解析 items 并把 provider_call_id 写入每个 item.provider_call_ref
→ ToolResult.output.items
→ TurnResultBuilder.build_artifact_set → TentativeArtifactSet.items
→ adoption_state.pending[*].payload.items（带 provider_call_ref）
→ driver 对每个 item 做 forall-exists 精确字节判定
```

## 7. 验收形态（done 判定）

driver 跑通至少 3 case，每个 case 的每个 artifact item 满足：

1. `item.provider_call_ref` 非 nil
2. 该 call_id 能在 traced calls 中找到
3. 该 call 的 raw_response 解析得到的同 item_id 的 raw_item 在 `title/body/rationale` 三个字段上与 item **精确字节相等**

driver exit 0 = done。
