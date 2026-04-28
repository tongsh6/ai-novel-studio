defmodule NovelPersistence.Repo.Migrations.AddLongRunTaskFields do
  @moduledoc """
  补齐 06-planning-and-long-run.md §5 要求的 17 个字段：

  - scope_ref / created_by / parent_turn_ref / parent_task_ref — 作用域与来源
  - plan_ref / checkpoint_policy_ref — 计划与 checkpoint 策略引用
  - estimated_budget / consumed_budget — 预算 map
  - authority_scope — 权限范围
  - current_unit_ref / completed_unit_refs — unit 追踪
  - pending_artifact_refs / accepted_artifact_refs — artifact 追踪
  - warning_refs / failure_ref / resume_ref / branch_parent_ref — 风险与恢复
  """

  use Ecto.Migration

  def change do
    alter table(:long_run_tasks) do
      add :scope_ref, :string
      add :created_by, :string
      add :parent_turn_ref, :string
      add :parent_task_ref, :string
      add :plan_ref, :string
      add :estimated_budget, :map
      add :consumed_budget, :map
      add :checkpoint_policy_ref, :string
      add :authority_scope, :string
      add :current_unit_ref, :string
      add :completed_unit_refs, {:array, :string}, default: []
      add :pending_artifact_refs, {:array, :string}, default: []
      add :accepted_artifact_refs, {:array, :string}, default: []
      add :warning_refs, {:array, :string}, default: []
      add :failure_ref, :string
      add :resume_ref, :string
      add :branch_parent_ref, :string
    end

    create index(:long_run_tasks, [:scope_ref])
    create index(:long_run_tasks, [:parent_turn_ref])
  end
end
