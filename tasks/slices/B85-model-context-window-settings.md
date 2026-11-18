# B85 模型上下文窗口用户设置（UI 入口）

**状态**：doing（设计阶段，2026-11-18）；尚未实现 UI、未完成原型像素审查，以下为已复核责任设计，布局待视觉冻结，不代表作者已接受具体布局。
**来源**：作者要求「模型上下文窗口不应该是代码写死的，要开放给用户做系统配置」；既有 `044092df` 已提供 preferences.context_windows 与 sidecar 启动注入。按 NEXT 独立推进，不依赖 B87 R03 语义验收；不改变其 partial 结论。
**设计真源**：`docs/design/tech-stack/05-desktop.md` §6.1；`docs/design/ui/46-state-and-feedback.md` §9.10；文案仍遵循 47，本批不改其既有 WIP。

## 1. 作者效果与范围

作者在既有模型设置入口查看当前运行服务实际采用的上下文窗口及来源，可对所选 provider 保存或清除覆盖；明确区分「当前生效」与「已保存，重启后生效」。这是高级模型配置，不要求作者理解或操作自动整理。不新增系统设置体系、不做模型级覆盖、热更新、自动重启、压力指示器或整理开关，不改 0.70/0.90、keep_recent_items=4 与保守默认表。默认值不是供应商承诺的模型最大能力。

## 2. 事实来源与既有实体复用

- 当前值/来源由现役 Application 读取路径消费 ContextPressure 唯一解析结果；优先扩展现 provider options 路径。Rust/TS 不复制默认表，不以已保存偏好或推测默认替代真实 backend。
- 桌面存储仍由现 Preferences owner 负责。read_preferences/write_preferences 是私有函数，不是现成 Tauri command；需要有界公开读写窗口命令，不能开放任意文件/偏好写入。
- 写入只 patch 指定合法 provider 的 context_windows 值/删除该键；现应用进程内所有 Preferences 命令共享同一串行 read-modify-write 边界（不扩展多进程/外部文件编辑协调），保留其他 provider、endpoint、密钥引用等字段。不能仅给新命令加锁却让旧写入继续竞争。 在现 owner 内将最近作品、助手显示名和模型供应商等全部写者统一串行更新及原子替换；保留未知 JSON 字段，损坏文件拒绝写入。独立反例包含写中断原文件不变及嵌套未知字段不丢。
- 空输入删除覆盖；正整数由现窗口契约与 u32 存储共同约束，不另造 UI 魔数上限。provider 身份由现 registry 校验，未知值拒绝。浏览器无 Tauri 时不以 localStorage 伪造桌面保存。
- profile 沿用现启动环境，不新增运行中切换/身份协议；provider 切换与弹窗生命周期的迟到读取不得串值。运行服务读取失败显示未知，重启失败不伪清 pending；B88 多实例 readiness 不在本批解决。

## 3. 原型与实施前置

既有 WorkspaceChat 模型供应商 Dialog 可复用；当前 novel-studio.pen 未找到设置 frame，仅 ZOwOi 工作台可作为入口基线。必须通过受支持 Pencil 编辑器查看像素并冻结相应设置 frame 后才实现 UI，组件标注设计/原型。原 .pen 的 AYpEe 改动与 47 既有 WIP 不覆盖、不夹带提交。

本机已装 highagency.pencildev-0.6.81，公开 custom editor 为 pencil.designEditor（*.pen），提供 Toggle Design Mode 等命令，无公开导出 CLI；readme 仅标题。当前无 Pencil MCP。可在确认桌面无编辑冲突后通过 VS Code 已安装编辑器打开现文件观察，不能调用自造内部协议、安装软件或修改全局设置。未查看像素前不声称视觉验收通过。

## 4. 独立预期、反例与证据

1. 当前 backend 32k、保存 64k：仍显示当前 32k 与保存 64k，关闭/重开保持；取消编辑不写文件。清除覆盖后当前仍旧值，直到新的服务启动解析确实变化。
2. 覆盖保存与原供应商 endpoint 保存并发：两者均保留；非法/未知 provider、零、负数、小数、溢出、写入失败均不报成功、不破坏原文件。
3. dev/stage/slice-verify/无 profile release 各自独立启动且偏好相互隔离；provider 切换或弹窗关闭后的旧请求不得更新新界面；浏览器只读真实运行事实或明确不可用。
4. 在真实 release sidecar 路径用隔离 profile 从页面保存、退出/重启，核新进程实际 env/应用解析与页面三方一致。debug 外接 backend 不能代签 release 启动生效；继承外部 env 时清空偏好不能假称已回默认。
5. 复用前端 typecheck/lint/test、Rust 偏好/启动注入、后端解析与读路径测试；真实 Tauri 外部自动化覆盖保存/取消/清空/失败/重启，不增加验收 hook，不需实模。维护策略与现创作流程回归不变。

## 5. 存在性审核

- **解决什么问题**：作者无需手改文件即可设置保守运行窗口，并知道是否实际生效。
- **为什么现在需要**：已有作者要求与 NEXT 授权，初始存储能力缺可用入口；独立于 R03 模型语义阻塞。
- **已有实体能否承担**：ContextPressure 解析、Application provider options、Preferences、现模型 Dialog 各承接原职责，不新建配置服务/存储表/后台进程。
- **唯一事实与写入者是谁**：运行值由当前 backend 解析；保存值由同 profile Preferences；两者明确不同时间状态，不形成平行默认表。
- **边界与消费者是什么**：Application 读事实、Tauri 有界偏好 patch、Dialog 展示；不让 Rust/浏览器决定 backend 已生效。
- **反例如何否证**：以上 current/saved、并发、profile、失败、真实重启反例独立于实现成功路径。
- **什么不建/如何收尾**：不新设置体系、模型级能力库、热更新或重启编排器；原型与设计复核后才写实现，完成用户操作和真实启动证据再关闭任务。
