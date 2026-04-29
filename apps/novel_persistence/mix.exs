defmodule NovelPersistence.MixProject do
  use Mix.Project

  def project do
    [
      app: :novel_persistence,
      version: "0.1.0",
      build_path: "../../_build",
      config_path: "../../config/config.exs",
      deps_path: "../../deps",
      lockfile: "../../mix.lock",
      elixir: "~> 1.19",
      elixirc_paths: elixirc_paths(Mix.env()),
      aliases: aliases(),
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  defp aliases do
    [
      "ecto.setup": ["ecto.create", "ecto.migrate"],
      "ecto.reset": ["ecto.drop", "ecto.setup"],
      test: ["ecto.create --quiet", "ecto.migrate --quiet", "test"]
    ]
  end

  def application do
    [
      extra_applications: [:logger],
      mod: {NovelPersistence.Application, []}
    ]
  end

  defp deps do
    [
      {:novel_foundation, in_umbrella: true},
      {:novel_domain, in_umbrella: true},
      {:ecto, "~> 3.13"},
      {:ecto_sql, "~> 3.13"},
      {:ecto_sqlite3, "~> 0.22"},
      {:postgrex, "~> 0.22", only: [:test]},
      {:paper_trail, "~> 1.1"},
      {:jason, "~> 1.4"}
    ]
  end
end
