defmodule NovelApplication.TestTranscriptCompaction do
  @moduledoc """
  讨论摘要测试的 Provider 执行环境：共享注册、Sandbox 与退出恢复。
  只提供运行依赖，不实现摘要、选择、维护或持久判定。
  """
  import ExUnit.Callbacks, only: [on_exit: 1]
  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution
  alias NovelDomain.AgentRun
  alias NovelPersistence.Repo

  defmodule CaptureProvider do
    @behaviour NovelAgent.Provider
    defstruct []

    @impl true
    def execute(_state, _model, ir, params, ctx),
      do:
        Application.fetch_env!(:novel_application, :compaction_summary_test_provider).(
          ir,
          params,
          ctx
        )

    @impl true
    def health_check(_state), do: :ok
    @impl true
    def name, do: "compaction_summary_test"
    @impl true
    def projection_target(_state), do: "chat_completions"
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
  end

  def setup do
    :ok = Sandbox.checkout(Repo)
    Sandbox.mode(Repo, {:shared, self()})
    extra = Application.get_env(:novel_agent, :extra_providers)
    callback = Application.get_env(:novel_application, :compaction_summary_test_provider)
    maintenance = Application.get_env(:novel_application, :auto_maintenance)
    Application.put_env(:novel_application, :auto_maintenance, %{enabled: false})

    Application.put_env(
      :novel_agent,
      :extra_providers,
      Map.put(Map.new(extra || []), :compaction_summary_test, CaptureProvider)
    )

    on_exit(fn ->
      restore_env(:novel_agent, :extra_providers, extra)
      restore_env(:novel_application, :compaction_summary_test_provider, callback)
      restore_env(:novel_application, :auto_maintenance, maintenance)
    end)

    {:ok, run} =
      AgentRun.new(%{
        run_id: "run-summary",
        workspace_id: "ws-summary",
        work_id: "work-summary",
        session_id: "session-summary",
        parent_turn_ref: "turn-current",
        origin_frame_ref: "frame-summary",
        profile_ref: "conversation_turn_v1",
        goal: %{text: "讨论动机", version: 1},
        authority_scope: %{production_write: false, allowed_tools: ["read_character"]},
        status: :running
      })

    {:ok, token} = Execution.start_cancellation_token(%{run_id: run.run_id})
    parent = self()

    snapshot = %{
      run: run,
      provider_cancellation_token: token,
      stage_sink: fn event -> send(parent, {:summary_stage, event}) end
    }

    %{
      run: run,
      snapshot: snapshot,
      dependency:
        Execution.dependency(
          provider: :compaction_summary_test,
          model: "summary-model",
          purpose: :conversation
        )
    }
  end

  defp restore_env(app, key, nil), do: Application.delete_env(app, key)
  defp restore_env(app, key, value), do: Application.put_env(app, key, value)
end
