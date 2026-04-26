defmodule V2Verification.RepoSqlite do
  use Ecto.Repo,
    otp_app: :v2_verification,
    adapter: Ecto.Adapters.SQLite3
end

defmodule V2Verification.RepoPostgres do
  use Ecto.Repo,
    otp_app: :v2_verification,
    adapter: Ecto.Adapters.Postgres
end
