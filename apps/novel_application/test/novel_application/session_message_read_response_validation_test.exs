defmodule NovelApplication.SessionMessageReadResponseValidationTest do
  @moduledoc """
  回查被拒响应时保留原文、分页和同源接收事实；缺证与损坏证据不补造发布结论。
  """

  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL
  alias Ecto.Adapters.SQL.Sandbox

  alias NovelApplication.{
    AuthoringTranscript,
    ExplorationService,
    JudgmentProtocol,
    TestAgenticLoopFixtures,
    WorkService
  }

  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelPersistence.{Repo, WorkSessionRepo}

  setup do
    :ok = Sandbox.checkout(Repo)
    {:ok, work} = WorkService.create(%{title: "会话原文回查"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id, title: "当前会话"})
    %{work: work, session: session}
  end

  @tag :r08_response_rejection
  test "R08 已拒原文逐页保留字节和全文 hash，回查同源携原拒收回执进入三 wire", context do
    first_text = String.duplicate("e\u0301👩‍💻", 3000)
    tail = "  原始末行。\r\n"
    original = first_text <> tail
    {source, receipt} = rejected_session_source(context, "r08-rejected-pages", original)
    :ok = TestAgenticLoopFixtures.append_segment!(source, status: "completed")

    assert {:ok, first} = read(context, "r08-rejected-pages", 3)
    assert {:ok, last} = read(context, "r08-rejected-pages", 3, 6000)
    assert first.summary == first_text
    assert last.summary == tail
    assert first.summary <> last.summary == original
    assert first.next_offset == 6000
    assert last.next_offset == nil
    assert first.coverage.range == %{start: 0, end_exclusive: 6000}

    assert last.coverage.byte_range == %{
             start: byte_size(first_text),
             end_exclusive: byte_size(original)
           }

    expected = RequestIR.json_value(receipt)

    for page <- [first, last] do
      assert page.source_hash == sha256(original)
      assert page.coverage.total_bytes == byte_size(original)
      assert page.refs == ["session_message:r08-rejected-pages:3"]
      assert page.facts.run_status == "completed"
      assert page.facts.role == "assistant"
      assert page.facts.validation_result == expected
      assert page.facts.validation_result["status"] == "failed"

      assert page.facts.validation_result["detail"]["message"] ==
               "本次响应未通过接收，未作为作者回复发布；仍在处理原作者输入。\n只纠正实际首稿。"

      refute Map.has_key?(page.facts.validation_result, "call_id")

      for internal <- [
            "pcall-r08-rejected-pages",
            "prun-r08-rejected-pages",
            "private-read-reasoning"
          ] do
        refute inspect(page) =~ internal
      end
    end

    next =
      context
      |> transcript("r08-read-rejected-next", "只核对先前实际原文。")
      |> AuthoringTranscript.append_assistant("", [
        RequestIR.tool_call_block(
          "judgment_decision",
          %{
            action: "explore",
            author_reasoning: "回查实际首稿及其接收事实。",
            explore_request: %{
              tool: "session_message_read",
              query: query("r08-rejected-pages", 3, 0)
            }
          },
          "r08-rejected-read-call"
        )
      ])
      |> JudgmentProtocol.observation_transcript(%{tool_call_id: "r08-rejected-read-call"}, first)

    assert {:ok, request} = AuthoringTranscript.to_request_ir(next)

    for target <- ~w(chat_completions responses_api anthropic_messages) do
      assert {:ok, body} = Projection.project(request, target)
      payload = body |> observation_text(target) |> Jason.decode!()
      assert payload["data"]["content"]["summary"] == first_text
      assert payload["data"]["content"]["source_hash"] == sha256(original)
      assert payload["data"]["content"]["facts"]["validation_result"] == expected
      refute Jason.encode!(body) =~ "pcall-r08-rejected-pages"
      refute Jason.encode!(body) =~ "prun-r08-rejected-pages"
    end
  end

  @tag :r08_response_rejection
  test "R08 无结构回执的旧稿、成功回复和普通 notice 保持未知，不从 completed 或词面补发布结论", context do
    for status <- ["completed", "failed"] do
      run_id = "r08-unknown-" <> status

      source =
        context
        |> transcript(run_id, "这一轮作者原话。")
        |> AuthoringTranscript.append_assistant("旧助手原文，没有结构接收回执。", [])
        |> then(
          &%{
            &1
            | messages:
                &1.messages ++
                  [
                    NovelTest.TestRequestIR.notice("旧纠错文字：未通过接收，但没有绑定的结构事实。")
                  ]
          }
        )
        |> AuthoringTranscript.append_provider_result(%{
          content: "当前正常回复原文。",
          tool_calls: [],
          provider_call_ref: "pcall-" <> run_id,
          provider_run_ref: "prun-" <> run_id
        })
        |> then(
          &%{
            &1
            | messages:
                &1.messages ++
                  [
                    NovelTest.TestRequestIR.notice("普通职责续行，不对已有回复补标失败。")
                  ]
          }
        )

      :ok = TestAgenticLoopFixtures.append_segment!(source, status: status)

      for sequence <- [2, 3, 5] do
        assert {:ok, observed} = read(context, run_id, sequence)
        assert observed.facts.run_status == status
        refute Map.has_key?(observed.facts, :validation_result)
        refute Map.has_key?(observed.facts, :published)
      end
    end

    {source, _} = rejected_session_source(context, "r08-corrected-reply", "实际被拒稿")

    reply =
      RequestIR.message(:assistant, :model, [RequestIR.text_block("实际纠正后的回复。")], %{
        provider_call_ref: "pcall-r08-corrected",
        provider_run_ref: "prun-r08-corrected"
      })

    source = %{source | messages: source.messages ++ [reply]}
    :ok = TestAgenticLoopFixtures.append_segment!(source, status: "completed")
    assert {:ok, observed} = read(context, "r08-corrected-reply", 5)
    assert observed.summary == "实际纠正后的回复。"
    refute Map.has_key?(observed.facts, :validation_result)
    refute Map.has_key?(observed.facts, :published)
  end

  @tag :r08_response_rejection
  test "R08 持久拒收回执的响应绑定损坏时回查失败关闭，不伪装无回执或猜正文", context do
    {source, _} = rejected_session_source(context, "r08-broken-receipt", "必须保持真实失败身份。")
    :ok = TestAgenticLoopFixtures.append_segment!(source, status: "completed")
    notice = List.last(source.messages) |> Map.put(:provider_run_ref, "different-real-response")

    SQL.query!(
      Repo,
      "UPDATE authoring_session_messages SET message = ? WHERE run_id = ? AND run_sequence = ?",
      [Jason.encode!(notice), "r08-broken-receipt", 4]
    )

    assert {:error, _} = read(context, "r08-broken-receipt", 3)
  end

  defp rejected_session_source(context, run_id, original) do
    refs = %{provider_call_ref: "pcall-" <> run_id, provider_run_ref: "prun-" <> run_id}

    source =
      context
      |> transcript(run_id, "保持同一作者输入，不把纠错首稿当作已经回复。")
      |> AuthoringTranscript.append_provider_result(
        Map.merge(refs, %{
          content: original,
          tool_calls: [],
          provider_state: %{"reasoning_content" => "private-read-reasoning"}
        })
      )

    receipt = %{
      type: "validation_result",
      status: "failed",
      reason_code: "author_visible_narrative_invalid",
      detail: %{"message" => "本次响应未通过接收，未作为作者回复发布；仍在处理原作者输入。\n只纠正实际首稿。"},
      retryable: true,
      budget_after: %{"exchange" => %{"provider_call_budget" => 2, "provider_call_count" => 1}}
    }

    notice = RequestIR.message(:application_notice, :application, [receipt], refs)
    {%{source | messages: source.messages ++ [notice]}, receipt}
  end

  defp transcript(%{work: work, session: session}, run_id, author_text) do
    AuthoringTranscript.new(
      %{
        run_id: run_id,
        workspace_id: work.id,
        work_id: work.id,
        session_id: session.id,
        parent_turn_ref: "turn-" <> run_id
      },
      base_text: "按原文理解作者问题。",
      author_text: author_text,
      author_turn_ref: "input:" <> run_id
    )
  end

  defp read(context, run_id, sequence, offset \\ 0) do
    ExplorationService.run(
      context.work.id,
      "session_message_read",
      query(run_id, sequence, offset),
      context.session.id
    )
  end

  defp query(run_id, sequence, offset),
    do: Jason.encode!(%{run_id: run_id, run_sequence: sequence, offset: offset})

  defp sha256(text), do: :crypto.hash(:sha256, text) |> Base.encode16(case: :lower)

  defp observation_text(body, "chat_completions"),
    do: body.messages |> Enum.find(&(&1.role == "tool")) |> Map.fetch!(:content)

  defp observation_text(body, "responses_api"),
    do: body.input |> Enum.find(&(&1.type == "function_call_output")) |> Map.fetch!(:output)

  defp observation_text(body, "anthropic_messages") do
    body.messages
    |> Enum.flat_map(& &1.content)
    |> Enum.find(&(&1.type == "tool_result"))
    |> Map.fetch!(:content)
  end
end
