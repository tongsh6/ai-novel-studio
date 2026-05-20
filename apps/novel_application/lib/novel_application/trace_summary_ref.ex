defmodule NovelApplication.TraceSummaryRef do
  @moduledoc """
  Normalizes trace references embedded in TurnResult trace summaries.

  v3 contracts use `trace_ref`. Some persisted early checkpoints used `trace_id`,
  so consumers that restore older turns must read both while emitting the
  canonical ref downstream.
  """

  @spec from_turn_result(map() | nil) :: String.t() | nil
  def from_turn_result(turn_result) when is_map(turn_result) do
    turn_result
    |> get_in_any([:trace_summary])
    |> from_trace_summary()
  end

  def from_turn_result(_), do: nil

  @spec from_trace_summary(map() | nil) :: String.t() | nil
  def from_trace_summary(summary) when is_map(summary) do
    normalize_ref(get_in_any(summary, [:trace_ref])) ||
      normalize_ref(get_in_any(summary, [:trace_id]))
  end

  def from_trace_summary(_), do: nil

  defp get_in_any(map, keys) when is_map(map), do: do_get_in_any(map, keys)
  defp get_in_any(_, _), do: nil

  defp do_get_in_any(value, []), do: value

  defp do_get_in_any(map, [key | rest]) when is_map(map) do
    value = Map.get(map, key) || Map.get(map, Atom.to_string(key))
    do_get_in_any(value, rest)
  end

  defp do_get_in_any(_, _), do: nil

  defp normalize_ref(value) when is_binary(value) do
    value = String.trim(value)
    if value == "", do: nil, else: value
  end

  defp normalize_ref(_), do: nil
end
