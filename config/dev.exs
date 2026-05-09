import Config

# Provider Gateway — 开发环境
# 默认使用 LM Studio 本地推理。LLM 不可用时直接报错，不做降级
config :novel_agent, :provider,
  default: :lmstudio

config :novel_agent, NovelAgent.Provider.LMStudio,
  endpoint: "http://localhost:1234/v1",
  model: "openai/gpt-oss-120b",
  timeout: 120_000

# 可选：Anthropic Claude API（需设置 ANTHROPIC_API_KEY 环境变量）
# 切换到云端 provider 时，只需修改 :provider → default: :anthropic
config :novel_agent, NovelAgent.Provider.Anthropic,
  model: "claude-sonnet-4-6",
  timeout: 120_000

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
