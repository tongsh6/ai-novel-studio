import Config

# ── B71 上下文维护窗口配置（所有环境）──────────────────────────────────────
# 触发阈值所用的「模型上下文窗口」不写死在用户侧不可改的位置：桌面端由用户系统配置
# （`preferences.json` 的 `context_windows`，按 provider → window）经 Tauri 启动 sidecar
# 时注入 `NOVEL_CONTEXT_WINDOW_OVERRIDES`；dev/CLI 也可直接设置该 env。
# 优先级：用户配置（桌面端注入 env）> 代码默认表（未知 provider 用保守窗口）。
# 非法项忽略（不猜测），不向作者展示内部压力/压缩概念。
case System.get_env("NOVEL_CONTEXT_WINDOW_OVERRIDES") do
  nil ->
    :ok

  value ->
    config :novel_application,
           :context_window_overrides,
           NovelApplication.ContextPressure.parse_window_overrides(value)
end

# ── B71 自动维护开关（运维配置，所有环境）───────────────────────────────────
# NOVEL_AUTO_MAINTENANCE_ENABLED：true/false/1/0 显式开启或关闭安全点自动维护
# （关 = 回滚开关）；缺省/非法值保持 config 值（生产默认开、test 默认关）。
# 纯运行策略配置，不识别验收/场景信息。
case NovelApplication.AutoMaintenanceConfig.enabled_override(
       System.get_env("NOVEL_AUTO_MAINTENANCE_ENABLED")
     ) do
  :keep ->
    :ok

  enabled ->
    config :novel_application, :auto_maintenance, enabled: enabled, keep_recent_items: 4
end

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
  config :novel_telemetry, :llm_log_dir, Path.join([log_dir, "llm-calls"])

  config :novel_telemetry,
    log_jsonl_enabled: true,
    log_jsonl_dir: Path.join([log_dir, "app"])

  # HTTP/WS 端点：固定监听 127.0.0.1:<port>（前端构建时把端点烘焙成同一端口，
  # 见 frontend/.env.production；CSP connect-src 亦已放行该端口）。
  # PHX_SERVER=false 供离线脚本（MBC 探针等 mix run）关闭监听：探针只需应用启动
  # 不需要 web 端口，占 4657 会与场景/狗粮后端撞车（harness 资源竞争实锤 ×2）。
  config :novel_web, NovelWeb.Endpoint,
    http: [ip: {127, 0, 0, 1}, port: port],
    url: [host: "localhost", port: port],
    secret_key_base: secret_key_base,
    check_origin: {NovelWeb.OriginPolicy, :allowed_uri?, []},
    server: System.get_env("PHX_SERVER", "true") != "false"
end
