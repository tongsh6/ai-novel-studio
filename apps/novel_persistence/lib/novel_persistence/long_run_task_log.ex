defmodule NovelPersistence.LongRunTaskLog do
  @moduledoc """
  LongRunTask Log — warm tier 持久化。

  将 long-run task 写入 DB，支持按 workspace / task_id 检索和状态更新。
  与 NovelAgent.LongRunner（ETS hot tier）配合使用：ETS 负责低延迟读写，
  DB 负责重启后恢复。
  """

  import Ecto.Query, only: [where: 3, order_by: 3, limit: 2]

  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.LongRunTask

  @doc "写入新的 long-run task 记录。"
  @spec create(map()) :: {:ok, LongRunTask.t()} | {:error, Ecto.Changeset.t()}
  def create(attrs) when is_map(attrs) do
    %LongRunTask{}
    |> LongRunTask.changeset(attrs)
    |> Repo.insert()
  end

  @doc "更新 task 的 status / phase / checkpoint_data。"
  @spec update(LongRunTask.t(), map()) :: {:ok, LongRunTask.t()} | {:error, Ecto.Changeset.t()}
  def update(%LongRunTask{} = task, attrs) when is_map(attrs) do
    task
    |> LongRunTask.changeset(attrs)
    |> Repo.update()
  end

  @doc "Mark task as checkpoint in DB."
  @spec checkpoint(LongRunTask.t(), map()) :: {:ok, LongRunTask.t()} | {:error, Ecto.Changeset.t()}
  def checkpoint(%LongRunTask{} = task, data) do
    task
    |> LongRunTask.checkpoint_changeset(data)
    |> Repo.update()
  end

  @doc "Mark task as completed in DB."
  @spec complete(LongRunTask.t()) :: {:ok, LongRunTask.t()} | {:error, Ecto.Changeset.t()}
  def complete(%LongRunTask{} = task) do
    task
    |> LongRunTask.complete_changeset()
    |> Repo.update()
  end

  @doc "Mark task as resumed in DB."
  @spec resume(LongRunTask.t()) :: {:ok, LongRunTask.t()} | {:error, Ecto.Changeset.t()}
  def resume(%LongRunTask{} = task) do
    task
    |> LongRunTask.resume_changeset()
    |> Repo.update()
  end

  @doc "Get task by binary_id."
  @spec get(String.t()) :: LongRunTask.t() | nil
  def get(id) do
    Repo.get(LongRunTask, id)
  end

  @doc "List active (non-terminal) tasks for a workspace."
  @spec list_active(String.t()) :: [LongRunTask.t()]
  def list_active(workspace_id) do
    LongRunTask
    |> where([t], t.workspace_id == ^workspace_id)
    |> where(
      [t],
      t.status not in ~w(DONE CANCELLED ERROR)
    )
    |> order_by([t], desc: t.inserted_at)
    |> Repo.all()
  end

  @doc "查询 workspace 下最近 N 个 task。"
  @spec recent(String.t(), pos_integer()) :: [LongRunTask.t()]
  def recent(workspace_id, n \\ 20) do
    LongRunTask
    |> where([t], t.workspace_id == ^workspace_id)
    |> order_by([t], desc: t.inserted_at)
    |> limit(^n)
    |> Repo.all()
  end
end
