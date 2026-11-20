defmodule NovelApplication.B27RequestSourceTest do
  @moduledoc """
  B27 §9 CP1：supplied/available 声明必须与同一次判断请求实际渲染的材料同源。

  - supplied_context_refs 只来自该次 结构化 Scope 实际供应的来源；
  - memory 在初始判断请求中不渲染 → available-not-supplied，保留按需 memory_recall；
  - 写作 profile 不渲染 conversation/behavior/memory → 不得声明 supplied；
  - 探索观察只有实际渲染进该次请求才计入 supplied_observation_refs；
  - AU03 失败/未知来源只进 unavailable，不产生虚假 supplied。
  """
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox

  alias NovelApplication.{
    AgentRunFlows.ProseDraftingWithQuality,
    ContextAssembler,
    DialoguePlanningService,
    JudgmentProtocol
  }

  alias NovelCommon.Contracts.ProviderOutput
  alias NovelPersistence.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    %{}
  end

  defp context_with_all_sources do
    ContextAssembler.assemble_for_input(
      "ws-b27-cp1",
      "现在主角的核心动机是什么？",
      fn workspace_id, _text, _session ->
        {:ok,
         %NovelDomain.DialogueContext{
           work_id: workspace_id,
           current_work_snapshot: %{title: "B27 同源请求复现作品", genre: "雨港悬疑"},
           conversation_summary: "会话摘要：作者上一轮确认主角在查旧账。",
           memory_summary: "相关记忆：作者确认主角动机是查清灯楼旧账并决定是否点灯。",
           open_behavior_summary: "上轮开放行为：等待作者确认是否下井。",
           structured_chapters: [
             %{id: "fixture-chapter-1", title: "第01章：灯楼夜话", seq: 1, has_prose: true}
           ],
           interaction_state: %{},
           source_status: %{
             work: :ok,
             conversation: :ok,
             memory: :ok,
             behavior: :ok,
             chapters: :ok,
             interaction: :empty
           }
         }}
      end,
      []
    )
  end

  defp run(profile_ref, work_id) do
    %{
      run_id: "run-b27-source",
      profile_ref: profile_ref,
      parent_turn_ref: "turn-b27-cp1",
      work_id: work_id,
      session_id: "s-b27-cp1",
      goal: %{text: "现在主角的核心动机是什么？", version: 1}
    }
  end

  defp protocol_input(context, profile_ref, explorations \\ []) do
    protocol =
      DialoguePlanningService.judgment_protocol_input_for_test(
        %{text: "现在主角的核心动机是什么？"},
        run(profile_ref, context.work_id),
        context,
        explorations
      )

    if explorations != [] and profile_ref != ProseDraftingWithQuality.profile_ref() do
      {:ok, transcript} = JudgmentProtocol.transcript_for_production(protocol)

      transcript =
        explorations
        |> Enum.with_index(1)
        |> Enum.reduce(transcript, fn {observation, index}, acc ->
          call_id = "source-test-read-#{index}"

          acc
          |> NovelApplication.AuthoringTranscript.append_assistant("", [
            NovelCommon.RequestIR.tool_call_block(
              "judgment_decision",
              %{
                action: "explore",
                author_reasoning: "先读取当前作品的来源资料。",
                explore_request: %{tool: observation.tool, query: observation.query}
              },
              call_id
            )
          ])
          |> JudgmentProtocol.observation_transcript(%{tool_call_id: call_id}, observation)
        end)

      Map.put(protocol, :transcript, transcript)
    else
      protocol
    end
  end

  defp prompt_text(protocol_input) do
    protocol_input
    |> JudgmentProtocol.request_for_production()
    |> NovelApplication.TestAgenticLoopFixtures.prompt_text()
  end

  defp reply_record(input) do
    execution =
      NovelApplication.TestAgenticLoopFixtures.scripted_judgment_execution(fn _request ->
        {:narrative, "仅说明本次实际提供的材料。"}
      end)

    assert {:ok, judgment} = JudgmentProtocol.request_judgment(execution, %{}, input)
    judgment.reply_record
  end

  test "普通 profile：supplied=实际渲染的 work/behavior；conversation/memory available-not-supplied（CP6 会话材料退役）" do
    context = context_with_all_sources()
    input = protocol_input(context, "judgment_loop_v1")
    prompt = prompt_text(input)

    assert length(input.supplied_context_refs) == 3
    assert length(input.available_context_refs) == 2

    by_id = Map.new(context.context_refs, &{&1.context_ref, &1.source_type})

    supplied_types =
      input.supplied_context_refs
      |> Enum.flat_map(fn ref -> if by_id[ref], do: [by_id[ref]], else: [] end)
      |> Enum.sort()

    available_types = input.available_context_refs |> Enum.map(&by_id[&1])

    assert supplied_types == [:behavior, :current_work]
    assert Enum.sort(available_types) == [:conversation, :memory]

    assert prompt =~ "B27 同源请求复现作品"
    refute prompt =~ "会话摘要：作者上一轮确认主角在查旧账。"
    assert prompt =~ "上轮开放行为：等待作者确认是否下井。"
    refute prompt =~ "相关记忆：作者确认主角动机是查清灯楼旧账"

    assert input.rendered_context_sections ==
             Enum.filter(input.rendered_context_sections, &is_binary/1)

    assert "work" in input.rendered_context_sections
    refute "conversation" in input.rendered_context_sections
    assert "open_behavior_summary" in input.rendered_context_sections
    refute "memory" in input.rendered_context_sections
  end

  test "写作 profile：只渲染 work 段，conversation/behavior/memory 均为 available-not-supplied" do
    context = context_with_all_sources()
    input = protocol_input(context, ProseDraftingWithQuality.profile_ref())
    prompt = prompt_text(input)

    by_id = Map.new(context.context_refs, &{&1.context_ref, &1.source_type})
    assert Enum.filter(Enum.map(input.supplied_context_refs, &by_id[&1]), & &1) == [:current_work]
    assert "work:ws-b27-cp1" in input.supplied_context_refs
    refute "chapter:fixture-chapter-1" in input.supplied_context_refs

    assert Enum.sort(Enum.map(input.available_context_refs, &by_id[&1])) == [
             :behavior,
             :conversation,
             :memory
           ]

    assert prompt =~ "B27 同源请求复现作品"
    refute prompt =~ "会话摘要：作者上一轮确认主角在查旧账。"
    refute prompt =~ "上轮开放行为：等待作者确认是否下井。"
    refute prompt =~ "相关记忆：作者确认主角动机是查清灯楼旧账"

    assert "work" in input.rendered_context_sections
    refute "chapters" in input.rendered_context_sections
    assert input.scope.context == %{}
  end

  test "探索观察只有渲染进该次请求才计入 supplied_observation_refs" do
    context = context_with_all_sources()

    observations = [
      %{
        tool: "memory_recall",
        query: "主角动机",
        summary: "观察正文：主角动机=查清灯楼旧账。",
        refs: ["obs:memory:1"]
      }
    ]

    default_input = protocol_input(context, "judgment_loop_v1", observations)
    default_prompt = prompt_text(default_input)
    assert reply_record(default_input).supplied_observation_refs == ["obs:memory:1"]

    assert Enum.any?(
             JudgmentProtocol.request_for_production(default_input).messages,
             fn message ->
               Enum.any?(message.blocks, &(&1.type == "observation"))
             end
           )

    assert default_prompt =~ "观察正文：主角动机=查清灯楼旧账。"

    write_input = protocol_input(context, ProseDraftingWithQuality.profile_ref(), observations)
    write_prompt = prompt_text(write_input)
    assert reply_record(write_input).supplied_observation_refs == []
    refute write_prompt =~ "观察正文：主角动机=查清灯楼旧账。"

    # 已经写入 canonical 的观察仍实际可见，不能仅凭 profile 隐去供给声明。
    visible_write_input = Map.put(write_input, :transcript, default_input.transcript)
    assert prompt_text(visible_write_input) =~ "观察正文：主角动机=查清灯楼旧账。"
    assert reply_record(visible_write_input).supplied_observation_refs == ["obs:memory:1"]
  end

  test "AU03 部分失败：work 仍渲染并可 supplied，失败来源只进 unavailable，不伪造 supplied" do
    context =
      ContextAssembler.assemble_for_input(
        "ws-b27-cp1-fault",
        "第03章有没有旧账？",
        fn workspace_id, _text, _session ->
          {:ok,
           %NovelDomain.DialogueContext{
             work_id: workspace_id,
             current_work_snapshot: %{
               title: "B27 故障作品",
               genre: "悬疑",
               core_selling_point: "读取失败与真实空"
             },
             conversation_summary: nil,
             memory_summary: nil,
             open_behavior_summary: nil,
             structured_chapters: [],
             interaction_state: %{},
             source_status: %{
               work: :ok,
               conversation: :empty,
               memory: :empty,
               behavior: :empty,
               chapters: :unavailable,
               interaction: :empty
             }
           }}
        end,
        []
      )

    input = protocol_input(context, "judgment_loop_v1")
    prompt = prompt_text(input)
    assert length(input.supplied_context_refs) == 2
    assert input.available_context_refs == []
    assert "chapters" in input.unavailable_sources
    assert input.scope.coverage.chapters == %{status: "not_read"}
    refute Map.has_key?(input.scope.facts, :chapters)
    assert prompt =~ "B27 故障作品"
  end

  test "reply_record 继承同源字段（supplied/available/rendered/unavailable）" do
    context = context_with_all_sources()

    observations = [
      %{tool: "memory_recall", query: "动机", summary: "观察正文：动机=旧账。", refs: ["obs:1"]}
    ]

    input = protocol_input(context, "judgment_loop_v1", observations)

    result = %{
      content: "当前主角动机是查清旧账。",
      tool_calls: [],
      provider_output: %ProviderOutput{
        provider_run_ref: "prun-b27",
        provider_call_ref: "pcall-b27",
        status: :ok,
        content: %{text: "当前主角动机是查清旧账。", tool_calls: []}
      }
    }

    execution = %NovelAgent.Provider.Execution{result_fn: fn _prompt -> {:ok, result} end}

    assert {:ok, judgment} = JudgmentProtocol.request_judgment(execution, %{}, input)
    assert judgment.reply_record.supplied_context_refs == input.supplied_context_refs
    assert judgment.reply_record.available_context_refs == input.available_context_refs
    assert judgment.reply_record.supplied_observation_refs == ["obs:1"]
    assert judgment.reply_record.unavailable_sources == input.unavailable_sources
    assert judgment.reply_record.rendered_context_sections == input.rendered_context_sections
    assert judgment.reply_record.observation_refs == ["obs:1"]
  end

  test "内部章节 DTO 的关联 ref 不冒充默认判断已供应材料" do
    context = context_with_all_sources()
    input = protocol_input(context, "judgment_loop_v1")
    prompt = prompt_text(input)

    refute "chapters" in input.rendered_context_sections
    refute prompt =~ "第01章：灯楼夜话"
    refute "chapter:fixture-chapter-1" in input.supplied_context_refs
    refute Map.has_key?(input.scope.facts, :chapters)
  end

  test "CP2：重复/重试的观察 refs 去重；未渲染的观察不计入" do
    context = context_with_all_sources()

    observations = [
      %{tool: "memory_recall", query: "动机", summary: "观察 A", refs: ["obs:1"]},
      %{tool: "memory_recall", query: "动机", summary: "观察 B", refs: ["obs:1"]}
    ]

    input = protocol_input(context, "judgment_loop_v1", observations)
    assert reply_record(input).supplied_observation_refs == ["obs:1"]
  end

  test "未读取的来源不补造供给与可用性声明" do
    legacy_input = %{
      author_text: "历史问题",
      scope: %{facts: %{}, context: %{}, coverage: %{}},
      source_input_ref: "author-old",
      supplied_context_refs: ["ctx_old"],
      options: [plan_run: %{run_id: "run-b27-unread-source"}]
    }

    result = %{
      content: "历史回复。",
      tool_calls: [],
      provider_output: %ProviderOutput{
        provider_run_ref: "prun-old",
        provider_call_ref: "pcall-old",
        status: :ok,
        content: %{text: "历史回复。", tool_calls: []}
      }
    }

    execution = %NovelAgent.Provider.Execution{result_fn: fn _prompt -> {:ok, result} end}

    assert {:ok, judgment} = JudgmentProtocol.request_judgment(execution, %{}, legacy_input)
    assert judgment.reply_record.supplied_context_refs == ["ctx_old"]
    assert judgment.reply_record.available_context_refs == []
    assert judgment.reply_record.supplied_observation_refs == []
    assert judgment.reply_record.rendered_context_sections == []
    assert judgment.reply_record.unavailable_sources == []
  end

  test "CP2：跨作品 context 的 supplied/available 不共享上下文" do
    context_a =
      ContextAssembler.assemble_for_input(
        "ws-b27-a",
        "问题 A",
        fn workspace_id, _text, _session ->
          {:ok,
           %NovelDomain.DialogueContext{
             work_id: workspace_id,
             current_work_snapshot: %{title: "作品甲", genre: "悬疑"},
             conversation_summary: "会话甲摘要",
             memory_summary: "记忆甲内容",
             open_behavior_summary: nil,
             structured_chapters: [],
             interaction_state: %{},
             source_status: %{
               work: :ok,
               conversation: :ok,
               memory: :ok,
               behavior: :empty,
               chapters: :empty,
               interaction: :empty
             }
           }}
        end,
        []
      )

    context_b =
      ContextAssembler.assemble_for_input(
        "ws-b27-b",
        "问题 B",
        fn workspace_id, _text, _session ->
          {:ok,
           %NovelDomain.DialogueContext{
             work_id: workspace_id,
             current_work_snapshot: %{title: "作品乙", genre: "奇幻"},
             conversation_summary: "会话乙摘要",
             memory_summary: "记忆乙内容",
             open_behavior_summary: nil,
             structured_chapters: [],
             interaction_state: %{},
             source_status: %{
               work: :ok,
               conversation: :ok,
               memory: :ok,
               behavior: :empty,
               chapters: :empty,
               interaction: :empty
             }
           }}
        end,
        []
      )

    input_a = protocol_input(context_a, "judgment_loop_v1")
    input_b = protocol_input(context_b, "judgment_loop_v1")

    assert MapSet.disjoint?(
             MapSet.new(input_a.supplied_context_refs ++ input_a.available_context_refs),
             MapSet.new(input_b.supplied_context_refs ++ input_b.available_context_refs)
           )

    prompt_a = prompt_text(input_a)
    refute prompt_a =~ "作品乙"
    refute prompt_a =~ "记忆乙内容"
  end
end
