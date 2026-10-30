# B71：Provider 多轮消息保真与请求投影

- 状态：**todo（2026-10-30 登记；CP0 证据与设计登记完成，CP1 未开工）**。
- 来源：作者要求抓取并对比 Codex、Claude Code、dsh 的真实多轮请求体，随后要求登记本项目请求体的完善任务与设计。
- 设计真源：[Provider 抽象 §26](../../docs/design/foundation/08-provider-abstraction.md#26-provider-多轮消息保真与请求投影2026-10-30-登记proposed)。当前为 Proposed；登记不等于接受实现，CP1 仍需先冻结真实消费者和最小契约。
- 关联：[B26](B26-single-call-judgment-protocol.md) 单调用协议、[B39](B39-evidence-seeking-authoring.md) 统一求证链、[VS-00I](../../docs/design/contracts/VS-00I-prompt-prefix-stability-contract-pack.md) 前缀稳定、[UA01-provider-execution-stream-unification](UA01-provider-execution-stream-unification.md) Provider 执行与流式边界。

## 1. 已核实问题与完整目标

真实外部多轮请求包含原生 assistant 工具调用、tool/tool_result 结果及有序历史；本项目 `normalize_messages/1` 仅保留 `role` 和字符串 `content`，真实契约纠错会形成 `system + user + user`。同时，大型 `user` 文档混合规则、作品材料、历史与作者原话。需要完善的是消息保真、重试语义和 provider 投影，而不是照抄外部工具的 API 或工具数量。

完整目标：

1. 用真实消费者驱动的最小无损消息契约替代有损归一化，保留当前调用需要的原生字段。
2. 各 adapter 分别序列化 OpenAI 兼容、DeepSeek、Anthropic 请求，未知字段不跨通道发送。
3. 明确多轮纠错与无状态重试的边界，不再用连续 `user` 消息冒充完整 assistant 历史。
4. 保持 VS-00I 缓存纪律、B26 单调用协议和 B39 观察证据链；按实际兼容性补流式用量。
5. 以黄金请求、真实 provider 请求和外部真实页面证据共同验收，不以结构样本或局部测试代签完整 slice。

## 2. 非目标与依赖

- 不改变 B26 单调用 `tool_choice: auto`，不恢复两段式。
- 不新增原生探索工具入口，不建立 writer 内第二套工具循环；该能力继续服从 B39/ADR-0030 的 Deferred 边界。
- 不迁移 Responses API，不全局增加 `parallel_tool_calls`、`client_metadata`、缓存或推理字段。
- 不重写 ContextAssembler、VS-00H 身份或 VS-00I L0–L4；只处理消息保真和请求投影。
- 不一次性回放全部历史、CoT 或作品档案，不把私有 thinking 展示给作者。
- B39 的观察、Base/used refs 与统一 AgentRun 继续是求证真源；本任务若触碰其请求投影，必须与该链同批验证，不另立求证协议。

## 3. 开工七问

1. **Contract**：消费 `foundation/08-provider-abstraction.md` §26、VS-00H/VS-00I、UA-01 与 B26 单调用协议；CP1 固化当前消费者所需的最小消息/重试/projection 矩阵，不提前发明通用 DTO 全集。
2. **Invariant**：消息顺序与工具调用 ID 关联保真；作者和 artifact 字节不被修补；I1/I2/I3、N-NARR、缓存前缀、权限、预算、采纳及 replay 边界不退化。
3. **Boundary**：主要切 `novel_agent` 的消息与 adapter、`novel_application` 的当前纠错/请求构造；`novel_domain` 仅必要纯校验。不得直接改 Repo 或新增 provider 业务概念；web/frontend 仅复用真实主链，除非证明现有投影不足。
4. **Consumer**：首个消费者是现有契约纠错请求及其 provider adapter；后续是实际多轮调用、B39 观察请求和 replay/Why 的证据消费。无真实消费者的 provider 字段不提前添加。
5. **Proof**：三类 adapter 黄金请求、消息/tool_call_id 关联、重试链、未知字段拒绝、缓存/usage 与 I1/I2/I3；真实 provider 请求对账和外部 Tauri 场景缺一不可。涉及观察时证明 Base/观察进入后续真实请求且 used refs 未越界。
6. **Acceptance Driver**：CP1 在 quality manifest 预注册后，复用 `scripts/tauri_slice_verify.sh` 和当前 WorkspaceChat，由外部自动化触发真实纠错/多轮场景并保存页面、日志、请求与持久化证据。故障替身只位于 test/support 或外部 harness；产品新增验收感知逻辑：**no**。
7. **Exploration**：不新增小说要素或专用 packet，不开放第二探索入口。若改动 B39 请求投影，必须同批证明既有统一探索的观察回流、引用绑定和预算/权限，不能把本任务变成 writer 内 native 工具循环。

## 4. Checkpoint 与完成标准

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 保存外部真实多轮脱敏样本与本项目真实请求证据；核对现有 B26/B39/VS-00I 边界；登记设计、任务、索引和非目标 | **done（2026-10-30，仅文档）**：完成 Provider §26、本任务、NEXT/slice 索引与事实台账；未修改产品代码，未宣称产品能力已验证 |
| CP1 | 盘点当前纠错和实际多轮消费者；冻结最小无损消息字段、重试策略、provider 序列化/未知字段矩阵、黄金样本与场景预注册；明确哪些外部能力没有当前消费者而不实现 | 未开工；下一步 |
| CP2 | 实现消息保真和 adapter 投影，迁移当前纠错为真实多轮或显式无状态重试；保持既有单调用行为与字节因果，黄金/局部测试通过 | 未开工 |
| CP3 | 补齐真实 provider 请求、缓存/usage 和 B39 观察投影回归；完成外部 Tauri 多轮/纠错场景、恢复与 replay/Why 对账；运行完整后端及 I1/I2/I3、架构和静态扫描门禁 | 未开工 |
| CP4 | 更新相关 contract/设计、索引、验收证据与恢复指引；逐项核对完整范围，不把局部 adapter 或 golden 测试当成 slice done | 未开工 |

## 5. 验证与证据要求

- CP1 只运行文档、索引、链接、NEXT/ADR 和差距检查，不声称产品验证。
- CP2 起执行 `mix compile --warnings-as-errors`、相关及全量测试、xref、arch_check、I3/I1/I2、统一静态扫描；若触及前端再执行其完整门禁。
- 至少保存一组多轮黄金请求，证明 assistant 工具调用和结果 ID 不丢失；一组纠错请求，证明其策略不是伪装的 `user/user` 历史；一组未知字段矩阵，证明不向不支持 provider 盲发。
- 缓存比较使用同调用点真实请求与 `cached_tokens`/TTFT，不把既有 `19037` 当固定阈值；Strata 已命中自动缓存的事实不得回退成“无缓存”。
- CP3 最终汇报必须区分：外部自动化真实页面验收、后端/adapter 局部验证、真实模型行为证据和未闭环缺口。

## 6. 决策与恢复指引

- 2026-10-30：登记“消息保真与请求投影”方向；不视为作者已接受具体 DTO、迁移或工具循环方案。CP1 应先提交消费者与契约矩阵，再实施。
- 外部样本在 `artifacts/client-http-bodies/`；项目对照证据在 `log/llm-calls/stage/2026-10-29.jsonl` 第 8–9 行及 Provider/应用源码，证据只读，不当作实现。
- 恢复时先读 Provider §26、本任务、B26/B39 和 VS-00I；不得从旧分析回复推断字段已冻结或 CP 已完成。
