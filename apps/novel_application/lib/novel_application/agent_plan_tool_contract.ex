defmodule NovelApplication.AgentPlanToolContract do
  @moduledoc "B26：计划工具输入单一真源，判断同批计划与独立起草共用。"
  @draft_tool_name "agent_plan_draft"
  def tool(tool_name \\ @draft_tool_name) do
    %{
      name: tool_name,
      description: "Return the complete AgentPlan structure for this AgentRun.",
      input_schema: schema()
    }
  end

  @doc """
  计划 tool arguments 的字段级校验错误（task-30）：供计划侧纠正回执给出具体字段指引。
  与 `JudgmentToolContract.valid?/2` 使用同一 schema 子集语义；仅当 valid? 为 false 时调用。
  返回可直接进纠错文案的中文错误列表（空列表=合法）。
  """
  @spec validation_errors(term()) :: [String.t()]
  def validation_errors(args) do
    schema_errors(args, schema(), "arguments")
  end

  defp schema_errors(value, %{anyOf: schemas}, path) do
    if Enum.any?(schemas, &(schema_errors(value, &1, path) == [])) do
      []
    else
      ["#{path} 必须符合允许形态之一（字符串或 null）"]
    end
  end

  defp schema_errors(value, %{enum: values} = schema, path) do
    if value in values do
      schema_errors(value, Map.delete(schema, :enum), path)
    else
      ["#{path} 只能是 #{Enum.join(values, "｜")} 之一（收到 #{inspect(value)}）"]
    end
  end

  defp schema_errors(value, %{type: "object"} = schema, path) when is_map(value) do
    properties = Map.new(schema[:properties] || %{}, fn {k, v} -> {to_string(k), v} end)
    keys = Enum.map(Map.keys(value), &to_string/1)
    required = schema[:required] || []

    missing = Enum.reject(required, &(&1 in keys))

    extras =
      if schema[:additionalProperties] == false,
        do: Enum.reject(keys, &Map.has_key?(properties, &1)),
        else: []

    missing_errors = Enum.map(missing, &"#{path} 缺少必填字段 #{&1}")
    extra_errors = Enum.map(extras, &"#{path} 含未允许字段 #{&1}（schema additionalProperties=false）")

    value_errors =
      Enum.flat_map(value, fn {k, v} ->
        case Map.get(properties, to_string(k)) do
          nil -> []
          property_schema -> schema_errors(v, property_schema, "#{path}.#{k}")
        end
      end)

    missing_errors ++ extra_errors ++ value_errors
  end

  defp schema_errors(value, %{type: "object"}, path),
    do: ["#{path} 必须是 JSON object（收到 #{inspect(value)}）"]

  defp schema_errors(value, %{type: "array"} = schema, path) when is_list(value) do
    min_items = schema[:minItems] || 0

    item_errors =
      value
      |> Enum.with_index()
      |> Enum.flat_map(fn {item, index} ->
        schema_errors(item, schema[:items] || %{}, "#{path}[#{index}]")
      end)

    if length(value) < min_items do
      ["#{path} 至少需要 #{min_items} 个元素"] ++ item_errors
    else
      item_errors
    end
  end

  defp schema_errors(value, %{type: "array"}, path),
    do: ["#{path} 必须是 JSON array（收到 #{inspect(value)}）"]

  defp schema_errors(value, %{type: "string"} = schema, path) when is_binary(value) do
    if String.length(String.trim(value)) >= (schema[:minLength] || 0),
      do: [],
      else: ["#{path} 必须是非空字符串"]
  end

  defp schema_errors(value, %{type: "string"}, path),
    do: ["#{path} 必须是字符串（收到 #{inspect(value)}）"]

  defp schema_errors(value, %{type: "number"} = schema, path) when is_number(value) do
    cond do
      not is_nil(schema[:minimum]) and value < schema.minimum ->
        ["#{path} 不能小于 #{schema.minimum}"]

      not is_nil(schema[:maximum]) and value > schema.maximum ->
        ["#{path} 不能大于 #{schema.maximum}"]

      true ->
        []
    end
  end

  defp schema_errors(value, %{type: "number"}, path), do: ["#{path} 必须是数字（收到 #{inspect(value)}）"]

  defp schema_errors(value, %{type: "integer"}, _path) when is_integer(value), do: []
  defp schema_errors(value, %{type: "integer"}, path), do: ["#{path} 必须是整数（收到 #{inspect(value)}）"]

  defp schema_errors(value, %{type: "boolean"}, _path) when is_boolean(value), do: []

  defp schema_errors(value, %{type: "boolean"}, path),
    do: ["#{path} 必须是布尔值（收到 #{inspect(value)}）"]

  defp schema_errors(nil, %{type: "null"}, _path), do: []
  defp schema_errors(value, %{type: "null"}, path), do: ["#{path} 必须是 null（收到 #{inspect(value)}）"]

  defp schema_errors(_value, schema, _path) when map_size(schema) == 0, do: []

  defp schema_errors(value, schema, path),
    do: ["#{path} 不符合结构要求（收到 #{inspect(value)}，schema=#{inspect(schema)}）"]

  def schema do
    %{
      type: "object",
      required: ["plan", "author_reasoning", "reason_codes", "confidence"],
      additionalProperties: false,
      properties: %{
        author_reasoning: %{
          type: "string",
          minLength: 1,
          description: "本响应的作者可见计划说明原文，content 为空时的叙事来源"
        },
        plan: %{
          type: "object",
          required: ["steps"],
          additionalProperties: false,
          properties: %{
            steps: %{
              type: "array",
              minItems: 1,
              items: %{
                type: "object",
                required: [
                  "step_id",
                  "kind",
                  "description",
                  "success_criteria",
                  "target_tool_ref"
                ],
                additionalProperties: false,
                properties: %{
                  step_id: %{type: "string", minLength: 1},
                  kind: %{type: "string", enum: ["explore", "act"]},
                  description: %{type: "string", minLength: 1},
                  success_criteria: %{type: "array", items: %{type: "string"}},
                  depends_on: %{type: "array", items: %{type: "string"}},
                  target_tool_ref: %{type: "string", minLength: 1},
                  write_intent: %{type: "string", enum: ["none", "tentative"]},
                  risk_hint: %{type: "string", enum: ["low", "medium", "high"]},
                  authoring_intent: %{
                    anyOf: [
                      %{type: "string", enum: ["none", "continuation", "rewrite"]},
                      %{type: "null"}
                    ]
                  },
                  target_chapter: %{anyOf: [%{type: "string"}, %{type: "null"}]},
                  target_chapter_ref: %{anyOf: [%{type: "string"}, %{type: "null"}]},
                  requested_chapter_raw: %{anyOf: [%{type: "string"}, %{type: "null"}]},
                  target_word_count: %{anyOf: [%{type: "integer"}, %{type: "null"}]},
                  exploration_query: %{anyOf: [%{type: "string"}, %{type: "null"}]}
                }
              }
            }
          }
        },
        reason_codes: %{type: "array", items: %{type: "string"}},
        confidence: %{type: "number", minimum: 0, maximum: 1}
      }
    }
  end
end
