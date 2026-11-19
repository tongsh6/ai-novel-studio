defmodule NovelAgent.Test.Support.PendingDialogueInput do
  @moduledoc """
  仅测试支持：读取当前原生 Scope 的候选/处置事实与独立作者消息。

  唯一状态来源是最新 scope.content.context.interaction_state；操作授权取同一
  scope.content.operation.pending_artifact_targets。旧 Scope、作者引用的 JSON、
  文本段落和普通 wire 文本都不升级为当前应用事实。这里只消费实际请求，不读 DB。
  """

  alias NovelTest.TestProviderPrompt

  @type candidate_state :: :parsed | :explicit_empty | :missing | :bad_format
  @type prompt :: String.t() | map() | [map()]

  @spec normalize(prompt()) :: map()
  def normalize(prompt) do
    scope = TestProviderPrompt.scope_content(prompt)
    facts = get_in(scope || %{}, ["context", "interaction_state"])
    targets = get_in(scope || %{}, ["operation", "pending_artifact_targets"])
    {state, candidates} = candidates_from_facts(facts, targets)

    %{
      author_text: author_text(prompt),
      candidates: candidates,
      request_scope: if(is_map(scope), do: :native, else: :none),
      candidate_source: if(candidates == [], do: :none, else: :interaction_state),
      candidate_state: state,
      message_state_facts: if(is_map(facts), do: facts, else: %{})
    }
  end

  @spec material_state(prompt()) :: map()
  def material_state(prompt) do
    normalized = normalize(prompt)
    facts = normalized.message_state_facts
    pending = Enum.map(normalized.candidates, &material_entry_from_candidate/1)

    resolved =
      facts
      |> Map.get("resolved_adoptions", [])
      |> List.wrap()
      |> Enum.flat_map(&material_entry_from_facts/1)

    %{
      state: normalized.candidate_state,
      supplied?: normalized.candidate_state != :missing or material_facts_supplied?(facts),
      pending: pending,
      resolved: resolved,
      pending_count: count_from_facts(facts, "pending_adoption_count", length(pending)),
      resolved_count: count_from_facts(facts, "resolved_adoption_count", length(resolved)),
      omitted_count: count_from_facts(facts, "omitted_adoptions", 0)
    }
  end

  @doc "通用文本观测仅展示实际 Scope JSON 和独立作者原字节；不重建旧中文材料协议。"
  @spec material_text(prompt(), String.t() | nil) :: String.t()
  def material_text(prompt, fallback \\ nil)
  def material_text(prompt, _fallback) when is_binary(prompt), do: prompt

  def material_text(prompt, _fallback) when is_map(prompt) or is_list(prompt) do
    scope = TestProviderPrompt.latest_scope(prompt) || ""
    author = author_text(prompt)
    if author == "", do: scope, else: scope <> "\n## 作者输入\n" <> author
  end

  def material_text(_prompt, fallback), do: fallback || ""

  @spec author_text(prompt()) :: String.t()
  def author_text(prompt) when is_binary(prompt) do
    # 只拆通用文本观测的作者边界，后续全部字节都属于作者（包括标题/JSON/空白）。
    case String.split(prompt, "## 作者输入\n", parts: 2) do
      [_view, author] -> author
      _ -> prompt
    end
  end

  def author_text(prompt), do: TestProviderPrompt.author_text(prompt)

  @spec candidates(prompt()) :: [map()]
  def candidates(prompt), do: normalize(prompt).candidates

  @spec message_state_facts(prompt()) :: map()
  def message_state_facts(prompt), do: normalize(prompt).message_state_facts

  @spec request_scope(prompt()) :: :native | :none
  def request_scope(prompt), do: normalize(prompt).request_scope

  @spec candidate_state(prompt()) :: candidate_state()
  def candidate_state(prompt), do: normalize(prompt).candidate_state

  defp candidates_from_facts(nil, _targets), do: {:missing, []}
  defp candidates_from_facts(facts, _targets) when not is_map(facts), do: {:bad_format, []}

  defp candidates_from_facts(facts, targets) do
    case Map.fetch(facts, "pending_adoptions") do
      :error ->
        {:missing, []}

      {:ok, []} ->
        {:explicit_empty, []}

      {:ok, entries} when is_list(entries) ->
        parsed = Enum.map(entries, &candidate(&1, targets || %{}))

        if Enum.any?(parsed, &(&1 == :error)),
          do: {:bad_format, []},
          else: {:parsed, Enum.map(parsed, fn {:ok, entry} -> entry end)}

      _ ->
        {:bad_format, []}
    end
  end

  defp candidate(entry, targets) when is_map(entry) and is_map(targets) do
    ref = Map.get(entry, "artifact_ref")
    operations = Map.get(targets, ref, [])

    if is_binary(ref) and String.trim(ref) != "" and is_list(operations) and
         Enum.all?(operations, &is_binary/1) do
      {:ok,
       %{
         ref: ref,
         artifact_type: text_or_nil(Map.get(entry, "artifact_type")),
         status: text_or_nil(Map.get(entry, "status")),
         title: text_or_nil(Map.get(entry, "title")),
         operations: operations,
         revision_of: text_or_nil(Map.get(entry, "revision_of")),
         origin: :interaction_state
       }}
    else
      :error
    end
  end

  defp candidate(_entry, _targets), do: :error

  defp material_facts_supplied?(facts) do
    Enum.any?(
      [
        "pending_adoptions",
        "resolved_adoptions",
        "pending_adoption_count",
        "resolved_adoption_count"
      ],
      &Map.has_key?(facts, &1)
    )
  end

  defp material_entry_from_candidate(candidate) do
    Map.take(candidate, [:ref, :status, :title, :revision_of])
    |> Map.put(:source, :candidate)
  end

  defp material_entry_from_facts(entry) when is_map(entry) do
    [
      %{
        ref: text_or_nil(Map.get(entry, "artifact_ref")),
        status: text_or_nil(Map.get(entry, "status")),
        title: text_or_nil(Map.get(entry, "title")),
        revision_of: text_or_nil(Map.get(entry, "revision_of")),
        source: :resolved_facts
      }
    ]
  end

  defp material_entry_from_facts(_entry), do: []

  defp count_from_facts(facts, key, default) do
    case Map.get(facts, key) do
      count when is_integer(count) and count >= 0 -> count
      _ -> default
    end
  end

  defp text_or_nil(text) when is_binary(text) do
    if String.trim(text) == "", do: nil, else: text
  end

  defp text_or_nil(_text), do: nil
end
