import Config

# ── Stage / Prod 配置 ──────────────────────────
# 本地 stage 用 SQLite，部署时通过 DATABASE_URL 切换 PostgreSQL。

# LLM 调用日志目录 — 可通过环境变量 LLM_LOG_DIR 覆盖
stage_log_dir =
  System.get_env("LLM_LOG_DIR", Path.expand("../log/llm-calls/stage", __DIR__) |> Path.absname())

config :novel_common, :llm_log_dir, stage_log_dir

# 业务日志 JSONL — 生产/预发布环境写入 log/app/stage/
config :novel_common,
  log_jsonl_enabled: true,
  log_jsonl_dir:
    System.get_env(
      "APP_LOG_DIR",
      Path.expand("../log/app/stage", __DIR__) |> Path.absname()
    )

config :logger, level: :info

# Provider Gateway — 生产/预发布环境
llm_timeout_ms = System.get_env("NOVEL_LLM_TIMEOUT_MS", "300000") |> String.to_integer()

lmstudio_timeout_ms =
  System.get_env("NOVEL_LMSTUDIO_TIMEOUT_MS", "#{llm_timeout_ms}") |> String.to_integer()

anthropic_timeout_ms =
  System.get_env("NOVEL_ANTHROPIC_TIMEOUT_MS", "#{llm_timeout_ms}") |> String.to_integer()

config :novel_agent, :provider,
  default: System.get_env("NOVEL_PROVIDER_DEFAULT", "lmstudio") |> String.to_atom()

config :novel_agent, NovelAgent.Provider.Anthropic,
  api_key: System.get_env("NOVEL_ANTHROPIC_API_KEY"),
  model: System.get_env("NOVEL_ANTHROPIC_MODEL", "claude-sonnet-4-6"),
  timeout: anthropic_timeout_ms

config :novel_agent, NovelAgent.Provider.LMStudio,
  endpoint: System.get_env("NOVEL_LMSTUDIO_ENDPOINT", "http://localhost:1234/v1"),
  model: System.get_env("NOVEL_LMSTUDIO_MODEL", "qwen/qwen3.5-122b-a10b"),
  timeout: lmstudio_timeout_ms

# 数据库：DATABASE_URL 优先（PostgreSQL），否则用本地 SQLite
if db_url = System.get_env("DATABASE_URL") do
  config :novel_persistence, NovelPersistence.Repo,
    url: db_url,
    pool_size: String.to_integer(System.get_env("POOL_SIZE", "10")),
    show_sensitive_data_on_connection_error: false,
    stacktrace: false
else
  db_path =
    System.get_env("STAGE_DB_PATH", Path.join(File.cwd!(), "priv/ai_novel_studio_stage.db"))

  config :novel_persistence, NovelPersistence.Repo,
    adapter: Ecto.Adapters.SQLite3,
    database: db_path,
    pool_size: 1,
    show_sensitive_data_on_connection_error: false,
    stacktrace: false
end

config :novel_web, :persistence, inject_real_persistence: true

config :novel_web, NovelWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: System.get_env("PHOENIX_PORT", "4658") |> String.to_integer()],
  url: [host: "localhost"],
  secret_key_base: System.get_env("SECRET_KEY_BASE", "stage_secret_replace_in_deploy_via_env"),
  debug_errors: false,
  code_reloader: false,
  check_origin: false,
  server: true
