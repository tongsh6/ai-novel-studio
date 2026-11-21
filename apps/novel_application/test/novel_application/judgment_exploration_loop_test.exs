defmodule NovelApplication.JudgmentExplorationLoopTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentRunService
  alias NovelApplication.{DialoguePlanningService, WorkService}
  alias NovelCommon.Contracts.ProviderOutput
  alias NovelCommon.RequestIR
  alias NovelDomain.AgentRun
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume}
  alias NovelTest.TestProviderPrompt

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  @full_read_title "灰烬中的手印"
  @first_page_anchor "开篇锚点：灰烬里按出一枚手印"
  @last_page_anchor "末页独有锚点：井底浮现第七枚手印"

  @prose "陈九斤蹲在矿区的出气口边上，把今天的灵气账单摊开在膝盖上。宗门的抽成又涨到了七成。"

  @tag :r05_explore_contract
  test "explore 越界正文先纠错闭合原调用，内部读取后由真实 reply 收束" do
    work_id = seed_work_with_prose()
    test_pid = self()

    narrative = "  先读账单段落，再判断代价是否充分。\n"
    provider_execution = explore_then_reply_execution(test_pid, narrative)

    assert {:ok, spec} =
             DialoguePlanningService.plan_agent_run(
               %{
                 text: "查一下正文里「灵气账单」是怎么写的",
                 workspace_id: work_id,
                 work_id: work_id,
                 session_id: "session-explore",
                 turn_id: "turn-explore"
               },
               nil,
               provider_execution
             )

    {:ok, run} = AgentRun.new(spec.run_attrs)
    sink = fn event -> send(test_pid, {:stage_event, event}) end
    empty = %{stage_state: %{}, observations: [], events: [], stage_sink: sink}

    # 机械准备
    assert {:execute, context_step, _decision, _meta} = spec.next_step_planner.(run, 1, empty)
    assert {:ok, context_result} = context_step.(run, 1, empty)

    snapshot1 = %{empty | stage_state: context_result.stage_state}

    # 判断①：作者正文字段先失败并闭合调用，裸结构纠正后读取（2 次判断；检索本身 0 调用）。
    assert {:execute, judgment_step1, _d1, _m1} = spec.next_step_planner.(run, 2, snapshot1)
    assert {:ok, explore_result} = judgment_step1.(run, 2, snapshot1)

    assert explore_result.provider_call_count == 2
    refute Map.has_key?(explore_result, :turn_result)
    assert [observation] = explore_result.stage_state.judgment_explorations
    assert observation.tool == "prose_search"
    assert observation.query == "灵气账单"
    # 真实检索命中：观察携带章出处与原文片段
    assert observation.summary =~ "第01章"
    assert observation.summary =~ "灵气账单"
    assert [ref | _] = observation.refs
    assert ref =~ "chapter:"

    # 当前 Scope 只给允许名称；固定工具定义在初始 Base 中保持一次。
    [first_prompt_map, corrected_prompt] = drain_prompt_maps([])
    corrected_blocks = Enum.flat_map(corrected_prompt.messages, & &1.blocks)
    assert [failed] = Enum.filter(corrected_blocks, &(&1.type == "validation_result"))
    assert failed.status == "failed"
    assert failed.reason_code == "invalid_tool_arguments"
    assert [rejected] = Enum.filter(corrected_blocks, &(&1.type == "tool_call"))
    assert failed.call_id == rejected.call_id
    refute Map.has_key?(rejected.arguments, "dialogue_goal")
    assert rejected.arguments["author_reasoning"] == narrative
    assert {:ok, []} = RequestIR.pending_call_ids(corrected_prompt)

    first_exploration =
      TestProviderPrompt.scope_content(first_prompt_map)["operation"]["exploration"]

    assert first_exploration["allowed"] == true
    assert "prose_search" in first_exploration["tools"]
    refute Map.has_key?(first_exploration, "catalog")
    base = Enum.find(first_prompt_map.messages, &(&1.role == "application_base"))
    base_text = NovelApplication.TestAgenticLoopFixtures.message_text(base)
    assert base_text =~ ~s("tool":"prose_search")
    assert base_text =~ "全文检索已采纳正文"

    # exploration_observed 阶段事件已发
    assert_received {:stage_event, %{event_type: :exploration_observed} = stage_event}
    assert stage_event.payload.tool == "prose_search"
    assert stage_event.payload.summary =~ "第01章"
    refute_received {:stage_event, %{event_type: :judgment_decided}}

    # 回环：planner 未见 settle → 再入判断步
    snapshot2 = %{
      empty
      | stage_state: Map.merge(context_result.stage_state, explore_result.stage_state)
    }

    assert {:execute, judgment_step2, _d2, _m2} = spec.next_step_planner.(run, 3, snapshot2)
    assert {:ok, reply_result} = judgment_step2.(run, 3, snapshot2)

    # 第二轮请求以原生 tool observation 回流，call_id 与首轮判断工具调用一致。
    prompt_maps = drain_prompt_maps([])

    observed_prompt =
      Enum.find(prompt_maps, fn prompt ->
        Enum.any?(prompt.messages, &(&1.role == "tool"))
      end)

    assert observed_prompt

    assert Enum.take(observed_prompt.messages, length(first_prompt_map.messages)) ==
             first_prompt_map.messages

    [observation_block] = observation_blocks(observed_prompt)

    accepted = observed_prompt.messages |> Enum.filter(&(&1.role == "assistant")) |> List.last()

    assert is_binary(accepted.provider_call_ref)
    assert is_binary(accepted.provider_run_ref)
    assert [accepted_call] = accepted.blocks
    assert Map.take(accepted_call.arguments, ["author_reasoning", "dialogue_goal"]) == %{}
    assert observation_block.call_id == accepted_call.call_id
    assert Jason.encode!(observation_block.content) =~ "灵气账单"

    application_base = Enum.find(observed_prompt.messages, &(&1.role == "application_base"))
    assert application_base

    refute NovelApplication.TestAgenticLoopFixtures.message_text(application_base) =~ "### 观察 "
    refute NovelApplication.TestAgenticLoopFixtures.message_text(application_base) =~ "陈九斤蹲在矿区"

    # reply 收束：回复引用检索事实
    assert reply_result.provider_call_count == 1
    turn_result = reply_result.turn_result
    assert turn_result.assistant_message.text =~ "灵气账单"
    assert reply_result.stage_state.judgment_settled == "completed"

    # 终结：下一迭代 complete
    snapshot3 = %{
      empty
      | stage_state: Map.merge(snapshot2.stage_state, reply_result.stage_state)
    }

    assert {:complete, _decision, meta} = spec.next_step_planner.(run, 4, snapshot3)
    assert meta.provider_call_count == 0
  end

  test "探索回合硬上限：真实两次检索后当前 Scope 关闭工具，观察仍可用于收束" do
    work_id = seed_work_with_prose()
    test_pid = self()

    execution =
      scripted_judgment_execution(fn prompt, _text ->
        send(test_pid, {:prompt_map, prompt})

        if TestProviderPrompt.scope_content(prompt)["operation"]["exploration"]["allowed"] do
          {:decision,
           %{
             "action" => "explore",
             "explore_request" => %{"tool" => "prose_search", "query" => "灵气账单"}
           }}
        else
          {:narrative, "依据已读正文：\n" <> native_cited_observation(prompt)}
        end
      end)

    assert {:ok, spec} =
             DialoguePlanningService.plan_agent_run(
               %{
                 text: "核对灵气账单",
                 workspace_id: work_id,
                 work_id: work_id,
                 session_id: "session-cap",
                 turn_id: "turn-cap"
               },
               nil,
               execution
             )

    {:ok, run} = AgentRun.new(spec.run_attrs)
    empty = %{stage_state: %{}, observations: [], events: [], stage_sink: fn _ -> :ok end}
    assert {:execute, context_step, _, _} = spec.next_step_planner.(run, 1, empty)
    assert {:ok, context_result} = context_step.(run, 1, empty)

    {result, _snapshot} =
      Enum.reduce(2..4, {nil, %{empty | stage_state: context_result.stage_state}}, fn sequence,
                                                                                      {_prior,
                                                                                       snapshot} ->
        assert {:execute, step, _, _} = spec.next_step_planner.(run, sequence, snapshot)
        assert {:ok, result} = step.(run, sequence, snapshot)
        {result, %{snapshot | stage_state: Map.merge(snapshot.stage_state, result.stage_state)}}
      end)

    [_, _, prompt] = drain_prompt_maps([])
    exploration = TestProviderPrompt.scope_content(prompt)["operation"]["exploration"]
    assert exploration["allowed"] == false
    assert exploration["tools"] == []
    refute Map.has_key?(exploration, "catalog")
    assert exploration["budget"]["total"] == 2
    assert length(observation_blocks(prompt)) == 2
    assert native_cited_observation(prompt) =~ "灵气账单"
    assert result.stage_state.judgment_settled == "completed"
  end

  test "缺失 explore_request 持续违反协议时两次调用后拒绝，不把非法工具改写为回复" do
    work_id = seed_work_with_prose()

    provider_execution =
      scripted_judgment_execution(fn _prompt, _prompt_text ->
        {:decision, %{"action" => "explore"}}
      end)

    assert {:ok, spec} =
             DialoguePlanningService.plan_agent_run(
               %{
                 text: "查一下正文里「灵气账单」是怎么写的",
                 workspace_id: work_id,
                 work_id: work_id,
                 session_id: "session-degrade",
                 turn_id: "turn-degrade"
               },
               nil,
               provider_execution
             )

    {:ok, run} = AgentRun.new(spec.run_attrs)
    sink = fn _event -> :ok end
    empty = %{stage_state: %{}, observations: [], events: [], stage_sink: sink}

    assert {:execute, context_step, _dc, _mc} = spec.next_step_planner.(run, 1, empty)
    assert {:ok, context_result} = context_step.(run, 1, empty)

    snapshot = %{empty | stage_state: context_result.stage_state}
    assert {:execute, judgment_step, _dj, _mj} = spec.next_step_planner.(run, 2, snapshot)

    # 模型没有给出合法回复；有限纠错耗尽后保留拒绝与原调用，不制造作者正文。
    assert {:error, {:judgment_protocol_violation, :invalid_tool_arguments}, state} =
             judgment_step.(run, 2, snapshot)

    assert state.provider_call_count == 2
    refute Map.has_key?(state, :turn_result)

    blocks = Enum.flat_map(state.judgment_transcript.messages, & &1.blocks)
    calls = Enum.filter(blocks, &(&1.type == "tool_call"))
    receipts = Enum.filter(blocks, &(&1.type == "validation_result"))
    assert length(calls) == 2
    assert length(receipts) == 2
    assert Enum.all?(receipts, &(&1.status == "failed"))
    assert Enum.map(receipts, & &1.call_id) == Enum.map(calls, & &1.call_id)
    refute Enum.any?(blocks, &(&1.type == "observation"))
  end

  test "探索续读全回环：作者点名 → page1 → 同源 page2（JSON offset）→ reply 引用末页独有事实" do
    {work_id, chapter_ref, versions} = seed_work_with_full_chapter()
    test_pid = self()

    provider_execution = full_read_execution(test_pid)

    assert {:ok, spec} =
             DialoguePlanningService.plan_agent_run(
               %{
                 text: "「灰烬中的手印」这章我怀疑有重复，请把全章正文核对一遍。",
                 workspace_id: work_id,
                 work_id: work_id,
                 session_id: "session-full-read",
                 turn_id: "turn-full-read"
               },
               nil,
               provider_execution
             )

    {:ok, run} = AgentRun.new(spec.run_attrs)
    sink = fn event -> send(test_pid, {:stage_event, event}) end
    empty = %{stage_state: %{}, observations: [], events: [], stage_sink: sink}

    assert {:execute, context_step, _dc, _mc} = spec.next_step_planner.(run, 1, empty)
    assert {:ok, context_result} = context_step.(run, 1, empty)
    snapshot1 = %{empty | stage_state: context_result.stage_state}

    # 首次按作者给出的章名读取；正文页与结构续读位置同时返回。
    assert {:execute, judgment_step1, _d1, _m1} = spec.next_step_planner.(run, 2, snapshot1)
    assert {:ok, explore1} = judgment_step1.(run, 2, snapshot1)

    assert [page1] = explore1.stage_state.judgment_explorations
    assert page1.refs == [chapter_ref]
    assert page1.chapter_ref == chapter_ref
    assert page1.chapter_seq == 1
    assert page1.summary =~ "「#{@full_read_title}」（第 1 章）"
    assert page1.prose_range == %{start: 1, end: 6000}
    assert page1.next_offset == 6000
    assert page1.summary =~ "【正文】第 1–6000 字符 / 共 7000 字符"
    assert page1.summary =~ "【续读】剩余 1000 字符"
    refute page1.summary =~ "chapter_ref"
    refute page1.summary =~ ~s("offset")
    refute page1.summary =~ @last_page_anchor

    # 单次判断只构造一个既有 AgentObservation：本步返回的观察即请求观察的稳定身份。
    assert [page1_observation] = explore1.observations
    page1_observation_ref = "observation:#{page1_observation.observation_id}"

    # 作者可见活动行：人类可读，不含内部工具 id / 原始 JSON / offset 字段名（I-READ-8）
    assert_received {:stage_event, %{event_type: :exploration_observed} = event1}
    assert event1.summary =~ "已阅读章节正文「#{@full_read_title}」（第 1 章；"
    assert event1.summary =~ "第 1–6000 字符 / 共 7000 字符；有效字数"
    refute event1.summary =~ "chapter_read"
    refute event1.summary =~ "chapter_ref"
    refute event1.summary =~ "chapter:"
    refute event1.summary =~ "{"
    assert event1.payload.tool == "chapter_read"
    assert event1.payload.next_offset == 6000
    refute_received {:stage_event, %{event_type: :judgment_decided}}

    # signature 不含 sequence：同 query 才可能重复，续读页不会误停（I-READ-5）。
    # 首次直接读取作者明确给出的章名；真实观察提供唯一 ref 和下一页位置。
    first_query =
      String.replace_prefix(
        explore1.progress_signature,
        "#{run.run_id}:explore:chapter_read:",
        ""
      )

    assert first_query == @full_read_title

    snapshot2 = %{empty | stage_state: Map.merge(snapshot1.stage_state, explore1.stage_state)}

    # 下一页由观察coverage中的同章ref和next_offset寻址，不解析自然摘要。
    assert {:execute, judgment_step2, _d2, _m2} = spec.next_step_planner.(run, 3, snapshot2)
    assert {:ok, explore2} = judgment_step2.(run, 3, snapshot2)

    assert [^page1, page2] = explore2.stage_state.judgment_explorations
    assert page2.chapter_ref == chapter_ref
    assert page2.chapter_seq == 1
    assert page2.prose_range == %{start: 6001, end: 7000}
    assert page2.next_offset == nil
    assert page2.summary =~ "【正文】第 6001–7000 字符 / 共 7000 字符"
    assert page2.summary =~ @last_page_anchor
    refute page2.summary =~ "【续读】"

    # 同一 actor 的 chapter ref 不变；两页是不同观察身份，下一请求按身份关联。
    assert [page2_observation] = explore2.observations
    page2_observation_ref = "observation:#{page2_observation.observation_id}"
    assert page2.refs == [chapter_ref]
    refute page1_observation_ref == page2_observation_ref

    continuation_query =
      Jason.decode!(
        String.replace_prefix(
          explore2.progress_signature,
          "#{run.run_id}:explore:chapter_read:",
          ""
        )
      )

    assert continuation_query == %{"chapter_ref" => chapter_ref, "offset" => 6000}

    assert_received {:stage_event, %{event_type: :exploration_observed} = event2}
    assert event2.summary =~ "第 6001–7000 字符"
    refute event2.summary =~ "chapter_read"
    refute event2.summary =~ "{"
    refute_received {:stage_event, %{event_type: :judgment_decided}}

    # 观察以 call-bound block 回流；续读输入直接来自 next_offset 与 coverage。
    prompt_maps = drain_prompt_maps([])

    second_prompt_map =
      Enum.find(prompt_maps, fn prompt ->
        Enum.any?(prompt.messages, &(&1.role == "tool"))
      end)

    assert second_prompt_map
    tool_message = Enum.find(second_prompt_map.messages, &(&1.role == "tool"))
    observation = Enum.find(tool_message.blocks, &(&1.type == "observation"))
    assert observation.next_offset == 6000
    assert observation.coverage["continuation_hint"] =~ "未读 6001–7000 字符"
    assert observation.coverage["continuation_hint"] =~ "chapter_read + 上一页【续读】"
    assert chapter_ref in observation.source_refs
    assert observation.versions == versions
    assert observation.content["observation_ref"] == page1_observation_ref

    # 第 3 轮：reply 引用末页独有事实（字节透传观察），单一 turn 收束
    snapshot3 = %{empty | stage_state: Map.merge(snapshot2.stage_state, explore2.stage_state)}
    assert {:execute, judgment_step3, _d3, _m3} = spec.next_step_planner.(run, 4, snapshot3)
    assert {:ok, reply_result} = judgment_step3.(run, 4, snapshot3)

    assert reply_result.turn_result.assistant_message.text =~ @last_page_anchor
    assert reply_result.stage_state.judgment_settled == "completed"
    assert_received {:stage_event, %{event_type: :judgment_decided, payload: reply}}
    assert reply.action == "reply"
    assert reply.author_narrative == reply_result.turn_result.assistant_message.text
    assert reply.author_narrative_source.source_type == "provider_output"

    assert reply.author_narrative_source.source_byte_range == %{
             start: 0,
             length: byte_size(reply.author_narrative)
           }

    refute_received {:stage_event, %{event_type: :judgment_decided}}

    # 第三轮：历史 body 完整保留；最新 scope 关闭探索，旧目录只作证据不再生效。
    [third_prompt_map] = drain_prompt_maps([])

    assert Enum.any?(
             observation_blocks(third_prompt_map),
             &String.contains?(&1.content["summary"], @last_page_anchor)
           )

    third_observations =
      for %{role: "tool", blocks: blocks} <- third_prompt_map.messages,
          %{type: "observation"} = block <- blocks,
          do: block

    assert Enum.map(third_observations, & &1.versions) == [versions, versions]
    observation_refs = Enum.map(third_observations, & &1.content["observation_ref"])
    assert observation_refs == [page1_observation_ref, page2_observation_ref]
    assert Enum.map(third_observations, & &1.source_refs) == [[chapter_ref], [chapter_ref]]
    refs = third_prompt_map.refs.observation_refs
    assert Enum.all?([page1_observation_ref, page2_observation_ref], &(&1 in refs))

    assert Enum.take(third_prompt_map.messages, length(second_prompt_map.messages)) ==
             second_prompt_map.messages

    # G7：scope 只追加、旧版本仅作历史证据；「最新 scope」必须取最后一条，
    # 不能取首条（首条是探索开放时的历史版本，目录仍在文本里）。
    latest_scope =
      third_prompt_map.messages
      |> Enum.filter(&(&1.role == "scope_update"))
      |> List.last()

    assert latest_scope

    assert latest_scope.versions["scope_revision"] == 3

    latest_content = TestProviderPrompt.scope_content(third_prompt_map)
    exploration = latest_content["operation"]["exploration"]
    assert exploration["allowed"] == false
    assert exploration["tools"] == []
    refute Map.has_key?(exploration, "catalog")
    assert exploration["budget"]["total"] == 2
    assert exploration["budget"]["normal_open?"] == false
    assert exploration["budget"]["continuation_open?"] == false
    assert Enum.all?(third_observations, &(&1.content["tool"] == "chapter_read"))

    # I-READ-9：身份与章名来自实际读取的两页，不从未供应的 Scope 目录反推。
    refute Map.has_key?(latest_content["facts"], "chapters")
    assert latest_content["coverage"]["chapters"] == %{"status" => "not_read"}

    assert Enum.map(third_observations, & &1.content["summary"]) ==
             [page1.summary, page2.summary]

    for observed <- third_observations do
      assert observed.coverage["chapter_ref"] == chapter_ref
      assert observed.source_refs == [chapter_ref]
      assert observed.content["summary"] =~ "「#{@full_read_title}」（第 1 章）"
    end

    snapshot4 = %{empty | stage_state: Map.merge(snapshot3.stage_state, reply_result.stage_state)}
    assert {:complete, _decision, _meta} = spec.next_step_planner.(run, 5, snapshot4)
  end

  test "探索 progress signature：同页重复同签名（命中 no-progress），不同 offset 签名不同" do
    {work_id, chapter_ref, _versions} = seed_work_with_full_chapter()
    fixed_run_id = "run_b24_signature"
    empty = %{stage_state: %{}, observations: [], events: [], stage_sink: fn _ -> :ok end}

    assert {:ok, spec_a} =
             DialoguePlanningService.plan_agent_run(
               %{
                 text: "查一下正文里「灵气账单」是怎么写的",
                 workspace_id: work_id,
                 work_id: work_id,
                 session_id: "session-signature-a",
                 turn_id: "turn-signature-a"
               },
               nil,
               repeat_explore_execution("prose_search", "灵气账单")
             )

    assert {:ok, spec_b} =
             DialoguePlanningService.plan_agent_run(
               %{
                 text: "查一下正文里「灵气账单」是怎么写的",
                 workspace_id: work_id,
                 work_id: work_id,
                 session_id: "session-signature-b",
                 turn_id: "turn-signature-b"
               },
               nil,
               repeat_explore_execution(
                 "chapter_read",
                 Jason.encode!(%{chapter_ref: chapter_ref, offset: 6000})
               )
             )

    # 同一 run 语义（签名含 run_id）：用固定 run_id 排除 plan_agent_run 生成的新 id。
    {:ok, run_a} = AgentRun.new(Map.put(spec_a.run_attrs, :run_id, fixed_run_id))
    {:ok, run_b} = AgentRun.new(Map.put(spec_b.run_attrs, :run_id, fixed_run_id))

    assert {:execute, context_step, _dc, _mc} = spec_a.next_step_planner.(run_a, 1, empty)
    assert {:ok, context_result} = context_step.(run_a, 1, empty)
    snapshot1 = %{empty | stage_state: context_result.stage_state}

    assert {:execute, step1, _d1, _m1} = spec_a.next_step_planner.(run_a, 2, snapshot1)
    assert {:ok, result1} = step1.(run_a, 2, snapshot1)

    snapshot2 = %{empty | stage_state: Map.merge(snapshot1.stage_state, result1.stage_state)}
    assert {:execute, step2, _d2, _m2} = spec_a.next_step_planner.(run_a, 3, snapshot2)
    assert {:ok, result2} = step2.(run_a, 3, snapshot2)

    # 同一页重复读取 → 签名逐字相同 → runtime 既有 no-progress 停等会命中。
    assert result1.progress_signature == "#{fixed_run_id}:explore:prose_search:灵气账单"
    assert result2.progress_signature == result1.progress_signature
    refute result1.progress_signature =~ ":explore:2:"
    assert length(result2.stage_state.judgment_explorations) == 2

    # 不同 offset 的合法续读 → 签名不同 → 不误触发 no-progress。
    assert {:execute, step_b, _db, _mb} = spec_b.next_step_planner.(run_b, 3, snapshot2)
    assert {:ok, result_b} = step_b.(run_b, 3, snapshot2)

    refute result_b.progress_signature == result1.progress_signature

    assert String.replace_prefix(
             result_b.progress_signature,
             "#{fixed_run_id}:explore:chapter_read:",
             ""
           )
           |> Jason.decode!() == %{"chapter_ref" => chapter_ref, "offset" => 6000}

    # 续读页读到的正文是第二页（不是同一页重复）。
    assert List.last(result_b.stage_state.judgment_explorations).prose_range ==
             %{start: 6001, end: 7000}
  end

  # B28 T4 R10 全链路回归：空作品缺目标 → 判断两次重复同 query 的 chapter_read →
  # runtime no_progress 停等。作者可见活动必须如实（检索完成但目标不存在，不是
  # 「检索未完成」），终止澄清必须由最后检索事实派生（缺什么/为何不能执行/可做什么），
  # 且零写入、无候选、不路由写能力。
  test "空作品缺目标：重复 explore 在 runtime 停等，作者可见澄清由最后检索事实派生" do
    :ok = Sandbox.mode(Repo, {:shared, self()})
    {:ok, work} = WorkService.create(%{"title" => "空作品缺目标"})
    test_pid = self()
    {:ok, events} = Agent.start_link(fn -> [] end)

    assert {:ok, spec} =
             DialoguePlanningService.plan_agent_run(
               %{
                 text: "把已保存的第一章正文整理修订一下，只调整分段和排版，不要改字句。",
                 workspace_id: work.id,
                 work_id: work.id,
                 session_id: "session-missing-target",
                 turn_id: "turn-missing-target"
               },
               nil,
               repeat_explore_execution("chapter_read", "第一章")
             )

    assert {:ok, run_id} =
             AgentRunService.start_bounded(
               NovelApplication.TestAgentEventRelay.observe(spec.run_attrs, fn event ->
                 Agent.update(events, &[event | &1])
                 send(test_pid, {:missing_target_event, event.event_type})
               end),
               next_step_planner: spec.next_step_planner,
               interaction_input: spec.interaction_input
             )

    _run_pid = NovelApplication.TestAgentRunCleanup.register_run(run_id)

    on_exit(fn -> AgentRunService.cancel(run_id) end)
    assert_receive {:missing_target_event, :awaiting_author}, 4_000

    all_events = Agent.get(events, &Enum.reverse/1)
    awaiting = Enum.find(all_events, &(&1.event_type == :awaiting_author))

    # 具体澄清：缺什么 / 为何不能执行 / 可做什么；不再是泛化句
    assert awaiting.summary =~ "第一章"
    assert awaiting.summary =~ "当前还没有任何章节或正文"
    assert awaiting.summary =~ "没有可整理修订的目标"
    assert awaiting.summary =~ "重复同一次检索不会得到新事实"
    assert awaiting.summary =~ "下一步"
    refute awaiting.summary =~ "换个章名再试"
    assert "no_progress" in awaiting.reason_codes
    assert awaiting.payload.clarification_source == "last_exploration_observation"

    # 空结果观察是 informational activity，作者面不显示「检索未完成」
    exploration_events =
      Enum.filter(
        all_events,
        &(&1.event_type == :exploration_observed and &1.visibility == :author)
      )

    assert [first_exploration | _] = exploration_events
    assert first_exploration.summary == "已检索指定章节：作品当前还没有章节。"
    refute first_exploration.summary =~ "检索未完成"
    assert first_exploration.payload.outcome == "target_not_found"
    assert first_exploration.payload.facts == %{chapter_count: 0, chapters: []}

    # 零写入、无候选、不路由写能力（仍停在判断循环 profile）
    assert {:ok, %{run: run, final_turn_result: nil}} = AgentRunService.state(run_id)
    assert run.profile_ref == "judgment_loop_v1"
    assert run.status == :awaiting_author
    assert run.pending_artifact_refs == []
    refute Enum.any?(all_events, &(&1.event_type == :artifact_created))
    refute Enum.any?(all_events, &(&1.event_type == :run_completed))
    assert Repo.aggregate(NovelPersistence.Schemas.Chapter, :count, :id) == 0
    assert Repo.aggregate(NovelPersistence.Schemas.Draft, :count, :id) == 0
  end

  # 判断循环替身：首轮读取作者点名的章，后续只沿真实观察的 ref/next_offset 续读。
  defp full_read_execution(test_pid) do
    scripted_judgment_execution(fn prompt, _text ->
      send(test_pid, {:prompt_map, prompt})

      case observation_blocks(prompt) do
        [] ->
          explore_chapter_decision(@full_read_title)

        [page] ->
          assert is_integer(page.next_offset)

          query =
            Jason.encode!(%{
              chapter_ref: Map.fetch!(page.coverage, "chapter_ref"),
              offset: page.next_offset
            })

          explore_chapter_decision(query)

        pages ->
          assert Enum.any?(pages, &String.contains?(&1.content["summary"], @last_page_anchor))
          {:narrative, "我把全章两页都读完了，依据如下：\n\n" <> @last_page_anchor}
      end
    end)
  end

  defp explore_chapter_decision(query) do
    {:decision,
     %{
       "action" => "explore",
       "explore_request" => %{"tool" => "chapter_read", "query" => query}
     }}
  end

  defp observation_blocks(%RequestIR{messages: messages}) do
    for %{role: "tool", blocks: blocks} <- messages,
        %{type: "observation"} = block <- blocks,
        do: block
  end

  defp repeat_explore_execution(tool, query) do
    scripted_judgment_execution(fn _prompt, _prompt_text ->
      {:decision,
       %{
         "action" => "explore",
         "explore_request" => %{"tool" => tool, "query" => query}
       }}
    end)
  end

  defp seed_work_with_full_chapter do
    base = "灰烬从指缝里漏下去，井底的风把纸灰卷成一条细线，他数着自己的呼吸等回声。"
    pad = 7000 - String.length(@first_page_anchor) - String.length(@last_page_anchor)
    middle = String.duplicate(base, div(pad, String.length(base)) + 1) |> String.slice(0, pad)
    prose = @first_page_anchor <> middle <> @last_page_anchor
    assert String.length(prose) == 7000

    {work_id, chapter_id, draft} = seed_work_with_draft("全章审核验证作品", @full_read_title, prose)
    {work_id, "chapter:#{chapter_id}", %{"draft:#{draft.id}" => draft.revision}}
  end

  # ── 脚本执行 ──

  # 单调用判断循环脚本：首轮检索，原生 tool observation 回流后用实际观察收束。
  defp explore_then_reply_execution(test_pid, narrative) do
    scripted_judgment_execution(fn prompt, _text ->
      send(test_pid, {:prompt_map, prompt})
      blocks = Enum.flat_map(prompt.messages, & &1.blocks)
      corrected? = Enum.any?(blocks, &(&1.type == "validation_result"))

      arguments = %{
        "action" => "explore",
        "explore_request" => %{"tool" => "prose_search", "query" => "灵气账单"}
      }

      case {observation_blocks(prompt), corrected?} do
        {[_ | _], _} ->
          {:narrative, "我检索了正文，依据如下：\n\n#{native_cited_observation(prompt)}"}

        {[], true} ->
          {:decision, arguments}

        {[], false} ->
          {:decision, Map.put(arguments, "author_reasoning", narrative)}
      end
    end)
  end

  defp native_cited_observation(%{messages: messages}) do
    Enum.find_value(messages, "", &native_observation_summary/1)
  end

  defp native_observation_summary(%{role: "tool", blocks: blocks}) when is_list(blocks) do
    Enum.find_value(blocks, fn
      %{type: "observation", content: %{"summary" => summary}} -> summary
      _block -> nil
    end)
  end

  defp native_observation_summary(_message), do: nil

  defp scripted_judgment_execution(script) do
    %Execution{
      result_fn: fn prompt ->
        prompt_text = prompt_to_text(prompt)

        case script.(prompt, prompt_text) do
          {:narrative, narrative} ->
            {:ok,
             %{
               content: narrative,
               tool_calls: [],
               provider_output:
                 provider_output("pcall-narr-#{System.unique_integer([:positive])}", narrative)
             }}

          {:decision, arguments} ->
            calls = [
              %{
                "name" => "judgment_decision",
                "arguments" => arguments
              }
            ]

            {:ok,
             %{
               content: "",
               tool_calls: calls,
               provider_output:
                 provider_output("pcall-dec-#{System.unique_integer([:positive])}", "", calls)
             }}
        end
      end
    }
  end

  defp prompt_to_text(%RequestIR{messages: _messages} = prompt),
    do: NovelApplication.TestAgenticLoopFixtures.prompt_text(prompt)

  defp provider_output(call_ref, content, tool_calls \\ []) do
    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: "prun-#{call_ref}",
        provider_call_ref: call_ref,
        status: :ok,
        output_type: :text,
        content: %{text: content, tool_calls: tool_calls},
        refs: [call_ref]
      })

    output
  end

  defp drain_prompt_maps(acc) do
    receive do
      {:prompt_map, prompt} -> drain_prompt_maps(acc ++ [prompt])
    after
      0 -> acc
    end
  end

  defp seed_work_with_prose do
    {work_id, _chapter_id, _draft} =
      seed_work_with_draft("灵气矿工", "第01章：底层灵气账单", @prose)

    work_id
  end

  defp seed_work_with_draft(work_title, chapter_title, prose) do
    {:ok, work} = WorkService.create(%{"title" => work_title})

    volume =
      %Volume{}
      |> Volume.changeset(%{work_id: work.id, title: "卷一", seq: 1})
      |> Repo.insert!()

    chapter =
      %Chapter{}
      |> Chapter.changeset(%{
        work_id: work.id,
        volume_id: volume.id,
        title: chapter_title,
        seq: 1
      })
      |> Repo.insert!()

    scene =
      %Scene{}
      |> Scene.changeset(%{work_id: work.id, chapter_id: chapter.id, title: "场1", seq: 1})
      |> Repo.insert!()

    draft =
      %Draft{}
      |> Draft.changeset(%{
        work_id: work.id,
        scene_id: scene.id,
        content: prose,
        status: AdoptionStatus.accepted(),
        revision: 1
      })
      |> Repo.insert!()

    {work.id, chapter.id, draft}
  end
end
