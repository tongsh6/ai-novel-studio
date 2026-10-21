defmodule NovelApplication.ProseExecutionBriefTraceTest do
  @moduledoc """
  B11C CP1 §3.6：`prose_execution_brief.built` 业务日志补 `scene_field_coverage`
  ——逐场单元里实际出现的 VS-00E §1 场级结构字段名（规范顺序），供真实页面验收与
  线上排障读取。它只报字段名，不记录正文；是设计态可观测，不是验收钩子。
  """
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.Execution
  alias NovelApplication.TurnExecutionService
  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @work "work-b11c-cp1-trace"
  @turn_id "turn-b11c-cp1-trace"

  setup do
    old_enabled = Application.get_env(:novel_common, :log_jsonl_enabled)
    old_dir = Application.get_env(:novel_common, :log_jsonl_dir)

    log_dir =
      Path.join(System.tmp_dir!(), "novel-b11c-trace-#{System.unique_integer([:positive])}")

    Application.put_env(:novel_common, :log_jsonl_enabled, true)
    Application.put_env(:novel_common, :log_jsonl_dir, log_dir)

    on_exit(fn ->
      restore_env(:log_jsonl_enabled, old_enabled)
      restore_env(:log_jsonl_dir, old_dir)
      File.rm_rf(log_dir)
    end)

    {:ok, log_dir: log_dir}
  end

  test "planned scenes report craft field coverage in prose_execution_brief.built", %{
    log_dir: log_dir
  } do
    run("第02章：黑市对账夜", [
      %{
        "title" => "对账",
        "goal" => "核对暗扣",
        "agendas" => "沈洛要证据、摊主要脱身",
        "emotion" => "压抑",
        "opposition" => "摊主拖延并暗中报信",
        "turn" => "账单残页暴露抽签记录",
        "consequence" => "暗扣被坐实",
        "reader_learns" => "公司抽走频段",
        "protagonist_learns" => "账单上有内部编号",
        "remains_hidden" => "幕后主使",
        "surface_topic" => "对账寒暄",
        "hidden_conflict" => "互相试探底线",
        "sensory" => "潮湿霉味、风扇噪音"
      },
      %{"title" => "夜巡"}
    ])

    record = eventually_brief_record(log_dir)

    assert record["scene_unit_count"] == 2

    # 规范顺序、去重；两场子槽并集覆盖全部 7 个场级结构字段。
    assert record["scene_field_coverage"] == [
             "target_change",
             "causal_spine",
             "character_agendas",
             "information_delta",
             "emotion_transition",
             "dialogue_intent",
             "sensory_anchor"
           ]

    # 只报字段名，不泄露正文/场级内容。
    refute inspect(record["scene_field_coverage"]) =~ "暗扣"
    refute Map.has_key?(record, "body")
  end

  test "planned scenes without craft slots report no fabricated coverage", %{log_dir: log_dir} do
    run("第03章：只带目标场", [%{"title" => "只带目标", "goal" => "核对暗扣"}], nil)

    record = eventually_brief_record(log_dir)

    assert record["scene_unit_count"] == 1

    # 缺子槽不伪造覆盖：只有 target_change（goal 投影）；章级情绪也未给，不写空键。
    assert record["scene_field_coverage"] == ["target_change"]
  end

  defp run(target_chapter, scene_plans, chapter_emotion \\ "紧张") do
    complete = fn _prompt ->
      {:ok,
       %{
         provider_call_id: "pc-b11c-trace",
         content:
           Jason.encode!(%{
             items: [
               %{item_id: "trace-item", title: target_chapter, body: "正文", rationale: nil}
             ],
             self_report: %{
               assumptions: [],
               intended_reader_effect: nil,
               used_context_refs: ["prose_execution_brief"],
               risk_flags: []
             }
           })
       }}
    end

    {_turn_result, _trace} =
      TurnExecutionService.execute(%{
        frame: frame(),
        plan: plan(target_chapter),
        decision: allow_decision(),
        context: context(target_chapter, scene_plans, chapter_emotion),
        author_input: %{text: "写正文首稿"},
        provider_execution: %Execution{result_fn: complete}
      })

    :ok
  end

  defp context(target_chapter, scene_plans, chapter_emotion) do
    %DialogueContext{
      workspace_id: @work,
      current_chapters: [target_chapter],
      structured_chapters: [
        %{
          title: target_chapter,
          seq: 2,
          summary: "沈洛潜入黑市核对暗扣。",
          has_prose: false,
          plan_direction:
            %{
              "chapter_role" => "推进章",
              "plot_progress" => "沈洛潜入黑市核对暗扣",
              "scene_plans" => scene_plans
            }
            |> maybe_put_emotion(chapter_emotion)
        }
      ],
      assembly_policy: AssemblyPolicy.for_tier(:floor)
    }
  end

  defp maybe_put_emotion(direction, nil), do: direction
  defp maybe_put_emotion(direction, emotion), do: Map.put(direction, "emotion", emotion)

  defp frame do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-b11c-cp1-trace",
      turn_id: @turn_id,
      workspace_id: @work,
      primary: true,
      frame_type: :execution_candidate,
      source_refs: %{},
      dialogue_goal: %{summary: "写作"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "写正文首稿"},
      evidence_summary: %{},
      uncertainty: []
    }
  end

  defp plan(target_chapter) do
    %MicroPlan{
      plan_id: "plan-b11c-cp1-trace",
      turn_id: @turn_id,
      frame_ref: "frame-b11c-cp1-trace",
      plan_goal: %{summary: "写作"},
      risk_hint: :low,
      proposed_actions: [
        %{
          action_id: "act-b11c-cp1-trace",
          action_type: :capability_invocation,
          summary: "正文",
          target_ref: "prose_writing",
          write_intent: :tentative,
          risk_hint: :low,
          authoring_intent: nil,
          requested_chapter_raw: nil,
          target_chapter: target_chapter
        }
      ]
    }
  end

  defp allow_decision do
    %OrchestratorDecision{
      decision_id: "decision-b11c-cp1-trace",
      turn_id: @turn_id,
      frame_ref: "frame-b11c-cp1-trace",
      decision_type: :allow_tool,
      decision_status: :decided,
      reason_codes: ["gates_passed", "tool:prose_writing"]
    }
  end

  defp eventually_brief_record(log_dir, attempts \\ 40)

  defp eventually_brief_record(log_dir, 0) do
    records = read_records_if_present(log_dir)

    flunk(
      "timed out waiting for prose_execution_brief.built JSONL; got #{inspect(enum_events(records))}"
    )
  end

  defp eventually_brief_record(log_dir, attempts) do
    records = read_records_if_present(log_dir)

    case Enum.find(records, &brief_event_for_turn?/1) do
      nil ->
        Process.sleep(25)
        eventually_brief_record(log_dir, attempts - 1)

      record ->
        record
    end
  end

  defp brief_event_for_turn?(record) do
    record["event"] == "prose_execution_brief.built.done" and record["turn_id"] == @turn_id
  end

  defp enum_events(records), do: Enum.map(records, & &1["event"])

  defp read_records_if_present(log_dir) do
    path = Path.join(log_dir, "#{NovelCommon.LogFileDate.today_iso8601()}.jsonl")

    if File.exists?(path) do
      path
      |> File.read!()
      |> String.split("\n", trim: true)
      |> Enum.map(&Jason.decode!/1)
    else
      []
    end
  end

  defp restore_env(key, nil), do: Application.delete_env(:novel_common, key)
  defp restore_env(key, value), do: Application.put_env(:novel_common, key, value)
end
