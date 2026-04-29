import Config

# Stage 1 桌面应用：SQLite 自包含数据库。
# 数据库文件位于项目根目录 priv/ 下，生产环境将放在 OS 用户数据目录。
db_path = Path.join(File.cwd!(), "priv/ai_novel_studio_dev.db")

config :novel_persistence, NovelPersistence.Repo,
  adapter: Ecto.Adapters.SQLite3,
  database: db_path,
  pool_size: 1,
  show_sensitive_data_on_connection_error: true,
  stacktrace: true

config :novel_web, NovelWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: System.get_env("PHOENIX_PORT", "4657") |> String.to_integer()],
  debug_errors: true,
  code_reloader: false,
  check_origin: false
