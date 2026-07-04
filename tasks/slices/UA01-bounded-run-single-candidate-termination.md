# UA01 Bounded 创作 Run 单候选诚实终止（僵尸 run 竞态）

- 状态：active / 两项收紧已落地未复验；机器强制方案待用户决策
- 类型：AgentRun Loop 收口 Slice
- 登记日期：2026-07-04
- 来源：2026-07-04 新主链 10 章狗粮长跑实锤（`artifacts/novel-output/p1-100k-dogfood/summary.json`，7 次瞬时失败 + 第09章 882→820 覆盖 + 第05章 600s 饥饿）

## 1. 问题

真实模型（gpt-oss-120b @ LM Studio）驱动的 bounded 创作 run（实测为 `prose_drafting_with_quality_v1`）会在 `artifact_created` 观察出现后**再次选择 `prose_writing`**，而不是按完成信号返回 `done`。后果链：

1. 产出作者未请求的第二份待采纳候选（第二张候选卡凭空出现）；
2. run 被拖到预算耗尽，终态为 `awaiting_author` 而非 `completed`（作者视角的状态不诚实：候选早已交付，chip 却显示等待作者）；
3. 僵尸 run 的迟到 `turn_result` 帧污染后续轮次的外部消费者——狗粮 runner 曾误配采纳，导致第09章已累积正文被迟到首稿覆盖（882→820，overwrite 语义）；
4. 单线程地板 provider（LM Studio）上，僵尸 run 的 4-6 次剩余 provider 调用排队饿死后续 run（第05章 600s 无产出）。

产品诚实性未破（第二份候选是 tentative、覆盖是消费者自己点了保存），但这是真实的 loop 收口缺口。

## 2. 边界（六问）

- **Contract**: `docs/design/contracts/UA-01-unified-agent-run-loop-contract-pack.md` 的 `AgentRunPolicy` 预算语义（若 T3 决定机器强制，需要 contract pack 更新：prose `max_tool_calls` 2→1 或新增 artifact 预算项）；`AgenticNextStepPlanner` 完成信号约定（提示词层，已落）。
- **Invariant**: 「一个 bounded 创作 run 在产出待采纳候选后诚实终止（`completed`），不产出作者未请求的第二份候选」；延续 ADR-0021 A14（内部 step 不伪造作者 turn）、A18（stale 不静默继续）。
- **Boundary**: `novel_application`（planner 提示词 / 或 AgentRunServer·policy）+ `novel_domain`（仅当预算项上升）；不改 `novel_web` / `novel_persistence` / 前端产品代码；狗粮 runner 属外部 harness。
- **Consumer**: 真实作者对话流（单指令单候选卡 + run 终态 chip 诚实）；狗粮 runner 与后续所有帧消费者（不再需要防御迟到帧）。
- **Proof**: 确定性层——加严真实 Tauri prose scenario（run 终态 `completed`、pending 恰 1 份候选、无第二次 `prose_writing` step）；真实模型层——下一次经用户批准的狗粮长跑搭车复验，**0 次 retry 为通过线**（狗粮是重型验证，不为本 slice 单独触发）。
- **Acceptance Driver**: 既有 `agent-prose-drafting-with-quality`（加严断言）或新 scenario；狗粮 `scripts/dogfood_run.sh` 搭车。产品代码零验收感知。

## 3. 任务

| # | 任务 | 状态 | 说明 |
|---|---|---|---|
| T1 | prose 完成信号改强制性措辞 | done（88681d45） | `completion_signals("prose_drafting_with_quality_v1")`：artifact_created → 必须 done、不得二次 prose_writing；默认档措辞同步收紧。提示词级，效果未经真实长跑复验。 |
| T2 | 狗粮 runner turn 绑定 | done（2f11ffd） | `sendAuthorMessage` 从 user_message ack 取 `turn_id`（parent_turn_ref），草稿/确认/大纲帧按 `turn_id`/`turn_id:agent:N` 前缀绑定，迟到僵尸帧不再误配。harness 级，未复验。 |
| T3 | 决策：单 bounded run 单候选是否机器强制 | **待用户决策** | 选项 A：prose `max_tool_calls` 2→1（预算即强制，但预算耗尽终态仍是 `awaiting_author` 而非 `completed`，状态语义仍不诚实）；选项 B：`AgentRunPolicy` 新增候选/artifact 预算项，命中后 loop 以 `goal_satisfied` 诚实完成（需 contract pack 扩展）；选项 C：仅靠 T1 提示词纪律（零 contract 改动，地板模型下有残余概率）。 |
| T4 | 加严确定性真实 Tauri 断言 | todo | 在 prose scenario verifier 断言：final `agent_run_state.status=completed`、`adoption_state.pending` 恰 1 份 `prose_fragment`、completed steps 中 `prose_writing` 恰 1 次。 |
| T5 | 真实模型长跑复验 | blocked（等下一次经批准的狗粮） | 搭车验证 T1/T2：全程 0 次 runner retry、无 `awaiting_author`（预算耗尽）终态 run、无字数倒退。 |

## 4. 验收

- [ ] T3 用户拍板后按所选方案落地（若 A/B：contract pack + 预算矩阵 + 测试同步）
- [ ] T4 确定性 scenario 加严通过 `bash scripts/quality_accept.sh agent-prose-drafting-with-quality --surface tauri`
- [ ] T5 下一次狗粮长跑 0 retry（搭车，不单独触发）
- [ ] 全量门禁：`mix compile --warnings-as-errors`、`mix test`、xref 无循环、arch_check、I1/I2/I3

## 5. 决策记录

- 2026-07-04 — 狗粮长跑实锤竞态四重后果（见 §1），当场落 T1/T2 两项收紧；按用户纪律「狗粮是重型验证，不随意触发」，复验搭车下一次经批准的长跑，本 slice 不自行起跑。
- 2026-07-04 — T3 机器强制方案（A/B/C）登记待用户决策：核心权衡是「预算强制的终态语义不诚实（A）」vs「contract 扩展成本（B）」vs「提示词纪律的残余概率（C）」。
