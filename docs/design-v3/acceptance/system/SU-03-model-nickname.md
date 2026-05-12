# SU-03 给模型起名

> 系统用户视角：我可以给 AI 助手起一个显示名，让对话更像与固定创作搭档协作。这个名字只影响界面展示，不影响 LLM provider、消息 role、TurnResult 契约或 AI 行为能力。
>
> 2026-05-12 对账结论：当前只有硬编码默认显示 `"AI"`，未发现设置入口、状态字段、持久化或按作品隔离实现。不能把硬编码默认值误判为“已支持给模型起名”。

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
| `frontend/src/lib/store.ts` `AppState` / `SystemContext` | 未来承载当前作品的 AI 显示名或显示名偏好 | 当前没有 `aiDisplayName` / `assistantName` 类字段 |
| `WorkspaceChat.tsx` 消息列表 | 工作台主对话中 assistant label 展示 | 当前多处硬编码 `"AI"` |
| `WorkbenchV3.tsx` 消息列表 | v3 工作台消息中 assistant label 展示 | 当前硬编码 `"AI"` |
| `role: "assistant"` / TurnResult `assistant_message` | 后端和前端识别 AI 消息的 canonical 角色与内容 | 不应被显示名功能修改 |
| `WorkService` / Work 上下文 | 若按作品隔离，需要绑定到 Work 维度或 Work 偏好表 | 当前未发现相关字段或 API |

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

**当前证据**：`WorkspaceChat.tsx` 和 `WorkbenchV3.tsx` 中存在硬编码 `"AI"`；无统一 display name helper。

**当前状态**：部分具备。默认视觉占位存在，但实现方式是硬编码。

---

#### SC-SU03-A2 — 所有 AI 展示面统一使用显示名

**作为系统用户**，无论 AI 消息出现在主工作台、v3 工作台、思考态还是历史消息中，都使用同一个显示名。

**前置条件**：当前作品已有 AI 显示名，例如“创作助手”。

**触发**：查看历史消息、发送新消息、等待 AI 回复、进入 v3 工作台。

**期望结果**：
- 所有 assistant 消息 label 显示为“创作助手”；
- 历史消息无需改写 role，也能按当前显示名渲染；
- 新增 UI 入口不能遗漏某个消息面板；
- “你”这类 user label 不受影响。

**当前证据**：`WorkbenchV3.tsx` 和 `WorkspaceChat.tsx` 各自硬编码 label；没有共享状态或统一渲染函数。

**当前状态**：未实现。

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

**当前证据**：未发现设置入口、保存 API、store 字段或持久化字段。

**当前状态**：未实现。

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

**当前证据**：未发现显示名字段或校验逻辑。

**当前状态**：未实现。

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

**当前证据**：SU-02 运行时作品切换尚未闭环；Work schema/API 中未发现 AI 显示名偏好字段。

**当前状态**：未实现。

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

**当前证据**：当前无改名功能，因此也无“不影响行为”的验收；现有后端契约使用 `assistant_message` 和 role `assistant`。

**当前状态**：未实现验收。

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 当前状态 | 是否闭环 |
|---|---|---|---|
| SC-SU03-A1 | 默认显示名 | 部分具备：硬编码默认 `"AI"` | 否 |
| SC-SU03-A2 | 所有 AI 展示面统一使用显示名 | 未实现 | 否 |
| SC-SU03-B1 | 设置显示名并即时生效 | 未实现 | 否 |
| SC-SU03-B2 | 名称校验、空白回退和重置默认 | 未实现 | 否 |
| SC-SU03-C1 | 按作品隔离显示名 | 未实现 | 否 |
| SC-SU03-C2 | 只影响 UI，不影响 LLM 请求和 TurnResult | 未实现验收 | 否 |

**覆盖结论：6 个场景；0/6 已验收；1/6 仅有硬编码默认值；5/6 未实现或未验收。**

---

## 6. 缺口

| 缺口 | 影响 | 建议处理 |
|---|---|---|
| SU03-GAP-01 — 显示名状态字段缺失 | 无法从硬编码 `"AI"` 变成可配置展示偏好 | P2：增加 UI 层显示名状态或 Work 偏好读取模型 |
| SU03-GAP-02 — 设置入口缺失 | 用户无法修改 AI 名字 | P2：在设置面板或作品偏好入口补 UI |
| SU03-GAP-03 — 持久化与按作品隔离缺失 | 切换作品无法拥有不同 AI 名字 | P2：定义 Work-scoped preference 存储，不污染 provider/model 配置 |
| SU03-GAP-04 — 展示面硬编码散落 | 即使加字段也容易遗漏某个消息面板 | P2：抽统一 `assistantDisplayName` selector/helper |
| SU03-GAP-05 — 行为边界缺验收 | 改名功能可能误改 prompt、role 或 trace 识别 | P2：补“只影响 UI”的测试或 walkthrough |

---

## 7. 现有需改动的位置

| 位置 | 当前 | 目标 |
|---|---|---|
| `frontend/src/lib/store.ts` | 无显示名字段 | 增加按当前作品读取的 assistant display name，或通过 Work preference 注入 |
| `frontend/src/components/WorkspaceChat.tsx` | 多处 `"AI"` 硬编码 | 统一使用 `assistantDisplayName || "AI"` |
| `frontend/src/components/WorkbenchV3.tsx` | assistant label 硬编码 `"AI"` | 统一使用 `assistantDisplayName || "AI"` |
| Work preference/API | 未发现相关字段 | 若要求跨重启/按作品隔离，需要持久化契约 |
| 测试 | 未发现显示名测试 | 补默认值、校验、按作品隔离、仅 UI 展示测试 |

---

## 8. 验收命令

```bash
# 当前无独立自动化验收。未来最小验证建议：
cd frontend && pnpm test -- assistant-display-name

# 若引入后端/持久化 Work preference：
mix test apps/novel_application/test/novel_application/work_service_test.exs
mix test apps/novel_web/test/novel_web/controllers/works_controller_test.exs
```

> 注意：SU-03 是体验增强项，不阻塞当前主链；实现时必须避免把显示名混入 provider/model 配置或 LLM prompt 语义。
