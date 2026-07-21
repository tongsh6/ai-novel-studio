defmodule NovelPersistence.LedgerRepository do
  @moduledoc """
  五本账仓储（VS-00F §2 / ADR-0026）。

  权威账面的读写口：读取给探索面/写作投影/维护；写入只服务维护自动通过
  （系统发起的 TENTATIVE→ACCEPTED，I-L2）与后续裁决路径。upsert 以
  (work_id, ledger, subject_ref) 幂等定位。
  """

  import Ecto.Query

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Chapter
  alias NovelPersistence.Schemas.LedgerEntry

  @accepted [AdoptionStatus.accepted(), AdoptionStatus.edited_accepted()]

  @doc "作品的（默认弧光）账面条目，采纳态限已接受。"
  @spec list(String.t(), String.t()) :: [map()]
  def list(work_id, ledger \\ "arc") when is_binary(work_id) and is_binary(ledger) do
    LedgerEntry
    |> where([e], e.work_id == ^work_id and e.ledger == ^ledger)
    |> where([e], e.adoption_status in ^@accepted)
    |> order_by([e], asc: e.subject_label)
    |> Repo.all()
    |> Enum.map(&to_map/1)
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

  @doc "章序号索引：chapter_id => %{seq, title}，供维护换算停滞窗口。"
  @spec chapter_index(String.t()) :: %{String.t() => %{seq: non_neg_integer(), title: String.t()}}
  def chapter_index(work_id) when is_binary(work_id) do
    case Ecto.UUID.cast(work_id) do
      {:ok, uuid} ->
        Chapter
        |> where([c], c.work_id == ^uuid)
        |> select([c], {c.id, c.seq, c.title})
        |> Repo.all()
        |> Map.new(fn {id, seq, title} -> {to_string(id), %{seq: seq, title: title}} end)

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
