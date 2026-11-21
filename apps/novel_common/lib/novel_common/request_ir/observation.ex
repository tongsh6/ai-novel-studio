defmodule NovelCommon.RequestIR.Observation do
  @moduledoc """
  Canonical 观察的纯结构、叶恢复与请求可见性（VS-00M §5.2.3）。

  只读取已经供应的 canonical 消息，保留原生工具结果与已执行计划读取的来源差异。
  不读取作品、不执行探索，也不从关联引用或隐藏历史生成正文或完整性。
  """

  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Compaction

  @doc "只读观察块（I-ART-4：status 必须如实）。"
  def block(call_id, payload) do
    %{
      type: "observation",
      call_id: call_id,
      status: Map.get(payload, :status, "ok"),
      source_refs: Map.get(payload, :source_refs, []),
      versions: RequestIR.json_value(Map.get(payload, :versions, %{})),
      coverage: RequestIR.json_value(Map.get(payload, :coverage, %{})),
      omissions: Map.get(payload, :omissions, []),
      next_offset: Map.get(payload, :next_offset),
      content: RequestIR.json_value(Map.get(payload, :content, %{})),
      retryable: Map.get(payload, :retryable),
      budget_after: RequestIR.json_value(Map.get(payload, :budget_after))
    }
  end

  @doc "读取本次实际可见的观察叶；覆盖的原始历史和独立引用表不构成已供应材料。"
  @spec visible_observations(RequestIR.t()) :: [map()]
  def visible_observations(request), do: project_observations(request, :all)

  @doc """
  读取本次可用观察材料，保留原始来源与覆盖边界。

  工具关联元数据本身不是材料；真实空读可用摘要或零值事实计数表达。
  """
  @spec usable_observations(RequestIR.t()) :: [map()]
  def usable_observations(request) do
    request
    |> project_observations(["ok", "partial", "truncated"])
    |> Enum.filter(&usable?/1)
  end

  @doc "规范化观察是否真正供应了可用内容；用于原生接收与应用读取绑定的同一判据。"
  @spec usable?(map()) :: boolean()
  def usable?(observation) when is_map(observation) do
    status_allowed?(observation, ["ok", "partial", "truncated"]) and
      read_content?(Map.get(observation, :content))
  end

  def usable?(_observation), do: false

  @doc """
  读取已登记且本次原生工具观察供应的引用；聚合父、叶与压缩边界均须成立。
  应用计划读取保持 Base 归属，不因被误登在观察目录而改变来源身份。

  partial/truncated 只证明已供应部分可用，不把覆盖提升为完整；unavailable/stale 不授信。
  """
  @spec usable_refs(RequestIR.t()) :: [map() | String.t()]
  def usable_refs(%{refs: refs} = request) do
    available =
      request
      |> usable_observations()
      |> Enum.reject(&(&1[:provenance] == "application"))
      |> Enum.flat_map(&payload_refs/1)
      |> MapSet.new(&ref_key/1)

    refs
    |> Map.get(:observation_refs, [])
    |> Enum.filter(&MapSet.member?(available, ref_key(&1)))
  end

  defp project_observations(%{messages: messages}, statuses) do
    messages
    |> Compaction.project()
    |> Enum.flat_map(&visible_message_observations(&1, statuses))
  end

  defp visible_message_observations(
         %{role: "tool", provenance: "tool_result", blocks: blocks},
         statuses
       ) do
    for block <- blocks,
        block.type == "observation",
        status_allowed?(block, statuses),
        payload <- observation_payloads(block),
        status_allowed?(payload, statuses),
        do: payload
  end

  defp visible_message_observations(
         %{
           role: "scope_update",
           provenance: "application",
           blocks: [
             %{
               type: "scope",
               content: %{
                 "operation" => %{"role" => "planned_exploration"},
                 "facts" => %{"exploration_result" => payload}
               }
             }
           ]
         },
         statuses
       )
       when is_map(payload) do
    observation =
      payload |> normalize_observation_payload() |> Map.put(:provenance, "application")

    if status_allowed?(observation, statuses), do: [observation], else: []
  end

  defp visible_message_observations(_message, _statuses), do: []

  defp status_allowed?(_observation, :all), do: true
  defp status_allowed?(observation, statuses), do: Map.get(observation, :status) in statuses

  defp read_content?(content) when is_binary(content), do: String.trim(content) != ""

  defp read_content?(content) when is_map(content) do
    summary = Map.get(content, :summary) || Map.get(content, "summary")
    facts = Map.get(content, :facts) || Map.get(content, "facts")

    (is_binary(summary) and String.trim(summary) != "") or
      (is_map(facts) and map_size(facts) > 0) or (is_list(facts) and facts != [])
  end

  defp read_content?(_content), do: false

  defp payload_refs(observation) do
    sources = Map.get(observation, :source_refs, [])

    identity =
      case Map.get(observation, :content) do
        %{"observation_ref" => "observation:" <> _identity = ref} -> [ref]
        _ -> []
      end

    if is_list(sources), do: sources ++ identity, else: identity
  end

  @observation_payload_fields ~w(status source_refs versions coverage omissions next_offset content)a

  @doc """
  读取已建 canonical observation 的实际观察单元。

  直接观察返回自身；仅 `content.tool == "planned_exploration"` 的计划内联聚合
  返回一层完整叶。canonical content 经 `json_value/1` 后是字符串键，这里只把叶
  实际存在的既有顶层字段换回原子键，供证据与身份读取统一访问；不补缺省、不递归、
  不读摘要文本。
  """
  @spec observation_payloads(map()) :: [map()]
  def observation_payloads(%{
        type: "observation",
        content: %{"tool" => "planned_exploration", "observations" => leaves}
      })
      when is_list(leaves) do
    for leaf <- leaves, is_map(leaf), do: normalize_observation_payload(leaf)
  end

  def observation_payloads(observation), do: [observation]

  defp normalize_observation_payload(payload) do
    for key <- @observation_payload_fields,
        {:ok, value} <- [fetch_field(payload, key)],
        into: %{},
        do: {key, value}
  end

  def validate(%{call_id: call_id, status: status, source_refs: refs} = block)
      when is_binary(call_id) and call_id != "" and is_list(refs) do
    cond do
      status not in ["ok", "partial", "truncated", "unavailable", "stale"] ->
        {:error, {:invalid_observation_status, status}}

      not is_map(Map.get(block, :versions, %{})) or
          not Enum.all?(refs, &(is_binary(ref_key(&1)) and ref_key(&1) != "")) ->
        {:error, :invalid_observation_block}

      true ->
        :ok
    end
  end

  def validate(_block), do: {:error, :invalid_observation_block}

  defp ref_key(%{ref: ref}), do: ref
  defp ref_key(%{"ref" => ref}), do: ref
  defp ref_key(ref), do: ref

  defp fetch_field(value, key) do
    case Map.fetch(value, key) do
      :error -> Map.fetch(value, Atom.to_string(key))
      found -> found
    end
  end
end
