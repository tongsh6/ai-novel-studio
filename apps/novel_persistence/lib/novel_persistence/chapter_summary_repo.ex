defmodule NovelPersistence.ChapterSummaryRepo do
  @moduledoc """
  章摘要仓储（VS-00C CP2.1 / contract §5.2）。

  仅做持久化原语与查询；状态转换合法性由领域层 `NovelDomain.ChapterSummary`
  （复用 `NovelDomain.AdoptionStatus` 矩阵）保证，本模块不重复校验转换。
  """

  import Ecto.Query

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.ChapterSummary

  @doc "插入一条摘要（status 由 attrs 决定，通常 TENTATIVE）。"
  @spec insert(map()) :: {:ok, ChapterSummary.t()} | {:error, Ecto.Changeset.t()}
  def insert(attrs) when is_map(attrs) do
    %ChapterSummary{}
    |> ChapterSummary.changeset(attrs)
    |> Repo.insert()
  end

  @doc "更新一条摘要的状态（转换合法性已由领域层判定）。"
  @spec update_status(ChapterSummary.t(), String.t()) ::
          {:ok, ChapterSummary.t()} | {:error, Ecto.Changeset.t()}
  def update_status(%ChapterSummary{} = summary, status) when is_binary(status) do
    summary
    |> ChapterSummary.changeset(%{status: status})
    |> Repo.update()
  end

  @doc "把某章当前所有 ACCEPTED 摘要置为 SUPERSEDED；返回受影响行数。"
  @spec supersede_prior_accepted(String.t(), String.t()) :: {:ok, non_neg_integer()}
  def supersede_prior_accepted(work_id, chapter_id)
      when is_binary(work_id) and is_binary(chapter_id) do
    {count, _} =
      ChapterSummary
      |> where([c], c.work_id == ^work_id and c.chapter_id == ^chapter_id)
      |> where([c], c.status == ^AdoptionStatus.accepted())
      |> Repo.update_all(set: [status: AdoptionStatus.superseded(), updated_at: now()])

    {:ok, count}
  end

  @doc "某章当前 ACCEPTED 摘要（最近一条），无则 nil。"
  @spec current_accepted(String.t(), String.t()) :: ChapterSummary.t() | nil
  def current_accepted(work_id, chapter_id)
      when is_binary(work_id) and is_binary(chapter_id) do
    ChapterSummary
    |> where([c], c.work_id == ^work_id and c.chapter_id == ^chapter_id)
    |> where([c], c.status == ^AdoptionStatus.accepted())
    |> order_by([c], desc: c.inserted_at)
    |> limit(1)
    |> Repo.one()
  end

  @doc """
  D3 断供扫描：有 ACCEPTED 正文但无当前 ACCEPTED 摘要的章（按 seq 升序），
  返回 `[%{chapter_id, chapter_title, prose_text}]`（正文按场序拼接）。
  """
  def chapters_missing_summary(work_id) when is_binary(work_id) do
    case Ecto.UUID.cast(work_id) do
      {:ok, work_uuid} ->
        summarized =
          from(s in ChapterSummary,
            where: s.work_id == ^work_id and s.status == "ACCEPTED",
            select: s.chapter_id
          )
          |> Repo.all()
          |> MapSet.new()

        from(c in NovelPersistence.Schemas.Chapter,
          join: sc in NovelPersistence.Schemas.Scene,
          on: sc.chapter_id == c.id,
          join: d in NovelPersistence.Schemas.Draft,
          on: d.scene_id == sc.id and d.status == "ACCEPTED",
          where: c.work_id == ^work_uuid,
          order_by: [asc: c.seq, asc: sc.seq],
          select: {c.id, c.title, d.content}
        )
        |> Repo.all()
        |> Enum.group_by(fn {id, title, _} -> {to_string(id), title} end, fn {_, _, content} ->
          content
        end)
        |> Enum.reject(fn {{id, _title}, _} -> MapSet.member?(summarized, id) end)
        |> Enum.map(fn {{id, title}, contents} ->
          %{chapter_id: id, chapter_title: title, prose_text: Enum.join(contents, "\n")}
        end)

      :error ->
        []
    end
  end

  def chapters_missing_summary(_work_id), do: []

  @doc "作品维度最近 N 条 ACCEPTED 摘要（CP2.2 L3a 连续性层消费），按时间倒序。"
  @spec list_recent_accepted(String.t(), pos_integer()) :: [ChapterSummary.t()]
  def list_recent_accepted(work_id, limit) when is_binary(work_id) and is_integer(limit) do
    ChapterSummary
    |> where([c], c.work_id == ^work_id)
    |> where([c], c.status == ^AdoptionStatus.accepted())
    |> order_by([c], desc: c.inserted_at)
    |> limit(^limit)
    |> Repo.all()
  end

  defp now, do: DateTime.utc_now() |> DateTime.truncate(:microsecond)
end
