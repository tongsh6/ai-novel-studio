defmodule NovelApplication.B27RequestSourceTest do
  @moduledoc """
  B27 §9 CP1：supplied/available 声明必须与同一次判断请求实际渲染的材料同源。

  - supplied_context_refs 只来自该次 context_block 真正渲染的来源；
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
      fn _ws, _text, _session ->
        {:ok, %{title: "B27 同源请求复现作品", genre: "雨港悬疑"}, "会话摘要：作者上一轮确认主角在查旧账。",
         "相关记忆：作者确认主角动机是查清灯楼旧账并决定是否点灯。", "上轮开放行为：等待作者确认是否下井。", ["第01章：灯楼夜话"]}
      end,
      []
    )
  end

  defp run(profile_ref) do
    %{
      profile_ref: profile_ref,
      parent_turn_ref: "turn-b27-cp1",
      work_id: "ws-b27-cp1",
      session_id: "s-b27-cp1",
      goal: %{text: "现在主角的核心动机是什么？", version: 1}
    }
  end

  defp protocol_input(context, profile_ref, explorations \\ []) do
    DialoguePlanningService.judgment_protocol_input_for_test(
      %{text: "现在主角的核心动机是什么？"},
      run(profile_ref),
      context,
      explorations
    )
  end

  defp prompt_text(protocol_input) do
    %{messages: [%{content: content}]} = JudgmentProtocol.prompt(protocol_input)
    content
  end

  test "普通 profile：supplied=实际渲染的 work/conversation/behavior；memory 为 available-not-supplied" do
    context = context_with_all_sources()
    input = protocol_input(context, "judgment_loop_v1")
    prompt = prompt_text(input)

    assert length(input.supplied_context_refs) == 3
    assert length(input.available_context_refs) == 1

    by_id = Map.new(context.context_refs, &{&1.context_ref, &1.source_type})
    supplied_types = input.supplied_context_refs |> Enum.map(&by_id[&1]) |> Enum.sort()
    available_types = input.available_context_refs |> Enum.map(&by_id[&1])

    assert supplied_types == [:behavior, :conversation, :current_work]
    assert available_types == [:memory]

    assert prompt =~ "B27 同源请求复现作品"
    assert prompt =~ "会话摘要：作者上一轮确认主角在查旧账。"
    assert prompt =~ "上轮开放行为：等待作者确认是否下井。"
    refute prompt =~ "相关记忆：作者确认主角动机是查清灯楼旧账"

    assert input.rendered_context_sections ==
             Enum.filter(input.rendered_context_sections, &is_binary/1)

    assert "work" in input.rendered_context_sections
    assert "conversation" in input.rendered_context_sections
    assert "behavior" in input.rendered_context_sections
    refute "memory" in input.rendered_context_sections
  end

  test "写作 profile：只渲染 work 段，conversation/behavior/memory 均为 available-not-supplied" do
    context = context_with_all_sources()
    input = protocol_input(context, ProseDraftingWithQuality.profile_ref())
    prompt = prompt_text(input)

    by_id = Map.new(context.context_refs, &{&1.context_ref, &1.source_type})
    assert Enum.map(input.supplied_context_refs, &by_id[&1]) == [:current_work]

    assert Enum.sort(Enum.map(input.available_context_refs, &by_id[&1])) == [
             :behavior,
             :conversation,
             :memory
           ]

    assert prompt =~ "B27 同源请求复现作品"
    refute prompt =~ "会话摘要：作者上一轮确认主角在查旧账。"
    refute prompt =~ "上轮开放行为：等待作者确认是否下井。"
    refute prompt =~ "相关记忆：作者确认主角动机是查清灯楼旧账"

    assert input.rendered_context_sections |> Enum.sort() == ["chapters", "work", "work_facts"]
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
    assert default_input.supplied_observation_refs == ["obs:memory:1"]
    assert default_prompt =~ "## 探索观察（已检索到的作品事实）"
    assert default_prompt =~ "观察正文：主角动机=查清灯楼旧账。"

    write_input = protocol_input(context, ProseDraftingWithQuality.profile_ref(), observations)
    write_prompt = prompt_text(write_input)
    assert write_input.supplied_observation_refs == []
    refute write_prompt =~ "## 探索观察（已检索到的作品事实）"
  end

  test "AU03 部分失败：work 仍渲染并可 supplied，失败来源只进 unavailable，不伪造 supplied" do
    context =
      ContextAssembler.assemble_for_input(
        "ws-b27-cp1-fault",
        "第03章有没有旧账？",
        fn _ws, _text, _session ->
          {:ok, %{title: "B27 故障作品", genre: "悬疑", core_selling_point: "读取失败与真实空"}, nil, nil, nil,
           [], [], %{},
           %{
             work: :ok,
             conversation: :empty,
             memory: :empty,
             behavior: :empty,
             chapters: :unavailable,
             interaction: :empty
           }}
        end,
        []
      )

    input = protocol_input(context, "judgment_loop_v1")
    prompt = prompt_text(input)
    assert length(input.supplied_context_refs) == 1
    assert input.available_context_refs == []
    assert input.unavailable_sources == ["chapters"]
    assert prompt =~ "## 上下文可用性"
    refute prompt =~ "全书 0 章"
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
    assert judgment.reply_record.unavailable_sources == []
    assert judgment.reply_record.rendered_context_sections == input.rendered_context_sections
    assert judgment.reply_record.observation_refs == ["obs:1"]
  end

  test "CP2：chapters 有渲染内容但无 ContextSourceRef → 不发明 ref，仍如实记录渲染段" do
    context = context_with_all_sources()
    input = protocol_input(context, "judgment_loop_v1")
    prompt = prompt_text(input)

    assert "chapters" in input.rendered_context_sections
    assert prompt =~ "## 章节列表"
    refute Enum.any?(input.supplied_context_refs, &String.contains?(to_string(&1), "chapter:"))
  end

  test "CP2：重复/重试的观察 refs 去重；未渲染的观察不计入" do
    context = context_with_all_sources()

    observations = [
      %{tool: "memory_recall", query: "动机", summary: "观察 A", refs: ["obs:1"]},
      %{tool: "memory_recall", query: "动机", summary: "观察 B", refs: ["obs:1"]}
    ]

    input = protocol_input(context, "judgment_loop_v1", observations)
    assert input.supplied_observation_refs == ["obs:1"]
  end

  test "CP2：历史旧 reply_record 无同源字段 → unknown/空，不回填已供给" do
    legacy_input = %{
      author_text: "历史问题",
      context_block: "历史材料",
      source_input_ref: "author-old",
      supplied_context_refs: ["ctx_old"],
      options: []
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
        fn _ws, _text, _session ->
          {:ok, %{title: "作品甲", genre: "悬疑"}, "会话甲摘要", "记忆甲内容", nil, []}
        end,
        []
      )

    context_b =
      ContextAssembler.assemble_for_input(
        "ws-b27-b",
        "问题 B",
        fn _ws, _text, _session ->
          {:ok, %{title: "作品乙", genre: "奇幻"}, "会话乙摘要", "记忆乙内容", nil, []}
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
