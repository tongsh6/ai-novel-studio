# B85 模型上下文窗口用户设置（UI 入口）

**状态**：doing（2026-11-18）；UI 已按本次冻结原型实现，前端 56 files / 536 tests、typecheck、lint 通过；待真实 release 外部验收，不以局部测试代签。证据：`artifacts/model-contracts/b85/20261118/frontend/{freeze.json,all-tests-styled.log,typecheck-styled.log,lint-styled.log}`。
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

已复用既有 WorkspaceChat 模型供应商 Dialog；本次设置原型 B85A1/B85A2/B85A3 已冻结并用于实现。原型保留证据：`artifacts/model-contracts/b85/20261118/prototype/final-preservation.json`。原 .pen 的 AYpEe 改动与 47 既有 WIP 不覆盖、不夹带提交。

原型与实现的视觉责任见 46 §9.10；以上原型/前端验证不是实际 release 页面保存与启动生效证明，后者仍按 §6 由外部真实 UI 验收。

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

## 6. 真实 release 外部验收预注册（B85，2026-11-18；待独立审核后实施）

### 6.1 七问与唯一责任

1. **目标**：证明作者通过真实设置页面保存的同 profile 覆盖，仅在真正退出并新启动 release sidecar 后进入运行解析；当前值、保存值与来源不会相互冒充。
2. **为何新增**：SU04 现 `release_app_lifecycle_check.sh` 已承担真实 release 的启动、退出与清理，但没有 B85 页面场景。debug native runner 的外接 backend 不能证明 release 注入。
3. **复用什么**：保留上述脚本为唯一 release 生命周期 owner，在其 `start_app/exit_app/cleanup/snapshot_processes` 原职责内收敛身份与退出判据，并增加 B85 场景分支；新建的仅是有界 B85 外部 UI 场景 driver，由现 owner 按阶段调用，不启动/终止/重开进程。现 SU04 四场景及 B85 是两个当前消费者，不另建通用 runner。
4. **不能冒称哪些现成能力**：`NativeScenarioHarness.bindBatchTarget/waitTargetResolution`、`driver.mjs` 的 target/input/AX/screenshot 可复用；其 `rawCloseAppAndRelaunch` 先调用 TERM/KILL cleanup 再 openApplication，不是正常退出，也不保证隔离 release 环境，故不用于此验收。现 `native_app_ownership.mjs.cleanupNativeApp` 只回收精确 app executable，不能声称已监督 release sidecar。
5. **唯一身份**：现 owner 记录直接启动 child PID、实际 executable realpath、启动时刻、隔离 HOME/profile、实际子进程 ancestry 与 sidecar PGID/exec/starttime；只在已建立归属后持有句柄。复用 `process_observation.mjs.observeOwnedExecutable` 并补足时间/组成员事实，不以应用名、HOME 子串、端口或 PGID 单独授权 kill。每次信号前复核身份；身份无法确认则拒绝清理该进程并报告阻碍，不扩大范围。
6. **独立反例**：同名别批 app、相似 HOME、PID 复用、同端口外部服务不属于本批；真实窗口关闭失败而 TERM 成功不等于产品正常退出；旧包、debug app、只重开 WebView、保存值替代 runtime 值均不能通过。
7. **不建什么/如何收尾**：不建产品测试 hook、第二偏好写者、模型请求、通用进程管理器或 B88 多实例协议。仅维护现 release owner 与薄 UI driver；本批只顺序两个隔离 profile。旧 SU04 入口迁移到同一身份路径，不保留 name/grep 另一套清理。先确定性否证归属/阶段逻辑，再运行真实外部 UI；证据不足不关闭 B85。

### 6.2 最小流程与冻结判据

- **构建与隔离**：正式入口 `bash scripts/build_sidecar.sh`、`cd frontend && pnpm exec tauri build --bundles app` 重新构建当前源码；记录 HEAD、dirty 源范围、app executable 与 bundled sidecar 哈希。同一独立 HOME 下顺序运行 named profile A 与显式 unset AI_NOVEL_DESKTOP_PROFILE 的 release 默认 profile B（不并发，B 不是名为 release 的 profile），使用真实 bundle，不以旧产物冒签。本批测试的继承窗口 env 先显式清除，另以一个有来源的继承 env 子场景验证清空语义。4658 已被外部服务占用即停止，绝不清理外部 owner。
- **基线/保存**：从真实模型设置入口打开 Dialog，读取所选 provider 的 runtime current/default/source 与 saved。选择不同于当前的合法窗口值，经 AX/CGEvent 输入并保存；记录页面截图/AX、同 profile preferences 白名单字段、只读 provider/options。原 backend PID/启动身份与 runtime 值保持不变；保存值变化且页面明确待下次启动。关闭/重开 Dialog 保持此区别。不能直接 invoke 写命令。
- **真退出/新启动**：UI driver 只点击绑定本批 PID 窗口的 AXCloseButton；release owner 等待 app 与已记录 sidecar 全部退出且本批 listener 消失，然后用同一启动环境新建进程并重新绑定。若需 TERM/KILL，只作失败后的 cleanup，不通过本阶段。同 profile preferences 保存值、已绑定新 sidecar PID/listener 的实际 Application options、页面当前值三方一致。options.context_window 来自现 ContextPressure 对 Application.get_env 的真实解析，结合正式 release 注入源码与单元链路证明启动后的消费者生效；父进程显式启动白名单参数仅记作输入，不冒称 OS 实测子环境。禁止读取 ps eww/全环境/秘密文件。
- **清空**：从页面清空覆盖并保存，文件只删除目标 provider 键，旧运行值仍不变；正常退出/新启动后，在无继承 override 基线下显示真实 conservative default。独立继承 env 子场景中仍可为 runtime_override，不能把清空偏好自动解释为默认。
- **取消/重复/失败**：编辑后取消，preferences 字节哈希不变；非法值不能保存成功；快速重复点击观察保存中禁用与唯一稳定结果。隔离 profile 下预置损坏 preferences 作为真实文件故障，页面保存必须失败、保留编辑与原文件字节，不伪成功；恢复只用测试前备份。故障输入属于外部测试装置，不伪造后端或 Tauri 返回值。运行事实读取失败另设最后独立故障阶段：只终止已绑定且再次核验身份的 owned sidecar，保持 app 后重新打开 Dialog 触发真实读取失败，确认显示未知；该阶段是故障注入，不计正常退出证据。模型健康失败时窗口仍可编辑；窗口保存不得切换 provider、endpoint 或 key。精确并发/迟到响应仍由确定性测试证明，不以一次 UI 成功夸称覆盖竞态。
- **profile 隔离**：A 保存并完成上述重启；A 正常退出后，B 初次启动不得出现 A 覆盖，B 保存另一值并正常退出；回到 A 仍为 A 的值。不同 provider 与未知嵌套字段保持。本次真实流程只证明 named 与 unset release 的实际映射，属于最小 checkpoint，不缩减 §4.3 全范围。dev/stage/slice-verify 的真实独立启动仍是后续未闭环项；现 Rust 独立 tmp 路径测试不等于已验证 desktop_profile 环境映射，两 profile 通过也不能独自将 B85 标 done。
- **终态清理**：owner 逐阶段记录 owned app/sidecar 启动身份及端口归属；最后明确 owned remaining=[]，外部进程未触碰。完整保留本批证据与各 profile 快照，cleanup 仅清理 owned 进程/端口，不删除目录或失败现场。若 WorkspaceChat 设置入口需作品上下文，可经现无生成的新建/选择作品 UI 使用本批隔离空白 fixture 作品，不碰真实作品；不发送创作输入、不按测试连接、不访问真实模型生成端点。

### 6.3 证据与实施边界

前向澄清：§4 的「实际 env/应用解析/页面」在本次可执行验证中采用实际 Application 读取出口而非扫描 OS 全环境；理由是已有 ContextPressure→Application provider options 唯一消费路径足以观察新 release 的真实运行解析，ps eww 会无谓读取秘密且空格分隔不可靠。本澄清发生在任何 release app/env 采证前，不改变或倒签旧运行结果，不用父启动参数替代运行事实。

新 B85 driver 仅消费 owner 生成的本批身份/阶段文件，产品不读这些文件；阶段为 observe-edit-save、observe-restarted、clear、cancel/failure 等固定场景，不增加产品控制端点。通过公开模型设置 UI 与只读 options/隔离 preferences/白名单进程观察交叉核实，截图不能替代运行身份。真实启动采不到可靠 PGID/启动时刻时停止并保留缺口，不退化到进程名或 HOME grep。现 release owner 预先失败不能遗留“pass” summary；summary 只在退出及清理断言完成后写 pass。

先审核本节，再有界修改现 release owner、必要既有归属观察适配及其确定性测试，加薄 B85 UI driver 与测试。不得修改生产代码来便利验收；若可观察性缺口只能靠生产 hook 才绕过，先报告而非实现。并行实现文件及原有 WIP 不夹带，本节不覆盖 §3 视觉状态。尚未运行真实 release，以上是预注册而非验收结果。
