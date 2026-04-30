defmodule NovelWeb.ProviderController do
  use Phoenix.Controller, formats: [:json]

  alias NovelAgent.Provider.LMStudio

  @doc "GET /api/provider/health — 检查 LLM 连接状态（直接 ping，不走降级）"
  def health(conn, _params) do
    state = LMStudio.from_config()
    model = state.model

    case LMStudio.complete(state, model, "ping") do
      {:ok, _result} ->
        json(conn, %{
          connected: true,
          model: model,
          message: "LLM 已连接"
        })

      {:error, error} ->
        json(conn, %{
          connected: false,
          model: model,
          message: "LLM 未连接：#{error.message}",
          detail: Map.get(error, :type, "unknown")
        })
    end
  end
end
