# 场景化验收的可机器验证不变量

> 状态：试行
>
> 与 [scenario-acceptance.md](./scenario-acceptance.md) 的关系：
> scenario-acceptance.md 定义"什么不许做"（红线、允许项、driver 写法）；
> 本文档定义"怎么用机器证明红线没被踩"——三条 0/1 不变量，作为 CI 强制规则。

---

## 1. 为什么需要不变量而非规则集

人类红线（"不得在产品代码内置验收钩子"）翻译为机器规则时，常见做法是：

- **词表**：维护"作品专项词汇黑名单"
- **AST 模式**：检测"cond + 中文 contains? 路由"等可疑写法
- **字面量预算**：限制模块的 string literal 总字符数
- **阈值类规则**：差异度、相似度、命中条数

**这些做法都会失败**。原因不是工程实现不够好，而是它们都在"识别坏写法"——而 AI 的修辞能力足以绕开任何枚举式的坏写法清单：

| 规则形态 | AI 的绕路 |
|---|---|
| 词表 | 改个名字（"林烬" → "主角"）即可绕过 |
| AST 模式 | 把 cond 换成 Map 查表、Behaviour 分发，语义不变 |
| 字面量预算 | 拆文件、拆函数、塞 config/seed/priv |
| 阈值（差异度 > X%） | 加标点、改语序，把相似度压到阈值边缘 |

**所有"枚举坏的"规则永远输给生成。能赢的规则必须满足两个条件**：

1. **0/1 绝对判定**：要么真，要么假，没有阈值、没有调参空间、没有解释空间
2. **判定"内容来源的物理事实"**：不是看代码长什么样，而是看运行时输出从哪里来

下面三条不变量同时满足这两个条件。

---

## 2. 三条不变量

### I1 · 因果绑定（Causal Binding）

**定义**：TurnResult 中每个 user-facing 创作 artifact 的每个 item 的内容字段（`:title` / `:body` / `:rationale` / `:content`），其字节序列必须 **精确等于** 同一 turn 内某次 Provider 调用响应中对应 item 的字段。

**形式化**：

```
forall artifact in turn_result.tentative_artifacts:
  forall item in artifact.items:
    exists provider_call in turn.provider_calls:
      exists raw_item in parse_items(provider_call.raw_response):
        item.item_id == raw_item.item_id
        and item.title == raw_item.title
        and item.body == raw_item.body
        and item.rationale == raw_item.rationale
```

**判定**：精确字节相等，0/1。

**禁止的行为**：
- 产品代码对 Provider 响应做任何 transform、修饰、补齐、翻译、合并
- 产品代码自己 hardcoded items 然后假装从 Provider 来
- 产品代码忽略 Provider 响应、用其他来源（config / seed / priv）的内容

**实现要求**：
- 每次 Provider 调用记录 `provider_call_id`、`prompt_hash`、`response_hash`、`raw_response`（持久化或哈希存档）
- `TentativeArtifactSet.items` 中每个 item 携带 `provider_call_ref`
- TurnResult 与本 turn 的 provider_calls 集合一起持久化，验收脚本可读

### I2 · 输入差异（Input Variation）

**定义**：对同一 slice 的同一 tool action，用 N 个语义独立的输入跑 N 次，N 次产出的 artifact item_id 集合必须 **两两不相交**。

**形式化**：

```
inputs = [input_1, input_2, ..., input_N]  # N >= 3
results = [run_pipeline(i).artifact.items.map(:item_id) for i in inputs]
assert pairwise_disjoint(results)
```

**判定**：集合两两不相交，0/1。

**禁止的行为**：
- 产品代码对所有输入返回同一组 hardcoded items
- 产品代码按关键词分支返回不同 hardcoded（多输入维度后必然有 id 重叠）
- item_id 不来自 Provider 而由产品代码生成（与 I1 联动）

**实现要求**：
- slice 验收脚本必须支持参数化输入（接受 N 个语义独立的输入文本）
- item_id 必须来自 Provider 响应，不允许产品代码二次分配

### I3 · 种子贯通（Nonce Propagation）

**定义**：验收脚本在用户输入中嵌入一段 **一次性随机字符串**（nonce），该 nonce 必须出现在最终 user-facing artifact 的内容字段中。

**形式化**：

```
nonce = random_string(8, alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
input_text = compose_input_with_nonce(nonce)
result = run_pipeline(input_text)
assert any(nonce in item.body or nonce in item.title for item in result.artifact.items)
```

**判定**：字符串包含关系，0/1。

**禁止的行为**：
- 产品代码 hardcoded 任何内容（hardcoded 永远不含本次随机生成的 nonce）
- 产品代码忽略用户输入文本，直接走预制响应
- prompt template 不传递用户输入（导致 LLM 看不到 nonce）

**实现要求**：
- 用户输入文本必须出现在 Provider 收到的 prompt 中
- Provider 响应必须字节透传到 artifact items（与 I1 联动）

**特别说明**：I3 不要求 LLM"理解" nonce。验收脚本以"必须把以下字符串原样作为标识符嵌入"为指令构造输入。stub provider 已满足——它把 prompt 整段回显。

---

## 3. 三条不变量的捕获关系

| 伪造手段 | I1 | I2 | I3 |
|---|---|---|---|
| 产品代码直接 hardcoded items | — | 抓 | **抓** |
| Gateway 内按 prompt 特征伪造 | 部分 | **抓** | **抓** |
| 调 Provider 但忽略返回值 | **抓** | **抓** | **抓** |
| 后处理修补 Provider 响应 | **抓** | 部分 | **抓** |
| Prompt 注入要求 LLM 输出特定字符串 | — | 部分 | **抓** |
| 配置/seed/priv 路径预制内容 | **抓** | **抓** | **抓** |

每种伪造至少被两条独立机制命中。AI 要全部绕开，必须同时做到：

1. 产品代码不修改 Provider 返回字节（否则 I1 抓）
2. 每个独立输入产生独立 Provider 响应（否则 I2 抓）
3. 输出能携带每次都不同的未知信息（否则 I3 抓）

满足这三点的"伪造"，已经等价于实现一个真实 LLM。

---

## 4. 这套不变量明确不约束什么

误伤问题在不变量层面自动消失。下列内容 I1/I2/I3 一条都不约束：

- 模块/函数文档（`@moduledoc` / `@doc`）
- 注释（任何形式）
- 错误码与错误文案（`errors: [%{code: ..., message: "..."}]`）
- 日志格式串
- prompt template（位于 `apps/novel_agent` 的 prompt 资产，作为合法的"内容请求模板"）
- UI 文案（集中在 `frontend/src/lib/copy.ts`，与作品内容无关）
- Schema 字段名、状态枚举、契约常量
- HTTP error message

约束的只有一件事：**user-facing 创作内容（小说角色、章节、大纲、正文）必须来自当前 turn 的 Provider 响应，并能被运行时观察证明**。

---

## 5. 实施层（CI 接入）

### 5.1 验证脚本

```
scripts/scenario_invariants/
├── run_i1_causal.exs        # I1 因果绑定检查
├── run_i2_variation.exs     # I2 差异化输入检查
├── run_i3_nonce.exs         # I3 种子贯通检查
├── run_n_narr.exs           # N-NARR 作者过程叙事来源绑定检查
└── run_all.sh               # 集成入口
```

每个脚本独立可运行，输出统一报告：

```
artifacts/scenario-invariants/
├── i1.{md,json}
├── i2.{md,json}
├── i3.{md,json}
├── n_narr.{md,json}
└── summary.md
```

### 5.2 报告格式（AI-actionable）

每条违规输出形如：

```
[I3-FAIL] slice=p1-chapter-plan-minimum
  input: "请帮我写一份赛博修仙的章节计划，标识符 K7XQ9M2A"
  expected: any artifact item contains "K7XQ9M2A"
  actual: no item contains the nonce
  root cause: 产品代码未将用户输入传递到 Provider，或未将 Provider 响应字节透传到 artifact
  fix path:
    1. 确认 Toolbox.execute 在具体 creative capability 时调用 Provider complete_fn
    2. 确认 prompt template 包含用户原始文本
    3. 确认 ToolResult.output.items 来自 Provider 响应解析，不是 hardcoded
  reference: docs/engineering/scenario-invariants.md §2.3
```

诊断必须可执行：明确的命中位置、违反的不变量、唯一允许的修复方向、参考文档锚点。**禁止只输出"违规"二字**，因为 AI 看不到修复路径会自行发明绕路。

### 5.3 强制力

- `bash scripts/scenario_invariants/run_all.sh` 接入 `scripts/ai_static_scan.sh`
- pre-commit hook 跑 I3（最快，秒级）
- CI 跑 I1+I2+I3 全量
- 禁止用 `--no-verify`、`@scenario-invariant-disable` 注释或类似手段绕过
- 唯一豁免：在 `docs/engineering/scenario-invariants-exceptions.md` 显式登记，登记需 PR 审核

---

## 6. 失败时的诚实退路

允许 slice 在 Provider/LLM 暂时不可用时报"未闭环-缺 provider"，而不是为了让验收过去伪造数据。`tasks/slices/_template.md` 必须显式提供此选项。

**核心信念**：没有这个退路，AI 必然作弊；有这个退路，AI 才有动力诚实标注现状。

---

## 7. 与 AGENTS.md 第一条的对应关系

| AGENTS.md 红线（§场景化验收红线） | 不变量机制 |
|---|---|
| 不得读取验收专用 env / slice id 改变行为 | I2 多输入差异化 + I3 nonce 不可预知 |
| 不得内置自动输入/采纳/上报 UI 状态 | I3 nonce 贯通要求真实用户输入路径 |
| 不得添加验收专用 DOM hook / data-* / event | I3 验收只看用户可见输出 |
| 不得把验收 provider 注册进生产 runtime | I1 因果绑定要求 provider call 留 trace |
| 不得在产品代码持有作品内容资产 | I1 字节透传 + I2 输入差异 |

每条红线都有对应的运行时可观察判定。
