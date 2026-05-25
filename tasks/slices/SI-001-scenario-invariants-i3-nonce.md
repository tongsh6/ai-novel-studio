# SI-001 场景化验收不变量 · I3 种子贯通

- 状态：done（CI 接入留 SI-002）
- 类型：Verification Slice（不变量机制）
- 启动日期：2026-05-24
- 完成日期：2026-05-25

## 1. 用户 / 系统目标

把"产品代码不得为了验收而预制创作内容"这条红线，从 [`AGENTS.md` §场景化验收红线](../../AGENTS.md) 的文字翻译为机器可强制的 0/1 不变量。

本 slice 先落地三条不变量中收益最大、成本最低的 **I3 种子贯通**：

> 验收脚本在用户输入中嵌入一次性随机字符串（nonce），该 nonce 必须出现在最终 user-facing artifact 内容字段中。

落地后，AI 在生产路径内写下的任何 hardcoded 创作内容（角色、章节、正文）都会立刻被 I3 抓——因为它们永远不可能包含本次随机 nonce。

I1（因果绑定）与 I2（输入差异）作为后续 slice 落地。

## 2. 开工检查

- **Contract**：[`docs/engineering/scenario-invariants.md`](../../docs/engineering/scenario-invariants.md) §2.3（I3 形式化定义）+ §5.2（报告格式）
- **Invariant**：I3 · 用户输入中的 nonce 必须出现在最终 artifact 内容字段；不满足 → 0/1 fail
- **Boundary**：
  - 涉及 `novel_application/toolbox`、`novel_application/dialogue_gateway`、`novel_application/turn_result_builder` 三处既有违例的产品代码
  - 涉及 `apps/novel_domain/tentative_artifact_set`（item 字段透传）
  - 不修改 `novel_persistence` 表结构、不修改 `novel_web` 路由
  - 新增 `scripts/scenario_invariants/run_i3_nonce.exs`
- **Consumer**：`scripts/ai_static_scan.sh`（聚合入口）、CI workflow、pre-commit hook
- **Proof**：在产品代码修复前，driver 在 P1 三个 slice 上报 fail（基线）；修复后 driver 报 pass（闭环）
- **Acceptance Driver**：`bash scripts/scenario_invariants/run_i3_nonce.exs` 通过真实 dialogue 入口注入 nonce 输入，检查最终 artifact items 是否包含 nonce
- **产品代码新增验收感知**：**no**。nonce 是真实用户输入的一部分，产品代码不需要知道它是 nonce——它只需要把用户输入诚实地传给 Provider 并把 Provider 响应字节透传给 artifact。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | — |
| novel_domain | yes | 给 `TentativeArtifactSet.artifact_item` 加 `provider_call_ref` 字段（默认 nil，向后兼容） |
| novel_agent | no | Provider Gateway / stub 已具备 nonce 透传能力，不改 |
| novel_application | yes | Toolbox 在具体 creative capability 路径接通 Provider；DialogueGateway 删除中文关键词路由；TurnResultBuilder 删除作品专项默认文案 |
| novel_persistence | no | — |
| novel_web | no | — |
| frontend | no | — |
| docs | yes | 新增 `docs/engineering/scenario-invariants.md` |
| scripts | yes | 新增 `scripts/scenario_invariants/run_i3_nonce.exs` |
| tasks/slices | yes | 本文件 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 写 `docs/engineering/scenario-invariants.md` 不变量契约文档 | done | I1/I2/I3 三条 + 实施层定义 |
| T2 | 写本 slice 任务 | done | — |
| T3 | 写 `scripts/scenario_invariants/run_i3_nonce.exs` driver | done | 双层：主链 + 直接 Toolbox.execute；输出 AI-actionable 报告 |
| T4 | 跑基线，记录 baseline 报告 | done | 三 case 精确命中 hardcoded 违规（"第01章：底层灵气账单"等 excerpts 自动暴露） |
| T5 | 决策点：是否继续 Phase A2 修复产品代码 | done | 用户选择继续 |
| T6 | 给 `TentativeArtifactSet.artifact_item` 加 `provider_call_ref` 字段 | deferred | 留 SI-002（I1 trace 因果绑定时统一加） |
| T7 | Toolbox.execute 接收 complete_fn，具体 creative capability 调 Provider | done | 删除 `generate_creative_items/2` 全部 5 分支 + `chapter_title_from_context`、`prose_fragment_body`；新增 provider 字节透传响应链路 |
| T8 | DialogueGateway 修复 `handle_tool_dispatch` 透传 complete_fn | done | 改 line 880 + 921 让 complete_fn 透传到 execute_tool 避免 fallback 到 `&Gateway.complete/1`；`creative_direction` 中文关键词路由暂保留（I3 不直接命中，留 SI-002） |
| T9 | TurnResultBuilder 删除作品专项默认文案 | done | creative artifact card 改为 semantic `candidate_set`，通用展示文案不承载采纳语义 |
| T10 | 跑 I3 转绿，输出 done 报告 | done | Layer-B 3/3 pass，exit 0 |
| T11 | 重写 `creative_artifact_test.exs` | done | 22 测试改为"验证字节透传"形态 |
| T12 | 升级 stub provider 为合法 fixture | done | 识别 creative prompt 返回最小合法 items JSON |
| T13 | mix compile --warnings-as-errors + mix test 全绿 | done | 583 测试通过、零警告 |
| T14 | 接入 `scripts/ai_static_scan.sh` 集成入口 | deferred | 留 SI-002 |
| T15 | 写 CI workflow + pre-commit hook | deferred | 留 SI-002 |

## 5. 不在本 slice 范围（下一 checkpoint）

- I1 因果绑定的 trace 全链路（需要 Provider 中间件记录 prompt_hash/response_hash + ToolResult 携带 provider_call_refs）
- I2 差异化输入的多 input 参数化框架（需要 slice_verify.sh 升级）
- 已登记，后续作为 SI-002 / SI-003 落地

## 6. 主链覆盖

本 slice 切穿主链的以下段落：

```text
Turn 输入（带 nonce）
→ DialogueGateway.handle_input
→ Planner.form_micro_plan（已接通 Provider）
→ ExecutionOrchestrator.decide
→ Toolbox.execute（本 slice 接通 Provider，删除 hardcoded）
→ TurnResult.tentative_artifacts.items（字节透传）
→ UI artifact 卡片
→ I3 driver 断言 nonce 包含
```

不切穿：persistence、replay、memory（这些已有覆盖，本 slice 不动）。

## 7. 验收形态（done 判定）

driver 在以下三个独立输入上 pass：

1. nonce 为 `K7XQ9M2A`，输入主题"赛博修仙的章节计划"
2. nonce 为 `B4RT8VN3`，输入主题"末日科幻的人物草案"
3. nonce 为 `Z9WJ5HQ7`，输入主题"古风武侠的正文片段"

每次 driver：
- 通过 `DialogueGateway.handle_input` 注入带 nonce 的输入文本
- 抓取返回的 TurnResult
- 断言至少一个 artifact item 的 title/body/rationale 任一字段包含该次 nonce
- 三次输入的 artifact item_id 集合两两不相交（提前覆盖 I2 一部分）

driver 三轮全 pass = 本 slice done。
