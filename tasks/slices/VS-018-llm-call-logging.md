# VS-018 LLM HTTP 调用日志

- 状态：done
- 类型：Memory Slice
- 启动日期：2026-05-01
- 完成日期：2026-05-01

## 1. 用户 / 系统目标

记录每次与 LLM 的 HTTP 请求/响应到 JSONL 文件，按天拆分。用于回放调试、prompt 优化和流程分析。

## 2. 开工检查

- Contract: `docs/superpowers/specs/2026-05-01-llm-call-logging-design.md`
- Invariant: HTTP 调用成对记录（request + response）；不含 API key；步失败也记录
- Boundary: 涉及 `novel_agent`（LLMLog 模块 + Provider adapter 修改）、`novel_application`（TurnService 进程字典）；不修改 `novel_foundation`、`novel_domain`、`novel_persistence`、`novel_web`
- Consumer: 开发者直接查看 `log/llm-calls/` 目录，或 grep/jq 分析
- Proof: `mix compile --warnings-as-errors` + `mix test` 全量通过

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | — |
| novel_domain | no | — |
| novel_agent | yes | 新增 LLMLog 模块；LMStudio + Anthropic adapter 追加日志 |
| novel_application | yes | TurnService 设置进程字典 current_turn_id/current_step |
| novel_persistence | no | — |
| novel_web | no | — |
| frontend | no | — |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 新增 NovelAgent.LLMLog 模块 | done | JSONL 按天追加；prompt 截断 2000 字节；response 截断 5000 字节 |
| T2 | LMStudio adapter 注入日志 | done | 成功/HTTP 错误/连接错误三路径均记录 duration |
| T3 | Anthropic adapter 注入日志 | done | 同上模式，复用 log_llm_call helper |
| T4 | TurnService 设置进程字典 | done | current_turn_id + current_step；handle_message 结束时清理 |
| T5 | Router 设置 step 上下文 | done | classify_intent → "intent_classify"；extract_slots → "slot_extract" |
| T6 | TurnService content generation 设置 generate step | done | 7 处 ProviderGateway.complete 前设置 step |

## 5. 验证

- [x] `mix compile --warnings-as-errors` — 零警告
- [x] `mix test` — 255 tests, 0 failures
- [x] `cd frontend && pnpm typecheck && pnpm lint && pnpm test` — 22 tests, 0 failures

## 6. 决策日志

- 2026-05-01 — 选择 Provider adapter 内嵌日志写法（而非 Gateway 层），因为 HTTP request/response 信息只在 adapter 层可见
- 2026-05-01 — 进程字典传递 turn_id/step 上下文（Option A），避免改 Gateway 接口签名（Option B）。简单够用
- 2026-05-01 — 日志内容截断：prompt 截断到 2000 字节，response 截断到 5000 字节，防止 JSONL 行膨胀
