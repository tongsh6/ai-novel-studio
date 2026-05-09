defmodule NovelE2E.MixProject do
  use Mix.Project

  def project do
    [
      app: :novel_e2e,
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

  # E2E 只依赖 novel_web（顶层入口）。
  # 其他层（application/agent/domain/persistence）通过调用链自然可达，
  # E2E 测试不直接引用它们的模块。
  defp deps do
    [
      {:novel_web, in_umbrella: true},
      {:novel_test, in_umbrella: true, only: :test},
      {:excoveralls, "~> 0.18", only: :test, runtime: false}
    ]
  end
end
