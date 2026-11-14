import Config

# Dialyzer PLT 文件路径 — 放在 priv/plts/ 以便 CI 缓存
config :dialyxir,
  plt_local_path: "priv/plts",
  plt_core_path: "priv/plts"

# 测试库：SQLite3（阶段 1 桌面单机，业务代码 0 改动即可切 PG）。
# Sandbox 模式由 Ecto.Adapters.SQL.Sandbox 接管，每个测试事务隔离。
# 独立 database 名避免污染 dev。
#
# 2026-11-04 测试提速：默认库名加入 OS 进程唯一 token。
# 旧行为所有 mix test 进程共享同一 SQLite 文件，本机多终端/多 agent 会话并发
# 跑测试时会触发 busy_timeout 5s 重试（实测 persistence 段 1.7s → 192s，
# 42 个 Database busy 失败）。加 pid 后每个测试进程独占一个库。
# 例外：显式设置 NOVEL_TEST_DB_DIR 时保持旧固定名——frontend/slice-verify
# 外部驱动脚本按固定文件名只读 DB，不能改变该场景的文件名。
test_db_dir = System.get_env("NOVEL_TEST_DB_DIR")
test_db_partition = System.get_env("MIX_TEST_PARTITION", "")

test_db_suffix =
  if test_db_dir do
    test_db_partition
  else
    test_db_partition <> "-" <> System.pid()
  end

test_db_path =
  Path.join(
    test_db_dir || System.tmp_dir!(),
    "ai_novel_studio_test#{test_db_suffix}.sqlite3"
  )

# 自有临时库（未显式指定 NOVEL_TEST_DB_DIR）属于本次测试进程：正常或失败退出时
# 归还 db/wal/shm；显式目录是外部 owner 借用的资源，不在此删除。
if is_nil(test_db_dir) do
  System.at_exit(fn _status ->
    Enum.each([test_db_path, test_db_path <> "-wal", test_db_path <> "-shm"], &File.rm/1)
  end)
end

config :novel_persistence, NovelPersistence.Repo,
  adapter: Ecto.Adapters.SQLite3,
  # NOVEL_TEST_DB_DIR：长生命周期分区（狗粮 --resume 断点）用，缺省仍走系统
  # 临时目录。2026-07-21 实锤：macOS 重启清 /var/folders，M2 断点库随之蒸发。
  database: test_db_path,
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

# Provider Gateway — 测试环境默认 stub，单测可手动注入 adapter。
# Stub 只存在于 novel_agent/test/support，生产 registry 不再内置；测试环境显式注册。
config :novel_agent, :provider, default: :stub
config :novel_agent, :extra_providers, %{stub: NovelAgent.Provider.Stub}

# LM Studio 测试超时默认设短（纯单测走 stub，探活不应阻塞）。
# 缺陷九跟进（2026-07-20）：这个值现在还兼作挂钟止血阀的判定基准
# （OpenAICompatibleStream/AnthropicStream 复用 state.timeout）——real-LLM
# 探针/狗粮虽然也跑在 MIX_ENV=test 下（为了 DB 分区/构建隔离），但打的是
# 真实模型，5 秒会把正常生成误判成超时。real-LLM 场景必须显式覆盖，
# 见 scripts/probe_run.sh / scripts/dogfood_run.sh 的 NOVEL_LMSTUDIO_TIMEOUT_MS。
# M4 狗粮实锤（2026-07-29）：Elixir 配置对同一 key 是整块替换而非深合并——本块
# 此前只写 timeout，把 config.exs 的 endpoint/model/max_tokens 一并覆盖丢失，
# 回落到适配器硬编码默认模型名（qwen/qwen3.6-35b-a3b）。狗粮跑在 MIX_ENV=test
# 下打真实 LM Studio，179 次调用全部请求了未加载的模型 → judgment call2 结构
# 退化（capability 恒缺）→ run_failed 风暴。此处必须与 config.exs 同源取值，
# 只覆盖 test 专有的 timeout 默认值。
config :novel_agent, NovelAgent.Provider.LMStudio,
  endpoint: System.get_env("NOVEL_LMSTUDIO_ENDPOINT", "http://localhost:1234/v1"),
  model: System.get_env("NOVEL_LMSTUDIO_MODEL", "qwen/qwen3.8-27b"),
  reasoning_effort: System.get_env("NOVEL_LMSTUDIO_REASONING_EFFORT"),
  max_tokens: System.get_env("NOVEL_LMSTUDIO_MAX_TOKENS", "32000") |> String.to_integer(),
  timeout: System.get_env("NOVEL_LMSTUDIO_TIMEOUT_MS", "5000") |> String.to_integer()

config :novel_application, sync_memory_reference_log: true
config :novel_application, sync_chapter_summary_maintenance: true

# B71 安全点自动维护默认关闭：避免既有 run 测试产生额外 compact 事件；
# 自动维护专测用 Application.put_env 局部开启（见 auto_maintenance_test.exs）。
config :novel_application, :auto_maintenance, enabled: false, keep_recent_items: 4

# 测试环境导出落到项目 tmp（不污染用户 Documents）；dev/prod 走默认导出目录。
config :novel_application, :export_dir, "tmp/exports"

# 测试中默认不启用真实 persistence 注入（避免 SQLite3 Sandbox 并发冲突）。
# 需要真实 persistence 的集成测试应通过回调手动注入。
config :novel_web, :persistence, inject_real_persistence: false

config :novel_web, :system_shutdown_enabled, false
