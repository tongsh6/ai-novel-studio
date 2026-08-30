# Q3c 作者内容物化：候选的第二合法来源（作者字节直达采纳链）

- 状态：done（2026-08-31，`q3c-author-content-materialization` 真实 Tauri PASS + q3b/au02 兼容回归 + I1 4/4 含 author-source case + 全门禁绿）
- 类型：D8 病灶收口第三刀（R1，`docs/design/notes/2026-08-30-stage-session-archive-loop.md` §5 根 1：
  作者主权倒挂——写入大门只放模型的东西）
- 上游：Q3a 拦矛盾动作（d4443b57）、Q3b 给缺口诚实出口（5fb452c6）；本刀让「作者
  提供的内容」本身可以走进采纳链——capability_gap 的「最近路径」从口头引导升级为
  真候选在场
- 队列：NEXT Q3c（用户 2026-08-30 批「按顺序开始执行」）

## 0. 核心设计（字节纯度 + 作者主权）

作者说「把这份大纲存档为作品设定」时，判断①置结构化信号
`author_content_registration=true`（模型判定，非关键字），应用层**机械构造**
待采纳候选：

- **body = 作者消息全文字节**（不经模型重写、不切分、不清洗——指令前缀等杂质由
  作者用既有 edit-then-accept 链自行修剪，编辑权本就在作者；系统不代切是因为
  任何代切都是「经手」）
- title = body 的字符前缀（≤24 字，机械派生）；rationale = nil
- item.provider_call_ref = `author_input:<turn_id>`（结构化来源 ref，语义诚实）
- artifact_type = `world_setting`（既有类型，采纳链/记忆召回已被
  `au09-adopt-setting-recall` 验收过，零新落位）
- 经 `TurnResultBuilder` 既有 pending/卡/available_actions 组装（AU-09 逐项采纳
  复用），采纳契约零改动

## 1. 开工检查（七问）

- **Contract**：judgment call2 契约新增可选布尔 `author_content_registration`
  （判别规则进 prompt 同源三处）；**I1 不变量规则升级**——候选内容字段的合法
  绑定目标从「Provider 响应字节」扩为「Provider 响应字节 ∨ 作者消息字节」
  （`docs/engineering/scenario-invariants.md` §I1 修订 + `run_i1_causal.exs`
  判定分支 + 新 case；这是规则本体的语义升级并正式登记，不是绕过）。采纳侧
  沿用 06 §4.5 写入治理契约零改动。
- **Invariant**：**作者内容字节纯度**——作者源候选的 body 必须精确等于作者消息
  字节，title 必须是 body 的字符前缀，产品代码与模型都不得改写（I1 新分支机器
  强制）；未采纳前零生产写入（既有采纳边界不变量）。
- **Boundary**：`novel_application`（judgment_protocol 字段、artifact_assembler
  新构造函数、turn_result_builder 薄公开入口、dialogue_planning_service 注入）；
  `novel_domain` 零改动（TentativeArtifactSet 结构原样容纳）；I1 driver 与
  invariants 文档；替身与场景。不动 persistence/web/frontend 生产代码。
- **Consumer**：D8 型真实作者（「把我的大纲存档」五连击的正确终局：候选即刻
  在场→采纳→档案）；Q3b capability_gap 的路径候选从「引导语」升级为「真候选」。
- **Proof**：judgment_protocol 单测（字段归一）；planning service 单测（注册
  信号→pending 候选 body==作者字节）；I1 全量跑（含新 author-source case）；
  I2/I3 不回归。
- **Acceptance Driver**：新场景 `q3c-author-content-materialization`（真实 Tauri：
  发「把这份大纲存档为作品设定：…」→ 待采纳 world_setting 候选可见且 body 含
  作者原文 → 采纳 → 档案/记忆面可见；采纳前零写入）；`q3b-capability-gap-honest-reply`
  同步演进（存档输入现在产真候选——断言从「无 pending」改为「pending 在场且仍
  无 execute/tool」，场景语义随契约升级，D7 先例）。产品零验收感知。
- **Exploration**：world_setting 采纳后进记忆/档案既有探索面（au09 已验收），
  无新增要素物化通道。

## 2. 任务清单

| # | 任务 | Status |
|---|---|---|
| T1 | judgment call2 契约：author_content_registration 字段（schema/judgment map/判别 prompt 三处同源） | 实现中 |
| T2 | ArtifactAssembler.assemble_author_content/2（机械构造，字节纯度） | 实现中 |
| T3 | TurnResultBuilder.attach_author_artifact/2（pending+卡+available_actions 复用 AU-09 组装） | 实现中 |
| T4 | dialogue_planning_service finalize 注入（注册信号→附作者候选） | 实现中 |
| T5 | I1 规则升级：docs §I1 修订 + run_i1_causal 判定分支 + author-source case | done（I1 4/4 pass 含新 case；Stub 同批教注册判定） |
| T6 | 替身教注册信号 + q3c 新场景（yml/driver/verifier/注册面）+ q3b 场景演进 | done（q3c PASS：字节断言+物化事件+作者采纳；q3b/au02 兼容回归 PASS——q3b 断言词与 pending 卡文案不冲突，零改动兼容） |
| T7 | 门禁 + 场景 Tauri PASS + I1/I2/I3 全绿 | done（compile -W/全测/xref/arch/I3/I1/I2 绿；前端 typecheck/lint/vitest 绿；扫描 0 touched；三场景 PASS） |

## 3. 决策日志

- 2026-08-31 — **不代作者切分内容**：作者消息=指令+内容混合时，任何「智能提取
  内容段」都让字节经手（模型切分=模型经手；规则切分=产品经手）。body 取全文，
  杂质修剪走既有 edit-then-accept（编辑权本就是作者主权的一部分）。字节纯度
  与作者体验的张力由既有产品能力消化，不发明新机制。
- 2026-08-31 — **I1 修订是升级不是豁免**：R1 的本质是给候选加第二合法来源，
  I1 的捕获目标（产品代码伪造/修补内容）不变——作者源分支同样是精确字节判定
  （body==作者消息），伪造空间没有扩大。按 AGENTS 红线走正式登记而非 Exceptions
  绕行。
