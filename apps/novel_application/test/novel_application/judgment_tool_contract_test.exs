defmodule NovelApplication.JudgmentToolContractTest do
  use ExUnit.Case, async: true

  alias NovelApplication.JudgmentToolContract

  @moduletag :r05_explore_contract

  test "探索只需读取请求和唯一作者说明，不要求另写目标" do
    arguments = %{
      "action" => "explore",
      "author_reasoning" => "  阅读《灵源账单》全文，核对胜利是否付出代价。\n",
      "explore_request" => %{"tool" => "chapter_read", "query" => "第01章：灵源账单"}
    }

    assert :ok = validate(arguments)
  end

  test "探索不接受目标字段，空串与 null 也不能作为兼容占位" do
    for goal <- ["取得章节引用", "", "  ", nil] do
      arguments = %{
        action: "explore",
        dialogue_goal: goal,
        author_reasoning: "需要完整正文才能分析。",
        explore_request: %{tool: "chapter_read", query: "第01章：灵源账单"}
      }

      assert {:error, :invalid_tool_arguments} = validate(arguments)
    end
  end

  test "执行保留非空目标与能力，不能借探索契约省略修订范围" do
    arguments = %{
      action: "execute",
      capability: "revise_adopted_content",
      adopted_content_ref: "chapter:actual",
      dialogue_goal: "只改第一段，其余正文逐字保留。",
      author_reasoning: "按作者指定的范围提出修订候选。"
    }

    assert :ok = validate(arguments)

    for field <- [:dialogue_goal, :capability],
        invalid <- [
          Map.delete(arguments, field),
          Map.put(arguments, field, nil),
          Map.put(arguments, field, ""),
          Map.put(arguments, field, " \n")
        ] do
      assert {:error, :invalid_tool_arguments} = validate(invalid)
    end
  end

  test "action 不认识或缺失时不能借另一分支的字段被接受" do
    arguments = %{
      action: "execute",
      capability: "prose_writing",
      dialogue_goal: "写本章首稿。",
      author_reasoning: "按已确认方向提出正文候选。"
    }

    for invalid <- [
          Map.delete(arguments, :action),
          Map.put(arguments, :action, "inspect"),
          Map.put(arguments, :action, "explore "),
          Map.put(arguments, :action, nil)
        ] do
      assert {:error, :invalid_tool_arguments} = validate(invalid)
    end
  end

  test "执行和探索的专属字段不能串入另一分支，包括 null 占位" do
    explore = %{
      action: "explore",
      author_reasoning: "先核对原文。",
      explore_request: %{tool: "prose_search", query: "灵气账单"}
    }

    for field <- [
          :capability,
          :pending_artifact_ref,
          :adopted_content_ref,
          :character_ref,
          :target_segment_ids
        ],
        value <- [nil, "foreign"] do
      assert {:error, :invalid_tool_arguments} = validate(Map.put(explore, field, value))
    end

    execute = %{
      action: "execute",
      capability: "prose_writing",
      dialogue_goal: "写本章首稿。",
      author_reasoning: "按已确认方向提出正文候选。"
    }

    for request <- [nil, %{tool: "chapter_read", query: "第一章"}] do
      assert {:error, :invalid_tool_arguments} =
               validate(Map.put(execute, :explore_request, request))
    end
  end

  test "探索必须提供完整读取请求，不能用空请求或额外字段替代" do
    arguments = %{action: "explore", author_reasoning: "先核对原文。"}
    assert {:error, :invalid_tool_arguments} = validate(arguments)

    for request <- [
          nil,
          %{},
          %{tool: "chapter_read"},
          %{tool: "", query: "第一章"},
          %{tool: "chapter_read", query: 1},
          %{tool: "chapter_read", query: "第一章", capability: nil}
        ] do
      assert {:error, :invalid_tool_arguments} =
               validate(Map.put(arguments, :explore_request, request))
    end
  end

  test "对外工具仍是根 object，合法探索和执行都满足真实公布的共同约束" do
    tool = Enum.find(JudgmentToolContract.tools(:judgment), &(&1.name == "judgment_decision"))
    assert tool.input_schema.type == "object"

    examples = [
      %{
        action: "explore",
        author_reasoning: "先核对原文。",
        explore_request: %{tool: "chapter_read", query: "第一章"}
      },
      %{
        action: "execute",
        capability: "prose_writing",
        dialogue_goal: "写本章首稿。",
        author_reasoning: "按已确认方向提出正文候选。"
      }
    ]

    for arguments <- examples do
      assert JudgmentToolContract.valid?(arguments, tool.input_schema)
      refute JudgmentToolContract.valid?(Map.delete(arguments, :action), tool.input_schema)

      refute JudgmentToolContract.valid?(
               Map.delete(arguments, :author_reasoning),
               tool.input_schema
             )
    end
  end

  defp validate(arguments),
    do:
      JudgmentToolContract.validate(
        [%{name: "judgment_decision", arguments: arguments}],
        :judgment
      )
end
