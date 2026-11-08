defmodule NovelApplication.JudgmentInitialSnapshotTest do
  # 真实 Gateway 捕获需要注入测试 provider，不能与其它 async 用例并行改全局配置。
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.Gateway
  alias NovelAgent.Provider.InferenceParams
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.JudgmentProtocol
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection

  @author_a "接着第02章往下写一段正文"
  @author_b "把第02章写得更紧凑些"
  @projection_targets ["chat_completions", "anthropic_messages", "responses_api"]

  @context_block """
  ## 作品与章节事实
  作品名：前缀度量样书；当前 revision=3。
  第01章：底层灵气账单（已写）
  第02章：旧服务器里的残诀（已写）
  （回答写作进度时以「已写」计数为准；标注（计划中）的章尚无正文。）

  ## 会话摘要
  上一轮采纳了第01章草稿，作者准备继续推进正文。
  """

  defmodule CaptureProvider do
    @behaviour NovelAgent.Provider

    alias NovelAgent.Provider.AdapterExecution
    alias NovelAgent.Provider.Result
    alias NovelCommon.RequestIR
    alias NovelCommon.RequestIR.Projection

    defstruct []

    @impl true
    def execute(_state, _model, %RequestIR{} = ir, _params, ctx) do
      {:ok, body} = Projection.project(ir, "chat_completions")
      send(self(), {:captured_request, body})
      AdapterExecution.materialize_result({:ok, Result.new("captured")}, ctx)
    end

    @impl true
    def health_check(_state), do: :ok

    @impl true
    def capabilities(_state) do
      %{
        native_multi_turn: true,
        tool_calls: true,
        tool_results: true,
        streaming: true,
        structured_output: true,
        usage: true
      }
    end

    @impl true
    def projection_target(_state), do: "chat_completions"

    @impl true
    def name, do: "initial_snapshot_capture"
  end

  setup do
    old_extra = Application.get_env(:novel_agent, :extra_providers)

    extra =
      (old_extra || [])
      |> Map.new()
      |> Map.put(:initial_snapshot_capture, CaptureProvider)

    Application.put_env(:novel_agent, :extra_providers, extra)

    on_exit(fn ->
      if old_extra,
        do: Application.put_env(:novel_agent, :extra_providers, old_extra),
        else: Application.delete_env(:novel_agent, :extra_providers)
    end)

    :ok
  end

  test "new/2 的 initial_scope 一次构造 base → scope → author，保留作者原字节与 turn 元数据" do
    transcript =
      AuthoringTranscript.new(
        %{run_id: "initial-snapshot-run", work_id: "work-1"},
        base_text: "稳定 Base",
        author_text: @author_a,
        author_turn_ref: "author-turn-a",
        author_turn: %{origin: "author_choice", question_ref: "question-1"},
        initial_scope: %{
          text: @context_block,
          versions: %{"scope_revision" => 1, "change_reason" => "initial_scope"},
          source_refs: [%{ref: "author-turn-a"}, %{ref: "chapter:one"}]
        }
      )

    assert [base, scope, author] = transcript.messages
    assert base.role == "application_base"
    assert base.provenance == "application"
    assert Projection.text_of(base.blocks) == "稳定 Base"

    assert scope.role == "scope_update"
    assert scope.provenance == "application"
    assert Projection.text_of(scope.blocks) == @context_block
    assert scope.versions == %{"scope_revision" => 1, "change_reason" => "initial_scope"}
    assert scope.source_refs == [%{ref: "author-turn-a"}, %{ref: "chapter:one"}]

    assert author.role == "user"
    assert author.provenance == "author"
    assert Projection.text_of(author.blocks) == @author_a
    assert author.source_refs == [%{ref: "author-turn-a"}]

    assert author.author_turn == %{
             "origin" => "author_choice",
             "question_ref" => "question-1"
           }
  end

  test "生产判断请求首次快照经 Gateway 捕获为 base → scope → author，且内容不多不少" do
    input =
      input(@author_a, "author-turn-a")
      |> Map.put(:author_turn, %{origin: "author_choice", question_ref: "question-1"})
      |> Map.put(:scope_change_reason, "run_scope_refreshed")

    request = JudgmentProtocol.request_for_production(input)

    assert [base, scope, author] = request.messages
    assert base.role == "application_base"
    assert scope.role == "scope_update"
    assert scope.provenance == "application"
    assert Projection.text_of(scope.blocks) =~ @context_block
    assert scope.versions["scope_revision"] == 1
    assert scope.versions["change_reason"] == "initial_scope"
    assert scope.source_refs == [%{ref: "author-turn-a"}, %{ref: "chapter:one"}]
    assert author.role == "user"
    assert author.provenance == "author"
    assert Projection.text_of(author.blocks) == @author_a
    assert author.author_turn["origin"] == "author_choice"
    assert author.author_turn["question_ref"] == "question-1"
    assert Enum.count(request.messages, &(&1.role == "user")) == 1

    body = capture(request)

    assert Enum.map(body.messages, & &1.role) == ["system", "user", "user", "user"]
    assert Enum.at(body.messages, 1).content =~ "application_base"
    assert Enum.at(body.messages, 2).content =~ "scope_update"
    assert Enum.at(body.messages, 3).content == @author_a
    refute Enum.at(body.messages, 2).content =~ @author_a
    assert Enum.count(body.messages, &(&1.role == "user" and &1.content == @author_a)) == 1
  end

  test "两个独立作者输入的同半稳定上下文共享前缀覆盖原 scope 会话摘要边界" do
    first_request = JudgmentProtocol.request_for_production(input(@author_a, "author-turn-a"))
    second_request = JudgmentProtocol.request_for_production(input(@author_b, "author-turn-b"))

    first = capture(first_request) |> serialize()
    second = capture(second_request) |> serialize()
    boundary = marker_offset!(first, "## 会话摘要")
    shared = shared_prefix_bytes(first, second)

    assert shared >= boundary,
           "shared=#{shared} boundary=#{boundary}"

    assert occurrences(first, @author_a) == 1
    assert occurrences(second, @author_b) == 1
    refute String.contains?(first, @author_b)
    refute String.contains?(second, @author_a)
  end

  test "已有 transcript 续行严格前缀不变，重复构造与 JSON restore 三类投影一致" do
    {first_request, first_transcript} = production_request(input(@author_a, "author-turn-a"))

    next_input =
      input(@author_b, "author-turn-b", @context_block <> "\n新增事实：第02章需要压缩。")
      |> Map.put(:transcript, first_transcript)
      |> Map.put(:scope_change_reason, "run_scope_changed")

    {next_request, next_transcript} = production_request(next_input)
    {duplicate_request, duplicate_transcript} = production_request(next_input)

    assert Enum.take(next_request.messages, length(first_request.messages)) ==
             first_request.messages

    author_texts =
      next_request.messages
      |> Enum.filter(&(&1.role == "user" and &1.provenance == "author"))
      |> Enum.map(&Projection.text_of(&1.blocks))

    assert author_texts == [@author_a, @author_b]
    assert next_request.messages == duplicate_request.messages
    assert next_transcript.messages == duplicate_transcript.messages

    scope = AuthoringTranscript.current_scope(next_transcript)
    assert scope.versions["scope_revision"] == 2
    assert scope.versions["change_reason"] == "run_scope_changed"
    assert Enum.map(scope.source_refs, & &1.ref) == ["author-turn-b", "chapter:one"]

    assert {:ok, restored} = restore(next_transcript)

    {restored_request, restored_transcript} =
      production_request(Map.put(next_input, :transcript, restored))

    assert restored_transcript.messages == next_transcript.messages

    Enum.each(@projection_targets, fn target ->
      expected = Projection.project(next_request, target)
      assert Projection.project(duplicate_request, target) == expected
      assert Projection.project(restored_request, target) == expected
    end)
  end

  defp input(author_text, source_ref, context_block \\ @context_block) do
    %{
      author_text: author_text,
      context_block: context_block,
      source_input_ref: source_ref,
      supplied_context_refs: ["chapter:one"],
      options: []
    }
  end

  defp production_request(input) do
    assert {:ok, transcript} = JudgmentProtocol.transcript_for_production(input)
    assert %RequestIR{} = request = JudgmentProtocol.request_for_production(input)
    {request, transcript}
  end

  defp restore(transcript) do
    transcript
    |> AuthoringTranscript.checkpoint()
    |> Jason.encode!()
    |> Jason.decode!()
    |> AuthoringTranscript.restore()
  end

  defp capture(request) do
    assert {:ok, _} =
             Gateway.execute(request, "capture-model", InferenceParams.new(),
               provider: :initial_snapshot_capture,
               purpose: :planner
             )

    assert_receive {:captured_request, body}, 1_000
    body
  end

  defp serialize(%{messages: messages}) do
    Enum.map_join(messages, "", fn message -> "#{message.role}\n#{message.content}" end)
  end

  defp marker_offset!(text, marker) do
    case :binary.matches(text, marker) do
      [match | _] -> elem(match, 0)
      [] -> flunk("marker not found: #{inspect(marker)}")
    end
  end

  defp occurrences(text, needle), do: length(String.split(text, needle)) - 1

  defp shared_prefix_bytes(left, right) do
    left
    |> :binary.bin_to_list()
    |> Enum.zip(:binary.bin_to_list(right))
    |> Enum.take_while(fn {a, b} -> a == b end)
    |> length()
  end
end
