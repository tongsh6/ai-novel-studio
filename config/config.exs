# This file is responsible for configuring your umbrella
# and **all applications** and their dependencies with the
# help of the Config module.
#
# Note that all applications in your umbrella share the
# same configuration and dependencies, which is why they
# all use the same configuration file. If you want different
# configurations or dependencies per app, it is best to
# move said applications out of the umbrella.
import Config

# ── Provider 通用配置 ──────────────────────────
# 各环境可通过 import_config "#{config_env()}.exs" 覆盖。

config :novel_agent, :provider,
  default: :lmstudio

config :novel_agent, NovelAgent.Provider.LMStudio,
  endpoint: System.get_env("NOVEL_LMSTUDIO_ENDPOINT", "http://localhost:1234/v1"),
  model: System.get_env("NOVEL_LMSTUDIO_MODEL", "qwen/qwen3.5-122b-a10b"),
  timeout: 60_000

config :novel_agent, NovelAgent.Provider.Anthropic,
  api_key: System.get_env("NOVEL_ANTHROPIC_API_KEY"),
  model: System.get_env("NOVEL_ANTHROPIC_MODEL", "claude-sonnet-4-6"),
  timeout: 120_000

# LLM 调用日志目录 — 统一到项目根目录，避免各 umbrella app 因 CWD 不同而产生散落 log/ 目录。
# 可通过环境变量 LLM_LOG_DIR 覆盖。
llm_log_dir = System.get_env("LLM_LOG_DIR", Path.expand("../log/llm-calls", __DIR__) |> Path.absname())
config :novel_agent, :llm_log_dir, llm_log_dir

# Dialyzer PLT 文件路径 — 放在 priv/plts/ 以便 CI 缓存
config :dialyxir,
  plt_local_path: "priv/plts",
  plt_core_path: "priv/plts"

config :novel_web, NovelWeb.Endpoint,
  url: [host: "localhost"],
  http: [ip: {127, 0, 0, 1}, port: System.get_env("PHOENIX_PORT", "4657") |> String.to_integer()],
  adapter: Bandit.PhoenixAdapter,
  server: true,
  pubsub_server: NovelWeb.PubSub,
  render_errors: [formats: [json: NovelWeb.ErrorJSON], layout: false],
  secret_key_base: "dev_only_64_byte_secret_replaceme_dev_only_64_byte_secret_replaceme"

config :phoenix, :json_library, Jason

# Ecto: novel_persistence Repo 注册 + 默认 migrations 路径。
# 数据库连接细节按环境拆到 dev.exs / test.exs / runtime.exs。
config :novel_persistence,
  ecto_repos: [NovelPersistence.Repo]

# paper_trail 必须在 import_config 之前配置（编译期取值，see RepoClient + Version schema）。
# binary_id（uuid）模式：item_id / originator_id 都是 UUID。
# 06-database.md §6.3 已记录此组合需要复跑 spike，本仓 T7 完成 binary_id 实测，
# 结论同步到 verification/paper-trail-ecto-compatibility.md §6.3。
config :paper_trail,
  repo: NovelPersistence.Repo,
  item_type: Ecto.UUID,
  originator_type: Ecto.UUID,
  timestamps_type: :utc_datetime_usec,
  originator_relationship_options: [define_field: false]

import_config "#{config_env()}.exs"
