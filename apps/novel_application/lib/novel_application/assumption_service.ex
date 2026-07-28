defmodule NovelApplication.AssumptionService do
  @moduledoc """
  「暂定设定」用例层（VS-00G CP5d，§2.3 防护②）。

  列出/确认/否决工作假定——生命周期即既有 AdoptionStatus 状态机（确认=就地
  accepted，否决=discarded），本服务是 web 的用例边界（比照 WorkArchiveService
  的档案读写口径，直连持久层）。
  """

  alias NovelPersistence.AssumptionRepo

  @type assumption_dto :: %{
          id: String.t(),
          name: String.t(),
          summary: String.t() | nil,
          narrative_role: String.t() | nil,
          provisional_active: boolean()
        }

  @spec list(String.t()) :: [assumption_dto()]
  def list(work_id) when is_binary(work_id) do
    work_id |> AssumptionRepo.list_assumption_characters() |> Enum.map(&to_dto/1)
  end

  @spec confirm(String.t(), String.t()) :: {:ok, assumption_dto()} | {:error, term()}
  def confirm(work_id, character_id) when is_binary(work_id) and is_binary(character_id) do
    apply_decision(&AssumptionRepo.confirm_character/2, work_id, character_id)
  end

  @spec discard(String.t(), String.t()) :: {:ok, assumption_dto()} | {:error, term()}
  def discard(work_id, character_id) when is_binary(work_id) and is_binary(character_id) do
    apply_decision(&AssumptionRepo.discard_character/2, work_id, character_id)
  end

  defp apply_decision(fun, work_id, character_id) do
    case fun.(work_id, character_id) do
      {:ok, character} -> {:ok, to_dto(character)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp to_dto(character) do
    %{
      id: to_string(Map.get(character, :id)),
      name: Map.get(character, :name),
      summary: Map.get(character, :summary),
      narrative_role: Map.get(character, :narrative_role),
      provisional_active: Map.get(character, :provisional_active) == true,
      status: Map.get(character, :status)
    }
  end
end
