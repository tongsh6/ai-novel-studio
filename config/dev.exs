import Config

# Phase 0 阶段：复用本机 colima 上 v2_spike_pg 容器（postgres:16-alpine, 5432）。
# 凭据来自容器 env：POSTGRES_USER=spike / POSTGRES_PASSWORD=spike。
# 数据库名 ai_novel_studio_dev 由 `mix ecto.create` 创建。
config :novel_persistence, NovelPersistence.Repo,
  username: "spike",
  password: "spike",
  hostname: "localhost",
  port: 5432,
  database: "ai_novel_studio_dev",
  pool_size: 10,
  show_sensitive_data_on_connection_error: true,
  stacktrace: true

config :novel_web, NovelWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4000],
  debug_errors: true,
  code_reloader: false,
  check_origin: false
