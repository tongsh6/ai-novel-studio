# VS-00M 合成模型交互样例

源基线保持 `f13ff640`。全部是离线合成 fixture，**没有真实模型调用，不注册产品 PASS 场景**。设计：[主入口](../../../../docs/design/contracts/model-interaction/README.md)；覆盖：[验收设计](../../../../docs/design/acceptance/model-interaction-coverage.md)；执行：[验证脚本](../../../../scripts/model_contracts/model_interaction/README.md)。

| 文件或目录 | 职责 |
|---|---|
| [exchanges/](exchanges/README.md) | 44 个正例；完整主样例为 05 |
| [negative/](negative/README.md) | 56 个应拒绝的变异反例 |
| [read-first/](read-first/README.md) | 主样例的拆分阅读视图及应用后正文，校验器对账一致性 |
| [wire/](wire/README.md) | 84 个离线参考请求/响应片段，不是原始 SSE 抓包 |
| [fixture-ref-map.json](fixture-ref-map.json) | 合成素材/对象身份与哈希映射，不指向作者生产数据 |
