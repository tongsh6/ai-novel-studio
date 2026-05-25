defmodule NovelAgent.Provider.HTTP do
  @moduledoc """
  Provider 共享 HTTP 客户端。

  封装 Req + Finch 连接池，统一 JSON POST 的请求构造、错误分类和日志。
  LM Studio 和 Anthropic 不再各自处理原始 HTTP 结果。
  """

  require Logger

  @typedoc "Unified HTTP result"
  @type http_result :: {:ok, pos_integer(), map()} | {:error, atom(), pos_integer(), String.t()}

  @doc """
  JSON POST 请求。返回：
  - `{:ok, status, body_map}` — 成功
  - `{:error, reason, http_status_or_0, message}` — 失败

  ## Options
    - `:headers` — 额外请求头
    - `:receive_timeout` — 响应超时（ms）
    - `:connect_timeout` — 连接超时（ms）
  """
  @spec post(String.t(), map(), keyword()) :: http_result()
  def post(url, json_body, opts \\ []) do
    headers = [{"content-type", "application/json"} | Keyword.get(opts, :headers, [])]
    receive_timeout = Keyword.get(opts, :receive_timeout, 300_000)
    connect_timeout = Keyword.get(opts, :connect_timeout, 15_000)

    case Req.post(url,
           json: json_body,
           headers: headers,
           retry: false,
           receive_timeout: receive_timeout,
           connect_options: [timeout: connect_timeout]
         ) do
      {:ok, %{status: status, body: body}} when status in 200..299 ->
        {:ok, status, body}

      {:ok, %{status: status, body: body}} ->
        {:error, :http_error, status, "HTTP #{status}: #{truncate_body(body)}"}

      {:error, %{reason: reason}} when reason in [:econnrefused, :nxdomain] ->
        {:error, :connection_refused, 0, "连接被拒绝: #{reason}"}

      {:error, %{reason: :timeout}} ->
        {:error, :timeout, 0, "请求超时"}

      {:error, other} ->
        Logger.warning("[Provider.HTTP] 未知错误: #{inspect(other)}")
        {:error, :unknown, 0, "请求失败: #{inspect(other)}"}
    end
  end

  defp truncate_body(body) when is_map(body) do
    body |> inspect() |> String.slice(0, 200)
  end

  defp truncate_body(body) when is_binary(body) do
    String.slice(body, 0, 200)
  end

  defp truncate_body(_), do: ""

  @doc """
  HTTP GET 请求（用于健康检查等轻量探测）。

  返回格式与 post/3 一致：
  - `{:ok, status, body}` — 成功
  - `{:error, reason, status_or_0, message}` — 失败
  """
  @spec get(String.t(), keyword()) :: http_result()
  def get(url, opts \\ []) do
    receive_timeout = Keyword.get(opts, :receive_timeout, 15_000)
    connect_timeout = Keyword.get(opts, :connect_timeout, 10_000)

    case Req.get(url,
           retry: false,
           receive_timeout: receive_timeout,
           connect_options: [timeout: connect_timeout]
         ) do
      {:ok, %{status: status}} when status in 200..299 ->
        {:ok, status, %{}}

      {:ok, %{status: status}} ->
        {:error, :http_error, status, "HTTP #{status}"}

      {:error, %{reason: reason}} when reason in [:econnrefused, :nxdomain] ->
        {:error, :connection_refused, 0, "连接被拒绝: #{reason}"}

      {:error, %{reason: :timeout}} ->
        {:error, :timeout, 0, "请求超时"}

      {:error, other} ->
        Logger.warning("[Provider.HTTP] GET 未知错误: #{inspect(other)}")
        {:error, :unknown, 0, "请求失败: #{inspect(other)}"}
    end
  end

  # ── inference params merge ──────────────────

  alias NovelAgent.Provider.InferenceParams

  @doc """
  将 InferenceParams 中的非 nil 字段合并到请求体 map。
  各 adapter 在构建基础请求体后调用此函数统一处理通用参数。
  """
  @spec apply_params(map(), InferenceParams.t()) :: map()
  def apply_params(body, %InferenceParams{} = params) do
    body
    |> put_if(params.temperature, :temperature)
    |> put_if(params.max_tokens, :max_tokens)
    |> put_if(params.top_p, :top_p)
    |> put_if(params.stop, :stop)
  end

  defp put_if(map, nil, _key), do: map
  defp put_if(map, value, key), do: Map.put(map, key, value)
end
