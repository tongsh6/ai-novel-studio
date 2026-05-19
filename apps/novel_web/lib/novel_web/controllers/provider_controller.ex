defmodule NovelWeb.ProviderController do
  use Phoenix.Controller, formats: [:json]

  @doc "GET /api/provider/health — 检查 LLM 连接状态（通过 Application 层，不直接引用 Agent 层）"
  def health(conn, _params) do
    case NovelApplication.provider_health() do
      {:ok, %{provider: provider, model: model}} ->
        json(conn, %{
          connected: true,
          provider: provider,
          model: model,
          message: "LLM 已连接"
        })

      {:error, %{provider: provider, model: model, error: error}} ->
        error_message = Map.get(error, :message, "LLM provider unavailable")

        json(conn, %{
          connected: false,
          provider: provider,
          model: model,
          message: "LLM 未连接：#{error_message}",
          detail: Map.get(error, :type, "unknown")
        })
    end
  end
end
