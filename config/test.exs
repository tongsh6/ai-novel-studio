import Config

# 测试库：独立 schema/database 名，避免污染 dev。
# Sandbox 模式由 Ecto.Adapters.SQL.Sandbox 接管，每个测试事务隔离。
config :novel_persistence, NovelPersistence.Repo,
  adapter: Ecto.Adapters.Postgres,
  username: "spike",
  password: "spike",
  hostname: "localhost",
  port: 5432,
  database: "ai_novel_studio_test#{System.get_env("MIX_TEST_PARTITION")}",
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: System.schedulers_online() * 2

# 测试时 Phoenix endpoint 不监听端口，避免和 dev 冲突。
config :novel_web, NovelWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: System.get_env("PHOENIX_TEST_PORT", "4658") |> String.to_integer()],
  server: false

config :logger, level: :warning

# Provider Gateway — 测试环境默认 stub，单测可手动注入 adapter
config :novel_agent, :provider,
  default: :stub

config :novel_agent, NovelAgent.Provider.LMStudio,
  endpoint: "http://localhost:1234/v1",
  model: "local-model",
  timeout: 5_000

config :novel_application, sync_memory_reference_log: true
