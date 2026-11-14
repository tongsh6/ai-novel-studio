defmodule RequestCostRuntimeFacts do
  @moduledoc """
  B87 R01 外部 bootstrap 的白名单运行时事实观察。

  只读取 Gateway 现有只读 provider_metadata/0 与 provider_options/0，以及
  Application 的窗口/维护策略，供外部 `slice_verify_server.exs` 在同一后端进程内
  写盘；本模块不改配置、不构造第二配置真源、不读密钥、不 dump 全 env。
  selected/model/endpoint 来自 Gateway 选项；thinking/max/timeout 未由 Gateway
  公开，只登记为未观察，不从 adapter 私有 state 反射，也不冒充已生效。
  """

  @schema "b87-r01-runtime-facts/v1"

  def schema, do: @schema

  @doc "采集 Gateway 现有只读 metadata/options 可观察的运行时事实（不含 secret）。"
  def capture do
    metadata = NovelAgent.Provider.Gateway.provider_metadata()
    options = NovelAgent.Provider.Gateway.provider_options()
    provider = metadata.provider || options.current_provider
    option = Enum.find(options.providers, &Map.get(&1, :current, false)) || %{}
    auto = app_map(:auto_maintenance)

    %{
      "schema" => @schema,
      "captured_at" => DateTime.utc_now() |> DateTime.to_iso8601(),
      "mix_env" => mix_env(),
      "pid" => System.pid(),
      "provider" => %{
        "selected" => to_string(provider),
        "model" => metadata.model || Map.get(option, :model),
        "endpoint" => redact_endpoint(Map.get(option, :endpoint)),
        # Gateway options 只公开 selected/model/endpoint；thinking/max/timeout 仍是
        # 注入配置的预期，不从 adapter 私有 state 反射，也不冒充已观察。
        "settings_observed" => false,
        "settings_source" => "gateway_provider_options",
        "unobserved_settings" => ["thinking", "reasoning_effort", "max_tokens", "timeout_ms"]
      },
      "context_pressure" => %{
        "provider" => to_string(provider),
        "window" => NovelApplication.ContextPressure.window(to_string(provider)),
        "maintenance_ratio" => context_ratio(:maintenance_ratio, 0.70),
        "hard_ratio" => context_ratio(:hard_ratio, 0.90)
      },
      "auto_maintenance" => %{
        "enabled" => Map.get(auto, :enabled),
        "keep_recent_items" => Map.get(auto, :keep_recent_items)
      },
      "sync_summary_maintenance" =>
        Application.get_env(:novel_application, :sync_chapter_summary_maintenance)
    }
  end

  @doc "把事实写到外部 artifact；目录不存在时创建。"
  def write!(file, facts \\ capture()) do
    file |> Path.dirname() |> File.mkdir_p!()
    File.write!(file, Jason.encode!(facts, pretty: true) <> "\n")
    file
  end

  @doc "endpoint 脱敏：去掉 userinfo/query/fragment，只保留 scheme/host/port/path。"
  def redact_endpoint(nil), do: nil

  def redact_endpoint(endpoint) when is_binary(endpoint) do
    uri = URI.parse(endpoint)

    if is_binary(uri.scheme) and is_binary(uri.host) do
      port = if uri.port, do: ":#{uri.port}", else: ""
      "#{uri.scheme}://#{uri.host}#{port}#{uri.path || ""}"
    else
      "(redacted)"
    end
  end

  def redact_endpoint(_other), do: "(redacted)"

  defp app_map(key) do
    :novel_application
    |> Application.get_env(key, [])
    |> case do
      value when is_list(value) -> Map.new(value)
      value when is_map(value) -> value
      _other -> %{}
    end
  end

  defp context_ratio(key, default) do
    context =
      :novel_application
      |> Application.get_env(:context_pressure, [])
      |> case do
        value when is_list(value) -> Map.new(value)
        value when is_map(value) -> value
        _other -> %{}
      end

    Map.get(context, key, default)
  end

  defp mix_env do
    if Code.ensure_loaded?(Mix), do: Mix.env() |> to_string(), else: System.get_env("MIX_ENV")
  end
end
