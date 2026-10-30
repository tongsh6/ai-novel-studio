defmodule NovelDomain.EvidenceUsage do
  @moduledoc """
  B39 CP1：模型自报 used_context_refs 的纯校验（#21 引用真实）。

  只判断“自报使用的 ref 是否落在本次请求实际可见的集合内”：
  - Base refs：本次 provider 请求实际携带的底座材料/来源（由调用方按同一请求装配事实给出）；
  - observation refs：本 run 实际取得的只读观察 ref（含底层来源 refs）。

  越界 ref 记为 unbound，不授予证据信用；不修改 artifact 字节、不推断“已使用”。
  模型未自报 → :no_claim；无证据可核 → :unknown；不把“已提供”当“已使用”。
  """

  @type validation :: %{
          used_context_refs: [String.t()],
          unbound_context_refs: [String.t()],
          base_refs: [String.t()],
          observation_refs: [String.t()],
          status: :ok | :partial | :all_unbound | :no_claim | :unknown
        }

  @spec validate([term()], [term()], [term()]) :: validation()
  def validate(used_refs, base_refs, observation_refs) do
    base = normalize_refs(base_refs)
    observations = normalize_refs(observation_refs)
    visible = MapSet.union(MapSet.new(base), MapSet.new(observations))
    used = normalize_refs(used_refs)

    {bound, unbound} = Enum.split_with(used, &MapSet.member?(visible, &1))

    %{
      used_context_refs: bound,
      unbound_context_refs: unbound,
      base_refs: base,
      observation_refs: observations,
      status: status(used, bound, base, observations)
    }
  end

  defp status([], _bound, _base, _observations), do: :no_claim

  defp status(used, bound, base, observations) do
    cond do
      base == [] and observations == [] and bound == [] -> :unknown
      length(used) == length(bound) -> :ok
      bound == [] -> :all_unbound
      true -> :partial
    end
  end

  defp normalize_refs(refs) do
    refs
    |> List.wrap()
    |> Enum.map(&to_string/1)
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.uniq()
  end
end
