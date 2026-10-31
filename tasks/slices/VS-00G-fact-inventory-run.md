# VS-00G 设定盘点运行链

- 状态：doing（CP5e A2/A3 当前 HEAD 真实 Tauri 复验 PASS；CP5 余项=触发 C、假定寿命催办、works 级假定、记忆类注入富化）
- 所属完整闭环：VS-00G 承重事实完备性与补全回路 CP4/CP5
- 当前 checkpoint：CP5a-d done（字段位+生命周期/盘点暂定候选/【暂定】注入/暂定设定区）；
  CP5e（SC-AU14-A2/A3）已有历史 Tauri 证据，是否当前 HEAD 复跑通过需另行核对；余项=触发 C、works 级假定、记忆类注入富化
- 验收锚点：`docs/design/acceptance/author/AU-14-provisioning-and-assumptions.md`
- 契约锚点：`docs/design/contracts/VS-00G-fact-completeness-and-provisioning-contract-pack.md` §3.3 / §5 / §7

## 1. 用户 / 系统目标

作者可以从真实作品档案发起「设定盘点」。系统通过 `fact_inventory_v1` AgentRun 读取作品正文，
把正文中事实上已经存在的角色、世界规则和伏笔整理成 tentative 提案，并复用既有候选卡和采纳
边界让作者逐项处置。作者采纳前，提案不得进入角色档案、治理记忆或其它权威作品事实。

本 slice 是完整 CP4 的运行机制建设，不缩小完整闭环：面板主动触发 B 已形成第一个真实消费者，
CP4c 又闭合负债 finding 触发 A；三类全产中的全书规划建议/暂定设定候选，以及暂定设定生命周期
仍分别按 CP4/CP5 收口。未覆盖前不得把 VS-00G 或 AU-14 标记 done。

CP4c 接通 A：`protagonist_undermaterialized` finding 的 `revise_design` 变体以「发起盘点」
呈现，命令绑定活跃报告/条目/规则并启动既有 `fact_inventory_v1`。采纳主角不会倒灌历史账面；
弧光账在其后第一次包含该主角的正文采纳中开始记账。

## 2. 开工检查

1. **Contract**：消费 VS-00G §3.3 `fact_inventory_v1`、既有 seed artifact 映射和
   `TentativeArtifactSet.adoptable_units/1`。
2. **Invariant**：保护 I-G5 提案零新径、I-G7 零新实体；提案只处于 tentative，作者采纳前不进入
   canon。
3. **Boundary**：切穿 `novel_agent → novel_application → novel_web → frontend`；复用 domain /
   persistence 采纳链。不改 `novel_foundation`，不新建表，不提前实现 CP5 的 provisional 字段。
4. **Consumer**：作品档案底部「发起设定盘点」入口、主角缺位 finding 的「发起盘点」主动作和
   既有逐项采纳卡。
5. **Proof**：profile/run flow/Channel/前端焦点测试，I1/I2/I3，项目全门禁与静态扫描。
6. **Acceptance Driver**：外部 Tauri driver 分别从真实档案底部主动入口，以及真实审读 finding
   主动作发起盘点；等待提案、逐项采纳并核对档案/记忆/弧光投影。生产代码不新增验收专用开关、
   DOM hook、事件或 provider。
7. **Exploration**：角色采纳后从角色档案可达；规则/伏笔采纳后从现有规则/伏笔页可达；未采纳
   提案只在候选卡可见。

## 3. 涉及范围

### 应修改

- `apps/novel_agent`：登记 `fact_inventory_v1` profile。
- `apps/novel_application`：盘点 AgentRun flow、材料读取与 seed 提案映射。
- `apps/novel_web`：作者动作 `start_fact_inventory`。
- `frontend/src`：作品档案真实入口、集中中文文案及状态反馈。
- `quality/`、`frontend/slice-verify/`、`scripts/`：真实 Tauri 场景和清单。

### 明确不修改

- `apps/novel_foundation`。
- 数据库 schema / migration。
- CP5 `provisional_source` / `provisional_active` 与「暂定设定」面板。
- 存量书稿导入与卷级蓝图。
- 不新建原型 screen，不改 CP5「暂定设定」与本 finding 动作区之外的 Pencil 场景。

## 4. 任务清单

- [x] 登记 `fact_inventory_v1` profile 与运行预算。
- [x] 实现 model-drafted plan + mechanical inventory flow。
- [x] 把提炼结果映射为既有 seed artifact set，并复用逐项采纳。
- [x] 接入 `start_fact_inventory` Channel 作者动作。
- [x] 在作品档案接入「发起设定盘点」真实入口和错误反馈。
- [x] 新增 SC-AU14-B1 外部 Tauri driver 与 quality manifest。
- [x] finding 触发命令绑定真实报告条目，复用 `revise_design` 与现有盘点 run。
- [x] 主角缺位卡把「发起盘点」提升为唯一推荐主动作，并同步 Pencil 原型。
- [x] 新增并跑通 SC-AU14-A1 外部 Tauri driver：主角采纳后由下一章正文采纳开始弧光记账。
- [x] 运行局部测试、全门禁、I1/I2/I3 和静态扫描闭环。
- [x] 同步 NEXT / contract / AU-14 覆盖状态；如实登记 A 触发及 CP5 缺口。
- [x] CP4d（2026-07-28）：盘点对缺位规划字段产 `work_skeleton_suggestion`（结构化
  skeleton_field/skeleton_value 槽位循 narrative_role 先例；prompt 只列缺位字段+flow
  双保险过滤）；逐项采纳=works 立项字段回写（AdoptionRepository work 分支，mutation
  留痕+optimistic revision，不写记忆/档案对象）；档案概览新增全书规划三行；
  SC-AU14-B1 扩展（5 pending/15 actions/采纳后概览显示目标体量）与 SC-AU14-A1
  复验均真实 Tauri PASS。
- [x] CP5a（2026-07-28）：characters 加 provisional_source/provisional_active（migration+
  ProvisionalSource 枚举 codegen+schema 校验）；WorkingAssumption 域策略纯函数
  （OQ2 分级放行/canon 优先激活门禁/同批同名一致性/OQ3 寿命 10 章/【暂定】标注）。
  works 级假定按「行级标注无法表达字段级假定」歧义登记余项待定形。
- [x] CP5b（2026-07-28）：盘点 PROTAGONIST 候选经 AssumptionRepo 物化为暂定角色
  （required 自动激活+完成消息即时通知）；守卫集中持久层（canon 在场/同名跳过含已
  否决、失败降级不断主链）；采纳同名收束（character_seed 采纳遇同名假定行就地转正，
  两条确认路径收敛零重复行）。
- [x] CP5c（2026-07-28）：prose/plot_outline 完备性判定纳入激活假定（缺席守则让位），
  【暂定】标注段注入期临时文本（AU-09 红线内）；fact_completeness 留痕增
  assumption_active；百章标本重放双靶 PASS 零写入
  （artifacts/vs00g-replay/cp5c-replay-2026-07-28.txt）。
- [x] CP5d（2026-07-28）：档案概览「暂定设定」区（OQ7，【暂定】badge+确认/否决）；
  channel get_assumptions 读端口 + confirm/discard_assumption 作者动作（就地转正/
  discarded 停注入）；channel 测试覆盖全链。
- [x] CP5e（2026-10-31 当前 HEAD 复验）：SC-AU14-A3 面板确认→正式档案、SC-AU14-A2 【暂定】注入→否决→回缺席守则，真实 Tauri PASS；A2 断言接受产品当前两种缺席守则文案（真空/非真空），prompt 证据 source=llm_calls。
- [ ] CP5 余项（不阻塞 CP5e）：触发 C（对话流自动提议盘点，同一缺失只提一次可关闭）、
  假定寿命催办负债规则（OQ3 超 10 章未决）、works 级假定定形、记忆类假定注入富化。

## 5. 验证

计划命令：

```bash
mix compile --warnings-as-errors
mix test
mix xref graph --format cycles --label compile-connected --fail-above 0
mix run scripts/arch_check.exs
cd frontend && pnpm typecheck && pnpm lint && pnpm test
bash scripts/frontend_audit.sh
bash scripts/check_design_trace.sh
MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs
bash scripts/tauri_slice_verify.sh au14-fact-inventory-roundtrip
bash scripts/tauri_slice_verify.sh au14-finding-inventory-arc-loop
bash scripts/ai_static_scan.sh --top 10
```

CP4b-2 的 2026-07-24 历史实测：后端 1300 tests / 0 failures；前端 397 tests / 0 failures；
compile warnings-as-errors、xref cycles、arch check、typecheck、lint、frontend audit、
design trace、I1/I2/I3 与真实 Tauri `au14-fact-inventory-roundtrip` 均通过。

CP4c 的 2026-07-24 当前实测：Ledger 服务 4 tests / 0 failures、Channel 定向
1 test / 0 failures、前端相关 185 tests / 0 failures；全前端 404 tests / 0 failures，
compile warnings-as-errors、xref cycles、arch check、typecheck、lint、frontend audit、
design trace、I1/I2/I3 与真实 Tauri `au14-finding-inventory-arc-loop` 均通过。
当前真实 Tauri summary 已证明 finding/report/rule 绑定、主角逐项采纳与下一章弧光起账。

项目级最终门禁已在同工作树 WIP 合并态复跑闭环：后端 1312 tests / 0 failures，前端
420 tests / 0 failures；compile warnings-as-errors、xref cycles、arch check、typecheck、
lint、frontend audit、design trace、I1/I2/I3、Tauri release build 与 AI 静态扫描均通过。
静态扫描剩余项均已有长期处置，无 pending / blocking finding。

## 6. 决策日志

| 日期 | 决策 | 原因 |
|---|---|---|
| 2026-07-23 | CP4b-2 复用 `ledger_reconciliation_v1` 壳，不另建第二套 run runtime。 | VS-00G §3.3 已冻结；最小改动并保留 AgentRun 统一主链。 |
| 2026-07-23 | 第一个真实消费者选择作品档案主动触发 B。 | 用户动作稳定、可由外部页面自动化驱动；A finding 触发在同一完整 CP4 后续接入。 |
| 2026-07-23 | 当前 checkpoint 只物化现有提炼引擎已输出的角色/规则/伏笔 seed。 | 先闭合已 live 验证的核心提炼运行链；全书规划建议与暂定设定候选仍是完整 CP4/CP5 的计划内缺口。 |
| 2026-07-24 | Codex 重启后 Pencil MCP 恢复；读取 `ATnmR`/`uyZGw` 确认动作条范式，并只在既有 `uyZGw` 审读报告场景补主角缺位 finding 的四动作状态。 | 不绕过设计驱动门禁；不新建 screen，不扩改 CP5 或其它原型场景。 |
| 2026-07-24 | AgentRun 预算证据按 1 executable step / 1 tool / 3 provider calls 固化。 | plan draft 在首个执行步内完成；终态 goal check 不计 consumed step，driver 必须对齐 runtime 真值。 |
| 2026-07-24 | 采纳后的剩余 pending 从页面合并态验证，不把单 artifact set 的 TurnResult 当全局快照。 | 既有采纳回执按本次处置 set 返回；真实面板角标与候选卡才是用户侧合并状态证据。 |
| 2026-07-24 | finding 的「发起盘点」作为 `revise_design` 的主动作变体，由一个 Channel 命令绑定报告条目并启动既有盘点 run。 | 不新增第五处置，不让前端拆成两个可能部分成功的命令；服务端反查活跃 finding 后再执行。 |
| 2026-07-24 | 主角采纳只影响之后的正文记账，不回填采纳前章节的弧光账。 | 历史正文缺少当时的已采纳角色身份；从下一次真实正文采纳开始记账，因果边界清晰且可复验。 |

## 7. 试行反馈

- 当前已验证 model-drafted plan + mechanical inventory 能以 1 executable step / 1 tool /
  3 provider calls 生成 4 个独立 pending 单元（角色 2、规则 1、伏笔 1），proposal
  阶段零 production write；plan draft 发生在该执行步内，终态 goal check 不消耗 run step。
- 真实 Tauri 页面验收 PASS：只采纳沈砚与规则后，档案投影角色/规则/伏笔精确为
  1/1/0；另一个角色与伏笔仍在待采纳角标和候选区。
- SC-AU14-A1 真实 Tauri 页面验收 PASS：10 章空角色档案经唯一主角缺位 finding 发起盘点，
  采纳沈砚后角色档案可见；再采纳包含沈砚的第 11 章正文，脉络账出现「沈砚 / 延续中」，
  且历史 10 章未被倒灌。
- 本 slice 未覆盖全书规划字段建议与 CP5 暂定设定；VS-00G 继续保持 doing，AU-14 为
  1/4 完整场景闭环。

### CP5e 当前 HEAD 复验（2026-10-31）

- `au14-assumption-confirm-roundtrip`（A3）**PASS**：盘点激活暂定主角→概览 badge/动作→确认就地转正→暂定区消失→档案恰 1 个 accepted 角色。
- `au14-assumption-provisional-injection`（A2）**PASS**：激活假定→首章 prose 机械准备计为主角在场、【暂定】标记进 prompt→作者否决→假定区清空→次章恢复主角缺席守则；prompt 证据 `llm_calls`。
- 修正项：A2 driver 旧断言只认「尚未确立主角档案」；当前产品在显式空 roster 下使用 vacuum 守则「尚无任何角色档案」（AbsenceDirective 既有语义）。断言语义仍是“缺席守则已恢复”，接受两种当前产品文案，不放宽注入/否决行为。
- 证据：`artifacts/slice-verify/au14-assumption-provisional-injection-tauri/`、`.../au14-assumption-confirm-roundtrip-tauri/`。
- 余项不关闭：触发 C、假定寿命催办负债、works 级假定、记忆类注入富化仍登记在任务清单。

### 触发 C CP0 冻结（2026-10-31）

- 状态：doing（CP0 契约与预注册 done；CP1 产品实现与局部/全量门禁已落地，真实原生页面未闭环，预算耗尽待作者裁决）
- **Contract**：复用 `protagonist_undermaterialized` R5 finding 作为唯一缺失来源，复用 `start_fact_inventory` 作为唯一启动入口，复用 `adjudicate_finding(disposition=dismiss)` 作为关闭与持久去重来源；不新增关键词触发器、卡片类型、状态表或第二 run。
- **Invariant**：自动提议只提供入口，不自动启动 run、不写 canon、不自动采纳；同一 work+rule 只提一次，关闭/刷新后不重提；已 disposition 的 finding 不再展示。作者明确点击才进入既有 tentative 盘点链。
- **Boundary**：application/web 只读现有 finding 并投影提议与作者动作；frontend 复用当前 finding/action 展示；persistence 只复用既有 disposition 与 canon 事实。不得把新提议写成模型回复或系统伪造 TurnResult。
- **Consumer**：真实 WorkspaceChat 中的 R5 提议、关闭按钮与既有设定盘点入口。
- **Proof**：R5→提议可见且无 author_action/canon→dismiss→刷新/再扫描无重提→作者点击后才 `start_fact_inventory`；关闭前后只读 DB 一致；无新卡片类型或验收 hook。
- **Acceptance Driver**：外部 AX/CGEvent 驱动真实 Tauri WorkspaceChat，记录提议、关闭、刷新与显式启动；产品验收感知 no。
- **Exploration**：提议源自既有 R5 对账事实，不从作者文本猜关键词；启动后仍走同一作品事实读取与 tentative 采纳边界。
- 预注册：`artifacts/model-contracts/vs00g-trigger-c/preregistration.json`（批次 ≤2、单批 ≤600s、slice_verify、失败只读）。CP1 实现与真实页面验收未做。

### 触发 C CP1 实现与原生未闭环（2026-10-31）

- 状态：**done（2026-11-01 收口）**：实现+非原生门禁+输入路径对照+真实原生业务批次 PASS（`business-replay-08`，13/13，surface=tauri）；期间修复产品缺陷「重复审读后原提议丢失可关闭入口」。
- **实现已落地，CP1 不得标 done**：`FactInventoryProposal` 从真实 R5 报告在审读/采纳 TurnResult 投影既有 `start_fact_inventory` 与 `adjudicate_finding(dismiss)`；不新增卡片、schema、状态表或第二 run。未关闭去重以全作品历史 TurnResult 的 `fact_inventory.start` 为已展示凭据；关闭去重读报告 disposition；旧提议提交由服务端重绑当前活跃同规则 finding；恢复历史只撤动作不改原始回执。
- **非原生证据**：相关后端 36+48、前端 23；全量后端 2499/2499、前端 660/660、质量库 295/295；I1/I2/I3、compile/format/credo/xref/arch、frontend audit 27、design trace 19、Tauri build 通过。
- **原生失败事实**：`cp1-01` 在 prepare 因含空格标题被 seed 读取器截断而失败，已修为只读 DB 标题；`cp1-02` 在作品选择阶段 `work_not_selected`，两次菜单尝试无目标项。两批均未进入审读/盘点，无原生 summary，原预算耗尽。
- **scoped 观察**：`startup-01` 因新增诊断脚本嵌套等待账 `invalid_wait_begin` 失败，已拆开激活与作品选择步骤。按作者要求新增观察预注册 `artifacts/model-contracts/vs00g-trigger-c-observation/preregistration.json` 与 `observe-01`，只观察菜单、不重启、不执行业务动作；证据 `artifacts/slice-verify/vs00g-trigger-c-tauri-native-observe-01/native-vs00g-observation.json`。
- **直接原因（已证实）**：两次 `AXPress` 均返回 `{ok:true, method:"axpress"}`，但 800ms 后主窗口 `AXMenuItem=0/AXMenu=0`，全窗口只有系统/Dock 菜单而无作品菜单；点击后的 HTTP/WS/author_action 均为空。因此失败发生在 harness 的菜单输入/投影阶段，不在 R5、报告、关闭或盘点业务链。
- **实现原因（已证实）**：旧 `rawSwitchWork` 只用 `AXPress`，未记录点击返回/焦点/菜单角色，且 `AXPerformAction` 成功被误当作 UI 已改变；重复同一路径无法区分输入未送达、菜单未打开和 AX 投影缺失。新日志已补 safeClick 返回、frontmost、主窗口/全窗口菜单项和传输摘要；`frontmost` 探针初次漏应用参数的实现问题也已修为全局命令并自检通过。
- **间接/设计原因（部分证实，部分待证）**：旧驱动把成功 AX 调用当作状态成功，缺少 postcondition 与输入路径对照；重启兜底会遮蔽第一次输入失败。macOS `activateIgnoringOtherApps` 已弃用、菜单可能依赖焦点/时序、Radix `DropdownMenu.Trigger` 与 `AXPress` 的映射均是**待证假设**，当前证据不能断言产品菜单缺陷或焦点根因。
- **下一步边界**：需在独立预注册下做 `AXShowMenu` 与 CGEvent 的同窗口对照，才能判定输入路径；不得再按原路径刷批次。`observe-01` 仅证明观察完成，不签 CP1、原生业务 PASS 或产品缺陷结论。真实模型质量、works 级假定、记忆类富化与 I10 不在本 CP 关闭。
- **输入对照补充（`input-01`）**：`AXShowMenu` 的 frontmost 确为 `com.ai-novel-studio.app`，返回 ok，但截图/AX 显示的是 WebView Copy/Speech/Inspect 上下文菜单（menu=2/items=12），不是 Radix 作品菜单，证明它不能替代普通左键。随后 CGEvent 未出现目标菜单，但其前置上下文菜单是否被 Escape 真正关闭没有独立证据，故本批不能判 CGEvent 无效，也不能判产品菜单有缺陷。需要全新窗口的普通 CGEvent 单独验证；本批不签业务 PASS。证据 `artifacts/slice-verify/vs00g-trigger-c-tauri-native-input-01/native-vs00g-input-path.json`。
- **普通点击已证实（`click-01`）**：全新窗口仅一次 CGEvent 后，主窗口出现 Radix `AXMenu` 与 4 个 `AXMenuItem`，目标作品项精确命中，截图可见两作品；frontmost 正确。runner 的 evidence 脚本将 `verify` 误当目录的问题已修，临时副本核验 `all_checks_passed=true / pass_scope=input_path_observation`，原失败目录未改写。共用 `rawSwitchWork` 的菜单打开与菜单项选择已改用 CGEvent；业务复验预注册 `artifacts/model-contracts/vs00g-trigger-c-business/preregistration.json`。

#### 触发 C CP1 收口（2026-11-01）：产品缺陷修复 + 原生 13/13

- **产品缺陷（CP0→修复→scoped 复验）**：`FactInventoryProposal.attach/2` 把「已展示过 start」与「已处置」合并成同一个 `already_dispositioned?` 跳过，导致重复审读后 TurnResult 不附加任何动作——页面「关闭盘点提议」按钮消失、作者无法关闭原提议。修复：拆分 `dispositioned?`/`shown?` 两种去重语义——已处置完全不附加；已展示未处置时追加 **dismiss-only** 动作（不重复 start）并补「此前的盘点提议仍待处理」文案；新增单测覆盖；`fact_inventory_proposal_test` 5/5。
- **driver/evidence 口径对齐（不降低判定意图）**：重复审读断言由「无任何提议动作」修正为「不重复 start、保留 dismiss」；dismiss 等待与 evidence 接受服务端**重绑到最新 report** 的 target_ref（以 `finding:` 绑定，并要求 payload.report_id 与新 report 一致）；「已展示」DB 凭据取第一次审读后 checkpoint（interactions 异步写入时序）。
- **原生业务批次 PASS**：`artifacts/slice-verify/vs00g-trigger-c-tauri-native-business-replay-08/`，`summary.json`：`surface=tauri`、driver `ax-native-system-ui`、**13/13**、elapsed 29s；覆盖：提议来自既有 R5、无 run/canon 写入、重复审读不重复发起且原提议保留可关闭、关闭持久化且刷新/重启不重提、旧提议重绑活跃 finding、独立作品独立提议、显式发起走既有 fact_inventory_v1、无新卡片/验收 hook、关闭前后零 canon 写、wait 账完整。
- **预算与失败批次（只读保留）**：`business-replay-01`（预注册路径格式）、`-02`（原提议保留断言时机）、`-03`（会话中断）、`-04`（重复发起断言过宽）、`-05`（dismiss target 重绑）、`-06`（evidence target/重绑口径）、`-07`（已展示 receipt 时序）——每批 root-cause 均已修正，失败目录不改写；`-08` 为修复后 scoped 回归 PASS。
- **残余（不代签）**：真实模型质量、works 级假定、记忆类注入富化、I10 文学盲评不在本 CP；跨平台未验证。
