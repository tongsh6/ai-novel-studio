# v3 质量门禁护栏

> 状态：试行护栏（2026-05-08）
>
> 角色：定义 v3 从设计进入实现时必须通过的质量门禁。本文不替代 `AGENTS.md`、`docs/coding-standards/` 或 v2 小说质量门禁；它把这些已有规则按 v3 的实现顺序收口。

---

## 1. 门禁分层

v3 的质量门禁分三层：

| 层级 | 目的 | 主要来源 |
|---|---|---|
| 工程门禁 | 代码能编译、边界没破、测试通过、静态扫描闭环 | `AGENTS.md`、`scripts/ai_static_scan.sh`、`docs/coding-standards/` |
| slice 门禁 | 每个承重竖切面有契约、不变量、边界、消费者、证明 | `docs/engineering/vertical-slice.md`、`tasks/slices/v3/DAG.md` |
| 小说质量门禁 | AI 产出的创作材料能被检查、警告、确认、采纳或阻断 | `docs/design/quality/31-novel-quality-gates.md`、`docs/design/quality/32-human-approval-policy.md`、v3 contract packs |

这三层不能互相替代：

- 工程检查通过，不等于创作语义正确。
- 小说质量判断存在，不等于代码边界合格。
- UI 看起来能用，不等于 slice 不变量成立。

---

## 2. 工程门禁

### 2.1 通用后端门禁

所有涉及 Elixir 后端的实现计划，必须列出并执行：

```bash
mix compile --warnings-as-errors
mix test
mix xref graph --format cycles --label compile-connected --fail-above 0
mix run scripts/arch_check.exs
```

要求：

1. 编译零警告。
2. 测试全通过。
3. 无编译期循环依赖。
4. `arch_check` 无架构违规。
5. 新增模块必须有测试；修改核心逻辑必须更新测试。

如果本地环境导致命令无法完成，例如数据库未启动，最终汇报必须写明：

- 哪条命令失败。
- 失败原因是否是环境问题。
- 哪些子命令已经通过。
- 还需要谁在什么环境复跑。

### 2.2 通用前端门禁

所有涉及 frontend 的实现计划，必须列出并执行：

```bash
cd frontend && pnpm typecheck && pnpm lint && pnpm test
bash scripts/frontend_audit.sh
bash scripts/check_design_trace.sh
```

要求：

1. 不手写 schema 类型，类型来自 Zod / codegen。
2. 不使用内联样式。
3. 用户可见文案集中管理。
4. 组件文件头部有设计文档和原型追溯。
5. Tauri-first 约束不破坏：不直接使用浏览器专用 API 替代 Tauri API。

### 2.3 AI 静态扫描闭环

每次功能实现完成后，必须执行：

```bash
bash scripts/ai_static_scan.sh --top 10
```

快速本地检查可先跑：

```bash
bash scripts/ai_static_scan.sh --top 10 --quick
```

闭环规则：

1. 优先处理 P0 / P1 问题。
2. 本次改动文件里的 P2 问题必须处理或解释。
3. 不能安全处理的问题必须进入处置说明，说明原因、影响范围、后续归属。
4. 处理后必须复跑扫描。
5. 最终汇报必须包含剩余 Top 10 的处置状态。

现有处置来源：

- `artifacts/static-scan/top10.md`
- `artifacts/static-scan/report.json`
- `artifacts/static-scan/disposition.md`
- `reports/static-scan/dispositions.json`

### 2.4 文档变更门禁

只改文档时，至少执行：

```bash
git diff --check
rg -n "TO""DO|TB""D|占位""符|下一步需要冻""结|仍未进入 Pro""posed" docs tasks
rg -n "VS-00"" 至 VS-06|VS-01"" 至 VS-06|VS-00 / VS-00A / VS-00B / VS-01"" 至 VS-06" docs/design tasks/slices/v3
```

如果新增工程文档，还必须确认：

1. `docs/engineering/README.md` 已接入。
2. 相关 v3 阅读地图已接入。
3. 新文档没有重写已有规则，而是引用已有来源。

---

## 3. slice 门禁

### 3.1 开工五问

每个 v3 slice 进入实现计划前，必须回答：

| 问题 | 必须达到的硬度 |
|---|---|
| Contract | 引用具体 ADR、contract pack、schema、状态字段或 TurnResult 结构 |
| Invariant | 指向 `docs/design/00c-state-and-contract-atlas.md` 的全局不变量 |
| Boundary | 列出会切过哪些 app，以及哪些 app 明确不应修改 |
| Consumer | 写出第一个真实消费者，不能只写“未来会用” |
| Proof | 写出测试或命令，不能只写人工检查 |

这五问来自 `docs/engineering/vertical-slice.md`，v3 不另起一套。

### 3.2 v3 首批 slice 验收重点

| Slice | 第一质量目标 | 不合格信号 |
|---|---|---|
| VS-00 | reply-only 也有 DialogueFrame / TurnResult / trace | 普通回复绕过 frame 或 trace |
| VS-00A | 模糊想法自然探索，不自动表单化 | “缺字段”直接打开 slot 表单 |
| VS-00B | 回应受当前小说上下文约束 | 无上下文时编造作品事实 |
| VS-01 | MicroPlan 不能批准自己 | Planner 输出被直接执行 |
| VS-02 | 工具有 request / result / trace | 工具调用无来源、无回放依据 |
| VS-02A | AI 能产出小说草稿，但默认待采纳 | 草稿被说成正式角色、正式大纲或正文 |
| VS-03 | clarification / confirmation 有生命周期 | 前端 modal 关闭就当后端状态结束 |
| VS-04 | 选择候选不等于采纳 | choose_candidate 直接写 production state |
| VS-05 | UI 只能提交系统给出的 action | 前端发明 action_type |
| VS-06 | trace summary 脱敏，replay 不重调 provider | 回放时重新调用 LLM 补历史 |

### 3.3 禁止交付形态

以下内容不能单独作为 v3 slice 完成：

- 只建表、schema、migration。
- 只写 controller / channel。
- 只搭 UI 壳。
- 只加 provider、repository、service 抽象。
- 只创建未来会用的模块。
- 只有 happy path，没有拒绝、降级、确认、采纳或 trace 证明。

---

## 4. 小说质量门禁复用

v3 不重新发明小说质量体系。v2 已经定义了小说层质量门禁，v3 只做两件事：

1. 把质量判断接入 Dialogue-first 主链。
2. 分阶段引入，不把完整质量体系塞进首批 slice。

### 4.1 可复用的 v2 质量门目录

| 质量门 | v3 用途 |
|---|---|
| 设定冲突 | 检查草稿是否违反已采纳世界观 |
| 人物逻辑 | 检查角色动机、行为、关系是否可信 |
| 时间线与状态 | 检查事件顺序、伤势、地点、能力状态 |
| 伏笔 | 检查新伏笔、回收、误用 |
| 信息越界 | 检查角色或读者是否过早知道信息 |
| 节奏 | 检查章节推进、情绪密度、信息密度 |
| 爽点 | 检查压抑、铺垫、兑现是否成立 |
| Hook | 检查章节尾继续阅读动力 |
| 战力膨胀 | 检查能力、资源、代价是否失衡 |
| 网文留存 | 检查黄金三章、付费点、连续追读动机 |

来源：`docs/design/quality/31-novel-quality-gates.md`。

### 4.2 v3 首批只接入最小质量证明

首批 v3 slice 不要求完整运行全部小说质量门。首批只要求：

| 场景 | 最小质量证明 |
|---|---|
| VS-00A 自然探索 | 不能把模糊想法强行表单化；候选方向必须可继续讨论 |
| VS-00B 上下文回应 | 不编造当前作品事实；引用上下文要可追溯 |
| VS-02A 创作草稿 | 草稿标为待采纳；来源、上下文和工具结果可追溯 |
| VS-04 采纳边界 | 未经选择和采纳，不写正式作品事实 |
| VS-06 回放 | 解释草稿来源时不重新调用 provider |

完整小说质量门禁应在后续 creative quality slice 中逐步进入，不能抢在 v3 主链稳定前铺开。

### 4.3 质量发现不能直接改状态

复用 v2 的关键原则：

```text
quality finding
→ policy decision
→ warn / retry / confirm / block / adoption review
→ TurnResult / AvailableAction
```

质量发现不能直接：

- 修改草稿。
- 采纳作品事实。
- 关闭 behavior。
- 刷新阅读投影。
- 替作者选择候选。

---

## 5. 人工确认与采纳门禁

v3 继续复用 v2 的作者主导原则：

| 动作 | v3 默认处理 |
|---|---|
| 生成候选方向 | 可以自动，但必须标为候选 |
| 生成角色 / 剧情 / 大纲 / 片段草稿 | 可以自动，但默认待采纳 |
| 写入正式设定 | 必须进入采纳边界 |
| 修改已影响下游的核心设定 | 必须确认或 checkpoint |
| 启动高预算长任务 | 必须确认 |
| 批量采纳或生产写入 | 必须确认、trace、audit |

来源：

- `docs/design/quality/32-human-approval-policy.md`
- `docs/design/foundation/10-security-and-budget.md`
- `docs/design/adr/ADR-0010-state-adoption-boundary-v3.md`

---

## 6. trace / replay 门禁

v3 每条主链都必须能回答：

1. 作者输入是什么。
2. 使用了哪些上下文。
3. 形成了什么 `DialogueFrame`。
4. 是否提出了 `MicroPlan`。
5. 执行裁决是什么。
6. 是否调用了工具。
7. 产生了哪些草稿、候选、等待态或采纳结果。
8. 为什么这些结果可以展示给作者。
9. 回放时是否没有重新调用 provider。

最低要求：

| 对象 | 必须留痕 |
|---|---|
| `DialogueFrame` | frame 类型、目标、依据 |
| `MicroPlan` | 建议动作、风险提示、是否只放行下一步 |
| `OrchestratorDecision` | decision type、first blocking gate、reason |
| `ToolRequest` / `ToolResult` | 工具名、输入摘要、输出摘要、来源 |
| `TentativeArtifactSet` | 草稿来源、上下文引用、待采纳状态 |
| `BehaviorState` | open / close / resolution |
| `AdoptionDecision` | 候选来源、作者动作、采纳结果 |
| `TraceSummaryView` | 作者可见摘要必须脱敏 |
| `ReplayReport` | 开发可见回放不得重调 provider |

来源：

- `docs/design/foundation/09-observability-and-audit.md`
- `docs/design/06-memory-context-and-trace.md`
- `docs/design/adr/ADR-0013-decision-trace-v3.md`
- `docs/design/adr/ADR-0017-replay-report-v3.md`

---

## 7. 复用 v2 实现经验的验收要求

v3 implementation plan 如果复用或改造 v2 已实现代码，必须额外说明：

| 检查 | 通过标准 |
|---|---|
| 旧 proof 是否仍有效 | 能指出旧测试或旧 slice 证明了什么，不能只说“之前跑通过” |
| v3 语义是否补齐 | 新 proof 覆盖 DialogueFrame、MicroPlan、OrchestratorDecision、DecisionTrace 中相关对象 |
| 旧 Router-first 是否被剥离 | 没有把 Router / intent 当成 v3 第一认知节点 |
| 旧 TurnResult 是否升级 | UI 出口能消费 v3 TurnResultViewModel / TraceSummaryView |
| 旧 tentative / adoption 是否守住 | AI 草稿、ToolResult、candidate 不会直接变成正式事实 |
| 旧代码边界是否仍合规 | 通过 `mix xref` 和 `scripts/arch_check.exs` 验证 |

优先复用的不是旧代码形状，而是旧 slice 的证明习惯：

1. 端到端闭环优先。
2. 每个状态变化都有测试。
3. UI action 回到后端重新校验。
4. tentative 和 adopted 明确分开。
5. trace / audit 不靠普通日志猜。

---

## 8. 实现计划验收模板

每个 v3 implementation plan 的验收段必须包含：

```md
## 验收门禁

### 工程门禁
- [ ] mix compile --warnings-as-errors
- [ ] mix test
- [ ] mix xref graph --format cycles --label compile-connected --fail-above 0
- [ ] mix run scripts/arch_check.exs
- [ ] bash scripts/ai_static_scan.sh --top 10

### 前端门禁（若涉及 frontend）
- [ ] cd frontend && pnpm typecheck && pnpm lint && pnpm test
- [ ] bash scripts/frontend_audit.sh
- [ ] bash scripts/check_design_trace.sh

### slice 门禁
- [ ] Contract 已引用 ADR / contract pack / schema
- [ ] Invariant 已指向 00c 全局不变量
- [ ] Boundary 已列出涉及和禁止修改的 app
- [ ] Consumer 是真实消费者
- [ ] Proof 已写成测试或命令

### v3 愿景门禁
- [ ] 作者面对 AI 创作伙伴，不退回 Router-first / slot-first
- [ ] AI 产物默认待采纳
- [ ] 正式作品事实必须经过采纳边界
- [ ] trace / replay 能解释为什么这样做

### 复用门禁
- [ ] 已引用 AGENTS.md / engineering / coding standards
- [ ] 已说明复用了哪些 v2 设计
- [ ] 已说明复用了哪些 v2 已实现 slice / 代码经验
- [ ] 已说明哪些 v2 设计不能直接搬用
```

如果某条命令因为环境无法运行，不能勾选，只能在实现计划或最终汇报里说明阻塞原因。

---

## 9. 自审清单

评审 v3 质量时按以下顺序：

1. **先看最终愿景**：有没有把作者重新放到 AI 创作伙伴面前。
2. **再看 v3 设计**：有没有经过 DialogueFrame、MicroPlan、OrchestratorDecision、TurnResult、DecisionTrace。
3. **再看复用**：有没有复用 v2 的质量、审批、安全、审计经验，以及现有工程脚本。
4. **最后看命令**：有没有真实运行能证明的检查。

如果 1 不成立，即使 4 全绿，也不合格。

如果 4 不成立，即使设计讲得通，也不能宣称实现完成。
