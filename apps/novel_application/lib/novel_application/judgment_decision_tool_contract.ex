defmodule NovelApplication.JudgmentDecisionToolContract do
  @moduledoc "判断动作的完整分支、wire schema 与专属纠错。"

  alias NovelCommon.AuthoringSemantics

  @text %{type: "string", minLength: 1}
  @nullable_text %{anyOf: [%{type: "string"}, %{type: "null"}]}

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
        "建议创作执行或只读探索；不批准执行。对象/版本操作只引用上下文中真实存在的 ref；多候选未消歧先 explore/ask_author，不得猜；改权威版本前先取得当前版本事实。execute 只填一个目标 ref 字段（pending_artifact_ref / adopted_content_ref / character_ref）。章级 revise_adopted_content 可按本轮 chapter_read 观察填 target_segment_ids。" <>
          "\n" <> decision_fields_guidance(),
      input_schema: object(properties, required)
    }
  end

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
        example = hd(schema.examples)
        {guidance, example} = decision_example(detail, example)
        guidance <> "合法最小示例：#{Jason.encode!(example)}。"
    end
  end

  def specific_guidance(_detail), do: ""

  defp decision_example(%{action: "explore"}, example) do
    {"explore 只表达本次实际读取请求和作者说明；不提供 dialogue_goal。", example}
  end

  defp decision_example(%{action: "execute"} = detail, example) do
    revision? =
      Map.get(detail, :capability) == "revise_adopted_content" or
        Enum.any?(
          ["target_chapter_ref", "modification_scope"],
          &(&1 in Map.get(detail, :disallowed, []))
        )

    if revision? do
      guidance =
        "内容修订的 execute 必须用 adopted_content_ref（章级 ref 或 pending artifact ref，按本轮可选目标原样复制），" <>
          "范围（第一段/整章/仅排版）写在 dialogue_goal；不要填 target_chapter_ref/modification_scope。" <>
          "target_segment_ids 仅从本轮成功 chapter_read 观察的 target_segments 原样复制；作者显式段号/字面目标时省略，由系统按作者原话定位。"

      {guidance,
       Map.merge(example, %{
         capability: "revise_adopted_content",
         adopted_content_ref: "<本轮可选目标里的真实章级/pending ref>",
         dialogue_goal: "只改第一段，其余段落保持原样"
       })}
    else
      {"execute 必须提供非空的创作目标与范围 dialogue_goal，以及本轮允许的 capability。", example}
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
    narrative =
      Map.put(
        @text,
        :description,
        "本次判断直接面向作者的唯一说明原文，content 必须为空；围绕作品和创作目的，说明有用的判断、所需材料及其用途。只有真实歧义影响作者决定时才解释歧义；不把尚未执行的动作说成已完成。" <>
          AuthoringSemantics.author_narrative_rules()
      )

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
          author_reasoning: narrative,
          capability: Map.put(@text, :description, "仅 execute 时必填；explore 不提供。"),
          pending_artifact_ref:
            Map.put(@nullable_text, :description, "仅 execute 时可选；explore 不提供，包括 null。"),
          adopted_content_ref:
            Map.put(@nullable_text, :description, "仅 execute 时可选；explore 不提供，包括 null。"),
          target_segment_ids: %{
            type: "array",
            items: @text,
            description:
              "仅 execute + revise_adopted_content + 章级 chapter_ref 时可选。只从本轮成功 chapter_read 观察的 target_segments 原样复制 segment_id；作者显式段号/字面目标时省略。"
          },
          character_ref:
            Map.put(
              @nullable_text,
              :description,
              "仅 execute + revise_character_profile 时提供，explore 不提供：先用 archive_read 的 characters 目录发现对象，再读取该 ref 详情；从已取得必要完整字段及当前指纹的详情原样复制 character_ref。目录或猜中 ref 不算已读基线。"
            )
        },
        ~w(action dialogue_goal author_reasoning capability)
      )
      |> Map.put(:examples, [
        %{
          action: "execute",
          capability: "<本轮可用能力>",
          dialogue_goal: "...",
          author_reasoning: "..."
        }
      ]),
      object(
        %{
          action: %{type: "string", enum: ["explore"]},
          author_reasoning: narrative,
          explore_request:
            object(%{tool: @text, query: %{type: "string"}}, ~w(tool query))
            |> Map.put(:description, "仅 explore 时必填的实际读取请求；execute 不提供。")
        },
        ~w(action author_reasoning explore_request)
      )
      |> Map.put(:examples, [
        %{
          action: "explore",
          explore_request: %{tool: "<本轮允许的读取工具>", query: "..."},
          author_reasoning: "..."
        }
      ])
    ]
  end

  defp object(properties, required),
    do: %{type: "object", properties: properties, required: required, additionalProperties: false}
end
