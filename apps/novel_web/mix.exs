defmodule NovelWeb.MixProject do
  use Mix.Project

  def project do
    [
      app: :novel_web,
      version: "0.1.0",
      build_path: "../../_build",
      config_path: "../../config/config.exs",
      deps_path: "../../deps",
      lockfile: "../../mix.lock",
      elixir: "~> 1.19",
      test_coverage: [tool: ExCoveralls],
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  def application do
    [
      extra_applications: [:logger],
      mod: {NovelWeb.Application, []}
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  defp deps do
    [
      {:novel_application, in_umbrella: true},
      {:novel_persistence, in_umbrella: true},
      {:novel_foundation, in_umbrella: true},
      {:phoenix, "~> 1.8.6"},
      {:phoenix_pubsub, "~> 2.1"},
      {:jason, "~> 1.4"},
      {:bandit, "~> 1.11"},
      {:novel_test, in_umbrella: true, only: :test},
      {:excoveralls, "~> 0.18", only: :test, runtime: false}
    ]
  end
end
