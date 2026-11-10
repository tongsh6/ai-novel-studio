defmodule NovelApplication.AuthoringSessionHistoryTest do
  @moduledoc """
  B81 CP2：会话历史 → 请求派生视图（application 层组装）的机制测试。

  覆盖：无已提交消息 nil、会话行读取（含当前 run，排除 base）、refs 会话累计、
  compose 顺序（当前 base → 已提交行原序 → 当前段未提交尾部）、按归属 strip、
  身份缺失/段头损坏 fail-closed。
  """

  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL
  alias Ecto.Adapters.SQL.Sandbox

  alias NovelApplication.AuthoringCheckpoint
  alias NovelApplication.AuthoringSessionHistory
  alias NovelApplication.AuthoringTranscript
  alias NovelPersistence.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  defp identity(run_id, overrides \\ %{}) do
    Map.merge(
      %{
        run_id: run_id,
        workspace_id: "ws-history",
        work_id: "work-history",
        session_id: "sess-history",
        parent_turn_ref: "turn-#{run_id}"
      },
      overrides
    )
  end

  defp run_record(run_id, overrides \\ %{}) do
    identity = identity(run_id, overrides)

    %{
      id: identity.run_id,
      workspace_id: identity.workspace_id,
      work_id: identity.work_id,
      session_id: identity.session_id,
      parent_turn_ref: identity.parent_turn_ref
    }
  end

  defp transcript(run_id, opts \\ []) do
    AuthoringTranscript.new(identity(run_id),
      base_text: "会话历史测试 Base",
      author_text: Keyword.get(opts, :author_text, "作者原话 #{run_id}"),
      base_refs: Keyword.get(opts, :base_refs, [])
    )
  end

  defp seed_transcript!(transcript, run_id) do
    record = run_record(run_id)

    {:ok, segment} = AuthoringCheckpoint.encode_segment_for_write(transcript)

    {:ok, _state} =
      Repo.transaction(fn -> NovelPersistence.AuthoringSessionLog.append_run(record, segment) end)

    transcript
  end

  defp seed_run!(run_id, opts \\ []) do
    transcript(run_id, opts) |> seed_transcript!(run_id)
  end

  defp history(run_id, messages, refs \\ %{}) do
    rows =
      messages
      |> Enum.with_index(1)
      |> Enum.map(fn {message, sequence} ->
        %{
          sequence: sequence,
          run_id: run_id,
          run_sequence: sequence,
          role: message.role,
          message: message
        }
      end)

    %{
      rows: rows,
      refs:
        Map.merge(
          %{base_refs: [], observation_refs: [], used_refs: []},
          refs
        )
    }
  end

  defp fetch!(run_id) do
    assert {:ok, history} =
             AuthoringSessionHistory.fetch(%{run_id: run_id, session_id: "sess-history"})

    history
  end

  defp message_text(%{blocks: blocks}) do
    Enum.map_join(blocks, "", &(Map.get(&1, :text) || ""))
  end

  test "只有本 run 已提交行时返回 nil（局部已拥有完整顺序）" do
    seed_run!("run-history-first")

    assert {:ok, nil} =
             AuthoringSessionHistory.fetch(%{
               run_id: "run-history-first",
               session_id: "sess-history"
             })
  end

  test "存在外 run 已提交行时才返回全序 rows（含当前 run）" do
    seed_run!("run-history-1", author_text: "上一轮作者原话")

    assert {:ok, nil} =
             AuthoringSessionHistory.fetch(%{
               run_id: "run-history-1",
               session_id: "sess-history"
             })

    assert Enum.map(fetch!("run-history-2").rows, & &1.run_id) == ["run-history-1"]

    seed_run!("run-history-2", author_text: "当前 run 作者原话")
    history = fetch!("run-history-2")

    assert Enum.map(history.rows, & &1.run_id) == ["run-history-1", "run-history-2"]
    refute Enum.any?(history.rows, &(&1.role == "application_base"))
    assert Enum.any?(history.rows, &(&1.role == "user"))
  end

  test "refs 按会话累计（历史段头 refs 并集）" do
    seed_run!("run-refs-1", base_refs: [%{ref: "base-1"}])

    history = fetch!("run-refs-2")
    assert history.refs.base_refs == [%{"ref" => "base-1"}]
    assert is_list(history.refs.observation_refs)
    assert is_list(history.refs.used_refs)
  end

  test "compose 保持当前 base 最前、已提交行原序、当前段未提交尾部最后" do
    history =
      history(
        "run-history-other",
        [
          %{
            role: "user",
            provenance: "author",
            blocks: [%{type: "text", text: "历史作者"}]
          }
        ],
        %{
          base_refs: [%{"ref" => "base-history"}],
          observation_refs: [%{"ref" => "obs-history"}],
          used_refs: []
        }
      )

    segment =
      AuthoringTranscript.new(identity("run-compose"),
        base_text: "base",
        author_text: "初始作者"
      )
      |> AuthoringTranscript.append_author_turn("当前作者", "author_turn:current")

    view = AuthoringSessionHistory.compose(segment, history)

    assert [%{role: "application_base"} = base | _] = view.messages
    assert base == hd(segment.messages)

    assert List.last(view.messages).blocks |> hd() |> Map.get(:text) == "当前作者"

    history_message = Enum.find(view.messages, &(message_text(&1) == "历史作者"))
    assert history_message.session_history_run_id == "run-history-other"
    refute Map.has_key?(List.last(view.messages), :session_history_run_id)

    assert [%{ref: "base-history"} | _] = view.base_refs
    assert Enum.any?(view.observation_refs, &(&1.ref == "obs-history"))
  end

  test "strip_request_history 按归属剥离外 run 行，恢复当前 run 段" do
    segment =
      transcript("run-strip")
      |> AuthoringTranscript.append_author_turn("当前作者", "author_turn:current")

    history =
      history("run-history-other", [
        %{role: "user", provenance: "author", blocks: [%{type: "text", text: "历史1"}]},
        %{role: "assistant", provenance: "model", blocks: [%{type: "text", text: "历史2"}]}
      ])

    view = AuthoringSessionHistory.compose(segment, history)
    stripped = AuthoringSessionHistory.strip_request_history(view)

    assert stripped.messages == segment.messages
    assert length(stripped.messages) == length(segment.messages)
    assert stripped.call_ids == segment.call_ids
  end

  test "nil 历史 compose/strip 是恒等变换" do
    segment = transcript("run-nil")
    assert AuthoringSessionHistory.compose(segment, nil) == segment
    assert AuthoringSessionHistory.strip_request_history(segment) == segment
  end

  test "会话身份缺失视为无历史；段头损坏 fail-closed 不静默退化" do
    assert {:ok, nil} = AuthoringSessionHistory.fetch(%{run_id: "run-x", session_id: nil})

    seed_run!("run-broken")

    SQL.query!(
      Repo,
      "UPDATE authoring_run_segments SET header = ? WHERE run_id = ?",
      [Jason.encode!(%{"version" => "authoring-run-segment/v9"}), "run-broken"]
    )

    assert {:error, :authoring_segment_version_unsupported} =
             AuthoringSessionHistory.fetch(%{run_id: "run-other", session_id: "sess-history"})
  end
end
