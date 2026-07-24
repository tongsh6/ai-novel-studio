# AU10 工作台渲染稳定性与局部刷新隔离

- 状态：registered / 未开工
- 类型：AU-10 前端体验稳定性 Slice
- 优先级：P1 体验债务（B 轨）
- 登记日期：2026-07-24
- 来源：用户反馈——页面组件看似都在“局部刷新”，但异步元素从无到有、区域尺寸变化时，整个工作台仍会一闪一闪；要求分析局部刷新与全局刷新边界，并登记优化重构方案。
- 队列约束：本 slice 已进入 `tasks/NEXT.md` B 轨债务台账，**不改变当前 VS-00G 唯一队首**。

## 1. 问题定义与当前判断

当前代码未发现主动调用 `window.location.reload()` 一类整页刷新。用户看到的“整体闪烁”主要不是浏览器全局刷新，而是以下三类现象叠加：

1. React 局部 state 更新触发超大父组件 `WorkspaceChat` 重新执行，多个不相关区域跟随 render。
2. 可变 key、条件渲染和数据先清空后回填导致 DOM 子树卸载再挂载，视觉效果接近“刷新”。
3. 异步数据、运行控制区和作品档案面板从无到有并改变几何尺寸，触发 layout / paint；自动滚动又放大了视口跳动。

当前 checkout 的重点风险位：

- `frontend/src/components/WorkspaceChat.tsx` 同时持有工作区恢复、会话、消息、AgentRun、模型状态、档案开关和输入区等多类状态，更新隔离不足。
- 消息列表 key 混入运行期可变身份后，AgentRun 绑定变化可能导致整条消息重新挂载。
- 冷启动、作品切换和会话恢复存在“空壳 → works → session → messages → socket / review / activity”分段回填。
- 普通输入区与 AgentRun 控制区互换时高度明显变化，聊天视口随之重算。
- 自动滚动监听范围偏宽，加载态或运行事件变化也可能把用户视口拉到底。
- 作品档案展开与多类数据分段读取会造成面板宽度、内容高度和遮罩状态连续变化。

本 slice 与 `UA01-agentic-loop-streaming-reasoning-card-simplification.md` 互补但不重复：UA01 解决 Provider 长时间无反馈、流式执行与卡片语义；本 slice 解决前端 render / remount / layout 的稳定性，即使后端流式已经正确也仍需成立。

## 2. 开工七问

1. **Contract**
   - 消费 `docs/design/acceptance/author/AU-10-workbench-ui.md` 的 `SC-AU10-A1`、`SC-AU10-B1` 与验收卫生要求。
   - 消费 `docs/design/ui/41-workbench-layout.md` 的工作台布局与输入区约束、`docs/design/ui/43-structure-panel.md` 的档案加载/展开约束、`docs/design/ui/46-state-and-feedback.md` 的运行态反馈和控制区约束。
   - 消费 `docs/design/contracts/VS-05-ui-roundtrip-contract-pack.md` 的 UI card / action / task state 当前契约；本 slice 不自行发明新卡片类型或运行状态。
2. **Invariant**
   - 局部状态变化不得导致无关消息、输入区或档案快照被卸载重建。
   - 异步恢复和刷新期间保留 last-known content，或显示占位几何稳定、语义诚实的 loading / error；不得先清成空白再回填。
   - 消息与 AgentRun 使用稳定 canonical id；绑定补全不能改变已有消息身份。
   - 自动滚动只由用户可理解的新内容或显式跟随行为触发，不因任意 loading / health / panel state 更新抢夺视口。
   - 产品代码不得读取验收专用开关，不新增隐藏 DOM hook、`data-testid` 或验收专用状态。
3. **Boundary**
   - 默认只修改 `frontend/src/components/`、`frontend/src/lib/`、对应前端测试，以及外部验收 driver / scenario。
   - 明确不改 `novel_domain`、`novel_agent`、`novel_persistence`、Provider 协议和 Tauri runtime。
   - 若 CP0 证明闪烁根因需要聚合后端读取或 Channel 并发化，必须另行登记边界扩展，不在本 slice 内顺手跨层。
4. **Consumer**
   - 第一个真实消费者是 `App.tsx → WorkspaceChat` 的 Tauri 作者工作台。
   - 直接受益区域为消息时间线、AgentRun 工作态回复/控制区、底部输入区、作品档案侧栏和工作切换恢复流。
5. **Proof**
   - 前端单测证明：稳定消息身份、恢复期间不清空 last-known content、滚动触发边界、控制区/面板稳定渲染。
   - `cd frontend && pnpm typecheck && pnpm lint && pnpm test`。
   - `bash scripts/frontend_audit.sh` 与 `bash scripts/check_design_trace.sh`。
   - 外部 Tauri 场景记录连续截图/视频和关键区域几何轨迹；CP0 先冻结可量化阈值，禁止只用“看起来更顺滑”作为结论。
6. **Acceptance Driver**
   - 新建或扩展真实页面场景 `au10-workbench-render-stability`，由产品外部驱动冷启动/会话恢复、AgentRun 开始与结束、档案展开与刷新、作品切换四段链路。
   - driver 只使用可见 role / label / 文案和窗口几何、截图、网络帧等外部证据；产品代码新增验收感知逻辑：**no**。
7. **Exploration**
   - 不适用。本 slice 只治理 UI 渲染身份、状态边界和布局稳定性，不物化小说要素或业务数据；不得借机改变探索面、五本账或档案事实语义。

## 3. 方案登记与定序

| 方案 | 内容 | 适用条件 | 状态 / 定序 |
|---|---|---|---|
| **A. 最小防闪烁修复** | 固定消息 key；启动/恢复增加 bootstrap gate；作品切换保留旧内容到新快照可提交；输入区与 AgentRun 控制区预留稳定几何；档案沿用 last-known snapshot 或等高 skeleton；缩小自动滚动触发面；计数/徽标预留宽度。 | CP0 能把主要闪烁归因到 remount、先清空后回填、条件区高度变化或滚动抢位。 | **默认第一步 / CP1**。最小改动、可回滚，先消除用户可见症状。 |
| **B. 组件与状态边界重构** | 将工作台拆成 WorkbenchHeader、ConversationViewport、ConversationMessage、AgentRunFlow、WorkbenchComposer、ArchiveRail、StructurePanel 等稳定边界；把 bootstrap、connection、transcript、agent runtime、archive snapshot、provider status 拆成独立 hooks/store selector，并用 memo / selector 隔离无关更新。 | A 后仍存在父组件级连锁 render，或 `WorkspaceChat` 内多状态共同演进使修复难以验证。 | **默认第二步 / CP2**。以行为等价、小批搬迁为原则，不与视觉改版混做。 |
| **C. Server state 收敛到 TanStack Query** | works、sessions、archive、model health、review 等服务端状态进入 Query cache；Zustand 只保留本地 UI state；socket 事件通过 canonical id 更新 cache；档案多资源读取采用聚合提交，避免分段闪动。 | CP0/CP2 证明重复请求、手工 loading/error/clear 状态和多源回填是主要复杂度；现有 Query 能力可复用。 | **条件方案 / CP3**。不因“库已存在”就全量迁移，按一个真实消费者逐步替换。 |
| **D. 工作台显式状态机** | 将 BOOTING、RESTORING_WORK、RESTORING_SESSION、CONNECTING、READY、RECONNECTING、SWITCHING_WORK、DEGRADED 等状态和可见规则显式化，统一 last-known / loading / error / retry 策略。 | 经过 A-C 后，重连、切作品、恢复会话、AgentRun 并发仍出现非法组合或竞态，且普通 reducer/store 已无法清晰表达。 | **末位条件方案 / CP4**。必须有竞态证据再引入，避免用状态机掩盖组件边界问题。 |

推荐路线固定为：**CP0 测量 → A 最小稳定化 → B 边界拆分 → 依据证据决定 C / D**。C、D 不是当前承诺的全量重构。

## 4. Checkpoints

| CP | 目标 | 交付物 | 状态 |
|---|---|---|---|
| CP0 | 建立刷新类型与视觉抖动基线 | 区分 React render、DOM remount、layout / paint、真实页面 reload；记录四个真实场景的连续截图/几何轨迹、触发 state 和当前阈值；复核当前 dirty checkout，避免以过期行号开工 | todo |
| CP1 | 落地方案 A | 稳定 key、last-known/bootstrap、稳定输入区/面板几何、滚动锚定；对应组件测试与一次真实 Tauri 复验 | todo |
| CP2 | 落地方案 B | 小批拆出组件和状态 hooks；每批保持 UI/Channel contract 不变，并用 render 边界测试证明无关区域不跟随更新 | todo |
| CP3 | 评估并按需落地方案 C | 先选一个高收益 server-state 纵切（优先档案或会话恢复）；迁移前后请求次数、空白窗口和错误降级有对照；无收益则记录“不启动” | conditional |
| CP4 | 评估并按需落地方案 D | 只有非法状态组合/竞态证据达到启动条件时冻结状态图与迁移计划；否则记录“不启动” | conditional |
| CP5 | 场景化闭环 | `au10-workbench-render-stability` 外部驱动真实 Tauri 页面通过，产出截图/视频/几何与网络证据；全量前端门禁和 AI 静态扫描闭环 | todo |

## 5. 验收场景

1. **冷启动 / 会话恢复**：工作台从启动到 READY 期间不出现“已有内容 → 空白 → 内容恢复”的往返；loading/error 语义诚实，主布局几何稳定。
2. **发送消息 / AgentRun 切换**：消息提交、运行控制区出现、运行结束回到普通输入区时，已有消息不重挂，用户当前阅读位置不被无关状态抢到底部。
3. **作品档案展开 / 刷新**：侧栏展开后立即显示 last-known snapshot 或稳定 skeleton；多类读取分段完成时不反复空白或改变主区遮罩语义。
4. **作品切换 / 重连**：旧作品内容在新作品快照提交前不会与新标题混搭；切换态明确，失败可重试，不以清空全页模拟安全。
5. **反证**：浏览器/Tauri 文档级 reload 次数为 0；产品代码无验收开关、隐藏 hook 或测试专用状态。

CP0 必须为“几何稳定”冻结阈值和采样方法；在此之前不得把主观观感写成 passed。

## 6. 非目标

- 不在本 slice 中重做卡片视觉、Prompt、Provider streaming 或 AgentRun 后端执行语义。
- 不借状态拆分改写 UI contract、action 权限、adoption 语义或档案业务事实。
- 不一次性把全前端迁移到 TanStack Query，也不预先引入新的状态管理库。
- 不为了验收添加 `data-testid`、slice query、localStorage 开关或产品内自动操作。

## 7. 风险与恢复指引

- 当前工作区存在进行中的 VS-00G / AgentRun / 前端改动；开工前必须重读 `tasks/NEXT.md`、本文件和当前 `git diff`，重新定位风险位，禁止覆盖或回退用户 WIP。
- 优先将 CP0 的测量结果和 CP1 改动保持小批可回滚；若 A 已达到阈值，不强制执行 C、D。
- 若闪烁只在 React `StrictMode` 开发模式放大，也仍需验证真实 Tauri 构建；不得仅通过关闭 StrictMode 处理业务副作用不幂等。
- 与 `UA01-agentic-loop-streaming-reasoning-card-simplification.md`、`AU12-archive-concurrent-model-run-read-snapshot.md` 复用已有场景与 last-known 原则，避免建立第二套 runner 或 snapshot 语义。

## 8. 决策记录

- 2026-07-24 — 登记四种方案。默认顺序为 A 最小稳定化、B 状态边界；C Query 化与 D 状态机必须由 CP0/CP2 证据触发。
- 2026-07-24 — 本次只登记任务，不修改前端生产代码，不改变当前 VS-00G 唯一队首。
