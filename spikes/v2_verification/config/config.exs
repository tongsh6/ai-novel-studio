import Config

config :v2_verification, ecto_repos: []

config :v2_verification, V2Verification.RepoSqlite,
  database: Path.expand("../priv/spike_sqlite.db", __DIR__),
  pool_size: 1,
  journal_mode: :wal,
  show_sensitive_data_on_connection_error: true,
  log: false

config :v2_verification, V2Verification.RepoPostgres,
  username: "spike",
  password: "spike",
  database: "spike",
  hostname: "127.0.0.1",
  port: 5432,
  pool_size: 5,
  show_sensitive_data_on_connection_error: true,
  log: false

config :paper_trail,
  repo: V2Verification.RepoSqlite,
  item_type: :integer,
  originator_type: :integer

config :instructor,
  adapter: Instructor.Adapters.OpenAI,
  openai: [
    api_url: "http://localhost:11434",
    api_path: "/v1/chat/completions",
    api_key: "ollama",
    auth_mode: :bearer,
    http_options: [receive_timeout: 120_000]
  ]

config :logger, level: :warning
