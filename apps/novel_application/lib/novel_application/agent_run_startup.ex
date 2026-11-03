defmodule NovelApplication.AgentRunStartup do
  @moduledoc """
  一次运行的启动事实唯一构造点。

  启动事实只在这里构造一次：初始 run、`run_started` 事件、事件游标与空
  stage_state 作为同一份数据单元交给持久化/执行 owner。普通启动、作者动作
  受理与已提交的确认子 run 共用该工厂，不再各自生成启动事件或从零开始游标。

  契约见 B71 / `docs/design/contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md`
  §16.14「非采纳工具确认的运行交接」。
  """

  alias NovelCommon.Contracts.AgentEvent
  alias NovelDomain.AgentRun

  @type t :: %{
          required(:run) => AgentRun.t(),
          required(:events) => [AgentEvent.t()],
          required(:event_sequence) => pos_integer(),
          required(:stage_state) => map()
        }

  @spec new(AgentRun.t()) :: t()
  def new(%AgentRun{} = run) do
    event = run_started_event(run)
    %{run: run, events: [event], event_sequence: event.sequence, stage_state: %{}}
  end

  defp run_started_event(run) do
    {:ok, event} =
      AgentEvent.new(%{
        event_id: "evt_#{run.run_id}_1",
        run_ref: run.run_id,
        step_ref: run.current_step_ref,
        sequence: 1,
        event_type: :run_started,
        visibility: :author,
        summary: "AgentRun 已启动。",
        reason_codes: ["agent_run_started", "profile_selected"],
        refs: [],
        payload: run_started_payload(run),
        emitted_at: DateTime.utc_now()
      })

    event
  end

  defp run_started_payload(%AgentRun{} = run) do
    authority_scope = run.authority_scope || %{}

    %{
      profile_ref: run.profile_ref,
      trigger: run.trigger || %{},
      allowed_tools: Map.get(authority_scope, :allowed_tools, []),
      profile_selection:
        Map.get(authority_scope, :profile_selection) ||
          Map.get(authority_scope, "profile_selection") || %{}
    }
  end
end
