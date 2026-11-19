defmodule NovelApplication.AU03ContextTurnMatrixTest do
  @moduledoc """
  AU03-CONTEXT CP2：本地故障矩阵——同一次真实判断请求中的来源状态、trace 观测与零写入，
  覆盖 raise/非 ok/部分保留/真实空/work-only/跨作品切换/恢复，以及单一 DTO 的缺省未知语义。
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

  defp plan_and_capture(work, fetcher, text \\ "第03章正文里有没有提到旧账？只按当前作品事实回答。", opts \\ []) do
    parent = self()

    provider = %Execution{
      result_fn: fn prompt ->
        send(
          parent,
          {:judgment_prompt, NovelTest.TestProviderPrompt.scope_content(prompt)}
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
                 workspace_id: Keyword.get(opts, :workspace_id, work.id),
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

  test "raise fetcher：同次请求显式 unavailable，trace 状态可查，零写入" do
    work = seed_work("AU03 故障作品")
    before = write_counts()

    raising = fn _work_id, _text, _session -> raise "au03_cp2_db_failure" end
    {context_result, judgment_result, prompt} = plan_and_capture(work, raising)

    assert prompt["coverage"]["work"] == %{"status" => "unavailable"}
    assert prompt["coverage"]["chapters"] == %{"status" => "not_read"}
    refute Map.has_key?(prompt["facts"], "work")
    refute Map.has_key?(prompt["facts"], "chapters")

    status = context_status_observation(context_result)
    assert status.unavailable_sources |> Enum.sort() |> Enum.member?("work")
    assert judgment_result.turn_result.assistant_message.text =~ "不可用"
    assert write_counts() == before
  end

  test "非 ok 返回：同 unavailable 语义，零写入" do
    work = seed_work("AU03 非 ok 作品")
    before = write_counts()

    bad = fn _work_id, _text, _session -> {:error, :db_unavailable} end
    {context_result, _judgment_result, prompt} = plan_and_capture(work, bad)

    assert prompt["coverage"]["work"] == %{"status" => "unavailable"}
    refute Map.has_key?(prompt["facts"], "work")
    assert context_status_observation(context_result).unavailable_sources != []
    assert write_counts() == before
  end

  test "部分失败：work 成功 + chapters 失败 → 保留已确认事实、章节标未知、不渲染 0 章" do
    work = seed_work("AU03 部分保留作品")

    partial = fn workspace_id, _text, _session ->
      {:ok,
       %NovelDomain.DialogueContext{
         work_id: workspace_id,
         current_work_snapshot: %{title: "AU03 部分保留作品"},
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
    end

    {context_result, _judgment_result, prompt} = plan_and_capture(work, partial)

    assert prompt["facts"]["work"]["title"] == "AU03 部分保留作品"
    assert prompt["coverage"]["chapters"] == %{"status" => "not_read"}
    refute Map.has_key?(prompt["facts"], "chapters")
    assert "chapters" in context_status_observation(context_result).unavailable_sources
  end

  test "生产 fetcher 的真实空集合可审计，默认判断仍不声明已供应章目录" do
    work = seed_work("AU03 真实空作品")
    production = NovelPersistence.WorkspaceContext.context_fetcher_with_query()

    {context_result, _judgment_result, prompt} =
      plan_and_capture(work, fn ws, text, session -> production.(ws, text, session) end)

    assert prompt["facts"]["work"]["title"] == "AU03 真实空作品"
    refute Map.has_key?(prompt["facts"], "chapters")
    assert prompt["coverage"]["chapters"] == %{"status" => "not_read"}
    assert context_status_observation(context_result).sources["chapters"] == "empty"
    assert context_status_observation(context_result).unavailable_sources == []
  end

  test "只读作品的 DTO 保留作品事实，其他来源缺省 not_read" do
    work = seed_work("AU03 work-only 作品")

    work_only = fn workspace_id, _text, _session ->
      {:ok,
       %NovelDomain.DialogueContext{
         work_id: workspace_id,
         current_work_snapshot: %{title: "AU03 work-only 作品"},
         source_status: %{work: :ok}
       }}
    end

    {_context_result, _judgment_result, prompt} = plan_and_capture(work, work_only)
    assert prompt["facts"]["work"]["title"] == "AU03 work-only 作品"
    assert prompt["coverage"]["chapters"] == %{"status" => "not_read"}
    refute Map.has_key?(prompt["facts"], "chapters")
  end

  test "明确空作品状态保持真实，未供应章节集合不在 Scope 推导零章" do
    work = seed_work("AU03 空作品")

    empty = fn workspace_id, _text, _session ->
      {:ok,
       %NovelDomain.DialogueContext{
         work_id: workspace_id,
         source_status: %{work: :empty, chapters: :empty}
       }}
    end

    {context_result, _judgment_result, prompt} = plan_and_capture(work, empty)
    refute Map.has_key?(prompt["facts"], "work")
    assert prompt["coverage"]["work"] == %{"status" => "complete"}
    refute Map.has_key?(prompt["facts"], "chapters")
    assert prompt["coverage"]["chapters"] == %{"status" => "not_read"}
    assert context_status_observation(context_result).sources["chapters"] == "empty"
  end

  test "跨作品切换与恢复：故障请求不串作品；恢复后真实事实进入后续请求，零 canon 写入" do
    work_a = seed_work("AU03 作品甲")
    work_b = seed_work("AU03 作品乙")
    production = NovelPersistence.WorkspaceContext.context_fetcher_with_query()
    before = write_counts()

    broken = fn _work_id, _text, _session -> {:error, :temporary} end
    {_ctx1, _jr1, fault_prompt} = plan_and_capture(work_a, broken)
    assert fault_prompt["coverage"]["work"] == %{"status" => "unavailable"}
    refute Map.has_key?(fault_prompt["facts"], "work")

    {_ctx2, _jr2, prompt_a} =
      plan_and_capture(work_a, fn ws, text, session -> production.(ws, text, session) end)

    assert prompt_a["facts"]["work"]["title"] == "AU03 作品甲"
    assert prompt_a["work_id"] == work_a.id

    {_ctx3, _jr3, prompt_b} =
      plan_and_capture(work_b, fn ws, text, session -> production.(ws, text, session) end)

    assert prompt_b["facts"]["work"]["title"] == "AU03 作品乙"
    assert prompt_b["work_id"] == work_b.id

    assert write_counts() == before
  end

  test "工作区 ID 与作品 ID 不同时，读取与 Scope 仍绑定真实作品" do
    work = seed_work("显式作品身份")
    workspace_id = Ecto.UUID.generate()

    {_context, _result, scope} =
      plan_and_capture(
        work,
        NovelPersistence.WorkspaceContext.context_fetcher_with_query(),
        "当前作品有几章？",
        workspace_id: workspace_id
      )

    assert scope["work_id"] == work.id
    assert scope["work_id"] != workspace_id
    assert scope["facts"]["work"]["ref"] == "work:#{work.id}"
    assert scope["facts"]["work"]["version"] == work.revision
    assert scope["facts"]["work"]["title"] == "显式作品身份"
    assert scope["coverage"]["work"]["status"] == "complete"
  end
end
