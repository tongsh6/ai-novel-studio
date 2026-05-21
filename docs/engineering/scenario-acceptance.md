# 外部自动化驱动真实页面的场景化验收

> 状态：试行
>
> 目的：让 slice 验收证明真实产品链路，而不是证明脚本和产品里的验收钩子互相配合。

## 1. 定义

场景化验收必须由产品之外的自动化脚本驱动真实页面完成。

标准链路是：

```text
外部脚本
→ 打开当前真实产品入口
→ 像用户一样输入、点击、切换、确认或采纳
→ 真实 socket/API 请求
→ web/channel/controller
→ application/domain/agent/persistence
→ TurnResult / task_state / projection / trace
→ 前端可见反馈
→ 外部脚本收集截图、日志、网络帧、持久化证据
```

“真实页面”指用户实际进入的产品入口，例如 Tauri 工作台和 `App.tsx -> WorkspaceChat`。旁路 demo、Storybook、孤立组件、脚本专用页面不算真实页面。

“外部脚本”指 Playwright、Tauri 自动化、系统 UI 自动化或同等 harness。脚本可以启动服务、打开页面、操作 UI、观察 WebSocket 帧、截图、读取日志和检查持久化结果，但不得要求产品代码识别验收场景。

## 2. 红线

生产代码不得为了验收而新增以下能力：

- 读取验收专用 env、slice id、URL query、localStorage、sessionStorage 或配置开关来改变行为。
- 内置自动输入、自动点击、自动切换、自动采纳、自动展开、自动上报 UI 状态。
- 添加验收专用 DOM hook、隐藏 metadata、`data-testid`、slice 专用 `data-*`。
- 添加验收专用 Channel/API 事件，例如只给脚本回传页面内部状态的事件。
- 在生产 runtime 注册验收 provider、fake provider、script provider。
- 把测试替身、脚本 fixture、seed fixture 放入生产 app 的默认启动路径。

这些都属于嵌入式验收钩子：产品被改造成会配合验收，而不是被真实使用方式验收。

## 3. 允许项

以下情况允许，但必须能说明真实产品语义：

- 真实用户可见的文案、按钮、label、placeholder、aria role。
- 真实可访问性属性，例如 `aria-label`、`aria-describedby`。
- 服务样式、布局、组件状态或真实业务语义的 `data-*`。
- 真实产品需要的 debug/trace/audit 输出，且它们不是为了某个验收 slice 单独存在。
- test/support、脚本目录、外部 harness 内的 fixture/provider/driver。

判断标准不是字符串，而是边界和意图。产品代码里出现 `verify`、`data-*`、`test` 等词本身不违规；只有当它们服务验收脚本、且用户或产品运行语义不需要时，才违规。

## 4. 开工模板

每个 slice 开始编码前必须写清：

```md
## 开工检查

- Contract:
- Invariant:
- Boundary:
- Consumer:
- Proof:
- Acceptance Driver:
```

`Acceptance Driver` 必须回答：

- 外部脚本入口是什么？例如 `bash scripts/slice_verify.sh <slice-id>` 或 `bash scripts/tauri_slice_verify.sh <slice-id>`。
- 脚本打开哪个真实页面？
- 脚本使用哪些用户可见操作？
- 脚本收集哪些外部证据？例如截图、WebSocket 帧、日志、数据库状态。
- 产品代码是否新增验收感知逻辑？默认必须为 no；如果不是 no，必须证明它是真实产品能力。

## 5. Driver 写法

优先策略：

- 使用 `getByRole`、`getByLabel`、`getByPlaceholder`、可见按钮文案和页面可见文本。
- 通过 WebSocket/network frame、截图、日志、持久化查询证明链路结果。
- 把产物写入 `artifacts/slice-verify/<slice-id>/`。
- 失败时也保存截图和已捕获帧，方便复盘。

避免策略：

- 不依赖 `data-testid`、slice 专用 `data-*` 或隐藏 DOM metadata。
- 不从脚本直接 push Channel payload 来替代用户操作。
- 不让产品代码上报“验收完成”状态。
- 不给产品页面加只服务脚本的按钮、状态文本或快捷入口。

可从 `frontend/slice-verify/TEMPLATE.external-ui-driver.mjs` 复制外部 driver 骨架。

## 6. Review Checklist

审查 slice 验收时逐项确认：

- 外部脚本是否打开真实产品入口，而不是旁路页面？
- 脚本是否通过用户可见语义定位和操作 UI？
- 产品代码是否没有新增验收专用 env、slice id、DOM hook、Channel/API 事件或 provider 注册？
- 验收证据是否来自真实网络帧、前端可见反馈、日志、截图或持久化结果？
- 局部测试是否被标为局部证据，而不是替代场景化验收？
- 如果未闭环，是否明确写出缺入口、缺事件、缺状态投影或缺自动化能力？

## 7. 落地节奏

当前先通过文档、模板和 code review 落地，不先做 CI 门禁。

如果后续连续出现同类问题，再把稳定规则固化为本地扫描或 CI。但扫描只能做辅助提醒，不能代替人工判断真实产品语义。
