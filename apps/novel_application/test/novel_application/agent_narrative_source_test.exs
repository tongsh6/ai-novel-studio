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
