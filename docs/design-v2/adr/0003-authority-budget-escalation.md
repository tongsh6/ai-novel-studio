# ADR-0003：Authority / Budget / Escalation 最小枚举

- 状态：Accepted
- 日期：2026-04-24（Accepted 于 2026-04-24，oracle 评审 ACCEPT）
- 涉及范围：Foundation 子系统 10（Security, Authority & Budget）/ 子系统 6（Planning & Long-Run）/ 子系统 12（Multi-Agent Composition）
- 相关文档：
  - `../10-security-and-budget.md` §4 / §6 / §7 / §8.3 / §9 / §10 / §14 / §16 / §17 / §18
  - `../01-agent-foundation-contract.md` §17 / §26 / §27
  - `../06-planning-and-long-run.md` §5.3 / §5.4 / §5.5 / §9.3 / §9.4
  - `../12-multi-agent-composition.md` §7 / §8
  - `../30-contract-glossary.md` §4 / §5 / §10
  - `../29-design-integrity-review.md` §4.2.5 / §7.1
  - `0001-turn-result-v2-schema.md`
  - `0002-state-enums.md`
- 取代：无
- 取代者：无

---

## 背景

ADR-0001 与 ADR-0002 已冻结 `TurnResult v2` 顶层 schema、state/status/next_action 枚举与兼容表。接下来 UI 设计仍无法稳定展示高风险、预算、授权与升级门禁，原因是 `authority_scope`、budget guard、escalation 的最小枚举尚未收口。

当前文档已经冻结了若干边界：

1. `authority_scope` 必须是结构化对象 / ref，不是扁平字符串。
2. `write_scope` 最小枚举已冻结为 `read_only`、`propose_only`、`tentative_write`、`production_write`。
3. long-run budget 字段名使用 `estimated_budget` / `consumed_budget`。
4. escalation 是显式对象，不得被 confirmation / checkpoint / cancellation 隐式替代。

但仍缺少：

1. `capability_scope` / `task_control_scope` / `budget_override_scope` 的最小值集合。
2. budget scope / dimension / guard decision 的 canonical 名称。
3. escalation type / reason / status / resolution 的最小集合。
4. authority 与 budget 在 multi-agent delegation 中的子集规则。

本 ADR 的目标是冻结 W5 所需的 authority / budget / escalation 最小枚举，使 UI 与 contract tests 可以识别“谁能做什么、能花多少、何时必须升级”。

---

## 考虑过的方案

### 方案 A：只引用 `10-security-and-budget.md`，不新增 ADR

优点：

- 不增加文档数量。
- 保持 `10` 作为唯一语义来源。

缺点：

- `10` 当前有边界和字段，但缺少完整 enum authority。
- `capability_scope` / `budget_override_scope` 仍无可测试值集合。
- UI 与 Multi-Agent 仍需猜测 escalation reason / budget decision 的可见标签。

### 方案 B：冻结最小枚举 + 明确 deferred 计算策略

优点：

- 将 authority / budget / escalation 的可机器校验集合一次收口。
- 保留预算计算算法、阈值默认值与 UI 表现给后续文档。
- 与 ADR-0001 / ADR-0002 的 `$ref` 和兼容表形成闭环。

缺点：

- 需要从现有文档中抽象 `capability_scope` 与 `budget_override_scope` 的最小值。
- 需要说明“重复失败”不是 escalation reason，而是 retry/checkpoint/failure policy 输入。

### 方案 C：一次冻结完整权限矩阵与预算算法

优点：

- 看起来最完整。
- 可以直接驱动实现。

缺点：

- 过早绑定实现策略与阈值。
- 会吞并 Provider、Policy、Long-Run retry、UI 呈现等后续范围。
- 不符合 W5 “最小枚举 + hard/soft threshold 分类”的边界。

---

## 最终决策

选择 **方案 B：冻结最小枚举 + 明确 deferred 计算策略**。

本 ADR 冻结：

1. authority scope object 的最小子字段与各子字段枚举。
2. budget scope / dimension / guard decision / threshold kind 的最小枚举。
3. escalation type / reason / status / resolution 的最小枚举。
4. authority / budget / escalation 的跨字段约束。
5. Multi-Agent delegation 中 authority / budget 子集与 escalation 上抛规则。

本 ADR 显式不冻结：

1. TurnResult 顶层 schema：已由 ADR-0001 冻结。
2. phase / status / next_action / behavior_status：已由 ADR-0002 冻结。
3. adoption 7 态：由 `30 §3.2` + ADR-0001 作为唯一 canonical 权威。
4. behavior-specific UI hint：已由 ADR-0005 冻结；本 ADR 仅提供 authority / budget / escalation 对 UI hint 的上游语义输入。
5. card / action schema：留待 ADR-0006。
6. provider-specific pricing、token 估算算法、默认阈值数值、动态预算策略。
7. full policy engine 与 retry algorithm。
8. UI 文案、颜色、图标或展示布局。

---

## 决策内容

### 1. 命名规则

1. authority / budget / escalation 枚举值使用 `snake_case`。
2. runtime state/action 枚举仍遵守 ADR-0002 的 `UPPER_SNAKE_CASE` 规则；本 ADR 不新增 `next_action`。
3. `authority_scope` 是结构化对象或 ref，不得降级为 flat string。
4. long-run budget 字段名固定使用 `estimated_budget` / `consumed_budget`。
5. 同一语义只能有一个 canonical 名称；别名只能出现在迁移策略。

### 2. Authority scope object

`authority_scope` 最小结构：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `capability_scope` | enum / enum[] | 当前主体可调用的 capability 范围 |
| `write_scope` | enum | 当前主体可写入的最高权级 |
| `task_control_scope` | enum[] | 当前主体可执行的 task 控制动作 |
| `budget_override_scope` | enum | 当前主体可调整预算的最高权级 |

#### 2.1 capability_scope

| value | 语义 |
| --- | --- |
| `none` | 不允许调用 capability |
| `declared_only` | 只能调用当前 intent / task 已声明的 capability |
| `registry_allowed` | 可调用 registry 中 policy 允许的 capability |
| `delegation_allowed` | 可委派子 Agent 调用其被授予的 capability |

`capability_scope` 是 W5 中缺失最明显的 derived enum。其值来自现有文档对 capability registry、delegation 与 controlled execution 的边界要求，而不是来自已冻结旧枚举。

#### 2.2 write_scope

| value | 语义 |
| --- | --- |
| `read_only` | 只能读取，不得产生写入或 mutation |
| `propose_only` | 只能提出建议或 tentative proposal，不得写入 authoritative state |
| `tentative_write` | 可写 tentative artifact / pending adoption，不得直接写 authoritative state |
| `production_write` | 可在 policy 允许范围内写 authoritative state |

`write_scope` 已由 `30 §5.3`、`10 §4.3` 与 `01 §17.1` 共同冻结；本 ADR 仅登记为 W5 authority object 的一部分。

#### 2.3 task_control_scope

| value | 语义 |
| --- | --- |
| `create_task` | 可创建 long-run task |
| `resume_task` | 可恢复已暂停 / checkpoint 的 task |
| `cancel_task` | 可取消 task |
| `branch_task` | 可从 checkpoint 或显式边界分叉 task |

以上四值来自 `10 §4.4`，并与 ADR-0002 的 `CANCEL_TASK` next_action 保持区分：`cancel_task` 是 authority 能力，`CANCEL_TASK` 是 runtime 下一步语义。

#### 2.4 budget_override_scope

| value | 语义 |
| --- | --- |
| `none` | 不得调整预算 |
| `request_increase` | 可请求上级或用户提高预算，但不能自行生效 |
| `soft_override` | 可在 soft threshold 范围内继续执行并记录 warning |
| `hard_override` | 可越过 hard threshold，但必须有显式授权、audit 与上限 |

`budget_override_scope` 是 derived enum。文档只冻结了“是否允许预算提升 / override”这个字段，本 ADR 将其收口为最小四档，便于 contract tests 判断何时必须 escalation。

### 3. Budget enums

#### 3.1 budget_scope_type

| value | 语义 |
| --- | --- |
| `provider_request` | 单次 provider 请求预算 |
| `capability_invocation` | 单次 capability 调用预算 |
| `turn` | 单轮交互预算 |
| `task` | long-run task 预算 |
| `delegation` | 子 Agent delegation 预算 |
| `workspace` | 工作区总预算 |
| `periodic` | 日 / 周 / 月等周期预算 |

#### 3.2 budget_dimension

| value | 对应字段 / 来源语义 |
| --- | --- |
| `token` | `token_limit` / token estimate |
| `wall_time` | `wall_time_limit_ms` / wall time estimate |
| `cost` | `cost_limit` / provider cost estimate |
| `invocation_count` | `invocation_limit` / capability or provider call count |
| `write_count` | `write_limit` / write volume / expected writes |
| `execution_unit_count` | planned units / execution unit count |

`write_count` 是 W5 的 canonical budget dimension 名称，用来收敛文档中的 `write_limit`、write volume、expected writes、mutation/artifact/adoption count 等表达。字段层仍可使用 `write_limit`，dimension enum 使用 `write_count`。

#### 3.3 budget_threshold_kind

| value | 语义 |
| --- | --- |
| `soft` | 可继续执行，但必须产生 warning / audit |
| `confirmation_required` | 继续前必须用户确认 |
| `checkpoint_required` | 必须停在 checkpoint，保存 consumed snapshot |
| `hard` | 不得继续执行，除非存在 `hard_override` 授权 |

#### 3.4 budget_guard_decision

| value | 语义 |
| --- | --- |
| `allow` | 预算通过，无需额外动作 |
| `allow_with_warning` | 可继续，但必须记录 warning |
| `require_confirmation` | 需要用户确认后继续 |
| `checkpoint` | 必须 checkpoint 并等待 resume / adjust-budget |
| `block` | 阻断执行 |
| `require_escalation` | 需要 authority / budget / provider access escalation |

`require_escalation` 来自 `10 §8.3` 的通用 guard decision；budget guard 的常规结果仍以 `10 §10.3` 为准。本 ADR 将它纳入 `budget_guard_decision`，用于表达预算不足但存在合法升级路径的场景。它是 guard decision，不是 ADR-0002 `next_action`。

### 4. Escalation enums

#### 4.1 escalation_type

| value | 语义 |
| --- | --- |
| `authority` | 当前 authority 不足，需要上级授权 |
| `budget` | 当前预算不足或需要预算提升 |
| `provider_access` | provider / model / external access 不足 |

#### 4.2 escalation_reason

| value | 语义 |
| --- | --- |
| `insufficient_authority` | 当前 authority_scope 不足 |
| `budget_exceeded` | 已超过预算或已硬性命中预算 |
| `budget_threshold` | 尚未超限，但达到 confirmation/checkpoint threshold |
| `child_scope_exceeded` | 子 Agent 需要超过父级授予的 authority / budget |
| `provider_access_required` | 需要额外 provider 或 external access |
| `high_risk_action` | 高风险 intent/action 需要更高授权或人工审批 |

`repeated_failure` 不进入 escalation_reason。现有文档把重复失败主要建模为 retry cap 后 checkpoint / fail 的输入，而不是升级授权的直接原因。若后续 policy 需要把重复失败纳入 escalation，必须新 ADR 或 ADR-0003 revision。

注：W5 初始计划曾把“重复失败”列为 escalation 触发条件之一。本 ADR 有意收窄该口径：重复失败本身先归入 retry/checkpoint/failure policy；只有同时出现 authority / budget / provider access 不足时，才通过对应 escalation reason 上抛。

#### 4.3 escalation_status

| value | 语义 |
| --- | --- |
| `requested` | escalation 已创建，等待处理 |
| `approved` | escalation 已批准 |
| `denied` | escalation 已拒绝 |
| `expired` | escalation 因上下文或时间窗口失效 |
| `superseded` | escalation 被更新请求替代 |

#### 4.4 escalation_resolution

| value | 语义 |
| --- | --- |
| `grant_scope` | 授予请求的 authority / provider access |
| `increase_budget` | 提升预算 |
| `continue_without_change` | 不提升 scope，但允许按当前边界继续 |
| `checkpoint_task` | 停在 checkpoint |
| `block_action` | 阻断动作 |
| `cancel_task` | 取消 task |

`escalation_status` 描述 escalation 对象生命周期；`escalation_resolution` 描述审批结果对 runtime 的影响，二者不得混用。

### 5. 跨字段约束

1. 任意 writable action 必须携带 `authority_scope`。
2. `write_scope=read_only` 时，不得产生 mutation、tentative artifact 或 authoritative write。
3. `write_scope=propose_only` 时，只能产生 proposal / explanation，不得写 `adoption_state.pending[]`。
4. `write_scope=tentative_write` 时，可产生 tentative artifact 与 pending adoption，但不得直接写 authoritative state。
5. `write_scope=production_write` 仍必须受 policy / confirmation / approval 约束；它不是绕过安全门的万能权限。
6. long-run task 必须同时具备 `authority_scope` 与 `estimated_budget`；缺任一项为非法 task。
7. 子 Agent 的 authority_scope 与 budget 必须是父 Agent 授予范围的子集。
8. 子 Agent 需要超出父级授权时，必须返回 escalation / confirmation / checkpoint，不得静默自提权。
9. budget guard decision 为 `checkpoint` 时，必须写 consumed snapshot 与 resume / adjust-budget 路径。
10. budget guard decision 为 `block` 时，不得继续 provider call、capability invocation 或 write。
11. `require_escalation` 必须生成 escalation object，且 `escalation_type` / `escalation_reason` 不得为空。
12. `high_risk_action` 默认先触发 confirmation；只有当执行还需要更高 authority / budget / provider access 时，才升级为 escalation。
13. security block 不得被记录为普通 `cancel_task`；必须保留 audit reason。
14. provider usage 必须 roll up 到上层 budget consumption。

### 6. Schema 建议 `$id`

本 ADR 沿用 ADR-0001 的 schema 根目录约定：`docs/design-v2/schemas/`。

建议 `$id`：

- `foundation/enums/capability_scope.json`
- `foundation/enums/write_scope.json`
- `foundation/enums/task_control_scope.json`
- `foundation/enums/budget_override_scope.json`
- `foundation/enums/budget_scope_type.json`
- `foundation/enums/budget_dimension.json`
- `foundation/enums/budget_threshold_kind.json`
- `foundation/enums/budget_guard_decision.json`
- `foundation/enums/escalation_type.json`
- `foundation/enums/escalation_reason.json`
- `foundation/enums/escalation_status.json`
- `foundation/enums/escalation_resolution.json`

---

## 决策原因

选择方案 B 的原因：

1. `write_scope` 已经在多处文档冻结，不应重复发明。
2. `capability_scope` 与 `budget_override_scope` 虽未有源枚举，但 W5 明确要求填补，否则无法做 contract tests。
3. budget 需要同时表达 scope、dimension、threshold 和 guard decision；只冻结一个 `budget_class` 不足以支撑 long-run checkpoint 与 UI 门禁。
4. escalation 必须与 confirmation / checkpoint / cancellation 分开，否则高风险审批、预算不足和安全阻断会被混成同一种 UI 暂停。
5. repeated failure 在现有文档中更接近 retry/checkpoint/failure policy，不是 authority/budget/provider escalation 的直接原因。
6. 保留 provider pricing 与阈值算法为后续实现策略，可以避免 W5 过早绑定模型价格或运行时估算方式。

不选择方案 A，因为它无法关闭 W5 的枚举缺口。

不选择方案 C，因为它会把预算计算、provider 定价、retry policy 与 UI 呈现一并冻结，超出本 ADR 范围。

---

## 影响

### 对 Foundation 的影响

- `authority_scope` 最小结构与子枚举可被 schema / contract tests 引用。
- budget guard 可被机器校验为 `allow` / `allow_with_warning` / `require_confirmation` / `checkpoint` / `block` / `require_escalation`。
- escalation object 的 type / reason / status / resolution 可被审计与 UI 投影。

### 对 Domain 的影响

- Domain intent / capability / hook 不得自造 authority / budget / escalation 值。
- 高风险 Domain action 可使用 `high_risk_action` 作为 escalation reason，但默认仍应先走 confirmation / approval policy。
- Domain 写入必须受 `write_scope` 约束；小说对象的 tentative / authoritative 边界不得绕过 Foundation authority。

### 对 UI 的影响

- UI 可以稳定展示 authority gate、budget warning、checkpoint、block、escalation required。
- UI 不得把 `require_escalation` 当成 ADR-0002 `next_action`；它是 budget/authority guard decision，需要投影为 card/action。
- UI 可以把 escalation status 与 resolution 分开展示：请求状态不是最终处理结果。

### 迁移策略

- 旧文档中的 hyphenated write scope（如 `read-only`）统一迁移为 snake_case（`read_only`）。
- 旧文档中的 `write_limit` / write volume / expected writes 在 budget dimension 中统一归入 `write_count`。
- 旧文档中把 budget hit 表达为普通 failure 的地方，迁移为 `budget_guard_decision=checkpoint` 或 `block`，并保留 consumed snapshot。
- 旧文档中把 repeated failure 作为 escalation reason 的地方，迁移为 retry cap / checkpoint / failure policy；除非同时存在 authority / budget / provider access 不足。
- 旧文档中把 security block 记录为 cancellation 的地方，迁移为 block + audit reason。

---

## 后续工作

### 必须更新的文档

1. `../29-design-integrity-review.md` §7.1
   - 将 Foundation 第 5 项标注为已由 ADR-0003 冻结。
2. `../30-contract-glossary.md` §10
   - 增加 ADR-0003 冻结的 authority / budget / escalation 枚举摘要。
3. `../01-agent-foundation-contract.md` §17 / §27
   - 将 authority scope 完整枚举与 budget class 规则标注为已由 ADR-0003 冻结。
4. `../10-security-and-budget.md` §4 / §6 / §10 / §14 / §27 / §28
   - 将相关 enum 与 guard decision 标注为 ADR-0003 权威。
5. `../06-planning-and-long-run.md` §5 / §9 / §24
   - 将 budget dimension、checkpoint threshold 与 task authority 要求指向 ADR-0003。
6. `../12-multi-agent-composition.md` §7 / §8
   - 将子 Agent authority / budget 子集与 escalation 上抛规则指向 ADR-0003。
7. `0001-turn-result-v2-schema.md`
   - 将 ADR-0003 从占位依赖更新为已冻结 authority / budget / escalation 枚举权威。
8. `0002-state-enums.md`
   - 将 ADR-0003 从后续依赖更新为已冻结 W5 权威。
9. `0000-index.md`
   - 新增 ADR-0003 条目。
10. `../00-overview.md` §7
   - 新增 authority / budget / escalation 最小枚举已冻结的决策索引。

### 必须补的契约测试

1. authority_scope shape 测试：必须包含 `capability_scope`、`write_scope`、`task_control_scope`、`budget_override_scope`。
2. write_scope 测试：`read_only` / `propose_only` / `tentative_write` / `production_write` 对写入能力的限制必须生效。
3. task_control_scope 测试：只有具备对应 `create_task` / `resume_task` / `cancel_task` / `branch_task` 的主体才能执行 task control。
4. budget dimension 测试：`token` / `wall_time` / `cost` / `invocation_count` / `write_count` / `execution_unit_count` 必须可解析。
5. budget guard decision 测试：`checkpoint` 必须产生 consumed snapshot，`block` 必须阻断后续副作用，`require_escalation` 必须生成 escalation object。
6. delegation subset 测试：子 Agent authority 与 budget 不得超过父级授予范围。
7. escalation object 测试：`type` / `reason` / `status` / `resolution_ref` 必须符合本 ADR 枚举。
8. high-risk action 测试：默认先走 confirmation；只有 authority / budget / provider access 不足时才生成 escalation。
9. repeated failure 测试：不得直接作为 escalation reason，除非同时满足本 ADR 的 escalation 条件。
10. security block 测试：不得落成普通 cancellation，必须保留 audit reason。

### 依赖 ADR

- ADR-0001（W1，TurnResult v2 顶层 schema）：本 ADR 为其 authority / budget / escalation 相关引用提供 enum authority。
- ADR-0002（W2，state/status/next_action 枚举）：本 ADR 不新增 `next_action`，但 budget guard / escalation 可被 UI 投影为 action/card。
- ADR-0005（W3，behavior-specific UI hint）：已冻结 behavior-specific UI hint 最小 schema；本 ADR 不新增 UI hint 字段。
- ADR-0006（W4，card / action schema）：不属于本 ADR 范围。

---

## 状态

当前状态为 Accepted。oracle 评审已确认：

1. `capability_scope` 与 `budget_override_scope` derived enum 有足够文档依据。
2. `write_scope` 没有被重复发明或漂移。
3. budget guard decision 与 ADR-0002 `next_action` 没有混用。
4. repeated failure 没有被错误提升为 escalation reason。
5. W3 / W4 / provider pricing / budget algorithm 范围没有被吞并。
