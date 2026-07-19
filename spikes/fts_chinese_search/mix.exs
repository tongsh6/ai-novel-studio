defmodule FtsChineseSearch.MixProject do
  use Mix.Project

  def project do
    [
      app: :fts_chinese_search,
      version: "0.1.0",
      elixir: "~> 1.15",
      deps: [{:exqlite, "~> 0.36"}]
    ]
  end

  def application, do: [extra_applications: [:logger]]
end
