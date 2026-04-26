defmodule V2Verification.MixProject do
  use Mix.Project

  def project do
    [
      app: :v2_verification,
      version: "0.1.0",
      elixir: "~> 1.19",
      start_permanent: Mix.env() == :prod,
      elixirc_paths: elixirc_paths(Mix.env()),
      aliases: aliases(),
      deps: deps()
    ]
  end

  def application do
    [
      extra_applications: [:logger],
      mod: {V2Verification.Application, []}
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  defp deps do
    [
      {:ecto, "~> 3.13"},
      {:ecto_sql, "~> 3.13"},
      {:ecto_sqlite3, "~> 0.22"},
      {:postgrex, "~> 0.22"},
      {:paper_trail, "~> 1.1"},
      {:jason, "~> 1.4"},
      {:ex_json_schema, "~> 0.10"},
      {:req, "~> 0.5"},
      {:langchain, "~> 0.8"},
      {:instructor, "~> 0.1"},
      {:instructor_lite, "~> 1.2"}
    ]
  end

  defp aliases do
    [
      "spike.paper_trail.sqlite": ["run -e 'V2Verification.Spike.PaperTrail.run(:sqlite)'"],
      "spike.paper_trail.postgres": ["run -e 'V2Verification.Spike.PaperTrail.run(:postgres)'"],
      "spike.structured_output": ["run -e 'V2Verification.Spike.StructuredOutput.run()'"]
    ]
  end
end
