defmodule NovelApplication.AuthoringSessionHistoryTest do
  @moduledoc """
  B81 CP2：会话历史 → 请求派生视图（application 层组装）的机制测试。

  覆盖：无历史 nil、跨 run 历史读取（排除当前 run 与历史 base）、refs 会话累计、
  compose 顺序（当前 base 最前 → 历史原序 → 当前段消息）、strip 恢复段视图、
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

    {:ok, segment} = AuthoringCheckpoint.encode_segment_for_write(record, transcript)

    {:ok, _state} =
      Repo.transaction(fn -> NovelPersistence.AuthoringSessionLog.append_run(record, segment) end)

    transcript
  end

  defp seed_run!(run_id, opts \\ []) do
    transcript(run_id, opts) |> seed_transcript!(run_id)
  end

  test "无历史 run 返回 nil（首轮行为与 CP1 一致）" do
    seed_run!("run-history-first")

    assert {:ok, nil} =
             AuthoringSessionHistory.fetch(%{
               run_id: "run-history-first",
               session_id: "sess-history"
             })
  end

  test "跨 run 历史只包含其他 run 的消息，排除历史 application_base" do
    first = seed_run!("run-history-1", author_text: "上一轮作者原话")

    assert {:ok, history} =
             AuthoringSessionHistory.fetch(%{run_id: "run-history-2", session_id: "sess-history"})

    refute Enum.any?(history.messages, &(&1.role == "application_base"))
    assert Enum.any?(history.messages, &(&1.role == "user"))
    assert length(history.messages) == length(first.messages) - 1
  end

  test "refs 按会话累计（历史段头 refs 并集）" do
    seed_run!("run-refs-1", base_refs: [%{ref: "base-1"}])

    assert {:ok, history} =
             AuthoringSessionHistory.fetch(%{run_id: "run-refs-2", session_id: "sess-history"})

    assert history.refs.base_refs == [%{"ref" => "base-1"}]
    assert is_list(history.refs.observation_refs)
    assert is_list(history.refs.used_refs)
  end

  test "compose 保持当前 base 最前、历史次之、当前段消息最后" do
    history = %{
      messages: [
        %{role: "user", provenance: "author", blocks: [%{type: "text", text: "历史作者"}]}
      ],
      refs: %{
        base_refs: [%{"ref" => "base-history"}],
        observation_refs: [%{"ref" => "obs-history"}],
        used_refs: []
      }
    }

    segment =
      AuthoringTranscript.new(identity("run-compose"),
        base_text: "base",
        author_text: "初始作者"
      )
      |> AuthoringTranscript.append_author_turn("当前作者", "author_turn:current")

    {merged, history_count} = AuthoringSessionHistory.compose(segment, history)

    assert history_count == 1
    assert [%{role: "application_base"} = base | _] = merged.messages
    assert base == hd(segment.messages)

    last = List.last(merged.messages)
    assert last.blocks |> hd() |> Map.get(:text) == "当前作者"

    assert [%{ref: "base-history"} | _] = merged.base_refs
    assert Enum.any?(merged.observation_refs, &(&1.ref == "obs-history"))
  end

  test "strip 恢复当前 run 段视图（历史前缀被剥离，base 保留）" do
    segment =
      transcript("run-strip")
      |> AuthoringTranscript.append_author_turn("当前作者", "author_turn:current")

    history = %{
      messages: [
        %{role: "user", provenance: "author", blocks: [%{type: "text", text: "历史1"}]},
        %{role: "assistant", provenance: "model", blocks: [%{type: "text", text: "历史2"}]}
      ],
      refs: %{base_refs: [], observation_refs: [], used_refs: []}
    }

    {merged, history_count} = AuthoringSessionHistory.compose(segment, history)
    stripped = AuthoringSessionHistory.strip(merged, history_count)

    assert stripped.messages == segment.messages
    assert length(stripped.messages) == length(segment.messages)
  end

  test "nil 历史 compose/strip 是恒等变换" do
    segment = transcript("run-nil")
    assert {^segment, 0} = AuthoringSessionHistory.compose(segment, nil)
    assert AuthoringSessionHistory.strip(segment, 0) == segment
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
