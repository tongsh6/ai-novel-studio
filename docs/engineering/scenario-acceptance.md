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

场景的操作、目标与通过条件均使用作者能感知的语义。作者输入取自然语言，脚本按可见章名、章序、角色名、正文与控件选择目标，按页面可见反馈判断结果。内部编号、引用、草稿版本和运行标识留在应用内部。网络帧、日志与库表可单独用于诊断和技术对账，不能用来替作者选目标、推动步骤或签页面验收。菜单或页面走不通时记录实际失败。

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
- 通过真实页面的控件、可见文本和截图证明作者场景结果。需要对账技术机制时，另行读取网络帧、日志和持久化结果。
- 把产物写入 `artifacts/slice-verify/<slice-id>/`。
- 失败时也保存截图和已捕获帧，方便复盘。

避免策略：

- 不依赖 `data-testid`、slice 专用 `data-*` 或隐藏 DOM metadata。
- 不从脚本直接 push Channel payload 来替代用户操作。
- 不按内部 ID 选择目标或改库促成操作。例如作品菜单不可达时不得修改“最近打开”时间再重启来代替选择。
- 不让产品代码上报“验收完成”状态。
- 不给产品页面加只服务脚本的按钮、状态文本或快捷入口。

可从 `frontend/slice-verify/TEMPLATE.external-ui-driver.mjs` 复制外部 driver 骨架。

## 6. Review Checklist

审查 slice 验收时逐项确认：

- 外部脚本是否打开真实产品入口，而不是旁路页面？
- 脚本是否通过用户可见语义定位和操作 UI？
- 产品代码是否没有新增验收专用 env、slice id、DOM hook、Channel/API 事件或 provider 注册？
- 作者场景能否在缺少应用内部编号、网络帧和数据库查询的情况下完成选目标、操作及页面判定？
- **引用历史证据时必须先核对 `summary.surface` / `driver` / `provider`**：目录名（如 `-tauri`）
  不代表真实页面来源——历史目录中存在 `surface=browser`、`driver=外部 UI` 的混合情况；
  「真实页面验收」只能引用 `surface=native-tauri`（或当轮真实 Tauri 驱动）的产物，
  确定性 provider 产物必须标为确定性证据、不得升格为真实模型证据。
- 局部测试是否被标为局部证据，而不是替代场景化验收？
- 如果未闭环，是否明确写出缺入口、缺事件、缺状态投影或缺自动化能力？

## 7. 落地节奏

当前先通过文档、模板和 code review 落地，不先做 CI 门禁。

如果后续连续出现同类问题，再把稳定规则固化为本地扫描或 CI。但扫描只能做辅助提醒，不能代替人工判断真实产品语义。
