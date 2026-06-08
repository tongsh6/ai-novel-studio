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

  # 正文写作质量约束（show-don't-tell / 对白个性化 / 反 AI 套话 / 节奏）。
  # 面向真实作者的写作质量要求，集中在此便于维护（如日后扩充套话黑名单）。
  # 注意位置：必须放在 stub/slice_verify provider 解析的
  # 「用户创作简述：…上下文：…重要：」三锚点之后，否则会污染 brief/context 捕获
  # （见记忆 creative-prompt-stub-anchor-coupling）。
  @prose_writing_guidelines """
  写作要求：
  - 用动作、神态、对白和具体细节表现情绪，禁止直接断言"他很生气""她很悲伤"这类总结句。
  - 对白要贴合各人物的性格与处境，不同人物的说话方式应有区别。
  - 避免"随着""在……中""阳光洒落""不由得""仿佛"等 AI 套话式表达。
  - 节奏紧凑，删去与情节和人物无关的环境与背景堆砌。
  - 若创作简述给出"目标字数：约 N 字"，正文篇幅应贴近该字数，不要明显过短，也不要靠重复句子注水。
  """

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

  # prose_writing：写一章/一段正文，结果应是一段连贯文本，而不是多个互相竞争、
  # 各自从头另起的开头。因此要求"恰好一个连贯条目"。其余创意发散类能力（大纲、
  # 人物草案等）仍返回多个候选供作者择一。
  defp build_prompt(%CreativeRequest{tool_name: "prose_writing"} = request) do
    """
    你是小说正文写作助手。请严格按 JSON 数组格式返回恰好一个连贯条目，不要附加任何额外文字。

    该条目是 JSON 对象，必须包含以下键：
    - "item_id"：你生成的短标识符（不含空格）
    - "title"：本段正文的简短标题（只给一个标题，不要罗列多个备选）
    - "body"：一段连贯、完整的正文。直接写正文，不要在开头重复标题或章节名，也不要把同一情节用多个不同开头写多遍。若上下文中已给出本章前文，请在其后自然衔接续写，承接情节与人物状态，不要从头另起或重复已写内容。
    - "rationale"：一句话依据（或 null）

    capability：#{request.tool_name}
    artifact_type：#{request.artifact_type}
    用户创作简述：#{request.creative_brief}
    上下文：#{request.context_text}

    重要：如果用户创作简述中出现任意随机标识符串（字母数字组合），必须在该条目的 body 或 rationale 中原样保留至少一处。

    #{@prose_writing_guidelines}
    只返回包含单个对象的 JSON 数组。
    """
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

    重要：如果用户创作简述中出现任意随机标识符串（字母数字组合），
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
