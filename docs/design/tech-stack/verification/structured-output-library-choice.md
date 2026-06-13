# 验证任务：Structured Output 库选型

> 状态：✅ 通过（2026-04-26 实测，含 `instructor_lite` 补评）
>
> 目标：确认 v2 的结构化 LLM 输出应由新版 `langchain_elixir` 直接承担，还是继续引入 `instructor_ex` / `instructor_lite`，或者保留自实现 Provider Gateway fallback。
>
> 实测结论：四条路径（langchain / instructor 0.1 / 直连 Req / instructor_lite 1.2）在修正 Ecto schema 后 normal 全部 20/20，free_form 与 lure_extra 都 3/3。决策 → **`instructor_lite` 1.2 作为结构化输出主依赖**，`langchain` 作为多 agent / 工具调用编排层，Provider Gateway 在二者之上统一 usage / 错误归一 / retry。`instructor_ex` 0.1.0 退场（代码层等价、维护活跃度劣势）。`A` 路径的 transport-level 错误归一化短板由 Provider Gateway 吸收。

---

## 1. 背景

tech-stack 原始推荐（本验证任务启动时）：

- `03-backend.md`：`langchain_elixir + instructor_ex + 自封装 Provider Gateway`。本验证二跑后已改为 `langchain_elixir + instructor_lite + 自封装 Provider Gateway`。
- `07-provider.md`：Provider Gateway 负责 provider 抽象、usage、错误标准化、streaming。
- `09-schema-codegen.md`：JSON Schema 是 SSOT，前后端 schema 都应从该来源生成。

结构化输出会直接影响：

- intent slot extraction
- `intent.CREATE_WORK_SEED`
- tentative artifact payload
- card payload
- quality finding
- approval / experience records

这个点需要单独验证，因为外部依赖状态不同：

- `langchain_elixir` 维护活跃，版本已更新到 0.8 系列。
- `instructor_ex` 版本低、活跃度弱，但目标能力更贴近“schema → structured output”。
- `instructor_lite` 是 `instructor_ex` 的活跃 fork / spiritual successor，维护状态优于 `instructor_ex`；二跑已纳入本次 spike 并成为最终推荐。
- 如果 `langchain_elixir` 已经足够稳定，减少一个低活跃依赖更稳。

---

## 2. 验证问题

必须回答：

1. `langchain_elixir` 是否能稳定产生符合 JSON Schema / Ecto changeset 的结构化结果？
2. `instructor_ex` 是否明显降低 structured output 的实现成本？
3. 两者对 OpenAI-compatible endpoint（LM Studio / Ollama / OpenAI）支持是否一致？
4. 错误场景下能否拿到可标准化的错误类型：schema mismatch、provider error、context length、content filter？
5. streaming 场景是否支持结构化输出，还是必须采用 non-streaming finalize？
6. 与 Provider Gateway 的 usage tracking / retry / circuit breaker 是否容易集成？

---

## 3. 最小实验

### 3.1 统一输出 schema

定义一个最小 `CreateWorkSeedOutput`：

```json
{
  "type": "object",
  "required": ["title", "genre", "core_hook", "initial_characters"],
  "properties": {
    "title": { "type": "string" },
    "genre": { "type": "string", "enum": ["玄幻", "都市", "科幻", "悬疑", "其他"] },
    "core_hook": { "type": "string" },
    "initial_characters": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "role"],
        "properties": {
          "name": { "type": "string" },
          "role": { "type": "string" }
        }
      }
    }
  }
}
```

### 3.2 对比实现

分别实现四条路径：

| 路径 | 说明 |
|---|---|
| A | `langchain_elixir` 原生 structured output 能力 |
| B | `instructor_ex` structured output（hex `instructor` 0.1.0） |
| C | Provider Gateway 自实现：OpenAI-compatible JSON schema / tool call 直连 |
| D | `instructor_lite` 1.2（`ChatCompletionsCompatible` adapter，是 `instructor_ex` 的活跃 fork / spiritual successor） |

### 3.3 测试输入

同一 prompt：

```text
帮我创建一本玄幻小说的初始设定，主角是失去灵根的少年，但体内封着一把远古剑魂。
```

每条路径执行：

1. 正常 prompt：应返回合法结构。
2. 故意要求自由发挥：应仍然被 schema 约束。
3. 故意诱导多余字段：应拒绝或过滤。
4. provider 超时 / fake error：应映射为标准错误。

---

## 4. 评估维度

| 维度 | 权重 | 说明 |
|---|---:|---|
| schema 合规稳定性 | 高 | 是否稳定通过 Zod / Ecto changeset / JSON Schema 校验 |
| provider 覆盖 | 高 | OpenAI / Anthropic / LM Studio / Ollama 是否可用 |
| 错误可标准化 | 高 | 是否能映射到 `Provider.Error.kind` |
| streaming 兼容 | 中 | 是否能与 Phoenix Channel 流式输出共存 |
| usage tracking | 中 | token / cost / latency 是否容易记录 |
| 依赖活跃度 | 高 | 维护频率、issue 响应、版本更新 |
| 代码复杂度 | 中 | Gateway 内部实现是否可维护 |

---

## 5. 通过标准

选定方案必须满足：

- [x] 对同一 schema 连续 20 次调用，合法结构输出成功率 ≥ 95%。**实测（2026-04-26 二次跑、Ecto.Enum + stringify 修正后）：A=20/20、B=20/20、C=20/20、D=20/20 全部 100%。**
- [x] schema mismatch 能被检测并触发 retry 或明确错误。**实测：`ex_json_schema` 在 spike 入口统一校验，四路径都返回 `:schema_mismatch` 或 `:invalid_json`。lure_extra 输入下模型未追加 schema 外字段（评估时模型是 `devstral-small-2:24b`）。**
- [⚠️] provider 错误能进入 `Provider.Error.kind` 标准化流程。**实测：B 返回 `:provider_error`，C/D 返回 `:transport_error`，可直接映射；A（`langchain`）在底层 `Req.TransportError` 时未被它内部的 `LangChainError` 捕获，落到我们的 rescue 分支变成 `:exception`，需要在 Provider Gateway 层补一层归一化。**
- [x] usage 信息能被 `Budget.Meter.consume/3` 使用。**实测：Ollama OpenAI-compat 返回 `usage: %{prompt_tokens, completion_tokens, total_tokens}`，A/B/C/D 都能拿到（B/D 需要从适配层的扩展返回里提取，本 spike 用 C 验证）。**
- [x] 不要求产品代码直接依赖 Python。
- [x] 能写 contract test，使用 stub provider 固定输出。**`Req` 提供 `Req.Test`，A/B/C/D 均经它即可拦截（D 通过 `adapter_context: [http_client: Req.Test, ...]` 直接注入）；本 spike 暂未写 contract test，列入 Phase 0。**

---

## 6. 决策规则

| 实测结果 | 决策 |
|---|---|
| `langchain_elixir` 足够稳定，代码简单 | 移除 `instructor_ex` 主依赖，保留自实现 fallback |
| `instructor_ex` 明显更稳且可维护 | 保留 `instructor_ex`，但在 `13-risks.md` 记录维护风险 |
| `instructor_lite` 能覆盖 B 路径能力且 API/维护更稳 | 切换结构化输出主依赖到 `instructor_lite`，`instructor_ex` 降为历史参考 |
| 两者都不稳 | Provider Gateway 自实现 OpenAI-compatible structured output |
| 不同 provider 差异太大 | Provider-specific adapter，Gateway 暴露统一 behaviour |

---

## 7. 结果记录

| 字段 | 内容 |
|---|---|
| 实测日期 | 2026-04-26（首跑三路径）；2026-04-26 二跑（补评 `instructor_lite` + 修正 Ecto.Enum 派生 + atom→string 序列化） |
| Elixir / OTP | Elixir 1.19.5 / OTP 28 |
| langchain_elixir 版本 | hex `langchain` 0.8.4 |
| instructor_ex 版本 | hex `instructor` 0.1.0 |
| instructor_lite 版本 | hex `instructor_lite` 1.2.0（2026-02-01 发布，2025-2026 内 5 次 release） |
| provider / model | 本机 Ollama 0.21.2，OpenAI-compat 端点 `http://localhost:11434/v1`，模型 `devstral-small-2:24b`（24B Mistral 系，无思考链，响应稳定） |
| A 路径结果 | normal 20/20、free_form 3/3、lure_extra 3/3；provider_error → `:exception`（**未规范化**）；normal 平均 3.8s |
| B 路径结果 | normal 20/20、free_form 3/3、lure_extra 3/3；provider_error → `:provider_error`（已规范化）；normal 平均 4.8s |
| C 路径结果 | normal 20/20、free_form 3/3、lure_extra 3/3；provider_error → `:transport_error`（已规范化）；normal 平均 5.6s；usage 字段直接可读 |
| D 路径结果 | normal 20/20、free_form 3/3、lure_extra 3/3；provider_error → `:transport_error`（已规范化）；normal 平均 8.8s；adapter 注入了一条额外 system message（多发了一次模板 prompt） |
| 最终选择 | **D 主 + A 副 + C fallback**：`instructor_lite` 作为结构化输出 SSOT 路径（intent slot、artifact、card payload、quality finding 等），`langchain` 留作多 agent / tool-call 编排，Provider Gateway 在二者之上做统一 usage 计量、retry 与错误归一。`instructor_ex` 0.1.0 在功能层等价但维护活跃度劣势，**退场**。`A` 的 transport-level 错误归一化是已知短板，Provider Gateway 必须吸收（详见 [`07-provider.md`](../07-provider.md) §7.1）。 |
| 后续文档更新 | 1) `03-backend.md`：依赖清单把 `instructor` 替换为 `instructor_lite`，并在 §2.5 改写"职责分层"小节；2) `07-provider.md`：仍保留 `LangChainError → Provider.Error` 的归一化 contract（A 路径还在）；3) `09-schema-codegen.md`：`instructor_lite` 与 `instructor` 的 Ecto → JSON Schema 派生目的等价，但输出不逐字相同；Phase 0 reverse-check 必须按 `InstructorLite` 实际输出验证，并新增"Ecto.Enum atom 必须在 Provider Gateway 边界 stringify 后才能交给 `ex_json_schema`"的纪律；4) `13-risks.md`：把 `instructor_lite` 的单维护者 / streaming 缺口纳入关键依赖风险；保留 `paper_trail` 与 `langchain` 相关条目。 |

### 7.1 实测脚手架

代码与 paper_trail spike 同仓：`spikes/v2_verification/`。

```bash
cd spikes/v2_verification
mix deps.get
# 默认 27/path（normal 20 + free_form 3 + lure_extra 3 + provider_error 1）
SPIKE_DB=sqlite mix run -e 'V2Verification.Spike.StructuredOutput.run()'
```

支持自定义迭代：

```elixir
V2Verification.Spike.StructuredOutput.run(
  iters: %{normal: 5, free_form: 1, lure_extra: 1, provider_error: 0},
  paths: [:b, :c]
)
```

### 7.2 评估维度复盘（最终版，含 D）

| 维度 | 权重 | A: langchain | B: instructor 0.1 | C: 直连 Req | **D: instructor_lite 1.2** |
|---|---:|---|---|---|---|
| schema 合规稳定性 | 高 | 100% | 100% | 100% | **100%** |
| provider 覆盖 | 高 | OpenAI / Anthropic / Google / Bedrock / Ollama 均有 ChatModel | OpenAI-compat / Gemini / vLLM / Anthropic | 任意，但需自写 adapter | **OpenAI-compat / Anthropic / Gemini / Llamacpp，behaviour 化适配器；自定义 provider 写一个 `InstructorLite.Adapter` 即可** |
| 错误可标准化 | 高 | ⚠️ TransportError 漏到 rescue | ✅ `:provider_error` | ✅ `:transport_error` | **✅ `:transport_error`，且 `Req.Response{status: ≠200}` 直接走 `{:error, response}` 分支** |
| streaming 兼容 | 中 | ✅ 原生支持 | ⚠️ 部分模式不支持 streaming | ✅（自行处理 SSE） | **⚠️ 文档未声明 streaming 一等支持；多步 instruct 模式下需要走 adapter callback 自实现** |
| usage tracking | 中 | ✅ Message.metadata 含 token | ⚠️ 需要从原始 response 解析 | ✅ 原生 | **⚠️ instructor_lite 默认只返回 cast 后的 struct；要拿 usage 必须用 `consume_response/3` 分步 API（原始 body 可达）** |
| 依赖活跃度 | 高 | hex 0.8.x 系，持续更新 | 0.1.0 单一 hex release；2025-06 后无新 commit、2025-02 后无新 release | 自维护 | **✅ 1.0/1.1/1.1.1/1.1.2/1.2.0 五次 release（2025-06 到 2026-02），活跃维护；但维护者集中度高，需监控 bus factor** |
| 代码复杂度 | 中 | 中（chain/model/message 三件套） | 低（Ecto schema → 一次调用 → struct） | 低，但 schema/usage/retry 都得自写 | **中（params + opts 两层，adapter 显式选择；优点是出错时栈更短、行为更透明）** |
| 维护风险 | 高 | langchain 整体跟随主流 LLM 滞后 3-6 月（R-05） | 单作者维护停滞（已被 instructor_lite 接替） | 团队自维护，无外部风险 | **维护者活跃，1.x 已稳定，长期看比 0.1.0 更安全** |

### 7.2.1 为什么最终选 D 而不是 B

D 与 B 在项目所需功能层等价（Ecto embedded_schema 可派生 JSON Schema 并 cast 回 struct），但源码并非逐字相同：`instructor_lite` 的 `for_type/1` 输出更精简，`instructor_ex` 会额外加入 description / format / pattern / title 等提示元数据。选择 D 的理由是：

1. **维护活跃度**：B 的 hex 0.1.0 自 2025-02 后没有新 release，主仓 2025-06 后没有新 commit；D 在 2025-06 进入 1.x，2026-02 才发了 1.2.0，平均每 2-3 月一个 release。
2. **错误归一化更精准**：D 直接把 `Req.TransportError` 抛到调用层，不需要再分类 `:provider_error` vs `:transport_error`。这跟 [`07-provider.md`](../07-provider.md) §7.1 的强制 contract 完全契合。
3. **provider 扩展更便宜**：D 把 `InstructorLite.Adapter` 暴露成 behaviour，给 OpenAI / Anthropic / Gemini / Llamacpp 各写了一份；扩展自有 provider 只要写一个 module，不需要 fork。
4. **B 的唯一优势 (`mode: :tools / :json / :md_json` 多模式) 用不到**：v2 只用 `:json_schema` 一种模式，多模式开销没有收益。
5. **代价**：D 的 API 略多一层（params 是 HTTP body, opts 是库自己的开关），换来的是不会再被 0.1.0 这种"装一颗钉子"的版本号坑住。

### 7.2.2 为什么仍保留 A（langchain）

不是为了结构化输出（D 已经覆盖），而是为了多 agent / tool-call 编排：

- LLMChain / Tool / MessageDelta 这套抽象不在 instructor_lite 范围内
- 阶段 1 的 Multi-Agent 编排会用 langchain 的 `Tool` + `LLMChain.add_tools/2` 而不是自己编 function-calling 协议
- A 的 transport-error 漏网由 Provider Gateway 显式归一化（`07-provider.md` §7.1 已锁）

### 7.2.3 为什么不要求流式结构化字段填充

补评后单独检查了 UX 与 tech-stack 文档：v2 当前需要 streaming 的地方是**文本 / 进度 / checkpoint / explanation**，不是“结构化字段逐个实时落入表单”。结构化对象进入系统有更强的边界要求：必须先通过 Ecto changeset + `ex_json_schema`，再作为 tentative artifact / card payload / quality finding 展示给用户，并按 adoption / confirmation contract 处理。

因此 Phase 0/1 的结论是：

1. **结构化输出默认 non-streaming finalize**：一次完整生成、校验、stringify enum atom 后再进入 Provider Gateway 出口。
2. **用户可见 streaming 保留**：通过 Phoenix Channel 推送文本增量、进度、checkpoint、usage / explanation，不暴露未校验 partial fields。
3. **partial fields 不进入权威 UI 状态**：如果为了体验展示草稿字段，只能标记为 unstable preview，不能写入 structure panel / adoption payload。
4. **未来触发条件**：只有产品明确要求“字段逐个实时填入结构面板并可被用户编辑/采纳”时，才新增 Provider Gateway 子能力（直连 `Req` + SSE 增量解析，或重评 `langchain` / legacy `instructor` streaming 路径）并立 ADR。

### 7.3 一份成功样本（path C，Ollama strict json_schema）

```json
{
  "core_hook": "失灵根少年意外觉醒体内远古剑魂，在灵气枯竭的末法世界中，揭开灵根消失背后的阴谋",
  "genre": "玄幻",
  "initial_characters": [
    {"name": "陆晟", "role": "主角，15岁少年，曾为修真世界天才，失去灵根后堕入凡人界"},
    {"name": "剑魂", "role": "远古剑魂，封印于陆晟灵海，具备强大战力但记忆残缺"},
    {"name": "陈长老", "role": "陆晟恩师，曾任陆晟灵根被夺一事负有责任"}
  ],
  "title": "剑魂再临：破灵天劫记"
}
```

usage：`prompt_tokens=72, completion_tokens=235, total_tokens=307`。

### 7.4 不确定项 / 边界

- 本机模型为 24B 量化版，schema 命中率高；接入云端模型（OpenAI gpt-4o-mini / Anthropic claude haiku）的 strict json_schema 行为应在 Phase 0 的"远端 provider 冒烟"任务里复测，不在本 spike 范围。
- Path A 的 `Req.TransportError` 漏到 rescue 是 langchain 0.8.4 行为；如果升 0.9.x 时观察到改变，本结论需要复测。
- `lure_extra` 用例下四路径都没有产生额外字段，但样本量只有 3，不能推断"绝对拒绝"，只能说"在 strict response_format 下被 provider 端约束住了"。Phase 0 应在 contract test 里加几条对抗性 prompt 持续监控。
- 实测过程中暴露的两条 Ecto 边界（已修，纪律已落到 §7.2.3）：
  - `field :genre, :string` 只能让 instructor / instructor_lite 派生出"任意 string"，必须显式声明 `field :genre, Ecto.Enum, values: [...]`，library 才会派生 `enum:`。
  - `Ecto.Enum` cast 完是 atom；spike 入口与 Provider Gateway 边界都必须先 `Atom.to_string/1`，否则 `ex_json_schema` 会以"应是 string"判 schema_mismatch。
- D 的 normal 平均延迟 8.8s 高于 B 的 4.8s，原因是 `InstructorLite.Adapters.ChatCompletionsCompatible.initial_prompt/2` 会预先在 messages 头部插入一条额外 system message（库自身的 prompt 模板）。如果 latency 敏感，可改用 `InstructorLite.prepare_prompt/2` + `consume_response/3` 分步 API 跳过这步；本 spike 没切到分步，是为了对照 happy path 的"开箱即用"成本。

### 7.2.3 落地纪律（Phase 0 起强制）

- LLM I/O Ecto embedded_schema 中所有受限字符串字段必须用 `field :foo, Ecto.Enum, values: [...]`，**禁止**在 schema 注释里写 enum 而 field 类型写 `:string`（这会让派生出来的 JSON Schema 失去枚举约束，模型自由发挥时校验才在 ex_json_schema 入口被发现）。
- `Provider.Gateway` 出口必须把 atom 字段 stringify 后再过 `ex_json_schema`；Ecto 内层校验保留 atom 形态不变。
- contract test 的 stub provider 必须固定返回 string 形态的字段（即 LLM wire 形态），不要直接构造 atom 形态的 struct，否则会把 Gateway 的 stringify 逻辑测穿。
