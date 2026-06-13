# ADR-0011：Toolbox Registry v3

- 状态：Accepted
- 日期：2026-05-07
- 来源文档：
  - `../00c-state-and-contract-atlas.md` §6, §7, §8, §9
  - `../03-capability-toolbox-contract.md` §3
  - `../contracts/VS-02-tool-provenance-contract-pack.md`
- 影响范围：Toolbox / Execution / Trace / Umbrella / Slice
- 相关不变量：`00c` §7 #3、#5、#14
- 首个证明 slice：VS-02 ToolRequest / ToolResult / ToolTrace 闭环
- 取代：无
- 取代者：无

---

## 背景

v3 允许 Planner 建议使用能力，但工具是否存在、能否调用、可读写哪些范围、调用结果如何回放，不能由 Planner 或 UI 临时决定。

如果没有 registry，系统会退化成“LLM 函数列表”：工具名可能漂移，disabled 工具仍被调用，trace 无法说明当时使用的是哪个 contract version。

## 决策范围

本 ADR 冻结 VS-02 所需的 `CapabilityRegistryEntry` 最小 contract：

- 工具 name / version / layer。
- input / output contract refs。
- read / write scopes。
- risk / status / trace level。
- provider dependency。
- retry / cancellation capability declarations。

## 非目标

- 不冻结完整工具发现 UI。
- 不定义具体工具实现代码。
- 不冻结 provider gateway 细节。
- 不冻结 production write adoption boundary。
- 不要求 registry 必须持久化到数据库。

## 考虑过的方案

### 方案 A：Planner 直接使用 provider function list

- 优点：实现简单，prompt 中即可暴露工具。
- 缺点：disabled / deprecated / version / scope 无法被系统稳定审查，trace 难以回放。

### 方案 B：代码内隐式工具表

- 优点：比 prompt function list 稳定，短期代码量少。
- 缺点：contract refs、status、scope 和 trace level 容易散落在实现中。

### 方案 C：显式 Toolbox Registry

- 优点：Orchestrator、Toolbox、Trace 和 Replay 共享同一事实来源。
- 缺点：需要维护 registry entry 版本和状态。

## 最终决策

采用方案 C。Toolbox Registry 是工具能力的 contract authority。VS-02 使用 `contracts/VS-02-tool-provenance-contract-pack.md` §2 的最小字段作为 Accepted 决策输入。

核心规则：

1. `tool_name` / `tool_version` 必须进入 ToolRequest 和 ToolTrace。
2. `status=disabled` 不能被 dispatch。
3. `status=deprecated` 不能被新 decision 正常选择。
4. grant 范围不能超过 registry 声明。
5. registry snapshot 必须进入 trace，以避免 replay 时工具含义漂移。

## 决策理由

显式 registry 让工具调用从“模型临时建议”变成可审查 contract。它保护 v3 的核心边界：Planner 只有建议权，Orchestrator 才能批准工具调用。

## Contract 影响

- 新增并冻结 VS-02 最小 `CapabilityRegistryEntry`。
- `ToolRequest` 必须引用 registry entry 的 name / version。
- `ToolTrace` 必须记录 registry snapshot。

## Umbrella 边界影响

- `novel_agent` 可承接 toolbox runtime 与工具执行。
- `novel_application` 负责根据 OrchestratorDecision 审查 registry 和 dispatch。
- `novel_foundation` 可承接通用 enum / id / validation helper。
- `novel_domain` 不依赖 registry。
- `novel_web` / frontend 不直接读取 registry 来调用工具。

## UI / Trace / Replay 影响

UI 不消费 raw registry 作为按钮清单。Trace 必须记录 registry snapshot。Replay 读取 snapshot 和 contract refs，不重新询问 provider 当前工具列表。

## 垂直切面证明

VS-02 必须证明 disabled tool 不 dispatch、grant 不超 scope、ToolTrace 可指出 tool version。

## 迁移与兼容

v2 的工具或 service 命名可作为迁移材料，但不能直接成为 v3 registry contract。

## 后续工作

- 在 VS-02 implementation plan 中选择第一个 read-only 或 validation tool。
- 在后续 adoption slice 中处理 write scope 非空工具。
- 在 replay / redaction slice 中细化 registry snapshot 的可见性。

---
