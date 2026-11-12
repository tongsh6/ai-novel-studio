# 协议候选包归档说明与基线差异

## 本次任务边界

本次只把用户已确认交付的协议包纳入现有文档/质量/脚本目录。保留源包的术语、组织、例子与基线，不借归档重设计协议，不把合成期望值变成运行事实。源包 SHA-256：`116f10194a5f710a7af963626023f17667ae66916dbd5cf994e70d6474664923`。

源包固定代码基线是 `f13ff6406a002eff54397b906872255048c31763`；归档前实际读取的分支 HEAD 是 `04492ea3b7a08cd4ce363110c099c6b4446a7488`。后者比前者多一个提交，变更仅涉及 VS-00M、B87 R07/R08。源包声明通过的 9/44/56/244/150 等校验只对应原包语义，不能据此宣称满足后续新增约束。

## 正确归属

| 材料 | 归属 | 唯一责任 |
|---|---|---|
| 协议规范、字段说明、来源/存在性映射 | `docs/design/contracts/model-interaction/` | VS-00M 设计候选附件 |
| JSON Schema | `docs/design/schemas/model-interaction/` | 候选 Schema；明确排除自动前端 codegen |
| 任务/工具/要素快照、字段字典 | `docs/design/contracts/model-interaction/reference/` | 只读审查快照，非第二 registry/领域 SSOT |
| 场景覆盖与反例设计 | `docs/design/acceptance/model-interaction-coverage.md` | 验收设计，不登记产品 PASS |
| 合成正例、反例、拆分视图、wire 参考 | `quality/acceptance/fixtures/model-interaction/` | 离线 fixture，由现有 scripts 体系消费 |
| 可运行验证/参考投影 | `scripts/model_contracts/model_interaction/` | 非产品代码、非正式 adapter |
| 运行报告与临时 wire 再生成 | `artifacts/model-contracts/vs00m-design/<run>/` | 单次运行证据，gitignore，不提交 |

没有创建顶层 specs/plans/tools/notes 平行项目。每个新增目录具有 README，父索引逐级可达；VS-00M、B87/R00、验收矩阵和脚本交叉引用。

## 与最新提交必须对账的项目（未擅自改源包）

| 最新 VS-00M/R07/R08 要求 | 原包表达 | 本次处理 |
|---|---|---|
| 候选正文工具存在时 content 必须 null；说明字段与正文分工 | 原包沿用 `submit_tentative_artifact`，部分具体字段和 checker 仍对应源基线 | 不把“100 个样例通过”当成新规则通过；R07 审查并补相应反例 |
| `{ok,data,error_code,message,retryable,observation_ref,budget_after}` 工具结果 envelope | 原包为原基线的 ToolResult 设计形态 | 保留，标为待 R07 对账；不新增第二正式 envelope |
| stream:true 必须区分实际 SSE 与重组结果 | 原包 wire `*.response.json` 是最小归一/重组参考片段，不是完整 SSE 轨迹 | 明确材料层次；不得拿片段冒充真实流；R07 需真实 SSE 证据 |
| `write_candidate`、`paragraph_only`、`coverage_note`、`change_reason` 等最新用语 | 原包沿用 `target_segments`、`submit_tentative_artifact`、`rationale` | 名称/字段不自动替换；R00/R07/R08 查现有实体并完成正式裁决 |
| decision 由应用解析，不给模型自填执行事实 | 原包区分模型返回和系统 Outcome | 可作为对账输入，不声称全量实现/覆盖 |

上述是来源差异，不由本次归档决定哪一个设计应替换另一个；真实代码/冻结契约对齐仍由原 B87 负责。

## 去重和内容保真

原包 `complete-request-response.json`、`examples/read-first/full-exchange.json` 与 `examples/exchanges/05-full-local-revision.json` 完全相同。本次只跟踪后者为唯一完整主样例，另外两条路径转换为导航别名；对照 SHA-256 保存在 [迁移清单](integration-manifest.json)。`read-first` 的请求/响应/结果仍是该主样例的只读教学视图，校验器检查相等。

Schema、正例、反例、wire JSON 与应用后正文保持原始字节；只有 Markdown 链接、目录/命令路径、元数据的文件定位和离线脚本的读写路径适配。原始运行报告不提交，后续重新运行写到 artifacts；完整原包仍可供历史复核。

## 防止意外成为生产输入

实际 `frontend/scripts/codegen-schemas.mjs` 会递归扫描 schemas 下所有 JSON。补丁只为 `model-interaction/` 草案新增明确排除项，与已有 author_visible 独立处理相似；不改变现役 Schema 的输入集合、不新增 TypeScript 生成类型、不让审查镜像成为生产 registry。将来正式批准时必须按消费者逐项接入，不可直接取消排除后宣称完成。

## 运行与验证

统一命令见 [脚本 README](../../../../scripts/model_contracts/model_interaction/README.md)。新增文件导航与链接由 checker 检查；现有索引只增导航，不覆盖原规则、状态和最新 §6.1。本轮环境不含完整仓库/依赖，因此不能声称执行了 `mix check`、完整前端 codegen 或 `next_task_check`；完整 checkout 应补跑这些既有门禁。
