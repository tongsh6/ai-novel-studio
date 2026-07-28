# VS-00G 设定盘点运行链

- 状态：doing
- 所属完整闭环：VS-00G 承重事实完备性与补全回路 CP4/CP5
- 当前 checkpoint：CP5a-d done（字段位+生命周期/盘点暂定候选/【暂定】注入/暂定设定区）；
  CP5e（SC-AU14-A2/A3 场景）doing；余项=触发 C、寿命催办、works 级假定、记忆类注入富化
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
- [ ] CP5e：SC-AU14-A3（面板确认→正式档案）与 SC-AU14-A2（【暂定】注入→否决→回缺席
  守则）真实 Tauri。
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
