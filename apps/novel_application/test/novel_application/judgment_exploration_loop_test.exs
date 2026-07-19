defmodule NovelApplication.JudgmentExplorationLoopTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution
  alias NovelApplication.{DialoguePlanningService, WorkService}
  alias NovelCommon.Contracts.ProviderOutput
  alias NovelDomain.AgentRun
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume}

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  @prose "陈九斤蹲在矿区的出气口边上，把今天的灵气账单摊开在膝盖上。宗门的抽成又涨到了七成。"

  test "explore 内部翼全回环：判断 explore → 真实检索观察（0 调用）→ 回环再判断（带观察）→ reply 收束" do
    work_id = seed_work_with_prose()
    test_pid = self()

    provider_execution = explore_then_reply_execution(test_pid)

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

    # 判断① 第一轮：explore（判断两段 2 调用；检索本身 0 调用）
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

    # 第一轮判断 prompt 开放探索：目录段在场
    assert_received {:prompt, first_prompt}
    assert first_prompt =~ "## 探索目录"
    assert first_prompt =~ "先探索"

    # exploration_observed 阶段事件已发
    assert_received {:stage_event, %{event_type: :exploration_observed} = stage_event}
    assert stage_event.payload.tool == "prose_search"
    assert stage_event.payload.summary =~ "第01章"

    # 回环：planner 未见 settle → 再入判断步
    snapshot2 = %{
      empty
      | stage_state: Map.merge(context_result.stage_state, explore_result.stage_state)
    }

    assert {:execute, judgment_step2, _d2, _m2} = spec.next_step_planner.(run, 3, snapshot2)
    assert {:ok, reply_result} = judgment_step2.(run, 3, snapshot2)

    # 第二轮判断叙事 prompt 携带观察段（检索结果字节进上下文；call2 无 context 段）
    prompts = drain_prompts([first_prompt])
    observed_prompt = Enum.find(prompts, &String.contains?(&1, "## 探索观察"))
    assert observed_prompt
    assert observed_prompt =~ "灵气账单"

    # reply 收束：回复引用检索事实
    assert reply_result.provider_call_count == 2
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

  test "探索回合硬上限：已达上限后判断 prompt 不再开放探索（四选一收束）" do
    work_id = seed_work_with_prose()
    test_pid = self()

    provider_execution = explore_then_reply_execution(test_pid)

    assert {:ok, spec} =
             DialoguePlanningService.plan_agent_run(
               %{
                 text: "查一下正文里「灵气账单」是怎么写的",
                 workspace_id: work_id,
                 work_id: work_id,
                 session_id: "session-cap",
                 turn_id: "turn-cap"
               },
               nil,
               provider_execution
             )

    {:ok, run} = AgentRun.new(spec.run_attrs)
    sink = fn _event -> :ok end

    exhausted = [
      %{tool: "prose_search", query: "灵气账单", summary: "观察一", refs: []},
      %{tool: "chapter_read", query: "第01章", summary: "观察二", refs: []}
    ]

    snapshot = %{
      stage_state: %{
        judgment_context: %NovelDomain.DialogueContext{workspace_id: work_id},
        judgment_explorations: exhausted
      },
      observations: [],
      events: [],
      stage_sink: sink
    }

    assert {:execute, judgment_step, _d, _m} = spec.next_step_planner.(run, 2, snapshot)
    assert {:ok, result} = judgment_step.(run, 2, snapshot)

    assert_received {:prompt, prompt}
    refute prompt =~ "## 探索目录"
    refute prompt =~ "先探索"
    # 观察仍在上下文（已检索到的事实不丢）
    assert prompt =~ "## 探索观察"
    assert prompt =~ "观察二"
    # 桩在无探索选项时按观察回复收束
    assert result.stage_state.judgment_settled == "completed"
  end

  test "explore_request 缺失按 S2 韧性降级停等（不伪造检索）" do
    work_id = seed_work_with_prose()

    provider_execution =
      scripted_judgment_execution(fn prompt, _prompt_text ->
        if NovelAgent.Provider.tool_call_prompt?(prompt) do
          {:decision, %{"action" => "explore", "reason" => "missing_facts"}}
        else
          {:narrative, "我需要先检索，但我没有说清检索什么。"}
        end
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
    assert {:ok, result} = judgment_step.(run, 2, snapshot)

    assert result.stage_state.judgment_settled == "awaiting_author"
    assert result.turn_result.assistant_message.text =~ "检索"
  end

  # ── 脚本执行 ──

  # 两段式脚本：第一轮判断 explore（explore_request 点名 prose_search「灵气账单」）；
  # prompt 带「探索观察」段后判 reply（叙事引用观察段中含引用词的行——字节透传）。
  defp explore_then_reply_execution(test_pid) do
    scripted_judgment_execution(fn prompt, prompt_text ->
      send(test_pid, {:prompt, prompt_text})
      structural? = NovelAgent.Provider.tool_call_prompt?(prompt)
      explored? = String.contains?(prompt_text, "## 探索观察")
      # call2 不带 context 段：靠叙事回声（决策 prompt 内嵌 call1 叙事）分辨轮次
      echoed_citation? = String.contains?(prompt_text, "依据如下")

      cond do
        structural? and echoed_citation? ->
          {:decision,
           %{"action" => "reply", "reason" => "context_sufficient", "reply_included" => true}}

        structural? ->
          {:decision,
           %{
             "action" => "explore",
             "reason" => "missing_work_facts_require_retrieval",
             "explore_request" => %{"tool" => "prose_search", "query" => "灵气账单"}
           }}

        explored? ->
          {:narrative, "我检索了正文，依据如下：\n\n#{cited_observation(prompt_text)}"}

        true ->
          {:narrative, "回答这个问题需要正文事实；我先检索「灵气账单」相关段落。"}
      end
    end)
  end

  defp cited_observation(prompt_text) do
    prompt_text
    |> String.split("## 探索观察", parts: 2)
    |> List.last()
    |> String.split("\n")
    |> Enum.find(&String.contains?(&1, "灵气账单"))
    |> Kernel.||("")
    |> String.trim()
  end

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
               provider_output: provider_output("pcall-narr-#{System.unique_integer([:positive])}", narrative)
             }}

          {:decision, arguments} ->
            {:ok,
             %{
               content: "",
               tool_calls: [%{"name" => "judgment_decision", "arguments" => arguments}],
               provider_output: provider_output("pcall-dec-#{System.unique_integer([:positive])}", "")
             }}
        end
      end
    }
  end

  defp prompt_to_text(%{messages: messages}) do
    Enum.map_join(messages, "\n", fn message ->
      Map.get(message, :content) || Map.get(message, "content") || ""
    end)
  end

  defp prompt_to_text(prompt) when is_binary(prompt), do: prompt

  defp provider_output(call_ref, content) do
    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: "prun-#{call_ref}",
        provider_call_ref: call_ref,
        status: :ok,
        output_type: :text,
        content: %{text: content},
        refs: [call_ref]
      })

    output
  end

  defp drain_prompts(acc) do
    receive do
      {:prompt, prompt} -> drain_prompts(acc ++ [prompt])
    after
      0 -> acc
    end
  end

  defp seed_work_with_prose do
    {:ok, work} = WorkService.create(%{"title" => "灵气矿工"})

    volume =
      %Volume{}
      |> Volume.changeset(%{work_id: work.id, title: "卷一", seq: 1})
      |> Repo.insert!()

    chapter =
      %Chapter{}
      |> Chapter.changeset(%{
        work_id: work.id,
        volume_id: volume.id,
        title: "第01章：底层灵气账单",
        seq: 1
      })
      |> Repo.insert!()

    scene =
      %Scene{}
      |> Scene.changeset(%{work_id: work.id, chapter_id: chapter.id, title: "场1", seq: 1})
      |> Repo.insert!()

    %Draft{}
    |> Draft.changeset(%{
      work_id: work.id,
      scene_id: scene.id,
      content: @prose,
      status: AdoptionStatus.accepted(),
      revision: 1
    })
    |> Repo.insert!()

    work.id
  end
end
