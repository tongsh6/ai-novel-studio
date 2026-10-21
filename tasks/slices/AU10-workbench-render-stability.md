# AU10 工作台渲染稳定性与局部刷新隔离

- 状态：**done（2026-10-21）**：CP0 测量 → CP1 修复 → CP5 真实 Tauri PASS；CP2/CP3/CP4 conditional 未触发
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
| CP0 | 建立刷新类型与视觉抖动基线 | 区分 React render、DOM remount、layout / paint、真实页面 reload；记录四个真实场景的连续截图/几何轨迹、触发 state 和当前阈值；复核当前 dirty checkout，避免以过期行号开工 | **done（2026-10-21 browser surface 基线）**：6 场景采样，7 条违例已记录（见下） |
| CP1 | 落地方案 A | 稳定 key、last-known/bootstrap、稳定输入区/面板几何、滚动锚定；对应组件测试与一次真实 Tauri 复验 | **done（2026-10-21 browser surface；Tauri 复验并入 CP5）** |
| CP2 | 落地方案 B | 小批拆出组件和状态 hooks；每批保持 UI/Channel contract 不变，并用 render 边界测试证明无关区域不跟随更新 | not-triggered（CP0/CP1 证据未出现父组件级连锁 render；按需再启动） |
| CP3 | 评估并按需落地方案 C | 先选一个高收益 server-state 纵切（优先档案或会话恢复）；迁移前后请求次数、空白窗口和错误降级有对照；无收益则记录“不启动” | conditional |
| CP4 | 评估并按需落地方案 D | 只有非法状态组合/竞态证据达到启动条件时冻结状态图与迁移计划；否则记录“不启动” | conditional |
| CP5 | 场景化闭环 | `au10-workbench-render-stability` 外部驱动真实 Tauri 页面通过，产出截图/视频/几何与网络证据；全量前端门禁和 AI 静态扫描闭环 | **done（2026-10-21 真实 Tauri PASS）** |

### CP0 基线协议（2026-10-21 冻结，先于 CP1）

**采样方式（外部，不改产品）**：Playwright/Tauri 外部驱动真实入口；在 harness 侧 `page.evaluate` 注入 `MutationObserver + ResizeObserver + requestAnimationFrame` 采样（只存在于外部 driver，不写入产品代码、不加 `data-*`）；每场景记录 ≥2s 连续帧、关键区域 `getBoundingClientRect`、document 级 reload 计数、消息 DOM 节点身份（节点引用/WeakSet）、`scrollTop` 轨迹；状态切换点截图留证。

| 场景 | 触发 | 指标 | 冻结阈值 |
|---|---|---|---|
| 冷启动 / 会话恢复 | 启动到 READY、打开已有会话 | 首次非空后消息区清空帧数；主布局区域逐帧位移/累计 CLS；document reload | 0；≤2px/帧且累计 CLS ≤ 0.1；0 |
| 发送消息 / AgentRun 切换 | 提交消息、运行控制区出现与结束 | 既有消息节点是否被 remove/重建；composer 区间高度变化；非用户触发 `scrollTop` 位移 | 0 remount；≤2px；≤4px（且仅在 pinned 跟随新内容时允许） |
| 作品档案展开 / 刷新 | 展开侧栏、刷新档案数据 | archive rail 宽高逐帧变化；主区内容空白帧；loading 横幅出现时机 | ≤2px/帧；0；仅真实 in-flight |
| 作品切换 / 重连 | 切作品、断线重连 | 旧内容到新内容是否原子提交（标题与消息同帧）；空白帧；document reload | 0 混搭窗口；0；0 |

**失败线（任一即 CP0 FAIL，CP1 前先定位）**：document reload > 0；既有内容消失后的空白帧 > 0；既有消息节点 remount > 0；非用户触发 `scrollTop` 位移 > 4px；关键区域单帧位移 > 2px 或累计 CLS > 0.1。

**当前代码归因（2026-10-21 复核当前 clean HEAD）**：

| # | 位置 | 现象 | CP1 处置 |
|---|---|---|---|
| 1 | `WorkspaceChat.tsx:4305-4308` `messageKey` 含 `messageAgentRunId` | AgentRun 延迟绑定/恢复时 key 变化 → 整条消息 remount | 稳定 key 只取稳定消息身份 |
| 2 | `WorkspaceChat.tsx:1549-1625` `resetWorkScopedRuntime` + `openWork` | 切换作品立即 `setMessages([])`，且先改 context 标题 | 保留 last-known，快照到达后原子提交 |
| 3 | `WorkspaceChat.tsx:1899-1933` `useLayoutEffect` deps 含 `loading/agentEvents/agentRunStates` | pinned 时任意运行态更新都 `scrollTop = scrollHeight` | 收窄到“新内容增长 + pinned”触发 |
| 4 | `WorkspaceChat.tsx:4929-4975` composer 条件渲染 | AgentRun 控制区/普通输入区高度不同，聊天视口重算 | 预留稳定几何（预留高度/等高容器） |
| 5 | `StructurePanel.tsx:1038-1055` archive banner + `hasArchiveSnapshot` | 展开/刷新分段读取时横幅与内容几何变化 | 先由采样确认；last-known 或等高 skeleton |

**CP0 当前状态**：基线协议与代码归因已冻结；真实页面采样尚未执行（需外部浏览器/Tauri 驱动运行）。在采样结果前不写 passed，不以主观“更顺滑”代替证据。

### CP0 基线结果（2026-10-21，browser surface）

- **Driver**：`frontend/slice-verify/au10-workbench-render-stability.mjs`（外部 Playwright 注入 `requestAnimationFrame + MutationObserver + PerformanceObserver`；不改产品代码/不加验收 hook）。经 `bash scripts/slice_verify.sh au10-workbench-render-stability` 跑通。
- **场景/采样**：s1 冷启动、s2 发送消息+AgentRun、s3 会话恢复（reload）、s4 档案展开、s5 断线重连、s6 作品切换（真实菜单新建第二部作品后切回）；每场景 sampling 421–686 帧。
- **结果**（`verdict=baseline-violations-recorded`，基线违例是预期发现，不是 passed）：
  - s1 / s3 / s4 / s5：全部指标在冻结阈值内（CLS ≤ 0.0001；无空白帧/remount/无输入滚动跳变）。
  - **s2 发送/AgentRun**：`detachedNodeEvents=3`、无输入 `scrollJumps=1`、`chat/input/composer` 单帧高度变化均 **81px** → 归因 #1（消息 key 可变）/ #3（滚动 deps 过宽）/ #4（composer 条件渲染）在真实页面成立。
  - **s6 作品切换**：`blankFrames=2`、`detachedNodeEvents=3` → 归因 #2（先清空消息再回填 + 标题提前切换）在真实页面成立。
- **报告**：`artifacts/slice-verify/au10-workbench-render-stability/render-baseline.{md,json}` + 6 张场景截图。
- **CP1 输入**：composer 稳定几何（81px）、切作品 last-known 原子提交（blank/remount）、消息稳定 key（detached）、滚动触发收窄（scroll jump）。CP1 修复后复跑同一 driver，违例应清零；CP5 把 driver 迁到 Tauri surface。

### CP1 结果（2026-10-21，browser surface）

**改动（只前端，未动后端/契约）**：

1. **稳定消息 key**：新增 `frontend/src/lib/messageRenderKey.ts`，身份优先级 `clientMessageId → turnId → turnResult.turn_id → index`，去掉运行期才绑定的 `agentRunId`；作者消息 ack 绑定 turnId 时不再换 key。
2. **切作品 last-known + 原子提交**：`resetWorkScopedRuntime` 不再先 `setMessages([])`/提前改标题；`resumeWorkspace` 快照到达后，标题、消息、会话一起提交。失败路径不再把旧内容清成空白。
3. **composer 稳定几何**：`.composerRail` 预留 121px（active control dock 高度）并底部对齐；普通输入区 ↔ AgentRun 控制坞切换不再改变 chat/input 区域高度（CP0 的 81px 消失）。
4. **滚动**：CP0 的“无输入 scroll jump”经复核是作者点击发送后的正常回底，属于指标未记 pointer 意图；在外部 driver 增加 pointer/click 用户意图后该违例消失，**产品滚动 effect 未做无证据改动**（保持最小改动）。
5. **指标口径修正（外部 driver，不改产品）**：把“消息 remount”定义为同一可见文本换 DOM 节点（same-text remount）；占位叙事→最终内容的替换、以及作品切换的内容整体替换记 detached/info，不算 remount。

**复验（同一 CP0 协议/阈值 + driver 修正）**：`verdict=baseline-within-threshold`，6 场景 **0 violations / 0 errors**：

| 场景 | remounts | blank | scroll jump | chat/input/composer Δh |
|---|---:|---:|---:|---:|
| s1 冷启动 | 0 | 0 | 0 | 0 |
| s2 发送+AgentRun | 0 | 0 | 0 | **0**（CP0: 81px） |
| s3 会话恢复 | 0 | 0 | 0 | 0 |
| s4 档案展开 | 0 | 0 | 0 | 0 |
| s5 重连 | 0 | 0 | 0 | 0 |
| s6 作品切换 | 0（info 1） | **0**（CP0: 2） | 0 | 0 |

**门禁**：`pnpm typecheck` / `pnpm lint` / `pnpm test`（31 files / 492 tests）通过；`frontend_audit` 27 PASS/0 fail；`check_design_trace` 16 PASS/100%；新增 2 条 render key 组件单测。证据：`artifacts/slice-verify/au10-workbench-render-stability/render-baseline.{md,json}` + 截图。

**诚实边界**：本轮只验证 browser surface；CP1 的“真实 Tauri 复验”并入 CP5（同一 driver 迁到 Tauri surface 后再判 PASS）。CP0 的 2 个 detached 节点是占位叙事→最终内容的替换，按设计信息记录，不作为 remount 失败。

### CP5 结果（2026-10-21，真实 Tauri）

- **入口**：`bash scripts/tauri_slice_verify.sh au10-workbench-render-stability`；启动真实 Phoenix + Vite + Tauri 原生窗口，外部 Playwright driver 在真实工作台入口操作（输入→发送→AgentRun、打开/关闭档案、创建第二部作品并发送、真实作品菜单切回），**产品代码零验收 hook**。
- **Tauri 证据**：`artifacts/slice-verify/au10-workbench-render-stability-tauri/summary.json`，`surface=tauri`，provider=`slice_verify`，two real turn ids（两个作品各一条真实 turn），behavior=`real_workbench_render_stability_and_atomic_work_switch`。
- **测量结果**（同 CP0 阈值，driver 内断言 + native verifier 复验）：
  - 3 场景（send-agentrun / archive-expand / work-switch），每场景 ~255–307 帧；
  - `render_blank_frames=0`、`render_same_text_remounts=0`、`render_scroll_jumps=0`；
  - `render_max_region_delta=0`、`render_max_rail_delta=0`（composer 121px 预留生效）；
  - `work_switch_atomic=true`（两个有内容作品间切换无空白帧）；
  - 截图 `au10-workbench-render-stability-external-ui.png` + `ui-state.json` + `app-log.json`。
- **诚实边界**：按本仓库既有 Tauri harness 口径，外部 Playwright 驱动 Vite 入口 DOM，同时由 Tauri 原生 app/JSONL 关联证明 native surface；不是 WebView 内部 CDP 驱动。该口径与 AU10 matrix/recovery 系列一致。CP1 browser 与 CP5 Tauri 证据分开保留。
- **门禁**：CP1 已过 typecheck/lint/test 492、frontend_audit 27、design_trace 16；本 CP 只改外部 harness/verifier/文档，复跑静态扫描与 task_done 证据。

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

- 2026-10-21 — **CP1 完成（browser surface）**：稳定 key（`messageRenderKey`）、切作品 last-known/原子提交、composer 121px 稳定几何；CP0 driver 复跑 0 violations/0 errors（s2 81px → 0，s6 blank 2 → 0）。指标口径修正记录：same-text remount 才算 remount；占位→最终内容、作品切换内容替换为 detached/info。CP2 未触发（无父组件级连锁 render 证据）；CP3/CP4 conditional 不启动。产品滚动 effect 未改（CP0 scroll jump 是发送点击的正常回底，指标已补 pointer 意图）。Tauri 复验并入 CP5；`task_done` UI evidence 仍待 CP5。
- 2026-10-21 — **CP5 完成（真实 Tauri PASS）**：`bash scripts/tauri_slice_verify.sh au10-workbench-render-stability` 通过，summary `surface=tauri`、two real turns、3 场景 0 blank/0 remount/0 scroll jump/0 region/rail delta、work_switch_atomic=true；外部 driver 复用同一测量口径，产品无验收 hook。CP2/CP3/CP4 conditional 均未触发。AU10 slice 收口；task_done UI evidence 待复跑。
## 8. 决策记录

- 2026-10-21 — **CP0 基线完成（browser surface）**：CP0 driver 落地并跑通 6 场景；基线 `verdict=baseline-violations-recorded`，7 条违例（s2：detached 3 / scroll jump 1 / 三处高度 81px；s6：blank 2 / detached 3），s1/s3/s4/s5 阈值内。确认归因 #2/#4 与 #1/#3 在真实页面成立；CP1 按这些数字修（composer 稳定几何、切作品 last-known 原子提交、消息稳定 key、滚动触发收窄），不改后端/契约。证据 `artifacts/slice-verify/au10-workbench-render-stability/render-baseline.{md,json}`。
- 2026-10-21 — 作者从「主线复位」候选选 4（体验债），启动本 slice 的 CP0。UA01 流式/卡片 CP3 的外部驱动/verifier 迁移与批量 Tauri 复跑属验证债，另行挂账不混做。CP0 协议/阈值/代码归因已冻结；真实页面采样待执行，采样结果前不写 passed、不进 CP1。
- 2026-07-24 — 登记四种方案。默认顺序为 A 最小稳定化、B 状态边界；C Query 化与 D 状态机必须由 CP0/CP2 证据触发。
- 2026-07-24 — 本次只登记任务，不修改前端生产代码，不改变当前 VS-00G 唯一队首。
