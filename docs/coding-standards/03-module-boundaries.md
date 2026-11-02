# 模块边界

模块和 App 必须有清晰的职责界限，禁止跨边界引用。

## 3.1 App 间依赖（AGENTS.md 强制规则）

参见 `AGENTS.md` 中的「架构约束」章节。编译期强制，违反即编译失败。

**简记**：`novel_web → novel_application → {novel_agent, novel_domain} → novel_foundation`

## 3.2 模块规模治理

行数是**代理指标**，不是判定标准；本质判据是**职责数**与**变更理由**。本节规则按「源头判据 → 趋势门禁 → 例外」三层组织，遵循 [04 — 错误处理](04-error-handling.md) 的「先追源头，再决定校验」原则。

### 3.2.1 源头判据：一个模块一个变更理由

新增逻辑前先问落点，不要默认加进「已经什么都有」的大文件：

- 这个模块能否用一句 `@moduledoc` 说清？新逻辑属于这句话吗？
- 两个不同任务同时改它时，改的是同一个理由吗？（不是 → 拆）
- 内部是否混合了两类以上职责：actor 状态机 / 用例编排 / 持久化细节 / 展示渲染？

找不到明确归属时，**新建模块**是默认动作；把逻辑塞进大文件不是。定性判断不交给机器：门禁不判定「文件够不够优雅」，只保证趋势不被恶化。

### 3.2.2 趋势门禁：ratchet（只减不增）+ 新观察登记

机器只做两件事（`scripts/check_module_size.mjs`，接入 `scripts/ai_static_scan.sh` 与 CI）：

| 规则 | 内容 | 失败条件 |
|---|---|---|
| R1 ratchet | 已登记在观察名单的文件，任何改动不得让行数超过登记上限 | 当前行数 > 登记 `max_lines` |
| R2 新观察登记 | 出现超过关注门槛、但未登记也未豁免的文件 | 必须拆分，或在 baseline 登记豁免理由 |

- **关注门槛** `outlier_floor`：生产代码 500 行 / 测试文件 800 行（见 `quality/module-size-baseline.json` 的 `policy`）。它只是「何时需要登记」的入口，**不是行数红线**——不存在「超过 K 行即失败」的规则。
- **拆分对冲**：确实需要在既有文件里新增逻辑时，先把等量或更多内容抽到职责单一的新模块，保持净增长 ≤ 0。这不是「为了行数的形式拆分」，而是用「新逻辑必须找到新归属」强制做源头设计。
- **不追溯**：baseline 冻结现状，门禁从 baseline 生成时点起生效，不回判历史。
- **不得绕过**：禁止用 `_impl.ex`、mixin、把多个模块塞进一个文件再拆文件、或调高 `max_lines` 来规避；baseline 更新只允许降低上限（`--write-baseline` 取 `min`），新增观察文件必须显式 `--register-new`。

### 3.2.3 例外：本质聚合型文件

有些文件「大」是正确设计，拆散反而是反模式，必须显式登记在 baseline `exemptions`（理由 + owner + 复核日期）：

- 用户可见文案唯一真源（`frontend/src/lib/copy.ts`，规范强制集中）；
- 最小合法契约样本 / fixture 数据（`provider/stub.ex`、schema 样本）；
- 纯数据表 / 词表（确认无逻辑混合时）。

豁免不等于免检：仍受 review 判据约束；新增逻辑不得借豁免文件堆放。

### 3.2.4 拆分模式库

| 文件类型 | 拆分方向 |
|---|---|
| GenServer / Channel | 状态机与命令处理分离：纯状态转移函数模块 + 按动作域拆 process/handler 模块；Channel 的 `handle_in` 分派保持薄 |
| Application 服务（编排） | 用例编排与领域规则分离：编排模块只做 step 排序/预算/错误传播，领域判定下沉为纯函数模块 |
| Workflow（`agent_run_flows/*`） | 按阶段拆 step 模块，共享 `AuthoringSession`/结果契约；不要复制会话状态 |
| Repository / Ecto | 按聚合根或查询域拆；事务边界留在唯一入口 |
| React 组件 | 容器（数据/副作用 hooks）与渲染子组件分离；文案留在 `copy.ts`，不随组件拆散 |

### 3.2.5 其他规模指标

| 指标 | 建议 | 说明 |
|------|------|------|
| 单个函数行数 | 20 行 | 超过提取子函数；CRAP < 10 由 ub-mode crapper 管理（Elixir 当前无工具覆盖） |
| 函数参数数 | 4 个 | 超过用 Map 或 Struct |
| public 函数数 | 12 个 | 模块对外契约规模；明显超过通常意味着多个职责 |

存量拆分按「变更频率 × 规模」排序，登记为独立架构债务任务，不与功能 slice 混做。

## 3.3 模块内聚

同一模块内的所有公有函数应在同一抽象层级上操作同一概念：

```elixir
# BAD — 混合了兴趣点计算和存储
def calculate_interest(principal, rate), do: principal * rate
def save_to_db(result), do: Repo.insert(result)

# GOOD — 职责分离
defmodule InterestCalculator do
  def calculate(principal, rate), do: principal * rate
end
defmodule InterestRepository do
  def save(result), do: Repo.insert(result)
end
```

## 3.4 循环依赖

禁止模块间相互引用。如果出现双向引用，提取共同依赖到新模块。

```elixir
# BAD — A 引用 B，B 引用 A
defmodule A, do: def run, do: B.work()
defmodule B, do: def work, do: A.run()

# GOOD — 提取公共协议
defmodule Protocol, do: @callback run()
defmodule A, do: def run, do: Protocol.run()
defmodule B, do: def work, do: Protocol.run()
```

## 3.5 文件与模块一致性

- 一个文件只定义一个主模块（可包含同模块的私有子模块）
- 文件名必须与主模块名的最后一段一致（`NovelApplication.TurnService` → `turn_service.ex`）
