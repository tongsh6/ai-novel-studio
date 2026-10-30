defmodule NovelApplication.AU03ContextTurnMatrixTest do
  @moduledoc """
  AU03-CONTEXT CP2：本地故障矩阵——同一次真实判断请求中的来源状态、trace 观测与零写入，
  覆盖 raise/非 ok/部分保留/真实空/work-only/跨作品切换/恢复，以及旧 fetcher 兼容。
  """
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution
  alias NovelApplication.{DialoguePlanningService, WorkService}
  alias NovelCommon.Contracts.ProviderOutput
  alias NovelDomain.AgentRun
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{Chapter, Draft}

  setup do
    :ok = Sandbox.checkout(Repo)
    %{}
  end

  defp seed_work(title) do
    {:ok, work} =
      WorkService.create(%{
        "title" => title,
        "genre" => "雨港悬疑",
        "core_selling_point" => "上下文可用性矩阵",
        "target_reader" => "作者",
        "tone_preference" => "克制",
        "target_length" => 10_000,
        "planned_volumes" => 1,
        "serial_form" => "SERIALIZED"
      })

    work
  end

  defp write_counts do
    %{
      drafts: Repo.aggregate(Draft, :count),
      chapters: Repo.aggregate(Chapter, :count)
    }
  end

  defp plan_and_capture(work, fetcher, text \\ "第03章正文里有没有提到旧账？只按当前作品事实回答。") do
    parent = self()

    provider = %Execution{
      result_fn: fn prompt ->
        send(
          parent,
          {:judgment_prompt, NovelApplication.TestAgenticLoopFixtures.prompt_text(prompt)}
        )

        narrative = "我注意到部分上下文本轮不可用；只能基于已确认事实回答。"

        {:ok,
         %{
           content: narrative,
           tool_calls: [],
           provider_output: %ProviderOutput{
             provider_run_ref: "prun-au03-cp2",
             provider_call_ref: "pcall-au03-cp2",
             status: :ok,
             content: %{text: narrative, tool_calls: []}
           }
         }}
      end
    }

    assert {:ok, spec} =
             DialoguePlanningService.plan_agent_run(
               %{
                 text: text,
                 workspace_id: work.id,
                 work_id: work.id,
                 session_id: "session-au03",
                 turn_id: "turn-au03-cp2"
               },
               fetcher,
               provider
             )

    {:ok, run} = AgentRun.new(spec.run_attrs)
    sink = fn _event -> :ok end
    empty = %{stage_state: %{}, observations: [], events: [], stage_sink: sink}

    assert {:execute, context_step, _decision, _meta} = spec.next_step_planner.(run, 1, empty)
    assert {:ok, context_result} = context_step.(run, 1, empty)

    snapshot = %{
      stage_state: context_result.stage_state,
      observations: context_result.observations,
      events: [],
      stage_sink: sink
    }

    assert {:execute, judgment_step, _decision, _meta} = spec.next_step_planner.(run, 2, snapshot)
    assert {:ok, judgment_result} = judgment_step.(run, 2, snapshot)
    assert_receive {:judgment_prompt, prompt}

    {context_result, judgment_result, prompt}
  end

  defp context_status_observation(context_result) do
    context_result.observations
    |> Enum.flat_map(fn observation -> [Map.get(observation, :structured_payload)] end)
    |> Enum.find_value(fn payload ->
      if is_map(payload) and is_map(Map.get(payload, :context_source_status)) do
        Map.get(payload, :context_source_status)
      end
    end)
  end

  test "raise fetcher：同次请求含可用性段、不声称新对话，trace 状态可查，零写入" do
    work = seed_work("AU03 故障作品")
    before = write_counts()

    raising = fn _ws, _text, _session -> raise "au03_cp2_db_failure" end
    {context_result, judgment_result, prompt} = plan_and_capture(work, raising)

    assert prompt =~ "## 上下文可用性"
    assert prompt =~ "读取失败"
    refute prompt =~ "无——这是新对话或尚未创建作品"
    refute prompt =~ "全书 0 章"

    status = context_status_observation(context_result)
    assert status.unavailable_sources |> Enum.sort() |> Enum.member?("work")
    assert judgment_result.turn_result.assistant_message.text =~ "不可用"
    assert write_counts() == before
  end

  test "非 ok 返回：同 unavailable 语义，零写入" do
    work = seed_work("AU03 非 ok 作品")
    before = write_counts()

    bad = fn _ws, _text, _session -> {:error, :db_unavailable} end
    {context_result, _judgment_result, prompt} = plan_and_capture(work, bad)

    assert prompt =~ "## 上下文可用性"
    refute prompt =~ "无——这是新对话或尚未创建作品"
    assert context_status_observation(context_result).unavailable_sources != []
    assert write_counts() == before
  end

  test "部分失败：work 成功 + chapters 失败 → 保留已确认事实、章节标未知、不渲染 0 章" do
    work = seed_work("AU03 部分保留作品")

    partial = fn _ws, _text, _session ->
      {:ok, %{title: "AU03 部分保留作品"}, nil, nil, nil, [], [], %{},
       %{
         work: :ok,
         conversation: :empty,
         memory: :empty,
         behavior: :empty,
         chapters: :unavailable,
         interaction: :empty
       }}
    end

    {context_result, _judgment_result, prompt} = plan_and_capture(work, partial)

    assert prompt =~ "AU03 部分保留作品"
    assert prompt =~ "## 上下文可用性"
    assert prompt =~ "章节"
    refute prompt =~ "无——这是新对话或尚未创建作品"
    refute prompt =~ "0 章中已写 0 章"
    assert "chapters" in context_status_observation(context_result).unavailable_sources
  end

  test "真实空作品（生产 fetcher 成功读取、无章）→ 可渲染 0 章，不声明读取失败" do
    work = seed_work("AU03 真实空作品")
    production = NovelPersistence.WorkspaceContext.context_fetcher_with_query()

    {context_result, _judgment_result, prompt} =
      plan_and_capture(work, fn ws, text, session -> production.(ws, text, session) end)

    assert prompt =~ "AU03 真实空作品"
    assert prompt =~ "0 章中已写 0 章"
    refute prompt =~ "## 上下文可用性"
    assert context_status_observation(context_result).unavailable_sources == []
  end

  test "work-only（旧 5 元组）→ 不声称刚才讨论；旧契约缺状态按空事实兼容" do
    work = seed_work("AU03 work-only 作品")
    work_only = fn _ws, _text, _session -> {:ok, %{title: "AU03 work-only 作品"}, nil, nil, nil} end

    {_context_result, _judgment_result, prompt} = plan_and_capture(work, work_only)

    assert prompt =~ "AU03 work-only 作品"
    refute prompt =~ "## 上下文可用性"
    refute prompt =~ "刚才讨论"
  end

  test "旧 5 元组空 → 兼容既有语义（无事实仍渲染新对话），不伪造读取失败" do
    work = seed_work("AU03 旧空作品")
    empty = fn _ws, _text, _session -> {:ok, nil, nil, nil, nil} end

    {_context_result, _judgment_result, prompt} = plan_and_capture(work, empty)

    assert prompt =~ "无——这是新对话或尚未创建作品"
    refute prompt =~ "## 上下文可用性"
  end

  test "跨作品切换与恢复：故障请求不串作品；恢复后真实事实进入后续请求，零 canon 写入" do
    work_a = seed_work("AU03 作品甲")
    work_b = seed_work("AU03 作品乙")
    production = NovelPersistence.WorkspaceContext.context_fetcher_with_query()
    before = write_counts()

    broken = fn _ws, _text, _session -> {:error, :temporary} end
    {_ctx1, _jr1, fault_prompt} = plan_and_capture(work_a, broken)
    assert fault_prompt =~ "## 上下文可用性"
    refute fault_prompt =~ "AU03 作品甲"
    refute fault_prompt =~ "AU03 作品乙"

    {_ctx2, _jr2, prompt_a} =
      plan_and_capture(work_a, fn ws, text, session -> production.(ws, text, session) end)

    assert prompt_a =~ "AU03 作品甲"
    refute prompt_a =~ "AU03 作品乙"
    refute prompt_a =~ "## 上下文可用性"

    {_ctx3, _jr3, prompt_b} =
      plan_and_capture(work_b, fn ws, text, session -> production.(ws, text, session) end)

    assert prompt_b =~ "AU03 作品乙"
    refute prompt_b =~ "AU03 作品甲"
    refute prompt_b =~ "## 上下文可用性"

    assert write_counts() == before
  end
end
