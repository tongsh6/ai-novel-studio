defmodule NovelPersistence.ProviderBudgetAdmissionTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL
  alias Ecto.Adapters.SQL.Sandbox
  alias NovelCommon.Contracts.{ProviderEvent, ProviderRun}
  alias NovelPersistence.{ProviderRunLog, Repo}

  setup context do
    unless context[:independent_connections], do: :ok = Sandbox.checkout(Repo)
    :ok
  end

  test "one grant is occupied before dispatch; failure after dispatch consumes exactly once" do
    scope = scope()
    first = initialized(scope)
    second = initialized(scope)

    assert :ok = ProviderRunLog.admit_execution(first, scope, 1)
    assert ProviderRunLog.budget_usage(scope.agent_run_id) == %{consumed: 0, reserved: 1}
    assert {:error, :provider_budget_exhausted} = ProviderRunLog.admit_execution(second, scope, 1)
    assert ProviderRunLog.get_run(second.provider_run_id) == nil

    dispatched = progress(first, 1, "request_dispatched")
    failed = %{provider_run: %{first | status: :failed}, events: [dispatched]}
    assert :ok = ProviderRunLog.record_execution(failed, scope)
    assert :ok = ProviderRunLog.record_execution(failed, scope)
    assert ProviderRunLog.budget_usage(scope.agent_run_id) == %{consumed: 1, reserved: 0}
    assert {:error, :provider_budget_exhausted} = ProviderRunLog.admit_execution(second, scope, 1)
  end

  test "only a confirmed local non-dispatch releases an occupied slot" do
    scope = scope()
    first = initialized(scope)
    assert :ok = ProviderRunLog.admit_execution(first, scope, 1)

    # A failed terminal status alone does not establish that transport was never attempted.
    assert :ok =
             ProviderRunLog.record_execution(
               %{provider_run: %{first | status: :failed}, events: []},
               scope
             )

    assert ProviderRunLog.budget_usage(scope.agent_run_id) == %{consumed: 0, reserved: 1}
    next = initialized(scope)
    assert {:error, :provider_budget_exhausted} = ProviderRunLog.admit_execution(next, scope, 1)

    # Persist the actual explicit local non-dispatch fact, not an inferred absence.
    proof = progress(first, 1, "request_not_dispatched")

    assert :ok =
             ProviderRunLog.record_execution(
               %{provider_run: %{first | status: :failed}, events: [proof]},
               scope
             )

    assert ProviderRunLog.budget_usage(scope.agent_run_id) == %{consumed: 0, reserved: 0}
    assert :ok = ProviderRunLog.admit_execution(next, scope, 1)
    assert ProviderRunLog.budget_usage(scope.agent_run_id) == %{consumed: 0, reserved: 1}
  end

  test "physical identity cannot be admitted twice or rebound, and another run owns its own grant" do
    scope = scope()
    first = initialized(scope)
    assert {:error, :provider_budget_exhausted} = ProviderRunLog.admit_execution(first, scope, 0)
    assert :ok = ProviderRunLog.admit_execution(first, scope, 2)

    assert {:error, :provider_execution_identity_conflict} =
             ProviderRunLog.admit_execution(first, scope, 2)

    duplicate = %{initialized(scope) | provider_call_ref: first.provider_call_ref}

    assert {:error, :provider_execution_identity_conflict} =
             ProviderRunLog.admit_execution(duplicate, scope, 2)

    other = scope()
    assert :ok = ProviderRunLog.admit_execution(initialized(other), other, 1)
    assert ProviderRunLog.budget_usage(scope.agent_run_id) == %{consumed: 0, reserved: 1}
    assert ProviderRunLog.budget_usage(other.agent_run_id) == %{consumed: 0, reserved: 1}

    assert {:error, :provider_execution_identity_conflict} =
             ProviderRunLog.record_execution(
               %{provider_run: %{first | status: :running}, events: []},
               other
             )
  end

  test "late dispatched evidence cannot free a consumed physical attempt" do
    scope = scope()
    run = initialized(scope)
    assert :ok = ProviderRunLog.admit_execution(run, scope, 1)

    assert :ok =
             ProviderRunLog.record_execution(
               %{
                 provider_run: %{run | status: :cancelled},
                 events: [
                   progress(run, 1, "request_dispatched"),
                   progress(run, 2, "request_not_dispatched")
                 ]
               },
               scope
             )

    # Conservative reconciliation: positive attempt evidence takes precedence over a contradiction.
    assert ProviderRunLog.budget_usage(scope.agent_run_id) == %{consumed: 1, reserved: 0}

    assert {:error, :provider_budget_exhausted} =
             ProviderRunLog.admit_execution(initialized(scope), scope, 1)
  end

  @tag :independent_connections
  test "two independent SQLite connections cannot both reserve the last slot" do
    scope = scope()
    parent = self()

    tasks =
      for _ <- 1..2 do
        Task.async(fn ->
          Sandbox.unboxed_run(Repo, fn ->
            send(parent, {:ready, self()})

            receive do
              :go -> ProviderRunLog.admit_execution(initialized(scope), scope, 1)
            after
              2_000 -> flunk("concurrent admission not released")
            end
          end)
        end)
      end

    try do
      for task <- tasks, do: assert_receive({:ready, pid} when pid == task.pid, 2_000)
      Enum.each(tasks, &send(&1.pid, :go))
      results = Enum.map(tasks, &Task.await(&1, 10_000))
      assert Enum.sort(results) == Enum.sort([:ok, {:error, :provider_budget_exhausted}])

      Sandbox.unboxed_run(Repo, fn ->
        assert ProviderRunLog.budget_usage(scope.agent_run_id) == %{consumed: 0, reserved: 1}
        assert length(ProviderRunLog.list_runs(scope.agent_run_id)) == 1
      end)
    after
      Enum.each(tasks, fn task ->
        if Process.alive?(task.pid), do: Task.shutdown(task, :brutal_kill)
      end)

      Sandbox.unboxed_run(Repo, fn ->
        SQL.query!(Repo, "DELETE FROM provider_runs WHERE agent_run_id = ?", [scope.agent_run_id])
      end)
    end
  end

  defp scope do
    suffix = Integer.to_string(System.unique_integer([:positive, :monotonic]))

    %{
      agent_run_id: "run-b91-" <> suffix,
      workspace_id: "ws-b91",
      work_id: "work-b91",
      session_id: "session-b91-" <> suffix,
      parent_turn_ref: "turn-b91",
      step_id: "step-b91",
      purpose: :planner
    }
  end

  defp initialized(scope) do
    suffix = Integer.to_string(System.unique_integer([:positive, :monotonic]))

    %ProviderRun{
      provider_run_id: "prun-b91-" <> suffix,
      provider_call_ref: "pcall-b91-" <> suffix,
      purpose: :planner,
      execution_mode: :event_stream,
      status: :initialized,
      provider_id: "deterministic",
      model: "model",
      owner_refs: Map.merge(scope, %{goal_version: 1, runtime_admission: "agent_run"})
    }
  end

  defp progress(run, sequence, phase) do
    {:ok, event} =
      ProviderEvent.new(%{
        event_id: "#{run.provider_run_id}:#{sequence}",
        provider_run_ref: run.provider_run_id,
        sequence: sequence,
        event_type: :progress,
        visibility: :developer,
        summary: "observed local transport fact",
        payload: %{phase: phase},
        refs: [run.provider_call_ref]
      })

    event
  end
end
