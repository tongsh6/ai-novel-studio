defmodule NovelApplication.AgentNarrativeSourceTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AgentNarrativeSource
  alias NovelCommon.Contracts.ProviderOutput

  test "builds and verifies byte range binding against provider output text" do
    reasoning = "模型先读取当前作品上下文。"

    content =
      reasoning <>
        "\n" <>
        Jason.encode!(%{
          evaluation_of_last: %{advanced: true, plan_holds: true, new_constraint: nil},
          decision: %{type: "continue"},
          next_action: %{
            target_tool_ref: "context_assemble",
            write_intent: "none",
            risk_hint: "low"
          },
          plan_revision: nil,
          reason_codes: ["agentic_next_step"],
          confidence: 1.0
        })

    output = provider_output(content)

    assert {:ok, source} =
             AgentNarrativeSource.from_provider_result(
               %{content: content, provider_output: output},
               reasoning
             )

    assert source.source_type == "provider_output"
    assert source.provider_output_ref == "prun-test"

    assert :ok =
             AgentNarrativeSource.verify(
               reasoning,
               source,
               %{"prun-test" => content}
             )
  end

  test "rejects app-authored narrative without provider output binding" do
    assert {:error, :provider_output_required} =
             AgentNarrativeSource.from_provider_result(
               %{content: "已读取当前角色阵容：林烬。"},
               "已读取当前角色阵容：林烬。"
             )
  end

  test "rejects narrative that is not present in provider output bytes" do
    content = Jason.encode!(%{summary: "模型原始叙事。"})

    assert {:error, :narrative_not_bound_to_provider_output} =
             AgentNarrativeSource.from_provider_result(
               %{content: content, provider_output: provider_output(content)},
               "app 模板叙事。"
             )
  end

  test "原生判断叙事绑定具体字段，篡改字段或正文不能通过校验" do
    text = "已有修订候选，不重复登记。"

    output = %ProviderOutput{
      provider_run_ref: "prun-native",
      provider_call_ref: "pcall-native",
      status: :ok,
      content: %{
        tool_calls: [
          %{
            name: "submit_judgment",
            arguments: %{
              author_narrative: text,
              author_reasoning: "另一段文字"
            }
          }
        ]
      }
    }

    assert {:ok, source} =
             AgentNarrativeSource.from_tool_call_narrative(
               %{provider_output: output},
               "submit_judgment",
               text,
               :author_narrative
             )

    assert source.tool_call_narrative_field == "author_narrative"
    outputs = %{"prun-native" => output}
    assert :ok = AgentNarrativeSource.verify(text, source, outputs)
    assert {:error, _} = AgentNarrativeSource.verify(text <> "已保存", source, outputs)

    assert {:error, _} =
             AgentNarrativeSource.verify(
               text,
               %{source | tool_call_narrative_field: "author_reasoning"},
               outputs
             )

    assert {:error, _} =
             AgentNarrativeSource.verify(
               text,
               %{source | tool_call_narrative_field: "untrusted"},
               outputs
             )
  end

  test "旧原生叙事默认字段兼容原校验" do
    text = "继续读取作品。"

    output = %ProviderOutput{
      provider_run_ref: "prun-legacy",
      provider_call_ref: "pcall-legacy",
      status: :ok,
      content: %{tool_calls: [%{name: "submit_next_step", arguments: %{author_reasoning: text}}]}
    }

    assert {:ok, source} =
             AgentNarrativeSource.from_tool_call_narrative(
               %{provider_output: output},
               "submit_next_step",
               text
             )

    assert :ok =
             AgentNarrativeSource.verify(text, Map.delete(source, :tool_call_narrative_field), %{
               "prun-legacy" => output
             })
  end

  test "同名原生调用多义时不能借用第一段相同文字建立来源" do
    text = "要采用哪种结尾？"
    call = %{id: "native-question", name: "ask_author", arguments: %{question: text, options: []}}
    output = %{provider_output("") | content: %{text: "", tool_calls: [call, call]}}

    assert {:error, :ambiguous_tool_call_in_provider_output} =
             AgentNarrativeSource.from_tool_call_narrative(
               %{provider_output: output},
               "ask_author",
               text,
               :question
             )
  end

  test "原生第二正文不能在绑定工具参数前被中间结果删除或替换" do
    call = %{
      id: "native-plan",
      name: "agent_plan_draft",
      arguments: %{author_reasoning: "先核对人物，再整理设定。"}
    }

    for original <- ["还有一份原生正文。", "  \n"], exposed <- [nil, "", "另一份文字"] do
      output = %{provider_output(original) | content: %{text: original, tool_calls: [call]}}

      assert {:error, :tool_call_not_bound_to_provider_output} =
               AgentNarrativeSource.verify_tool_call(
                 %{content: exposed, provider_output: output},
                 call
               )
    end

    for {original, exposed} <- [{nil, ""}, {"", nil}, {"", ""}, {"原文", "原文"}] do
      output = %{provider_output("") | content: %{text: original, tool_calls: [call]}}

      assert :ok =
               AgentNarrativeSource.verify_tool_call(
                 %{content: exposed, provider_output: output},
                 call
               )
    end
  end

  test "完整参数、原调用 id/name 和唯一调用数共同决定来源，不能借用同一 question" do
    args = %{
      "question" => "  要修订哪位角色？\n",
      "options" => [
        %{"value" => "character:e9fe5f90-c939-4f9e-abee-da235d1eaa45", "label" => " 老沈\n（调查员） "}
      ]
    }

    original = %{id: "native-question", name: "ask_author", arguments: args}

    changed_args = [
      put_in(args, ["options", Access.at(0), "label"], "老沈\n（调查员）"),
      put_in(args, ["options", Access.at(0), "value"], "another-character"),
      Map.put(args, "question", "要修订哪位角色？"),
      Map.put(args, "reason_codes", ["another_reason"])
    ]

    mismatches =
      Enum.map(changed_args, &{%{original | arguments: &1}, [original]}) ++
        [
          {%{original | id: "another-native-call"}, [original]},
          {Map.delete(original, :id), [original]},
          {%{original | name: "other_tool"}, [original]},
          {original, [original, original]},
          {original, [original, %{original | id: "hidden-call", name: "other_tool"}]},
          {original, [Map.put(original, :raw_arguments, Jason.encode!(hd(changed_args)))]}
        ]

    for {call, source_calls} <- mismatches do
      output = %{provider_output("") | content: %{text: "", tool_calls: source_calls}}

      assert {:error, :tool_call_not_bound_to_provider_output} =
               AgentNarrativeSource.verify_tool_call(%{provider_output: output}, call)
    end

    source_call = Map.put(original, :raw_arguments, Jason.encode!(args))
    output = %{provider_output("") | content: %{text: "", tool_calls: [source_call]}}
    result = %{provider_output: output}
    assert :ok = AgentNarrativeSource.verify_tool_call(result, original)

    assert {:ok, source} =
             AgentNarrativeSource.from_tool_call_narrative(
               result,
               "ask_author",
               args["question"],
               :question
             )

    assert :ok = AgentNarrativeSource.verify(args["question"], source, %{"prun-test" => output})
  end

  defp provider_output(content) do
    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: "prun-test",
        provider_call_ref: "pcall-test",
        status: :ok,
        output_type: :text,
        content: %{text: content},
        refs: ["pcall-test"]
      })

    output
  end
end
