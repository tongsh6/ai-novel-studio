defmodule NovelApplication.JudgmentDecisionToolContract do
  @moduledoc "判断动作的完整分支、wire schema 与专属纠错。"

  alias NovelApplication.AuthoringTaskPolicy
  alias NovelCommon.Contracts.AuthoringTask

  @text %{type: "string", minLength: 1}

  @execute_target_fields [
    pending_artifact_ref: AuthoringTaskPolicy.artifact_capabilities(:pending),
    adopted_content_ref: AuthoringTaskPolicy.artifact_capabilities(:adopted),
    character_ref: AuthoringTaskPolicy.artifact_capabilities(:character_profile)
  ]

  @doc "从完整动作分支派生判断工具的公开说明与平面 wire schema。"
  def tool do
    [first | rest] = contracts = decision_contracts()
    properties = Enum.reduce(contracts, %{}, &Map.merge(&2, &1.properties))
    actions = Enum.flat_map(contracts, & &1.properties.action.enum)
    properties = put_in(properties, [:action, :enum], actions)

    required =
      Enum.reduce(rest, first.required, fn schema, fields ->
        Enum.filter(fields, &(&1 in schema.required))
      end)

    %{
      name: "judgment_decision",
      description:
        "建议创作执行或只读探索；不批准执行。对象/版本操作只引用上下文中真实存在的 ref；多候选未消歧先 explore/ask_author，不得猜；改权威版本前先取得当前版本事实。execute 的目标字段按 capability 归属提交，具体适用范围见各字段说明；不适用字段不提供，包括 null。章级 revise_adopted_content 必须给出 modification_scope；局部修订按本轮 chapter_read 观察填 target_segment_ids。" <>
          "\nexecute 的唯一作者说明使用同次原生 content，围绕作品、创作目的与实际材料说明判断，不把尚未执行的动作说成已完成。\n" <>
          decision_fields_guidance(),
      input_schema: object(properties, required)
    }
  end

  @doc "校验 execute 目标字段的能力归属；真实对象与当前版本由对应业务边界另行核验。"
  def validate_execute_target_fields(arguments) do
    capability = field(arguments, :capability)

    valid? =
      Enum.all?(@execute_target_fields, fn {key, capabilities} ->
        not (Map.has_key?(arguments, key) or Map.has_key?(arguments, Atom.to_string(key))) or
          capability in capabilities
      end)

    if valid?, do: :ok, else: {:error, :target_ref_field_conflict}
  end

  @doc "目标字段纠错与公开字段描述共用同一能力归属。"
  def target_fields_guidance do
    Enum.map_join(@execute_target_fields, "", fn {key, _capabilities} ->
      "#{key}：#{target_field_description(key)}"
    end)
  end

  defp target_field_description(key) do
    capabilities = Keyword.fetch!(@execute_target_fields, key)

    "只用于 execute 且 capability 为 #{Enum.join(capabilities, "、")}；" <>
      "出现时必须为非空字符串，原样引用真实对象；其他能力及 explore 不提供此字段，包括 null。"
  end

  defp field(map, key), do: Map.get(map, key, Map.get(map, Atom.to_string(key)))

  @doc "按原始 action 精确选择完整接收分支；未知动作返回 nil。"
  def schema_for_action(action) do
    Enum.find(decision_contracts(), &(action in &1.properties.action.enum))
  end

  @doc "使用当前动作的完整分支与示例补充字段纠错。"
  def specific_guidance(%{tool: "judgment_decision"} = detail) do
    case schema_for_action(Map.get(detail, :action)) do
      nil ->
        "action 缺失或不受支持，必须依据原任务选择当前支持的动作：#{Enum.join(Map.get(detail, :allowed_actions, []), "、")}。"

      schema ->
        case decision_example(detail, hd(schema.examples)) do
          {guidance, nil} -> guidance
          {guidance, example} -> guidance <> "合法最小示例：#{Jason.encode!(example)}。"
        end
    end
  end

  def specific_guidance(_detail), do: ""

  defp decision_example(%{action: "explore"}, example) do
    {"explore 只表达本次实际读取请求；不提供 dialogue_goal 或 author_reasoning，包括 null。", example}
  end

  defp decision_example(%{action: "execute"} = detail, example) do
    if Map.get(detail, :capability) == "revise_adopted_content" do
      guidance =
        "内容修订的 execute 必须用 adopted_content_ref，按本轮可选目标原样复制；章级修订以 modification_scope 表达范围，不填 target_chapter_ref。" <>
          schema_for_action("execute").properties.modification_scope.description <>
          schema_for_action("execute").properties.target_segment_ids.description

      {guidance <> target_fields_guidance(), nil}
    else
      {"execute 必须提供非空的创作目标与范围 dialogue_goal，以及本轮允许的 capability。" <>
         target_fields_guidance(), example}
    end
  end

  # 工具描述的字段说明由实际接收分支派生。
  defp decision_fields_guidance do
    Enum.map_join(decision_contracts(), "\n", fn schema ->
      action = Enum.join(schema.properties.action.enum, "、")
      allowed = schema.properties |> Map.keys() |> Enum.map(&to_string/1) |> Enum.sort()

      "judgment_decision 的 #{action} 只允许字段 #{Enum.join(allowed, "、")}；" <>
        "必填字段为 #{Enum.join(schema.required, "、")}。"
    end)
  end

  # 完整分支同时拥有字段、必填项和示例；平面 wire 只供应并集，接收仍按原 action 校验。
  defp decision_contracts do
    [
      object(
        %{
          action: %{type: "string", enum: ["execute"]},
          dialogue_goal:
            Map.put(
              @text,
              :description,
              "仅 execute 时必填：依据作者原话与上下文确定本次创作目标和范围；explore 不提供。"
            ),
          capability: Map.put(@text, :description, "仅 execute 时必填；explore 不提供。"),
          pending_artifact_ref:
            Map.put(@text, :description, target_field_description(:pending_artifact_ref)),
          adopted_content_ref:
            Map.put(@text, :description, target_field_description(:adopted_content_ref)),
          modification_scope: %{
            type: "string",
            enum: Enum.map(AuthoringTask.modification_scopes(), &Atom.to_string/1),
            description:
              "仅 execute + revise_adopted_content + 章级 chapter_ref 时必填：根据本轮作者原话与上下文提出 format_only、target_segments 或 whole_chapter。format_only 只改全章换行，所有非换行字节不变；target_segments 修改已定位片段；whole_chapter 修订整章。范围有实质歧义先 ask_author；读取或完整覆盖不扩大修改范围。"
          },
          target_segment_ids: %{
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: @text,
            description:
              "仅章级 revise_adopted_content 且 modification_scope=target_segments 时必填；其他动作、whole_chapter 和 format_only 均不提供。段号、原文字词与阅读发现都由判断结合本轮 chapter_read 定位，只原样复制观察中的非空唯一 segment_id；目标不存在或有歧义不得改选其他对象。所选片段须同章、同源 hash、相容版本，并由连续页完整覆盖。存储片段不等于自然段或首句；片段内需保留的锚句必须在替换正文中保留，未选片段全部字节保持不变。不要向作者索要内部编号。"
          },
          character_ref:
            Map.put(
              @text,
              :description,
              target_field_description(:character_ref) <>
                "先用 archive_read 的 characters 目录发现对象，再读取该 ref 详情；从已取得必要完整字段及当前指纹的详情原样复制 character_ref。目录或猜中 ref 不算已读基线。"
            )
        },
        ~w(action dialogue_goal capability)
      )
      |> Map.put(:examples, [
        %{
          action: "execute",
          capability: "<本轮可用能力>",
          dialogue_goal: "..."
        }
      ]),
      object(
        %{
          action: %{type: "string", enum: ["explore"]},
          explore_request:
            object(%{tool: @text, query: %{type: "string"}}, ~w(tool query))
            |> Map.put(:description, "仅 explore 时必填的实际读取请求；execute 不提供。")
        },
        ~w(action explore_request)
      )
      |> Map.put(:examples, [
        %{
          action: "explore",
          explore_request: %{tool: "<本轮允许的读取工具>", query: "..."}
        }
      ])
    ]
  end

  defp object(properties, required),
    do: %{type: "object", properties: properties, required: required, additionalProperties: false}
end
