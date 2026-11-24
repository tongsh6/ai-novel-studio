defmodule NovelApplication.ChapterMissionBindingTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.ChapterMissionService
  alias NovelApplication.TurnExecutionService
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Compaction
  alias NovelCommon.RequestIR.Projection
  alias NovelDomain.ChapterMission
  alias NovelDomain.ChapterMissionInputs
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @author_text "请按已有三章往后规划接下来三章的章节大纲，保持为待采纳草稿。"
  @run %{
    run_id: "run-binding",
    work_id: "work-binding",
    workspace_id: "workspace-binding",
    session_id: "session-binding",
    parent_turn_ref: "turn-binding",
    goal: %{text: @author_text, version: 1}
  }
  @first "chapter:d2430d8b-8168-44ac-ab00-24bd99373f37"
  @second "chapter:664e24d4-c538-45a7-b4fc-43f68ef4a030"
  @third "chapter:82a81f9f-c200-41ab-9c05-70e54e4532c4"
  @directory_omission "目录只含所列身份字段，未读取对象正文或完整角色修订基线。"
  @preview_omission "本页计划与摘要仅为预览；完整设计材料需另行查阅，预览不证明全文已读。"
  @body "WR02BODY91：" <> String.duplicate("雨", 67)

  test "WR02 三个真实读取 ref 同源绑定具体依据，正文不再复制成材料标签" do
    args = arguments([@first, @second, @third])
    {result, request} = derive(args, transcript([directory(), chapter_page()]))
    assert {:ok, mission, meta} = result

    assert Enum.map(mission.must_advance, & &1["basis_ref"]) == [@first, @second, @third]
    assert mission.dropped == []
    [first, second, third] = mission.must_advance
    assert first["basis_label"] =~ "第01章：黑市对账夜"
    assert first["basis_label"] =~ "正文第 1–78 字符 / 共 78 字符"
    assert first["basis_label"] =~ @preview_omission
    assert second["basis_label"] =~ "第02章：旧账兑现"
    assert third["basis_label"] =~ "第03章：巡检收网"

    for item <- mission.must_advance do
      assert item["basis_label"] =~ @directory_omission
      refute item["basis_label"] =~ @body
    end

    scope = NovelTest.TestProviderPrompt.scope_content(request)
    assert get_in(scope, ["operation", "mission_inputs", "items"]) == []
    assert meta.provider_call_count == 1
    assert meta.narrative == args["author_reasoning"]
    assert mission.statement == args["statement"]

    assert {:ok, restored} = AuthoringTranscript.to_request_ir(meta.judgment_transcript)
    assert {:ok, []} = RequestIR.pending_call_ids(restored)

    assert Enum.any?(restored.messages, fn message ->
             Enum.any?(message.blocks, fn block ->
               block.type == "tool_call" and block.name == "planning_mission" and
                 RequestIR.json_value(block.arguments) == args
             end)
           end)

    saved = mission |> ChapterMission.persisted_map() |> Jason.encode!() |> Jason.decode!()
    assert ChapterMission.from_map(saved).must_advance == mission.must_advance

    for wire <- ~w(chat_completions responses_api anthropic_messages) do
      assert {:ok, body} = Projection.project(request, wire)
      assert length(String.split(Jason.encode!(body), "WR02BODY91")) == 2
    end

    refute_receive {:binding_request, _}
  end

  test "合法目录来源缺具体依据按应用错误闭合，不要求模型提交禁止的标签或再调用" do
    observation =
      directory_for(@first, nil)
      |> put_in([:content, :facts, :chapters], [%{ref: @first, seq: 1, has_prose: true}])

    args = arguments([@first])
    {result, _request} = derive(args, transcript([observation]))

    assert {:error, {:mission_material_label_missing, @first}, meta} = result
    assert meta.provider_call_count == 1
    refute Map.has_key?(meta, :narrative)
    assert {:ok, ir} = AuthoringTranscript.to_request_ir(meta.judgment_transcript)
    assert {:ok, []} = RequestIR.pending_call_ids(ir)

    assert [failure] =
             for(
               message <- ir.messages,
               %{type: "validation_result", status: "failed"} = block <- message.blocks,
               do: block
             )

    assert failure.reason_code == "mission_material_label_missing"
    assert failure.retryable == false

    assert Enum.any?(ir.messages, fn message ->
             Enum.any?(message.blocks, fn block ->
               block.type == "tool_call" and block.call_id == failure.call_id and
                 RequestIR.json_value(block.arguments) == args
             end)
           end)

    refute_receive {:binding_request, _}
  end

  test "隐藏和纯索引不复活，未知 ref 即使与已读章同名也仍被丢弃" do
    hidden_ref = "chapter:hidden"
    index_ref = "chapter:index-only"
    hidden = directory_for(hidden_ref, "第01章：黑市对账夜")

    transcript =
      AuthoringTranscript.new(@run,
        base_text: "作者保留采纳权。",
        author_text: "此前核对过章节目录。",
        author_turn_ref: "turn-binding-prior"
      )
      |> append_read("binding-read-1", hidden)
      |> AuthoringTranscript.append_author_turn(@author_text, "turn-binding")

    covers = %{call_ids: ["binding-read-1"], message_refs: []}
    {refs, versions} = Compaction.evidence(transcript.messages, covers)

    assert {:ok, transcript} =
             AuthoringTranscript.compact(
               transcript,
               covers,
               refs,
               versions,
               ["旧页原文已隐藏。"],
               "曾读过一页，当前未重新供应。"
             )

    index = %{
      status: "ok",
      source_refs: [%{ref: index_ref}],
      content: %{tool: "archive_read", query: "仅索引", facts: %{}}
    }

    transcript =
      transcript
      |> append_read("visible-read", directory_for(@first, "第01章：黑市对账夜"))
      |> append_read("index-read", index)

    {result, request} = derive(arguments([@first, hidden_ref, index_ref]), transcript)
    assert {:ok, mission, meta} = result
    assert [%{"basis_ref" => @first}] = mission.must_advance
    assert Enum.map(mission.dropped, & &1["basis_ref"]) == [hidden_ref, index_ref]
    assert meta.provider_call_count == 1
    assert RequestIR.Tools.tool_choice(request) == "planning_mission"

    visible_refs =
      request
      |> RequestIR.usable_observations()
      |> Enum.flat_map(& &1.source_refs)
      |> Enum.map(&(&1[:ref] || &1["ref"]))

    assert @first in visible_refs
    refute hidden_ref in visible_refs
    refute index_ref in visible_refs
  end

  test "Writer 实际请求保留同 ref 的来源与版本差异，长名称不吞掉覆盖限定" do
    long_title = String.duplicate("黑市对账夜", 24)
    directory = directory_for(@first, long_title)

    later_page =
      chapter_page()
      |> Map.put(:versions, %{@first => 2})
      |> Map.put(:omissions, ["本页仅用于核对开头，后文未重新读取。"])
      |> put_in([:content, :summary], String.slice(@body, 0, 20))
      |> put_in([:coverage, :prose_range], %{start: 1, end: 20})
      |> put_in([:coverage, :coverage_note], "只供应正文第 1–20 字符，后文未重新读取。")

    {result, _request} =
      derive(arguments([@first]), transcript([directory, chapter_page(), later_page]))

    assert {:ok, mission, meta} = result
    assert {:ok, ir} = AuthoringTranscript.to_request_ir(meta.judgment_transcript)
    writer = writer_request(mission, ir)
    scope = NovelTest.TestProviderPrompt.scope_content(writer)
    mission_text = get_in(scope, ["operation", "planning_mission"])
    assert mission_text =~ long_title
    assert mission_text =~ @directory_omission
    assert mission_text =~ @preview_omission
    assert mission_text =~ "本页仅用于核对开头，后文未重新读取。"

    materials =
      scope["authoring_task"]["materials"]
      |> Enum.filter(&(&1["kind"] == "observation" and &1["ref"] == @first))

    assert [material] = materials
    assert material["complete?"] == false
    refute Map.has_key?(material, "version")
    assert material["omission_note"] =~ @directory_omission
    assert material["omission_note"] =~ @preview_omission
    assert material["omission_note"] =~ "本页仅用于核对开头，后文未重新读取。"
    assert material["omission_note"] =~ "版本 2"
    refute material["omission_note"] =~ long_title
    refute material["omission_note"] =~ @body

    for material <- scope["authoring_task"]["materials"] do
      refute Map.has_key?(material, "basis_label")
      refute Map.has_key?(material, "provenance")
    end

    refute mission_text =~ @body
    assert String.contains?(mission_text, "版本 2")
  end

  test "章正文和章摘要共用读叶时，摘要只绑定自己的预览范围" do
    summary_ref = "chapter_summary:accepted-preview"

    page =
      chapter_page()
      |> Map.put(:source_refs, [%{ref: @first}, %{ref: summary_ref}])
      |> put_in([:coverage, :chapter_summary], %{
        source_ref: summary_ref,
        status: "partial",
        representation: "preview",
        offset: 0,
        returned_graphemes: 12,
        total_graphemes: 50,
        offset_unit: "unicode_grapheme"
      })

    {result, _request} = derive(arguments([summary_ref]), transcript([directory(), page]))
    assert {:ok, mission, meta} = result
    assert [%{"basis_ref" => ^summary_ref, "basis_label" => label}] = mission.must_advance
    assert label =~ "章摘要预览"
    assert label =~ "12"
    assert label =~ "50"
    assert label =~ @preview_omission
    refute label =~ "正文第"
    refute label =~ "78"
    refute label =~ @body

    assert {:ok, ir} = AuthoringTranscript.to_request_ir(meta.judgment_transcript)
    writer = writer_request(mission, ir)

    summary_material =
      writer
      |> NovelTest.TestProviderPrompt.scope_content()
      |> get_in(["authoring_task", "materials"])
      |> Enum.find(&(&1["ref"] == summary_ref))

    assert summary_material["complete?"] == false
    refute summary_material["omission_note"] =~ "78"
  end

  test "Writer 不把同 ref 两个完整版本合成一个完整或最新版本" do
    ref = "memory:versioned"

    observations =
      for {version, text} <- [{1, "账本仍在书架后。"}, {2, "账本已移到抽屉。"}] do
        %{
          status: "ok",
          source_refs: [%{ref: ref}],
          versions: %{ref => version},
          coverage: %{complete?: true},
          omissions: [],
          content: %{tool: "memory_recall", summary: text, facts: %{}}
        }
      end

    {result, _request} = derive(arguments([ref]), transcript(observations))
    assert {:ok, mission, meta} = result
    label = hd(mission.must_advance)["basis_label"]
    assert label =~ "账本仍在书架后。"
    assert label =~ "账本已移到抽屉。"
    assert {:ok, ir} = AuthoringTranscript.to_request_ir(meta.judgment_transcript)

    materials =
      mission
      |> writer_request(ir)
      |> NovelTest.TestProviderPrompt.scope_content()
      |> get_in(["authoring_task", "materials"])
      |> Enum.filter(&(&1["ref"] == ref))

    assert [material] = materials
    assert material["complete?"] == false
    refute Map.has_key?(material, "version")
    assert material["omission_note"] =~ "版本 1"
    assert material["omission_note"] =~ "版本 2"
    refute material["omission_note"] =~ "账本"
  end

  test "多 ref 记忆预览只取其 JSON 结构中对应的文本，不能广播汇总摘要" do
    first = "memory:first-preview"
    second = "memory:second-preview"

    rows = [
      %{memory_ref: first, text: "账牌已经兑现。", representation: "summary"},
      %{memory_ref: second, text: "巡检仍在追查。", representation: "content_preview"}
    ]

    observation = %{
      status: "ok",
      source_refs: [%{ref: first}, %{ref: second}],
      versions: %{first => 1, second => 2},
      coverage: %{kind: "recall", items: Enum.map(rows, &Map.delete(&1, :text))},
      omissions: ["本次仅供应有界召回摘要或预览，不代表完整记忆。"],
      content: %{
        tool: "memory_recall",
        summary: Jason.encode!(%{returned_count: 2, items: rows}),
        facts: %{hit_count: 2}
      }
    }

    {result, _request} = derive(arguments([first, second]), transcript([observation]))
    assert {:ok, mission, _meta} = result
    [first_item, second_item] = mission.must_advance
    assert first_item["basis_label"] =~ "账牌已经兑现。"
    refute first_item["basis_label"] =~ "巡检仍在追查。"
    assert second_item["basis_label"] =~ "巡检仍在追查。"
    refute second_item["basis_label"] =~ "账牌已经兑现。"

    ambiguous = put_in(observation, [:content, :summary], "两条记忆已有变化，未逐项供应文本。")
    {result, _request} = derive(arguments([first]), transcript([ambiguous]))

    assert {:error, {:mission_material_label_missing, ^first}, meta} = result
    assert meta.provider_call_count == 1
    refute_receive {:binding_request, _}
  end

  test "档案章计划和卷蓝图同页时，各 ref 只绑定自身实际范围并供给 Writer" do
    {observation, blueprint_ref} = archive_design_page()
    args = arguments([@first, blueprint_ref])
    {result, request} = derive(args, transcript([observation]))
    assert {:ok, mission, meta} = result
    assert meta.provider_call_count == 1
    assert meta.narrative == args["author_reasoning"]
    [plan, blueprint] = mission.must_advance

    assert plan["basis_label"] ==
             "【只返回所列正文范围，其余正文尚未读取。】档案条目原文第 6–47 字符 / 共 47 字符"

    assert blueprint["basis_label"] ==
             "【只返回所列正文范围，其余正文尚未读取。】档案条目原文第 1–3957 字符 / 共 5019 字符"

    assert [actual_read] = RequestIR.usable_observations(request)
    actual_read = RequestIR.json_value(actual_read)
    assert actual_read["content"]["facts"] == %{}

    assert actual_read["coverage"]["sources"] ==
             RequestIR.json_value(observation.coverage.sources)

    assert {:ok, ir} = AuthoringTranscript.to_request_ir(meta.judgment_transcript)
    scope = mission |> writer_request(ir) |> NovelTest.TestProviderPrompt.scope_content()
    mission_text = get_in(scope, ["operation", "planning_mission"])
    assert mission_text =~ plan["basis_label"]
    assert mission_text =~ blueprint["basis_label"]
    refute mission_text =~ "追回账本"
    refute mission_text =~ "蓝图原文"

    materials =
      scope["authoring_task"]["materials"]
      |> Enum.filter(&(&1["ref"] in [@first, blueprint_ref]))

    assert Enum.map(materials, & &1["ref"]) == [@first, blueprint_ref]

    for material <- materials do
      assert material["complete?"] == false
      assert material["omission_note"] == "只返回所列正文范围，其余正文尚未读取。"
      refute Map.has_key?(material, "basis_label")
      refute Map.has_key?(material, "version")
    end
  end

  test "档案来源范围必须唯一且合法，不能用同页总正文补缺失或歧义依据" do
    {observation, _blueprint_ref} = archive_design_page()
    [plan, blueprint] = observation.coverage.sources

    invalid_sources = [
      [blueprint],
      [%{plan | ref: "chapter:wrong"}, blueprint],
      [plan, plan, blueprint],
      [%{plan | offset: -1}, blueprint],
      [%{plan | returned_graphemes: 0}, blueprint],
      [%{plan | returned_graphemes: 43}, blueprint],
      [%{plan | offset_unit: "byte"}, blueprint]
    ]

    for sources <- invalid_sources do
      invalid = put_in(observation, [:coverage, :sources], sources)
      {result, _request} = derive(arguments([@first]), transcript([invalid]))
      assert {:error, {:mission_material_label_missing, @first}, meta} = result
      assert meta.provider_call_count == 1
      assert {:ok, ir} = AuthoringTranscript.to_request_ir(meta.judgment_transcript)
      assert {:ok, []} = RequestIR.pending_call_ids(ir)
      refute_receive {:binding_request, _}
    end
  end

  test "单来源档案只绑定实际范围，同一依据用于两条使命也不重复供应原文" do
    observation = archive_stats_page()
    ref = "archive:stats"

    args =
      arguments([ref])
      |> Map.put("must_avoid", [%{"text" => "不宣称已有已采纳正文。", "basis_ref" => ref}])

    {result, _request} = derive(args, transcript([observation]))
    assert {:ok, mission, meta} = result

    for item <- mission.must_advance ++ mission.must_avoid do
      assert item["basis_label"] ==
               "【仅表示本次可见读取；未声明完整覆盖】档案条目原文第 1–37 字符 / 共 37 字符"
    end

    assert meta.narrative == args["author_reasoning"]
    assert {:ok, ir} = AuthoringTranscript.to_request_ir(meta.judgment_transcript)
    writer = writer_request(mission, ir)
    scope = NovelTest.TestProviderPrompt.scope_content(writer)
    refute scope["operation"]["planning_mission"] =~ observation.content.summary

    assert [%{"ref" => ^ref, "complete?" => false}] =
             Enum.filter(scope["authoring_task"]["materials"], &(&1["ref"] == ref))

    for wire <- ~w(chat_completions responses_api anthropic_messages) do
      assert {:ok, body} = Projection.project(writer, wire)
      assert length(String.split(Jason.encode!(body), observation.content.summary)) == 2
    end
  end

  test "单来源档案范围缺失或不能归属时，不退回总原文作为依据" do
    observation = archive_stats_page()

    invalid_observations = [
      update_in(observation, [:coverage], &Map.delete(&1, :summary)),
      put_in(observation, [:coverage, :summary, :offset_unit], "byte"),
      Map.put(observation, :source_refs, [%{ref: "archive:stats"}, %{ref: "archive:profile"}]),
      put_in(observation, [:coverage, :sources], [
        Map.put(observation.coverage.summary, :ref, "archive:profile")
      ])
    ]

    for invalid <- invalid_observations do
      {result, _request} = derive(arguments(["archive:stats"]), transcript([invalid]))
      assert {:error, {:mission_material_label_missing, "archive:stats"}, meta} = result
      assert meta.provider_call_count == 1
      assert {:ok, ir} = AuthoringTranscript.to_request_ir(meta.judgment_transcript)
      assert {:ok, []} = RequestIR.pending_call_ids(ir)
      refute_receive {:binding_request, _}
    end
  end

  defp arguments(refs) do
    %{
      "author_reasoning" => " \n先核对已读材料，再安排后三章。\r\n",
      "statement" => " \n保留既有三章，提出后续待采纳大纲。\u00A0",
      "must_advance" => Enum.map(refs, &%{"text" => "保留既有约定。", "basis_ref" => &1}),
      "must_avoid" => [],
      "confidence" => 0.9
    }
  end

  defp derive(args, transcript) do
    parent = self()

    provider =
      Execution.with_event_sink(
        %Execution{
          result_fn: fn request ->
            send(parent, {:binding_request, request})

            {:ok,
             %{
               provider_call_id: "pc-binding-mission",
               content: "",
               tool_calls: [
                 %{id: "call-binding-mission", name: "planning_mission", arguments: args}
               ]
             }}
          end
        },
        fn _ -> :ok end
      )

    result =
      ChapterMissionService.derive(ChapterMissionInputs.build(%{mode: :planning}), provider,
        kind: :planning,
        run: @run,
        snapshot: %{stage_state: %{judgment_transcript: transcript}},
        author_text: @author_text,
        source_input_ref: "turn-binding"
      )

    assert_receive {:binding_request, request}
    {result, request}
  end

  defp transcript(observations) do
    initial =
      AuthoringTranscript.new(@run,
        base_text: "作者保留采纳权。",
        author_text: @author_text,
        author_turn_ref: "turn-binding"
      )

    observations
    |> Enum.with_index(1)
    |> Enum.reduce(initial, fn {observation, index}, current ->
      append_read(current, "binding-read-#{index}", observation)
    end)
  end

  defp append_read(transcript, call_id, observation) do
    transcript
    |> AuthoringTranscript.append_assistant("", [
      RequestIR.tool_call_block(observation.content.tool, %{}, call_id)
    ])
    |> AuthoringTranscript.append_observation(call_id, observation)
  end

  defp directory do
    chapters = [
      %{ref: @first, seq: 1, title: "第01章：黑市对账夜", has_prose: true},
      %{ref: @second, seq: 2, title: "第02章：旧账兑现", has_prose: true},
      %{ref: @third, seq: 3, title: "第03章：巡检收网", has_prose: false}
    ]

    %{
      status: "ok",
      source_refs: Enum.map(chapters, &%{ref: &1.ref}),
      versions: %{},
      coverage: %{kind: "directory", facet: "chapters", returned_items: 3, total_items: 3},
      omissions: [@directory_omission],
      next_offset: nil,
      content: %{
        tool: "archive_read",
        summary: "章节目录：本页列出三章，仅提供目录信息。",
        facts: %{chapters: chapters}
      }
    }
  end

  defp directory_for(ref, title) do
    directory()
    |> Map.put(:source_refs, [%{ref: ref}])
    |> put_in([:content, :facts, :chapters], [%{ref: ref, title: title}])
    |> put_in([:content, :summary], "章节目录：本页列出一章，仅提供目录信息。")
    |> put_in([:coverage, :returned_items], 1)
    |> put_in([:coverage, :total_items], 1)
  end

  defp chapter_page do
    %{
      status: "ok",
      source_refs: [%{ref: @first}],
      versions: %{},
      coverage: %{
        chapter_ref: @first,
        prose_range: %{start: 1, end: 78},
        prose_total_chars: 78,
        coverage_note: "本章正文已读 1–78/78 字符，已覆盖全章正文。",
        chapter_plan: %{
          source_ref: @first,
          representation: "preview",
          status: "partial",
          returned_graphemes: 28,
          total_graphemes: 28
        },
        chapter_summary: %{status: "unavailable"}
      },
      omissions: [@preview_omission],
      next_offset: nil,
      content: %{tool: "chapter_read", summary: @body, facts: %{prose_chars: 78}}
    }
  end

  defp archive_stats_page do
    %{
      status: "ok",
      source_refs: [%{ref: "archive:stats"}],
      versions: %{},
      coverage: %{
        kind: "facet",
        facet: "stats",
        work_id: @run.work_id,
        summary: %{
          offset: 0,
          returned_graphemes: 37,
          total_graphemes: 37,
          offset_unit: "unicode_grapheme"
        }
      },
      omissions: [],
      next_offset: nil,
      content: %{
        tool: "archive_read",
        summary: "已采纳正文总字数 0；卷数 0；章节数 0；已采纳角色 0；确认记忆 0。",
        facts: %{}
      }
    }
  end

  defp archive_design_page do
    blueprint_ref = "volume:binding-blueprint"
    plan_text = ~s(【章计划】{"summary":"追回账本","plan_direction":"保留约定"})
    blueprint_text = ~s(【卷蓝图】{"outline":") <> String.duplicate("蓝图原文。", 1_000) <> ~s("})
    text = plan_text <> "\n" <> blueprint_text

    sources = [
      %{
        ref: @first,
        offset: 5,
        returned_graphemes: 42,
        total_graphemes: 47,
        offset_unit: "unicode_grapheme",
        version_status: "unavailable"
      },
      %{
        ref: blueprint_ref,
        offset: 0,
        returned_graphemes: 3_957,
        total_graphemes: 5_019,
        offset_unit: "unicode_grapheme",
        version_status: "unavailable"
      }
    ]

    observation = %{
      status: "partial",
      source_refs: Enum.map(sources, &%{ref: &1.ref}),
      versions: %{},
      coverage: %{
        kind: "detail",
        facet: "chapters",
        ref: @first,
        work_id: @run.work_id,
        summary: %{
          offset: 5,
          returned_graphemes: 4_000,
          total_graphemes: 5_067,
          offset_unit: "unicode_grapheme"
        },
        sources: sources,
        chapter_prose: "not_read"
      },
      omissions: ["只返回所列正文范围，其余正文尚未读取。"],
      next_offset: 4_005,
      content: %{tool: "archive_read", summary: String.slice(text, 5, 4_000), facts: %{}}
    }

    {observation, blueprint_ref}
  end

  defp writer_request(mission, ir) do
    parent = self()

    frame = %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-binding",
      turn_id: "turn-binding",
      workspace_id: @run.workspace_id,
      primary: true,
      frame_type: :execution_candidate,
      source_refs: %{},
      dialogue_goal: %{summary: @author_text},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "好的"},
      evidence_summary: %{},
      uncertainty: []
    }

    plan = %MicroPlan{
      plan_id: "plan-binding",
      turn_id: frame.turn_id,
      frame_ref: frame.frame_id,
      plan_goal: %{summary: @author_text},
      risk_hint: :low,
      proposed_actions: [
        %{
          action_id: "act-binding",
          action_type: :capability_invocation,
          summary: "生成待采纳章节大纲",
          target_ref: "plot_outline",
          write_intent: :tentative,
          risk_hint: :low,
          target_chapter: "第01章"
        }
      ]
    }

    decision = %OrchestratorDecision{
      decision_id: "decision-binding",
      turn_id: frame.turn_id,
      frame_ref: frame.frame_id,
      decision_type: :allow_tool,
      decision_status: :decided,
      reason_codes: ["gates_passed", "tool:plot_outline"]
    }

    provider = %Execution{
      result_fn: fn request ->
        send(parent, {:binding_writer_request, request})

        {:ok,
         NovelApplication.TestAgenticLoopFixtures.native_artifact_result(
           [%{item_id: "binding-outline", title: "候选", body: "雨停后，她合上账本。", rationale: nil}],
           provider_call_id: "pc-binding-writer",
           call_id: "call-binding-writer"
         )}
      end
    }

    {result, _trace, _transcript} =
      TurnExecutionService.execute(%{
        frame: frame,
        plan: plan,
        decision: decision,
        candidates: [],
        context: %DialogueContext{
          work_id: @run.work_id,
          current_chapters: ["第01章"],
          structured_chapters: [
            %{id: "chapter-binding", title: "第01章", seq: 1, summary: nil, has_prose: false}
          ]
        },
        author_input: %{
          text: @author_text,
          turn_id: "turn-binding",
          author_goal_text: @author_text
        },
        provider_execution: provider,
        agent_run: @run,
        request_ir: ir,
        planning_mission: ChapterMission.to_map(mission)
      })

    assert result.tool_result.status == :succeeded, inspect(result.tool_result, pretty: true)
    assert_receive {:binding_writer_request, request}
    request
  end
end
