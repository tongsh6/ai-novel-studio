defmodule NovelApplication.AgentRunFlows.ToolConfirmationRun do
  @moduledoc """
  非采纳确认子 run 的启动规格唯一构造点（VS-00L §16.14）。

  纯构造：只把受理事务已核验的 source 事实转成 AgentRun 启动 attrs（profile、
  允许工具、真实预算、初始计划），不读库、不发请求、不决定 gate。

  从 `ToolConfirmation` flow 拆出，让超限模块只委托规格构造（模块规模规则
  `docs/coding-standards/03-module-boundaries.md` §3.2）；也让确认受理不必依赖
  通用规划编排模块（避免 application 层 compile 循环依赖）。
  """

  alias NovelDomain.AgentNextStepDecision

  @profile_ref "tool_confirmation_v1"
  @step_target "author_action_confirmation"
  @allowed_tools ~w(prose_writing plot_outline character_design character_evolution world_building text_analysis)
  @run_budget %{
    max_steps: 4,
    max_tool_calls: 1,
    max_provider_calls: 14,
    max_replans: 0,
    max_pending_artifacts: 3
  }

  @spec profile_ref() :: String.t()
  def profile_ref, do: @profile_ref

  @doc "非采纳确认子 run 的允许工具（本 profile 的唯一来源）。"
  @spec allowed_tools() :: [String.t()]
  def allowed_tools, do: @allowed_tools

  @doc "非采纳确认子 run 的真实预算（受理与 flow 消费同一份常量）。"
  @spec run_budget() :: map()
  def run_budget, do: @run_budget

  @doc "非采纳确认子 run 的初始计划：步骤留空，路由由 next_step_planner 决定。"
  @spec pending_plan(String.t()) :: map()
  def pending_plan(run_id) do
    %{plan_id: "ap_#{run_id}", run_ref: run_id, version: 1, goal_version: 1, steps: []}
  end

  @doc """
  构造非采纳确认子 run 的启动 attrs。

  调用方必须传入受理事务已核验的 source 事实（work/session/turn/trigger/text）；
  本函数不补齐、不推断缺失事实。
  """
  @spec run_attrs(map()) :: map()
  def run_attrs(input) when is_map(input) do
    run_id = NovelFoundation.ID.unique("run")
    turn_id = Map.get(input, :turn_id) || NovelFoundation.ID.unique("turn")

    %{
      run_id: run_id,
      run_mode: run_mode(input),
      workspace_id: Map.get(input, :workspace_id, "default"),
      work_id: Map.fetch!(input, :work_id),
      session_id: Map.fetch!(input, :session_id),
      parent_turn_ref: turn_id,
      origin_frame_ref: Map.fetch!(input, :origin_frame_ref),
      profile_ref: @profile_ref,
      trigger: Map.get(input, :trigger),
      plan: pending_plan(run_id),
      plan_ref: "ap_#{run_id}",
      plan_version: 1,
      goal: %{text: Map.fetch!(input, :text), version: 1},
      authority_scope: %{
        production_write: false,
        allowed_tools: @allowed_tools,
        profile_selection: %{
          profile_ref: @profile_ref,
          source: "application_profile",
          reason_codes: ["explicit_application_profile"],
          matched_terms: []
        }
      },
      budget: @run_budget
    }
  end

  @doc "确认子 run 第一步的执行决策（重新组装上下文并执行已确认动作）。"
  @spec execute_decision(map(), pos_integer()) :: map()
  def execute_decision(run, sequence) do
    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "and_#{run.run_id}_#{sequence}_tool_confirmation",
        run_ref: run.run_id,
        sequence: sequence,
        decision_type: :execute_step,
        summary: "重新组装当前上下文并执行作者已确认的动作。",
        target_tool_ref: @step_target,
        write_intent: :tentative,
        risk_hint: :medium,
        reason_codes: ["author_confirmed_action", "current_context_regate"],
        observation_refs: [],
        evaluation_of_last: %{advanced: true, plan_holds: true, new_constraint: nil},
        confidence: 1.0
      })

    decision
  end

  @doc "确认子 run 收尾决策（作者确认的动作已处理）。"
  @spec complete_decision(map(), pos_integer()) :: map()
  def complete_decision(run, sequence) do
    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "and_#{run.run_id}_#{sequence}_tool_confirmation_done",
        run_ref: run.run_id,
        sequence: sequence,
        decision_type: :goal_satisfied,
        summary: "作者确认的动作已处理。",
        target_tool_ref: nil,
        write_intent: :none,
        risk_hint: :low,
        reason_codes: ["author_action_processed"],
        observation_refs: [],
        evaluation_of_last: %{advanced: true, plan_holds: true, new_constraint: nil},
        confidence: 1.0
      })

    decision
  end

  defp run_mode(input) do
    case Map.get(input, :run_mode) do
      mode when mode in [:durable, "durable"] -> :durable
      _other -> :bounded
    end
  end
end
