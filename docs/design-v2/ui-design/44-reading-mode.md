# 44 Reading Mode

> 状态：草案
>
> 角色：定义与创作环境分离的纯净阅读体验模式。

---

## 1. 语义来源

本文所定义的阅读模式原则投影自：

- `../27-reading-projection.md`：阅读投影的生成规则。
- `../adr/0009-projection-object-schema.md`：阅读投影对象字段。
- `../adr/0011-projection-refresh-state-triggers.md`：投影刷新四态模型。

---

## 2. 不负责范围

- 不参与 Authoritative 状态的修改。
- 不负责暂态草稿（Tentative Artifact）的常规展示。
- 不定义具体字体排版与段落间距等视觉细节。

---

## 3. 核心原则：阅读独立于创作

Reading Mode 必须是一个干净的“成品”消费面，给作者提供如读者般的审视视角。
- **分离入口**：从 Workbench（工作台）的主菜单或目录树进入，全屏或大区域展示。
- **消费对象严格限制**：默认**只消费** `accepted` 的投影结果。即：
  - `reading_projection_root`
  - `reading_projection_toc`
  - `reading_projection_chapter`
  - `reader_recap`

默认**不消费**（并且严禁混入）：
- Tentative artifact (暂态稿件)
- Debug trace
- Provider raw output
- 未采纳的 Maintenance artifact
- 未采纳的 Experience artifact

---

## 4. Projection Status 的显式表达 (ADR-0011)

由于阅读模式本质是展示底层数据的“投影 (Projection)”，该投影可能因底层数据被修改而失准。UI 必须明确展示当前阅读内容的投影状态（四态）：

1. **`FRESH`（最新）**：当前展示的内容与底层权威状态完全一致。UI 可不加干扰正常显示。
2. **`STALE`（过期）**：底层数据已有变更，但当前投影尚未重新生成。
   - **UI 必须**：保留阅读界面（过期不代表崩溃，内容依然可读），但需在醒目位置（如顶部 Banner 或浮层）提示作者“内容已不是最新”，并提供“刷新投影”或“进入更新流”的入口。
3. **`REBUILDING`（重建中）**：后台正在重新生成新的投影。
   - **UI 必须**：显示正在生成的 Loading/Progress 状态，可保留原 STALE 内容供阅读，或置灰展示。
4. **`FAILED`（失败）**：投影生成发生致命错误。
   - **UI 必须**：展示错误提示及重试（Retry）按钮，此时无法提供有效的阅读内容。

---

## 5. Tentative Preview 的隔离

在极少数场景下，作者可能需要“预览”尚未采纳的草稿在阅读器里的效果。
- 必须设立显式的预览通道（Preview Path）。
- 例如以 `[预览模式：未保存的修改]` 的明确标识出现。
- 绝不允许将 Tentative 内容默认混入正规的 Reading Mode。如果当前暂无 Contract 支持安全预览，该功能在 UI 阶段直接标为 Deferred，不得用假数据绘制完整交互闭环。

---

## 6. 验收标准约束

1. 必须默认只消费 accepted / authoritative source。
2. 必须明确使用并展现 ADR-0011 规定的 `FRESH` / `STALE` / `REBUILDING` / `FAILED` 四个状态。
3. 必须合理解释 STALE（旧投影可读，但需提示）。
4. Tentative preview 若有必须显式分离，如无 contract 来源不画交互。
