defmodule NovelPersistence.ProviderOperationAdmissionTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL
  alias Ecto.Adapters.SQL.Sandbox
  alias NovelCommon.Contracts.{ProviderOutput, ProviderRun}
  alias NovelPersistence.{ProviderRunLog, Repo}

  setup context do
    if context[:independent_connections] do
      :ok = Sandbox.mode(Repo, :manual)
    else
      :ok = Sandbox.checkout(Repo)
      Sandbox.mode(Repo, {:shared, self()})
    end

    :ok
  end

  test "same source is admitted once across runs and remains fenced when its outcome is unknown" do
    scope = context("first")
    first = initialized("first", scope)
    second_scope = %{scope | agent_run_id: "run-second"}
    second = initialized("second", second_scope)

    assert :ok = admit(first, scope)

    assert %{status: "initialized", provider_id: "test_provider", model: "summary-model"} =
             ProviderRunLog.get_run(first.provider_run_id)

    assert ProviderRunLog.operation_source_keys(scope, "transcript_compaction") ==
             {:ok, MapSet.new([source_key(scope, 1)])}

    assert {:error, :provider_operation_already_owned} =
             admit(second, second_scope)

    assert ProviderRunLog.list_runs(second_scope.agent_run_id) == []

    assert :ok =
             ProviderRunLog.record_execution(
               {:error, %{provider_run: %{first | status: :failed}, events: []}},
               scope
             )

    assert {:error, :provider_operation_already_owned} =
             admit(second, second_scope)

    other = context("other", %{session_id: "another-session"})
    assert :ok = admit(initialized("other", other), other)

    assert [%{operation: "transcript_compaction"}] =
             ProviderRunLog.list_usage_summaries(scope.agent_run_id)
  end

  @tag :independent_connections
  test "two independently checked-out connections commit one source qualification" do
    unique = Integer.to_string(System.unique_integer([:positive]))
    scope = context("concurrent", %{session_id: "session-concurrent-" <> unique})
    parent = self()

    attempts =
      for suffix <- ["one", "two"] do
        Task.async(fn ->
          Sandbox.unboxed_run(Repo, fn ->
            send(parent, {:operation_connection_ready, self()})

            receive do
              :admit_operation ->
                own_scope = %{scope | agent_run_id: "run-concurrent-" <> unique <> suffix}

                admit(
                  initialized(unique <> suffix, own_scope),
                  own_scope
                )
            after
              2_000 -> flunk("concurrent admission was not released")
            end
          end)
        end)
      end

    try do
      for %{pid: pid} <- attempts do
        assert_receive {:operation_connection_ready, ^pid}, 2_000
      end

      Enum.each(attempts, &send(&1.pid, :admit_operation))
      results = Enum.map(attempts, &Task.await(&1, 10_000))
      assert Enum.count(results, &(&1 == :ok)) == 1
      assert Enum.count(results, &(&1 == {:error, :provider_operation_already_owned})) == 1

      Sandbox.unboxed_run(Repo, fn ->
        assert %{rows: [[1]]} =
                 SQL.query!(Repo, "SELECT count(*) FROM provider_runs WHERE session_id = ?", [
                   scope.session_id
                 ])

        assert ProviderRunLog.operation_source_keys(scope, "transcript_compaction") ==
                 {:ok, MapSet.new([source_key(scope, 1)])}
      end)
    after
      Enum.each(attempts, fn task ->
        if Process.alive?(task.pid), do: Task.shutdown(task, :brutal_kill)
      end)

      Sandbox.unboxed_run(Repo, fn ->
        SQL.query!(Repo, "DELETE FROM provider_runs WHERE session_id = ?", [scope.session_id])
      end)
    end
  end

  test "overlapping sources stay fenced after regrouping while fresh sources remain admissible" do
    scope = context("overlap")
    first = initialized("overlap-first", scope)
    assert :ok = admit(first, scope)

    regrouped = initialized("overlap-second", scope)

    regrouped = %{
      regrouped
      | owner_refs:
          Map.merge(regrouped.owner_refs, %{
            coverage_key: "different-group",
            discussion_source_keys: [source_key(scope, 2), source_key(scope, 1)]
          })
    }

    assert {:error, :provider_operation_already_owned} =
             admit(regrouped, scope)

    fresh = initialized("fresh-only", scope)

    fresh = %{
      fresh
      | owner_refs:
          Map.merge(fresh.owner_refs, %{
            coverage_key: "fresh-group",
            discussion_source_keys: [source_key(scope, 2)]
          })
    }

    assert :ok = admit(fresh, scope)

    assert ProviderRunLog.operation_source_keys(scope, "transcript_compaction") ==
             {:ok, MapSet.new([source_key(scope, 1), source_key(scope, 2)])}
  end

  test "equal request digests do not merge two different canonical source identities" do
    scope = context("distinct-source-identity")
    first = initialized("identity-first", scope)
    second = initialized("identity-second", scope)

    second = %{
      second
      | owner_refs: Map.put(second.owner_refs, :discussion_source_keys, [source_key(scope, 2)])
    }

    # 同一个完整性字段值不代表同一来源；期望由两份明确不同的持久坐标给出。
    assert first.owner_refs.coverage_key == second.owner_refs.coverage_key
    assert :ok = admit(first, scope)
    assert :ok = admit(second, scope)
    assert length(ProviderRunLog.list_runs(scope.agent_run_id)) == 2

    assert {:error, :provider_operation_already_owned} =
             admit(initialized("identity-first-repeated", scope), scope)

    assert ProviderRunLog.operation_source_keys(scope, "transcript_compaction") ==
             {:ok, MapSet.new([source_key(scope, 1), source_key(scope, 2)])}
  end

  test "admission requires a nonempty unique list of source fingerprints" do
    scope = context("source-shape")

    for {sources, index} <-
          Enum.with_index([
            nil,
            [],
            [""],
            [source_key(scope, 1), source_key(scope, 1)],
            [source_key(%{scope | work_id: "other-work"}, 1)]
          ]) do
      run = initialized("invalid-sources-#{index}", scope)
      run = %{run | owner_refs: Map.put(run.owner_refs, :discussion_source_keys, sources)}

      assert {:error, :provider_operation_sources_missing} =
               admit(run, scope)

      assert ProviderRunLog.get_run(run.provider_run_id) == nil
    end
  end

  test "initialization write failure leaves no admitted execution or coverage fence" do
    scope = context("rejected")
    run = initialized("rejected", scope)

    SQL.query!(Repo, """
    CREATE TEMP TRIGGER reject_operation_admission BEFORE INSERT ON provider_runs
    BEGIN SELECT RAISE(ABORT, 'provider facts unavailable'); END
    """)

    try do
      assert {:error, _reason} = admit(run, scope)

      assert ProviderRunLog.operation_source_keys(scope, "transcript_compaction") ==
               {:ok, MapSet.new()}

      assert ProviderRunLog.get_run(run.provider_run_id) == nil
    after
      SQL.query!(Repo, "DROP TRIGGER reject_operation_admission")
    end
  end

  test "stage and final facts cannot create or rewrite an operation's execution ownership" do
    scope = context("immutable")
    run = initialized("immutable", scope)

    assert {:error, :provider_operation_not_admitted} =
             ProviderRunLog.record_execution(%{provider_run: run, events: []}, scope)

    assert ProviderRunLog.get_run(run.provider_run_id) == nil
    assert :ok = admit(run, scope)

    replacements = [
      %{run | owner_refs: %{}},
      %{run | owner_refs: Map.put(run.owner_refs, :operation, "another_operation")},
      %{run | owner_refs: Map.put(run.owner_refs, :coverage_key, "another_group")},
      %{
        run
        | owner_refs: Map.put(run.owner_refs, :discussion_source_keys, [source_key(scope, 3)])
      },
      %{run | provider_id: "another_provider"},
      %{run | model: "another_model"},
      %{run | provider_call_ref: "another_call"}
    ]

    for replacement <- replacements do
      assert {:error, :provider_operation_identity_conflict} =
               ProviderRunLog.record_execution(
                 %{provider_run: %{replacement | status: :completed}, events: []},
                 scope
               )
    end

    assert {:error, :provider_operation_identity_conflict} =
             ProviderRunLog.record_execution(%{provider_run: run, events: []}, %{
               scope
               | work_id: "other-work"
             })

    assert :ok =
             ProviderRunLog.record_execution(
               %{provider_run: %{run | status: :running}, events: []},
               scope
             )

    assert ProviderRunLog.operation_source_keys(scope, "transcript_compaction") ==
             {:ok, MapSet.new([source_key(scope, 1)])}

    assert {:error, :provider_operation_already_owned} =
             admit(initialized("second-owner", scope), scope)
  end

  test "an ordinary existing execution cannot be promoted into a new operation ownership" do
    scope = context("existing")
    proposed = initialized("existing", scope)
    ordinary = %{proposed | owner_refs: scope}
    assert :ok = ProviderRunLog.record_execution(%{provider_run: ordinary, events: []}, scope)

    assert {:error, :provider_operation_identity_conflict} =
             admit(proposed, scope)

    assert ProviderRunLog.operation_source_keys(scope, "transcript_compaction") ==
             {:ok, MapSet.new()}
  end

  test "旧指纹、缺来源和非规范别名不能被当作没有归属后重新派发" do
    for {kind, index} <- Enum.with_index([:old_hash, :missing, :alias]) do
      scope = context("old-format-#{index}", %{session_id: "old-format-session-#{index}"})
      first = initialized("old-format-#{index}", scope)
      assert :ok = admit(first, scope)
      stored = ProviderRunLog.get_run(first.provider_run_id)

      keys =
        case kind do
          :old_hash -> [String.duplicate("a", 64)]
          :missing -> nil
          :alias -> [String.replace(source_key(scope, 1), ",", ", ")]
        end

      invalid_owner = Map.put(stored.owner_refs, "discussion_source_keys", keys)

      SQL.query!(Repo, "UPDATE provider_runs SET owner_refs = ? WHERE id = ?", [
        Jason.encode!(invalid_owner),
        first.provider_run_id
      ])

      assert {:error, :provider_operation_sources_unsupported} =
               ProviderRunLog.operation_source_keys(scope, "transcript_compaction")

      second = initialized("no-redispatch-#{index}", scope)
      assert {:error, :provider_operation_sources_unsupported} = admit(second, scope)
      assert ProviderRunLog.get_run(second.provider_run_id) == nil
      assert ProviderRunLog.get_run(first.provider_run_id).owner_refs == invalid_owner
    end
  end

  test "persisted text digest binds exact UTF8 bytes and rejects a same-length replacement" do
    scope = context("digest")
    admitted = initialized("digest", scope)
    assert :ok = admit(admitted, scope)
    run = %{admitted | status: :completed}

    output = %ProviderOutput{
      provider_run_ref: run.provider_run_id,
      provider_call_ref: run.provider_call_ref,
      status: :ok,
      content: %{text: "甲乙"}
    }

    assert :ok =
             ProviderRunLog.record_execution(
               {:ok, %{provider_run: run, events: [], output: output}},
               scope
             )

    persisted = ProviderRunLog.get_output(run.provider_run_id)

    assert persisted.content_summary["content_sha256"] ==
             :crypto.hash(:sha256, "甲乙") |> Base.encode16(case: :lower)

    refute Map.has_key?(persisted.content_summary, "text")

    altered = %{output | content: %{text: "丙丁"}}

    assert {:error, {:provider_output_content_conflict, _}} =
             ProviderRunLog.record_execution(
               {:ok, %{provider_run: run, events: [], output: altered}},
               scope
             )
  end

  @tag :independent_connections
  test "source proof is required inside the write transaction before ownership exists" do
    scope = context("proof-" <> Integer.to_string(System.unique_integer([:positive])))
    run = initialized(scope.agent_run_id, scope)

    Sandbox.unboxed_run(Repo, fn ->
      refute Repo.in_transaction?()

      assert {:error, :source_not_verified} =
               ProviderRunLog.admit_operation(run, scope, fn ->
                 assert Repo.in_transaction?()
                 assert ProviderRunLog.get_run(run.provider_run_id) == nil
                 {:error, :source_not_verified}
               end)

      assert ProviderRunLog.get_run(run.provider_run_id) == nil

      assert {:error, :provider_operation_source_validation_invalid} =
               ProviderRunLog.admit_operation(run, scope, fn -> :unknown end)

      assert ProviderRunLog.get_run(run.provider_run_id) == nil
    end)
  end

  test "admission owns a private frozen plan and terminal facts retain the exact response" do
    scope = context("recoverable")

    capsule = %{
      "version" => "provider-operation-checkpoint/v1",
      "goal_version" => 1,
      "plan" => %{
        "covers" => %{"call_ids" => [], "message_refs" => [], "turn_range" => "source-turn"},
        "source_refs" => [],
        "versions" => %{},
        "omissions" => ["原文保留"],
        "summary" => "较早讨论整理"
      }
    }

    scope = Map.put(scope, :operation_checkpoint, capsule)
    initialized = initialized("recoverable", scope)
    assert :ok = admit(initialized, scope)

    assert Map.get(ProviderRunLog.get_run(initialized.provider_run_id), :operation_checkpoint) ==
             capsule

    text = "  已接收的摘要原字节\r\n"

    output = %ProviderOutput{
      provider_run_ref: initialized.provider_run_id,
      provider_call_ref: initialized.provider_call_ref,
      status: :ok,
      content: %{text: text}
    }

    facts =
      {:ok, %{provider_run: %{initialized | status: :completed}, output: output, events: []}}

    assert :ok = ProviderRunLog.record_execution(facts, scope)
    stored = ProviderRunLog.get_run(initialized.provider_run_id)
    assert stored.operation_checkpoint == Map.put(capsule, "response_text", text)
    assert :ok = ProviderRunLog.record_execution(facts, scope)

    assert ProviderRunLog.get_run(initialized.provider_run_id).operation_checkpoint ==
             stored.operation_checkpoint

    refute inspect(ProviderRunLog.list_activity_summaries(scope.agent_run_id)) =~ text
    refute inspect(stored) =~ text
    refute Map.has_key?(stored.owner_refs, "operation_checkpoint")
  end

  test "terminal facts and private response roll back together when durable receipt fails" do
    scope = context("receipt-failure")
    initial = initialized("receipt-failure", scope)
    assert :ok = admit(initial, scope)
    before = ProviderRunLog.get_run(initial.provider_run_id).operation_checkpoint

    output = %ProviderOutput{
      provider_run_ref: initial.provider_run_id,
      provider_call_ref: initial.provider_call_ref,
      status: :ok,
      content: %{text: "原始响应"}
    }

    SQL.query!(Repo, """
    CREATE TEMP TRIGGER reject_private_response BEFORE UPDATE OF operation_checkpoint ON provider_runs
    WHEN json_type(NEW.operation_checkpoint, '$.response_text') = 'text'
    BEGIN SELECT RAISE(ABORT, 'private response unavailable'); END
    """)

    try do
      assert {:error, _} =
               ProviderRunLog.record_execution(
                 {:ok,
                  %{provider_run: %{initial | status: :completed}, output: output, events: []}},
                 scope
               )

      assert ProviderRunLog.get_run(initial.provider_run_id).status == "initialized"
      assert ProviderRunLog.get_run(initial.provider_run_id).operation_checkpoint == before
      assert ProviderRunLog.get_output(initial.provider_run_id) == nil

      assert {:error, :provider_operation_already_owned} =
               admit(initialized("forbidden-retry", scope), scope)
    after
      SQL.query!(Repo, "DROP TRIGGER reject_private_response")
    end
  end

  # 此层只验证事务/归属；真实会话材料证明由 application 的生产消费者与集成测试负责。
  defp admit(run, scope) do
    checkpoint = %{
      "version" => "provider-operation-checkpoint/v1",
      "goal_version" => 1,
      "plan" => %{
        "covers" => %{},
        "source_refs" => [],
        "versions" => %{},
        "omissions" => [],
        "summary" => "存储边界的独立计划夹具"
      }
    }

    ProviderRunLog.admit_operation(
      run,
      Map.put_new(scope, :operation_checkpoint, checkpoint),
      fn -> :ok end
    )
  end

  # 按已声明的复合坐标格式写独立 fixture，不调用生产 source_key 推导期望。
  defp source_key(scope, sequence) do
    "authoring-session-source/v1:" <>
      Jason.encode!([scope.workspace_id, scope.work_id, scope.session_id, "source-run", sequence])
  end

  defp initialized(suffix, scope) do
    %ProviderRun{
      provider_run_id: "prun-operation-" <> suffix,
      provider_call_ref: "pcall-operation-" <> suffix,
      purpose: :other,
      execution_mode: :event_stream,
      status: :initialized,
      provider_id: "test_provider",
      model: "summary-model",
      owner_refs:
        Map.merge(scope, %{
          operation: "transcript_compaction",
          coverage_key: "source-coverage",
          discussion_source_keys: [source_key(scope, 1)]
        })
    }
  end

  defp context(suffix, overrides \\ %{}) do
    Map.merge(
      %{
        agent_run_id: "run-operation-" <> suffix,
        workspace_id: "ws-operation",
        work_id: "work-operation",
        session_id: "session-operation",
        parent_turn_ref: "turn-operation",
        step_id: nil,
        purpose: :other
      },
      overrides
    )
  end
end
