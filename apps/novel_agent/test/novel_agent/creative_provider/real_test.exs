defmodule NovelAgent.CreativeProvider.RealTest do
  use ExUnit.Case, async: true

  alias NovelAgent.CreativeProvider.Real
  alias NovelCommon.Contracts.CreativeRequest

  @request %CreativeRequest{
    request_id: "req-1",
    tool_name: "prose_writing",
    artifact_type: "prose_fragment",
    creative_brief: "写第一章开篇",
    source_turn_ref: "turn-1",
    context_text: "赛博修仙",
    provider_hints: %{}
  }

  @good_json Jason.encode!([
               %{item_id: "i1", title: "开篇", body: "夜色压在账单上。", rationale: nil}
             ])

  # 字符串值内裸换行 → 非法 JSON（gpt-oss-120b 长上下文下的真实坏法）。
  @bad_json ~s([{"item_id": "i1", "title": "开篇", "body": "第一行\n第二行", "rationale": null}])

  test "retries once with a correction prompt when provider returns invalid JSON" do
    {:ok, agent} = Agent.start_link(fn -> [] end)

    complete_fn = fn prompt ->
      calls = Agent.get_and_update(agent, &{&1, &1 ++ [prompt]})

      if calls == [] do
        {:ok, %{content: @bad_json}}
      else
        {:ok, %{content: @good_json}}
      end
    end

    result = Real.generate(@request, complete_fn)

    assert result.status == :ok
    assert [%{body: "夜色压在账单上。"}] = result.items

    [_first, correction] = Agent.get(agent, & &1)
    # 重试 prompt 携带纠错指令与原任务（含三锚点，stub 解析兼容）。
    assert correction =~ "不是合法 JSON"
    assert correction =~ "用户创作简述："
    assert correction =~ "重要："
  end

  test "fails honestly when retry also returns invalid JSON" do
    complete_fn = fn _prompt -> {:ok, %{content: @bad_json}} end

    result = Real.generate(@request, complete_fn)

    assert result.status == :error
    assert [%{code: "provider_response_invalid"} | _] = result.errors
  end

  test "valid JSON passes through without retry" do
    {:ok, agent} = Agent.start_link(fn -> 0 end)

    complete_fn = fn _prompt ->
      Agent.update(agent, &(&1 + 1))
      {:ok, %{content: @good_json}}
    end

    result = Real.generate(@request, complete_fn)

    assert result.status == :ok
    assert Agent.get(agent, & &1) == 1
  end

  test "accepts top-level items with creative output self report" do
    content =
      Jason.encode!(%{
        items: [
          %{item_id: "i1", title: "开篇", body: "夜色压在账单上。", rationale: nil}
        ],
        self_report: %{
          assumptions: ["按章计划处理"],
          intended_reader_effect: "紧张、期待",
          used_context_refs: ["reader_effect_brief"],
          risk_flags: ["章尾钩子需作者确认"]
        }
      })

    result = Real.generate(@request, fn _prompt -> {:ok, %{content: content}} end)

    assert result.status == :ok
    assert [%{item_id: "i1"}] = result.items
    assert result.self_report.intended_reader_effect == "紧张、期待"
    assert result.self_report.quality_action == :confirm
  end

  test "prose writing prompt asks for ReaderEffect self report without losing anchors" do
    {:ok, agent} = Agent.start_link(fn -> nil end)

    complete_fn = fn prompt ->
      Agent.update(agent, fn _ -> prompt end)
      {:ok, %{content: @good_json}}
    end

    assert %{status: :ok} = Real.generate(@request, complete_fn)

    prompt = Agent.get(agent, & &1)
    assert prompt =~ "self_report"
    assert prompt =~ "risk_flags"
    assert prompt =~ "用户创作简述："
    assert prompt =~ "上下文："
    assert prompt =~ "重要："
  end
end
