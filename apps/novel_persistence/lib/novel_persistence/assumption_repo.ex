defmodule NovelPersistence.AssumptionRepo do
  @moduledoc """
  工作假定（「暂定设定」）持久化边界（VS-00G §2.3/§3.4，零新实体）。

  假定=既有 `Character` 等对象的 tentative 态 + `provisional_source=AI_ASSUMPTION`
  + `provisional_active` 布尔位；本模块只提供该形态的物化与读取，不触碰 canon
  （accepted）写入——转正仍走既有采纳边界（ADR-0019 INV-1）。
  """

  import Ecto.Query

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.Enums.ProvisionalSource
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Character

  @accepted_statuses [AdoptionStatus.accepted(), AdoptionStatus.edited_accepted()]

  @doc """
  把盘点产出的主角候选物化为暂定角色（required 事实自动激活，OQ2）。

  守卫集中在此（单事务语义，防 race 分散）：
  - 该作品已有 accepted 角色 → `{:ok, :skipped_canon_present}`（canon 优先，不激活假定）；
  - 同名角色行已存在（任意状态）→ `{:ok, :skipped_duplicate}`（否决过的不自动重提）；
  - 否则插入 `status=TENTATIVE + provisional_source=AI_ASSUMPTION + provisional_active=true`。
  """
  @spec materialize_character(map()) ::
          {:ok, Character.t() | :skipped_canon_present | :skipped_duplicate}
          | {:error, term()}
  def materialize_character(attrs) when is_map(attrs) do
    work_id = Map.fetch!(attrs, :work_id)
    name = attrs |> Map.fetch!(:name) |> String.trim()

    cond do
      name == "" ->
        {:error, :assumption_name_missing}

      accepted_character_exists?(work_id) ->
        {:ok, :skipped_canon_present}

      same_name_exists?(work_id, name) ->
        {:ok, :skipped_duplicate}

      true ->
        %Character{}
        |> Character.changeset(%{
          work_id: work_id,
          name: name,
          summary: Map.get(attrs, :summary),
          narrative_role: Map.get(attrs, :narrative_role),
          status: AdoptionStatus.tentative(),
          provisional_source: ProvisionalSource.ai_assumption(),
          provisional_active: true
        })
        |> Repo.insert()
    end
  end

  @doc "列出该作品的工作假定角色（「暂定设定」区与可标注注入通道的读端口）。"
  @spec list_assumption_characters(String.t()) :: [Character.t()]
  def list_assumption_characters(work_id) when is_binary(work_id) do
    case Ecto.UUID.cast(work_id) do
      {:ok, uuid} ->
        Character
        |> where(
          [c],
          c.work_id == ^uuid and c.status == ^AdoptionStatus.tentative() and
            c.provisional_source == ^ProvisionalSource.ai_assumption()
        )
        |> order_by([c], asc: c.inserted_at)
        |> Repo.all()

      :error ->
        []
    end
  end

  defp accepted_character_exists?(work_id) do
    case Ecto.UUID.cast(work_id) do
      {:ok, uuid} ->
        Character
        |> where([c], c.work_id == ^uuid and c.status in ^@accepted_statuses)
        |> limit(1)
        |> Repo.exists?()

      :error ->
        false
    end
  end

  defp same_name_exists?(work_id, name) do
    case Ecto.UUID.cast(work_id) do
      {:ok, uuid} ->
        Character
        |> where([c], c.work_id == ^uuid and c.name == ^name)
        |> limit(1)
        |> Repo.exists?()

      :error ->
        false
    end
  end
end
