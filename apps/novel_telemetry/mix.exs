defmodule NovelTelemetry.MixProject do
  use Mix.Project

  # 可观测性运行时 app（2026-11-08 作者裁决 C）：日志文件 I/O、调用者内同步
  # JSONL 写出（B84，2026-11-14）、Logger metadata 关联与 LLM 调用 JSONL 记录从
  # novel_common 纯契约层迁出，独立承载运行时副作用。common 保持纯契约/纯函数。
  def project do
    [
      app: :novel_telemetry,
      version: "0.1.0",
      build_path: "../../_build",
      config_path: "../../config/config.exs",
      deps_path: "../../deps",
      lockfile: "../../mix.lock",
      elixir: "~> 1.19",
      test_coverage: [tool: ExCoveralls],
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  def application do
    [extra_applications: [:logger]]
  end

  defp deps do
    [
      {:novel_foundation, in_umbrella: true},
      {:excoveralls, "~> 0.18", only: :test, runtime: false}
    ]
  end
end
