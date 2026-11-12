# VS-00M 候选 JSON Schema

**Proposed，不进入前端 codegen，不是生产 RequestIR 新真源。** 设计主入口：[模型交互协议候选](../../contracts/model-interaction/README.md)；消费者：[离线验证脚本](../../../../scripts/model_contracts/model_interaction/README.md)。本目录被现役 codegen 明确排除，正式接入须由 B87 对账批准。`$id` 是离线命名空间，不会访问网络。

| 文件或目录 | 职责 |
|---|---|
| [model-interaction.schema.json](model-interaction.schema.json) | 包含 105 个复用定义的总候选 Schema |
| [request.schema.json](request.schema.json) | 请求独立验证入口 |
| [model-response.schema.json](model-response.schema.json) | 归一化模型响应验证入口 |
| [tool-result.schema.json](tool-result.schema.json) | 工具结果验证入口（源基线形态） |
| [validation.schema.json](validation.schema.json) | 系统验证结果入口 |
| [application-outcome.schema.json](application-outcome.schema.json) | 系统实际结果入口 |
| [author-action.schema.json](author-action.schema.json) | 作者动作入口 |
| [provider-event.schema.json](provider-event.schema.json) | 运行事件入口 |
| [exchange.schema.json](exchange.schema.json) | 完整交互 fixture 入口 |
