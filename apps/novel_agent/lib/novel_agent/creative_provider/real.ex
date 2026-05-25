defmodule NovelAgent.CreativeProvider.Real do
  @moduledoc """
  Real provider adapter for creative tools.

  It asks the injected LLM provider for strict JSON items and validates shape.
  It never supplies demo content or UI/adoption wording.
  """

  @behaviour NovelAgent.CreativeProvider

  alias NovelAgent.Provider.Result, as: ProviderResult
  alias NovelCommon.Contracts.CreativeProviderResult
  alias NovelCommon.Contracts.CreativeRequest
  alias NovelCommon.Contracts.ToolOutputContract

  @impl true
  def generate(%CreativeRequest{} = request, complete_fn) when is_function(complete_fn, 1) do
    prompt = build_prompt(request)

    case complete_fn.(prompt) do
      {:ok, %ProviderResult{content: content}} when is_binary(content) ->
        parse_content(content, nil)

      {:ok, %{content: content} = result} when is_binary(content) ->
        parse_content(content, provider_call_ref(result))

      {:ok, %{"content" => content} = result} when is_binary(content) ->
        parse_content(content, provider_call_ref(result))

      {:ok, content} when is_binary(content) ->
        parse_content(content, nil)

      {:error, error} ->
        provider_error("provider_error", inspect(error))

      other ->
        provider_error(
          "provider_response_unexpected",
          "unexpected provider return: #{inspect(other)}"
        )
    end
  end

  def generate(%CreativeRequest{}, _complete_fn) do
    provider_error("complete_fn_required", "creative provider requires an injected complete_fn")
  end

  defp build_prompt(%CreativeRequest{} = request) do
    """
    你是创作助手。请严格按 JSON 数组格式返回多个候选条目，不要附加任何额外文字。

    每个条目是 JSON 对象，必须包含以下键：
    - "item_id"：你生成的短标识符（不含空格）
    - "title"：简短标题
    - "body"：核心内容
    - "rationale"：一句话依据（或 null）

    capability：#{request.tool_name}
    artifact_type：#{request.artifact_type}
    用户创作简述：#{request.creative_brief}
    上下文：#{request.context_text}

    重要：如果用户输入或上下文中出现任意随机标识符串（字母数字组合），
    必须在至少一个条目的 title/body/rationale 中原样保留。

    只返回 JSON 数组。
    """
  end

  defp parse_content(content, provider_call_ref) do
    trimmed = content |> strip_code_fence() |> String.trim()

    with {:ok, decoded} <- Jason.decode(trimmed),
         {:ok, items} <- ToolOutputContract.validate_creative_items(decoded) do
      %CreativeProviderResult{
        status: :ok,
        items: put_provider_call_ref(items, provider_call_ref),
        provider_call_ref: provider_call_ref
      }
    else
      {:error, %Jason.DecodeError{} = error} ->
        provider_error(
          "provider_response_invalid",
          "JSON decode error: #{Exception.message(error)}"
        )

      {:error, %{code: code, message: message}} ->
        provider_error(code, message)

      {:error, reason} ->
        provider_error("provider_response_invalid", inspect(reason))
    end
  end

  defp provider_call_ref(result) when is_map(result) do
    Map.get(result, :provider_call_id) || Map.get(result, "provider_call_id")
  end

  defp provider_call_ref(_), do: nil

  defp put_provider_call_ref(items, nil), do: items

  defp put_provider_call_ref(items, provider_call_ref) do
    Enum.map(items, &Map.put(&1, :provider_call_ref, provider_call_ref))
  end

  defp strip_code_fence(content) do
    content
    |> String.replace(~r/^```(?:json)?\s*/, "")
    |> String.replace(~r/```\s*$/, "")
  end

  defp provider_error(code, message) do
    %CreativeProviderResult{
      status: :error,
      errors: [%{code: code, message: message}]
    }
  end
end
