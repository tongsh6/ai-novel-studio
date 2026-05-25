defmodule NovelCommon.Contracts.ToolOutputContract do
  @moduledoc """
  Validation helpers for creative tool output contracts.
  """

  @creative_artifact_types [
    :character_seed,
    :plot_direction,
    :outline_draft,
    :scene_draft,
    :prose_fragment,
    :world_setting
  ]

  @spec creative_artifact_types() :: [atom()]
  def creative_artifact_types, do: @creative_artifact_types

  @spec known_creative_artifact_type?(atom() | String.t()) :: boolean()
  def known_creative_artifact_type?(type) do
    case normalize_artifact_type(type) do
      {:ok, _} -> true
      {:error, _} -> false
    end
  end

  @spec normalize_artifact_type(atom() | String.t()) :: {:ok, atom()} | {:error, map()}
  def normalize_artifact_type(type) when is_atom(type) do
    if type in @creative_artifact_types do
      {:ok, type}
    else
      {:error,
       %{code: "unknown_artifact_type", message: "unknown artifact_type: #{inspect(type)}"}}
    end
  end

  def normalize_artifact_type(type) when is_binary(type) do
    type
    |> String.to_existing_atom()
    |> normalize_artifact_type()
  rescue
    ArgumentError ->
      {:error, %{code: "unknown_artifact_type", message: "unknown artifact_type: #{type}"}}
  end

  def normalize_artifact_type(type) do
    {:error, %{code: "invalid_artifact_type", message: "invalid artifact_type: #{inspect(type)}"}}
  end

  @spec validate_creative_items(term()) :: {:ok, [map()]} | {:error, map()}
  def validate_creative_items(items) when is_list(items) and items != [] do
    items
    |> Enum.reduce_while([], fn raw, acc ->
      case normalize_item(raw) do
        {:ok, item} -> {:cont, [item | acc]}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
    |> case do
      {:error, _} = error -> error
      normalized -> {:ok, Enum.reverse(normalized)}
    end
  end

  def validate_creative_items([]) do
    {:error, %{code: "empty_items", message: "creative tool output must contain items"}}
  end

  def validate_creative_items(_items) do
    {:error,
     %{code: "invalid_items", message: "creative tool output items must be a non-empty list"}}
  end

  defp normalize_item(raw) when is_map(raw) do
    with {:ok, item_id} <- fetch_string(raw, :item_id),
         {:ok, title} <- fetch_string(raw, :title),
         {:ok, body} <- fetch_string(raw, :body) do
      rationale = map_get(raw, :rationale)
      provider_call_ref = map_get(raw, :provider_call_ref)

      item =
        %{
          item_id: item_id,
          title: title,
          body: body,
          rationale: if(is_binary(rationale), do: rationale, else: nil)
        }

      item =
        if is_binary(provider_call_ref) do
          Map.put(item, :provider_call_ref, provider_call_ref)
        else
          item
        end

      {:ok, item}
    end
  end

  defp normalize_item(_raw) do
    {:error, %{code: "invalid_item", message: "creative item must be a map"}}
  end

  defp fetch_string(map, key) do
    case map_get(map, key) do
      value when is_binary(value) and byte_size(value) > 0 ->
        {:ok, value}

      _ ->
        {:error, %{code: "invalid_item_field", message: "missing or invalid field: #{key}"}}
    end
  end

  defp map_get(map, key), do: Map.get(map, key) || Map.get(map, Atom.to_string(key))
end
