defmodule NovelApplication.AuthorActionDecision do
  @moduledoc """
  作者决定的纯结果装配（VS-00L §16.14）。

  确认/拒绝在受理事务内先形成作者已决定的子 TurnResult 与 DecisionTrace：
  确认的 `resolved`/拒绝的 `cancelled` 只表示作者已回答，不表示工具或目标成功。
  该模块不访问持久层、不执行 Provider，也不推断未提交的运行事实。
  """

  alias NovelDomain.{BehaviorState, DecisionTrace}

  @type kind :: :confirm | :reject

  @spec turn_id(String.t(), String.t()) :: String.t()
  def turn_id(source_turn_ref, receipt_id),
    do: "#{source_turn_ref}:author_action:#{receipt_id}"

  @spec build(kind(), map()) :: %{turn_result: map(), decision_trace: DecisionTrace.t()}
  def build(kind, ctx) when kind in [:confirm, :reject] and is_map(ctx) do
    turn_id = turn_id(ctx.action_input.source_turn_ref, ctx.receipt_id)
    behavior = closure_behavior(kind, turn_id, ctx)
    closure = BehaviorState.snapshot(behavior)
    trace_ref = "trace:#{turn_id}"
    trace_summary = trace_summary(kind, turn_id, trace_ref, ctx, closure)

    turn_result = %{
      schema_version: "3.0-draft",
      turn_id: turn_id,
      parent_turn_id: ctx.action_input.source_turn_ref,
      source_turn_ref: ctx.action_input.source_turn_ref,
      frame_ref: "frame_#{turn_id}",
      assistant_message: %{text: assistant_message(kind, ctx)},
      ui_cards: [],
      frame_summary: %{
        frame_type: :confirmation_answer,
        dialogue_goal: "处理作者已确认或取消的动作"
      },
      trace_summary: trace_summary,
      phase: phase(kind),
      status: status(kind),
      available_actions: [],
      behavior_state: closure,
      projection_refs: [],
      truthfulness: truthfulness(kind)
    }

    %{
      turn_result: turn_result,
      decision_trace: decision_trace(kind, turn_id, trace_ref, ctx, closure)
    }
  end

  defp closure_behavior(kind, turn_id, ctx) do
    active = ctx.behavior || %{}
    lifecycle = if kind == :confirm, do: :resolved, else: :cancelled
    status = Atom.to_string(lifecycle)

    %BehaviorState{
      behavior_id: field(active, :behavior_id),
      behavior_type: behavior_type(field(active, :behavior_type)),
      lifecycle_status: lifecycle,
      blocking_actor: :author,
      opened_at_turn_ref: field(active, :opened_at_turn_ref) || ctx.action_input.source_turn_ref,
      opened_by_decision_ref:
        field(active, :opened_by_decision_ref) || "decision:#{ctx.action_input.source_turn_ref}",
      frame_ref: field(active, :frame_ref) || "frame:#{ctx.action_input.source_turn_ref}",
      plan_ref: field(active, :plan_ref) || plan_ref(ctx.source_turn_result),
      target_ref: ctx.action_input.target_ref || field(active, :target_ref),
      required_next_action: field(active, :required_next_action) || ctx.action_input.action_type,
      available_actions: [],
      prompt_contract: field(active, :prompt_contract) || %{},
      constraints: field(active, :constraints) || %{},
      resolution: %{
        ref: "behavior_resolution:#{turn_id}",
        status: status,
        action_id: ctx.action_input.action_id,
        action_type: ctx.action_input.action_type,
        source_turn_ref: ctx.action_input.source_turn_ref,
        idempotency_key: ctx.action_input.idempotency_key
      },
      closed_at_turn_ref: turn_id,
      trace_ref: "trace:#{turn_id}"
    }
  end

  defp trace_summary(kind, turn_id, trace_ref, ctx, closure) do
    %{
      trace_ref: trace_ref,
      decision_type: decision_type(kind),
      reason_codes: reason_codes(kind),
      source_turn_ref: ctx.action_input.source_turn_ref,
      author_turn_ref: ctx.author_turn_ref,
      behavior_ref: field(ctx.behavior, :behavior_id),
      target_ref: ctx.action_input.target_ref,
      behavior_trace_refs: behavior_trace_refs(closure),
      no_tool_reason: "author_action_decision_does_not_call_tool",
      no_behavior_reason: "author action closed waiting behavior",
      no_write_reason: "author action decision does not perform production write",
      replay_policy: %{use_recorded_frame: true, recall_provider: false},
      event_order: event_order(kind, closure)
    }
    |> Map.put(:turn_ref, turn_id)
  end

  defp behavior_trace_refs(%{history: [history | _]}) when is_map(history) do
    [
      %{
        trace_status: :summary_level,
        behavior_ref: history[:behavior_id],
        behavior_type: history[:behavior_type],
        event_type: :close,
        event_turn_ref: history[:closed_at_turn_ref],
        decision_ref: history[:opened_by_decision_ref],
        target_ref: history[:target_ref],
        next_status: history[:status],
        required_next_action: history[:required_next_action],
        resolution_ref: history[:resolution_ref],
        trace_ref: history[:trace_ref]
      }
      |> reject_blank_values()
    ]
  end

  defp behavior_trace_refs(_closure), do: []

  defp event_order(kind, %{history: [_ | _]}) do
    [
      :author_action_received,
      :behavior_close_requested,
      :behavior_trace_recorded,
      :behavior_resolution_recorded,
      :turn_result_emitted,
      :"author_action_#{kind}_recorded"
    ]
  end

  defp event_order(kind, _closure) do
    [:author_action_received, :turn_result_emitted, :"author_action_#{kind}_recorded"]
  end

  defp decision_trace(kind, turn_id, trace_ref, ctx, closure) do
    %DecisionTrace{
      trace_id: trace_ref,
      turn_id: turn_id,
      frame_ref: "frame_#{turn_id}",
      plan_ref: plan_ref(ctx.source_turn_result),
      decision_type: String.to_atom(decision_type(kind)),
      no_tool_reason: "author_action_decision_does_not_call_tool",
      no_behavior_reason: "author action closed waiting behavior",
      no_write_reason: "author action decision does not perform production write",
      turn_result_ref: turn_id,
      replay_policy: %{use_recorded_frame: true, recall_provider: false},
      redaction_level: :author_safe,
      behavior_trace_refs: behavior_trace_refs(closure),
      event_order: event_order(kind, closure)
    }
  end

  defp assistant_message(:confirm, ctx) do
    "已确认「#{target_label(ctx.action_input.target_ref)}」操作，正在作为新的作者动作运行处理；" <>
      "确认本身不表示工具或目标已经成功。"
  end

  defp assistant_message(:reject, ctx) do
    "已取消等待；「#{target_label(ctx.action_input.target_ref)}」不会执行，也没有写入作品事实。"
  end

  defp target_label(target_ref) when is_binary(target_ref) and target_ref != "", do: target_ref
  defp target_label(_target_ref), do: "待处理动作"

  defp status(:confirm), do: "conversational"
  defp status(:reject), do: "cancelled"

  defp phase(:confirm), do: "dialogue"
  defp phase(:reject), do: "cancelled"

  defp decision_type(:confirm), do: "author_confirmed_action"
  defp decision_type(:reject), do: "cancel_waiting"

  defp reason_codes(:confirm), do: ["author_confirmed_action"]
  defp reason_codes(:reject), do: ["author_cancelled_waiting_behavior"]

  defp truthfulness(:confirm) do
    %{
      tool_called: false,
      artifact_adopted: false,
      production_write_performed: false,
      state_persisted: false,
      durable_behavior_opened: false,
      decision_type: :author_confirmed_action,
      reason_codes: ["author_confirmed_action"]
    }
  end

  defp truthfulness(:reject) do
    %{
      tool_called: false,
      artifact_adopted: false,
      production_write_performed: false,
      state_persisted: false,
      durable_behavior_opened: false,
      decision_type: :cancel_waiting,
      reason_codes: ["author_cancelled_waiting_behavior"]
    }
  end

  defp behavior_type(value) when value in [:clarification, :confirmation, :recovery], do: value
  defp behavior_type("clarification"), do: :clarification
  defp behavior_type("recovery"), do: :recovery
  defp behavior_type(_value), do: :confirmation

  defp plan_ref(source_turn_result) do
    source_turn_result
    |> field(:plan)
    |> field(:plan_id)
  end

  defp reject_blank_values(map) when is_map(map),
    do: Map.reject(map, fn {_key, value} -> is_nil(value) or value == "" end)

  defp field(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, Atom.to_string(key))
  end

  defp field(_map, _key), do: nil
end
