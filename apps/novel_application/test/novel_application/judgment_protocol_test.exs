defmodule NovelApplication.JudgmentProtocolTest do
  @moduledoc """
  判断①协议解析的业务规则单测（ADR-0025 CP1）。

  锚定兜底候选语义的协议侧前提：候选结构坏了不丢探索意图
  （`candidate_directions_present`），由消费层降级为应用兜底候选。
  端到端降级行为由场景验收 au02-candidate-fallback-ui 驱动真实页面证明。
  """
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.JudgmentProtocol
  alias NovelCommon.Contracts.ProviderOutput

  @narrative "你想探索方向；我先给你两个候选切入。"

  defp fake_execution(decision_arguments) do
    %Execution{
      result_fn: fn prompt ->
        text = prompt_text(prompt)

        if String.contains?(text, JudgmentProtocol.tool_name()) do
          {:ok,
           %{
             content: "",
             tool_calls: [
               %{name: JudgmentProtocol.tool_name(), arguments: decision_arguments}
             ],
             provider_output: provider_output("")
           }}
        else
          {:ok,
           %{
             content: @narrative,
             provider_output: provider_output(@narrative)
           }}
        end
      end
    }
  end

  defp provider_output(text) do
    %ProviderOutput{
      provider_run_ref: "prun-test",
      provider_call_ref: "pcall-test",
      status: :ok,
      content: %{text: text}
    }
  end

  defp prompt_text(%{messages: messages}) do
    Enum.map_join(messages, "\n", fn m -> m[:content] || m["content"] || "" end)
  end

  defp prompt_text(prompt) when is_binary(prompt), do: prompt
  defp prompt_text(_), do: ""

  defp request(arguments) do
    JudgmentProtocol.request_judgment(fake_execution(arguments), %{}, %{
      author_text: "想写赛博修仙，给我几个方向",
      context_block: "（无上下文）"
    })
  end

  test "正常候选列表：解析为候选，present 为真" do
    {:ok, judgment} =
      request(%{
        "action" => "reply",
        "reply_included" => true,
        "candidate_directions" => [
          %{"title" => "矛盾切入", "pitch" => "从冲突进入", "tone_tags" => ["冲突"]}
        ]
      })

    assert judgment.action == "reply"
    assert [%{"title" => "矛盾切入"}] = judgment.candidate_directions
    assert judgment.candidate_directions_present
  end

  test "坏候选结构（对象而非数组）：候选归空但探索意图不丢" do
    {:ok, judgment} =
      request(%{
        "action" => "reply",
        "reply_included" => true,
        "candidate_directions" => %{"title" => "", "pitch" => ""}
      })

    assert judgment.candidate_directions == []
    assert judgment.candidate_directions_present
  end

  test "无候选字段：候选为空且无探索意图" do
    {:ok, judgment} = request(%{"action" => "reply", "reply_included" => true})

    assert judgment.candidate_directions == []
    refute judgment.candidate_directions_present
  end
end
