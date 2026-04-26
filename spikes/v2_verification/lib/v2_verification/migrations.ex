defmodule V2Verification.Migrations do
  @moduledoc """
  Self-contained DDL bootstrapping for the spike. We avoid the full
  `mix ecto.create / mix ecto.migrate` flow and just (re)create tables
  directly so the spike script is reproducible from a single command.
  """

  alias Ecto.Adapters.SQL

  def reset!(repo) do
    drop_if_exists!(repo, "versions")
    drop_if_exists!(repo, "works")
    create_works!(repo)
    create_versions!(repo)
    :ok
  end

  defp drop_if_exists!(repo, table) do
    SQL.query!(repo, ~s|DROP TABLE IF EXISTS "#{table}"|, [])
  end

  defp create_works!(repo) do
    sql =
      case adapter(repo) do
        :sqlite ->
          """
          CREATE TABLE works (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workspace_id TEXT NOT NULL,
            author_id TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'draft',
            inserted_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
          """

        :postgres ->
          """
          CREATE TABLE works (
            id BIGSERIAL PRIMARY KEY,
            workspace_id UUID NOT NULL,
            author_id UUID NOT NULL,
            title VARCHAR(200) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'draft',
            inserted_at TIMESTAMP(6) NOT NULL,
            updated_at TIMESTAMP(6) NOT NULL
          )
          """
      end

    SQL.query!(repo, sql, [])
  end

  defp create_versions!(repo) do
    sql =
      case adapter(repo) do
        :sqlite ->
          """
          CREATE TABLE versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event TEXT NOT NULL,
            item_type TEXT NOT NULL,
            item_id INTEGER,
            item_changes TEXT NOT NULL,
            originator_id INTEGER,
            origin TEXT,
            meta TEXT,
            inserted_at TEXT NOT NULL
          )
          """

        :postgres ->
          """
          CREATE TABLE versions (
            id BIGSERIAL PRIMARY KEY,
            event VARCHAR(10) NOT NULL,
            item_type VARCHAR(255) NOT NULL,
            item_id BIGINT,
            item_changes JSONB NOT NULL,
            originator_id BIGINT,
            origin VARCHAR(50),
            meta JSONB,
            inserted_at TIMESTAMP(6) NOT NULL
          )
          """
      end

    SQL.query!(repo, sql, [])
  end

  defp adapter(repo) do
    case repo.__adapter__() do
      Ecto.Adapters.SQLite3 -> :sqlite
      Ecto.Adapters.Postgres -> :postgres
    end
  end
end
