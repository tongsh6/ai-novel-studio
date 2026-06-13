defmodule NovelFoundation.PhaseNextActionCompat do
  @moduledoc """
  ADR-0002 §7 兼容矩阵的可执行投影。

  矩阵 SSOT：`docs/design/schemas/foundation/phase_next_action_compat.json`，
  本模块在编译期读取以保证两者永远同步（`@external_resource` 触发文件变更重编）。

  ## 用法

      # turn phase
      Compat.allowed?(:turn, "COMPLETED", "ADOPT_ARTIFACTS")  # => true
      Compat.allowed?(:turn, "COMPLETED", "ASK_USER")         # => false

      # task context
      Compat.allowed?(:task, "CHECKPOINT", "RESUME_TASK")     # => true

      # 未列入矩阵的 phase（如 turn:RECEIVED / turn:ROUTED）无 next_action
      # canonical 投影。Validator 应单独处理 transient phase。
  """

  @schema_path "docs/design/schemas/foundation/phase_next_action_compat.json"
  @external_resource Path.expand("../../../../#{@schema_path}", __DIR__)

  @raw @external_resource |> File.read!() |> Jason.decode!()
  @matrix Map.fetch!(@raw, "matrix")
  @rules Map.fetch!(@raw, "rules")

  @doc ~S(返回原始矩阵（key 形如 "turn:<phase>" / "task:<phase>"）。)
  @spec matrix() :: map()
  def matrix, do: @matrix

  @doc "返回 §7 规则集合。"
  @spec rules() :: map()
  def rules, do: @rules

  @doc """
  当前 phase 是否允许使用 next_action。

  对**未列入矩阵**的 (kind, phase)（例如 turn:RECEIVED），返回 `:not_constrained`，
  调用方决定是否有特殊规则。
  """
  @spec allowed?(:turn | :task, String.t(), String.t()) ::
          boolean() | :not_constrained
  def allowed?(kind, phase, next_action) when kind in [:turn, :task] do
    case Map.get(@matrix, "#{kind}:#{phase}") do
      nil -> :not_constrained
      %{"allowed" => allowed} -> next_action in allowed
    end
  end

  @doc "ADR-0002 §7 规则 3：behavior_state.active 非空时合法的 next_action 集合。"
  @spec allowed_when_behavior_active() :: [String.t()]
  def allowed_when_behavior_active do
    @rules
    |> Map.fetch!("behavior_active_requires_user_or_resolution")
    |> Map.fetch!("allowed_when_active")
  end
end
