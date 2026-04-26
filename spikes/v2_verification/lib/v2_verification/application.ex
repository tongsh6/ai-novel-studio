defmodule V2Verification.Application do
  @moduledoc false
  use Application

  @impl true
  def start(_type, _args) do
    target = String.to_atom(System.get_env("SPIKE_DB", "sqlite"))

    repo =
      case target do
        :sqlite -> V2Verification.RepoSqlite
        :postgres -> V2Verification.RepoPostgres
        other -> raise "unknown SPIKE_DB=#{other}, expected sqlite|postgres"
      end

    Application.put_env(:paper_trail, :repo, repo)

    children = [repo]
    opts = [strategy: :one_for_one, name: V2Verification.Supervisor]
    Supervisor.start_link(children, opts)
  end

  def active_repo do
    case System.get_env("SPIKE_DB", "sqlite") do
      "sqlite" -> V2Verification.RepoSqlite
      "postgres" -> V2Verification.RepoPostgres
    end
  end
end
