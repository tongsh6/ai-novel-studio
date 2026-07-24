# UA01 Quality Revision Action Run Anchoring

- 状态：done
- 类型：Author Action / AgentRun / UI Contract / Recovery / Acceptance Slice
- 父能力：UA-01、VS-00E、AU-04、AU-05
- 用户决策：2026-07-24，质量优先，不以实现成本缩小范围。

## 1. 目标

把质量复核卡发起的 `revise_from_findings` 收束为一条可解释、可恢复、无重复状态的链：

```text
质量卡决策
→ 持久 author_action receipt
→ trigger 绑定的 bounded revision AgentRun
→ 单一 assistant 工作回合
→ 同 run 固定控制坞
→ 独立修订候选
```

## 2. 开工七问

- Contract：消费 `VS-00E` 的 `revise_from_findings` 与 `UA-01` AgentRun；扩展
  `agent_run_state` 的 `trigger/current_activity`，不新增 card_type 或 command。
- Invariant：一次作者动作最多启动一个 run；一个 run 只显示一个 assistant 工作回合；
  固定控制坞绑定同一 run；原稿/修订稿均保持独立 tentative。
- Boundary：切穿 `novel_web → novel_application → novel_domain/persistence` 公开边界与
  `frontend` 消费面；不修改 provider 私有协议，不让 `novel_web` 直接查询 Repo。
- Consumer：第一个真实消费者是 `WorkspaceChat` 质量卡动作、动作回执、assistant 工作
  回合与固定控制坞。
- Proof：AgentRun trigger/持久化测试、Channel author_action/run 绑定测试、前端锚定与
  质量卡状态测试、真实 Tauri 场景。
- Acceptance Driver：外部 Tauri driver 通过真实质量卡点击、刷新、暂停/继续和候选动作
  驱动页面；产品代码不新增验收 env/query/localStorage/隐藏 DOM hook。
- Exploration：不适用。本 slice 不物化小说要素；只改变既有 tentative 修订候选的动作、
  运行与呈现绑定。

## 3. 必须实现

1. `revise_from_findings` 成功启动后写入既有 `author_action_receipts`，回执包含稳定
   `receipt_id/run_id/source_surface_ref`；重复提交返回同一语义结果。
2. AgentRun 持久 `trigger`，公开 state 同时提供 source-bound trigger 与结构化
   `current_activity`。
3. Channel 重连时把仍存活的 bounded run 重新绑定到新 Channel event sink，并广播当前
   state；不得重跑 provider。
4. 质量卡只在请求 ack 前显示短暂提交态；ack 后显示稳定已提交状态。
5. action-triggered run 锚到来源 assistant turn；不出现游离 `AI / 创作执行 /
   当前创作请求进行中` 第二块。
6. assistant 工作回合只保留一条活动行；固定控制坞不复制模型叙事。
7. 原稿与修订稿动作显式区分并保持独立可用。

## 4. 非目标

- 不新增第二套 action receipt 表、run bus、前端假状态或验收专用恢复缓存。
- 不把 action 转成第二条 `user_message`。
- 不自动覆盖、采纳、丢弃或锁定原稿。
- 不修改质量 finding 的生成规则或 prose provider 内容协议。

## 5. Pencil 冻结

- `46§9.8-quality-revision-ready`（`AH4WW`）
- `46§9.8-quality-revision-running`（`EYiyl`）
- `46§9.8-quality-revision-paused`（`hRFxB`）
- `46§9.8-quality-revision-comparison`（`ksNvT`）

## 6. 验收

目标场景：`quality-revision-action-run-anchoring`

- 点击质量卡只发送一次 `author_action(revise_from_findings)`，零第二条 `user_message`。
- ack、持久 receipt、AgentRun trigger 与 UI 回执的 receipt/run/source/target/finding refs
  一致。
- active run 只有一个 assistant 工作回合和一个同 run 固定控制坞。
- 页面刷新后恢复同一 active bounded run，不新增 provider 调用。
- pause/resume/cancel 均绑定该 run；终态后固定控制坞收起。
- 原稿与修订稿分别可保存、放弃、编辑后保存；未决定前均不写 production。

## 7. 当前进度

- [x] 七问与范围冻结
- [x] 设计文档 §9.8
- [x] Pencil 四态
- [x] trigger / receipt / reconnect 契约与测试
- [x] 前端单一工作回合、稳定回执、候选独立动作
- [x] 真实 Tauri acceptance 与质量门禁

## 8. 完成证据

- 外部自动化：`bash scripts/tauri_slice_verify.sh quality-revision-action-run-anchoring`
  驱动真实 Tauri 页面通过；同一 `run_id` 完成暂停、刷新重连与继续，零第二条
  `user_message`。
- 页面证据：`artifacts/slice-verify/quality-revision-action-run-anchoring-tauri/`。
- 局部与全量：后端全量测试、前端 typecheck/lint/test、架构边界、I1/I2/I3 场景不变量
  均通过。
- 产品代码未新增验收 env、query、localStorage、隐藏 DOM hook 或验收 provider。

## 9. 同会话 UI 收口（2026-07-24）

- `assistant_message.text` 与同一回合 AgentRun `author_narrative` 若出现逐字相同的完整
  段落，前端只保留主回复中的一份；去重只规范化空白并做完整段落精确比较，不做模糊
  语义匹配，不改写或吞掉不同的 source-bound 过程叙事。
- 普通 `casual_reply` 不再重复显示“AI 回应”badge；成功完成且无独立叙事、计划、
  产物、正文草稿、durable 或 author_action 语义的 bounded run 不再留下低价值完成
  摘要。执行中工作态、失败/取消、长任务和质量修订等承重状态继续显示。
- 对话内仍保留模型叙事、活动和结构状态作为历史记录；固定控制坞继续只承担同一 run 的
  状态、控制和 steering，不复制模型叙事，§9.7 / §9.8 职责不变。
- 用户/AI 双向消息组件、128px 作品档案 rail、无顶部/左侧装饰分隔线已同步
  `novel-studio.pen`。
- 复验：`au01-ordinary-chat-two-turn-roundtrip` 与
  `quality-revision-action-run-anchoring` 真实 Tauri 场景通过。

## 10. 任务状态与决策层级收口（2026-07-24）

- 顶栏优先聚合真实 active AgentRun；暂停时显示“1 个任务已暂停”，不再与“无任务”
  并存。暂停态停止 spinner/呼吸动效，对话只显示静态恢复说明，状态与 `3/4` 进度由
  固定控制坞唯一承载；终态不再残留“正在生成修订稿”。
- 空的“发送调整”明确禁用；暂停且无补充要求时“继续”为主操作，输入补充要求后发送
  才升为主操作。
- 质量卡在 ack 后折叠为“n 项建议 · 修订任务已提交”；原稿/修订稿使用同构候选操作组，
  保存为主操作、编辑为次操作、放弃为低层级危险操作并二次确认。
- 回执与 assistant 工作回合组成同一来源链；右侧 128px rail 只保留档案图标/短标签/
  待采纳 badge，会话移到顶栏；模型与同步健康状态降为中性视觉，供应商细节留在设置。
- Pencil `hRFxB` 已按 1280×800 同步且 layout 无问题。真实 Tauri
  `quality-revision-action-run-anchoring` 复验通过，summary 证明：viewport
  `1280×800`、scroll width `1280`、暂停语义静态、空发送禁用、继续为主操作、
  候选分组可见、放弃取消零 `author_action`。
