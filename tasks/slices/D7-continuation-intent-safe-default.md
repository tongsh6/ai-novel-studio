# D7 续写意图安全默认：缺失不再等于覆盖，写作步必须显式声明意图

- 状态：done（2026-08-31，T4 两场景真实 Tauri PASS 收口）/ T5 狗粮复跑挂节拍
- 类型：M5 产品债延伸（M6/M9 对照挖出的 P1 缺陷，
  `docs/design/notes/2026-08-26-m6-gptoss-contrast.md` §4d/§4e）
- 启动日期：2026-08-26
- 拍板（2026-08-26 用户「同意」）：①默认改安全侧（nil→append）+ ③字段升必填
  （键存在性校验，值仍可为 null=写新章）；②产品自行推导意图不做（与「意图用 AI
  非关键字」纪律张力大，且①已消除破坏性）；④=①+③即本刀。

## 1. 开工检查（七问）

- **Contract**：AgentPlan 写作步契约收紧——`prose_writing` 步必须显式携带
  `authoring_intent` 键（枚举值 continuation / rewrite / null）；采纳 provenance
  语义修订：**只有显式 rewrite 走 overwrite**，其余一律 append。ADR-0023 计划结构
  与 VS-00E 采纳边界不新增实体。
- **Invariant**：**覆盖作者已采纳正文只能由作者显式意图触发**（模型沉默不得导致
  不可逆动作）；写新章（null）与续写（continuation）都不破坏既有正文；「填错」
  与「不填」两类模型偏差都被结构校验拦下并重试一次。
- **Boundary**：`novel_application`（adoption_workflow 分流 + planner 校验）；不动
  domain/persistence/web/frontend；替身与 fixture 按新契约校准。
- **Consumer**：真实采纳链（作者续写→append 累积）、planner 结构纠正重试骨架、
  狗粮长跑（M10 BF16 复跑验证）。
- **Proof**：planner 单测（显式 null 放行 / 缺键触发恰一次纠正重试 / 值域仍校验）；
  全量门禁；真实 Tauri 回归 `p1-chapter-expansion`（续写累积）+
  `p1-chapter-overwrite-confirm`（显式重写仍需确认）；M10 狗粮复跑（qwen BF16 拉满）
  验证续写误判归零。
- **Acceptance Driver**：既有 `p1-chapter-expansion` / `p1-chapter-overwrite-confirm`
  两场景为回归载体；产品零验收感知。
- **Exploration**：不新增要素物化，探索面不适用。

## 2. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | adoption_mode 默认改安全侧（只有 rewrite 覆盖）+ 论证注释 | done | 附 M0/D7 双坑史 |
| T2 | planner 键存在性校验（missing_authoring_intent）+ 值域校验保留 | done | 复用携带原因重试骨架 |
| T3 | 单测：显式 null 放行 / 缺键触发重试；judgment flow fixture 校准 | done | planner 22/22、judgment 3/3 |
| T4 | 门禁 + 两场景真实 Tauri 回归 | **done（2026-08-31）** | 两场景 PASS。expansion=B15 TurnBinding 修复后 turn_id 门复活；overwrite-confirm 需两刀：①驱动语义校准（cycle2 改作者显式「推翻重写」消息——D7 后按钮重生成不再天然 overwrite，场景语义随契约升级）②产品真缺陷修复：判断②续行合成步丢写作坐标（见 §4 追记） |
| T5 | M10 狗粮复跑（qwen BF16 + 拉满思考档）验证续写误判归零 | todo | 修复后重评模型定版 |

## 3. 决策日志

- 2026-08-26 — 为何不把 `authoring_intent` 加进 JSON schema 的 `required`：required
  作用于**所有** step items（含 explore 步），会逼无关步骤都填写作意图；改为在
  应用层对 `target_tool_ref == "prose_writing"` 的步做键存在性校验，精确且不污染
  其他步形态。
- 2026-08-26 — 为何 null（写新章）仍放行：新章目标无已采纳正文，append 等价于首次
  写入，安全；真正需要作者授权的只有 rewrite。

## 4. 试行反馈

- **两场景超时是既有迁移债，非本刀回归（有对照实验为证）**：
  `p1-chapter-expansion` 的 behavior 门要求
  `turnsHaveEvent([draft_turn_id], turnRecords, "toolbox.execute.done")`，
  而 `toolbox.execute.done` 的 turn_id 由 `LogEmit` 从 Logger metadata 取；主链路
  迁进 bounded AgentRun 后工具在 run server 进程执行、该进程 metadata 无 turn_id，
  字段随之为空。全仓产物印证：老产物 `p1-100k-dogfood` 248/842 带 turn_id，
  **M4 狗粮（2026-07-29）起全部 0**，与 2026-06-29 主链路迁移时间线吻合。
  **对照实验**：`git stash` 掉 D7 两处改动后重跑同场景，同样
  `timed out waiting for native slice evidence`（PRE_D7_RC=1）——回归指控排除。
  场景本身的产品行为其实全部正确：本次运行第 1 章经 2 次 continuation 累积
  134→1224 字、intents 全 continuation、appended_to_single_chapter=true，
  evidence 匹配成功，只有 behavior 那道 turn_id 门挂住。
- **登记缺口（不在本刀修）**：`toolbox.execute.*` 事件在 bounded run 下丢 turn_id
  →至少两个 P1 场景（expansion / overwrite-confirm）长期哑火。修法二选一：
  ①run server 执行工具前把 turn_id 灌进 Logger metadata（观测层补绑，推荐）；
  ②verifier 门改用 run_id 或去掉该门（降低证据强度，不推荐）。属可观测性债，
  独立小刀，登记进 NEXT。
- **方法论**：本次先怀疑自己的改动、用 stash 对照实验证伪，而不是凭推理宣称
  「历史遗留」——延续本会话早前「只凭错误名归因是分析真空」的教训。
- **追记（2026-08-31，T4 收口时的第三层真相）**：turn_id 债由 B15 TurnBinding 修复
  后，expansion 立即 PASS，但 overwrite-confirm 仍 RC=1——证据链逐段对齐后锁定
  **产品真缺陷**：`continue_after_judgment` 的合成重试步 `mechanical_prose_retry_step`
  不携带写作坐标，作者的 rewrite 意图在一次质量偏离处理后蒸发（app-log 铁证：
  `continuation_context.done authoring_intent=unspecified` 而计划步 intent=rewrite）
  → 采纳按 D7 安全默认走 append → 覆盖确认卡从不出现。这是 D8 病理「意图被单次
  消费、未作为义务保持」在 run 内的实例。修复=合成步从计划 prose 步继承四坐标
  （intent/target_chapter/requested_chapter_raw/target_word_count），判断②只改
  「怎么写」的指引、不改作者目标坐标；D2 flow 单测扩坐标保持断言（重试稿 pending
  的 authoring_intent 必须仍为 rewrite）。
