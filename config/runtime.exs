import Config

# ── 打包桌面 release（Tauri sidecar）运行时配置 ─────────────────────────────
#
# 只在「以 Mix release 形式启动」时生效——用 RELEASE_NAME 判定，而不是只看
# config_env() == :prod。原因：本项目开发态用 `MIX_ENV=prod mix phx.server`
# 起后端（见 scripts/dev.sh），它也是 :prod 但不是 release。若按 :prod 一刀切，
# 会把开发态的 stage DB / 日志目录改写掉。release 启动时 BEAM 会注入 RELEASE_NAME。
#
# 打包后产物是只读的 .app bundle，cwd 不可写，因此 DB / 日志 / secret 必须落到
# OS 用户数据目录：优先用 Tauri 通过 NOVEL_DATA_DIR 注入的 per-profile 目录，
# 兜底用 :filename.basedir(:user_data, ...)。
if config_env() == :prod and System.get_env("RELEASE_NAME") do
  data_dir =
    case System.get_env("NOVEL_DATA_DIR") do
      dir when is_binary(dir) and dir != "" -> dir
      _ -> :filename.basedir(:user_data, "ai-novel-studio")
    end

  File.mkdir_p!(data_dir)
  log_dir = Path.join(data_dir, "log")

  port = String.to_integer(System.get_env("PHOENIX_PORT", "4658"))

  # secret_key_base：本机单用户、仅监听 127.0.0.1，无远程面。优先用 env 注入，
  # 否则在数据目录生成并持久化一份（≥64 字节），保证同一安装跨次启动稳定。
  secret_key_base =
    case System.get_env("SECRET_KEY_BASE") do
      key when is_binary(key) and byte_size(key) >= 64 ->
        key

      _ ->
        secret_path = Path.join(data_dir, "secret.key")

        case File.read(secret_path) do
          {:ok, existing} when byte_size(existing) >= 64 ->
            String.trim(existing)

          _ ->
            generated = 48 |> :crypto.strong_rand_bytes() |> Base.encode64()
            File.write!(secret_path, generated)
            generated
        end
    end

  # 数据库：写入用户数据目录下的单一 SQLite 文件。
  config :novel_persistence, NovelPersistence.Repo,
    database: Path.join(data_dir, "ai_novel_studio.db"),
    pool_size: 1

  # 首次启动数据库为空——release 没有 mix ecto.migrate，开启启动自动迁移。
  config :novel_persistence, :auto_migrate, true

  # LLM 调用日志 + 业务日志 JSONL → 用户数据目录。
  config :novel_common, :llm_log_dir, Path.join([log_dir, "llm-calls"])

  config :novel_common,
    log_jsonl_enabled: true,
    log_jsonl_dir: Path.join([log_dir, "app"])

  # HTTP/WS 端点：固定监听 127.0.0.1:<port>（前端构建时把端点烘焙成同一端口，
  # 见 frontend/.env.production；CSP connect-src 亦已放行该端口）。
  config :novel_web, NovelWeb.Endpoint,
    http: [ip: {127, 0, 0, 1}, port: port],
    url: [host: "localhost", port: port],
    secret_key_base: secret_key_base,
    server: true
end
