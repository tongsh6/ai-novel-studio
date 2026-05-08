defmodule NovelTest.MixProject do
  use Mix.Project

  def project do
    [
      app: :novel_test,
      version: "0.1.0",
      build_path: "../../_build",
      config_path: "../../config/config.exs",
      deps_path: "../../deps",
      lockfile: "../../mix.lock",
      elixir: "~> 1.19",
      test_coverage: [tool: ExCoveralls],
      start_permanent: false,
      deps: deps()
    ]
  end

  def application do
    [extra_applications: [:logger]]
  end

  defp deps do
    [
      {:novel_agent, in_umbrella: true},
      {:excoveralls, "~> 0.18", only: :test, runtime: false}
    ]
  end
end
