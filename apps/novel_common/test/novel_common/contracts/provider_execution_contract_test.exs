defmodule NovelCommon.Contracts.ProviderExecutionContractTest do
  use ExUnit.Case, async: true

  alias NovelCommon.Contracts.ProviderEvent
  alias NovelCommon.Contracts.ProviderOutput
  alias NovelCommon.Contracts.ProviderRun

  test "provider run accepts only the unified event stream execution mode" do
    {:ok, run} =
      ProviderRun.new(%{
        "provider_run_id" => "prun_1",
        "provider_call_ref" => "pcall_writer_1",
        "purpose" => "writer",
        "execution_mode" => "event_stream",
        "status" => "running",
        "owner_refs" => %{"run_ref" => "run_1", "step_ref" => "step_2"}
      })

    assert run.purpose == :writer
    assert run.status == :running
    assert ProviderRun.event_stream?(run)

    assert {:error, errors} =
             ProviderRun.new(%{
               provider_run_id: "prun_2",
               provider_call_ref: "pcall_writer_2",
               purpose: :writer,
               execution_mode: "complete"
             })

    assert "execution_mode is invalid" in errors
  end

  test "provider run treats planner as a first-class execution purpose" do
    assert {:ok, run} =
             ProviderRun.new(%{
               provider_run_id: "prun_planner_1",
               provider_call_ref: "pcall_planner_1",
               purpose: "planner",
               execution_mode: "event_stream",
               status: "completed"
             })

    assert run.purpose == :planner
  end

  test "provider event normalizes stream events and rejects old fallback markers" do
    {:ok, event} =
      ProviderEvent.new(%{
        "event_id" => "pevt_1",
        "provider_run_ref" => "prun_1",
        "sequence" => 2,
        "event_type" => "chunk",
        "summary" => "正文片段已生成。",
        "payload" => %{
          "chunk_index" => 1,
          "content_length" => 10,
          "accumulated_content_length" => 10
        },
        "refs" => ["pcall_writer_1"]
      })

    assert event.event_type == :chunk
    assert event.visibility == :author
    assert ProviderEvent.author_safe?(event)
    refute ProviderEvent.terminal?(event)

    assert {:error, errors} =
             ProviderEvent.new(%{
               event_id: "pevt_2",
               provider_run_ref: "prun_1",
               sequence: 3,
               event_type: "streaming_unsupported",
               summary: "bad"
             })

    assert "event_type is invalid" in errors
  end

  test "author-visible chunk events reject raw generated text deltas" do
    assert {:error, errors} =
             ProviderEvent.new(%{
               event_id: "pevt_chunk_raw",
               provider_run_ref: "prun_1",
               sequence: 2,
               event_type: :chunk,
               summary: "bad",
               payload: %{"text_delta" => "她推开门，风雪涌入。"}
             })

    assert "payload is not author-safe" in errors
  end

  test "author-visible provider events reject raw prompt and private reasoning payload" do
    assert {:error, errors} =
             ProviderEvent.new(%{
               event_id: "pevt_3",
               provider_run_ref: "prun_1",
               sequence: 1,
               event_type: :progress,
               visibility: :author,
               summary: "bad",
               payload: %{"raw_prompt" => "secret prompt"}
             })

    assert "payload is not author-safe" in errors

    assert {:error, nested_errors} =
             ProviderEvent.new(%{
               event_id: "pevt_4",
               provider_run_ref: "prun_1",
               sequence: 1,
               event_type: :progress,
               visibility: :author,
               summary: "bad",
               payload: %{debug: %{chain_of_thought: "private"}}
             })

    assert "payload is not author-safe" in nested_errors
  end

  test "provider output is a terminal fact from the event stream" do
    {:ok, output} =
      ProviderOutput.new(%{
        "provider_run_ref" => "prun_1",
        "provider_call_ref" => "pcall_writer_1",
        "status" => "ok",
        "output_type" => "text",
        "content" => %{"text" => "她推开门，风雪涌入。"},
        "usage" => %{"input_tokens" => 120, "output_tokens" => 64},
        "refs" => ["pevt_9"]
      })

    assert output.status == :ok
    assert output.output_type == :text
    assert output.refs == ["pevt_9"]
    assert ProviderOutput.terminal?(output)

    assert {:error, errors} =
             ProviderOutput.new(%{
               provider_run_ref: "prun_1",
               provider_call_ref: "pcall_writer_1",
               status: "fallback"
             })

    assert "status is invalid" in errors
  end
end
