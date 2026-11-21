defmodule NovelCommon.Contracts.ToolArgumentSchema do
  @moduledoc "现役工具参数的纯结构校验；对象资格、权限与业务含义由领域边界核验。"

  def valid?(value, %{anyOf: schemas}), do: Enum.any?(schemas, &valid?(value, &1))

  def valid?(value, %{enum: values} = schema),
    do: value in values and valid?(value, Map.delete(schema, :enum))

  def valid?(value, %{type: "object"} = schema) when is_map(value) do
    properties = Map.new(schema[:properties] || %{}, fn {k, v} -> {to_string(k), v} end)
    keys = Enum.map(Map.keys(value), &to_string/1)
    required = schema[:required] || []

    Enum.all?(required, &(&1 in keys)) and
      (schema[:additionalProperties] != false or Enum.all?(keys, &Map.has_key?(properties, &1))) and
      Enum.all?(value, fn {k, v} -> valid?(v, Map.get(properties, to_string(k), %{})) end)
  end

  def valid?(value, %{type: "array"} = schema) when is_list(value),
    do:
      length(value) >= (schema[:minItems] || 0) and
        (schema[:uniqueItems] != true or length(value) == length(Enum.uniq(value))) and
        Enum.all?(value, &valid?(&1, schema[:items] || %{}))

  def valid?(value, %{type: "string"} = schema) when is_binary(value),
    do: String.length(String.trim(value)) >= (schema[:minLength] || 0)

  def valid?(value, %{type: "boolean"}), do: is_boolean(value)
  def valid?(nil, %{type: "null"}), do: true

  def valid?(value, %{type: "number"} = schema) when is_number(value),
    do: within_bounds?(value, schema)

  def valid?(value, %{type: "integer"} = schema) when is_integer(value),
    do: within_bounds?(value, schema)

  def valid?(_, %{type: _}), do: false
  def valid?(_, schema), do: map_size(schema) == 0

  defp within_bounds?(value, schema) do
    (is_nil(schema[:minimum]) or value >= schema.minimum) and
      (is_nil(schema[:maximum]) or value <= schema.maximum)
  end
end
