defmodule NovelApplication.Toolbox do
  @moduledoc """
  工具执行运行时。接收已批准的 ToolRequest，执行工具，返回 ToolResult。

  ## 调用契约

  - `execute/1`：仅用于不依赖 LLM Provider 的工具（如 text_analysis）。
    对依赖 Provider 的工具会返回 `status=:failed` ToolResult，强制调用方走 `execute/2`。
  - `execute/2`：注入 complete_fn，依赖 LLM 的工具走 Provider 字节透传链路。

  ## I3 不变量

  对于依赖 LLM 的工具，`ToolResult.output.items` 中每个 item 的 `title/body/rationale`
  字段必须来自 Provider 响应的字节透传，不允许产品代码修饰、补齐、合并。详见
  `docs/engineering/scenario-invariants.md` §2.1 + §2.3。
  """

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelAgent.Provider.Result, as: ProviderResult
  alias NovelApplication.CapabilityRegistry
  alias NovelCommon.LogContext
  alias NovelDomain.ToolRequest
  alias NovelDomain.ToolResult

  @doc """
  执行 ToolRequest，不注入 Provider。仅用于不依赖 LLM 的工具。

  对依赖 LLM 的工具，返回 `status=:failed` ToolResult，
  调用方应使用 `execute/2` 显式注入 complete_fn。
  """
  @spec execute(ToolRequest.t()) :: ToolResult.t()
  def execute(%ToolRequest{} = req) do
    execute_impl(req, nil)
  end

  @doc """
  执行 ToolRequest，注入 Provider complete_fn。

  对依赖 LLM 的工具，complete_fn 用于调用 Provider，
  响应字节透传到 `ToolResult.output.items`。
  """
  @spec execute(
          ToolRequest.t(),
          (String.t() -> {:ok, ProviderResult.t()} | {:error, map()})
        ) :: ToolResult.t()
  def execute(%ToolRequest{} = req, complete_fn) when is_function(complete_fn, 1) do
    execute_impl(req, complete_fn)
  end

  defp execute_impl(req, complete_fn) do
    result_id = "tr_#{System.unique_integer([:positive, :monotonic])}"
    now = DateTime.utc_now()

    t0 = System.monotonic_time(:millisecond)
    LogContext.put_tool_request(req.tool_request_id)

    LogEmit.emit(:toolbox, :execute, :start, %{
      tool_name: req.tool_name,
      tool_request_id: req.tool_request_id
    })

    result =
      cond do
        is_nil(CapabilityRegistry.get(req.tool_name)) ->
          failed_tool_result(req, result_id, now, "unknown_tool", "tool not found in registry")

        not CapabilityRegistry.dispatchable?(req.tool_name) ->
          failed_tool_result(
            req,
            result_id,
            now,
            "tool_not_dispatchable",
            "tool is disabled or deprecated"
          )

        not CapabilityRegistry.grants_valid?(
          req.tool_name,
          req.read_scope_grants,
          req.write_scope_grants
        ) ->
          failed_tool_result(
            req,
            result_id,
            now,
            "grant_scope_violation",
            "requested grants exceed registry scopes"
          )

        true ->
          dispatch(req, result_id, now, complete_fn)
      end

    duration = System.monotonic_time(:millisecond) - t0

    if result.status == :succeeded do
      LogEmit.emit(:toolbox, :execute, :done, %{
        tool_name: req.tool_name,
        tool_outcome: :succeeded,
        duration_ms: duration
      })
    else
      error_code = (result.errors |> hd()).code

      LogEmit.emit(:toolbox, :execute, :error, %{
        tool_name: req.tool_name,
        tool_outcome: result.status,
        reason_code: error_code,
        duration_ms: duration
      })
    end

    result
  end

  # ── non-LLM tool ──

  defp dispatch(%ToolRequest{tool_name: "text_analysis"} = req, result_id, now, _complete_fn) do
    text = Map.get(req.input, "text", "")
    genre = Map.get(req.input, "genre", "")

    analysis = %{
      word_count: count_words(text),
      estimated_reading_time_minutes: estimate_reading_time(text),
      genre_match:
        genre != "" and String.contains?(String.downcase(text), String.downcase(genre)),
      tone_suggestion: suggest_tone(text)
    }

    %ToolResult{
      tool_result_id: result_id,
      tool_request_ref: req.tool_request_id,
      tool_name: "text_analysis",
      status: :succeeded,
      output: analysis,
      state_delta: [%{type: :observation, key: "text_analysis", value: analysis}],
      usage: %{duration_ms: 0, tool: "text_analysis", version: "1.0.0"},
      trace_refs: ["tool_trace:#{result_id}"],
      completed_at: now
    }
  end

  # ── LLM-dependent tools ──

  defp dispatch(
         %ToolRequest{tool_name: "creative_generation"} = req,
         result_id,
         now,
         complete_fn
       ) do
    direction = Map.get(req.input, "direction", "character_seed")
    creative_dispatch(req, result_id, now, direction, complete_fn)
  end

  defp dispatch(%ToolRequest{tool_name: "world_building"} = req, result_id, now, complete_fn) do
    creative_dispatch(req, result_id, now, "world_setting", complete_fn)
  end

  defp dispatch(%ToolRequest{tool_name: "character_design"} = req, result_id, now, complete_fn) do
    creative_dispatch(req, result_id, now, "character_seed", complete_fn)
  end

  defp dispatch(%ToolRequest{tool_name: "plot_outline"} = req, result_id, now, complete_fn) do
    creative_dispatch(req, result_id, now, "outline_draft", complete_fn)
  end

  defp dispatch(%ToolRequest{tool_name: "prose_writing"} = req, result_id, now, complete_fn) do
    creative_dispatch(req, result_id, now, "prose_fragment", complete_fn)
  end

  defp dispatch(_req, result_id, now, _complete_fn) do
    %ToolResult{
      tool_result_id: result_id,
      tool_request_ref: "unknown",
      tool_name: "unknown",
      status: :failed,
      errors: [%{code: "no_handler", message: "no dispatch handler for this tool"}],
      completed_at: now
    }
  end

  # 不可绕过原则：LLM-dependent tool 在 complete_fn=nil 时必须失败，
  # 不允许 fallback 到默认 Gateway 或 hardcoded 内容。
  defp creative_dispatch(%ToolRequest{} = req, result_id, now, _direction, nil) do
    failed_tool_result(
      req,
      result_id,
      now,
      "complete_fn_required",
      "LLM-dependent tool requires Provider — call Toolbox.execute/2 with complete_fn"
    )
  end

  defp creative_dispatch(%ToolRequest{} = req, result_id, now, direction, complete_fn) do
    prompt = build_creative_prompt(req, direction)

    case complete_fn.(prompt) do
      {:ok, %ProviderResult{content: content}} when is_binary(content) ->
        handle_provider_content(req, result_id, now, direction, content, nil)

      {:ok, %{content: content} = result} when is_binary(content) ->
        handle_provider_content(req, result_id, now, direction, content, extract_call_id(result))

      {:ok, %{"content" => content} = result} when is_binary(content) ->
        handle_provider_content(req, result_id, now, direction, content, extract_call_id(result))

      {:ok, content} when is_binary(content) ->
        handle_provider_content(req, result_id, now, direction, content, nil)

      {:error, error} ->
        failed_tool_result(req, result_id, now, "provider_error", inspect(error))

      other ->
        failed_tool_result(
          req,
          result_id,
          now,
          "provider_response_unexpected",
          "unexpected provider return: #{inspect(other)}"
        )
    end
  end

  # I1 因果绑定（scenario-invariants.md §2.1）：driver/中间件可在 complete_fn
  # 返回 map 中附 :provider_call_id 字段，Toolbox 把它字节透传到每个 item.provider_call_ref，
  # 用于事后由验证脚本做精确字节追溯。生产路径未注入时为 nil（向后兼容）。
  defp extract_call_id(result) when is_map(result) do
    Map.get(result, :provider_call_id) || Map.get(result, "provider_call_id")
  end

  defp extract_call_id(_), do: nil

  defp handle_provider_content(req, result_id, now, direction, content, provider_call_id) do
    case parse_creative_response(content) do
      {:ok, items} ->
        items = Enum.map(items, &Map.put(&1, :provider_call_ref, provider_call_id))
        artifact_type = String.to_atom(direction)

        %ToolResult{
          tool_result_id: result_id,
          tool_request_ref: req.tool_request_id,
          tool_name: req.tool_name,
          status: :succeeded,
          output: %{
            artifact_type: artifact_type,
            item_count: length(items),
            items: items
          },
          state_delta: [
            %{type: :tentative_artifact, key: req.tool_name, artifact_type: artifact_type}
          ],
          artifact_refs: Enum.map(items, & &1.item_id),
          usage: %{duration_ms: 0, tool: req.tool_name, version: "1.0.0"},
          trace_refs: ["tool_trace:#{result_id}"],
          completed_at: now
        }

      {:error, reason} ->
        failed_tool_result(req, result_id, now, "provider_response_invalid", reason)
    end
  end

  # Prompt 模板按 scenario-invariants.md §4 属于允许的字符串字面量
  # （contract / request template，不含具体作品内容）。
  defp build_creative_prompt(%ToolRequest{} = req, direction) do
    text = Map.get(req.input, "text", "")
    context_text = Map.get(req.input, "context_text", "")

    """
    你是创作助手。请严格按 JSON 数组格式返回多个候选条目，不要附加任何额外文字。

    每个条目是 JSON 对象，必须包含以下键：
    - "item_id"：你生成的短标识符（不含空格）
    - "title"：简短标题
    - "body"：核心内容
    - "rationale"：一句话依据（或 null）

    direction：#{direction}
    用户输入：#{text}
    上下文：#{context_text}

    重要：如果用户输入或上下文中出现任意随机标识符串（字母数字组合），
    必须在至少一个条目的 title/body/rationale 中原样保留。

    只返回 JSON 数组。
    """
  end

  defp parse_creative_response(content) do
    trimmed = content |> strip_code_fence() |> String.trim()

    case Jason.decode(trimmed) do
      {:ok, list} when is_list(list) and list != [] ->
        reduce_items(list)

      {:ok, []} ->
        {:error, "provider returned empty JSON array"}

      {:ok, _other} ->
        {:error, "expected JSON array at top level"}

      {:error, %Jason.DecodeError{} = e} ->
        {:error, "JSON decode error: #{Exception.message(e)}"}
    end
  end

  defp reduce_items(list) do
    Enum.reduce_while(list, [], fn raw, acc ->
      case normalize_item(raw) do
        {:ok, item} -> {:cont, [item | acc]}
        {:error, _} = err -> {:halt, err}
      end
    end)
    |> case do
      {:error, _} = err -> err
      acc when is_list(acc) -> {:ok, Enum.reverse(acc)}
    end
  end

  defp normalize_item(raw) when is_map(raw) do
    with {:ok, item_id} <- fetch_string(raw, "item_id"),
         {:ok, title} <- fetch_string(raw, "title"),
         {:ok, body} <- fetch_string(raw, "body") do
      rationale =
        case Map.get(raw, "rationale") do
          s when is_binary(s) -> s
          _ -> nil
        end

      {:ok, %{item_id: item_id, title: title, body: body, rationale: rationale}}
    end
  end

  defp normalize_item(_raw), do: {:error, "item must be a JSON object"}

  defp fetch_string(map, key) do
    case Map.get(map, key) do
      s when is_binary(s) and byte_size(s) > 0 -> {:ok, s}
      _ -> {:error, "missing or non-string field: #{key}"}
    end
  end

  defp strip_code_fence(content) do
    content
    |> String.replace(~r/^```(?:json)?\s*/, "")
    |> String.replace(~r/```\s*$/, "")
  end

  defp failed_tool_result(req, result_id, now, code, message) do
    %ToolResult{
      tool_result_id: result_id,
      tool_request_ref: req.tool_request_id,
      tool_name: req.tool_name,
      status: :failed,
      errors: [%{code: code, message: message}],
      completed_at: now
    }
  end

  # ── text_analysis helpers ──

  defp count_words(text), do: text |> String.split(~r/\s+/, trim: true) |> length()
  defp estimate_reading_time(text), do: max(1, round(count_words(text) / 250))
  defp suggest_tone(text), do: if(String.length(text) > 100, do: "narrative", else: "fragment")
end
