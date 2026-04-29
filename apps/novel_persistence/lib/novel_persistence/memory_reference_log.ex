defmodule NovelPersistence.MemoryReferenceLog do
  @moduledoc """
  记忆引用日志持久化模块。

  每次记忆召回后异步写入引用记录，用于追溯"哪个场景因为什么原因引用了哪条记忆"。
  支持单条写入和批量写入，适合配合 Task.start/1 做 fire-and-forget。
  """

  import Ecto.Query, only: [from: 2]

  alias NovelPersistence.Repo

  @doc """
  写入单条引用记录。返回 {:ok, record} 或 {:error, changeset}。
  """
  @spec write(map()) :: {:ok, map()}
  def write(attrs) when is_map(attrs) do
    id = Map.get(attrs, :id, NovelFoundation.ID.uuid())
    now = DateTime.utc_now()

    db_record = %{
      id: to_bin(id),
      memory_id: to_bin(attrs.memory_id),
      work_id: to_bin(attrs.work_id),
      task_id: to_bin(Map.get(attrs, :task_id)),
      conversation_id: to_bin(Map.get(attrs, :conversation_id)),
      reference_scene: attrs.reference_scene,
      reference_reason: Map.get(attrs, :reference_reason),
      inserted_at: now
    }

    Repo.insert_all("memory_reference_logs", [db_record],
      on_conflict: :nothing,
      returning: false
    )

    {:ok,
     %{
       id: id,
       memory_id: attrs.memory_id,
       work_id: attrs.work_id,
       task_id: Map.get(attrs, :task_id),
       conversation_id: Map.get(attrs, :conversation_id),
       reference_scene: attrs.reference_scene,
       reference_reason: Map.get(attrs, :reference_reason),
       inserted_at: now
     }}
  end

  @doc """
  批量写入引用记录。适合一次性记录多个记忆的引用。
  """
  @spec batch_write([map()]) :: {:ok, non_neg_integer()}
  def batch_write(entries) when is_list(entries) do
    now = DateTime.utc_now()

    records =
      Enum.map(entries, fn attrs ->
        %{
          id: to_bin(Map.get(attrs, :id, NovelFoundation.ID.uuid())),
          memory_id: to_bin(attrs.memory_id),
          work_id: to_bin(attrs.work_id),
          task_id: to_bin(Map.get(attrs, :task_id)),
          conversation_id: to_bin(Map.get(attrs, :conversation_id)),
          reference_scene: attrs.reference_scene,
          reference_reason: Map.get(attrs, :reference_reason),
          inserted_at: now
        }
      end)

    {count, _} = Repo.insert_all("memory_reference_logs", records, on_conflict: :nothing)
    {:ok, count}
  end

  @doc """
  查询某个记忆的所有引用记录，按时间倒序。
  """
  @spec by_memory(String.t()) :: [map()]
  def by_memory(memory_id) when is_binary(memory_id) do
    from(ml in "memory_reference_logs",
      where: ml.memory_id == ^to_bin(memory_id),
      order_by: [desc: ml.inserted_at],
      select: %{id: ml.id, memory_id: ml.memory_id, work_id: ml.work_id, task_id: ml.task_id,
                conversation_id: ml.conversation_id, reference_scene: ml.reference_scene,
                reference_reason: ml.reference_reason, inserted_at: ml.inserted_at}
    )
    |> Repo.all()
  end

  @doc """
  查询某个作品在指定场景的所有引用记录。
  """
  @spec by_scene(String.t(), String.t()) :: [map()]
  def by_scene(work_id, reference_scene) do
    from(ml in "memory_reference_logs",
      where: ml.work_id == ^to_bin(work_id) and ml.reference_scene == ^reference_scene,
      order_by: [desc: ml.inserted_at],
      select: %{id: ml.id, memory_id: ml.memory_id, work_id: ml.work_id, task_id: ml.task_id,
                conversation_id: ml.conversation_id, reference_scene: ml.reference_scene,
                reference_reason: ml.reference_reason, inserted_at: ml.inserted_at}
    )
    |> Repo.all()
  end

  defp to_bin(nil), do: nil
  defp to_bin(uuid) when is_binary(uuid), do: Ecto.UUID.dump!(uuid)

end
