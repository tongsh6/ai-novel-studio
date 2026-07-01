# Script Helper Index

`scripts/lib/` 放多个 shell 启动/验收脚本共享的 helper。这里的脚本不应单独作为用户入口；入口脚本应位于 `scripts/` 顶层或对应场景目录。

| 文件 | 角色 |
|---|---|
| `process_tree.sh` | 进程树终止与清理 helper，被 stage/dev/Tauri 验收脚本复用。 |
| `tauri_dev_config.sh` | 生成 Tauri dev runtime overlay config，避免启动脚本改写 `frontend/src-tauri/tauri.conf.json`。 |
