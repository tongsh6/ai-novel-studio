defmodule NovelWeb.ProviderController do
  use Phoenix.Controller, formats: [:json]

  @doc "GET /api/provider/health — 检查 LLM 连接状态（通过 Application 层，不直接引用 Agent 层）"
  def health(conn, _params) do
    case NovelApplication.provider_health() do
      {:ok, provider} ->
        json(conn, %{
          connected: true,
          provider: provider,
          message: "LLM 已连接"
        })

      {:error, error} ->
        json(conn, %{
          connected: false,
          provider: "unknown",
          message: "LLM 未连接：#{error.message}",
          detail: Map.get(error, :type, "unknown")
        })
    end
  end
end
