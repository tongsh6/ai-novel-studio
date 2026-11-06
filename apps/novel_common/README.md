# NovelCommon

跨 app 共享的**纯契约 / 纯规则 / 纯函数**层。定位来自 B27 CP3 冻结边界（`docs/project-ledger.md`
2026-10-24：「application 组装事实 → novel_common 纯契约/规则 → agent/application 渲染角色」）
与 [VS-00L 授权运行契约](../../docs/design/contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md)
§4/§19。

## 边界

允许：

- 纯 struct、纯函数、数据边界校验、JSON 值边界；
- 契约规则文本/版本（如 `AuthoringSemantics`）、作者可见展示名与文本形状；
- provider-neutral 的 Request IR 契约族（`NovelCommon.RequestIR`，含三类 Provider
  wire 投影与传输能力事实派生）与产品身份事实（`NovelCommon.SystemIdentity`）；
- 日志/可观测性协议（`LogContext`、`LogEmit`、`LLMLog`）等无状态基础设施契约。

禁止：

- GenServer / Supervisor / Registry / 任何进程或运行时状态；
- Ecto / Repo / Phoenix / 文件或网络 I/O；
- alias 其它生产 app 的模块（`NovelAgent.*`、`NovelApplication.*`、`NovelDomain.*`、
  `NovelPersistence.*`、`NovelWeb.*`、`NovelTest.*`、`NovelE2E.*`）；本 app 只依赖
  `novel_foundation` 与 Jason 等三方库。`scripts/arch_check.exs` 对此有机器门禁；
- 测试替身、执行函数、实际 provider 路由选择与传输发送（这些属于 `novel_agent` 执行边界）。

新增契约/规则前先回答：真实消费者是谁、消费哪个设计文档/契约、被哪个门禁或回归保护。
只为未来预留的抽象不进入本层（AGENTS.md YAGNI/KISS）。

## 依赖方向

```text
novel_common → novel_foundation
novel_agent / novel_application / novel_persistence / novel_web → novel_common
```

`novel_common` 不得反向依赖任何其他 umbrella app。

## lib 索引

### 契约规则

- [request_ir.ex](lib/novel_common/request_ir.ex)：Authoring Run Transcript / Request IR v1
  主契约（`NovelCommon.RequestIR`）：envelope、消息/工具/观察/校验/候选/checkpoint 构造、
  `validate/1` 数据边界校验、`prepare_request/2` 本次工具与 `tool_choice` 选择、执行引用
  校验、`json_value/1` JSON 边界。VS-00L §3–§5、§19.1。
- [request_ir/tools.ex](lib/novel_common/request_ir/tools.ex)：工具目录视图与本次选择查询
  （`tool_specs/1`、`tool_choice/1`、`tool_call_prompt?/1`、`active_tool_name/1`）；投影与
  执行边界共用同一视图。
- [request_ir/projection.ex](lib/novel_common/request_ir/projection.ex)：Request IR → Provider
  HTTP body 的投影入口（`NovelCommon.RequestIR.Projection.project/3`，按 adapter 声明的
  wire 目标分发）+ 投影公共语义（文本块/系统前缀/压缩文本/JSON 边界等）。VS-00L §6。
- [request_ir/projection/](lib/novel_common/request_ir/projection)：三类 wire 投影
  ——`chat_completions`、`anthropic_messages`、`responses_api`（纯函数；不发起传输）。
- [capability_profile.ex](lib/novel_common/capability_profile.ex)：Provider 传输能力事实的
  唯一派生边界（adapter 可证声明 → 按实际 route 派生能力、缺失判定、finite_mode 覆盖
  校验与作者安全拒绝文案）。VS-00L §6.4/§16.15。
- [request_ir/system_envelope.ex](lib/novel_common/request_ir/system_envelope.ex)：canonical
  system 事实边界（身份 + run 角色规则/输出协议 + 版本引用）与稳定 system 前缀
  `system_text/1`。VS-00L §3.2/§19.1。
- [request_ir/compaction.ex](lib/novel_common/request_ir/compaction.ex)：显式压缩视图派生
  （`covers.call_ids` 精确选择已闭合交换；原始消息永不删除）。VS-00L §16.2。
- [request_ir/operation.ex](lib/novel_common/request_ir/operation.ex)：计划/使命/创作/评审共用
  的纯阶段构造器（稳定角色规则 + 动态 scope/工具目录）。VS-00L §16.6。
- [system_identity.ex](lib/novel_common/system_identity.ex)：VS-00H 系统身份消息唯一代码真源
  （文本 / `version` / `content_hash` / `identity_ref`）；文本变更必须递增 `@version`。

### 作者可见面

- [author_visible/display.ex](lib/novel_common/author_visible/display.ex)：作者可见展示名唯一
  查询入口（读者：Web/Application 的作者面投影）。
- [author_visible/display_names_gen.ex](lib/novel_common/author_visible/display_names_gen.ex)：
  由 `docs/design/schemas/author_visible/display_names.json` codegen 的展示名数据，只允许经
  `Display` 查询。
- [author_visible/text.ex](lib/novel_common/author_visible/text.ex)：作者可见文本唯一数据形状
  （禁止原样返回内部 code）。
- [mix/tasks/codegen.author_visible.ex](lib/mix/tasks/codegen.author_visible.ex)：上述展示名的
  codegen 任务（`mix codegen.author_visible`；CI 校验 `--check`）。

### 专业调用语义与能力目录

- [authoring_semantics.ex](lib/novel_common/authoring_semantics.ex)：B27 专业调用共享规则唯一
  真源（shared/operation/output 规则、静态与动态渲染、内容哈希）。
- [capability_registry.ex](lib/novel_common/capability_registry.ex)：application 规划/编排与
  agent 运行时共享的能力目录入口。
- [contracts/](lib/novel_common/contracts)：跨 app 纯 DTO 契约族——`agent_event`、
  `provider_run` / `provider_event` / `provider_output`、`creative_request` /
  `creative_provider_result`、`quality_evaluation_request` / `quality_evaluation_result`、
  `tool_request` / `tool_result` / `tool_output_contract`、`authoring_task`、
  `capability_registry_entry`。

### 可观测性协议

- [log_context.ex](lib/novel_common/log_context.ex)：Logger metadata 与跨进程传递协议
  （ADR-0018 §2）。
- [log_emit.ex](lib/novel_common/log_emit.ex)：结构化业务日志 emit 宏与 phase 校验
  （ADR-0018 §3）。
- [llm_log.ex](lib/novel_common/llm_log.ex)：LLM HTTP 调用 JSONL 日志。
- [log_file_date.ex](lib/novel_common/log_file_date.ex)：日志文件名使用的本地日历日。
- [novel_common.ex](lib/novel_common.ex)：本 app 模块入口与定位说明。

## test 索引

- [request_ir_test.exs](test/novel_common/request_ir_test.exs)：IR v1 数据边界（消息顺序/
  provenance、call_id 绑定时序、禁止工具、used_refs 范围、system 身份引用）。
- [request_ir_tools_test.exs](test/novel_common/request_ir_tools_test.exs)：工具目录规范化与本次
  选择查询。
- [request_ir_operation_test.exs](test/novel_common/request_ir_operation_test.exs)：纯阶段构造器。
- [system_identity_test.exs](test/novel_common/system_identity_test.exs)：身份文本/版本/哈希。
- [system_identity_guard_test.exs](test/novel_common/system_identity_guard_test.exs)：I-SYS-2
  守卫——所有生产 lib 调用点不得自述产品身份。
- [contracts/](test/novel_common/contracts)、[author_visible/](test/novel_common/author_visible)、
  `log_*_test.exs`：契约与可观测性回归。

## 相关设计/契约

- [ADR-0033](../../docs/design/adr/ADR-0033-authoring-run-transcript-request-ir-v3.md)：
  AgentRun 事实源与 Request IR 目标（wire 投影/能力事实仍归 `novel_agent` 执行边界）。
- [VS-00L](../../docs/design/contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md)：
  Request IR v1 契约、投影矩阵、压缩与初始快照职责。
- [VS-00H](../../docs/design/contracts/VS-00H-system-identity-message-contract-pack.md)：系统身份
  消息契约。
- [ADR-0018](../../docs/design/adr/ADR-0018-business-log-schema-v3.md)：业务日志 schema。
- [ADR-0011](../../docs/design/adr/ADR-0011-toolbox-registry-v3.md) /
  [ADR-0012](../../docs/design/adr/ADR-0012-tool-request-result-v3.md)：能力目录与工具契约。
- [B27 专业调用语义](../../tasks/slices/B27-systematic-prompt-and-intent-integration.md)。
