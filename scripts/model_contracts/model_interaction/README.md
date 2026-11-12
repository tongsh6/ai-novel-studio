# VS-00M 离线设计校验与参考投影

设计主入口：[协议候选材料](../../../docs/design/contracts/model-interaction/README.md)；Schema：[候选 Schema](../../../docs/design/schemas/model-interaction/README.md)；输入：[合成样例](../../../quality/acceptance/fixtures/model-interaction/README.md)。上级：[模型契约脚本](../README.md)。只消费固定基线候选，不调用模型/数据库，不接入生产 adapter，不把检查结果作为 B87 完成证明。

## 使用

从仓库根目录运行，Python 3.10+：

```bash
python -m pip install -r scripts/model_contracts/model_interaction/requirements.txt
python scripts/model_contracts/model_interaction/check_all.py
```

可用 `--output-dir artifacts/model-contracts/vs00m-design/<独立批次名>` 指定报告位置。默认创建带时间戳的新目录；已存在 summary 的目录拒绝覆盖。脚本从自身位置确定仓库根目录，不依赖当前工作目录。报告不能写到源码目录。

## 运行证据

生成 `report.json`、`provider-projection-report.json`、`navigation-report.json`、`summary.json` 和临时 `wire/` 到 `artifacts/model-contracts/vs00m-design/<run>/`。这些不提交 Git。源码内的 wire fixture 只读；临时生成的 84 份 wire 与 fixture 逐字节比较。非零退出码表示离线检查失败，不表示产品实现失败。

## 文件索引

| 文件 | 职责 |
|---|---|
| [check_all.py](check_all.py) | 单入口：Schema/正反例/wrapper/wire/导航/内容哈希检查，输出实际汇总 |
| [verify.py](verify.py) | 原包语义校验器，仅调整仓库路径和报告落点 |
| [project_example.py](project_example.py) | 原包三 wire 参考映射，仅调整路径；不是生产适配器或 API 验收 |
| [paths.py](paths.py) | 本套脚本唯一的目录定位与 artifacts 输出边界 |
| [requirements.txt](requirements.txt) | 原包 Python 依赖，不变更产品依赖 |

## 不能代签的结论

没有证明当前 VS-00M §6.1 新增约束、Elixir 接线、供应商 API 接受、真实 SSE/Tauri、数据库授权/事务或小说质量。工具快照/Schema 是设计候选，不可直接覆盖生产注册表。最新差异见 [归档说明](../../../docs/design/contracts/model-interaction/integration-notes.md)。
