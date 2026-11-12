# 来源与可信边界

固定代码基线：`f13ff6406a002eff54397b906872255048c31763`。下列是本设计的依据；源文件的历史措辞、实现与设计状态不混为一谈。

## S01 · 愿景与创作信息获取元原则

分类：`confirmed_product_goal`。

Agent-native、最小供给/按需求证/证据闭环；本轮已存在对话上下文，具体原文以上轮及仓库为准。

[原始来源](https://github.com/tongsh6/ai-novel-studio/blob/f13ff6406a002eff54397b906872255048c31763/docs/design/00-vision-and-engineering-roadmap.md)

## S02 · 小说要素模型：37要素×结构层级×三态

分类：`source_design`。

本轮读取1–220行。该文明确不负责字段schema，本文元素payload子字段属于新增设计细化。

[原始来源](https://github.com/tongsh6/ai-novel-studio/blob/f13ff6406a002eff54397b906872255048c31763/docs/design/08-novel-element-model.md)

## S03 · 现役 RequestIR

分类：`existing_code`。

本轮读取1–330行。现役ir_version=v1；独立文本操作不必有AgentRun。

[原始来源](https://github.com/tongsh6/ai-novel-studio/blob/f13ff6406a002eff54397b906872255048c31763/apps/novel_common/lib/novel_common/request_ir.ex)

## S04 · AuthoringTask

分类：`existing_code`。

本轮读取文件；14种专业任务、source/scope/preserve/materials/output_contract。

[原始来源](https://github.com/tongsh6/ai-novel-studio/blob/f13ff6406a002eff54397b906872255048c31763/apps/novel_common/lib/novel_common/contracts/authoring_task.ex)

## S05 · CreativeRequest

分类：`existing_code`。

任务、brief、revision、decision_packet等既有专业入口；注释中的历史兼容不作为本提案设计目标。

[原始来源](https://github.com/tongsh6/ai-novel-studio/blob/f13ff6406a002eff54397b906872255048c31763/apps/novel_common/lib/novel_common/contracts/creative_request.ex)

## S06 · ProseExecutionBrief

分类：`existing_code`。

本轮读取1–240行。设计态值对象，绝非canon；核心场级因果与情绪字段。

[原始来源](https://github.com/tongsh6/ai-novel-studio/blob/f13ff6406a002eff54397b906872255048c31763/apps/novel_domain/lib/novel_domain/prose_execution_brief.ex)

## S07 · VS-00E正文与独立质量闭环

分类：`source_design`。

本轮读取1–240行；保留独立evaluator、finding证据及人类文学盲评边界。

[原始来源](https://github.com/tongsh6/ai-novel-studio/blob/f13ff6406a002eff54397b906872255048c31763/docs/design/contracts/VS-00E-prose-execution-quality-contract-pack.md)

## S08 · 判断阶段原生工具契约

分类：`existing_code`。

本轮读取1–300行。7个判断工具和3个continuation工具，字段及组合规则。

[原始来源](https://github.com/tongsh6/ai-novel-studio/blob/f13ff6406a002eff54397b906872255048c31763/apps/novel_application/lib/novel_application/judgment_tool_contract.ex)

## S09 · 计划原生工具契约

分类：`existing_code`。

本轮读取1–245行。agent_plan_draft与judgment plan同批成对。

[原始来源](https://github.com/tongsh6/ai-novel-studio/blob/f13ff6406a002eff54397b906872255048c31763/apps/novel_application/lib/novel_application/agent_plan_tool_contract.ex)

## S10 · 原生创作与修订调用

分类：`existing_code`。

本轮读取1–395行。submit_tentative_artifact；formatting plan与target_segments等。

[原始来源](https://github.com/tongsh6/ai-novel-studio/blob/f13ff6406a002eff54397b906872255048c31763/apps/novel_agent/lib/novel_agent/creative_provider/real.ex)

## S11 · 独立质量评估请求

分类：`existing_code`。

本轮读取文件；评审只读，不产生正文事实。

[原始来源](https://github.com/tongsh6/ai-novel-studio/blob/f13ff6406a002eff54397b906872255048c31763/apps/novel_common/lib/novel_common/contracts/quality_evaluation_request.ex)

## S12 · 质量原生工具

分类：`existing_code`。

本轮读取1–260行。report_quality_findings及真实原句/句序要求。

[原始来源](https://github.com/tongsh6/ai-novel-studio/blob/f13ff6406a002eff54397b906872255048c31763/apps/novel_agent/lib/novel_agent/prose_quality_evaluator.ex)

## S13 · QualityFinding

分类：`existing_code`。

本轮读取1–140行。finding不是作品事实；severity/action/位置/brief来源等。

[原始来源](https://github.com/tongsh6/ai-novel-studio/blob/f13ff6406a002eff54397b906872255048c31763/apps/novel_domain/lib/novel_domain/quality_finding.ex)

## S14 · ProviderEvent

分类：`existing_code`。

本轮读取1–160行。8类事件、可见性、禁止raw prompt/私有推理。

[原始来源](https://github.com/tongsh6/ai-novel-studio/blob/f13ff6406a002eff54397b906872255048c31763/apps/novel_common/lib/novel_common/contracts/provider_event.ex)

## S15 · SystemEnvelope

分类：`existing_code`。

本轮读取1–150行。SystemIdentity唯一真源和稳定系统前缀。

[原始来源](https://github.com/tongsh6/ai-novel-studio/blob/f13ff6406a002eff54397b906872255048c31763/apps/novel_common/lib/novel_common/request_ir/system_envelope.ex)

## S16 · VS-00M系统重审稿

分类：`proposed_design`。

当前仍Proposed。授权模式/委托/新scope覆盖不得伪装已实现。

[原始来源](https://github.com/tongsh6/ai-novel-studio/blob/f13ff6406a002eff54397b906872255048c31763/docs/design/contracts/VS-00M-model-interaction-request-response-contract-pack.md)

## S17 · 现役VS-00L冻结语义

分类：`source_contract_prior_review`。

前序已核对；本轮不声称逐行重新审计。变化必须由契约所有者核对。

[原始来源](https://github.com/tongsh6/ai-novel-studio/blob/f13ff6406a002eff54397b906872255048c31763/docs/design/contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md)

## S18 · B87实施计划

分类：`existing_task_document`。

引用已有任务而不新建平行任务状态；状态以当前原文件为准。

[原始来源](https://github.com/tongsh6/ai-novel-studio/blob/f13ff6406a002eff54397b906872255048c31763/tasks/slices/B87-model-interaction-request-projection.md)

## S19 · Issue #3 作者创作资产

分类：`confirmed_requirement_proposed_implementation`。

本轮读取Issue；没有作者级素材库已经实现的证明。

[原始来源](https://github.com/tongsh6/ai-novel-studio/issues/3)

## X01 · JSON Schema 2020-12

分类：`external_primary_documentation`。

仅用于Schema方言/原生工具传输格式，不替代本项目业务规则。

[原始来源](https://json-schema.org/draft/2020-12)

## X02 · OpenAI Function Calling

分类：`external_primary_documentation`。

仅用于Schema方言/原生工具传输格式，不替代本项目业务规则。

[原始来源](https://developers.openai.com/api/docs/guides/function-calling)

## X03 · OpenAI Responses migration

分类：`external_primary_documentation`。

仅用于Schema方言/原生工具传输格式，不替代本项目业务规则。

[原始来源](https://developers.openai.com/api/docs/guides/migrate-to-responses)

## X04 · Claude tool call handling

分类：`external_primary_documentation`。

仅用于Schema方言/原生工具传输格式，不替代本项目业务规则。

[原始来源](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)
