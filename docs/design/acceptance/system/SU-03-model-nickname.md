# SU-03 给模型起名

> 系统用户视角：我可以给 AI 助手起一个显示名，让对话更像与固定创作搭档协作。这个名字只影响界面展示，不影响 LLM provider、消息 role、TurnResult 契约或 AI 行为能力。
>
> 2026-05-19 对账结论：最小真实前端闭环已补齐。`WorkspaceChat` 提供 work-scoped AI 显示名设置入口，Tauri 桌面偏好持久化到 app config `preferences.json`，不同作品互相隔离；消息流、欢迎消息、历史 transcript 和思考态统一消费显示名 helper。该能力只影响 UI label，不改变 provider、prompt、role 或 TurnResult。历史旁路 `历史旁路工作台` 已退役删除，不再作为当前展示面。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|---|---|
| 看到默认 AI 显示名 | 未设置时，AI 消息发送者显示为“AI” |
| 修改 AI 显示名 | 对话区、思考态和工作台中所有 AI 发送者展示同步更新 |
| 清空或重置显示名 | 空白/纯空格回退到默认“AI”，也可显式重置默认 |
| 不同作品使用不同 AI 名字 | 切换作品时显示名跟随作品切换 |
| 改名不影响 AI 行为 | LLM 请求、`role: "assistant"`、TurnResult 结构不变 |

---

## 2. 不变量

| 编号 | 不变量 | 本验收如何验证 |
|---|---|---|
| SU03-I1 | AI 显示名是 UI 层展示偏好，不得改变 LLM provider、prompt 行为或 TurnResult 契约 | SC-SU03-C2 |
| SU03-I2 | AI 消息的 canonical role 仍是 `assistant`，显示名只是 label | SC-SU03-A2、SC-SU03-C2 |
| SU03-I3 | 显示名按作品隔离，不能跨作品污染 | SC-SU03-C1 |
| SU03-I4 | 默认值稳定：未设置、空白、异常值均回退为“AI” | SC-SU03-A1、SC-SU03-B2 |

---

## 3. 契约引用

| 契约 / 实现 | 用途 | 当前证据判断 |
|---|---|---|
| `frontend/src/lib/store.ts` `AppState` / `SystemContext` | 承载当前作品的 AI 显示名 | 已新增 `assistantDisplayName` |
| `frontend/src/lib/assistantDisplayName.ts` | 显示名归一、默认值、按作品偏好读写、role label helper | 已新增；空白回退默认 `AI`，最长 20 个可见字符 |
| `frontend/src-tauri/src/lib.rs` preferences command | Tauri 桌面 work-scoped 显示名持久化 | 已新增 `assistant_display_names` map |
| `WorkspaceChat.tsx` 消息列表 | 工作台主对话中 assistant label 展示 | 已统一使用 `assistantRoleLabel`，并提供设置入口 |
| `role: "assistant"` / TurnResult `assistant_message` | 后端和前端识别 AI 消息的 canonical 角色与内容 | 不应被显示名功能修改 |
| `WorkService` / Work 上下文 | 显示名按 Work 维度隔离 | 当前不写后端 Work schema，保持 UI-only preference 边界 |

---

## 4. 验收场景

### 场景组 A：默认展示一致性

#### SC-SU03-A1 — 默认显示名

**作为系统用户**，我从未设置过 AI 名字时，对话里仍能看到稳定的默认发送者名称。

**前置条件**：新安装或当前作品没有 AI 显示名配置。

**触发**：打开工作台并看到 AI 欢迎消息、普通回复或思考态。

**期望结果**：
- AI 消息发送者显示为“AI”；
- loading / thinking 状态也显示为“AI”；
- 不出现空 label、`assistant`、provider 名或模型 id；
- 默认名来自统一展示逻辑，而不是散落硬编码。

**当前证据**：`frontend/src/lib/assistantDisplayName.ts` 提供默认值与统一 label helper；`WorkspaceChat.tsx` 消息 label 不再硬编码 `"AI"`；`bash scripts/tauri_slice_verify.sh su03-assistant-display-name` 覆盖真实工作台默认/切换路径。

**当前状态**：已实现并通过最小真实前端验收。

---

#### SC-SU03-A2 — 所有 AI 展示面统一使用显示名

**作为系统用户**，无论 AI 消息出现在主工作台、思考态还是历史消息中，都使用同一个显示名。

**前置条件**：当前作品已有 AI 显示名，例如“创作助手”。

**触发**：查看历史消息、发送新消息、等待 AI 回复。

**期望结果**：
- 所有 assistant 消息 label 显示为“创作助手”；
- 历史消息无需改写 role，也能按当前显示名渲染；
- 新增 UI 入口不能遗漏某个消息面板；
- “你”这类 user label 不受影响。

**当前证据**：`assistantRoleLabel(role, assistantDisplayName)` 被 `WorkspaceChat.tsx` 消费；`WorkspaceChat` 的欢迎消息、历史 transcript、新消息和 thinking 状态按当前显示名渲染。

**当前状态**：已实现并通过最小真实前端验收。

---

### 场景组 B：设置与校验

#### SC-SU03-B1 — 设置显示名并即时生效

**作为系统用户**，我把 AI 显示名从“AI”改成“创作助手”，界面立即更新。

**前置条件**：当前处于某个作品。

**触发**：在设置面板或作品偏好入口输入“创作助手”并保存。

**期望结果**：
- 保存成功后当前工作台的 AI label 立即变为“创作助手”；
- 已有历史 AI 消息也按新显示名渲染；
- 刷新或重启后仍保持；
- 保存失败时展示错误，不产生半更新状态。

**当前证据**：`WorkspaceChat` 顶部 `assistant-name-trigger` 打开 Radix Dialog；保存后立即更新当前工作台 label；Tauri 命令写入 app config preferences；`su03-assistant-display-name` 原生验证覆盖保存和切换后恢复。

**当前状态**：已实现并通过最小真实前端验收。

---

#### SC-SU03-B2 — 名称校验、空白回退和重置默认

**作为系统用户**，我输入空白、过长名称或点击重置时，系统给出可预期结果。

**前置条件**：当前作品可编辑 AI 显示名。

**触发**：输入空白、纯空格、超长字符串，或点击“恢复默认”。

**期望结果**：
- 空白/纯空格保存后回退到“AI”或禁止保存并提示；
- 超长名称被限制或提示，例如 1-20 字符；
- 点击重置后删除当前作品自定义名；
- 校验规则在 UI 和持久化层一致。

**当前证据**：`normalizeAssistantDisplayName/1` 前端 helper 和 Tauri command 均执行 trim、空白重置、20 字符上限；单测覆盖默认、截断、reset。

**当前状态**：已实现并有单测覆盖。

---

### 场景组 C：隔离与行为边界

#### SC-SU03-C1 — 按作品隔离显示名

**作为系统用户**，我在作品 A 中 AI 叫“创作助手”，在作品 B 中 AI 叫“编辑”，切换作品时名字跟随作品变化。

**前置条件**：已有作品 A、B，且各自设置不同 AI 显示名。

**触发**：从 A 切换到 B，再切回 A。

**期望结果**：
- A 中显示“创作助手”；
- B 中显示“编辑”；
- 修改 B 的显示名不影响 A；
- 删除作品或恢复默认时不污染其他作品。

**当前证据**：`assistant_display_names` 以 work_id 为 key 存储；`su03-assistant-display-name` 原生验证在作品 A 保存“创作助手”，创建作品 B 后显示默认 `AI`，再切回 A 恢复“创作助手”。

**当前状态**：已实现并通过最小真实前端验收。

---

#### SC-SU03-C2 — 只影响 UI，不影响 LLM 请求和 TurnResult

**作为系统用户**，我给 AI 改名后，AI 的能力、上下文、provider 请求和后端契约都不被改变。

**前置条件**：当前作品 AI 显示名为“创作助手”。

**触发**：发送普通创作消息，并检查前端渲染、Channel payload、TurnResult 和 LLM 日志。

**期望结果**：
- 前端 label 显示“创作助手”；
- 消息 role 仍是 `assistant`；
- TurnResult 仍使用 `assistant_message`；
- LLM 请求不因显示名自动改写系统提示词或 provider 参数；
- trace / replay 不依赖显示名识别 assistant。

**当前证据**：实现只落在 UI preference/helper 与 Tauri preferences，不改 provider/gateway/planner/TurnResult schema；`su03-assistant-display-name` 验证 DOM `data-role="assistant"` 保持 canonical role，label 显示“创作助手”。未用真实 LLM 请求日志单独证明 prompt/provider payload 不变。

**当前状态**：部分验收。UI/role 边界已验证；真实 LLM payload 不变仍缺独立日志证据。

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 当前状态 | 是否闭环 |
|---|---|---|---|
| SC-SU03-A1 | 默认显示名 | 已实现：统一默认 `AI` helper | 是 |
| SC-SU03-A2 | 所有 AI 展示面统一使用显示名 | 已实现：WorkspaceChat / thinking 统一 helper | 是 |
| SC-SU03-B1 | 设置显示名并即时生效 | 已实现：真实工作台 Dialog 保存后即时更新 | 是 |
| SC-SU03-B2 | 名称校验、空白回退和重置默认 | 已实现：trim、20 字符上限、空白/reset 回默认 | 是 |
| SC-SU03-C1 | 按作品隔离显示名 | 已实现：Tauri/browser work-scoped preference，原生验证覆盖切换 | 是 |
| SC-SU03-C2 | 只影响 UI，不影响 LLM 请求和 TurnResult | 部分验收：canonical role/UI 边界已验证，真实 LLM payload 日志未覆盖 | 部分 |

**覆盖结论：6 个场景；5/6 已通过最小真实前端验收；1/6 部分验收（缺真实 LLM payload 日志证据）。**

---

## 6. 缺口

| 缺口 | 影响 | 建议处理 |
|---|---|---|
| SU03-GAP-01 — 显示名状态字段缺失 | 已解决 | `SystemContext.assistantDisplayName` + `assistantDisplayName.ts` |
| SU03-GAP-02 — 设置入口缺失 | 已解决 | `WorkspaceChat` 顶部 Radix Dialog 设置入口 |
| SU03-GAP-03 — 持久化与按作品隔离缺失 | 已解决 | Tauri/browser work-scoped preference |
| SU03-GAP-04 — 展示面硬编码散落 | 已解决 | `assistantRoleLabel` 统一渲染 |
| SU03-GAP-05 — 行为边界缺验收 | 部分解决 | 已验证 UI label 与 canonical role；仍缺真实 LLM payload 日志证据 |

---

## 7. 现有需改动的位置

| 位置 | 当前 | 目标 |
|---|---|---|
| `frontend/src/lib/store.ts` | 已有 `assistantDisplayName` 字段 | 当前作品运行时展示名 |
| `frontend/src/lib/assistantDisplayName.ts` | 已新增 | 默认值、校验、持久化 helper、role label helper |
| `frontend/src/components/WorkspaceChat.tsx` | 已接入 | 设置入口 + 消息/思考态 label |
| Work preference/API | 已接入 Tauri/browser preference | 不写后端 Work schema，保持 UI-only 边界 |
| 测试 | 已新增 | `assistantDisplayName.test.ts` + `native-tauri-verifier.test.mjs` + 原生 Tauri 验证 |

---

## 8. 验收命令

```bash
pnpm --dir frontend test -- assistantDisplayName
bash scripts/tauri_slice_verify.sh su03-assistant-display-name
```

> 注意：SU-03 是体验增强项，不阻塞当前主链；实现时必须避免把显示名混入 provider/model 配置或 LLM prompt 语义。
