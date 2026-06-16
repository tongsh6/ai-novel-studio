defmodule NovelAgent.Tools.CreativeToolAdapterTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Tools.CreativeToolAdapter
  alias NovelCommon.Contracts.ToolRequest

  defmodule SelfReportProvider do
    @behaviour NovelAgent.CreativeProvider

    alias NovelCommon.Contracts.CreativeProviderResult

    @impl true
    def generate(_request, _complete_fn) do
      %CreativeProviderResult{
        status: :ok,
        items: [
          %{
            item_id: "item-1",
            title: "正文草稿",
            body: "正文内容",
            rationale: nil
          }
        ],
        self_report: %{
          assumptions: ["按 ReaderEffectBrief 生成"],
          intended_reader_effect: "紧张、期待",
          used_context_refs: ["reader_effect_brief"],
          risk_flags: ["章尾钩子需作者确认"],
          quality_action: :confirm
        }
      }
    end
  end

  test "passes creative self_report as observation and non-authoritative warning" do
    result =
      CreativeToolAdapter.execute(
        request(),
        :prose_fragment,
        fn _prompt -> {:ok, %{content: "unused"}} end,
        SelfReportProvider
      )

    assert result.status == :succeeded
    assert result.output.self_report.intended_reader_effect == "紧张、期待"

    assert Enum.any?(
             result.state_delta,
             &match?(%{type: :observation, key: "creative_output_self_report"}, &1)
           )

    assert [
             %{
               code: "creative_output_self_report",
               quality_action: :confirm,
               risk_flags: ["章尾钩子需作者确认"]
             }
           ] = result.warnings
  end

  defp request do
    %ToolRequest{
      tool_request_id: "tool-1",
      turn_id: "turn-1",
      frame_ref: "frame-1",
      decision_ref: "decision-1",
      tool_name: "prose_writing",
      tool_version: "1.0",
      input: %{"creative_brief" => "写第一章", "context_text" => "ReaderEffectBrief"}
    }
  end
end
