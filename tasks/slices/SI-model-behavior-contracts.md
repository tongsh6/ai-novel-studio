# SI 模型行为契约探针（MBC）与 provider 能力整形

- 状态：active / T1-T4 已落地并由 live LM Studio 探针 pass_rate=1.0 验证；T5 等 key、T6 nightly 待接
- 类型：验证体系扩展 Slice（`docs/design/notes/2026-07-05-agentic-verification-system.md` §2.1 的 CP1）
- 登记日期：2026-07-05
- 来源事故：2026-07-05 DeepSeek thinking 模式 HTTP 400 "Thinking mode does not support this tool_choice"（真实创作现场首次 live 计划起草调用即灭 run）

## 1. 问题

ADR-0023 CP4 的强制 tool_choice 协议证据全部来自 stub/slice_verify；「stub 全绿 ↔ 45 分钟狗粮」之间没有任何一层测量真实 provider 的行为契约。首次 live 调用暴露 provider×模式能力冲突（thinking 不支持具名 tool_choice），且该类问题在 adapter 层无能力整形、在验证体系无探针。

## 2. 边界（六问）

- **Contract**: ADR-0023 决策 4（native tool calling 唯一协议）不变；provider 能力约束落 adapter 请求整形；探针框架为验证体系 note §2.1 的运行落地。
- **Invariant**: 「规划调用不因 provider×模式组合 400 灭 run」；降级整形留痕（developer 日志）；探针不写库、不起 run 进程、穿生产 planner+Gateway 同路径。
- **Boundary**: `novel_agent` adapter（DeepSeek/LMStudio 请求整形）+ `scripts/model_contracts/`；不改 application/web/domain/前端。
- **Consumer**: DeepSeek（thinking 用户）与 LM Studio 上的全部 AgentRun 计划起草/修订；`UA01-agentic-loop-prompt-hardening` T2 的 live 验证直接复用本探针。
- **Proof**: adapter 单测（两条整形规则）+ 探针 stub 自检 3/3 + live LM Studio 实跑 + 全量门禁。
- **Acceptance Driver**: `mix run scripts/model_contracts/tool_call_compliance.exs <provider>`（外部脚本，产品零验收感知；exit 65=凭据/环境阻塞）。

## 3. 任务

| # | 任务 | 状态 | 说明 |
|---|---|---|---|
| T1 | DeepSeek thinking×forced tool_choice 能力整形 | done | `deep_seek.ex maybe_thinking`：请求带强制具名 tool_choice 时 thinking 降级 disabled + 日志留痕；单测覆盖（tool_choice 保留、thinking=disabled、reasoning_effort 不发）。规划要结构确定性、写作要思考深度，非 tool 调用不受影响。 |
| T2 | LM Studio 具名 tool_choice 整形 | done | 探针实跑抓到第二个真实缺陷：LM Studio 只接受字符串 none/auto/required，具名对象形式 HTTP 400——**CP4 后计划起草在 LM Studio 上一直是坏的**（此前证据全为 slice_verify）。`lm_studio.ex downgrade_named_tool_choice` 降为 "required"（单 tool 请求等效强制，解析层「恰一个匹配名」校验兜底）；单测覆盖。 |
| T3 | MBC tool-call-compliance 探针 | done | `scripts/model_contracts/tool_call_compliance.exs`：穿生产 `AgenticPlanDraftPlanner` + `Execution.dependency(provider:)`（完整 Gateway/ProviderExecution/N-NARR 物化路径），N 次/变体统计 pass_rate，产物 `artifacts/model-contracts/<provider>/tool-call-compliance.json`；deepseek 含 thinking enabled/disabled 双变体；stub 自检 3/3 通过。 |
| T4 | LM Studio 空 content 分岔 | done（2026-07-05 用户拍板 A 并落地） | schema 必填 `author_reasoning`；解析回退 content→arguments（content 非空仍优先，保留流式叙事）；`AgentNarrativeSource.from_tool_call_narrative` 新源类型 `provider_output_tool_narrative`（运行时 ProviderOutput.content 本就携带 tool_calls，字节绑定捕获时验证，零 novel_agent/persistence 改动）；draft/revision/correction prompt 同步。live LM Studio 探针 pass_rate 0→**1.0**，stub 回归 1.0，focused 单测 3 条（回退绑定/坐标透传/双空诚实失败）。 |
| T5 | DeepSeek live 复验 | blocked（shell 无 key） | 修复后 `mix run scripts/model_contracts/tool_call_compliance.exs deepseek` 双变体应通过；key 在应用 provider-secrets 而不在 shell env，等用户提供 env key 或从应用侧触发。 |
| T6 | 探针进 nightly | todo | 本地/自托管 runner nightly 对 lmstudio（+有 key 时 deepseek）跑；进 CI 前先解 T4。 |
| T7 | MBC judgment-protocol 探针（ADR-0025 CP1 前置） | done（2026-07-16） | `scripts/model_contracts/judgment_protocol.exs`：验证判断①方案 B 回复内联协议（call1 叙事+直接回复同流、call2 轻量 `judgment_decision` tool call）与"是否开计划"判断质量（六用例阵列：闲聊/上下文事实/单动作创作/多步复杂/需检索/意图不明）。判断①提示词为 CP1 协议草案，CP1 落地时迁入生产模块。`NovelAgent.Provider.Stub` 新增判断契约样本（五选一确定性判形态 + 回复内联）。**测量迭代史（gpt-oss-120b，3 轮/用例）**：初版 0.889（single_creative 摇摆 reply/plan）→ 提示词加"产物即单动作/多产物才开计划"判别规则 → 0.944（multi_step_creative 一次判 explore——上下文声明伏笔明细需检索时先探索是合理首步，测量口径修正为接受 plan\|explore）→ **1.0（18/18）**；**协议合规全程 18/18**（内联回复两段结构 + call2 全部可解析），失败均为判断边界而非协议。stub 自检 12/12=1.0。证据 `artifacts/model-contracts/lmstudio/judgment-protocol.json`。另记两个观察：① config 默认 LM Studio 模型 id `qwen/qwen3.5-122b-a10b` 与服务端 served id `qwen3.5-122b-a10b` 不一致（JIT 加载 400），live 跑用 `NOVEL_LMSTUDIO_MODEL=openai/gpt-oss-120b`；② LM Studio adapter 400 错误 message 为空串（错误体未透出），排障靠 curl——可在 adapter 错误提取补 body 透出，未登记为独立任务。 |

## 4. 验收

- [x] adapter 单测：`mix test apps/novel_agent/test/novel_agent/provider/lm_studio_test.exs apps/novel_agent/test/novel_agent/provider/deep_seek_test.exs`（26/0）
- [x] 探针 stub 自检 pass_rate=1.0
- [x] T4 落地后 LM Studio 探针 pass_rate=1.0（`artifacts/model-contracts/lmstudio/tool-call-compliance.json`）
- [ ] T5 DeepSeek 双变体 live 通过
- [x] 全量门禁（2026-07-05：后端 1205/0、xref、arch_check、I1/I2/I3、N-NARR PASS）

## 5. 决策记录

- 2026-07-05 — 事故→体系修复路径：不做单点绕行（关 thinking），按「adapter 能力整形 + MBC 探针」落地；探针首日即抓到第二个未知真实缺陷（LM Studio tool_choice 形式）并实锤第三个（空 content），验证了「stub 与狗粮之间缺行为契约层」的判断。
- 2026-07-05 — 探针必须穿生产同路径（`Execution.dependency(provider:)`），裸 adapter `complete()` 会绕过 ProviderExecution 物化导致 N-NARR 溯源假失败（框架自检踩过）。
- 2026-07-05 — 用户拍板 T4 选 A；实现发现运行时 `ProviderOutput.content` 已携带完整 tool_calls（持久层才降为 count/names），N-NARR 校验本为捕获时语义 → 字节绑定无需哈希链变通，整个方案落在 novel_application 层。live LM Studio 探针 pass_rate=1.0 为验收证据（`artifacts/model-contracts/lmstudio/tool-call-compliance.json`）。
