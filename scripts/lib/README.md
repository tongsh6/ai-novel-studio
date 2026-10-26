# Script Helper Index

`scripts/lib/` 放多个启动/验收脚本共享的 helper。这里的脚本不应单独作为用户入口；入口脚本应位于 `scripts/` 顶层或对应场景目录。

| 文件 | 角色 |
|---|---|
| `process_tree.sh` | 进程树终止与清理 helper，被 stage/dev/Tauri 验收脚本复用。 |
| `tauri_dev_config.sh` | 生成 Tauri dev runtime overlay config，避免启动脚本改写 `frontend/src-tauri/tauri.conf.json`。 |
| `b31-question-proof.mjs` | B31 浏览器驱动与原生验证器共用的纯回复证明/预算 helper；不操作页面或产品。测试在 frontend/slice-verify/b31-question-proof.test.mjs。 |
| `b28-chapter-fixture.mjs` | B28 原浏览器与原生验收共用的原始合成正文、旧全文兼容归一及ADR-0029计划/预览字节与实际分段校验；正文仍必须通过真实UI编辑采纳。 |
| `native_ui/` | [外部系统 UI 驱动](native_ui/README.md)：macOS AX/CGEvent 驱动真实 Tauri 窗口（原生验收 harness），含高层工作台动作与等待账；产品不读取。 |

| `native_app_ownership.mjs` | B37原生重开归属清理：精确匹配本批独立可执行路径，清理前复核PID身份，输出退出证据；由Tauri runner调用。 |
| `native_app_ownership.test.mjs` | 重开/同名其他批次/参数伪匹配的归属回归。 |
