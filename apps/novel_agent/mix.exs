defmodule NovelAgent.MixProject do
  use Mix.Project

  def project do
    [
      app: :novel_agent,
      version: "0.1.0",
      build_path: "../../_build",
      config_path: "../../config/config.exs",
      deps_path: "../../deps",
      lockfile: "../../mix.lock",
      elixir: "~> 1.19",
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  def application do
    [
      extra_applications: [:logger],
      mod: {NovelAgent.Application, []}
    ]
  end

  defp deps do
    [
      {:novel_foundation, in_umbrella: true},
      {:telemetry, "~> 1.3"},
      {:jason, "~> 1.4"}
    ]
  end
end
