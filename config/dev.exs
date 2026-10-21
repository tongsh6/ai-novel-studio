import Config

# LLM 调用日志目录 — 可通过环境变量 LLM_LOG_DIR 覆盖
dev_log_dir =
  System.get_env("LLM_LOG_DIR", Path.expand("../log/llm-calls/dev", __DIR__) |> Path.absname())

config :novel_common, :llm_log_dir, dev_log_dir

# 业务日志 JSONL — 开发环境写入 log/app/dev/
config :novel_common,
  log_jsonl_enabled: true,
  log_jsonl_dir:
    System.get_env(
      "APP_LOG_DIR",
      Path.expand("../log/app/dev", __DIR__) |> Path.absname()
    )

# Dialyzer PLT 文件路径 — 放在 priv/plts/ 以便 CI 缓存
config :dialyxir,
  plt_local_path: "priv/plts",
  plt_core_path: "priv/plts"

# Provider Gateway — 开发环境
# 默认使用 LM Studio 本地推理。LLM 不可用时直接报错，不做降级
llm_timeout_ms = System.get_env("NOVEL_LLM_TIMEOUT_MS", "300000") |> String.to_integer()

anthropic_timeout_ms =
  System.get_env("NOVEL_ANTHROPIC_TIMEOUT_MS", "#{llm_timeout_ms}") |> String.to_integer()

deepseek_timeout_ms =
  System.get_env("NOVEL_DEEPSEEK_TIMEOUT_MS", "#{llm_timeout_ms}") |> String.to_integer()

# 本地默认 provider：Strata App 管理的统一推理后台（唯一一套，127.0.0.1:47831/v1）。
# 可经 NOVEL_PROVIDER_DEFAULT 覆盖（如 lmstudio / deepseek）；模型由 Strata App
# 管理，端点/思考仍由各 provider 配置的 NOVEL_* env 覆盖。LM Studio 配置保留为
# 可切换 fallback（不删除）。
config :novel_agent, :provider,
  default:
    System.get_env("NOVEL_PROVIDER_DEFAULT", "strata")
    |> String.to_atom()

# 本地推理默认模型与端点必须可被 env 覆盖：MBC 探针 / 狗粮 / slice_verify 都经
# `mix run` 走 dev 配置，硬编码会让脚本显式传入的 NOVEL_LMSTUDIO_MODEL 失效，
# 请求落到未加载的模型（2026-10-21 实锤：探针实际加载 qwen/qwen3.8-27b 而非
# 本地已用的 qwen3.8-flash-next@q2_k）。默认值与当前本地 LM Studio 运行模型对齐。
config :novel_agent, NovelAgent.Provider.LMStudio,
  endpoint: System.get_env("NOVEL_LMSTUDIO_ENDPOINT", "http://localhost:1234/v1"),
  model: System.get_env("NOVEL_LMSTUDIO_MODEL", "qwen3.8-flash-next@q2_k"),
  reasoning_effort: System.get_env("NOVEL_LMSTUDIO_REASONING_EFFORT"),
  max_tokens: System.get_env("NOVEL_LMSTUDIO_MAX_TOKENS", "32000") |> String.to_integer()

# 本地存活时限由 TimeoutPolicy 解析（无总时长杀灭，见 config.exs 注释）。

# Strata App 统一推理后台：默认 127.0.0.1:47831/v1，无 Key 也可用，思考默认关。
# 模型由 App 管理（未设 NOVEL_STRATA_MODEL 时请求不带 model）；端点不在设置页配置。
# Elixir 对同一模块配置是整块替换而非深合并，这里必须与 config.exs 同源写全
# （端点/模型/思考/max_tokens 都从 env 读）。本地存活时限由 TimeoutPolicy 统一解析，
# 不在 provider 配置里写总时长（B22，见 config.exs 注释）。
config :novel_agent, NovelAgent.Provider.Strata,
  api_key: System.get_env("NOVEL_STRATA_API_KEY"),
  endpoint: System.get_env("NOVEL_STRATA_ENDPOINT", "http://127.0.0.1:47831/v1"),
  model: System.get_env("NOVEL_STRATA_MODEL"),
  thinking: System.get_env("NOVEL_STRATA_THINKING", "disabled"),
  reasoning_effort: System.get_env("NOVEL_STRATA_REASONING_EFFORT"),
  max_tokens: System.get_env("NOVEL_STRATA_MAX_TOKENS", "32000") |> String.to_integer()

# 可选：Anthropic Claude API（需设置 ANTHROPIC_API_KEY 环境变量）
# 切换到云端 provider 时，只需修改 :provider → default: :anthropic
config :novel_agent, NovelAgent.Provider.Anthropic,
  model: "claude-sonnet-4-6",
  timeout: anthropic_timeout_ms

# 可选：DeepSeek API（需设置 DEEPSEEK_API_KEY 或 NOVEL_DEEPSEEK_API_KEY）
# 切换到 DeepSeek 时，只需修改 :provider → default: :deepseek
config :novel_agent, NovelAgent.Provider.DeepSeek,
  endpoint: System.get_env("NOVEL_DEEPSEEK_ENDPOINT", "https://api.deepseek.com"),
  model: System.get_env("NOVEL_DEEPSEEK_MODEL", "deepseek-v4-flash"),
  timeout: deepseek_timeout_ms,
  thinking: System.get_env("NOVEL_DEEPSEEK_THINKING", "disabled"),
  reasoning_effort: System.get_env("NOVEL_DEEPSEEK_REASONING_EFFORT")

# Stage 1 桌面应用：SQLite 自包含数据库。
# 数据库文件位于项目根目录 priv/ 下，生产环境将放在 OS 用户数据目录。
db_path = Path.join(File.cwd!(), "priv/ai_novel_studio_dev.db")

config :novel_persistence, NovelPersistence.Repo,
  adapter: Ecto.Adapters.SQLite3,
  database: db_path,
  pool_size: 1,
  show_sensitive_data_on_connection_error: true,
  stacktrace: true

config :novel_web, :persistence, inject_real_persistence: true

config :novel_web, NovelWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: System.get_env("PHOENIX_PORT", "4657") |> String.to_integer()],
  debug_errors: true,
  code_reloader: false,
  check_origin: false
