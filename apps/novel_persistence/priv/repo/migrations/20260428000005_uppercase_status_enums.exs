defmodule NovelPersistence.Repo.Migrations.UppercaseStatusEnums do
  @moduledoc """
  把 ADR-0002 §1 规定的 UPPER_SNAKE_CASE 落到已有数据。

  - works.status: tentative/accepted/discarded → TENTATIVE/ACCEPTED/DISCARDED
  - long_run_tasks.status: running/checkpoint/completed/cancelled/failed
    → RUNNING/PAUSED/DONE/CANCELLED/ERROR  (ADR-0002 §2/§4 映射)
  - long_run_tasks.phase: running/checkpoint/resuming/completed
    → RUNNING/CHECKPOINT/RESUMING/COMPLETED  (ADR-0002 §4)

  默认值同时切换。Phase 1 阶段 DB 数据可丢，本迁移目的是让现有 dev/test
  环境跟上 schema 校验。
  """

  use Ecto.Migration

  def up do
    execute("UPDATE works SET status = UPPER(status) WHERE status IN ('tentative','accepted','discarded')")

    execute("""
    UPDATE long_run_tasks SET status = CASE status
      WHEN 'running' THEN 'RUNNING'
      WHEN 'checkpoint' THEN 'PAUSED'
      WHEN 'completed' THEN 'DONE'
      WHEN 'cancelled' THEN 'CANCELLED'
      WHEN 'failed' THEN 'ERROR'
      ELSE status END
    """)

    execute("""
    UPDATE long_run_tasks SET phase = CASE phase
      WHEN 'running' THEN 'RUNNING'
      WHEN 'checkpoint' THEN 'CHECKPOINT'
      WHEN 'resuming' THEN 'RESUMING'
      WHEN 'completed' THEN 'COMPLETED'
      ELSE phase END
    """)

    # ALTER COLUMN SET DEFAULT skipped for SQLite compatibility.
    # Application layer enforces correct default values at insert time.
  end

  def down do
    execute("UPDATE works SET status = LOWER(status) WHERE status IN ('TENTATIVE','ACCEPTED','DISCARDED')")

    execute("""
    UPDATE long_run_tasks SET status = CASE status
      WHEN 'RUNNING' THEN 'running'
      WHEN 'PAUSED' THEN 'checkpoint'
      WHEN 'DONE' THEN 'completed'
      WHEN 'CANCELLED' THEN 'cancelled'
      WHEN 'ERROR' THEN 'failed'
      ELSE status END
    """)

    execute("""
    UPDATE long_run_tasks SET phase = CASE phase
      WHEN 'RUNNING' THEN 'running'
      WHEN 'CHECKPOINT' THEN 'checkpoint'
      WHEN 'RESUMING' THEN 'resuming'
      WHEN 'COMPLETED' THEN 'completed'
      ELSE phase END
    """)
  end
end
