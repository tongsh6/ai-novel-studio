# tech-stack 技术栈文档目录

> 状态：草案
>
> 目的：把 v2 的技术栈选型与工程实施决策组织成一套独立的文档集。本目录回答"用什么具体的语言、框架、工具来实现 v2 的 Foundation / Domain / UI contract"。
>
> 与 v2 设计文档的关系：本目录**不创造新的 contract**，只回答"已冻结的 contract 怎么落地"。任何对 contract 的修改必须先走 `../adr/` 流程，本目录只跟随。

---

## 1. 本目录定位

`docs/design-v2/` 主目录回答**"系统语义是什么"**：

- Foundation Layer（00-12）：通用 Agent 基础语义
- Novel Domain Layer（20-34）：小说业务语义
- UI Layer（40-47）：界面语义

`docs/design-v2/tech-stack/` 回答**"用什么落地"**：

- 后端语言 + 框架 + 持久化
- 前端语言 + 框架 + 状态管理
- 桌面壳 + 部署形态
- 子系统在具体技术栈上的映射
- 工程纪律 + 工作流 + Phase 0 路线图

**两个目录的边界**：

```text
docs/design-v2/             docs/design-v2/tech-stack/
├── 是什么 / 为什么          ├── 用什么 / 怎么落地
├── ADR 锁定语义             ├── 工程决策可演进
├── 不绑技术栈               ├── 围绕技术栈展开
└── UI 是 contract           └── UI 是 React 组件
```

---

## 2. 文档索引

### 决策与候选

| 文档 | 内容 |
|---|---|
| [`00-overview.md`](./00-overview.md) | 技术栈总纲：4 个核心约束 + 最终方案 + 阶段切换 |
| [`01-decision-rationale.md`](./01-decision-rationale.md) | 决策推理过程：三轮讨论的关键转折点 + confidence + 会动摇推荐的条件 |
| [`02-alternatives.md`](./02-alternatives.md) | 完整候选集（18 个）+ 透明剔除 + 决赛对比 |

### 各层栈

| 文档 | 内容 |
|---|---|
| [`03-backend.md`](./03-backend.md) | Elixir 1.17 + Phoenix 1.7 + Ecto + langchain_elixir 后端栈 |
| [`04-frontend.md`](./04-frontend.md) | React 18 + TypeScript + Vite + Zod 前端栈 |
| [`05-desktop.md`](./05-desktop.md) | Tauri 2 + Mix Release sidecar 桌面壳 |
| [`06-database.md`](./06-database.md) | SQLite ↔ PostgreSQL 切换策略 + Ecto adapter |

### 子系统技术映射

| 文档 | 对应 v2 子系统 |
|---|---|
| [`07-provider.md`](./07-provider.md) | §08 Provider Abstraction 在 Elixir 上的实现 |
| [`08-multi-agent.md`](./08-multi-agent.md) | §12 Multi-Agent Composition 在 OTP 上的映射 |
| [`09-schema-codegen.md`](./09-schema-codegen.md) | ADR-0001 等 JSON Schema → Ecto + Zod codegen |
| [`10-observability.md`](./10-observability.md) | §09 Observability 的 OTel-erlang 落地 |

### 工程实施

| 文档 | 内容 |
|---|---|
| [`11-deployment.md`](./11-deployment.md) | 阶段 1 单机 → 阶段 2 B/S 部署形态 |
| [`12-development.md`](./12-development.md) | Mix umbrella 仓库结构 / 构建 / 测试 / CI |
| [`13-risks.md`](./13-risks.md) | 已识别风险登记 + 缓解策略 |
| [`14-roadmap.md`](./14-roadmap.md) | Phase 0 工作分解（第 1 周到第 1 个月）|

---

## 3. 阅读顺序

第一次读：

1. `00-overview.md` - 总览结论
2. `01-decision-rationale.md` - 为什么选这个
3. `02-alternatives.md` - 别的为什么不行

挑战推荐时：

1. `02-alternatives.md` 第 5 节 - 决赛对比
2. `13-risks.md` - 风险是否可接受
3. `01-decision-rationale.md` 第 5 节 - 会动摇推荐的条件

实施时：

1. `14-roadmap.md` - 路线图
2. `12-development.md` - 仓库结构
3. `03`-`06` - 各层栈具体清单
4. `07`-`10` - 关键子系统的技术实现

---

## 4. 与 v2 主目录的引用关系

本目录所有文档**只引用、不修改** v2 主目录已冻结的 contract：

| 主目录文档 | 在本目录被引用的位置 |
|---|---|
| [`../00-overview.md`](../00-overview.md) | `00-overview.md` 第 5 节、`01-decision-rationale.md` 第 2 节 |
| [`../00e-architecture.md`](../00e-architecture.md) | `03-backend.md`、`05-desktop.md`、`11-deployment.md` |
| `../01-agent-foundation-contract.md`（待写） | `08-multi-agent.md` |
| [`../adr/0001-turn-result-v2-schema.md`](../adr/) | `09-schema-codegen.md` |
| [`../adr/0011-projection-refresh-state-triggers.md`](../adr/) | `08-multi-agent.md`、`10-observability.md` |
| `../12-multi-agent-composition.md`（待写） | `08-multi-agent.md` 全文核心 |

---

## 5. 编号约定

- `README.md`：本路线图
- `00-overview.md`：总览
- `01`-`02`：决策类
- `03`-`06`：各层栈
- `07`-`10`：子系统映射（与 v2 主目录子系统编号一致以便交叉引用）
- `11`-`14`：工程实施

后续如需新增文档：

- 新候选评估：`02a-`、`02b-` 等子文档
- 新栈层（如缓存层 / 消息队列层）：在 `06`-`10` 之间插入
- 新 ADR-relevant 决策：必须先在 `../adr/` 立 ADR，本目录只引用

---

## 6. 状态变迁规则

| 状态 | 含义 | 修改纪律 |
|---|---|---|
| 草案 | 当前默认状态 | 可自由修改 |
| 评审中 | 等待 oracle / 团队 review | 修改需走评审流程 |
| 已锁定 | 已纳入 Phase 0 实施基线 | 修改必须 ADR + 迁移说明 |
| 已废弃 | 不再适用 | 保留作历史，不删除 |

技术栈决策属于**工程实施层**，不是 Foundation contract。允许：

- 主版本号升级（如 Phoenix 1.7 → 1.8）：直接修改文档
- 库替换（如 langchain_elixir → instructor_ex）：修改文档 + 通知团队
- 栈级替换（如 Elixir → 别的）：必须重新走 `01-decision-rationale.md` 的 4 个约束验证 + ADR

---

## 7. 术语对照（避免歧义）

本目录与 v2 主目录混用了两套"阶段"术语，含义不同：

| 术语 | 含义 | 出现位置 |
|---|---|---|
| **阶段 1 / 阶段 2**（产品形态） | 单机桌面应用 vs B/S 多用户服务 | `00-overview.md` §3-§4、`05-desktop.md`、`11-deployment.md` |
| **Phase 0 / Phase 1**（工程阶段） | Phase 0 = 脚手架 + 第一份 schema + smoke test（3-4 周）；Phase 1 = 按 v2 README §7 顺序写 Foundation/Domain 子系统 | `14-roadmap.md`、`13-risks.md` |

两套术语正交：Phase 0 和 Phase 1 都发生在产品"阶段 1"内。

---

## 8. 当前共识

1. 技术栈已锁定为 **Elixir + React/TS + Tauri**（详见 `00-overview.md`）。
2. 推荐 confidence 90%+，会动摇的 3 个条件已记录在 `01-decision-rationale.md` 第 5 节。
3. 完整候选集与剔除理由已透明化在 `02-alternatives.md`，避免决策黑箱。
4. 本目录与 `../` 主目录平行，**互不污染**。
5. v2 README "代码可以从头开始"是本目录工作的前提，无 v1 代码迁移负担。
