defmodule NovelCommon.LogContext do
  require Logger

  @moduledoc """
  Logger metadata injection & cross-process transfer protocol.

  ADR-0018 §2: LogContext is the single entry point for every process that
  needs to attach workspace / turn / frame / behavior / decision / tool keys
  to Elixir's `Logger.metadata`.  Keys set here are read by `LogEmit.emit/4`
  and `LLMLog.record/5` to produce the shared correlation token set.
  """

  @doc """
  Entry-point call — set workspace & work correlation keys (before Planner
  produces a turn_id).  Called once at the top of `DialogueGateway.handle_input`
  and again at `WorkspaceChannel.handle_in("user_message", …)`.

  The gateway should pass an already allocated `turn_id` so every downstream
  business log line can share the same correlation key from the first event.
  """
  @spec put_turn(String.t(), String.t() | nil, String.t() | nil) :: :ok
  def put_turn(workspace_id, work_id \\ nil, turn_id \\ nil) do
    Logger.metadata(workspace_id: workspace_id)
    if work_id, do: Logger.metadata(work_id: work_id)

    # Clear previous turn's local keys so the new turn starts with a
    # clean correlation slate. workspace_id + work_id persist; turn_id is set
    # when the gateway has already allocated one.
    Logger.metadata(
      turn_id: turn_id,
      frame_id: nil,
      behavior_id: nil,
      decision_id: nil,
      tool_request_id: nil
    )

    :ok
  end

  @doc "Set `frame_id` after Planner returns a DialogueFrame."
  @spec put_frame(String.t()) :: :ok
  def put_frame(frame_id) do
    Logger.metadata(frame_id: frame_id)
  end

  @doc "Set `behavior_id` after a durable BehaviorState is opened."
  @spec put_behavior(String.t() | nil) :: :ok
  def put_behavior(nil), do: :ok

  def put_behavior(behavior_id) do
    Logger.metadata(behavior_id: behavior_id)
  end

  @doc "Set `decision_id` after Orchestrator issues a decision."
  @spec put_decision(String.t()) :: :ok
  def put_decision(decision_id) do
    Logger.metadata(decision_id: decision_id)
  end

  @doc "Set `tool_request_id` before Toolbox dispatch."
  @spec put_tool_request(String.t()) :: :ok
  def put_tool_request(tool_request_id) do
    Logger.metadata(tool_request_id: tool_request_id)
  end

  @doc """
  Snapshot current metadata into a kw list that can be `restore/1`d in a
  plain `spawn`-ed process (not `Task` — Elixir Task already inherits parent
  metadata automatically since OTP 25).  Use only for `Kernel.spawn/1` or
  `GenServer.start_link` where the new process does NOT share the caller's
  process dictionary.
  """
  @spec snapshot() :: keyword()
  def snapshot do
    Logger.metadata()
  end

  @doc "Restore a snapshot from `snapshot/0` in the target process."
  @spec restore(keyword()) :: :ok
  def restore(kw) when is_list(kw) do
    Logger.reset_metadata([])
    Logger.metadata(kw)
    :ok
  end
end
