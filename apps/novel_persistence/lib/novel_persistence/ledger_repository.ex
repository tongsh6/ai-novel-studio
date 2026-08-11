defmodule NovelPersistence.LedgerRepository do
  @moduledoc """
  五本账仓储（VS-00F §2 / ADR-0026）。

  权威账面的读写口：读取给探索面/写作投影/维护；写入只服务维护自动通过
  （系统发起的 TENTATIVE→ACCEPTED，I-L2）与后续裁决路径。upsert 以
  (work_id, ledger, subject_ref) 幂等定位。
  """

  import Ecto.Query

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.Enums.StructureStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Chapter
  alias NovelPersistence.Schemas.LedgerEntry
  alias NovelPersistence.Schemas.Volume

  @accepted [AdoptionStatus.accepted(), AdoptionStatus.edited_accepted()]

  @doc "作品的（默认弧光）账面条目，采纳态限已接受。"
  @spec list(String.t(), String.t()) :: [map()]
  def list(work_id, ledger \\ "arc") when is_binary(work_id) and is_binary(ledger) do
    with_work_uuid(work_id, [], fn ->
      LedgerEntry
      |> where([e], e.work_id == ^work_id and e.ledger == ^ledger)
      |> where([e], e.adoption_status in ^@accepted)
      |> order_by([e], asc: e.subject_label)
      |> Repo.all()
      |> Enum.map(&to_map/1)
    end)
  end

  @doc "作品全部账面条目（五账通查，CP2a：维护与档案面消费）。"
  @spec list_all(String.t()) :: [map()]
  def list_all(work_id) when is_binary(work_id) do
    with_work_uuid(work_id, [], fn ->
      LedgerEntry
      |> where([e], e.work_id == ^work_id)
      |> where([e], e.adoption_status in ^@accepted)
      |> order_by([e], asc: e.ledger, asc: e.subject_label)
      |> Repo.all()
      |> Enum.map(&to_map/1)
    end)
  end

  # 占位 work id（如 "lobby"）不触库诚实空返回——与 WorkArchiveRepo.with_uuid 同惯例。
  defp with_work_uuid(work_id, fallback, fun) do
    case Ecto.UUID.cast(work_id) do
      {:ok, _} -> fun.()
      :error -> fallback
    end
  end

  @doc """
  按 (work_id, ledger, subject_ref) 幂等写入账面（维护自动通过通道，I-L2 /
  ADR-0019 INV-1）：先落/更新 TENTATIVE 行，再由系统发起接受到 ACCEPTED——
  进入 ACCEPTED 只能来自 TENTATIVE，与章摘要维护先例同型仪式，不绕道直写。
  """
  @spec upsert(map()) :: {:ok, map()} | {:error, term()}
  def upsert(attrs) when is_map(attrs) do
    tentative_attrs = Map.put(attrs, :adoption_status, AdoptionStatus.tentative())

    existing =
      Repo.one(
        from(e in LedgerEntry,
          where:
            e.work_id == ^attrs.work_id and e.ledger == ^attrs.ledger and
              e.subject_ref == ^attrs.subject_ref
        )
      )

    tentative_result =
      case existing do
        nil -> %LedgerEntry{} |> LedgerEntry.changeset(tentative_attrs) |> Repo.insert()
        entry -> entry |> LedgerEntry.changeset(tentative_attrs) |> Repo.update()
      end

    with {:ok, tentative} <- tentative_result,
         {:ok, accepted} <-
           tentative
           |> LedgerEntry.changeset(%{adoption_status: AdoptionStatus.accepted()})
           |> Repo.update() do
      {:ok, to_map(accepted)}
    else
      {:error, changeset} -> {:error, changeset}
    end
  end

  @doc """
  机械进度口径（VS00F 刀④ R9）：最大非计划章 seq 及其所在卷 seq；
  无已写章为 0/0（与伏笔建账的 planted_at_seq 同口径）。
  """
  @spec written_progress(String.t()) :: %{chapter_seq: non_neg_integer(), volume_seq: non_neg_integer()}
  def written_progress(work_id) when is_binary(work_id) do
    case Ecto.UUID.cast(work_id) do
      {:ok, uuid} ->
        planned = StructureStatus.planned()

        Chapter
        |> join(:inner, [c], v in Volume, on: c.volume_id == v.id)
        |> where([c], c.work_id == ^uuid and c.status != ^planned)
        |> order_by([c], desc: c.seq)
        |> limit(1)
        |> select([c, v], %{chapter_seq: c.seq, volume_seq: v.seq})
        |> Repo.one()
        |> Kernel.||(%{chapter_seq: 0, volume_seq: 0})

      :error ->
        %{chapter_seq: 0, volume_seq: 0}
    end
  end

  @doc "已接受章摘要按章序：[{seq, summary_text}]，供对账规则（R3 身份锚点）消费。"
  @spec accepted_summaries_by_seq(String.t()) :: [{non_neg_integer(), String.t()}]
  def accepted_summaries_by_seq(work_id) when is_binary(work_id) do
    case Ecto.UUID.cast(work_id) do
      {:ok, uuid} ->
        from(s in NovelPersistence.Schemas.ChapterSummary,
          join: c in Chapter,
          on: fragment("?", c.id) == fragment("?", s.chapter_id),
          where: s.work_id == ^work_id and c.work_id == ^uuid,
          where: s.status in ^@accepted,
          order_by: [asc: c.seq],
          select: {c.seq, s.summary_text}
        )
        |> Repo.all()

      :error ->
        []
    end
  end

  @doc """
  激活时点后的已采纳章摘要数（VS-00G R8 假定计龄）：摘要随正文采纳产生，
  以其新增量近似「激活后推进章数」。
  """
  @spec accepted_summary_count_since(String.t(), DateTime.t()) :: non_neg_integer()
  def accepted_summary_count_since(work_id, %DateTime{} = since) when is_binary(work_id) do
    from(s in NovelPersistence.Schemas.ChapterSummary,
      where: s.work_id == ^work_id,
      where: s.status in ^@accepted,
      where: s.inserted_at > ^since,
      select: count(s.id)
    )
    |> Repo.one() || 0
  end

  def accepted_summary_count_since(_work_id, _since), do: 0

  @doc """
  章序号索引：chapter_id => %{seq, title, emotion, chapter_role}，供维护换算
  停滞窗口与情绪/冲突账（emotion/chapter_role 取自章计划 plan_direction，缺省 nil）。
  """
  @spec chapter_index(String.t()) :: %{String.t() => map()}
  def chapter_index(work_id) when is_binary(work_id) do
    case Ecto.UUID.cast(work_id) do
      {:ok, uuid} ->
        Chapter
        |> where([c], c.work_id == ^uuid)
        |> select([c], {c.id, c.seq, c.title, c.plan_direction})
        |> Repo.all()
        |> Map.new(fn {id, seq, title, plan} ->
          plan = plan || %{}

          {to_string(id),
           %{
             seq: seq,
             title: title,
             emotion: plan["emotion"],
             chapter_role: plan["chapter_role"]
           }}
        end)

      :error ->
        %{}
    end
  end

  defp to_map(%LedgerEntry{} = entry) do
    %{
      id: to_string(entry.id),
      work_id: entry.work_id,
      ledger: entry.ledger,
      subject_kind: entry.subject_kind,
      subject_ref: entry.subject_ref,
      subject_label: entry.subject_label,
      design_ref: entry.design_ref,
      status: entry.status,
      payload: entry.payload || %{},
      source_refs: entry.source_refs || [],
      last_event_chapter: entry.last_event_chapter,
      adoption_status: entry.adoption_status,
      revision: entry.revision
    }
  end
end
