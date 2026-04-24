# ADR-0001：TurnResult v2 顶层 schema

- 状态：Accepted
- 日期：2026-04-24（Accepted 于 2026-04-24，oracle 二轮复审 ACCEPT）
- 涉及范围：Foundation 子系统 1（Agent Foundation Contract）/ 子系统 2（Turn & Task State Machines）/ 子系统 11（UX Contract）
- 相关文档：
  - `../01-agent-foundation-contract.md` §8.1 / §9 / §26 / §27
  - `../02-turn-and-task-state-machines.md` §4 / §5 / §11
  - `../03-conversation-behaviors.md`
  - `../11-ux-contract.md` §4 / §5 / §6 / §13 / §19
  - `../29-design-integrity-review.md` §4.2.1 / §7.1（第 1 项）
  - `../30-contract-glossary.md` §2 / §3 / §6
- 取代：无
- 取代者：无

---

## 背景

`01-agent-foundation-contract.md` §8.1 已经冻结「单一 canonical result」为硬骨：任何 turn 都必须产出统一顶层结果对象。但 §27 第 1 项明确把「TurnResult v2 完整 JSON schema」列为暂不冻结项；§9.2 只给了最小职责，未给字段。

`29-design-integrity-review.md` §4.2.1 给出影响：

- Domain 不知道结果该挂在哪一层；
- UI 无法稳定定义主消息、cards、behavior、adoption、projection 这五条顶层读取路径；
- §7.1 把它列为「UI 设计前必须冻结」第 1 项。

同时 `02` / `03` / `11` / `30` 已经把以下要素分别落定：

- phase / status / next_action 的语义结构（`02 §4`、`02 §5`、`02 §11`，完整枚举值由 ADR-0002 收口）；
- behavior 分 durable / instant 两类（`30 §6`、`03`）；
- assistant_message 与 ui_cards 是两类顶层呈现对象（`11 §4`）；
- card 基础 taxonomy 与 visibility 分级（`11 §6`、`11 §19`）；
- adoption 7 态（`30 §3.2`），artifact 与 mutation 的 revision 字段命名（`30 §2`）。

W1 不发明新语义，只把这些散落字段聚合为统一顶层 schema，使 UI / Domain / Multi-Agent 都拿到唯一权威读取路径。

---

## 考虑过的方案

### 方案 A：仅字段表（不写 JSON Schema）

只给字段名、类型、必填性、引用枚举。

- 优点：最轻量、可读性高、与 §27 「定边界不定字段」语气一致。
- 缺点：UI 实现仍需猜测嵌套结构与可空性；契约测试无法机器校验；与 §7.1「UI 前必须冻结」目标不匹配。

### 方案 B：完整 JSON Schema draft-07 + 枚举占位

写完整 JSON Schema；枚举值与 envelope 子结构用 `$ref` 占位，指向后续 ADR（ADR-0002 phase/status/next_action 枚举、ADR-0003 authority/budget、ADR-0005 behavior-specific UI hint、ADR-0006 card schema、独立 envelope ADR）。

- 优点：UI / Domain 拿到机器可校验的稳定接口；W1 自身不越界，不重复定义后续 ADR 的内容；契约测试可立即起步（schema 校验 + ref resolver 阶段性 mock）。
- 缺点：需要后续 ADR 同步落地才能完整可用，但这是 §29.7.1 多 ADR 编排的正常代价。

### 方案 C：完整 JSON Schema + 内联当前已定义的枚举

把 `02` 已写出的 phase / status / next_action 字面值直接内联到 W1。

- 优点：W1 单文件即可被 UI 消费。
- 缺点：与 ADR-0002 重复定义同一枚举；后续若 ADR-0002 微调枚举值，必须双处改；违背 ADR 单一权威原则。

### 方案 D：完整 JSON Schema 且把 envelope 子结构（ValidationEnvelope / UsageEnvelope / TraceRef）一并冻结

W1 顺手把 `01 §9` 列出的全部 interaction contract 成员都定义。

- 优点：UI 一次性拿到完整 contract。
- 缺点：超出 §29.7.1 第 1 项「TurnResult v2 最小完整 schema」边界；envelope 自身值得独立 ADR，混入后会让 W1 评审范围发散。

---

## 最终决策

采用 **方案 B**：完整 JSON Schema draft-07 + 枚举与 envelope 子结构使用 `$ref` 占位。

W1 冻结的范围严格限定为：

1. TurnResult v2 顶层对象的字段集合、类型、必填性、嵌套形状；
2. 五条顶层读取路径（主消息 / cards / behavior / adoption / projection）的 canonical 字段名与挂载位置；
3. 与 `30-contract-glossary.md` 已有命名规范（adoption / revision / authority / behavior / namespace）的强制对齐；
4. version 字段与向前兼容声明。

W1 显式不冻结的范围：

- phase / status / next_action 枚举值清单（→ ADR-0002）；
- ValidationEnvelope / UsageEnvelope / TraceRef 内部 schema（→ 后续独立 ADR，编号待定）；
- card type 全集（基础 taxonomy 由 `11 §6` 给出，扩展 schema → 后续 W4 `card / action 最小 schema` ADR）；
- authority / budget / escalation 枚举（→ ADR-0003 / W5）；
- behavior-specific UI hint 字段（→ ADR-0005 / W3）；
- `render_mode`：由 `11-ux-contract.md §5` 定义为 Foundation→UI 的独立 contract 元素，其最终 schema 归属独立 ADR（候选：与 `assistant_message` / envelope ADR 合稿），不在本 ADR scope 内，故 TurnResult 顶层不包含此字段。

---

## 决策原因

**为什么选 B 而非 A**：§29.7.1 第 1 项把 W1 标为「UI 前必须冻结」。仅字段表无法被前端机器消费，也无法纳入契约测试，达不到「冻结」的语义强度。

**为什么选 B 而非 C**：v2 设计的根本纪律是「同一语义单一权威」（`30 §1`「同一个语义只能有一个 canonical 名称」）。W2 即将冻结 phase / status / next_action 完整枚举；W1 内联会立刻产生双权威源。

**为什么选 B 而非 D**：§29.7.1 把 W1 与 envelope 拆为独立条目（虽然 envelope 未单列编号，但属于 §6.1 第 1 项展开范围）；混入会让 Momus 评审无法对齐单一主题。W1 + envelope ADR 并行是更稳的拆法。

**为什么用 JSON Schema draft-07 而不是 OpenAPI / Pydantic / TypeScript interface**：

- draft-07 与具体语言/框架解耦，符合 Foundation「业务无关」纪律；
- v2 文档全部 markdown，draft-07 内嵌代码块阅读成本最低；
- 既有 `00-overview.md` §6 / §7 描述均使用 JSON 文本片段，与 draft-07 互通；
- TypeScript / Pydantic / OpenAPI 都能从 draft-07 自动生成。

---

## 最终决策内容

### 1. TurnResult v2 顶层 schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "foundation/turn_result_v2.json",
  "title": "TurnResult",
  "type": "object",
  "required": [
    "schema_version",
    "turn_id",
    "phase",
    "status",
    "next_action",
    "assistant_message",
    "ui_cards",
    "behavior_state",
    "adoption_state",
    "projection_refs",
    "validation",
    "usage",
    "trace_ref",
    "produced_at"
  ],
  "additionalProperties": false,
  "properties": {
    "schema_version": {
      "type": "string",
      "description": "TurnResult schema 版本，semver。本 ADR 冻结的版本是 2.0.0。",
      "pattern": "^\\d+\\.\\d+\\.\\d+$"
    },
    "turn_id": {
      "type": "string",
      "description": "本轮 turn 的稳定唯一 id，由 Orchestrator 生成。"
    },
    "task_id": {
      "type": ["string", "null"],
      "description": "若本 turn 关联 long-run task，则填该 task id；否则 null。"
    },
    "agent_id": {
      "type": ["string", "null"],
      "description": "产出本 turn 的 Agent id。Orchestrator 直接处理时填 orchestrator 的 agent_id；Multi-Agent 场景下子 Agent 必须填自身 id；纯系统内部 turn 可填系统保留 id 或 null。"
    },
    "parent_turn_id": {
      "type": ["string", "null"],
      "description": "若本 turn 是 child agent 在 parent turn 内的子轮，则填 parent turn id。"
    },
    "phase": {
      "$ref": "foundation/enums/turn_phase.json",
      "description": "完整枚举由 ADR-0002 冻结。语义见 02 §4.1 / §5.1。"
    },
    "status": {
      "$ref": "foundation/enums/status.json",
      "description": "完整枚举由 ADR-0002 冻结。语义见 02 §4.4 / §5.2；status family 为 turn / task / artifact projection 共用。"
    },
    "next_action": {
      "$ref": "foundation/enums/next_action.json",
      "description": "完整枚举由 ADR-0002 冻结。语义见 01 §9.3 / 02 §11；UI 映射见 30 §9。"
    },
    "assistant_message": {
      "$ref": "foundation/assistant_message.json",
      "description": "顶层主消息。canonical 名称为 assistant_message，不再使用 main_message / primary_message 等别名。结构见 11 §4.1，详细 schema 由后续 ADR 冻结。"
    },
    "ui_cards": {
      "type": "array",
      "description": "顶层结构化卡片列表，与 assistant_message 是两类并列顶层呈现对象（11 §4）。",
      "items": {
        "$ref": "foundation/ui_card.json"
      }
    },
    "behavior_state": {
      "type": "object",
      "description": "本轮活跃 behavior 的快照。durable / instant 分类见 30 §6。",
      "required": ["active", "history"],
      "additionalProperties": false,
      "properties": {
        "active": {
          "type": ["object", "null"],
          "description": "当前未关闭的 durable behavior 状态；instant behavior 不出现在 active。",
          "required": ["behavior_type", "behavior_id", "status"],
          "additionalProperties": true,
          "properties": {
            "behavior_type": {
              "type": "string",
              "description": "durable behavior 名称。canonical 集见 30 §6.1：clarification / confirmation / correction / cancellation。"
            },
            "behavior_id": {
              "type": "string",
              "description": "本 behavior 实例 id。"
            },
            "status": {
              "$ref": "foundation/enums/behavior_status.json",
              "description": "完整枚举由 ADR-0002 冻结。"
            },
            "resolution_ref": {
              "type": ["string", "null"],
              "description": "behavior 已 resolve 时的 resolution 引用；durable 必须有，instant 不强制（30 §6）。"
            }
          }
        },
        "history": {
          "type": "array",
          "description": "本 turn 内已结束（含 instant 完成）的 behavior 摘要列表，按发生顺序。",
          "items": {
            "type": "object",
            "required": ["behavior_type", "behavior_id", "status"],
            "additionalProperties": true,
            "properties": {
              "behavior_type": { "type": "string" },
              "behavior_id": { "type": "string" },
              "status": { "$ref": "foundation/enums/behavior_status.json" },
              "resolution_ref": { "type": ["string", "null"] }
            }
          }
        }
      }
    },
    "adoption_state": {
      "type": "object",
      "description": "本轮新产生或状态变化的 artifact adoption 视图。adoption 7 态由 30 §3.2 冻结。",
      "required": ["pending", "resolved"],
      "additionalProperties": false,
      "properties": {
        "pending": {
          "type": "array",
          "description": "本 turn 产出且尚未达终态的 artifact 列表。",
          "items": { "$ref": "foundation/artifact_adoption_entry.json" }
        },
        "resolved": {
          "type": "array",
          "description": "本 turn 内进入终态（ACCEPTED / EDITED_ACCEPTED / DISCARDED / SUPERSEDED / INVALIDATED / ARCHIVED）的 artifact 列表。",
          "items": { "$ref": "foundation/artifact_adoption_entry.json" }
        }
      }
    },
    "projection_refs": {
      "type": "array",
      "description": "本 turn 影响到的派生投影引用。canonical 名称为 projection_refs（与 30 §2.3 source_revision_refs 对齐复数命名风格）。Domain 投影对象族定义在 30 §8.3。",
      "items": {
        "type": "object",
        "required": ["projection_type", "projection_id", "source_revision_refs"],
        "additionalProperties": true,
        "properties": {
          "projection_type": {
            "type": "string",
            "description": "投影类型；Domain 注册，例如 reading_projection_root / reading_projection_toc / reading_projection_chapter / reader_recap（30 §8.3）。"
          },
          "projection_id": { "type": "string" },
          "source_revision_refs": {
            "type": "array",
            "description": "该投影所依赖的 accepted / authoritative source revisions（30 §2.3）。",
            "items": { "type": "string" }
          },
          "refresh_status": {
            "type": ["string", "null"],
            "description": "投影刷新状态；具体枚举由 §29.7.1 第 11 项 ADR 冻结。"
          }
        }
      }
    },
    "validation": {
      "$ref": "foundation/validation_envelope.json",
      "description": "ValidationEnvelope。详细 schema 由独立 ADR 冻结；本 ADR 仅声明字段引用与必填性。"
    },
    "usage": {
      "$ref": "foundation/usage_envelope.json",
      "description": "UsageEnvelope。token / 时间 / 成本 / 写入规模等度量；详细 schema 由独立 ADR 冻结。"
    },
    "trace_ref": {
      "$ref": "foundation/trace_ref.json",
      "description": "TraceRef。指向本 turn 的 trace；详细 schema 由独立 ADR 冻结。"
    },
    "warnings": {
      "type": "array",
      "description": "本 turn 产生的非阻塞警告。",
      "items": { "$ref": "foundation/warning_envelope.json" }
    },
    "errors": {
      "type": "array",
      "description": "本 turn 产生的错误。errors 非空时 status 不得为终态成功类值（如 02 §5.2 中的 DONE），具体禁止集合由 ADR-0002 联调。",
      "items": { "$ref": "foundation/error_envelope.json" }
    },
    "produced_at": {
      "type": "string",
      "format": "date-time",
      "description": "本 TurnResult 生成时间，ISO 8601 / RFC 3339。"
    }
  }
}
```

### 2. artifact_adoption_entry 子结构

```json
{
  "$id": "foundation/artifact_adoption_entry.json",
  "type": "object",
  "required": ["artifact_id", "artifact_type", "adoption_status", "requires_adoption"],
  "additionalProperties": true,
  "properties": {
    "artifact_id": { "type": "string" },
    "artifact_type": {
      "type": "string",
      "description": "Foundation artifact 类型或 Domain 注册类型。"
    },
    "adoption_status": {
      "type": "string",
      "enum": [
        "TENTATIVE",
        "ACCEPTED",
        "EDITED_ACCEPTED",
        "DISCARDED",
        "SUPERSEDED",
        "INVALIDATED",
        "ARCHIVED"
      ],
      "description": "由 30 §3.2 冻结的 7 态。本 ADR 直接内联，因为 30 §3.2 已是 canonical 唯一权威。"
    },
    "requires_adoption": {
      "type": "boolean",
      "description": "canonical 名称由 30 §3.1 冻结，不再使用 adoption_required。"
    },
    "revision_base": {
      "type": ["string", "null"],
      "description": "artifact 生成时依赖的源 revision（30 §2.2）。adoption 前必须与当前 target scope revision 比较。"
    },
    "supersedes_artifact_id": {
      "type": ["string", "null"],
      "description": "若 adoption_status = SUPERSEDED，指向取代它的 artifact id。"
    }
  }
}
```

### 3. 五条顶层读取路径（canonical 路径表）

UI / Domain / Multi-Agent 必须从下列固定路径读取，不得另起别名：

| 读取场景 | canonical 路径 | 来源依据 |
|---|---|---|
| 主消息 | `assistant_message` | `11 §4.1` |
| 结构化卡片列表 | `ui_cards[]` | `11 §4.2` |
| 当前活跃 durable behavior | `behavior_state.active` | `30 §6.1` / `03` |
| 本轮 behavior 历史 | `behavior_state.history` | `03` |
| 待审 artifact | `adoption_state.pending[]` | `30 §3` / `11 §13` |
| 已结案 artifact | `adoption_state.resolved[]` | `30 §3` |
| 本轮影响投影 | `projection_refs[]` | `30 §8.3` / `30 §2.3` |

### 4. 互斥与一致性约束

本 ADR 强制以下跨字段约束（契约测试覆盖项）：

1. `errors[]` 非空 → `status` 不得为终态成功类值（ADR-0002 已冻结当前禁止值为 `DONE`）。
2. `behavior_state.active != null` → `next_action` 必须属于 ADR-0002 冻结的「等待用户」子集：`ASK_USER`、`CONFIRM_BEFORE_EXECUTE`、`ADOPT_ARTIFACTS`、`RESUME_TASK`、`CANCEL_TASK`。
3. `adoption_state.pending[]` 任一项 `requires_adoption == true` → `next_action` 至少能映射到 `30 §9` 中 `ADOPT_ARTIFACTS` 行。当 pending adoption 与 active behavior 同时存在时，`next_action` 的选取优先级由 Orchestrator 策略决定，但必须在 audit 中记录选择理由。
4. `task_id != null` → `phase`（turn phase）必须与 task 当前上下文相容（例：task 处于 `CHECKPOINT` 且触发 clarification 时，turn phase 取 `NEEDS_CLARIFICATION`；task `RUNNING` 且 turn 正在执行时，turn phase 取 `EXECUTING`）。turn phase ≠ task phase；二者各自集合分别定义在 02 §5.1 与 02 §8.1。
5. 任一 `projection_refs[i].source_revision_refs` 必须为非空数组（即使单源场景也用列表，遵守 `30 §2.3` 约束）。
6. `phase` 与 `next_action` 的组合不得违反 ADR-0002 §7 的 allowlist（如 `phase=COMPLETED` 不得搭配非 canonical `EXECUTE_DIRECTLY`，`phase=RUNNING` 不得搭配 `next_action=ASK_USER`）。
7. `behavior_state.active != null` 且其 `status` 为 closed/resolved 类终态 → `resolution_ref` 不得为 null。

### 5. 版本与兼容

- 本 ADR 冻结 `schema_version = "2.0.0"`。
- 加法优先（`01 §23.3`）：未来新增 optional 顶层字段升 minor。
- breaking change 必须升 major + 写新 ADR + 给兼容窗口（`01 §23.2`）。

---

## 影响

### 对 Foundation 的影响

- `01 §9.2` 的最小职责清单从「自然语言条目」升级为机器可校验 schema。
- `01 §27` 第 1 项「TurnResult v2 完整 JSON schema」从「暂不冻结」迁出，改写为「由 ADR-0001 冻结」。
- `01 §26` 硬骨第 5 条「canonical result 唯一性」从原则升级为 schema-level 约束。

### 对 Domain 的影响

- Domain 必须把所有 turn 输出挂载在本 schema 顶层字段下，禁止扩展顶层字段；扩展点在 `ui_cards[]`、`adoption_state.pending[].artifact_type`、`projection_refs[].projection_type` 内部。
- Domain 投影对象族（`30 §8.3`）必须按 `projection_refs[]` 形状暴露；`reader_recap` 等不再各自自定义顶层位置。
- **扩展纪律**：本 schema 在 `behavior_state.active`、`behavior_state.history[]`、`projection_refs[]`、`artifact_adoption_entry` 四处对子结构使用 `additionalProperties: true`，但 Domain 注入的扩展属性必须使用 `domain_ext.` 前缀（如 `domain_ext.required_fields`、`domain_ext.tone`），不得直接写入这些子结构的顶层属性，以避免与未来 W3 / W4 / W7 标准化字段冲突。契约测试将 lint 此前缀规则。

### 对 UI 的影响

- UI 拿到稳定五条顶层读取路径，不再依赖经验推断；
- `11 §4` 关于「两类顶层呈现对象」的描述与本 schema 一一对齐；
- 旧实现若使用过 `main_message` / `primary_message` / `cards` / `adoption_required` 等别名，必须迁移到 canonical 名。

### 迁移策略

v1 `AgentTurnResult` 与本 schema 不强制 wire-level 兼容（v2 设计纪律允许从头实现，见根 README 第 1 段）。但建议提供一次性 adapter：

- v1 `assistant_text` → `assistant_message.text` 兼容字段（具体由 assistant_message ADR 决定）；
- v1 `cards` → `ui_cards`；
- v1 `requires_adoption?` 旧字段 → `adoption_state.*.requires_adoption` 内联。

adapter 仅作为 v1 → v2 上线一次性 backfill 工具，不进入 v2 production code path。

---

## 后续工作

### 必须更新的文档

- `00-overview.md` §7：新增 D2-018「TurnResult v2 schema 由 ADR-0001 冻结」条目，并在「关键设计决策索引」中追加。
- `01-agent-foundation-contract.md` §27：第 1 项标注「→ 已由 ADR-0001 冻结」。
- `01-agent-foundation-contract.md` §9.2：补一行「字段级冻结见 ADR-0001」。
- `30-contract-glossary.md` §10：硬骨清单第 9 项追加「TurnResult v2 顶层 canonical 路径以 ADR-0001 为权威」。
- `29-design-integrity-review.md` §7.1 第 1 项：标注 ADR-0001。
- `adr/0000-index.md` §3：在「结构性修正记录」之后追加「独立 ADR 列表」小节，登记本 ADR。
- `12-multi-agent-composition.md` §2.1 / §13.1：canonical result schema 见 ADR-0001。
- `04-capability-and-intent-registry.md` §18：canonical result 形状见 ADR-0001。
- `06-planning-and-long-run.md` §4 / §24：long-run result 与 canonical result 映射见 ADR-0001。

### 必须补的契约测试

1. JSON Schema 校验：合法 / 缺失必填 / 多余 additionalProperties 三类样本。
2. 字段互斥矩阵（本 ADR §决策内容 4 列出的 7 条约束）。
3. canonical 命名 lint：禁止出现 `main_message` / `primary_message` / `cards`（顶层）/ `adoption_required` / 单数 `source_revision_ref`。
4. v1 → v2 adapter 的双向回归（仅 backfill 用途）。
5. `domain_ext.` 前缀 lint：`behavior_state.active` / `behavior_state.history[]` / `projection_refs[]` / `artifact_adoption_entry` 四处子结构内的扩展属性必须以 `domain_ext.` 开头，否则 reject。

### Schema 引用基址约定

约定 `docs/design-v2/schemas/` 为 schema 根目录。本 ADR 内 `$id` 与所有 `$ref` 路径（如 `foundation/turn_result_v2.json`、`foundation/enums/turn_phase.json`）均相对于该根目录解析。契约测试阶段提供 mock resolver 将相对路径映射到本目录的实际文件或占位 schema。后续若改为绝对 URI（例 `https://ai-novel-studio.example/schemas/...`），需 minor bump 并在 ADR-0002 / 0003 / 0006 等下游 ADR 同步更新。

### 待跟踪的 deprecation 窗口

- 任何 v1 字段的兼容映射在 v2 GA 之后保留 1 个 minor 版本，之后移除。

### 依赖 ADR

- ADR-0002（W2，turn / task / artifact 状态枚举 + phase / status / next_action 完整集合）：已冻结本 ADR 的 `phase` / `status` / `next_action` / `behavior_status` `$ref` 目标。注：adoption 7 态由本 ADR + `30 §3.2` 作为唯一 canonical 权威，ADR-0002 仅引用，不重定义。
- ADR-0003（W5，authority / budget / escalation 枚举）：影响 `behavior_state.active` 的等待语义集合。
- ADR-0006（W4，card / action 最小 schema）：`ui_cards[]` items 的 `$ref` 指向。
- ValidationEnvelope / UsageEnvelope / TraceRef / WarningEnvelope / ErrorEnvelope / AssistantMessage 各自独立 ADR：本 ADR 仅声明引用。

ADR-0003 / 0006 与 envelope ADR 落地前，本 ADR 仍可作为 schema 骨架被消费；契约测试在引用解析阶段对未落地引用使用 mock resolver。
