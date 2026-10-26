defmodule NovelApplication.NoProgressClarificationTest do
  use ExUnit.Case, async: true

  alias NovelApplication.NoProgressClarification
  alias NovelCommon.Contracts.AgentEvent
  alias NovelDomain.AgentObservation

  @generic "AgentRun 未取得新进展，已停止等待作者回复。"

  test "无可用观察时退化为既有诚实兜底句" do
    assert NoProgressClarification.derive([], []) == %{
             summary: @generic,
             reason_codes: ["no_progress_generic"],
             source: :none
           }

    # 非探索类观察（例如上下文组装）不冒充检索事实
    context_observation = observation("context", "turn-1", nil)

    assert %{summary: @generic, source: :none} =
             NoProgressClarification.derive([context_observation], [])
  end

  test "空作品缺目标：澄清含具体缺什么/为何不能执行/可做什么" do
    result =
      NoProgressClarification.derive(
        [exploration("chapter_read", "第一章", "target_not_found", %{chapter_count: 0})],
        []
      )

    assert result.source == :observation
    assert result.summary =~ "章节「第一章」不存在"
    assert result.summary =~ "作品当前还没有任何章节或正文"
    assert result.summary =~ "没有可整理修订的目标"
    assert result.summary =~ "重复同一次检索不会得到新事实"
    assert result.summary =~ "下一步：先创作第一章正文"
    assert result.summary =~ "或指定已有内容后重试"
    refute result.summary == @generic
    assert "no_progress_repeated_exploration" in result.reason_codes
    assert "exploration_outcome_target_not_found" in result.reason_codes
    assert result.observation == %{tool: "chapter_read", outcome: "target_not_found"}
  end

  test "章名不在索引：澄清说明实际章数并给出确认章名的下一步" do
    result =
      NoProgressClarification.derive(
        [exploration("chapter_read", "第一章", "target_not_found", %{chapter_count: 2})],
        []
      )

    assert result.summary =~ "章节「第一章」不在当前章索引中"
    assert result.summary =~ "当前作品共 2 章"
    assert result.summary =~ "下一步：确认章名"
    refute result.summary =~ "还没有任何章节"
  end

  test "空命中检索：正文/记忆各自说明缺什么与可做什么" do
    prose =
      NoProgressClarification.derive(
        [exploration("prose_search", "灵气账单", "empty_result", %{hit_count: 0})],
        []
      )

    assert prose.summary =~ "正文检索「灵气账单」没有命中任何章节"
    assert prose.summary =~ "缺少可引用的正文事实"
    assert prose.summary =~ "下一步：确认检索词"

    memory =
      NoProgressClarification.derive(
        [exploration("memory_recall", "身世", "empty_result", %{hit_count: 0})],
        []
      )

    assert memory.summary =~ "记忆检索「身世」没有命中任何已确认记忆"
    assert memory.summary =~ "下一步：补充具体设定"
  end

  test "歧义/非法参数/空正文同样给出可执行澄清" do
    ambiguous =
      NoProgressClarification.derive(
        [exploration("chapter_read", "同名章", "ambiguous_target", %{matched_count: 2})],
        []
      )

    assert ambiguous.summary =~ "匹配到 2 章、存在歧义"
    assert ambiguous.summary =~ "下一步：说明具体是哪一章"

    invalid =
      NoProgressClarification.derive(
        [exploration("chapter_read", ~s({"offset":5}), "invalid_query", %{chapter_count: 0})],
        []
      )

    assert invalid.summary =~ "章节检索参数无法识别"
    assert invalid.summary =~ "下一步：提供作品目录中的真实章名"
    refute invalid.summary =~ "{"

    empty =
      NoProgressClarification.derive(
        [exploration("chapter_read", "空章", "empty_content", %{prose_chars: 0})],
        []
      )

    assert empty.summary =~ "章节「空章」还没有已采纳正文"
    assert empty.summary =~ "下一步：先写本章正文"
  end

  test "JSON/超长 query 不出现在作者可见澄清里（B24 I-EXPLORE-READ-8）" do
    json_query = ~s({"chapter_ref":"chapter:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","offset":0})

    result =
      NoProgressClarification.derive(
        [exploration("chapter_read", json_query, "target_not_found", %{chapter_count: 0})],
        []
      )

    refute result.summary =~ "{"
    refute result.summary =~ "chapter_ref"
    assert result.summary =~ "当前还没有任何章节或正文"
    assert result.summary =~ "下一步："
  end

  test "观察缺失时回落到最后的 exploration_observed 事件元数据" do
    event =
      event(%{
        stage: :exploration_observed,
        tool: "chapter_read",
        query: "第一章",
        outcome: "target_not_found",
        facts: %{chapter_count: 0}
      })

    result = NoProgressClarification.derive([], [event])
    assert result.source == :observation
    assert result.summary =~ "第一章"
    assert result.summary =~ "当前还没有任何章节或正文"
  end

  test "最后一条探索观察优先（重复检索的事实以最近一次为准）" do
    observations = [
      exploration("prose_search", "灵气", "observed", %{hit_count: 1}),
      exploration("chapter_read", "第一章", "target_not_found", %{chapter_count: 0})
    ]

    result = NoProgressClarification.derive(observations, [])
    assert result.summary =~ "第一章"
    assert result.observation == %{tool: "chapter_read", outcome: "target_not_found"}
  end

  defp exploration(tool, query, outcome, facts) do
    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: "obs-#{System.unique_integer([:positive])}",
        run_ref: "run-1",
        step_ref: "step-1",
        observation_type: :custom,
        source_ref: "explore:#{tool}:2",
        summary: "retrieval fact bytes",
        structured_payload: %{
          stage: :exploration_observed,
          tool: tool,
          query: query,
          outcome: outcome,
          facts: facts
        },
        evidence_refs: ["explore:#{tool}:2"]
      })

    observation
  end

  defp observation(stage, source_ref, payload) do
    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: "obs-#{System.unique_integer([:positive])}",
        run_ref: "run-1",
        step_ref: "step-1",
        observation_type: :custom,
        source_ref: source_ref,
        summary: "context assembled",
        structured_payload: if(payload, do: payload, else: %{stage: stage}),
        evidence_refs: [source_ref]
      })

    observation
  end

  defp event(payload) do
    {:ok, event} =
      AgentEvent.new(%{
        event_id: "evt-1",
        run_ref: "run-1",
        sequence: 1,
        event_type: :exploration_observed,
        summary: "已检索章节「第一章」：作品当前还没有章节。",
        payload: payload
      })

    event
  end
end
