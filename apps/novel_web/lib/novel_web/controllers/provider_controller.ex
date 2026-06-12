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

  @doc "GET /api/provider/options — 返回可选 provider，不包含 secret"
  def options(conn, _params) do
    json(conn, encode_options(NovelApplication.provider_options()))
  end

  @doc "PUT /api/provider/config — 保存运行时 provider 选择"
  def configure(conn, params) do
    case NovelApplication.configure_provider(params) do
      {:ok, metadata} ->
        json(conn, %{ok: true, provider: metadata.provider, model: metadata.model})

      {:error, error} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{ok: false, message: Map.get(error, :message, "provider config failed")})
    end
  end

  @doc "POST /api/provider/models — 使用传入配置实时拉取 provider 可用模型列表"
  def models(conn, params) do
    case NovelApplication.provider_models(params) do
      {:ok, %{provider: provider, models: models}} ->
        json(conn, %{
          ok: true,
          provider: provider,
          models: Enum.map(models, &encode_model/1)
        })

      {:error, %{provider: provider, error: error} = result} ->
        json(conn, %{
          ok: false,
          provider: provider,
          models: [],
          message: Map.get(result, :message, "模型列表加载失败"),
          detail: Map.get(error, :type, "unknown")
        })

      {:error, error} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{ok: false, models: [], message: Map.get(error, :message, "模型列表加载失败")})
    end
  end

  @doc "POST /api/provider/test — 测试传入配置，不改变当前运行时 provider"
  def test(conn, params) do
    case NovelApplication.test_provider(params) do
      {:ok, metadata} ->
        json(conn, %{
          ok: true,
          connected: true,
          provider: metadata.provider,
          model: metadata.model,
          message: "连接可用"
        })

      {:error, %{provider: provider, model: model, error: error}} ->
        json(conn, %{
          ok: false,
          connected: false,
          provider: provider,
          model: model,
          message: Map.get(error, :message, "连接不可用"),
          detail: Map.get(error, :type, "unknown")
        })

      {:error, error} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{ok: false, connected: false, message: Map.get(error, :message, "连接不可用")})
    end
  end

  defp encode_options(%{current_provider: current_provider, providers: providers}) do
    %{
      current_provider: current_provider,
      providers:
        Enum.map(providers, fn provider ->
          %{
            id: provider.id,
            label: provider.label,
            current: provider.current,
            model: provider.model,
            endpoint: provider.endpoint,
            requires_api_key: provider.requires_api_key,
            supports_api_key: provider.supports_api_key,
            supports_endpoint: provider.supports_endpoint,
            supports_thinking: provider.supports_thinking,
            api_key_configured: provider.api_key_configured
          }
        end)
    }
  end

  defp encode_model(model) do
    %{
      id: model.id,
      label: model.label,
      owned_by: model.owned_by
    }
  end
end
