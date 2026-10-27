# B55：风格对象与真实消费（触发后设计）

- 状态：**deferred（等真实风格编辑/版本消费者触发；不以固定 packet 先行）**。
- 登记日期：2026-10-27；来源：CA02 仍主要只有 STYLE_RULE/AUTHOR_PREFERENCE 记忆注入，`style_sample/writing_preferences/brief/feedback_patch` 的对象与版本消费未形成闭环。
- 上游：[CA02-writing-facts-context](CA02-writing-facts-context.md)、`docs/design/domain/23-style-and-author-intent.md`、[B39](B39-evidence-seeking-authoring.md)。

## 1. 问题

当前 L4 已有最小风格记忆与规则注入，但这不等于风格对象体系完成：

- `style_sample`、`writing_preferences`、`brief`、`feedback_patch` 的对象、来源、版本和实际编辑/召回消费者仍需定形；
- 继续增加固定携带只能证明 APP 搬了更多文字，不能证明模型在需要时能查到正确风格证据；
- 同时也不能以“按需求证”为名将所有风格材料删掉：作者当前 brief 和明确写作约束属于不可猜测的 Base。

本任务只在真实消费者出现时拆分对象与消费，不把旧“对象化全部”当目标。

## 2. 启动条件与开工七问

### 启动条件

- 出现真实风格编辑、版本比较、作者修正或恢复需求；
- 明确哪个对象需要独立生命周期、为什么现有 memory/brief 不足；
- 具备 B39 的探索与证据回流，或先证明简单读取已足够。

### 七问

1. **Contract**：23 的风格对象、来源/版本、CA02 当前 STYLE_RULE/AUTHOR_PREFERENCE、B39 Base/Requested Observation 与作者当前 brief 边界。
2. **Invariant**：作者当前 brief 不被旧样本覆盖；风格对象有真实编辑/版本/召回消费者；tentative 不静默入 canon；新对象不是为固定 packet 而建。
3. **Boundary**：优先既有 memory/brief/source/version 与 application 读模型；persistence 仅在现有实体无法承载时论证；web/frontend 复用作者编辑与 why；不新建平行风格系统。
4. **Consumer**：风格编辑/修订、写作/规划模型、恢复与 why。
5. **Proof**：真实编辑→版本→后续真实请求或按需观察；旧版不覆盖当前 brief；样本/偏好/补丁按需要可读取并给出来源；无真实消费者不建对象。
6. **Acceptance Driver**：真实 Tauri 风格编辑、写作/恢复、版本对照与 why；产品验收感知逻辑 **no**。
7. **Exploration**：风格材料可从通用探索/引用读取，区分 Base 的作者意图与按需求取的作品知识，不新增固定携带段。

## 3. 预计 Checkpoint（触发后细化）

| CP | 范围 | 状态 |
|---|---|---|
| CP0 | 真实消费者与对象边界：sample/preferences/brief/feedback_patch 哪些需要独立对象，哪些继续走 memory/brief | deferred |
| CP1 | 最小对象/版本/来源与采纳链，作者当前 brief 优先级和编辑语义 | deferred |
| CP2 | 写作/规划按需读取与真实请求，恢复/why 与版本失效；不新增固定 packet | deferred |
| CP3 | 真实编辑、写作、恢复矩阵与旧文案清理；评估是否需要独立质量/风格评估 | deferred |

## 4. 非目标

- 不为“对象化全部”建表，不新增固定风格 packet 代替可探索读取。
- 不把所有风格材料都移到 on-demand：作者当前 brief 和明确约束仍是 Base。
- 不把 STYLE_RULE/AUTHOR_PREFERENCE 的存在当成完整风格对象闭环，也不把它当无价值旧方案直接删除。
- 不用文学评价或 I10 代替对象与版本验收。

## 5. 验证与恢复

- 只有真实风格编辑/版本消费者出现才启动；无消费者保持 deferred。
- 启动后须证明对象被真实编辑、召回或版本消费，而非只存在于 schema/prompt。
- 恢复时先读 23、CA02、B39 与当前 brief 边界；若现有 memory/brief 已足够，不新增对象。
