# Foundation schema 索引

现行 JSON Schema；前端由 codegen 生成。完整语义见 [上级索引](../README.md)。

| 文件 | 角色 |
|---|---|
| [agent_run_state.json](agent_run_state.json) | AgentRun 运行态 Channel 帧/恢复快照；`runtime_live` 为实时命令权限真源，缺失按 unknown |
| [artifact_adoption_entry.json](artifact_adoption_entry.json) | 同名基础契约的 JSON Schema |
| [author_action_result.json](author_action_result.json) | VS-00L §16.10 `author_action` 受理回执；引用既有 `agent_run_state` / `turn_result_v3`，无 run ACK 兼容 |
| [candidate_direction.json](candidate_direction.json) | 同名基础契约的 JSON Schema |
| [ledger_entry.json](ledger_entry.json) | 同名基础契约的 JSON Schema |
| [ledger_information_payload.json](ledger_information_payload.json) | 同名基础契约的 JSON Schema |
| [phase_next_action_compat.json](phase_next_action_compat.json) | 同名基础契约的 JSON Schema |
| [turn_result_v2.json](turn_result_v2.json) | 同名基础契约的 JSON Schema |
| [turn_result_v3.json](turn_result_v3.json) | 同名基础契约的 JSON Schema |
| [ui_card.json](ui_card.json) | 同名基础契约的 JSON Schema |
| [user_message_submission.json](user_message_submission.json) | 不可变用户消息投递记录，ADR-0027 D1 |
| [enums/](enums/README.md) | 编译期冻结枚举，清单见上级索引 |

- [`author_choice_action.json`](author_choice_action.json)：B26 模型选项与系统自由回复源动作的条件 schema，由前端 TurnResult 组合校验。
