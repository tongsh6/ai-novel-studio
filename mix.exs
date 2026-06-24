defmodule AiNovelStudio.MixProject do
  use Mix.Project

  def project do
    [
      apps_path: "apps",
      elixir: "~> 1.19",
      version: "0.1.0",
      test_coverage: [tool: ExCoveralls],
      start_permanent: Mix.env() == :prod,
      aliases: aliases(),
      deps: deps(),
      releases: releases()
    ]
  end

  # 桌面应用 sidecar 后端：把整条 umbrella 生产链路（novel_web 顶层入口 + 全部
  # downstream app + ERTS）组装成一个自包含 release，由 Tauri 作为 sidecar 启动。
  # 用 `MIX_ENV=prod mix release sidecar` 构建，产物在 _build/prod/rel/sidecar。
  # 详见 docs/design/tech-stack/05-desktop.md。
  defp releases do
    [
      sidecar: [
        applications: [
          novel_foundation: :permanent,
          novel_common: :permanent,
          novel_domain: :permanent,
          novel_persistence: :permanent,
          novel_agent: :permanent,
          novel_application: :permanent,
          novel_web: :permanent
        ],
        include_executables_for: [:unix, :windows],
        strip_beams: true
      ]
    ]
  end

  def cli do
    [
      preferred_envs: [check: :test]
    ]
  end

  defp aliases do
    [
      check: [
        "compile --warnings-as-errors",
        "codegen.enums --check",
        "run scripts/lint_enum_literals.exs",
        "xref graph --format cycles --label compile-connected --fail-above 0",
        "test",
        "run scripts/arch_check.exs",
        "run scripts/adr_trace.exs"
      ]
    ]
  end

  # Dependencies listed here are available only for this
  # project and cannot be accessed from applications inside
  # the apps folder.
  #
  # Run "mix help deps" for examples and options.
  defp deps do
    [
      {:dialyxir, "~> 1.4", only: [:dev, :test], runtime: false},
      {:credo, "~> 1.7", only: [:dev, :test], runtime: false},
      {:sobelow, "~> 0.14.1", only: [:dev, :test], runtime: false},
      {:mix_audit, "~> 2.1", only: [:dev, :test], runtime: false},
      {:excoveralls, "~> 0.18", only: :test, runtime: false}
    ]
  end
end
