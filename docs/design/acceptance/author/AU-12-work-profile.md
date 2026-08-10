# AU-12 查看与核对我的作品档案

> 作者视角：我和 AI 立项时定下了题材、核心卖点、目标读者、基调，后续讨论里 AI 一直按这些设定写。我需要一个地方把这份**作品立项档案**翻出来核对——AI 到底在按什么设定写、这些设定有没有过时——而不是只能从对话记录里回忆。作品档案是我核对"AI 依据的作品事实"的地方，只读展示权威设定，想改时把修订意图交回工作台对话流，不直接越过 Agent 改库。

> 2026-06-17 新立 AU 对账结论：作品档案面板（`StructurePanel.tsx`）已有 `outline / character / foreshadowing / rule` 四个 tab（对应设计 43 §5②③④⑧），但设计 43 §5①「Work 概览（立项设定、主题、大纲）」**无查看入口**；而立项字段（题材/核心卖点/目标读者/基调）已落 `works` 表并已通过 `WorkspaceContext.work_snapshot/1` 喂进 Planner/创作 prompt，即 AI 正用一份作者在 UI 看不到的立项档案。AU-12 把这份已存在、已被消费的立项事实补成作者可核对的只读视图。
>
> 2026-06-17 CP1 闭环结论：`AU12-work-profile-overview` 已补作品档案「概览」只读视图，真实 Tauri 工作台可打开当前作品档案并显示 works 立项字段，证据 `artifacts/slice-verify/au12-work-profile-overview-tauri/summary.json`。这只关闭 CP1；accepted-artifact 类立项要素、缺字段/失败矩阵、跨作品切换矩阵和 correction 修订入口仍是后续 checkpoint。
>
> 2026-06-21 文件级收口结论：`AU12-work-profile-status-isolation` 已补真实 Tauri / quality acceptance，覆盖 accepted/tentative 状态可辨、空字段诚实显示、概览/大纲/角色/伏笔/经验规则 tab 导航、跨作品概览与档案事实隔离、档案查看 no-write 计数和内部 Work UUID 脱敏。当前 AU-12 口径为 `8/11` 已验收、`1/11` 已测试、`1/11` 部分实现、`1/11` 未实现；P0 已关闭，可进入 E2E-01。剩余 P1 是读取失败时的诚实降级矩阵和 `SC-AU12-C2` correction 修订意图；更丰富的 accepted-artifact / 立项要素字段扩展登记为 P2，不阻塞当前文件退出。
>
> 2026-06-22 二轮缺口收敛结论：不回退 2026-06-21 文件级可交付判断。`au12-work-profile-overview` 与 `au12-work-profile-status-isolation` 已串行复跑通过；未发现需要在 AU-12 当时先改生产代码才能继续 E2E-01 的新增 P0/P1。当时剩余 P1 仍是读取失败诚实降级矩阵和 correction 修订意图；A2 同轮 provider prompt 字节级 proof 与更丰富 accepted-artifact / 立项要素扩展继续作为 P2 或后续深化。
>
> 2026-06-22 二轮依赖收敛补充：`au12-correction-intent-roundtrip` 已补真实 Tauri / quality acceptance。作者从作品档案「概览」点击「提出立项修订」后，真实工作台发送 `generate_micro_plan=true` 的 user_message，Planner / MicroPlan / Orchestrator 允许 `world_building`，TurnResult 产生 pending `world_setting` 和保存/修改/放弃动作；作者选择前无 `author_action`、无 adoption evaluation、无 production write。AU-12 当时口径调整为 `9/11` 已验收、`1/11` 已测试、`1/11` 部分实现；剩余 P1 只保留读取失败诚实降级矩阵。accepted `world_setting` 是否进一步物化回 works 立项字段另需 contract，登记为 P2，不在本 checkpoint 中伪关闭。
>
> 2026-06-22 二轮依赖收敛补充：`au12-profile-read-failure-degrade` 已补真实 Tauri / quality acceptance。外部 driver 停止 slice Phoenix 服务后，真实作品档案「概览」显示「作品档案读取失败」与「重试读取」，不显示 `状态未明` 或空字段行；服务恢复后点击可见重试动作，`get_work_profile` 重新读出真实 works 立项字段。失败和重试期间无 `user_message`、无 `author_action`、无 adoption/tool/write。AU-12 当前口径调整为 `10/11` 已验收、`1/11` 已测试；P1 已关闭，剩余为 A2 同轮 provider prompt proof、accepted `world_setting` 物化 works 字段和更丰富立项要素扩展等 P2。
>
> **与 AU-09 边界**：AU-09（管理故事设定）负责**故事记忆类**事实——角色卡、世界规则、伏笔、记忆状态机/有效期/采纳入记忆。AU-12 负责**作品立项与档案视图**——works 表立项字段、作品档案面板的概览/导航/状态辨识、以及从档案发起修订意图。两者不重叠：故事设定的对象语义归 AU-09，作品立项元数据与档案查看面归 AU-12。角色 tab 的角色对象 roundtrip（创建→采纳→Character 主档案→展示→上下文）由 AU-09 的 `tasks/slices/AU09-character-dossier-roundtrip.md` 收口，AU-12 只作显示面。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|---|---|
| 在工作台呼出作品档案，点「概览」 | 看到当前作品的立项设定：题材、核心卖点、目标读者、基调、修订号 |
| 核对 AI 依据的作品事实 | 档案显示的立项字段与 AI prompt 用的是同一事实源，不是另一份拷贝或前端加工值 |
| 看到尚未确认的立项 | 区分 tentative（待确认）与 accepted（已确认）状态，不把未确认立项当成既定事实 |
| 看到空字段 | 立项字段缺失时明确显示「暂未填写」，不编造、不留空白歧义 |
| 在档案各模块间导航 | 概览 / 大纲与结构 / 角色 / 伏笔 / 经验规则之间切换，按当前 work_id 隔离 |
| 想修改立项设定 | 从档案发起 correction（修订）意图，抛回工作台对话流由 Agent 处理，重新过采纳边界 |
| 返回工作台 | 回到对话，作品上下文与会话输入不丢失 |

明确不能做的：

- 作品档案不能直接编辑、直接写库；任何修改必须经 correction/adoption intent 回到对话流。
- 不同作品的立项档案、结构、角色、伏笔不能串数据。
- 档案不得暴露内部主键 UUID，也不得把 mock 当真实作品事实。
- 档案不是巨型表单：用于阅读、导航、发起意图，不平铺所有字段做一次性表单（设计 43 §3）。

---

## 2. 不变量

| 不变量 | 含义 | 场景 |
|---|---|---|
| AU12-I1 | 档案显示的作品立项字段与 `works` 权威值单一事实源（字节相等），不前端二次加工/硬编码；题材/卖点/目标读者/基调与 prompt 用的 work_snapshot 同源同口径，档案额外显示 status/revision/updated_at 作为只读状态信息 | SC-AU12-A1/A2 |
| AU12-I2 | 作品档案只读，不产生 production write，不绕过采纳边界 | SC-AU12-C1 |
| AU12-I3 | 档案与业务日志都不泄漏内部主键 UUID | SC-AU12-A3 |
| AU12-I4 | 立项字段与档案各模块按当前 work_id 隔离 | SC-AU12-B2 |
| AU12-I5 | tentative / accepted 状态可辨，不把未确认立项显示为既定事实 | SC-AU12-A4 |
| AU12-I6 | 缺字段或读取失败必须诚实显示，不编造、不静默空白 | SC-AU12-B3 |
| AU12-I7 | 修改立项只经 correction intent 回对话流，不绕过 Agent 直接写库 | SC-AU12-C2 |
| AU12-I8 | 角色身份归并只能由作者裁决发起（禁止按 name 静默合并）；被并入行 SUPERSEDED 隐藏、弧光账归一无悬空引用、归并零正文/记忆写入 | SC-AU12-E1 |

---

## 3. 契约引用

| 契约 | 用途 |
|---|---|
| `docs/design/ui/43-structure-panel.md` §5①/§4.1/§3/§4 | 作品档案面板心智、Work 概览模块、只读 + 发起意图边界、L1 概览、L1–L4 渐进披露层级 |
| `docs/design/domain/34-novel-element-field-priority.md` | 详情字段优先级过滤 |
| `apps/novel_persistence/lib/novel_persistence/schemas/work.ex` | 立项字段 SSOT（title/genre/core_selling_point/target_reader/tone_preference/status/revision） |
| `apps/novel_persistence/lib/novel_persistence/workspace_context.ex` `work_snapshot/1` | 立项字段进 prompt 的同源读模型（档案 creative fields 与其同源同口径） |
| `apps/novel_application/lib/novel_application/work_archive_service.ex` | 档案只读服务（stats/characters/foreshadowing/rules，新增 profile） |
| `apps/novel_web/lib/novel_web/channels/workspace_channel.ex` `get_work_*` | 档案只读 channel 形态 |
| `docs/design/domain/24-novel-intent-catalog.md` correction / CREATE_WORK_SEED | 立项修订意图入口（编辑 checkpoint） |

---

## 4. 验收场景

### 场景组 A：立项档案查看（works 表立项字段）

- **SC-AU12-A1**：真实工作台打开作品档案、点「概览」，看到题材/核心卖点/目标读者/基调/修订号渲染。
- **SC-AU12-A2**：档案显示的立项字段与 `works` 表 authoritative 值字节一致，且与同轮 prompt 的 work_snapshot 同源。
- **SC-AU12-A3**：档案与业务日志不出现内部 Work UUID。
- **SC-AU12-A4**：tentative 立项显示「待确认」标识，accepted 显示为已确认事实，二者可辨。

### 场景组 B：档案导航与作品隔离

- **SC-AU12-B1**：概览 / 大纲与结构 / 角色 / 伏笔 / 经验规则之间可切换导航。
- **SC-AU12-B2**：切换作品后，立项字段与各模块按新 work_id 隔离，不显示其它作品数据。
- **SC-AU12-B3**：立项字段缺失时显示「暂未填写」，读取失败时诚实降级，不编造。

### 场景组 C：只读边界与修订意图

- **SC-AU12-C1**：在档案查看不产生任何 production write（无 adoption/无库写）。
- **SC-AU12-C2**：作者在档案点「修订」→ 发起 correction intent 抛回对话流，由 Agent 处理并重新过采纳边界，不直接写 works 表（编辑 checkpoint）。

### 场景组 E：角色身份归并（AU12 slice CP1，2026-08-10）

- **SC-AU12-E1**：档案里同名双行（m4b 存量重复标本）+ 别名行，作者从角色详情发起
  「并入其他角色…」两次裁决归并 → 档案收拢为单行且别名可见 → 脉络角色弧光归一为
  单条 → 归并阶段零 adoption/正文/记忆写入 → 盘点把归并产生的别名当新人物重提，
  采纳被**别名命中确认卡**拦住并点名「『洛公子』是已确认角色『沈洛』的已登记别名」
  → 作者拒绝后档案不变、全场景零 accepted 采纳。已挂真实 Tauri / quality
  acceptance：`au12-character-identity-merge`（设计 43 §5.0.2；slice
  `tasks/slices/AU12-character-identity-merge.md`）。

### 场景组 D：真实入口与自动化

- **SC-AU12-D1**：作者能在真实工作台发现并打开作品档案概览入口。
- **SC-AU12-D2**：外部自动化（Tauri driver）像作者一样操作真实页面完成上述场景，产品代码不读 slice id/env/query/localStorage。

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 当前状态 | 是否闭环 |
|---|---|---|---|
| SC-AU12-A1 | 概览看立项设定 | 已验收：`au12-work-profile-overview` 从真实工作台打开作品档案「概览」，显示题材/核心卖点/目标读者/基调/修订号 | 是 |
| SC-AU12-A2 | 与 works/prompt 同源一致 | 已测试：真实页面证明 profile DTO 字段来自 `works` 立项字段；prompt 同源由 `WorkspaceContext.work_snapshot/1` 字段口径和 `WorkArchiveService.profile/1` 同源实现/测试约束，缺同轮 provider prompt 外部证据 | 部分 |
| SC-AU12-A3 | 不泄漏 UUID | 已验收：两个 Tauri driver 均证明 profile DTO、UI 片段和 `channel.get_work_profile.done` 业务日志不含内部 Work UUID | 是 |
| SC-AU12-A4 | tentative/accepted 可辨 | 已验收：`au12-work-profile-status-isolation` 同时验证 accepted 作品显示「已确认」、空字段作品显示「待确认」 | 是 |
| SC-AU12-B1 | 档案模块导航 | 已验收：真实工作台从作品档案切换「概览 / 大纲与结构 / 角色 / 伏笔 / 经验规则」五个 tab | 是 |
| SC-AU12-B2 | 作品隔离 | 已验收：真实工作台从 accepted 作品切换到空字段作品后，概览字段、角色、伏笔和规则均不显示另一作品数据 | 是 |
| SC-AU12-B3 | 空字段/失败诚实显示 | 已验收：`au12-work-profile-status-isolation` 验证空字段「暂未填写」；`au12-profile-read-failure-degrade` 证明读取失败显示诚实错误态、隐藏空档案字段、可重试恢复且 no-write | 是 |
| SC-AU12-C1 | 档案只读 no-write | 已验收：`au12-work-profile-status-isolation` 统计档案查看期间无 `user_message` / `author_action` / adoption / tool / write 事件 | 是 |
| SC-AU12-C2 | 修订走 correction intent | 已验收：`au12-correction-intent-roundtrip` 从真实档案概览点击「提出立项修订」，回到对话主链并生成 pending `world_setting`，作者选择前无直接写入 | 是 |
| SC-AU12-D1 | 作者可发现入口 | 已验收：真实工作台可从作品档案入口进入「概览」并切换各档案模块 | 是 |
| SC-AU12-D2 | 外部自动化验收 | 已验收：`au12-work-profile-overview`、`au12-work-profile-status-isolation`、`au12-correction-intent-roundtrip` 与 `au12-profile-read-failure-degrade` 均已挂入 Tauri driver / quality acceptance | 是 |

2026-06-22 二轮判断：`SC-AU12-C2` 已由 `au12-correction-intent-roundtrip` 关闭，`SC-AU12-B3` 读取失败诚实降级已由 `au12-profile-read-failure-degrade` 关闭。当前 AU-12 无剩余 P1；A2 同轮 provider prompt proof、accepted `world_setting` 物化 works 字段和更丰富立项要素扩展为 P2 后续。

---

## 6. 落地路线

已闭环 checkpoint：

- `tasks/slices/AU12-work-profile-overview.md`：CP1 立项档案只读概览，证明 works 立项字段可从真实工作台核对且不泄漏内部 Work UUID。
- `tasks/slices/AU12-work-profile-status-isolation.md`：补 accepted/tentative 状态、空字段、tab 导航、跨作品隔离和只读 no-write 的真实页面矩阵。
- `tasks/slices/AU12-correction-intent-roundtrip.md`：补作品档案「提出立项修订」入口回到对话主链和 pending adoption 边界的真实页面矩阵。
- `tasks/slices/AU12-profile-read-failure-degrade.md`：补作品档案读取失败诚实错误态、重试恢复和 no-write 的真实页面矩阵。
- `tasks/slices/AU12-file-level-closure.md`：记录文件级对账、剩余 P1/P2 和退出结论。

后续 checkpoint：

- P2：accepted `world_setting` 进一步物化回 works 立项字段时，需要另立 contract 和采纳后回写验收。
- P2：纳入更丰富的 world_setting/protagonist 等来自**采纳产物**的立项要素，继续保持与 AU-09 故事记忆边界互斥。

2026-06-22 二轮判断：correction 修订意图与读取失败降级均已补真实页面链路。A2 的同轮 provider prompt proof 仍是加强项，不影响当前作品档案查看面的 P0/P1 退出。

## 7. 已知限制

- 当前 AU-12 的 profile overview/status/isolation 仍是 no-turn read-model / UI 验收；correction intent checkpoint 会进入对话主链，但使用 slice_verify provider，不声称 live vendor prompt proof。
- accepted `world_setting` 回写 works 立项字段、完整 8 模块档案扩展未闭环；这些登记为 P2 后续。
- 当前文件级可交付只表示 P0 已关闭、作者可核对 AI 正在消费的作品立项事实；不能声称作品档案编辑能力完成。

## 8. 验收命令

```bash
mix test apps/novel_application/test/novel_application/work_archive_service_test.exs apps/novel_web/test/novel_web/channels/workspace_channel_work_profile_test.exs
pnpm --dir frontend test -- native-tauri-verifier.test.mjs socket.test.ts structure_panel.test.ts
bash scripts/tauri_slice_verify.sh au12-work-profile-overview
bash scripts/tauri_slice_verify.sh au12-work-profile-status-isolation
bash scripts/tauri_slice_verify.sh au12-correction-intent-roundtrip
bash scripts/tauri_slice_verify.sh au12-profile-read-failure-degrade
bash scripts/quality_accept.sh au12-work-profile-overview --surface tauri
bash scripts/quality_accept.sh au12-work-profile-status-isolation --surface tauri
bash scripts/quality_accept.sh au12-correction-intent-roundtrip --surface tauri
bash scripts/quality_accept.sh au12-profile-read-failure-degrade --surface tauri
```
