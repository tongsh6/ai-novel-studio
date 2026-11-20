defmodule NovelApplication.JudgmentToolContract do
  @moduledoc "B26：固定判断工具 schema 与同源字段校验，合法对象在派发前另行验证。"

  alias NovelApplication.JudgmentDecisionToolContract
  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.AuthorVisible.Text

  @version "b26-tools-v3"
  def version, do: @version

  # 判断调用唯一合法工具组合的文案真源：产品 prompt 与 invalid_tool_combination
  # 纠错回执共用，避免两处各写一份而导致漂移（B27 CP4 task-16）。
  @legal_combination_guidance "工具组合规则：一次只返回一个工具；需要完整计划时只调用 agent_plan_draft，判断操作只调用 judgment_decision。普通回复不调用工具。工具响应的 content 必须为 null 或空字符串，作者说明只来自该工具的 question 或 author_reasoning。"

  @question_response_guidance "ask_author 的 question 是唯一完整作者正文；说明和理由写入 question，content 必须为 null 或空字符串。不要再输出第二份正文，也不要把同一句话同时放入 content 和 question。选择按钮标签必须非空且可区分，不能只靠首尾或重复空白；仅用已知事实区分，材料仍不可辨认时提出开放问题并用空 options，不追加内部引用或序号制造区分。"

  @text %{type: "string", minLength: 1}
  @strings %{type: "array", items: %{type: "string"}}

  def tools(:judgment) do
    [
      JudgmentDecisionToolContract.tool(),
      question(),
      NovelApplication.AgentPlanToolContract.tool(),
      registration(),
      directions(),
      work_profile_revision(),
      gap()
    ]
  end

  def tools(:continuation), do: [continuation(), question(), gap()]

  @doc "判断调用合法工具组合的唯一文案真源（prompt 与纠错回执共用）。"
  def legal_combination_guidance, do: @legal_combination_guidance

  @doc "提问正文契约的唯一文案真源，供工具描述、prompt 和纠错回执共用。"
  def question_response_guidance, do: @question_response_guidance

  @doc "校验已经过 schema 的提问选项；可见资格只比较投影，原字段不改写。"
  def validate_question_options(options) do
    values = Enum.map(options, &field(&1, :value))

    labels =
      options
      |> Enum.reject(&(field(&1, :kind) == "free_text"))
      |> Enum.map(&Text.html_normal(field(&1, :label)))

    cond do
      Enum.any?(options, &(Text.validate_narrative(field(&1, :label)) != :ok)) ->
        {:error, :author_visible_narrative_invalid}

      not (values == Enum.uniq(values) and Enum.all?(values, &(&1 == String.trim(&1)))) ->
        {:error, :question_option_values_invalid}

      labels != Enum.uniq(labels) ->
        {:error, :question_option_labels_invalid}

      true ->
        :ok
    end
  end

  @doc "工具 schema 参数纠错与对应字段约束同属固定工具契约。"
  def invalid_arguments_guidance(detail) do
    disallowed = format_fields(Map.get(detail, :disallowed, []))
    missing = format_fields(Map.get(detail, :missing, []))
    allowed = format_fields(Map.get(detail, :allowed, []))

    "本次响应的工具参数未通过 schema 校验：只填该工具当前分支声明的字段。参数类型和非空要求也须符合契约。" <>
      "上次未允许字段：#{disallowed}；缺少必填字段：#{missing}；#{Map.get(detail, :tool)} 允许字段：#{allowed}。" <>
      JudgmentDecisionToolContract.specific_guidance(detail) <>
      "保留原任务、目标、来源与范围，只纠正工具参数结构。"
  end

  defp format_fields([]), do: "无"
  defp format_fields(fields), do: Enum.join(fields, "、")

  defp continuation do
    tool(
      "continuation_decision",
      "基于实际偏离给出下一次执行的修正建议。",
      %{
        action: %{type: "string", enum: ["continue"]},
        guidance: @text,
        author_reasoning:
          Map.put(
            @text,
            :description,
            "后续调整的唯一作者说明原文，content 必须为空；依据已观察到的偏离说明为何这样调整。" <>
              AuthoringSemantics.author_narrative_rules()
          )
      },
      ~w(action guidance author_reasoning)
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
      "只用于需要作者裁决方向/对象/范围且材料无法消歧；#{@question_response_guidance}能力缺口必须用 report_capability_gap，不能用本工具代替或封装。",
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
        author_reasoning:
          Map.put(
            @text,
            :description,
            "登记作者原文的作者说明，说明登记的材料及其用途，不改写原文或声称已被采纳。" <>
              AuthoringSemantics.author_narrative_rules()
          )
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
        author_reasoning:
          Map.put(
            @text,
            :description,
            "候选创作方向的作者说明，说明方向的依据与区别，保留作者选择。" <>
              AuthoringSemantics.author_narrative_rules()
          )
      },
      ~w(candidate_directions author_reasoning)
    )
  end

  defp work_profile_revision do
    tool(
      "propose_work_profile_revision",
      "作者明确要求修订作品立项字段时，给出一个显式字段级修订提案（title/body/field/value），等待作者逐项采纳；不直接写 works，不用 world_setting 泛化覆盖。",
      %{
        title: @text,
        body: @text,
        field: %{
          type: "string",
          enum:
            ~w(premise theme main_goal core_selling_point target_reader tone_preference target_length planned_volumes serial_form)
        },
        value: %{anyOf: [%{type: "string", minLength: 1}, %{type: "integer", minimum: 1}]},
        author_reasoning:
          Map.put(
            @text,
            :description,
            "立项字段修订的作者说明，说明当前字段为何需要所提调整；这是待采纳提案，不是已生效修改。" <>
              AuthoringSemantics.author_narrative_rules()
          )
      },
      ~w(title body field value author_reasoning)
    )
  end

  defp gap do
    tool(
      "report_capability_gap",
      "所需效果不在本轮可用操作目录时必须用它说明缺失效果与最近可行路径；不派发近似工具，也不以 ask_author 代替。",
      %{
        dialogue_goal: @text,
        missing_effect: @text,
        author_reasoning:
          Map.put(
            @text,
            :description,
            "能力缺口的作者说明，说明当前目标缺少的效果及最近可行路径，不把建议说成已执行。" <>
              AuthoringSemantics.author_narrative_rules()
          ),
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
    name = field(call, :name)
    args = field(call, :arguments)

    case Map.fetch(schemas, name) do
      {:ok, schema} ->
        schema = argument_schema(name, args, schema)

        if is_map(schema) and valid?(args, schema),
          do: :ok,
          else: {:error, :invalid_tool_arguments}

      :error ->
        {:error, :tool_not_in_profile}
    end
  end

  defp argument_schema("judgment_decision", args, _wire_schema),
    do: JudgmentDecisionToolContract.schema_for_action(field(args, :action))

  defp argument_schema(_name, _args, schema), do: schema

  @doc "字段级纠错消费与实际接收相同的 action 分支；未知 action 不选择默认分支。"
  def invalid_tool_arguments_detail(calls, profile) do
    schemas = Map.new(tools(profile), &{&1.name, &1.input_schema})

    call =
      Enum.find(calls, &(field(&1, :name) == "judgment_decision")) ||
        List.first(calls)

    name = field(call, :name)
    args = field(call, :arguments)
    wire_schema = Map.get(schemas, name)
    schema = argument_schema(name, args, wire_schema)

    # 无合法 action 时仅呈现公开字段与可选动作；该 wire schema 不用于接收。
    detail =
      with %{properties: properties, required: required} <- schema || wire_schema,
           true <- is_map(args) do
        allowed = properties |> Map.keys() |> Enum.map(&to_string/1) |> Enum.sort()
        present = args |> Map.keys() |> Enum.map(&to_string/1)

        %{
          tool: name,
          allowed: allowed,
          required: required,
          disallowed: Enum.reject(present, &(&1 in allowed)),
          missing: Enum.reject(required, &(&1 in present)),
          action: field(args, :action),
          capability: field(args, :capability)
        }
      else
        _ -> %{tool: name, allowed: [], required: [], disallowed: [], missing: []}
      end

    detail =
      case wire_schema do
        %{properties: %{action: %{enum: actions}}} -> Map.put(detail, :allowed_actions, actions)
        _ -> detail
      end

    {:error, {:invalid_tool_arguments, detail}}
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

  defp field(map, key) when is_map(map), do: Map.get(map, key, Map.get(map, to_string(key)))
  defp field(_map, _key), do: nil
end
