# 43 Structure Panel

> 状态：草案
>
> 角色：定义侧边（或底部）隐藏式结构面板的数据加载、渐进披露层级与交互边界。

---

## 1. 语义来源

结构面板的内容及优先级规则直接投影自：

- `../domain/21-novel-object-model.md`：核心小说对象模型。
- `../domain/22-continuity-model.md`：连贯性模型（Foreshadowing 等）。
- `../domain/34-novel-element-field-priority.md`：元素字段呈现优先级与结构面板 L1-L4 渐进披露。
- `../07-workbench-ui-contract.md` §2 / §8：UI 不直接写 authoritative state；候选、选择和采纳边界由主链裁决。
- `../contracts/VS-04-adoption-boundary-contract-pack.md`：pending / accepted / projection stale 的边界。

---

## 2. 不负责范围

- 不改变任何 Authoritative 数据的读取与写入流程。
- 不负责对未冻结的子类型（如 timeline_event）自造枚举或校验逻辑。

---

## 3. 面板核心心智

- **非默认视觉焦点**：作为对话舱的“副驾面板”或“资料档案柜”，需要时呼出，不需要时安静收起。
- **不是巨型表单**：面板用于阅读、导航和辅助决策，**坚决不能**设计为所有字段平铺开的一次性巨型表单。
- **只读与意图发起**：面板展示的是 Authoritative / Accepted 状态，或 Pending adoption 的状态。当用户想修改时，UI 不应该直接越过 Agent 写数据库，而应通过触发 `correction` / `adoption` / `regeneration` intent 将意图抛给工作台的对话流处理。

---

## 4. 渐进披露层级

结构面板的展开与导航必须遵循以下 L1-L4 层级：

### 4.1 L1 概览 (Overview)
- **UI 呈现**：面板的首页或默认闭合状态下的红点提示。
- **内容**：
  - 当前 Work / Volume / Chapter 的大纲摘要。
  - Long-run 执行情况摘要。
  - 全局风险（Risk / Quality Finding）总数及最高等级摘要。
  - 待采纳（Pending Adoption）产物的计数。

### 4.2 L2 列表 (List/Tree)
- **UI 呈现**：点击某个分类进入的二级目录视图。
- **内容**：
  - Volumes & Chapters 树状结构。
  - Characters (角色简表) 列表。
  - Foreshadowings (伏笔) / Worldrules (世界观设定) 列表。
  - 具体的 Quality Findings 列表。

### 4.3 L3 详情 (Detail)
- **UI 呈现**：选中 L2 中的某项对象后展示的内容卡片。
- **内容**：
  - 单对象的字段内容（遵循 `../domain/34-novel-element-field-priority.md` 过滤显示核心字段）。
  - Source refs、修订版本 (Revision)。
  - 若为暂态，显示 Adoption status。
  - 关联的 Findings / Warnings。

### 4.4 L4 审计与溯源 (Audit / Lineage)
- **UI 呈现**：深层详情下的折叠项或“查看来源”操作。
- **内容**：
  - `source_revision_refs`。
  - Approval records 审计日志。
  - Experience evidence。
  - Debug trace refs（仅限需要深挖时，绝不作为首屏展示）。

---

## 5. 首批支持查看的对象模块

首批结构面板建议提供以下模块的访问入口：
1. **Work 概览**（立项设定、主题、大纲）
2. **Volume / Chapter 树**（卷章目录管理）
3. **Character 简表**（角色卡片）
4. **Foreshadowing 列表**（伏笔追踪）
5. **Timeline / State snapshot**（时间线及快照 —— 暂定为只读或标签展示，不可自造枚举）
6. **Style / Writing preferences**（风格及排版偏好）
7. **Long-run tasks**（长跑任务监控台，如批量推演）
8. **Experience 经验沉淀**（只读证据、待审经验草稿、已启用经验规则）
9. **Ledgers 五本账 → 用户可见名「脉络」**（ADR-0026 / VS-00F 扩员：弧光/冲突/信息/情绪曲线/承诺账的进度态视图与审读报告；只读+修订走 correction intent，遵守本文件 §3/§4/§6 边界；落地排 VS-00F CP4）

### 5.0.1 模块 9「脉络」命名与整合决定（2026-07-21 用户拍板）

内部契约名（LedgerEntry / ledgers / reconciliation_report，`contracts/VS-00F`）不变；用户可见文案按创作语境命名（40 §3.1"内部枚举不暴露"）：

| 内部概念 | 用户可见名 |
|---|---|
| ledgers 模块（tab） | **脉络** |
| 五本账 arc/conflict/promise/information/emotion_curve | 角色弧光 / 主线冲突 / 题材承诺 / 信息与伏笔 / 情绪曲线 |
| reconciliation report / 全量对账 | **审读报告** / **发起全书审读** |
| ON_TRACK / STALLED | 延续中 / 停滞 |
| LEAKED | 提前泄底 |
| BROKEN（承诺） | 失守 |
| ACTIVE / DORMANT | 推进中 / 搁置 |
| MATCHED / DEVIATED / UNPLANNED | 相符 / 偏离 / 计划外 |
| 四处置 revise_design/revise_prose/accept_drift/dismiss | 修订设定 / 修订正文 / 接受走向 / 标记误报 |

`protagonist_undermaterialized` 是 `revise_design` 的**引导物化变体**：卡片不显示泛化的
「修订设定」，而显示主动作 **「发起盘点」**。点击时必须把当前
`report_id + finding_index + finding_rule` 绑定到 `start_fact_inventory`；服务端反查活跃报告
与真实规则、记录既有 `revise_design` 处置后，启动现有 `fact_inventory_v1`。它不是第五种处置，
也不是前端代发一条泛化聊天 prompt。其它三项仍作为次级选择保留。

整合红线（防加法式冗余，2026-07-21 用户原则）：审读摘要行并入**概览** L1（跳转脉络页）；脉络页内"信息与伏笔/角色弧光"只放进度态+跳转，**不复制**伏笔/角色 tab 的对象列表；待处置计数与收起态 rail 的待采纳同一视觉语言；"修订正文"处置复用 revise_from_findings 动作链；"发起全书审读"走各 tab 底部动作条既有范式。另一条同批修复：对话区会话内容限最大列宽（面板收起时不允许左右消息贴满全宽拉开）。

桌面工作台的作品档案收起态 rail 基准宽度为 **128px**，只保留“档案图标 + 档案短标签 + 待采纳数字 badge”；会话历史移到顶栏作品上下文入口，避免把对话历史与作品对象混成同一信息架构。展开面板仍为 **500px**。该宽度不得通过压缩正文阅读行宽获得，1280×800 基准窗口下必须保留主对话区的 880px 操作宽度。

原型：`novel-studio.pen → 43§5-9-threads-panel (uyZGw)`。

2026-06-17 实现状态：`AU12-work-profile-overview` 已补 Work 概览 CP1，只读展示 works 表中的立项字段（题材、核心卖点、目标读者、基调、状态、修订号），证据 `artifacts/slice-verify/au12-work-profile-overview-tauri/summary.json`。主题/大纲整合、采纳产物类立项要素和从概览发起 correction 修订仍属后续 checkpoint。

### 5.1 Experience 模块边界

| 对象 | 面板呈现 | 可操作性 |
| --- | --- | --- |
| `experience_evidence` | 只读证据与来源说明 | 不可直接采纳为长期偏好 |
| `experience_artifact` | 待审经验建议，显示 risk / confidence / source refs | 通过 adoption card 采纳、编辑后采纳或丢弃 |
| `experience_rule` | 已启用 / 已禁用 / 已归档规则列表 | 可发起禁用、归档、supersede 意图；高影响修改需 approval |

Experience 模块不得把 evidence、artifact、rule 混成同一种“偏好”。只有 `experience_rule` 可作为后续上下文候选；evidence / artifact 默认不进入 Executor prompt。

---

## 6. 验收标准约束

1. 字段优先级必须明确引用 `../domain/34-novel-element-field-priority.md`；渐进披露层级见本文 §4。
2. 明确面板的操作边界：只提供查看、跳转、发起意图（correction/adoption），坚决禁止绕过 Agent 直接写权威状态。
3. 视觉上明确区分 authoritative、accepted、tentative、pending adoption 的状态，防误导。
4. 未冻结扩展类型（如 timeline_event 的具体细分类型）只能以纯文本标签/Placeholder 展示，不得自造下拉列表或验证。
