# VS-00C Creative Context Assembly

- 状态：docs-ready（CP0 待批准实现）
- 类型：Context Assembly Slice（VS-00D `call_site=:prose_writing` 投影）
- 启动日期：2026-06-14
- 所属契约：`docs/design/contracts/VS-00C-creative-context-assembly-contract-pack.md`
- 上游：`VS-00D`（AIMessageEnvelope 总框架）、`08-novel-element-model.md`（要素模型）、`06`（Context/Trace）

> 本文件是 VS-00C 的 slice 入口，不是 implementation plan。CP0 范围/验收已冻结，编码前需用户批准。
> VS-00C 是 VS-00D `AIMessageEnvelope(call_site=:prose_writing)` 的 WorkState 投影（CreativeDecisionPacket）；边界对齐已在契约 §1.4 完成。

---

## 0. 实现序列（契约 §8）

CP0 → CP1 → CP2 → CP3 → CP4 → CP5。依据数据依赖与杠杆，与接入模型能力无关。

| CP | 范围 | 关闭 Gap | 状态 |
|---|---|---|---|
| **CP0** | WritingCoordinate + MissingPolicyResult（坐标与缺失策略固化） | G11、G13(hard-missing)、降 G9 | **后端闭环（待外部页面验收）** |
| CP1 | 策略化省略 + 预算 profile + 确认路径同源组装 + fetcher fallback | G2/G4/G9/G10 | 下一活跃 |
| CP2 | chapter_summary 对象 + 续写摘要兜底 | G3/G5 | 待 CP1 |
| CP3 | 结构对象分层进入上下文 | G6/G1 | 待 CP2 |
| CP4 | 章计划结构化（方向层） | 08 NEM-GAP-03 | 待 CP3 |
| CP5 | ReaderEffectBrief + 创作输出自报告 | G12/G14 | 待 CP4 |

---

## 1. CP0 目标

把"这一轮到底在写哪里、缺什么、缺了怎么办"从散落在 `turn_execution_service` 的 `authoring_intent` + `resolve_target_chapter` 临时推断，固化为一等值对象 `WritingCoordinate` 与 `MissingPolicyResult`，并接入主链与 trace。这是后续所有 CP 的上下文选择器前置。

示例：
```text
作者：重写第 99 章（不存在的章）
```
期望：系统识别 authoring_mode=:rewrite、target_chapter 解析失败 → MissingPolicyResult.severity=:block → **不调用 provider**，诚实回复"找不到第 99 章"，trace 记录坐标与 block 决策；而不是编造一章正文。

---

## 2. 开工检查（承重六问）

- **Contract**：固化 `NovelDomain.WritingCoordinate`、`NovelDomain.MissingPolicyResult`（值对象 + 推导规则）；消费 `08`§7 坐标规则、`VS-00C`§3.0 CreativeDecisionPacket 的 writing_coordinate/missing 字段。坐标进入 trace（ADR-0013 DecisionTrace / ADR-0018 业务日志）。
- **Invariant**：
  - I-a：首稿 / 续写 / 重写三类输入推导出不同 `authoring_mode`（沿用 `authoring_intent`，不另发明意图判定——意图仍由 AI/planner 出，坐标只做确定性归一）。
  - I-b：hard missing（重写/续写目标章不存在、或必要 target 缺失）→ `severity=:block`，**该轮不调用 provider**，返回可解释 TurnResult。
  - I-c：确认执行路径复用原轮 WritingCoordinate 与原作者输入引用（不再 `author_input="确认执行"` + `context:nil`），降低 G9。
  - I-d：既有 I1/I2/I3 场景不变量不破；real.ex 三锚点不动。
- **Boundary**：
  - `novel_domain`：WritingCoordinate / MissingPolicyResult 纯值对象 + 推导（纯函数，无 I/O）。
  - `novel_application`：`TurnExecutionService` 推导坐标、按 MissingPolicyResult 决定是否 dispatch provider；`DialogueGateway.handle_confirmation_dispatch` 保留原轮坐标/输入；`TraceWriter` 记录坐标与缺失决策。
  - **不改**：CreativeProvider/real.ex 模板、Gate Order、schema、persistence 写入。
- **Consumer**：第一个真实消费者是 prose_writing turn 执行链（`TurnExecutionService.execute`）与 trace；确认派发路径为第二消费者。
- **Proof**：见 §4。
- **Acceptance Driver**：外部自动化驱动真实工作台输入"重写一个不存在的章" → UI 显示可解释的"找不到该章"且无创作产物；产品代码**不新增任何验收感知逻辑**（坐标推导/缺失策略是真实产品能力，对所有输入一致，不读验收 env/slice id）。

---

## 3. CP0 范围（最小实现步）

1. `NovelDomain.WritingCoordinate`：`work_ref / authoring_mode / target_unit / target_chapter / source_turn_ref / source_input_ref` + `derive/1`（从 action.authoring_intent + 已解析目标章映射 authoring_mode）。
2. `NovelDomain.MissingPolicyResult`：`severity(:ok|:block|:confirm|:degrade|:omit) / missing([{what,reason}])` + 判定 hard-missing 的规则（CP0 只实现 :block 与 :ok；:confirm/:degrade/:omit 留 CP1+）。
3. `TurnExecutionService`：执行前推导坐标 + 评估 MissingPolicyResult；`:block` 时短路（不 dispatch provider），产出可解释 TurnResult；坐标与缺失决策进 trace + 业务日志。
4. `DialogueGateway.handle_confirmation_dispatch`：从 source turn_result/plan 恢复原轮 WritingCoordinate 与原作者输入引用，传入执行（接 G9 的坐标侧，完整同源组装留 CP1）。

不做（CP1+）：预算 profile、OmissionNote、chapter_summary、fetcher 重组、:degrade/:omit 软缺失。

---

## 4. Proof

- 单测：`derive/1` 对 首稿/续写/重写/规划/无目标 五类映射出正确 authoring_mode；MissingPolicyResult 对"目标章存在/不存在"判 :ok / :block。
- 应用层测试：重写不存在章 → 无 provider 调用（complete_fn 注入断言未被调用）+ TurnResult 可解释；确认执行复用原坐标（prompt/trace 含原 target_chapter 而非"确认执行"）。
- 不变量：`MIX_ENV=test mix run scripts/scenario_invariants/run_i{3,1,2}_*.exs` 全过。
- 工程门禁：`mix compile --warnings-as-errors`、`mix cmd --app novel_domain mix test`、`mix cmd --app novel_application mix test`、`arch_check`、`xref` 无循环。
- 外部验收：`scripts/tauri_slice_verify.sh <cp0-rewrite-missing-chapter>`（真实工作台重写不存在章 → 可解释 block、无创作卡）。

---

## 5. 决策日志

- 2026-06-14：确认 VS-00C↔VS-00D 边界已在契约 §1.4 对齐（VS-00C = call_site=:prose_writing 投影）。实现序列 CP0 先行（坐标/缺失是 CP1 组装的前置）。CP0 slice 六问冻结，待用户批准编码。
- 2026-06-15：**CP0 后端闭环**（用户批准）。新增 `NovelDomain.WritingCoordinate`（derive/1 归一 authoring_mode，不重判意图）、`NovelDomain.MissingPolicyResult`（evaluate/2，CP0 只判 :ok/:block）；`TurnExecutionService.execute` 前置坐标推导 + 缺失评估，hard missing（作者显式命名的不存在章）短路不调 provider 并产可解释 TurnResult；`emit_coordinate` 业务日志（ADR-0018）；确认派发透传 source_turn_ref（坐标侧接 G9）。仅当带真实 DialogueContext 时评估缺失（确认/无 context 路径不误阻断）。
  - 测试：domain writing_coordinate 7 + missing_policy 7 + application cp0 5 = 19 全绿；novel_domain 130/0、novel_application 238/0 无回归；I3/I1/I2 全过；arch_check/xref/格式 通过；compile 零警告。
- 2026-06-15：**CP0 重设计**（commit c1c257d，初版瞄错靶子）。问题：planner 按规则把"未匹配列表的章"的 target_chapter 置 null，导致"续写第99章"静默回退到最新章；初版只挡 planner 回显坏章的罕见 case，漏主病灶。正确信号 = **作者点名（requested_chapter_raw 非空）+ planner 未匹配（target_chapter 空）**。
  - planner.ex 加 `requested_chapter_raw` 输出+指令+解析；MicroPlan 加该字段（含 from_map）；WritingCoordinate 改 requested_chapter+matched_chapter 双字段；MissingPolicyResult.evaluate/1 靠 planner 匹配结果；SliceVerify provider 按章号匹配（"第一章"→第01章、"第99章"不匹配→block）。
  - **决定性证据 repro4**：真实 `Planner.form_micro_plan("续写第99章的正文草稿", chapters=["第01章…"])` → action `{authoring_intent: :continuation, target_chapter: nil, requested_chapter_raw: "第99章", target_ref: "prose_writing"}` → 必 block。后端在所有可直接验证层（单测/真实 Planner 链路/I1·I2·I3）均证明正确。
  - **tauri 外部场景：已编码、未通过、未提交（本地 WIP）**。harness 文件：`frontend/slice-verify/external-ui-driver.mjs`(driveCp0MissingChapterBlock)、`native-tauri-verifier.mjs`(vs00c-cp0-missing-chapter-block 事件)、`scripts/tauri_slice_verify.sh`(4 处注册，复用 seed_p1_chapter_draft_generation)。slice_verify provider 章号匹配已随 c1c257d 提交。
  - **未破的诊断（下次专调入口）**：实跑两次，运行后端的 coordinate 日志为 `requested="第99章", matched="", authoring_mode="first_draft"`——即 action 同时 `requested_chapter_raw="第99章"` 却 `authoring_intent=nil`，这在 provider+planner 源码里**数学上不可能同时发生**（repro4 反证）。指向运行态差异（多半 seed 的 current_chapters 没按预期进 context，或编译/缓存态）。下次：起后端后直接打印那轮真实 planner prompt + provider plan JSON，与 repro4 对比定位。
  - **CP0 当前交付（用户选 B）**：后端真修复落袋（c1c257d 待 push），外部页面验收作为 tracked 缺口；harness 本地 WIP 留待短会话专调。
