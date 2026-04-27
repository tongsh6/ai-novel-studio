defmodule NovelApplication.MixProject do
  use Mix.Project

  def project do
    [
      app: :novel_application,
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
      mod: {NovelApplication.Application, []}
    ]
  end

  defp deps do
    [
      {:novel_foundation, in_umbrella: true},
      {:novel_domain, in_umbrella: true},
      {:novel_agent, in_umbrella: true},
      {:novel_persistence, in_umbrella: true}
    ]
  end
end
