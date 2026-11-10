defmodule NovelPersistence.AuthoringSessionLogTest do
  @moduledoc """
  B81 CP1 会话级 canonical 持久化边界（`NovelPersistence.AuthoringSessionLog`）。

  canonical 作用域从 run 提升到会话：消息按会话 append-only 追加、按 run 归因
  执行段；段头承载 run 身份与派生配置，不复制消息。本文件只测 persistence 层
  拥有的存储壳语义（前缀/身份/版本/形状/顺序/一致性），完整 Request IR 校验在
  application 写入边界（`AuthoringCheckpoint`），不在此重复。

  测试覆盖映射（B81 CP1 测试改造清单 N 系列）：
  - N1 跨 run 追加顺序
  - N2 并发/交错的会话序号唯一（SQLite 单写者 + 唯一索引；Sandbox 下用确定性交错）
  - N3 幂等
  - N4 未知版本 fail-closed
  - N5 空会话
  - N7 会话级前缀不可变
  - N8 会话身份不可重绑
  - N9 段头/消息一致性
  - N12 一次事务内 run 行 + 段头 + 消息同时可读、失败全回滚
  """

  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelPersistence.{AgentRunLog, AuthoringSessionLog, Repo}
  alias NovelPersistence.Schemas.AuthoringRunSegment, as: Segment

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  # ── 用例 ────────────────────────────────────────────────────────────────

  test "N12：一次事务内 run 行、段头与消息同时可读，段状态如实" do
    run_id = unique("run-first")
    run = run_attrs(run_id)

    state = append!(run, segment(run_id, ["m1", "m2"]))
    assert_state(state, run_id, 2, 1, 2)

    # 同一事务已提交：run 行、段头、消息行都真实可见。
    assert %{} = AgentRunLog.get_run(run_id)
    assert segment_row(run_id)
    assert %{header: seg_header, messages: messages} = fetch_segment!(run_id)
    assert seg_header["version"] == AuthoringSessionLog.segment_format_version()
    assert seg_header["run"]["run_id"] == run_id
    assert messages == [message("m1"), message("m2")]

    assert [%{sequence: 1, run_sequence: 1}, %{sequence: 2, run_sequence: 2}] =
             session_messages(session_id(run_id))
  end

  test "N12：事务回滚时 run 行、段头与消息全部不可见" do
    run_id = unique("run-rollback")
    run = run_attrs(run_id)

    assert {:error, :injected_rollback} =
             Repo.transaction(fn ->
               {:ok, _run} = AgentRunLog.upsert_run(run)
               {:ok, _state} = AuthoringSessionLog.append_run(run, segment(run_id, ["m1"]))
               Repo.rollback(:injected_rollback)
             end)

    assert AgentRunLog.get_run(run_id) == nil
    assert segment_row(run_id) == nil
    assert session_messages(session_id(run_id)) == []
    assert AuthoringSessionLog.segment_present?(run_id) == false
  end

  test "N1：同会话跨 run 追加按会话序号连续，段各自独立" do
    session = unique("sess-shared")
    run_a = unique("run-a")
    run_b = unique("run-b")

    append!(
      run_attrs(run_a, session_id: session),
      segment(run_a, ["a1", "a2"], run: %{"session_id" => session})
    )

    append!(
      run_attrs(run_b, session_id: session),
      segment(run_b, ["b1", "b2"], run: %{"session_id" => session})
    )

    messages = session_messages(session)

    assert Enum.map(messages, & &1.sequence) == [1, 2, 3, 4]
    assert Enum.map(messages, & &1.run_id) == [run_a, run_a, run_b, run_b]
    assert Enum.map(messages, & &1.run_sequence) == [1, 2, 1, 2]

    assert Enum.map(messages, & &1.message["blocks"]) ==
             Enum.map(["a1", "a2", "b1", "b2"], fn text ->
               [%{"type" => "text", "text" => text}]
             end)

    assert %{messages: a_messages} = fetch_segment!(run_a)
    assert a_messages == [message("a1"), message("a2")]

    assert %{messages: b_messages} = fetch_segment!(run_b)
    assert b_messages == [message("b1"), message("b2")]
  end

  test "N2：两 run 交错追加后会话序号无空洞无重复，唯一索引真实存在" do
    session = unique("sess-interleaved")
    run_a = unique("run-interleaved-a")
    run_b = unique("run-interleaved-b")

    # Sandbox 单连接无法构造真实并发事务（跨进程并发会退化为连接串行），因此这里用
    # 确定性交错验证「跨 run 序号接续 + 唯一约束」。
    # known-gap（B81 CP1）：真实并发 append 的串行化由 `(session_id, sequence)` /
    # `(run_id, run_sequence)` 唯一索引 + commit_snapshot 的 `mode: :immediate` 事务
    # 背书，不在单测覆盖范围；登记见 B81 §9（由 Lead 维护）。
    append!(
      run_attrs(run_a, session_id: session),
      segment(run_a, ["a1"], run: %{"session_id" => session})
    )

    append!(
      run_attrs(run_b, session_id: session),
      segment(run_b, ["b1"], run: %{"session_id" => session})
    )

    append!(
      run_attrs(run_a, session_id: session),
      segment(run_a, ["a1", "a2"], run: %{"session_id" => session})
    )

    messages = session_messages(session)
    assert Enum.map(messages, & &1.sequence) == [1, 2, 3]
    assert Enum.map(messages, & &1.run_id) == [run_a, run_b, run_a]
    assert Enum.map(messages, & &1.run_sequence) == [1, 1, 2]

    indexes =
      Repo.query!(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?",
        ["authoring_session_messages"]
      ).rows
      |> List.flatten()

    assert Enum.any?(indexes, &(&1 =~ "session_id_sequence"))
    assert Enum.any?(indexes, &(&1 =~ "run_id_run_sequence"))
  end

  test "N3：同 run 同消息列表重复 append 幂等，行数/序号不变" do
    run_id = unique("run-idempotent")
    run = run_attrs(run_id)
    seg = segment(run_id, ["m1", "m2"])

    first = append!(run, seg)
    assert_state(first, run_id, 2, 1, 2)

    second = append!(run, seg)
    assert_state(second, run_id, 2, 1, 2)

    messages = session_messages(session_id(run_id))
    assert length(messages) == 2
    assert Enum.map(messages, & &1.sequence) == [1, 2]
  end

  test "N7：会话级前缀不可变——回退与改写既有消息都被拒绝且原行不变" do
    run_id = unique("run-prefix")
    run = run_attrs(run_id)

    append!(run, segment(run_id, ["m1", "m2"]))

    # 回退：新列表比已存短。
    assert append_error(run, segment(run_id, ["m1"])) == :authoring_history_rollback_rejected

    # 改写：同长度但既有前缀内容不同。
    assert append_error(run, segment(run_id, ["m1", "changed"])) ==
             :authoring_history_prefix_mismatch

    # 原 2 条消息仍在，序号未漂移。
    assert %{messages: [m1, m2]} = fetch_segment!(run_id)
    assert m1 == message("m1")
    assert m2 == message("m2")
    assert Enum.map(session_messages(session_id(run_id)), & &1.sequence) == [1, 2]
  end

  test "N7：合法追加保留既有前缀并更新段范围" do
    run_id = unique("run-append-more")
    run = run_attrs(run_id)

    append!(run, segment(run_id, ["m1"]))
    state = append!(run, segment(run_id, ["m1", "m2", "m3"]))

    assert_state(state, run_id, 3, 1, 3)
    assert %{messages: [m1, m2, m3]} = fetch_segment!(run_id)
    assert [m1, m2, m3] == [message("m1"), message("m2"), message("m3")]
  end

  test "N8：同 run 二次 append 改变 workspace/work/session 身份被拒绝" do
    run_id = unique("run-rebind")
    session = unique("sess-rebind")
    run = run_attrs(run_id, session_id: session)

    append!(run, segment(run_id, ["m1"], run: %{"session_id" => session}))

    for {field, atom_field} <- [
          {"workspace_id", :workspace_id},
          {"work_id", :work_id},
          {"session_id", :session_id}
        ] do
      value = unique("other-#{field}")
      rebound_run = Map.put(run, atom_field, value)

      rebound_header =
        header(run_id, %{}, %{"session_id" => session}) |> put_in(["run", field], value)

      rebound_segment = %{header: rebound_header, messages: [message("m1")]}

      assert append_error(rebound_run, rebound_segment) == :authoring_segment_identity_mismatch,
             "expected #{field} rebind to be rejected"
    end

    # 原段与原消息身份未变。
    assert %{header: seg_header} = fetch_segment!(run_id)
    assert seg_header["run"]["session_id"] == session
    assert Enum.map(session_messages(session), & &1.run_id) == [run_id]
  end

  test "段头身份五字段与 run 行不一致时拒绝" do
    for field <- ~w(run_id workspace_id work_id session_id parent_turn_ref) do
      run_id = unique("run-header-identity")
      run = run_attrs(run_id)
      tampered = put_in(header(run_id), ["run", field], unique("other"))

      assert append_error(run, %{header: tampered, messages: [message("m1")]}) ==
               :authoring_segment_identity_mismatch,
             "expected header #{field} mismatch to be rejected"

      assert segment_row(run_id) == nil
      assert session_messages(session_id(run_id)) == []
    end
  end

  test "N4：未知段头版本 fail-closed，不写任何行" do
    run_id = unique("run-version")
    run = run_attrs(run_id)
    tampered = header(run_id, %{"version" => "authoring-run-segment/v0"})

    assert append_error(run, %{header: tampered, messages: [message("m1")]}) ==
             :authoring_segment_version_unsupported

    assert segment_row(run_id) == nil
    assert session_messages(session_id(run_id)) == []
  end

  test "写入口壳校验：run 身份、段头形状、消息形状、空历史各自拒绝" do
    run_id = unique("run-shape")
    run = run_attrs(run_id)

    # run 行缺身份字段。
    assert append_error(Map.delete(run, :session_id), segment(run_id, ["m1"])) ==
             :authoring_run_identity_missing

    # 段头不是 map。
    assert append_error(run, %{header: :not_a_map, messages: [message("m1")]}) ==
             :authoring_segment_shape_invalid

    # 段头缺必需层级。
    for key <- ~w(run system projection) do
      tampered = header(run_id) |> Map.delete(key)

      assert append_error(run, %{header: tampered, messages: [message("m1")]}) ==
               :authoring_segment_shape_invalid
    end

    for key <- ~w(tools base_refs observation_refs used_refs) do
      tampered = header(run_id) |> Map.delete(key)

      assert append_error(run, %{header: tampered, messages: [message("m1")]}) ==
               :authoring_segment_shape_invalid
    end

    # 消息不是 list / 消息不是 map / role 为空。
    assert append_error(run, %{header: header(run_id), messages: %{}}) ==
             :authoring_message_shape_invalid

    assert append_error(run, %{header: header(run_id), messages: [:not_a_map]}) ==
             :authoring_message_shape_invalid

    assert append_error(run, %{header: header(run_id), messages: [%{"role" => "  "}]}) ==
             :authoring_message_shape_invalid

    # 空历史：段存在却没有消息是非法事实。
    assert append_error(run, %{header: header(run_id), messages: []}) ==
             :authoring_segment_empty_history

    # 非法的 segment 输入壳。
    assert append_error(run, :not_a_segment) == :authoring_segment_shape_invalid

    assert segment_row(run_id) == nil
    assert session_messages(session_id(run_id)) == []
  end

  test "N5：空会话返回 none/空列表，不制造空段" do
    run_id = unique("run-empty")
    session = unique("sess-empty")

    assert AuthoringSessionLog.fetch_run_segment(run_id) == {:ok, nil}
    assert {:ok, %{rows: []}} = AuthoringSessionLog.fetch_session(session)
    assert AuthoringSessionLog.segment_present?(run_id) == false
  end

  test "N9：段头 message_count 与消息行不一致时读取报不一致错误" do
    run_id = unique("run-inconsistent")
    run = run_attrs(run_id)
    append!(run, segment(run_id, ["m1", "m2"]))

    Repo.query!(
      "UPDATE authoring_run_segments SET message_count = message_count + 1 WHERE run_id = ?",
      [run_id]
    )

    assert AuthoringSessionLog.fetch_run_segment(run_id) ==
             {:error, :authoring_segment_inconsistent}

    assert AuthoringSessionLog.fetch_session(run.session_id) ==
             {:error, :authoring_segment_inconsistent}
  end

  test "段头可更新派生配置但消息永不变（同 run 幂等提交更新 header）" do
    run_id = unique("run-header-update")
    run = run_attrs(run_id)

    append!(run, segment(run_id, ["m1"]))
    updated_header = Map.put(header(run_id), "system", %{"instructions" => "v2"})
    append!(run, %{header: updated_header, messages: [message("m1")]})

    assert %{header: seg_header, messages: messages} = fetch_segment!(run_id)
    assert seg_header["system"] == %{"instructions" => "v2"}
    assert messages == [message("m1")]
    assert length(session_messages(session_id(run_id))) == 1
  end

  # ── helpers ─────────────────────────────────────────────────────────────

  # 真实提交边界是 commit_snapshot：run 行与段/消息同一事务。这里复刻该边界，
  # 使「同时可读 / 全回滚」语义可被本模块直接验证。
  defp append!(run_record, segment) do
    assert {:ok, state} =
             Repo.transaction(fn ->
               {:ok, _run} = AgentRunLog.upsert_run(run_record)

               case AuthoringSessionLog.append_run(run_record, segment) do
                 {:ok, state} -> state
                 {:error, reason} -> Repo.rollback(reason)
               end
             end)

    state
  end

  defp append_error(run_record, segment) do
    assert {:error, reason} =
             Repo.transaction(fn ->
               # 负例可能连 run 行都不合法；run 行写入失败不在这里断言，
               # 由 append_run 自己的身份校验给出确定错误原子。
               _ = AgentRunLog.upsert_run(run_record)

               case AuthoringSessionLog.append_run(run_record, segment) do
                 {:ok, state} -> state
                 {:error, reason} -> Repo.rollback(reason)
               end
             end)

    reason
  end

  defp fetch_segment!(run_id) do
    assert {:ok, %{} = segment} = AuthoringSessionLog.fetch_run_segment(run_id)
    segment
  end

  defp session_messages(session_id) do
    assert {:ok, %{rows: rows}} = AuthoringSessionLog.fetch_session(session_id)
    rows
  end

  defp segment_row(run_id), do: Repo.get(Segment, run_id)

  defp assert_state(state, run_id, count, first_sequence, last_sequence) do
    assert state.run_id == run_id
    assert state.message_count == count
    assert state.first_sequence == first_sequence
    assert state.last_sequence == last_sequence
  end

  defp run_attrs(run_id, overrides \\ %{}) do
    Map.merge(
      %{
        id: run_id,
        workspace_id: workspace_id(run_id),
        work_id: work_id(run_id),
        session_id: session_id(run_id),
        parent_turn_ref: parent_turn(run_id),
        origin_frame_ref: "frame-#{run_id}",
        run_mode: "bounded",
        profile_ref: "character_design_with_context_v1",
        status: "running",
        phase: "executing",
        goal: %{"text" => "goal", "version" => 1},
        goal_version: 1
      },
      Map.new(overrides)
    )
  end

  # `segment/3` 的第三个参数是 keyword：
  # - `:header` 覆盖 header 顶层键（例如 version）
  # - `:run` 覆盖 header.run 内的身份字段（用于构造身份错绑/换会话）
  defp segment(run_id, texts, opts \\ []) do
    header_overrides = Keyword.get(opts, :header, %{})
    run_overrides = Keyword.get(opts, :run, %{})

    %{
      header: header(run_id, header_overrides, run_overrides),
      messages: Enum.map(texts, &message/1)
    }
  end

  defp header(run_id, header_overrides \\ %{}, run_overrides \\ %{}) do
    Map.merge(
      %{
        "version" => AuthoringSessionLog.segment_format_version(),
        "run" =>
          Map.merge(
            %{
              "run_id" => run_id,
              "workspace_id" => workspace_id(run_id),
              "work_id" => work_id(run_id),
              "session_id" => session_id(run_id),
              "parent_turn_ref" => parent_turn(run_id)
            },
            Map.new(run_overrides)
          ),
        "system" => %{},
        "tools" => [],
        "projection" => %{},
        "base_refs" => [],
        "observation_refs" => [],
        "used_refs" => [],
        "call_ids" => []
      },
      Map.new(header_overrides)
    )
  end

  defp message(text) do
    %{
      "role" => "user",
      "provenance" => "author",
      "blocks" => [%{"type" => "text", "text" => text}],
      "source_refs" => [%{"ref" => text}]
    }
  end

  defp workspace_id(run_id), do: "ws-#{run_id}"
  defp work_id(run_id), do: "work-#{run_id}"
  defp session_id(run_id), do: "sess-#{run_id}"
  defp parent_turn(run_id), do: "turn-#{run_id}"

  defp unique(prefix), do: "#{prefix}-#{System.unique_integer([:positive, :monotonic])}"
end
