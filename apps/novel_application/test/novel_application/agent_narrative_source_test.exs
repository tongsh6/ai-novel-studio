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
