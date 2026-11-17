defmodule NovelCommon.RequestIR.DiscussionSummary do
  @moduledoc """
  R03 讨论摘要的纯来源/字节契约。摘要是模型派生历史，不是 canon 或执行权限。
  原响应只存一份；解析后的条目只作校验与投影。语义完整性需真实模型验收。
  """
  alias NovelCommon.RequestIR.MessageCoverage

  @version "authoring-discussion-summary/v1"
  @source_key_prefix "authoring-session-source/v1:"
  @discussion_keys ~w(response_text response_sha256 provider_call_ref provider_run_ref)a
  @entry_keys ~w(source_index summary retained_obligations)
  @max_response_bytes 131_072
  @max_input_bytes 131_072

  def version, do: @version

  @doc "来源身份只绑定已有会话坐标；正文和摘要协议属于请求完整性，不参与分配身份。"
  @spec source_key(map(), map()) :: String.t()
  def source_key(%{source: %{run_id: run_id, run_sequence: sequence}}, scope) do
    @source_key_prefix <>
      Jason.encode!([
        field(scope, :workspace_id),
        field(scope, :work_id),
        field(scope, :session_id),
        run_id,
        sequence
      ])
  end

  @doc "来源归属编码必须可辨识；旧内容指纹不作为新坐标身份读取。"
  def valid_source_key?(@source_key_prefix <> encoded = key, scope) do
    expected_scope = Enum.map([:workspace_id, :work_id, :session_id], &field(scope, &1))

    case Jason.decode(encoded) do
      {:ok, [workspace, work, session, run_id, sequence]}
      when is_binary(run_id) and is_integer(sequence) and sequence > 0 ->
        [workspace, work, session] == expected_scope and nonblank?(run_id) and
          key == source_key(%{source: %{run_id: run_id, run_sequence: sequence}}, scope)

      _ ->
        false
    end
  end

  def valid_source_key?(_key, _scope), do: false

  @doc "规划与执行共用完整来源的实际 JSON 字节边界；绝不截原文以满足预算。"
  def material(sources) when is_list(sources) do
    case Jason.encode(%{material_kind: "quoted_discussion_sources", sources: sources}) do
      {:ok, text} when byte_size(text) <= @max_input_bytes -> {:ok, text}
      {:ok, _text} -> {:error, :discussion_summary_input_budget_exceeded}
      {:error, _reason} -> {:error, :discussion_summary_input_invalid}
    end
  end

  def validate(nil, []), do: :ok
  def validate(_discussion, []), do: {:error, :checkpoint_unexpected_discussion}

  def validate(discussion, [_ | _] = sources) when is_map(discussion) do
    with :ok <- validate_source(discussion),
         {:ok, entries} <- decode(discussion.response_text),
         true <- length(entries) == length(sources),
         true <- Enum.all?(Enum.zip(entries, sources), &valid_entry?/1) do
      :ok
    else
      _ -> {:error, :checkpoint_invalid_discussion}
    end
  end

  def validate(_discussion, _sources), do: {:error, :checkpoint_discussion_required}

  def entries(%{response_text: text}) do
    {:ok, entries} = decode(text)
    entries
  end

  def projection(nil, _references), do: nil

  def projection(discussion, references) do
    sources = Enum.filter(references, &(&1.role == "assistant"))

    projected =
      discussion
      |> entries()
      |> Enum.zip(sources)
      |> Enum.map(fn {entry, source} ->
        %{
          source: MessageCoverage.source_ref(source),
          locator: Map.take(source, [:run_id, :run_sequence]),
          summary: entry["summary"],
          retained_obligations: entry["retained_obligations"]
        }
      end)

    %{provenance: "model_derived_history", authority: "none", entries: projected}
  end

  defp validate_source(discussion) do
    valid =
      Enum.sort(Map.keys(discussion)) == Enum.sort(@discussion_keys) and
        Enum.all?(@discussion_keys, &nonblank?(Map.get(discussion, &1))) and
        byte_size(discussion.response_text) <= @max_response_bytes and
        discussion.response_sha256 == sha256(discussion.response_text)

    if valid, do: :ok, else: {:error, :invalid_discussion_source}
  end

  defp decode(text) do
    case Jason.decode(text) do
      {:ok, %{"version" => @version, "entries" => [_ | _] = entries} = value}
      when map_size(value) == 2 ->
        {:ok, entries}

      _ ->
        {:error, :invalid_discussion_output}
    end
  end

  defp valid_entry?({entry, source}) when is_map(entry) do
    Enum.sort(Map.keys(entry)) == Enum.sort(@entry_keys) and
      Map.get(entry, "source_index") == source.source_index and
      nonblank?(Map.get(entry, "summary")) and
      valid_obligations?(Map.get(entry, "retained_obligations"), source.text)
  end

  defp valid_entry?(_entry), do: false

  defp valid_obligations?(quotes, text) when is_list(quotes) do
    length(Enum.uniq(quotes)) == length(quotes) and
      Enum.all?(quotes, &(nonblank?(&1) and String.contains?(text, &1)))
  end

  defp valid_obligations?(_quotes, _text), do: false

  defp nonblank?(value) when is_binary(value),
    do: String.valid?(value) and String.trim(value) != ""

  defp nonblank?(_value), do: false
  defp field(map, key), do: Map.get(map, key) || Map.get(map, to_string(key))
  defp sha256(text), do: :crypto.hash(:sha256, text) |> Base.encode16(case: :lower)
end
