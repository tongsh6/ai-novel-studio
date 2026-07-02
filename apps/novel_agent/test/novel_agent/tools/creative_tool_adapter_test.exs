defmodule NovelAgent.Tools.CreativeToolAdapterTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.Result, as: ProviderResult
  alias NovelAgent.Tools.CreativeToolAdapter
  alias NovelCommon.Contracts.ToolRequest

  defmodule SelfReportProvider do
    @behaviour NovelAgent.CreativeProvider

    alias NovelCommon.Contracts.CreativeProviderResult

    @impl true
    def generate(_request, _result_fn) do
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

  defmodule ExecutionBackedProvider do
    @behaviour NovelAgent.CreativeProvider

    alias NovelAgent.Provider.Execution
    alias NovelCommon.Contracts.CreativeProviderResult

    @impl true
    def generate(_request, provider_execution) do
      result_fn = Execution.result_fn(provider_execution)
      {:ok, result} = result_fn.("creative tool prompt")

      %CreativeProviderResult{
        status: :ok,
        provider_call_ref: result.provider_call_ref,
        items: [
          %{
            item_id: "item-exec",
            title: "正文草稿",
            body: "正文内容",
            rationale: nil,
            provider_call_ref: result.provider_call_ref
          }
        ]
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

  test "passes provider execution dependency through creative tool adapter" do
    provider_execution = %Execution{
      result_fn: fn _prompt ->
        {:ok, %ProviderResult{content: "unused", provider_call_ref: "pcall-tool-execution"}}
      end
    }

    result =
      CreativeToolAdapter.execute(
        request(),
        :prose_fragment,
        provider_execution,
        ExecutionBackedProvider
      )

    assert result.status == :succeeded
    assert [%{provider_call_ref: "pcall-tool-execution"}] = result.output.items
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
