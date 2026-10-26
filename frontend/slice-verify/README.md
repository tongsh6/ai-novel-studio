# 外部场景驱动与验证器

本目录位于产品之外，使用可见控件、网络帧和持久结果验收。默认 Playwright 驱动 Chromium；原生证据由 `scripts/tauri_slice_verify.sh` 的系统 UI 模式采集。不得将启动原生进程当作原生交互。

| 文件 | 角色 |
|---|---|
| `external-ui-driver.mjs` | 已注册场景的浏览器产品链驱动；原生场景不执行此文件来冒充原生操作。 |
| `native-tauri-verifier.mjs` | 场景日志/测量验证器；summary 按实际 driver 标识证据层级。 |
| `native-tauri-verifier.test.mjs` | 验证器的正反例回归。 |
| [共用证明与正文fixture](../../scripts/lib/README.md) | B31问题绑定证明、B28原正文与冻结归一位于scripts/lib，浏览器和原生驱动共用。 |
| `b31-question-proof.test.mjs` | 错绑、改字节、重复回执、重复问题、预算与其他任务保护的回归。 |
| `dogfood-runner.mjs` | 连续创作/维护/恢复/导出的浏览器驱动；等待/问答均有预算。 |
| `dogfood-p1-plan.md` | 历史驱动说明；当前执行范围与状态以 tasks 中真实创作复验为准。 |
| `TEMPLATE.external-ui-driver.mjs` | 外部场景驱动模板。 |
| `au02-candidate-continuation.mjs` | 候选续写的既有专用驱动。 |
| `au10-micro-plan-entry.mjs` | micro plan 入口的既有专用驱动。 |
| `au10-workbench-render-stability.mjs` | 工作台渲染稳定性驱动。 |
| `q1c-adopted-content-revision.mjs` | 已采纳内容修订驱动。 |
| `q1c-adopted-content-revision-audit.mjs` | 修订证据审计。 |
| `vs10-observability-spine.mjs` | 可观测链路驱动。 |
