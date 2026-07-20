import Config

# Dialyzer PLT 文件路径 — 放在 priv/plts/ 以便 CI 缓存
config :dialyxir,
  plt_local_path: "priv/plts",
  plt_core_path: "priv/plts"

# 测试库：SQLite3（阶段 1 桌面单机，业务代码 0 改动即可切 PG）。
# Sandbox 模式由 Ecto.Adapters.SQL.Sandbox 接管，每个测试事务隔离。
# 独立 database 名避免污染 dev。
config :novel_persistence, NovelPersistence.Repo,
  adapter: Ecto.Adapters.SQLite3,
  database:
    Path.join(
      System.tmp_dir!(),
      "ai_novel_studio_test#{System.get_env("MIX_TEST_PARTITION", "")}.sqlite3"
    ),
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: 10,
  journal_mode: :wal,
  busy_timeout: 5_000

# 测试时 Phoenix endpoint 不监听端口，避免和 dev 冲突。
config :novel_web, NovelWeb.Endpoint,
  http: [
    ip: {127, 0, 0, 1},
    port: System.get_env("PHOENIX_TEST_PORT", "4658") |> String.to_integer()
  ],
  server: false

config :logger, level: :warning

# Provider Gateway — 测试环境默认 stub，单测可手动注入 adapter
config :novel_agent, :provider, default: :stub

# LM Studio 测试超时默认设短（纯单测走 stub，探活不应阻塞）。
# 缺陷九跟进（2026-07-20）：这个值现在还兼作挂钟止血阀的判定基准
# （OpenAICompatibleStream/AnthropicStream 复用 state.timeout）——real-LLM
# 探针/狗粮虽然也跑在 MIX_ENV=test 下（为了 DB 分区/构建隔离），但打的是
# 真实模型，5 秒会把正常生成误判成超时。real-LLM 场景必须显式覆盖，
# 见 scripts/probe_run.sh / scripts/dogfood_run.sh 的 NOVEL_LMSTUDIO_TIMEOUT_MS。
config :novel_agent, NovelAgent.Provider.LMStudio,
  timeout: System.get_env("NOVEL_LMSTUDIO_TIMEOUT_MS", "5000") |> String.to_integer()

config :novel_application, sync_memory_reference_log: true
config :novel_application, sync_chapter_summary_maintenance: true

# 测试环境导出落到项目 tmp（不污染用户 Documents）；dev/prod 走默认导出目录。
config :novel_application, :export_dir, "tmp/exports"

# 测试中默认不启用真实 persistence 注入（避免 SQLite3 Sandbox 并发冲突）。
# 需要真实 persistence 的集成测试应通过回调手动注入。
config :novel_web, :persistence, inject_real_persistence: false

config :novel_web, :system_shutdown_enabled, false
