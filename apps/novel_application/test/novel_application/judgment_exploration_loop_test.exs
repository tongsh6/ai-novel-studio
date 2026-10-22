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

  # ── B24 CP2：续读回环、作者可见文案、progress signature ──

  @full_read_title "灰烬中的手印"
  @first_page_anchor "开篇锚点：灰烬里按出一枚手印"
  @last_page_anchor "末页独有锚点：井底浮现第七枚手印"

  test "探索续读全回环：章节索引 ref → page1 → page2（JSON offset）→ reply 引用末页独有事实" do
    {work_id, chapter_ref} = seed_work_with_full_chapter()
    chapter_id = String.replace_prefix(chapter_ref, "chapter:", "")
    test_pid = self()

    provider_execution = full_read_execution(test_pid)

    # 判断章节索引真源：context fetcher 提供 structured_chapters（含 id/seq），
    # 生产路径由 persistence reader 注入；这里用确定性夹具证明 I-READ-9 双面身份。
    context_fetcher = fn _workspace_id ->
      {:ok, %{"title" => "全章审核验证作品"}, nil, nil, nil, [@full_read_title],
       [%{id: chapter_id, seq: 1, title: @full_read_title, has_prose: true}]}
    end

    assert {:ok, spec} =
             DialoguePlanningService.plan_agent_run(
               %{
                 text: "「灰烬中的手印」这章我怀疑有重复，请把全章正文核对一遍。",
                 workspace_id: work_id,
                 work_id: work_id,
                 session_id: "session-full-read",
                 turn_id: "turn-full-read"
               },
               context_fetcher,
               provider_execution
             )

    {:ok, run} = AgentRun.new(spec.run_attrs)
    sink = fn event -> send(test_pid, {:stage_event, event}) end
    empty = %{stage_state: %{}, observations: [], events: [], stage_sink: sink}

    assert {:execute, context_step, _dc, _mc} = spec.next_step_planner.(run, 1, empty)
    assert {:ok, context_result} = context_step.(run, 1, empty)
    snapshot1 = %{empty | stage_state: context_result.stage_state}

    # 第 1 页：纯章标题（offset=0）→ 观察 v2 首页（正文 1–6000 + 【续读】footer）
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
    refute page1.summary =~ @last_page_anchor

    # 作者可见活动行：人类可读，不含内部工具 id / 原始 JSON / offset 字段名（I-READ-8）
    assert_received {:stage_event, %{event_type: :exploration_observed} = event1}
    assert event1.summary =~ "已阅读章节正文「#{@full_read_title}」（第 1 章）"
    refute event1.summary =~ "chapter_read"
    refute event1.summary =~ "chapter_ref"
    refute event1.summary =~ "chapter:"
    refute event1.summary =~ "{"
    assert event1.payload.tool == "chapter_read"
    assert event1.payload.next_offset == 6000

    # signature 不含 sequence：同 query 才可能重复，续读页不会误停（I-READ-5）。
    # 首次 query 是模型从判断章节索引抄下的 chapter_ref（I-READ-9 双模型面）。
    first_query =
      String.replace_prefix(
        explore1.progress_signature,
        "#{run.run_id}:explore:chapter_read:",
        ""
      )

    assert Jason.decode!(first_query) == %{"chapter_ref" => chapter_ref, "offset" => 0}

    snapshot2 = %{empty | stage_state: Map.merge(snapshot1.stage_state, explore1.stage_state)}

    # 第 2 页：模型从 footer 抄 JSON offset 续读 → 观察 v2 续读页（正文 6001–7000，无 footer）
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

    continuation_query =
      Jason.decode!(
        String.replace_prefix(
          explore2.progress_signature,
          "#{run.run_id}:explore:chapter_read:",
          ""
        )
      )

    assert continuation_query == %{"chapter_ref" => chapter_ref, "offset" => 6000}
    refute explore2.progress_signature == explore1.progress_signature

    assert_received {:stage_event, %{event_type: :exploration_observed} = event2}
    assert event2.summary =~ "第 6001–7000 字符"
    refute event2.summary =~ "chapter_read"
    refute event2.summary =~ "{"

    # 两个观察同时进后续判断 prompt；探索回合耗尽后目录关闭（@max_explore_rounds 2 不变）
    prompts = drain_prompts([])
    second_prompt = Enum.find(prompts, &String.contains?(&1, "## 探索观察"))
    assert second_prompt
    assert second_prompt =~ "【续读】"
    assert second_prompt =~ ~s({"chapter_ref":"#{chapter_ref}","offset":6000})

    assert second_prompt =~ "上一页【续读】给出的 query"
    # 第 3 轮：reply 引用末页独有事实（字节透传观察），单一 turn 收束
    snapshot3 = %{empty | stage_state: Map.merge(snapshot2.stage_state, explore2.stage_state)}
    assert {:execute, judgment_step3, _d3, _m3} = spec.next_step_planner.(run, 4, snapshot3)
    assert {:ok, reply_result} = judgment_step3.(run, 4, snapshot3)

    assert reply_result.turn_result.assistant_message.text =~ @last_page_anchor
    assert reply_result.stage_state.judgment_settled == "completed"

    # 第三轮判断 prompt：两页观察都在场、引用末页事实；探索回合耗尽 → 目录关闭。
    third_prompts = drain_prompts([])
    third_prompt = Enum.find(third_prompts, &String.contains?(&1, @last_page_anchor))
    assert third_prompt
    refute third_prompt =~ "## 探索目录"
    # I-READ-9：模型可见章节索引同时给出 chapter_ref 与 seq/title。
    assert third_prompt =~ "[chapter_ref=#{chapter_ref}]"
    assert third_prompt =~ "第 1 章「#{@full_read_title}」"

    snapshot4 = %{empty | stage_state: Map.merge(snapshot3.stage_state, reply_result.stage_state)}
    assert {:complete, _decision, _meta} = spec.next_step_planner.(run, 5, snapshot4)
  end

  test "探索 progress signature：同页重复同签名（命中 no-progress），不同 offset 签名不同" do
    {work_id, chapter_ref} = seed_work_with_full_chapter()
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

  # 判断循环替身：首轮按作者 request 点名探索；观察页带【续读】footer 时**逐字抄
  # footer 的 JSON** 续读；两页观察都在时 reply 字节引用末页独有锚点（N-NARR）。
  defp full_read_execution(test_pid) do
    scripted_judgment_execution(fn prompt, prompt_text ->
      send(test_pid, {:prompt, prompt_text})
      full_read_decision(NovelAgent.Provider.tool_call_prompt?(prompt), prompt_text)
    end)
  end

  defp full_read_decision(true, prompt_text) do
    cond do
      String.contains?(prompt_text, "依据如下") ->
        reply_decision()

      observed_pages(prompt_text) >= 2 ->
        reply_decision()

      observed_pages(prompt_text) == 1 ->
        explore_chapter_decision("need_remaining_pages", footer_query(prompt_text))

      true ->
        explore_chapter_decision("need_full_chapter", explore_ref_query(prompt_text))
    end
  end

  defp full_read_decision(false, prompt_text) do
    case observed_pages(prompt_text) do
      0 ->
        {:narrative, "要核对全章是否重复，我需要先读取整章正文。"}

      1 ->
        {:narrative, "第一页只覆盖到全章一部分，我继续读下一页。"}

      _ ->
        {:narrative, "我把全章两页都读完了，依据如下：\n\n" <> @last_page_anchor}
    end
  end

  defp explore_chapter_decision(reason, query) do
    {:decision,
     %{
       "action" => "explore",
       "reason" => reason,
       "explore_request" => %{"tool" => "chapter_read", "query" => query}
     }}
  end

  defp observed_pages(prompt_text), do: length(String.split(prompt_text, "### 观察 ")) - 1

  defp reply_decision do
    {:decision,
     %{"action" => "reply", "reason" => "context_sufficient", "reply_included" => true}}
  end

  defp footer_query(prompt_text) do
    case Regex.run(~r/【续读】剩余 \d+ 字符；用 (\{"chapter_ref".*?\}) 继续。/u, prompt_text) do
      [_, query] -> query
      _ -> Jason.encode!(%{chapter_seq: 1, offset: 0})
    end
  end

  # 模型行为：从判断 prompt 的章节索引逐字复制 chapter_ref（I-READ-9 模型面）。
  defp explore_ref_query(prompt_text) do
    case Regex.run(~r/\[chapter_ref=(chapter:[0-9a-fA-F-]{36})\]/u, prompt_text) do
      [_, ref] -> Jason.encode!(%{"chapter_ref" => ref, "offset" => 0})
      _ -> Jason.encode!(%{"chapter_seq" => 1, "offset" => 0})
    end
  end

  defp repeat_explore_execution(tool, query) do
    scripted_judgment_execution(fn prompt, _prompt_text ->
      if NovelAgent.Provider.tool_call_prompt?(prompt) do
        {:decision,
         %{
           "action" => "explore",
           "reason" => "missing_work_facts_require_retrieval",
           "explore_request" => %{"tool" => tool, "query" => query}
         }}
      else
        {:narrative, "我需要先检索作品事实。"}
      end
    end)
  end

  defp seed_work_with_full_chapter do
    {:ok, work} = WorkService.create(%{"title" => "全章审核验证作品"})

    volume =
      %Volume{}
      |> Volume.changeset(%{work_id: work.id, title: "卷一", seq: 1})
      |> Repo.insert!()

    chapter =
      %Chapter{}
      |> Chapter.changeset(%{
        work_id: work.id,
        volume_id: volume.id,
        title: @full_read_title,
        seq: 1
      })
      |> Repo.insert!()

    scene =
      %Scene{}
      |> Scene.changeset(%{work_id: work.id, chapter_id: chapter.id, title: "场1", seq: 1})
      |> Repo.insert!()

    base = "灰烬从指缝里漏下去，井底的风把纸灰卷成一条细线，他数着自己的呼吸等回声。"
    pad = 7000 - String.length(@first_page_anchor) - String.length(@last_page_anchor)
    middle = String.duplicate(base, div(pad, String.length(base)) + 1) |> String.slice(0, pad)
    prose = @first_page_anchor <> middle <> @last_page_anchor
    assert String.length(prose) == 7000

    %Draft{}
    |> Draft.changeset(%{
      work_id: work.id,
      scene_id: scene.id,
      content: prose,
      status: AdoptionStatus.accepted(),
      revision: 1
    })
    |> Repo.insert!()

    {work.id, "chapter:#{chapter.id}"}
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
               provider_output:
                 provider_output("pcall-narr-#{System.unique_integer([:positive])}", narrative)
             }}

          {:decision, arguments} ->
            {:ok,
             %{
               content: "",
               tool_calls: [
                 %{
                   "name" => "judgment_decision",
                   "arguments" => Map.put_new(arguments, "record_only", false)
                 }
               ],
               provider_output:
                 provider_output("pcall-dec-#{System.unique_integer([:positive])}", "")
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
