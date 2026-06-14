# LLM HTTP 调用日志设计

## 目标

记录每一次与 LLM 的 HTTP 请求/响应，用于回放调试、prompt 优化和流程分析。

## 目录结构

```
log/llm-calls/2026-05-01.jsonl
```

按天分文件，JSONL 格式（每行一条完整 JSON），文件名即日期。

## 记录格式

每行一条记录：

```jsonc
{
  "ts": "2026-05-01T21:13:28.123Z",          // UTC 时间戳，毫秒
  "turn_id": "turn_1719876543210",           // turn 标识
  "step": "intent_classify",                 // 调用阶段: intent_classify | slot_extract | generate | unknown
  "provider": "lmstudio",                    // provider 名称
  "request": {
    "method": "POST",
    "url": "http://localhost:1234/v1/chat/completions",
    "body": {                                // 完整请求体
      "model": "qwen/qwen3.6-35b-a3b",
      "messages": [{"role": "user", "content": "..."}],
      "temperature": 0.7,
      "max_tokens": -1
    }
  },
  "response": {
    "status": 200,
    "body": "intent.CREATE_WORK_SEED",       // 提取后的响应内容（精简）
    "model": "qwen/qwen3.6-35b-a3b",
    "usage": {
      "input_tokens": 432,
      "output_tokens": 1261
    },
    "duration_ms": 7560
  }
}
```

### Step 取值

| Step | 调用位置 | 说明 |
|------|---------|------|
| `intent_classify` | Router.classify_intent | 意图分类 |
| `slot_extract` | Router.extract_slots | Slot 提取 |
| `generate` | TurnService / ProviderGateway.complete | 内容生成 |

## 写入机制

在所有 LLM HTTP 调用的收敛点（`NovelAgent.Provider.Gateway.complete/2`）追加写入。

### 新增模块：`NovelAgent.LLMLog`

```elixir
# logs/llm-calls/ 目录由 Application.ensure_log_dir 保证存在
# 文件名格式: YYYY-MM-DD.jsonl

LLMLog.append(%{
  turn_id: turn_id,
  step: step,
  provider: provider,
  request: request_map,
  response: response_map
})
```

- 使用 `File.write(path, line, [:append, :utf8])` 同步追加
- 文件名按当前 UTC 日期动态生成
- 不做 flush、不保证原子性（调试用，非关键路径）

## 调用链注入

`Gateway.complete/2` 当前只接受 prompt，需要感知 turn 上下文：

```elixir
# Option A: 通过进程字典传递 turn 上下文（最小改动）
Process.put(:current_turn_id, turn_id)

# Option B: 扩展 Gateway.complete 参数（更清晰但改动大）
Gateway.complete(prompt, model, turn_id: tid, step: step)
```

推荐 Option A：在 `TurnService.handle_message` 开始时 `Process.put`，结束时 `Process.delete`。Gateway 内部读取当前 turn_id。

## 禁止记录

- 不记录 API key
- 响应 body 中如有 PII（用户真实姓名等），截断到合理长度（当前场景不存在此风险）

## 后续迭代

- 日志文件超过 N 行自动 rotate
- 按 turn_id 生成 summary 视图（`turn_xxx-summary.md`）
- DB 索引表用于按 turn/step 快速查找日志条目
