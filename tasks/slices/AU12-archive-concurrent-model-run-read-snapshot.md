# AU12 Archive Concurrent Model Run Snapshot / 模型执行期间档案可读快照

- 状态：闭环（模型执行期间档案保留快照+诚实加载+只读不写，真实页面验收）
- 类型：UI Contract Slice + Projection Slice + Recovery Slice
- 启动日期：2026-06-23
- 来源反馈：用户问题 11
- 所属验收：`docs/design/acceptance/author/AU-12-work-profile.md`；关联 AU-10 工作台执行态。

## 1. 用户 / 系统目标

发送消息后，模型执行期间作者打开作品档案，档案不能空白。系统应显示当前作品已有档案快照、明确 loading/error 状态，或说明正在读取；不能因为对话 turn 正在执行就让档案面板丢失内容。

## 2. 开工检查

- **Contract**：AU-12 档案只读 no-write；StructurePanel tab read model；AU-10 task_state / loading 语义。
- **Invariant**：
  - 档案读取是只读操作，不依赖当前模型执行完成。
  - in-flight turn 不能清空已加载档案快照。
  - 如果 archive request 失败，必须显示诚实错误和重试；不能显示空白或伪装成无内容。
  - 打开档案期间不得产生 `user_message`、`author_action`、adoption、tool 或 production write。
- **Boundary**：
  - `frontend`：StructurePanel 打开/切 tab 时需要保留 last-known snapshot、加载态和错误态。
  - `novel_web`：Channel 并发请求不能被当前 turn loading 状态挡住。
  - `novel_application` / `novel_persistence`：复用只读 archive service，不新增写路径。
  - **不改**：不让产品代码识别验收场景；不在 provider runtime 加特殊延迟分支。
- **Consumer**：模型执行期间打开作品档案的真实作者。
- **Proof**：真实 Tauri 工作台触发慢模型/长执行，执行中打开作品档案；概览/角色/伏笔/规则至少显示已有快照或明确加载/错误，不空白；执行完成后档案可刷新到最新状态。
- **Acceptance Driver**：新增 `au12-archive-concurrent-model-run-read-snapshot` 外部 Tauri driver；产品代码新增验收感知逻辑：no。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | |
| novel_domain | no | |
| novel_agent | no | 不改 provider runtime |
| novel_application | maybe | 如需 archive service 并发/read snapshot 补测试 |
| novel_persistence | no | 只读消费 |
| novel_web | maybe | Channel 并发请求/response handling |
| frontend | yes | StructurePanel loading/cache/error UX |
| docs/design | maybe | 若定义档案并发读取 UX |
| quality | yes | 新增真实页面验收 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 审计模型执行时 StructurePanel 数据流和 loading 状态 | done | 双重根因：① Phoenix channel 串行，`user_message` 在 `handle_in` 内同步跑模型 turn（`dispatch_user_message`），阻塞 channel→archive 读排队；② StructurePanel 被条件渲染（`{!isPanelOpen ? rail : panel}`）→关闭即卸载→重开 state 重置丢快照；③ 打开时 `setProfile(null)`、读失败 `setBlank`、无 loading 指示 |
| T2 | 修复 last-known snapshot / loading / error 展示策略 | done | StructurePanel 改为常驻挂载（关闭自渲染 null，state 跨开/关保留）；只在 workId 变才清空快照；加 `archiveLoading`/`archiveError` 状态条（“正在更新作品档案，先显示上次已知内容”/“读取失败…上次已知内容…重试”）；读失败不清空已加载内容；概览只在无任何快照时才降级为读取失败提示（保留 `au12-profile-read-failure-degrade`） |
| T3 | 补 Channel/API 并发读取回归 | done（带说明） | 见 §7：channel 串行是既有架构属性；本 slice 用前端快照+诚实加载满足“不空白/可读快照/只读不写”，channel 并发读取（执行期实时刷新）的后端改造归 AU-10 异步化后续 |
| T4 | 补真实 Tauri 慢执行期间打开档案验收 | done | `au12-archive-concurrent-model-run-read-snapshot` driver：加载档案→关闭→发慢消息（AU12SLOW，test-support 延迟）→执行中打开档案断言快照可见+loading 指示+turn 仍在执行+开档案不产生额外 user_message/author_action→turn 完成后刷新 |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收（`artifacts/slice-verify/au12-archive-concurrent-model-run-read-snapshot-tauri/summary.json`；`scripts/quality_accept.sh au12-archive-concurrent-model-run-read-snapshot --surface tauri` 通过）
- [x] 前端 / Channel / application 局部验证（前端 typecheck/lint/test 全绿；slice_verify provider 慢 turn marker）
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/check_design_trace.sh`
- [x] `bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-06-23 — 登记用户反馈 11。该问题归 AU-12 档案查看面和 AU-10 执行态交叉，不回退 AU-12 文件级结论，但应作为真实工作台并发 UX bug 排队。
- 2026-06-24 — 闭环：根因是 StructurePanel 条件渲染导致关闭即卸载、重开丢快照，叠加打开即清 profile/读失败置空/无加载指示。修复=常驻挂载保留快照 + workId 变才重置 + loading/error 状态条 + 读失败保留上次内容。真实 Tauri 证明执行期间打开档案概览仍显示「题材/核心卖点」立项快照（非空白）+「正在更新作品档案」诚实指示，且开档案不产生 user_message/author_action（只读 no-write），turn 完成后档案刷新。

## 7. 试行反馈

- 验收用真实页面状态和日志证明 no-write（开档案期间 user_message_sent=1=那条慢消息、author_action_sent=0），未在生产 UI 暴露 slice 状态。
- **已知边界（诚实登记）**：Phoenix channel 串行，慢 turn 同步占住 channel，执行期间发起的 archive 读取会排队、turn 完成后才返回；前端用「常驻快照 + 诚实加载指示」保证执行期间档案不空白、可读上次快照，符合 AU-12「显示已有快照或明确加载/错误」口径。要让档案在长 turn 执行期间实时刷新内容（真正并发读取），需后端 channel 并发改造（独立 archive channel/topic 或 `user_message` 异步执行），与 AU-10 异步 LongRunner 同属已延后的后端异步化，登记为后续。
- 慢 turn 用 slice_verify 的 `AU12SLOW` test-support 延迟 marker（非生产 provider runtime 分支），与既有 `SU02SLOW` 同范式。
