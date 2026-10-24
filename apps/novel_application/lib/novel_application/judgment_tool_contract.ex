defmodule NovelApplication.JudgmentToolContract do
  @moduledoc "B26：固定判断工具 schema 与同源字段校验，合法对象在派发前另行验证。"

  @version "b26-tools-v1"
  def version, do: @version

  # 判断调用唯一合法工具组合的文案真源：产品 prompt 与 invalid_tool_combination
  # 纠错回执共用，避免两处各写一份而导致漂移（B27 CP4 task-16）。
  @legal_combination_guidance "工具组合规则：agent_plan_draft 只能与 judgment_decision(action=plan) 在同一响应中同批返回（两个工具名必须同时出现）；单独返回 agent_plan_draft 是非法响应。其他操作一次只能返回一个工具；普通回复可以不调用工具。"

  @plan_tool_description_suffix "必须与 judgment_decision(action=plan) 同一响应同批返回；单独返回非法。"

  @text %{type: "string", minLength: 1}
  @strings %{type: "array", items: %{type: "string"}}
  @nullable_text %{anyOf: [%{type: "string"}, %{type: "null"}]}

  def tools(:judgment) do
    [
      decision(),
      question(),
      plan_tool(),
      registration(),
      directions(),
      gap()
    ]
  end

  def tools(:continuation), do: [continuation(), question(), gap()]

  # 只在描述里补"必须同批"提示；schema/字段/名称保持不变（task-16 约束）。
  defp plan_tool do
    tool = NovelApplication.AgentPlanToolContract.tool()
    Map.update!(tool, :description, &(&1 <> " " <> @plan_tool_description_suffix))
  end

  @doc "判断调用合法工具组合的唯一文案真源（prompt 与纠错回执共用）。"
  def legal_combination_guidance, do: @legal_combination_guidance

  defp decision do
    tool(
      "judgment_decision",
      "建议创作执行、规划或只读探索；不批准执行。",
      %{
        action: %{type: "string", enum: ~w(execute plan explore)},
        dialogue_goal: @text,
        reason: @text,
        capability:
          Map.put(@nullable_text, :description, "仅 execute 时提供；plan/explore 时省略或为 null。"),
        pending_artifact_ref: @nullable_text,
        adopted_content_ref: @nullable_text,
        explore_request: %{
          anyOf: [
            object(%{tool: @text, query: %{type: "string"}}, ~w(tool query)),
            %{type: "null"}
          ]
        }
      },
      ~w(action dialogue_goal reason)
    )
  end

  defp continuation do
    tool(
      "continuation_decision",
      "基于实际偏离给出下一次执行的修正建议。",
      %{
        action: %{type: "string", enum: ["continue"]},
        guidance: @text,
        reason: @text
      },
      ~w(action guidance reason)
    )
  end

  defp question do
    option =
      object(
        %{
          label: @text,
          value: @text,
          kind: %{type: "string", enum: ~w(choice free_text)},
          recommended: %{type: "boolean"}
        },
        ~w(label value)
      )

    tool(
      "ask_author",
      "只用于需要作者裁决方向/对象/范围且材料无法消歧；能力缺口必须用 report_capability_gap，不能用本工具代替或封装。",
      %{
        question: @text,
        options: %{type: "array", items: option},
        reason_codes: @strings
      },
      ~w(question options)
    )
  end

  defp registration do
    tool(
      "register_author_content",
      "按明确来源逐字登记作者原文为待采纳候选，不重写。",
      %{
        author_content_source_ref: @text,
        dialogue_goal: @text,
        author_reasoning: @text
      },
      ~w(author_content_source_ref dialogue_goal author_reasoning)
    )
  end

  defp directions do
    item = object(%{title: @text, pitch: @text, tone_tags: @strings}, ~w(title pitch))

    tool(
      "propose_creative_directions",
      "给出可选择的小说内容方向，不是保存/查看等流程菜单。",
      %{
        candidate_directions: %{type: "array", minItems: 1, items: item},
        author_reasoning: @text
      },
      ~w(candidate_directions author_reasoning)
    )
  end

  defp gap do
    tool(
      "report_capability_gap",
      "所需效果不在本轮可用操作目录时必须用它说明缺失效果与最近可行路径；不派发近似工具，也不以 ask_author 代替。",
      %{
        dialogue_goal: @text,
        missing_effect: @text,
        author_reasoning: @text,
        alternative_operation_refs: @strings
      },
      ~w(dialogue_goal missing_effect author_reasoning)
    )
  end

  defp tool(name, description, properties, required),
    do: %{name: name, description: description, input_schema: object(properties, required)}

  defp object(properties, required),
    do: %{type: "object", properties: properties, required: required, additionalProperties: false}

  @doc "先校验整个响应；未知字段、错误类型或错 profile 工具均拒绝。"
  def validate(calls, profile) when is_list(calls) do
    schemas = Map.new(tools(profile), &{&1.name, &1.input_schema})

    Enum.reduce_while(calls, :ok, fn call, :ok ->
      validation_step(validate_call(call, schemas))
    end)
  end

  def validate(_, _), do: {:error, :invalid_tool_calls}
  defp validation_step(:ok), do: {:cont, :ok}
  defp validation_step(error), do: {:halt, error}

  defp validate_call(call, schemas) do
    case Map.fetch(schemas, field(call, :name)) do
      {:ok, schema} ->
        if valid?(field(call, :arguments), schema),
          do: :ok,
          else: {:error, :invalid_tool_arguments}

      :error ->
        {:error, :tool_not_in_profile}
    end
  end

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
        Enum.all?(value, &valid?(&1, schema[:items] || %{}))

  def valid?(value, %{type: "string"} = schema) when is_binary(value),
    do: String.length(String.trim(value)) >= (schema[:minLength] || 0)

  def valid?(value, %{type: "boolean"}), do: is_boolean(value)
  def valid?(nil, %{type: "null"}), do: true

  def valid?(value, %{type: "number"} = schema) when is_number(value),
    do:
      (is_nil(schema[:minimum]) or value >= schema.minimum) and
        (is_nil(schema[:maximum]) or value <= schema.maximum)

  def valid?(value, %{type: "integer"}) when is_integer(value), do: true
  def valid?(_, %{type: _}), do: false
  def valid?(_, schema), do: map_size(schema) == 0

  defp field(map, key), do: Map.get(map, key, Map.get(map, to_string(key)))
end
