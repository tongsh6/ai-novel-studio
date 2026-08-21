# P1 正文伴生产物

- 状态：done（2026-08-21）
- 类型：Artifact Slice
- 启动日期：2026-08-11

## 1. 用户 / 系统目标

关闭结构化容器排查 R2：作者在主循环里写正文时，系统除正文草稿外，同轮把新引入的
角色、伏笔、世界规则和明确创作约束整理成可逐项审阅的待采纳材料。它们不自动成为作品
事实，也不要求作者另行发起一次“设定盘点”。

完整闭环：

```text
真实工作台正文请求
→ prose_writing 同次 provider 响应
→ prose_fragment + 四类可选 companion seed
→ 多个 TentativeArtifactSet / candidate_set
→ 作者逐项采纳或放弃
→ 既有 Character / Memory / Reading Projection 边界
→ 作品档案与后续上下文可达
```

## 2. 开工检查

- Contract：`VS-02A-tentative-creative-artifact-contract-pack.md` §3.2；消费既有
  `ToolResult`、`TentativeArtifactSet`、`TurnResult`、`available_actions` 和 06 §4.5.2
  采纳写入映射。
- Invariant：所有输出默认 tentative；创作字段与 provider 响应字节一致；主/伴生产物
  item id 唯一；未采纳不写 Character、Memory 或 Reading Projection。
- Boundary：切过 `novel_common` 输出契约、`novel_agent` provider/adapter、
  `novel_application` artifact/TurnResult 组装；不新增表、不改采纳落位、不改前端组件。
- Consumer：真实 WorkspaceChat 通过既有 `candidate_set` 同轮展示多组待采纳产物；作者动作
  继续消费既有 `available_actions`。
- Proof：输出契约、provider、adapter、assembler、正文 AgentRun 定向测试；I1/I2/I3；
  真实 Tauri 场景证明同轮五组、采纳前 no-write、选择性采纳后的档案落位。
- Acceptance Driver：`scripts/tauri_slice_verify.sh p1-prose-companion-artifacts`，外部自动化
  只按可见文案/role 操作真实 Tauri 工作台，不给产品增加验收开关或 DOM hook。
- Exploration：生成后在当前对话候选面直接可达；采纳后由既有作品档案与
  `work_archive_read` 读取角色/伏笔/规则，不新增探索工具。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不新增基础类型 |
| novel_domain | no | 复用既有 artifact type 与逐项采纳语义 |
| novel_common | yes | provider/tool output 的伴生产物结构与校验 |
| novel_agent | yes | prose prompt、provider 解析、ToolResult adapter |
| novel_application | yes | 多组 TentativeArtifactSet 与 TurnResult 组装 |
| novel_persistence | no | 复用既有采纳写端口与读模型 |
| novel_web | no | Channel 已透传同一 TurnResult |
| frontend | no | 复用既有多 `candidate_set` 渲染与动作组 |
| docs/design | yes | VS-02A §3.2 冻结运行时边界 |
| quality | yes | 新增真实 Tauri acceptance manifest/driver |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 冻结正文伴生产物 contract | done | VS-02A §3.2 |
| T2 | 扩 provider result / ToolResult 输出契约 | done | `CreativeProviderResult.companion_artifacts` + `ToolOutputContract.validate_prose_companion_artifacts/1`（仅四类既有 seed）+ `validate_unique_item_ids/2`；`Real` 解析顶层 `companion_artifacts` 并限定只有 `prose_writing` 可带（`unexpected_companion_artifacts`）；adapter 输出 `companion_artifacts` 分组 + `state_delta` 逐组 + `artifact_refs` 含伴生 id |
| T3 | 扩 ArtifactAssembler / TurnResult 多组组装 | done | `ArtifactAssembler.assemble_all/3`（主产物带章归属 provenance，伴生组只带 turn/tool 来源）；`TurnExecutionService` 多组走 `TurnResultBuilder.build_artifact_sets/5`，单组/空组路径零改动 |
| T4 | 补局部测试与不变量 | done | contract 2 例 / real 解析+范围 / adapter 分组+拒绝 / assembler / prose AgentRun flow 五组 pending+5 卡+≥15 动作；I1 driver 扩到解析顶层对象 `items ++ companion_artifacts`（原只认 JSON 数组）；I1/I2/I3 全 PASS |
| T5 | 外部真实页面验收 | done | `bash scripts/tauri_slice_verify.sh p1-prose-companion-artifacts` 2026-08-21 PASS（run_id / provider_call_ref 见证据目录 `summary.json`；依赖升级后经 `task_done.sh --slice` 再次取证）：真实工作台一条正文请求 → bounded prose run → 同一 provider 调用产 5 组 pending（prose/character/foreshadowing/world_rule/constraint）/ 5 张既有 candidate_set 卡 / 15 个采纳动作 → 采纳前零写入零采纳、档案「待采纳 5」→ 只按「保存到作品档案」采纳岑雾 → 档案角色 tab 出现「岑雾 配角 巡夜人」、其余 3 组伴生仍 pending。证据 `artifacts/slice-verify/p1-prose-companion-artifacts-tauri/`（截图 pending / character-adopted、ui-frames、app-log、summary） |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收（2026-08-21 真实 Tauri PASS；08-12 首次 PASS 后生产代码又改过，已对当前代码重跑取证）
- [x] 后端 / Agent / Application 局部验证（2026-08-21 全量 `mix test` 1429 tests 0 failures）
- [x] `MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs`
- [x] `MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs`
- [x] `MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs`
- [x] `mix compile --warnings-as-errors && mix test`
- [x] `mix xref graph --format cycles --label compile-connected --fail-above 0`
- [x] `mix run scripts/arch_check.exs`
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/ai_static_scan.sh --top 10`（本刀触碰文件 0 发现；全局 pending 项 req 公告/task-done manifest 见收口记录）

## 6. 决策日志

- 2026-08-11 — 选择“同一次写作调用返回正文与 companion seeds”，不追加正文后的第二次
  提取调用；避免模型二次猜测正文，也让 I1 因果绑定直接落在同一 provider response。
- 2026-08-11 — 不改 UI/Pencil：现有事实盘点已证明一个 TurnResult 可承载并显示多组
  `candidate_set`，本 slice 的真实缺口是上游没有产出。

## 7. 试行反馈

- 2026-08-21 — 真实页面 PASS。伴生产物在对话候选面按类型分卡、每卡独立「保存到作品档案 /
  不保存 / 修改后保存」，采纳岑雾后档案即时可见，未选的伏笔/规则/约束仍留在候选面与
  档案「待采纳」计数里——逐项采纳粒度与 AU09 逐候选采纳同构，零前端改动即成立。
- 观察（不在本刀修）：`constraint_seed` 卡头当前显示「规则草稿」（与 `world_rule_seed`
  同文案），`copy.ts` 已有 `constraintTitle: "约束草稿"` 但候选卡未按该类型分派；属
  展示文案层小缺口，改动会连带既有 driver 断言，登记等拉动。
- 真实模型侧未验：替身 provider 的伴生产物是确定性语义 fixture（作者请求明确点名新角色/
  伏笔/约束时才产，普通正文请求恒 `[]`）；真实 LLM 是否按「只提取有依据的新事实、不凑数」
  执行，属 M5 狗粮观察项（看 memory_items.tags / characters 是否从正文主循环开始增长，
  即 R2 空转是否真正解除）。
- 本刀只解除「输入端等不到」这一半；伴生产物采纳后的落位（Character / Memory 分类）沿用
  既有映射，未新增落位。
