# AU-12 查看与核对我的作品档案

> 作者视角：我和 AI 立项时定下了题材、核心卖点、目标读者、基调，后续讨论里 AI 一直按这些设定写。我需要一个地方把这份**作品立项档案**翻出来核对——AI 到底在按什么设定写、这些设定有没有过时——而不是只能从对话记录里回忆。作品档案是我核对"AI 依据的作品事实"的地方，只读展示权威设定，想改时把修订意图交回工作台对话流，不直接越过 Agent 改库。

> 2026-06-17 新立 AU 对账结论：作品档案面板（`StructurePanel.tsx`）已有 `outline / character / foreshadowing / rule` 四个 tab（对应设计 43 §5②③④⑧），但设计 43 §5①「Work 概览（立项设定、主题、大纲）」**无查看入口**；而立项字段（题材/核心卖点/目标读者/基调）已落 `works` 表并已通过 `WorkspaceContext.work_snapshot/1` 喂进 Planner/创作 prompt，即 AI 正用一份作者在 UI 看不到的立项档案。AU-12 把这份已存在、已被消费的立项事实补成作者可核对的只读视图。
>
> 2026-06-17 CP1 闭环结论：`AU12-work-profile-overview` 已补作品档案「概览」只读视图，真实 Tauri 工作台可打开当前作品档案并显示 works 立项字段，证据 `artifacts/slice-verify/au12-work-profile-overview-tauri/summary.json`。这只关闭 CP1；accepted-artifact 类立项要素、缺字段/失败矩阵、跨作品切换矩阵和 correction 修订入口仍是后续 checkpoint。
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
| 想修改立项设定 | 从档案发起 correction（修订）意图，抛回工作台对话流由 Agent 处理，重新过采纳边界（后续 checkpoint） |
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

### 场景组 D：真实入口与自动化

- **SC-AU12-D1**：作者能在真实工作台发现并打开作品档案概览入口。
- **SC-AU12-D2**：外部自动化（Tauri driver）像作者一样操作真实页面完成上述场景，产品代码不读 slice id/env/query/localStorage。

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 当前状态 | 是否闭环 |
|---|---|---|---|
| SC-AU12-A1 | 概览看立项设定 | CP1 已实现并有真实 Tauri 证据 | 是 |
| SC-AU12-A2 | 与 works/prompt 同源一致 | CP1 已证明 DTO 字段来自 `works` 立项字段；prompt 同源由 `work_snapshot/1` 字段口径约束 | 是 |
| SC-AU12-A3 | 不泄漏 UUID | CP1 已证明 profile DTO、UI 片段和 `channel.get_work_profile.done` 业务日志不含内部 Work UUID | 是 |
| SC-AU12-A4 | tentative/accepted 可辨 | 部分：CP1 真实 Tauri 覆盖 TENTATIVE「待确认」；ACCEPTED 展示路径已实现但缺独立外部矩阵 | 部分 |
| SC-AU12-B1 | 档案模块导航 | 部分：已新增「概览」tab 并保留大纲/角色/伏笔/规则；未做完整 tab 切换矩阵 | 部分 |
| SC-AU12-B2 | 作品隔离 | 部分：Channel 回归证明 join work 优先于 payload work；缺真实 UI 双作品切换矩阵 | 部分 |
| SC-AU12-B3 | 空字段/失败诚实显示 | 部分：前端空字段显示「暂未填写」；读取失败矩阵未验收 | 部分 |
| SC-AU12-C1 | 档案只读 no-write | 部分：CP1 只读 view 不提供写入口，Tauri 断言只读提示；未做 production write 计数矩阵 | 部分 |
| SC-AU12-C2 | 修订走 correction intent | 未实现（编辑 checkpoint） | 否 |
| SC-AU12-D1 | 作者可发现入口 | CP1 已实现：真实工作台打开作品档案后可点「概览」 | 是 |
| SC-AU12-D2 | 外部自动化验收 | CP1 已实现：`bash scripts/tauri_slice_verify.sh au12-work-profile-overview` | 是 |

---

## 6. 落地路线

第一个承重切面：`tasks/slices/AU12-work-profile-overview.md`（CP1 立项档案只读概览）已闭环。用户 2026-06-17 调整任务队列先做 AU12；完成 CP1 后，当前队首回到 `AU10-workbench-recovery-disconnect-timeout`。

后续 checkpoint：

- CP2 纳入 world_setting/protagonist 等来自**采纳产物**的立项要素，继续保持与 AU-09 故事记忆边界互斥。
- CP3 从档案发起 correction 编辑意图（场景组 C），修订必须回到工作台对话流并重新过采纳边界。

## 7. 已知限制

- CP1 是 no-turn read-model / UI 验收，不涉及真实 LLM/provider 调用，也不改变 prompt。
- CP1 只证明 works 表立项字段的只读核对入口；不证明作品档案 8 模块全齐。
- ACCEPTED 状态、缺字段/读取失败、跨作品切换、production write 计数和 correction 编辑仍需后续矩阵补证。

## 8. 验收命令

```bash
mix test apps/novel_application/test/novel_application/work_archive_service_test.exs apps/novel_web/test/novel_web/channels/workspace_channel_work_profile_test.exs
pnpm --dir frontend test -- native-tauri-verifier.test.mjs socket.test.ts structure_panel.test.ts
bash scripts/tauri_slice_verify.sh au12-work-profile-overview
```
