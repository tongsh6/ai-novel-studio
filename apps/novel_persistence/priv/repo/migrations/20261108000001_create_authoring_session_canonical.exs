defmodule NovelPersistence.Repo.Migrations.CreateAuthoringSessionCanonical do
  use Ecto.Migration

  # ADR-0035 / B81 CP1：canonical 创作历史的作用域从 run 提升到会话。
  #
  # - `authoring_session_messages`：会话 canonical 消息流（append-only）。每条消息是
  #   已发生的运行事实，按会话内 `sequence` 唯一排序，按 `run_id + run_sequence`
  #   归因到执行段。会话身份复用既有 `work_sessions`（`session_id` 引用其 id）。
  # - `authoring_run_segments`：run 执行段头。只承载该执行段的派生配置与 refs 快照
  #   （run/system/tools/projection/base_refs/observation_refs/used_refs），不承载
  #   canonical 消息；消息永远是唯一历史。
  #
  # 项目未发布：不迁移旧 `agent_runs.authoring_transcript` 数据（该 run 级私有列随本迁移前的
  # 历史迁移一并退役：项目未发布，不保留“先加列再删列”的迁移往返）。
  def change do
    create table(:authoring_session_messages, primary_key: false) do
      add(:id, :binary_id, primary_key: true)
      add(:workspace_id, :string, null: false)
      add(:work_id, :string, null: false)
      add(:session_id, :string, null: false)
      add(:run_id, :string, null: false)
      add(:sequence, :integer, null: false)
      add(:run_sequence, :integer, null: false)
      add(:role, :string, null: false)
      add(:message, :map, null: false)
      add(:format_version, :string, null: false)
      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:authoring_session_messages, [:session_id, :sequence]))
    create(unique_index(:authoring_session_messages, [:run_id, :run_sequence]))
    create(index(:authoring_session_messages, [:session_id]))
    create(index(:authoring_session_messages, [:workspace_id, :work_id]))

    create table(:authoring_run_segments, primary_key: false) do
      add(:run_id, :string, primary_key: true)
      add(:workspace_id, :string, null: false)
      add(:work_id, :string, null: false)
      add(:session_id, :string, null: false)
      add(:parent_turn_ref, :string, null: false)
      add(:header, :map, null: false)
      add(:message_count, :integer, null: false, default: 0)
      add(:first_sequence, :integer)
      add(:last_sequence, :integer)
      add(:format_version, :string, null: false)
      timestamps(type: :utc_datetime_usec)
    end

    create(index(:authoring_run_segments, [:session_id]))
    create(index(:authoring_run_segments, [:workspace_id, :work_id]))
  end
end
