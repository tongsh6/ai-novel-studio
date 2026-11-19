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
      content: RequestIR.json_value(Map.get(payload, :content, %{}))
    }
  end

  @doc "读取本次实际可见的观察叶；覆盖的原始历史和独立引用表不构成已供应材料。"
  @spec visible_observations(RequestIR.t()) :: [map()]
  def visible_observations(%{messages: messages}) do
    messages
    |> Compaction.project()
    |> Enum.flat_map(&visible_message_observations/1)
  end

  defp visible_message_observations(%{role: "tool", provenance: "tool_result", blocks: blocks}) do
    blocks
    |> Enum.filter(&(&1.type == "observation"))
    |> Enum.flat_map(&observation_payloads/1)
  end

  defp visible_message_observations(%{
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
       })
       when is_map(payload) do
    [payload |> normalize_observation_payload() |> Map.put(:provenance, "application")]
  end

  defp visible_message_observations(_message), do: []

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
